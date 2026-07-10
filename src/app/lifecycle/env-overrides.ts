import { isAbsolute } from 'node:path';

/**
 * Test-mode environment overrides (10-testing.md §1.3, E4.1/E20.1): the
 * Playwright harness starts the app with an isolated user-data directory
 * (own DB, logs, and single-instance lock), a fixed GSI port, and disabled
 * update checks — deterministic starts with no CS2, Steam, or network.
 * Deliberately injection points only (paths, port, flags), never behavior
 * forks: production code paths stay identical.
 */
export const USER_DATA_DIR_ENV_VAR = 'TACTICS_USER_DATA_DIR';
export const GSI_PORT_ENV_VAR = 'TACTICS_GSI_PORT';
export const DISABLE_UPDATES_ENV_VAR = 'TACTICS_DISABLE_UPDATES';

/**
 * Returns the user-data directory override, or `undefined` when the variable
 * is unset, empty, or not an absolute path (a relative path would silently
 * depend on the process working directory).
 */
export function resolveUserDataDirOverride(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const value = env[USER_DATA_DIR_ENV_VAR]?.trim();
  if (value === undefined || value === '' || !isAbsolute(value)) {
    return undefined;
  }
  return value;
}

/**
 * Returns the fixed GSI port override, or `undefined` when the variable is
 * unset, empty, or not a valid port number — an invalid value must degrade
 * to the normal port resolution, never crash a start. The override replaces
 * only the start of the ADR-031 fallback chain (port…port+9): a second
 * test-mode instance on the same fixed port binds the next free successor
 * instead of colliding.
 */
export function resolveGsiPortOverride(
  env: Readonly<Record<string, string | undefined>>,
): number | undefined {
  const value = env[GSI_PORT_ENV_VAR]?.trim();
  if (value === undefined || value === '') {
    return undefined;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return undefined;
  }
  return port;
}

/**
 * Whether update checks are disabled. Counts as set when non-empty after
 * trimming (the `TACTICS_LOG_DEBUG` convention). Unpackaged builds already
 * run a no-op updater; the variable makes "no network" an explicit guarantee
 * that also holds once the E2E suite exercises the packaged app.
 */
export function resolveUpdatesDisabled(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env[DISABLE_UPDATES_ENV_VAR]?.trim();
  return value !== undefined && value !== '';
}
