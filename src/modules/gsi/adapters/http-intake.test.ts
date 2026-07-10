import { request as httpRequest } from 'node:http';
import { createServer as createNetServer, type Server as NetServer } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LogContext, Logger, LogLevel } from '../../../shared';
import {
  createGsiIntakeServer,
  DEFAULT_GSI_PORT,
  type GsiIntakeServer,
  isLoopbackAddress,
  PORT_ATTEMPT_COUNT,
  WRONG_TOKEN_HINT_THRESHOLD,
} from './http-intake';

const TOKEN = 'intake-test-token';

function validBody(): string {
  return JSON.stringify({
    auth: { token: TOKEN },
    provider: { timestamp: 42 },
    map: { name: 'de_mirage' },
  });
}

interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly context?: LogContext;
}

function createCapturingLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const record =
    (level: LogLevel) =>
    (message: string, context?: LogContext): void => {
      entries.push({ level, message, context });
    };
  return {
    logger: {
      error: record('error'),
      warn: record('warn'),
      info: record('info'),
      debug: record('debug'),
    },
    entries,
  };
}

/** Everything that would end up in the log file — the ban-list assertions run against this. */
function loggedText(entries: LogEntry[]): string {
  return entries
    .map((entry) => `${entry.message} ${JSON.stringify(entry.context ?? {})}`)
    .join('\n');
}

interface RequestOptions {
  readonly method?: string;
  readonly body?: string;
  readonly headers?: Record<string, string>;
}

function request(
  port: number,
  { method = 'POST', body = '', headers = {} }: RequestOptions = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const clientRequest = httpRequest(
      { host: '127.0.0.1', port, method, path: '/', headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    // Late socket errors (the server drops oversized uploads after
    // responding) settle after resolve and are then no-ops.
    clientRequest.on('error', reject);
    clientRequest.end(body);
  });
}

const runningServers: GsiIntakeServer[] = [];
const blockers: NetServer[] = [];

afterEach(async () => {
  for (const server of runningServers) {
    await server.stop();
  }
  runningServers.length = 0;
  await Promise.all(blockers.map(closeNetServer));
  blockers.length = 0;
});

function closeNetServer(server: NetServer): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Reserves an OS-assigned free port and releases it — the standard ephemeral
 * pattern (the tiny reuse race is accepted; the intake's own chain absorbs
 * it). Ports near the top of the range are re-rolled so the +9 chain stays
 * valid.
 */
function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => (port > 0 && port < 65_500 ? resolve(port) : resolve(reservePort())));
    });
  });
}

/** Binds a blocker on the port; `null` when it is already taken. */
function blockPort(port: number): Promise<NetServer | null> {
  return new Promise((resolve, reject) => {
    const blocker = createNetServer();
    blocker.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolve(null);
        return;
      }
      reject(error);
    });
    blocker.listen(port, '127.0.0.1', () => {
      blockers.push(blocker);
      resolve(blocker);
    });
  });
}

/** Occupies `count` consecutive ports and returns the first one. */
async function blockConsecutivePorts(count: number): Promise<number> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const basePort = await reservePort();
    const acquired: NetServer[] = [];
    let complete = true;
    for (let offset = 0; offset < count; offset += 1) {
      const blocker = await blockPort(basePort + offset);
      if (blocker === null) {
        complete = false;
        break;
      }
      acquired.push(blocker);
    }
    if (complete) {
      return basePort;
    }
    for (const blocker of acquired) {
      blockers.splice(blockers.indexOf(blocker), 1);
      await closeNetServer(blocker);
    }
  }
  throw new Error('could not reserve a consecutive port range for the test');
}

async function startIntake(overrides: { maxBodyBytes?: number } = {}): Promise<{
  intake: GsiIntakeServer;
  port: number;
  onPayload: ReturnType<typeof vi.fn>;
  entries: LogEntry[];
}> {
  const { logger, entries } = createCapturingLogger();
  const onPayload = vi.fn();
  const intake = createGsiIntakeServer({ logger, onPayload, ...overrides });
  runningServers.push(intake);
  const result = await intake.start(await reservePort(), TOKEN);
  if (!result.ok) {
    throw new Error('could not start the intake for the test');
  }
  return { intake, port: result.port, onPayload, entries };
}

