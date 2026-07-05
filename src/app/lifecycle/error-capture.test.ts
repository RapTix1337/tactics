import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '../../shared';
import type { ErrorCaptureProcess } from './error-capture';
import { installMainErrorCapture } from './error-capture';

type CapturedListener = (value: unknown) => void;

function setup(): {
  emit: (event: string, value: unknown) => void;
  error: ReturnType<typeof vi.fn>;
} {
  const listeners = new Map<string, CapturedListener>();
  const proc: ErrorCaptureProcess = {
    on(event: string, listener: (value: never) => void): unknown {
      listeners.set(event, listener as CapturedListener);
      return undefined;
    },
  };
  const error = vi.fn();
  const logger: Logger = {
    error,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
  };

  installMainErrorCapture(proc, logger);

  return {
    emit: (event, value): void => {
      const listener = listeners.get(event);
      if (listener === undefined) {
        throw new Error(`No listener registered for ${event}`);
      }
      listener(value);
    },
    error,
  };
}

describe('installMainErrorCapture', () => {
  it('logs an uncaught exception with name, message, and stack', () => {
    const { emit, error } = setup();
    const thrown = new Error('boom');
    thrown.stack = 'Error: boom\n    at test';

    emit('uncaughtException', thrown);

    expect(error).toHaveBeenCalledWith('Uncaught exception in main', {
      name: 'Error',
      message: 'boom',
      stack: 'Error: boom\n    at test',
    });
  });

  it('omits the stack key when the error carries none', () => {
    const { emit, error } = setup();
    const thrown = new Error('boom');
    thrown.stack = undefined;

    emit('uncaughtException', thrown);

    expect(error).toHaveBeenCalledWith('Uncaught exception in main', {
      name: 'Error',
      message: 'boom',
    });
  });

  it('logs an unhandled rejection with an Error reason like an exception', () => {
    const { emit, error } = setup();
    const reason = new TypeError('bad state');
    reason.stack = 'TypeError: bad state\n    at test';

    emit('unhandledRejection', reason);

    expect(error).toHaveBeenCalledWith('Unhandled promise rejection in main', {
      name: 'TypeError',
      message: 'bad state',
      stack: 'TypeError: bad state\n    at test',
    });
  });

  it('stringifies a non-Error rejection reason', () => {
    const { emit, error } = setup();

    emit('unhandledRejection', 'plain rejection');

    expect(error).toHaveBeenCalledWith('Unhandled promise rejection in main', {
      reason: 'plain rejection',
    });
  });

  it('survives a reason whose stringification throws', () => {
    const { emit, error } = setup();
    const hostile = {
      toString(): string {
        throw new Error('nope');
      },
    };

    expect(() => {
      emit('unhandledRejection', hostile);
    }).not.toThrow();
    expect(error).toHaveBeenCalledWith('Unhandled promise rejection in main', {
      reason: '<unstringifiable value>',
    });
  });
});
