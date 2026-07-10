/**
 * Derives the CS2 paths from a manifest hit (GSI-01): the game root is
 * `<library>/steamapps/common/<installdir>`, the GSI config directory is
 * `<gameRoot>/game/csgo/cfg` (verified against a live CS2 installation,
 * 2026-07-05). Pure string derivation — the core stays free of `node:path`
 * (ADR-019); the separator is taken from the library path itself, which
 * keeps the output consistent per platform without a platform switch.
 */

const GAME_ROOT_SEGMENTS = ['steamapps', 'common'] as const;
const CFG_DIR_SEGMENTS = ['game', 'csgo', 'cfg'] as const;

export interface Cs2Paths {
  readonly gameRoot: string;
  readonly cfgDir: string;
}

/** Joins the library path and install dir into the CS2 game root and cfg dir. */
export function deriveCs2Paths(libraryPath: string, installDir: string): Cs2Paths {
  const separator = libraryPath.includes('\\') ? '\\' : '/';
  const base = trimTrailingSeparators(libraryPath);
  const gameRoot = [base, ...GAME_ROOT_SEGMENTS, installDir].join(separator);
  return { gameRoot, cfgDir: deriveCfgDir(gameRoot) };
}

/** Derives the GSI config directory from a game root (detected or manual). */
export function deriveCfgDir(gameRoot: string): string {
  const separator = gameRoot.includes('\\') ? '\\' : '/';
  return [trimTrailingSeparators(gameRoot), ...CFG_DIR_SEGMENTS].join(separator);
}

/** Drops trailing separators so joining never produces doubled ones. */
export function trimTrailingSeparators(path: string): string {
  let end = path.length;
  while (end > 0 && (path[end - 1] === '\\' || path[end - 1] === '/')) {
    end -= 1;
  }
  return path.slice(0, end);
}
