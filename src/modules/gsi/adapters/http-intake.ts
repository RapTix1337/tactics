import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

import type { Logger } from '../../../shared';
import { type GsiPayloadSubset, parseGsiPayload } from '../core/payload-schema';

/**
 * The GSI HTTP intake (ADR-025 §3): a pure data sink bound to 127.0.0.1,
 * POST only, auth-token check, per-request size limit and timeout, and
 * data-free responses — no response ever carries payload or state. Valid
 * payloads leave through the `onPayload` callback (wired to the status state
 * machine by `app`, E10.7); everything else is logged within the ADR-030 ban
 * list (never the token, never raw payloads) and dropped.
 */

/** Default GSI port (ADR-031) — registered range, references Steam app id 730. */
export const DEFAULT_GSI_PORT = 42730;

/**
 * Ports tried per `start`: the requested port plus its 9 successors. With
 * the default port this is exactly the ADR-031 chain 42730–42739.
 */
export const PORT_ATTEMPT_COUNT = 10;

/**
 * Per-request body limit (E10.1 decision: an intake parameter, not a checked
 * in fixture). Real payloads with only `provider` + `map` subscribed are a
 * few KB — 256 KiB is generous without inviting memory abuse.
 */
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

/** Requests not completed within this window are dropped by Node's timer. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

/**
 * After this many wrong-token rejections, one diagnostic hint is logged
 * (05-gsi.md error case 4 — likely a foreign GSI config on this port).
 */
export const WRONG_TOKEN_HINT_THRESHOLD = 3;

export interface GsiIntakeOptions {
  readonly logger: Logger;
  /** Receives every validated payload subset — the only data leaving the sink. */
  readonly onPayload: (payload: GsiPayloadSubset) => void;
  readonly maxBodyBytes?: number;
  readonly requestTimeoutMs?: number;
}

export type GsiIntakeStartResult =
  | { readonly ok: true; readonly port: number }
  | { readonly ok: false; readonly error: { readonly code: 'PORT_UNAVAILABLE' } };

export interface GsiIntakeServer {
  /**
   * Binds to 127.0.0.1 on the first free port of `port…port + 9` and reports
   * the effective port; `PORT_UNAVAILABLE` when the whole chain is occupied
   * (ADR-031 — manual configuration required). Must not be called while
   * running.
   */
  start(port: number, token: string): Promise<GsiIntakeStartResult>;
  /** Closes the listener and destroys open connections; idempotent. */
  stop(): Promise<void>;
}

export function createGsiIntakeServer(options: GsiIntakeOptions): GsiIntakeServer {
  const { logger, onPayload } = options;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  let server: Server | null = null;
  const openSockets = new Set<Socket>();
  let expectedTokenDigest: Buffer = Buffer.alloc(0);
  let wrongTokenCount = 0;

  function handleRequest(request: IncomingMessage, response: ServerResponse): void {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      // Cannot occur behind the 127.0.0.1 bind — defense in depth
      // (05-gsi.md error case 8).
      logger.warn('GSI request rejected: non-loopback source');
      respondEmpty(response, 403);
      return;
    }
    if (request.method !== 'POST') {
      logger.warn('GSI request rejected: method not allowed', { method: request.method });
      respondEmpty(response, 405);
      return;
    }
    readBodyLimited(request, maxBodyBytes, (outcome) => {
      if (outcome === 'oversize') {
        logger.warn('GSI request rejected: body exceeds size limit', {
          limitBytes: maxBodyBytes,
        });
        // Drain the remainder instead of destroying — a reset would race
        // the 413 on loopback; the request timeout bounds the drain.
        request.resume();
        respondEmpty(response, 413, { close: true });
        return;
      }
      if (outcome === 'request-error') {
        request.socket.destroy();
        return;
      }
      handleBody(outcome.body, response);
    });
  }

  function handleBody(body: string, response: ServerResponse): void {
    if (!isAuthorized(body)) {
      wrongTokenCount += 1;
      logger.warn('GSI request rejected: wrong or missing auth token');
      if (wrongTokenCount === WRONG_TOKEN_HINT_THRESHOLD) {
        logger.warn(
          'Repeated wrong-token GSI requests — a foreign GSI config may be pointing at this port',
          { rejectedCount: wrongTokenCount },
        );
      }
      respondEmpty(response, 401);
      return;
    }
    const result = parseGsiPayload(body);
    if (!result.ok) {
      // Log and drop, never fatal (05-gsi.md error case 5). Responding 200
      // keeps CS2 from re-queueing a payload we will never accept (GSI-09).
      logger.warn('GSI payload dropped: validation failed', {
        code: result.error.code,
        issues: result.error.issues,
      });
      respondEmpty(response, 200);
      return;
    }
    onPayload(result.payload);
    respondEmpty(response, 200);
  }

  /**
   * CS2 echoes the configured auth block inside the payload as
   * `auth.token`; there is no HTTP header. The check parses just enough to
   * extract it — full shape validation only runs for authorized bodies.
   */
  function isAuthorized(body: string): boolean {
    const token = extractAuthToken(body);
    if (token === null) {
      return false;
    }
    // Digest comparison gives constant-time equality without leaking length.
    return timingSafeEqual(sha256(token), expectedTokenDigest);
  }

  return {
    start(port: number, token: string): Promise<GsiIntakeStartResult> {
      if (server !== null) {
        throw new Error('GSI intake is already running — call stop() first');
      }
      expectedTokenDigest = sha256(token);
      wrongTokenCount = 0;
      // Node enforces requestTimeout only on the checking interval — align
      // both so a stalled request dies within ~2× the configured window.
      const candidate = createServer(
        { requestTimeout: requestTimeoutMs, connectionsCheckingInterval: requestTimeoutMs },
        handleRequest,
      );
      candidate.on('connection', (socket) => {
        openSockets.add(socket);
        socket.on('close', () => openSockets.delete(socket));
      });
      return bindToFirstFreePort(candidate, port, logger).then((boundPort) => {
        if (boundPort === null) {
          return { ok: false, error: { code: 'PORT_UNAVAILABLE' } } as const;
        }
        server = candidate;
        logger.info('GSI intake listening', { port: boundPort });
        return { ok: true, port: boundPort } as const;
      });
    },

    stop(): Promise<void> {
      const running = server;
      if (running === null) {
        return Promise.resolve();
      }
      server = null;
      return new Promise((resolve, reject) => {
        running.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          logger.info('GSI intake stopped');
          resolve();
        });
        for (const socket of openSockets) {
          socket.destroy();
        }
        openSockets.clear();
      });
    },
  };
}

