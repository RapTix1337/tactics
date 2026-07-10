import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Logger } from '../../../shared';
import type { MapIndex, MapSummary } from '../core/map-index';
import { buildMapIndex } from '../core/map-index';
import type { MapData } from '../core/map-schema';
import { parseMapJson } from '../core/map-schema';

/**
 * The maps module surface (03-technical-design.md §4.3, E11.2, reworked for
 * ADR-045 in E12.2): reads `data/maps/` — one folder per map holding a
 * single `map.json` (catalog entry + default callout layout; conventions:
 * data/maps/README.md). No image reads: the app ships no map imagery. An
 * invalid map is logged and skipped, never fatal (MAP-02/06). The
 * composition root hands in the resolved data directory; the module knows
 * no Electron.
 */

export interface MapRegistryOptions {
  /** Absolute path to the bundled `data/maps/` directory. */
  readonly dataDirectory: string;
  readonly logger: Logger;
}

export interface MapRegistry {
  /**
   * Scans the data directory and replaces the registry state. Skips are
   * logged per map; a missing data directory yields an empty registry with
   * a warning (packaging problem, but never fatal).
   */
  loadAll(): Promise<void>;
  listMaps(): readonly MapSummary[];
  getMap(mapId: string): MapData | undefined;
  /** Exact match against every map's `gsiNames`; `undefined` = unknown map. */
  resolveGsiMapName(rawName: string): string | undefined;
}

const MAP_JSON_FILE_NAME = 'map.json';

export function createMapRegistry(options: MapRegistryOptions): MapRegistry {
  const { dataDirectory, logger } = options;
  let index: MapIndex = buildMapIndex([]);

  return {
    loadAll: async (): Promise<void> => {
      index = buildMapIndex(await loadMaps(dataDirectory, logger));
      for (const conflict of index.conflicts) {
        logger.warn('duplicate GSI map name in map data ignored', { ...conflict });
      }
    },
    listMaps: () => index.summaries,
    getMap: (mapId) => index.getMap(mapId),
    resolveGsiMapName: (rawName) => index.resolveGsiMapName(rawName),
  };
}

async function loadMaps(dataDirectory: string, logger: Logger): Promise<MapData[]> {
  let folders: string[];
  try {
    const entries = await readdir(dataDirectory, { withFileTypes: true });
    // Plain files (e.g. the data README) are not map folders — ignore them.
    // Sorted for a deterministic load order, which decides GSI name conflicts.
    folders = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    logger.warn('map data directory is missing or unreadable', { dataDirectory });
    return [];
  }

  const maps: MapData[] = [];
  for (const folder of folders) {
    const result = await loadMapFolder(join(dataDirectory, folder), folder);
    if (result.ok) {
      maps.push(result.map);
    } else {
      logger.warn('invalid map skipped', { folder, file: result.file, issues: result.issues });
    }
  }
  return maps;
}

type MapFolderResult =
  | { readonly ok: true; readonly map: MapData }
  | {
      readonly ok: false;
      /** The file the problem was found in, relative to the map folder. */
      readonly file: string;
      readonly issues: readonly string[];
    };

async function loadMapFolder(folderPath: string, folderName: string): Promise<MapFolderResult> {
  let rawJson: string;
  try {
    rawJson = await readFile(join(folderPath, MAP_JSON_FILE_NAME), 'utf8');
  } catch {
    return skip(MAP_JSON_FILE_NAME, ['file is missing or unreadable']);
  }

  const parsed = parseMapJson(rawJson);
  if (!parsed.ok) {
    return skip(MAP_JSON_FILE_NAME, parsed.error.issues);
  }

  if (parsed.map.id !== folderName) {
    return skip(MAP_JSON_FILE_NAME, [
      `id: "${parsed.map.id}" does not match the folder name "${folderName}"`,
    ]);
  }

  return { ok: true, map: parsed.map };
}

function skip(file: string, issues: readonly string[]): MapFolderResult {
  return { ok: false, file, issues };
}
