import { describe, expect, it } from 'vitest';

import type { DirectoryProbe } from './validate-cs2-path';
import { validateCs2Path } from './validate-cs2-path';

/** Probe over a fixed set of existing directories — exact-match on purpose. */
function probeOf(...directories: readonly string[]): DirectoryProbe {
  const existing = new Set(directories);
  return { isDirectory: (path): Promise<boolean> => Promise.resolve(existing.has(path)) };
}

const GAME_ROOT = 'C:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive';
const CFG_DIR = `${GAME_ROOT}\\game\\csgo\\cfg`;

describe('validateCs2Path', () => {
  it('accepts a game root with the expected game/csgo/cfg structure', async () => {
    await expect(validateCs2Path(GAME_ROOT, probeOf(GAME_ROOT, CFG_DIR))).resolves.toEqual({
      ok: true,
      paths: { gameRoot: GAME_ROOT, cfgDir: CFG_DIR },
    });
  });

  it('keeps forward slashes for POSIX-style picks', async () => {
    const root = '/games/steam/steamapps/common/Counter-Strike Global Offensive';
    const cfg = `${root}/game/csgo/cfg`;
    await expect(validateCs2Path(root, probeOf(root, cfg))).resolves.toEqual({
      ok: true,
      paths: { gameRoot: root, cfgDir: cfg },
    });
  });

  it('trims trailing separators so the persisted root and derived cfg dir are clean', async () => {
    await expect(validateCs2Path(`${GAME_ROOT}\\\\`, probeOf(GAME_ROOT, CFG_DIR))).resolves.toEqual(
      { ok: true, paths: { gameRoot: GAME_ROOT, cfgDir: CFG_DIR } },
    );
  });

  it('keeps a drive-root pick absolute instead of trimming it drive-relative', async () => {
    // `D:` would be drive-relative on Windows — the separator must survive.
    await expect(validateCs2Path('D:\\', probeOf('D:\\', 'D:\\game\\csgo\\cfg'))).resolves.toEqual({
      ok: true,
      paths: { gameRoot: 'D:\\', cfgDir: 'D:\\game\\csgo\\cfg' },
    });
  });

  it('rejects a path that is not a directory', async () => {
    await expect(validateCs2Path('C:\\nope', probeOf())).resolves.toEqual({
      ok: false,
      reason: 'NOT_A_DIRECTORY',
    });
  });

  it('rejects an empty pick without consulting the probe', async () => {
    let consulted = false;
    const probe: DirectoryProbe = {
      isDirectory: (): Promise<boolean> => {
        consulted = true;
        return Promise.resolve(true);
      },
    };
    await expect(validateCs2Path('', probe)).resolves.toEqual({
      ok: false,
      reason: 'NOT_A_DIRECTORY',
    });
    expect(consulted).toBe(false);
  });

  it('rejects a directory without the CS2 structure (e.g. the Steam library itself)', async () => {
    const library = 'C:\\SteamLibrary';
    await expect(validateCs2Path(library, probeOf(library, GAME_ROOT, CFG_DIR))).resolves.toEqual({
      ok: false,
      reason: 'MISSING_CS2_STRUCTURE',
    });
  });
});