/**
 * Tries `startPort` and its successors until one binds; `null` when the
 * whole chain is occupied. Only address-in-use errors advance the chain —
 * anything else is a real failure and propagates.
 */
async function bindToFirstFreePort(
  server: Server,
  startPort: number,
  logger: Logger,
): Promise<number | null> {
  for (let attempt = 0; attempt < PORT_ATTEMPT_COUNT; attempt += 1) {
    const port = startPort + attempt;
    const bound = await tryListen(server, port);
    if (bound) {
      return port;
    }
    logger.debug('GSI port occupied, trying next in chain', { port });
  }
  return null;
}

function tryListen(server: Server, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onListening = (): void => {
      server.removeListener('error', onError);
      resolve(true);
    };
    const onError = (error: NodeJS.ErrnoException): void => {
      server.removeListener('listening', onListening);
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
        resolve(false);
        return;
      }
      reject(error);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

/** Loopback check for the defense-in-depth rejection (error case 8). */
export function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/**
 * Extracts `auth.token` from the raw body without validating anything else
 * — the tolerance boundary (E10.2) only runs for authorized requests.
 */
function extractAuthToken(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const auth = (parsed as Record<string, unknown>).auth;
  if (typeof auth !== 'object' || auth === null) {
    return null;
  }
  const token = (auth as Record<string, unknown>).token;
  return typeof token === 'string' ? token : null;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

type BodyReadOutcome = { readonly body: string } | 'oversize' | 'request-error';

/**
 * Reads the request body up to `limitBytes`; reading stops the moment the
 * limit is exceeded. A failed request stream is its own outcome so it never
 * masquerades as an oversize rejection.
 */
function readBodyLimited(
  request: IncomingMessage,
  limitBytes: number,
  onDone: (outcome: BodyReadOutcome) => void,
): void {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    onDone('oversize');
    return;
  }
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  let finished = false;
  const finish = (outcome: BodyReadOutcome): void => {
    if (!finished) {
      finished = true;
      onDone(outcome);
    }
  };
  request.on('data', (chunk: Buffer) => {
    receivedBytes += chunk.length;
    if (receivedBytes > limitBytes) {
      request.removeAllListeners('data');
      request.removeAllListeners('end');
      finish('oversize');
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => finish({ body: Buffer.concat(chunks).toString('utf8') }));
  request.on('error', () => finish('request-error'));
}

/** Every response is header-only — the sink never returns data (ADR-025 §3). */
function respondEmpty(
  response: ServerResponse,
  statusCode: number,
  options?: { readonly close?: boolean },
): void {
  const headers: Record<string, string> = { 'content-length': '0' };
  if (options?.close === true) {
    headers.connection = 'close';
  }
  response.writeHead(statusCode, headers);
  response.end();
}
