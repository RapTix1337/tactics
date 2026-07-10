import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { generateConfigContent, GSI_CONFIG_FILE_NAME } from '../core/config-content';

/**
 * GSI config file verification and write (05-gsi.md §1 no. 1). Verification
 * is a byte comparison against the currently expected content — a missing
 * file, a hand-edited file, an old app version's format, and a stale
 * port/token all surface as one repair-needed signal (03-technical-design.md
 * §7.4, error case 1). `writeConfig` is called only by `app` after user
 * consent (ADR-032) and touches nothing outside the given cfg directory
 * (ADR-025). Fs errors beyond "file missing" propagate to the caller —
 * `app` owns error mapping and logging (E10.6).
 */

export type GsiConfigVerifyResult = 'ok' | 'missing' | 'outdated';

/** Compares the installed config against the expected content byte for byte. */
export async function verifyConfig(
  cfgDir: string,
  port: number,
  token: string,
): Promise<GsiConfigVerifyResult> {
  let actual: string;
  try {
    actual = await readFile(join(cfgDir, GSI_CONFIG_FILE_NAME), 'utf8');
  } catch (error) {
    if (isFileMissing(error)) {
      return 'missing';
    }
    throw error;
  }
  return actual === generateConfigContent(port, token) ? 'ok' : 'outdated';
}

/**
 * Writes the config atomically: a temp file in the same directory, then a
 * rename over the target (same volume ⇒ atomic; Node's `rename` replaces an
 * existing file on Windows too). CS2 therefore never observes a partially
 * written config.
 */
export async function writeConfig(cfgDir: string, port: number, token: string): Promise<void> {
  const temporaryPath = join(cfgDir, `${GSI_CONFIG_FILE_NAME}.tmp`);
  try {
    await writeFile(temporaryPath, generateConfigContent(port, token), 'utf8');
    await rename(temporaryPath, join(cfgDir, GSI_CONFIG_FILE_NAME));
  } catch (error) {
    // Best effort: never leave a temp file in the user's CS2 cfg directory.
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isFileMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
