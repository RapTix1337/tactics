import { type Cs2Paths, deriveCfgDir, trimTrailingSeparators } from './cs2-paths';

/**
 * Validation of a manually selected CS2 path (GSI-02, ADR-025 §4): the
 * expected structure is checked before anything would ever be written there.
 * A path is valid exactly when it is a directory containing the GSI config
 * directory `game/csgo/cfg` — the one place `gsi.applySetup` writes to. The
 * check stays pure (ADR-019): the file system is reached only through the
 * injected probe; the fs-backed probe lives in `adapters/`.
 */

/** The single fs question the validation needs — kept this narrow on purpose. */
export interface DirectoryProbe {
  /** Resolves `true` iff the path exists and is a directory; never throws. */
  readonly isDirectory: (path: string) => Promise<boolean>;
}

export type ValidateCs2PathResult =
  | { readonly ok: true; readonly paths: Cs2Paths }
  | { readonly ok: false; readonly reason: 'NOT_A_DIRECTORY' | 'MISSING_CS2_STRUCTURE' };

/** Checks the expected CS2 structure; the reasons are for debug logs only —
 * across the IPC boundary both surface as the named `INVALID_PATH` error. */
export async function validateCs2Path(
  path: string,
  probe: DirectoryProbe,
): Promise<ValidateCs2PathResult> {
  const trimmed = trimTrailingSeparators(path);
  // A bare drive letter (`D:`) is drive-relative on Windows — keep the
  // separator so a drive-root pick stays an absolute path.
  const gameRoot = /^[a-zA-Z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed;
  if (gameRoot === '' || !(await probe.isDirectory(gameRoot))) {
    return { ok: false, reason: 'NOT_A_DIRECTORY' };
  }
  const cfgDir = deriveCfgDir(gameRoot);
  if (!(await probe.isDirectory(cfgDir))) {
    return { ok: false, reason: 'MISSING_CS2_STRUCTURE' };
  }
  return { ok: true, paths: { gameRoot, cfgDir } };
}
