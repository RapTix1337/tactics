import { isAbsolute } from 'node:path';

/**
 * E2E test mode (10-testing.md §1.3): points the app at a separate user-data
 * directory so test instances never share state — or a single-instance lock —
 * with a regular installation. Set by the Playwright harness (E4.1).
 *
 * A second variable for a fixed GSI port (`TACTICS_GSI_PORT`) is reserved for
 * the GSI epic (E10) and deliberately not implemented yet.
 */
export const USER_DATA_DIR_ENV_VAR = 'TACTICS_USER_DATA_DIR';

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
