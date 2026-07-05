import type { LogLevel } from '../../../shared';

/**
 * Debug-level switches (ADR-030, 03-technical-design.md §8.1): production
 * default is `info`; `debug` is enabled via the start flag or the
 * environment variable — deliberately not via a setting.
 */
export const LOG_DEBUG_FLAG = '--log-debug';
export const LOG_DEBUG_ENV_VAR = 'TACTICS_LOG_DEBUG';

/**
 * Resolves the active log level from CLI arguments and environment. The
 * environment variable counts as set when non-empty after trimming (the
 * `TACTICS_USER_DATA_DIR` convention).
 */
export function resolveLogLevel(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): LogLevel {
  if (argv.includes(LOG_DEBUG_FLAG)) {
    return 'debug';
  }
  const value = env[LOG_DEBUG_ENV_VAR]?.trim();
  if (value !== undefined && value !== '') {
    return 'debug';
  }
  return 'info';
}
