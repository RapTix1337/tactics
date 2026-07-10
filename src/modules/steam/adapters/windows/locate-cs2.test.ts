import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { Logger } from '../../../../shared';
import { locateCs2Installation } from './locate-cs2';
import type { RegistryReader } from './steam-registry';

const INSTALL_DIR = 'Counter-Strike Global Offensive';

describe('locateCs2Installation', () => {
  let root: string;
  let debug: Mock<Logger['debug']>;
  let logger: Logger;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tactics-steam-detect-'));
    debug = vi.fn<Logger['debug']>();
    logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const registryPointingTo = (steamPath: string | undefined): RegistryReader => ({
    readValue: (keyPath) => Promise.resolve(keyPath.startsWith('HKCU') ? steamPath : undefined),
  });

  /** Creates `<root>/<name>` as a library root with an empty steamapps dir. */
  function makeLibrary(name: string): string {
    const library = join(root, name);
    mkdirSync(join(library, 'steamapps'), { recursive: true });
    return library;
  }

  /** Modern layout: numeric key → block with a `path` value (KeyValues-escaped). */
  function writeLibraryFolders(steamDir: string, libraryPaths: readonly string[]): void {
    const entries = libraryPaths
      .map((path, index) => {
        const escaped = path.replaceAll('\\', '\\\\');
        return `\t"${String(index)}"\n\t{\n\t\t"path"\t\t"${escaped}"\n\t}\n`;
      })
      .join('');
    writeFileSync(
      join(steamDir, 'steamapps', 'libraryfolders.vdf'),
      `"libraryfolders"\n{\n${entries}}\n`,
      'utf8',
    );
  }

  function writeCs2Manifest(library: string, installDir: string = INSTALL_DIR): void {
    writeFileSync(
      join(library, 'steamapps', 'appmanifest_730.acf'),
      `"AppState"\n{\n\t"appid"\t\t"730"\n\t"installdir"\t\t"${installDir}"\n}\n`,
      'utf8',
    );
  }

  it('finds CS2 in a second library of a multi-library setup (GSI-01)', async () => {
    const steamDir = makeLibrary('steam');
    const gamesLibrary = makeLibrary('games');
    writeLibraryFolders(steamDir, [steamDir, gamesLibrary]);
    writeCs2Manifest(gamesLibrary);

    const result = await locateCs2Installation(registryPointingTo(steamDir), logger);

    expect(result).toEqual({
      ok: true,
      paths: {
        gameRoot: join(gamesLibrary, 'steamapps', 'common', INSTALL_DIR),
        cfgDir: join(gamesLibrary, 'steamapps', 'common', INSTALL_DIR, 'game', 'csgo', 'cfg'),
      },
    });
  });

  it('finds CS2 in the Steam dir itself when the legacy layout omits it', async () => {
    const steamDir = makeLibrary('steam');
    const otherLibrary = makeLibrary('other');
    // Legacy layout lists only *additional* libraries.
    writeFileSync(
      join(steamDir, 'steamapps', 'libraryfolders.vdf'),
      `"LibraryFolders"\n{\n\t"1"\t\t"${otherLibrary.replaceAll('\\', '\\\\')}"\n}\n`,
      'utf8',
    );
    writeCs2Manifest(steamDir);

    const result = await locateCs2Installation(registryPointingTo(steamDir), logger);

    expect(result.ok).toBe(true);
  });

  it('uses the first installation found when two libraries have CS2 (GSI-10)', async () => {
    const steamDir = makeLibrary('steam');
    const secondLibrary = makeLibrary('second');
    writeLibraryFolders(steamDir, [steamDir, secondLibrary]);
    writeCs2Manifest(steamDir);
    writeCs2Manifest(secondLibrary);

    const result = await locateCs2Installation(registryPointingTo(steamDir), logger);

    expect(result.ok && result.paths.gameRoot).toBe(
      join(steamDir, 'steamapps', 'common', INSTALL_DIR),
    );
  });

  it('skips a library whose path no longer exists (disconnected drive)', async () => {
    const steamDir = makeLibrary('steam');
    writeLibraryFolders(steamDir, [join(root, 'gone-drive'), steamDir]);
    writeCs2Manifest(steamDir);

    const result = await locateCs2Installation(registryPointingTo(steamDir), logger);

    expect(result.ok).toBe(true);
  });

  it('queries duplicate library entries only once (casing and trailing separator)', async () => {
    const steamDir = makeLibrary('steam');
    writeLibraryFolders(steamDir, [`${steamDir.toUpperCase()}\\`]);
    writeCs2Manifest(steamDir);

    await locateCs2Installation(registryPointingTo(steamDir), logger);

    expect(debug).toHaveBeenCalledWith('Steam libraries resolved', { count: 1 });
  });

  it('returns STEAM_NOT_FOUND when the registry has no Steam path', async () => {
    const result = await locateCs2Installation(registryPointingTo(undefined), logger);

    expect(result).toEqual({ ok: false, reason: 'STEAM_NOT_FOUND' });
  });

  it('returns LIBRARY_FOLDERS_UNREADABLE when libraryfolders.vdf is missing', async () => {
    const steamDir = makeLibrary('steam');

    const result = await locateCs2Installation(registryPointingTo(steamDir), logger);

    expect(result).toEqual({ ok: false, reason: 'LIBRARY_FOLDERS_UNREADABLE' });
  });

  it('returns LIBRARY_FOLDERS_INVALID when libraryfolders.vdf does not parse', async () => {
    const steamDir = makeLibrary('steam');
    writeFileSync(join(steamDir, 'steamapps', 'libraryfolders.vdf'), 'not keyvalues {', 'utf8');

    const result = await locateCs2Installation(registryPointingTo(steamDir), logger);

    expect(result).toEqual({ ok: false, reason: 'LIBRARY_FOLDERS_INVALID' });
  });

  it('returns MANIFEST_INVALID when the only manifest found is broken', async () => {
    const steamDir = makeLibrary('steam');
    writeLibraryFolders(steamDir, [steamDir]);
    writeFileSync(
      join(steamDir, 'steamapps', 'appmanifest_730.acf'),
      '"AppState"\n{\n\t"appid"\t\t"730"\n}\n', // no installdir
      'utf8',
    );

    const result = await locateCs2Installation(registryPointingTo(steamDir), logger);

    expect(result).toEqual({ ok: false, reason: 'MANIFEST_INVALID' });
  });

  it('a broken manifest in one library does not hide CS2 in another (risk T4)', async () => {
    const steamDir = makeLibrary('steam');
    const healthyLibrary = makeLibrary('healthy');
    writeLibraryFolders(steamDir, [steamDir, healthyLibrary]);
    writeFileSync(join(steamDir, 'steamapps', 'appmanifest_730.acf'), 'garbage {', 'utf8');
    writeCs2Manifest(healthyLibrary);

    const result = await locateCs2Installation(registryPointingTo(steamDir), logger);

    expect(result.ok && result.paths.gameRoot).toBe(
      join(healthyLibrary, 'steamapps', 'common', INSTALL_DIR),
    );
  });

  it('returns CS2_NOT_INSTALLED when no library has a manifest', async () => {
    const steamDir = makeLibrary('steam');
    const emptyLibrary = makeLibrary('empty');
    writeLibraryFolders(steamDir, [steamDir, emptyLibrary]);

    const result = await locateCs2Installation(registryPointingTo(steamDir), logger);

    expect(result).toEqual({ ok: false, reason: 'CS2_NOT_INSTALLED' });
  });

  it('tolerates a registry Steam path with forward slashes', async () => {
    const steamDir = makeLibrary('steam');
    writeLibraryFolders(steamDir, [steamDir]);
    writeCs2Manifest(steamDir);

    const result = await locateCs2Installation(
      registryPointingTo(steamDir.replaceAll('\\', '/')),
      logger,
    );

    expect(result.ok).toBe(true);
  });

  it('logs the detection steps at debug (E9.2 acceptance)', async () => {
    const steamDir = makeLibrary('steam');
    writeLibraryFolders(steamDir, [steamDir]);
    writeCs2Manifest(steamDir);

    await locateCs2Installation(registryPointingTo(steamDir), logger);

    expect(debug).toHaveBeenCalledWith('Steam path found in registry', {
      steamPath: steamDir,
    });
    expect(debug).toHaveBeenCalledWith('CS2 installation found', {
      gameRoot: join(steamDir, 'steamapps', 'common', INSTALL_DIR),
    });
  });
});