describe('createGsiIntakeServer', () => {
  it('pins the ADR-031 default port', () => {
    expect(DEFAULT_GSI_PORT).toBe(42_730);
  });

  it('accepts a valid POST and forwards exactly the parsed subset', async () => {
    const { port, onPayload } = await startIntake();
    const response = await request(port, { body: validBody() });
    expect(response.status).toBe(200);
    expect(response.body).toBe('');
    expect(onPayload).toHaveBeenCalledExactlyOnceWith({
      providerTimestamp: 42,
      mapName: 'de_mirage',
    });
  });

  it('rejects a wrong token with 401 and never logs any token', async () => {
    const { port, onPayload, entries } = await startIntake();
    const body = JSON.stringify({ auth: { token: 'wrong-token' }, provider: { timestamp: 1 } });
    const response = await request(port, { body });
    expect(response.status).toBe(401);
    expect(response.body).toBe('');
    expect(onPayload).not.toHaveBeenCalled();
    expect(entries.some((entry) => entry.level === 'warn' && /token/.test(entry.message))).toBe(
      true,
    );
    expect(loggedText(entries)).not.toContain('wrong-token');
    expect(loggedText(entries)).not.toContain(TOKEN);
  });

  it('rejects bodies without an extractable token with 401', async () => {
    const { port, onPayload } = await startIntake();
    expect((await request(port, { body: 'this is not json {{' })).status).toBe(401);
    expect(
      (await request(port, { body: JSON.stringify({ provider: { timestamp: 1 } }) })).status,
    ).toBe(401);
    expect(onPayload).not.toHaveBeenCalled();
  });

  it('logs the foreign-config hint exactly once after repeated wrong-token requests', async () => {
    const { port, entries } = await startIntake();
    const body = JSON.stringify({ auth: { token: 'foreign' } });
    for (let index = 0; index < WRONG_TOKEN_HINT_THRESHOLD + 2; index += 1) {
      await request(port, { body });
    }
    const hints = entries.filter((entry) => /foreign GSI config/.test(entry.message));
    expect(hints).toHaveLength(1);
  });

  it('rejects non-POST methods with 405', async () => {
    const { port, onPayload } = await startIntake();
    const response = await request(port, { method: 'GET' });
    expect(response.status).toBe(405);
    expect(response.body).toBe('');
    expect(onPayload).not.toHaveBeenCalled();
  });

  it('rejects bodies over the size limit with 413 — declared and streamed', async () => {
    const { port, onPayload } = await startIntake({ maxBodyBytes: 64 });
    const oversized = 'x'.repeat(100);
    const declared = await request(port, {
      body: oversized,
      headers: { 'content-length': String(oversized.length) },
    });
    expect(declared.status).toBe(413);
    expect(declared.body).toBe('');
    // Without a content-length header the limit must trip on the stream.
    const streamed = await request(port, { body: oversized });
    expect(streamed.status).toBe(413);
    expect(onPayload).not.toHaveBeenCalled();
  });

  it('accepts but drops authorized payloads failing validation, logging shape only', async () => {
    const { port, onPayload, entries } = await startIntake();
    const body = JSON.stringify({ auth: { token: TOKEN }, secret: 'RAW_PAYLOAD_MARKER' });
    const response = await request(port, { body });
    // 200 keeps CS2 from re-queueing a payload that will never validate.
    expect(response.status).toBe(200);
    expect(onPayload).not.toHaveBeenCalled();
    const dropped = entries.find(
      (entry) => entry.level === 'warn' && /dropped/.test(entry.message),
    );
    expect(dropped?.context).toMatchObject({ code: 'INVALID_SHAPE' });
    expect(loggedText(entries)).not.toContain('RAW_PAYLOAD_MARKER');
    expect(loggedText(entries)).not.toContain(TOKEN);
  });

  it('falls through the port chain when the requested port is occupied', async () => {
    const requestedPort = await blockConsecutivePorts(1);
    const { logger } = createCapturingLogger();
    const onPayload = vi.fn();
    const intake = createGsiIntakeServer({ logger, onPayload });
    runningServers.push(intake);
    const result = await intake.start(requestedPort, TOKEN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.port).toBeGreaterThan(requestedPort);
      expect(result.port).toBeLessThan(requestedPort + PORT_ATTEMPT_COUNT);
      expect((await request(result.port, { body: validBody() })).status).toBe(200);
    }
  });

  it('reports PORT_UNAVAILABLE when the whole chain is occupied', async () => {
    const basePort = await blockConsecutivePorts(PORT_ATTEMPT_COUNT);
    const { logger } = createCapturingLogger();
    const intake = createGsiIntakeServer({ logger, onPayload: vi.fn() });
    runningServers.push(intake);
    const result = await intake.start(basePort, TOKEN);
    expect(result).toEqual({ ok: false, error: { code: 'PORT_UNAVAILABLE' } });
  });

  it('stops cleanly and supports repeated start/stop cycles', async () => {
    const { intake, port } = await startIntake();
    expect((await request(port, { body: validBody() })).status).toBe(200);
    await intake.stop();
    await expect(request(port, { body: validBody() })).rejects.toThrow();
    const restarted = await intake.start(port, TOKEN);
    expect(restarted.ok).toBe(true);
    if (restarted.ok) {
      expect((await request(restarted.port, { body: validBody() })).status).toBe(200);
    }
    await intake.stop();
    await expect(request(port, { body: validBody() })).rejects.toThrow();
  });

  it('treats stop without a running server as a no-op', async () => {
    const { logger } = createCapturingLogger();
    const intake = createGsiIntakeServer({ logger, onPayload: vi.fn() });
    await expect(intake.stop()).resolves.toBeUndefined();
  });

  it('throws when start is called while already running', async () => {
    const { intake, port } = await startIntake();
    expect(() => intake.start(port, TOKEN)).toThrow(/already running/);
  });
});

describe('isLoopbackAddress', () => {
  it('accepts only loopback source addresses (error case 8 defense in depth)', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('192.168.1.10')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});
