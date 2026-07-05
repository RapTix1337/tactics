import { join } from 'node:path';

import log from 'electron-log/node';

import type { LogContext, Logger, LogLevel } from '../../../shared';
import { redactContext } from '../core/redact-context';
import { archiveLogFile } from './archive-rotation';

/**
 * electron-log v5 behind the `Logger` port (ADR-030). The module is
 * deliberately Electron-free: the composition root passes the log directory
 * (`<userData>/logs` in production) and the dev flag, so the adapter runs
 * identically under Electron main and plain Node — the `electron-log/node`
 * entry provides the same file transport either way, and the rotation
 * integration test exercises the real thing.
 */

/** ADR-030: rotate the live file at 5 MB. */
export const MAX_LOG_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** The live log's file name inside the log directory (ADR-030). */
export const LOG_FILE_NAME = 'main.log';

// One line per entry: timestamp, level, scope, message, structured context
// (03-technical-design.md §8.2). A format function because the `{scope}`
// string token always renders padded and parenthesized. Structural subset of
// electron-log's FormatParams (not type-exported via the `/node` entry).
interface FormatLineParams {
  message: { date: Date; level: string; scope?: string; data: unknown[] };
}

function formatLine({ message }: FormatLineParams): unknown[] {
  const pad = (value: number, length = 2): string => String(value).padStart(length, '0');
  const date = message.date;
  const timestamp =
    `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
    `${pad(date.getMilliseconds(), 3)}`;
  return [`[${timestamp}] [${message.level}] [${message.scope ?? '-'}]`, ...message.data];
}

export interface LoggingOptions {
  /** Absolute directory for the live log and its archives. */
  logDirectory: string;
  level: LogLevel;
  /** Console output is dev-only (ADR-030). */
  enableConsole: boolean;
  /** Test-only override to exercise rotation without writing 5 MB. */
  maxFileSizeBytes?: number;
}

interface LoggingState {
  instance: typeof log;
  logDirectory: string;
}

let state: LoggingState | undefined;
let instanceCount = 0;

/**
 * Configures the electron-log instance backing `createLogger` /
 * `getLogDirectory`. Called once by the composition root before anything
 * logs; calling again replaces the instance (used by tests).
 */
export function initializeLogging(options: LoggingOptions): void {
  instanceCount += 1;
  const instance = log.create({ logId: `tactics-${String(instanceCount)}` });

  instance.transports.file.resolvePathFn = (): string => join(options.logDirectory, LOG_FILE_NAME);
  instance.transports.file.level = options.level;
  instance.transports.file.maxSize = options.maxFileSizeBytes ?? MAX_LOG_FILE_SIZE_BYTES;
  instance.transports.file.format = formatLine;
  instance.transports.file.archiveLogFn = (oldLogFile): void => {
    archiveLogFile(oldLogFile.path);
  };
  // Keep each entry on a single line regardless of context size.
  instance.transports.file.inspectOptions = {
    depth: 6,
    breakLength: Number.POSITIVE_INFINITY,
  };
  instance.transports.console.level = options.enableConsole ? options.level : false;

  state = { instance, logDirectory: options.logDirectory };
}

/** Returns a `Logger` whose lines carry the given module scope. */
export function createLogger(scope: string): Logger {
  const emit = (level: LogLevel, message: string, context?: LogContext): void => {
    const scoped = requireState().instance.scope(scope);
    if (context === undefined) {
      scoped[level](message);
    } else {
      scoped[level](message, redactContext(context));
    }
  };
  return {
    error: (message, context): void => {
      emit('error', message, context);
    },
    warn: (message, context): void => {
      emit('warn', message, context);
    },
    info: (message, context): void => {
      emit('info', message, context);
    },
    debug: (message, context): void => {
      emit('debug', message, context);
    },
  };
}

/** The directory holding the live log and its archives (used by E6.3). */
export function getLogDirectory(): string {
  return requireState().logDirectory;
}

function requireState(): LoggingState {
  if (state === undefined) {
    throw new Error('initializeLogging must be called before using the logging module.');
  }
  return state;
}
