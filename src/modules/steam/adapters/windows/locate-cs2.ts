import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Logger } from '../../../../shared';
import { parseAppManifest } from '../../core/app-manifest';
import { type Cs2Paths, deriveCs2Paths } from '../../core/cs2-paths';
import { parseLibraryFolders } from '../../core/library-folders';
import { readSteamPathFromRegistry, type RegistryReader } from './steam-registry';

/**
 * The full CS2 detection chain (GSI-01): registry → Steam path →
 * `libraryfolders.vdf` → all libraries → `appmanifest_730.acf`. The first
 * installation found is used (GSI-10). Every failure stage yields its own
 * named reason so the setup UI can explain *why* detection failed; a broken
 * manifest in one library never hides a healthy installation in another
 * (risk T4 tolerance). Detection steps are logged at `debug`; contexts
 * carry paths and fixed parser phrases only — never SteamIDs (ADR-030).
 */

export type LocateCs2FailureReason =
  | 'STEAM_NOT_FOUND'
  | 'LIBRARY_FOLDERS_UNREADABLE'
  | 'LIBRARY_FOLDERS_INVALID'
  | 'MANIFEST_INVALID'
  | 'CS2_NOT_INSTALLED';

export type LocateCs2Result =
  | { readonly ok: true; readonly paths: Cs2Paths }
  | { readonly ok: false; readonly reason: LocateCs2FailureReason };

const CS2_MANIFEST_FILE_NAME = 'appmanifest_730.acf';

/** Runs the detection chain; returns the CS2 paths or a named not-found reason. */
export async function locateCs2Installation(
  registry: RegistryReader,
  logger: Logger,
): Promise<LocateCs2Result> {
  const steamPath = await readSteamPathFromRegistry(registry);
  if (steamPath === undefined) {
    logger.debug('Steam path not found in registry');
    return failure('STEAM_NOT_FOUND');
  }
  logger.debug('Steam path found in registry', { steamPath });

  const vdfPath = join(steamPath, 'steamapps', 'libraryfolders.vdf');
  let vdfContent: string;
  try {
    vdfContent = await readFile(vdfPath, 'utf8');
  } catch {
    logger.debug('libraryfolders.vdf not readable', { vdfPath });
    return failure('LIBRARY_FOLDERS_UNREADABLE');
  }

  const parsed = parseLibraryFolders(vdfContent);
  if (!parsed.ok) {
    logger.debug('libraryfolders.vdf did not parse', {
      code: parsed.error.code,
      issues: parsed.error.issues.join('; '),
    });
    return failure('LIBRARY_FOLDERS_INVALID');
  }

  // The legacy layout lists only *additional* libraries, so the Steam dir
  // itself is always a candidate; the modern layout lists it as entry 0,
  // hence the dedupe.
  const libraries = dedupeLibraries([steamPath, ...parsed.libraryPaths]);
  logger.debug('Steam libraries resolved', { count: libraries.length });

  let sawInvalidManifest = false;
  for (const library of libraries) {
    const manifestPath = join(library, 'steamapps', CS2_MANIFEST_FILE_NAME);
    let manifestContent: string;
    try {
      manifestContent = await readFile(manifestPath, 'utf8');
    } catch {
      continue; // no CS2 here (or the drive is gone) — try the next library
    }

    const manifest = parseAppManifest(manifestContent);
    if (!manifest.ok) {
      sawInvalidManifest = true;
      logger.debug('CS2 manifest did not parse', { manifestPath, code: manifest.error.code });
      continue;
    }

    const paths = deriveCs2Paths(library, manifest.installDir);
    logger.debug('CS2 installation found', { gameRoot: paths.gameRoot });
    return { ok: true, paths };
  }

  const reason = sawInvalidManifest ? 'MANIFEST_INVALID' : 'CS2_NOT_INSTALLED';
  logger.debug('CS2 not found in any library', { reason });
  return failure(reason);
}

/** Case- and separator-insensitive dedupe, preserving first-seen order. */
function dedupeLibraries(paths: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of paths) {
    const key = path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(path);
    }
  }
  return unique;
}

function failure(reason: LocateCs2FailureReason): LocateCs2Result {
  return { ok: false, reason };
}
