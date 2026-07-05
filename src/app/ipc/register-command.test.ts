import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';

import type { LogContext, Logger, LogLevel } from '../../shared';
import { defineCommand, failure, success } from '../../shared';
import type { CommandHandler, CommandRegistrationDeps } from './register-command';
import { registerCommand } from './register-command';

const echoCommand = defineCommand(
  'test.echo',
  z.object({ value: z.string() }),
  z.object({ echoed: z.string() }),
);

interface FakeEvent {
  trusted: boolean;
}

const trusted: FakeEvent = { trusted: true };
const untrusted: FakeEvent = { trusted: false };

interface LogEntry {
  level: LogLevel;
  message: string;
  context: LogContext | undefined;
}

function createHarness(): {
  deps: CommandRegistrationDeps<FakeEvent>;
  channels: () => readonly string[];
  invoke: (channel: string, event: FakeEvent, request: unknown) => Promise<unknown>;
  logEntries: readonly LogEntry[];
} {
  const handlers = new Map<string, (event: FakeEvent, request: unknown) => Promise<unknown>>();
  const logEntries: LogEntry[] = [];
  const record =
    (level: LogLevel) =>
    (message: string, context?: LogContext): void => {
      logEntries.push({ level, message, context });
    };
  const logger: Logger = {
    error: record('error'),
    warn: record('warn'),
    info: record('info'),
    debug: record('debug'),
  };
  return {
    deps: {
      registerHandler: (channel, listener): void => {
        handlers.set(channel, listener);
      },
      isTrustedSender: (event): boolean => event.trusted,
      logger,
    },
    channels: (): readonly string[] => [...handlers.keys()],
    invoke: async (channel, event, request): Promise<unknown> => {
      const listener = handlers.get(channel);
      if (listener === undefined) {
        throw new Error(`no handler registered on ${channel}`);
      }
      return listener(event, request);
    },
    logEntries,
  };
}

describe('registerCommand', () => {
  it('registers on the contract-derived channel and returns the success envelope', async () => {
    const { deps, channels, invoke } = createHarness();
    registerCommand(deps, echoCommand, (request) => success({ echoed: request.value }));

    expect(channels()).toEqual(['cmd:test.echo']);
    await expect(invoke('cmd:test.echo', trusted, { value: 'hi' })).resolves.toEqual({
      ok: true,
      data: { echoed: 'hi' },
    });
  });

  it('supports async handlers', async () => {
    const { deps, invoke } = createHarness();
    registerCommand(deps, echoCommand, (request) =>
      Promise.resolve(success({ echoed: request.value })),
    );

    await expect(invoke('cmd:test.echo', trusted, { value: 'later' })).resolves.toEqual({
      ok: true,
      data: { echoed: 'later' },
    });
  });

  it('passes named handler errors through unchanged', async () => {
    const { deps, invoke } = createHarness();
    registerCommand(deps, echoCommand, () => failure('CS2_NOT_FOUND', 'CS2 was not found.'));

    await expect(invoke('cmd:test.echo', trusted, { value: 'hi' })).resolves.toEqual({
      ok: false,
      error: { code: 'CS2_NOT_FOUND', message: 'CS2 was not found.' },
    });
  });

  it('rejects untrusted senders without dispatching, as a generic INTERNAL envelope', async () => {
    const { deps, invoke, logEntries } = createHarness();
    const handler = vi.fn(() => success({ echoed: 'never' }));
    registerCommand(deps, echoCommand, handler);

    const result = await invoke('cmd:test.echo', untrusted, { value: 'hi' });

    // Identical to the thrown-exception envelope: an untrusted caller must
    // not be able to tell rejection and internal fault apart (ADR-025).
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'An unexpected error occurred.' },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(logEntries).toEqual([
      {
        level: 'warn',
        message: expect.any(String) as string,
        context: { command: 'test.echo' },
      },
    ]);
  });

  it('maps an invalid request to INVALID_REQUEST without dispatching', async () => {
    const { deps, invoke, logEntries } = createHarness();
    const handler = vi.fn(() => success({ echoed: 'never' }));
    registerCommand(deps, echoCommand, handler);

    const result = await invoke('cmd:test.echo', trusted, { value: 42 });

    expect(result).toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Invalid request for test.echo.' },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0]?.context).toEqual({ command: 'test.echo', issuePaths: ['value'] });
    // Privacy (ADR-030): the request contents must not reach any log line.
    expect(JSON.stringify(logEntries)).not.toContain('42');
  });

  it('maps a thrown handler exception to INTERNAL and keeps details out of the envelope', async () => {
    const { deps, invoke, logEntries } = createHarness();
    registerCommand(deps, echoCommand, () => {
      throw new Error('boom-secret');
    });

    const result = await invoke('cmd:test.echo', trusted, { value: 'hi' });

    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'An unexpected error occurred.' },
    });
    // ADR-025: no internals across the boundary — but the log carries them.
    expect(JSON.stringify(result)).not.toContain('boom-secret');
    expect(logEntries).toEqual([
      {
        level: 'error',
        message: expect.any(String) as string,
        context: { command: 'test.echo', error: 'Error: boom-secret' },
      },
    ]);
  });

  it('accepts only contract definitions — no free-form channels (type level)', () => {
    const compileTimeProof = (): void => {
      const { deps } = createHarness();
      // @ts-expect-error — a bare channel string is not a contract definition
      registerCommand(deps, 'cmd:test.echo', () => success({ echoed: 'x' }));
    };
    expect(compileTimeProof).toBeTypeOf('function'); // proof is the compile, never invoked

    expectTypeOf<Parameters<CommandHandler<typeof echoCommand>>[0]>().toEqualTypeOf<{
      value: string;
    }>();
  });
});
