import { create } from 'zustand';

import type { MapProfileDetails, MapSummary } from '../../shared/map-catalog';

/**
 * Catalog store for the maps domain (ADR-033, 03-technical-design.md §6):
 * the one store fed by commands instead of events — `maps.list` /
 * `maps.getProfile` fill it, mutation-command responses refresh it (E22.3).
 * Written ONLY by the renderer IPC layer (src/ui/lib/ipc/map-catalog.ts);
 * components read via selectors. `list` is `undefined` until the first
 * successful `maps.list`; `profilesById` caches profile details by profile
 * id for the session, kept current by the mutation responses.
 */
interface MapCatalogState {
  readonly list: readonly MapSummary[] | undefined;
  readonly profilesById: Readonly<Record<string, MapProfileDetails>>;
}

export const useMapCatalogStore = create<MapCatalogState>(() => ({
  list: undefined,
  profilesById: {},
}));
