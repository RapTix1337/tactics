import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import type { CommandResult } from '../../../shared/envelope';
import type { GlobalErrorTarget } from './error-reporting';
import {
  createErrorReporter,
  installGlobalErrorHandlers,
  MAX_REPORTS_PER_RENDERER_SESSION,
} from './error-reporting';

interface SentReport {
  message: string;
  stack?: string;
  route?: string;
}

function createFakeBridge(
  result: () => Promise<CommandResult<undefined>> = () =>
    Promise.resolve({ ok: true, data: undefined }),
): { bridge: TacticsBridge; reports: SentReport[] } {
  const reports: SentReport[] = [];
  const invoke = (command: string, input: SentReport): Promise<CommandResult<undefined>> => {
    expect(command).toBe('app.reportRendererError');
    reports.push(input);
    return result();
  };
  const neverSubscribe = (): never => {
    throw new Error('no contract events exist yet');
  };
  // Cast: the fake only needs the report command; TacticsBridge's surface
  // is exactly invoke + subscribe (the bootstrap.test.ts pattern).
  return { bridge: { invoke, subscribe: neverSubscribe } as unknown as TacticsBridge, reports };
}

function createFakeTarget(): {
  target: GlobalErrorTarget;
  fireError: (event: Pick<ErrorEvent, 'error' | 'message'>) => void;
  fireRejection: (reason: unknown) => void;
} {
  // (event: never) => void accepts both listener shapes; jsdom cannot
  // construct PromiseRejectionEvent, so the listeners are driven directly.
  const listeners = new Map<string, (event: never) => void>();
  const target: GlobalErrorTarget = {
    addEventListener(type: string, listener: (event: never) => void): void {
      listeners.set(type, listener);
    },
  };
  const fire = (type: string, event: unknown): void => {
    const listener = listeners.get(type);
    if (listener === undefined) {
      throw new Error(`No listener registered for ${type}`);
    }
    listener(event as never);
  };
  return {
    target,
    fireError: (event): void => {
      fire('error', event);
    },
    fireRejection: (reason): void => {
      fire('unhandledrejection', { reason });
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createErrorReporter', () => {
  it('reports an Error with name-prefixed message and stack', () => {
    const { bridge, reports } = createFakeBridge();
    const report = createErrorReporter(bridge);
    const error = new TypeError('boom');
    error.stack = 'TypeError: boom\n    at render';

    report(error, 'unused fallback');

    expect(reports).toEqual([
      { message: 'TypeError: boom', stack: 'TypeError: boom\n    at render' },
    ]);
  });

  it('reports a non-Error candidate with the fallback message and no stack', () => {
    const { bridge, reports } = createFakeBridge();
    const report = createErrorReporter(bridge);

    report('boom', 'Uncaught boom');

    expect(reports).toEqual([{ message: 'Uncaught boom' }]);
  });

  it('dedupes by object identity, not by message text', () => {
    const { bridge, reports } = createFakeBridge();
    const report = createErrorReporter(bridge);
    const error = new Error('boom');

    report(error, 'unused');
    report(error, 'unused'); // same object: the E13.3 boundary + window.onerror case
    report(new Error('boom'), 'unused'); // same text, distinct error

    expect(reports).toHaveLength(2);
  });

  it('truncates oversized messages and stacks before sending', () => {
    const { bridge, reports } = createFakeBridge();
    const report = createErrorReporter(bridge);
    const error = new Error('m'.repeat(5_000));
    error.stack = 's'.repeat(20_000);

    report(error, 'unused');

    expect(reports[0]?.message).toHaveLength(1_000);
    expect(reports[0]?.message.endsWith('…')).toBe(true);
    expect(reports[0]?.stack).toHaveLength(8_000);
  });

  it('sends one suppression notice at the session cap, then goes quiet', () => {
    const { bridge, reports } = createFakeBridge();
    const report = createErrorReporter(bridge);

    for (let i = 0; i < MAX_REPORTS_PER_RENDERER_SESSION + 5; i += 1) {
      report(new Error(`boom ${String(i)}`), 'unused');
    }

    expect(reports).toHaveLength(MAX_REPORTS_PER_RENDERER_SESSION + 1);
    expect(reports.at(-1)?.message).toContain('suppressed');
  });

  it('is a no-op without a bridge', () => {
    const report = createErrorReporter(undefined);

    expect(() => {
      report(new Error('boom'), 'unused');
    }).not.toThrow();
  });

  it('never throws and falls back to the console when the invoke rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { bridge } = createFakeBridge(() => Promise.reject(new Error('ipc broke')));
    const report = createErrorReporter(bridge);

    expect(() => {
      report(new Error('boom'), 'unused');
    }).not.toThrow();

    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Renderer error report failed', expect.any(Error));
    });
  });

  it('surfaces a refused report envelope on the console', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { bridge } = createFakeBridge(() =>
      Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: 'nope' } }),
    );
    const report = createErrorReporter(bridge);

    report(new Error('boom'), 'unused');

    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Renderer error report rejected: nope');
    });
  });
});

describe('installGlobalErrorHandlers', () => {
  it('forwards error events with the thrown value and the browser message', () => {
    const report = vi.fn();
    const { target, fireError } = createFakeTarget();
    installGlobalErrorHandlers(target, report);
    const error = new Error('boom');

    fireError({ error, message: 'Uncaught Error: boom' });

    expect(report).toHaveBeenCalledWith(error, 'Uncaught Error: boom');
  });

  it('forwards opaque error events relying on the fallback message', () => {
    const report = vi.fn();
    const { target, fireError } = createFakeTarget();
    installGlobalErrorHandlers(target, report);

    fireError({ error: null, message: 'Script error.' });

    expect(report).toHaveBeenCalledWith(null, 'Script error.');
  });

  it('forwards unhandled rejections with a stringified reason fallback', () => {
    const report = vi.fn();
    const { target, fireRejection } = createFakeTarget();
    installGlobalErrorHandlers(target, report);

    fireRejection('boom');

    expect(report).toHaveBeenCalledWith('boom', 'Unhandled promise rejection: boom');
  });

  it('survives a rejection reason whose stringification throws', () => {
    const report = vi.fn();
    const { target, fireRejection } = createFakeTarget();
    installGlobalErrorHandlers(target, report);
    const hostile = {
      toString(): string {
        throw new Error('nope');
      },
    };

    expect(() => {
      fireRejection(hostile);
    }).not.toThrow();
    expect(report).toHaveBeenCalledWith(
      hostile,
      'Unhandled promise rejection: <unstringifiable value>',
    );
  });
});
