import type { LogContext, Logger } from '../../shared';

/**
 * Main-process last-resort error capture (03-technical-design.md §8.3):
 * uncaught exceptions and unhandled rejections end in the error log and the
 * app keeps running — for a local companion app a degraded state beats a
 * crash. Installing an `uncaughtException` listener is what disables the
 * default fatal handling, so this must never throw itself.
 *
 * The process is injected as a narrow structural shape (the E3.1 pattern)
 * so the wiring is testable without touching the real `process`.
 */
export interface ErrorCaptureProcess {
  on(event: 'uncaughtException', listener: (error: Error) => void): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
}

export function installMainErrorCapture(proc: ErrorCaptureProcess, logger: Logger): void {
  proc.on('uncaughtException', (error) => {
    logger.error('Uncaught exception in main', describeThrown(error));
  });
  proc.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection in main', describeThrown(reason));
  });
}

function describeThrown(value: unknown): LogContext {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack === undefined ? {} : { stack: value.stack }),
    };
  }
  // String() can itself throw (a thrown object with a throwing toString);
  // inside the uncaughtException listener that would be fatal.
  try {
    return { reason: String(value) };
  } catch {
    return { reason: '<unstringifiable value>' };
  }
}
