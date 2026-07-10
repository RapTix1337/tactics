import type { MapData } from './map-schema';

/**
 * Pure registry logic for the maps module (E11.2, reworked for ADR-045 in
 * E12.2): given the catalog entries the fs adapter loaded, build the lookup
 * structures behind `listMaps()`, `getMap(mapId)`, and
 * `resolveGsiMapName(raw)` (03-technical-design.md §4.3). Loading,
 * validation, and skip logging live in `adapters/fs-map-registry.ts`.
 */

/** Sidebar-sized view of a catalog entry (contract §5.3 feeds from this). */
export interface MapSummary {
  readonly id: string;
  readonly displayName: string;
}

/**
 * Two maps claimed the same GSI name. The earlier map (load order) keeps the
 * name; the adapter logs the conflict as a data problem.
 */
export interface GsiNameConflict {
  readonly gsiName: string;
  readonly keptMapId: string;
  readonly ignoredMapId: string;
}

export interface MapIndex {
  readonly summaries: readonly MapSummary[];
  readonly conflicts: readonly GsiNameConflict[];
  getMap(mapId: string): MapData | undefined;
  /** Exact match against every map's `gsiNames`; `undefined` = unknown map. */
  resolveGsiMapName(rawName: string): string | undefined;
}

/**
 * Builds the index in the given order. Map ids are unique by construction:
 * the loader derives them from folder names and enforces `id` = folder.
 */
export function buildMapIndex(maps: readonly MapData[]): MapIndex {
  const byMapId = new Map<string, MapData>();
  const mapIdByGsiName = new Map<string, string>();
  const conflicts: GsiNameConflict[] = [];

  for (const map of maps) {
    byMapId.set(map.id, map);
    for (const gsiName of map.gsiNames) {
      const keptMapId = mapIdByGsiName.get(gsiName);
      if (keptMapId === undefined) {
        mapIdByGsiName.set(gsiName, map.id);
      } else {
        conflicts.push({ gsiName, keptMapId, ignoredMapId: map.id });
      }
    }
  }

  return {
    summaries: maps.map((map) => ({ id: map.id, displayName: map.displayName })),
    conflicts,
    getMap: (mapId) => byMapId.get(mapId),
    resolveGsiMapName: (rawName) => mapIdByGsiName.get(rawName),
  };
}
