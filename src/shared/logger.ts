/**
 * The Logger port (ADR-030). Modules receive a Logger scoped to their name;
 * the electron-log adapter lives in `src/modules/logging` (E6.1). Usage
 * rules per level: 03-technical-design.md §8.1. Privacy ban list applies to
 * every call site: never the GSI auth token, raw GSI payloads, SteamIDs, or
 * player names.
 */
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogContext = Readonly<Record<string, unknown>>;

export interface Logger {
  error(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
}
