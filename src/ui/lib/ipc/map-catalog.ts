import { useMapCatalogStore } from '@/stores/map-catalog-store';

import type { TacticsBridge } from '../../../shared/bridge';
import type { CommandResult } from '../../../shared/envelope';
import { success } from '../../../shared/envelope';
import type {
  CatalogCallout,
  CreateProfileSource,
  MapProfileDetails,
  MapSummary,
} from '../../../shared/map-catalog';
import { invokeCommand } from './invoke';

/**
 * The command-fed side of the renderer IPC layer (ADR-033, E22.3): the map
 * catalog is the one store filled by commands, not events. Every function
 * returns the command envelope so callers can render named errors, never
 * rejects (the bootstrap precedent), and mirrors only successes into the
 * store — the store is written exclusively here.
 */

type CreateProfileResult =
  | { readonly status: 'created'; readonly map: MapSummary; readonly profile: MapProfileDetails }
  | { readonly status: 'canceled' };

type ReplaceProfileImageResult =
  | { readonly status: 'replaced'; readonly map: MapSummary; readonly profile: MapProfileDetails }
  | { readonly status: 'canceled' };

/**
 * Fetches the map list via `maps.list` and mirrors it into the catalog
 * store. Always invokes: the list is cheap and a repeat call doubles as the
 * caller's retry path.
 */
export async function loadMapList(): Promise<CommandResult<readonly MapSummary[]>> {
  return invokeAndMirror(
    (bridge) => bridge.invoke('maps.list', undefined),
    (list) => {
      useMapCatalogStore.setState({ list });
    },
  );
}

/**
 * Returns one profile's details, from the session cache when the caller
 * names a profile id, via `maps.getProfile` otherwise. Default resolution
 * (omitted `profileId`) always invokes — the default can change between
 * calls. Only successes are cached; a failed fetch stays retryable.
 */
export async function loadProfile(
  mapId: string,
  profileId?: string,
): Promise<CommandResult<MapProfileDetails>> {
  if (profileId !== undefined) {
    const cached = useMapCatalogStore.getState().profilesById[profileId];
    if (cached !== undefined) {
      return success(cached);
    }
  }
  return invokeAndMirror(
    (bridge) => bridge.invoke('maps.getProfile', { mapId, profileId }),
    cacheProfile,
  );
}

/** Creates a profile (upload dialog in main, or fork) via `maps.createProfile`. */
export async function createProfile(
  mapId: string,
  name: string,
  source: CreateProfileSource,
): Promise<CommandResult<CreateProfileResult>> {
  return invokeAndMirror(
    (bridge) => bridge.invoke('maps.createProfile', { mapId, name, source }),
    (result) => {
      if (result.status === 'created') {
        applyMapSummary(result.map);
        cacheProfile(result.profile);
      }
    },
  );
}

/** Replaces one profile's image (dialog in main) via `maps.replaceProfileImage`. */
export async function replaceProfileImage(
  mapId: string,
  profileId: string,
): Promise<CommandResult<ReplaceProfileImageResult>> {
  return invokeAndMirror(
    (bridge) => bridge.invoke('maps.replaceProfileImage', { mapId, profileId }),
    (result) => {
      if (result.status === 'replaced') {
        applyMapSummary(result.map);
        cacheProfile(result.profile);
      }
    },
  );
}

/** Marks the map's explicit default profile via `maps.setDefaultProfile`. */
export async function setDefaultProfile(
  mapId: string,
  profileId: string,
): Promise<CommandResult<MapSummary>> {
  return invokeAndMirror(
    (bridge) => bridge.invoke('maps.setDefaultProfile', { mapId, profileId }),
    applyMapSummary,
  );
}

/** Renames one profile via `maps.renameProfile`. */
export async function renameProfile(
  mapId: string,
  profileId: string,
  name: string,
): Promise<CommandResult<{ map: MapSummary; profile: MapProfileDetails }>> {
  return invokeAndMirror(
    (bridge) => bridge.invoke('maps.renameProfile', { mapId, profileId, name }),
    (result) => {
      applyMapSummary(result.map);
      cacheProfile(result.profile);
    },
  );
}

/** Deletes one profile (rows + image file) via `maps.deleteProfile`. */
export async function deleteProfile(
  mapId: string,
  profileId: string,
): Promise<CommandResult<MapSummary>> {
  return invokeAndMirror(
    (bridge) => bridge.invoke('maps.deleteProfile', { mapId, profileId }),
    (map) => {
      applyMapSummary(map);
      evictProfile(profileId);
    },
  );
}

/** Replaces one profile's callout set via `maps.updateCallouts`. */
export async function updateCallouts(
  mapId: string,
  profileId: string,
  callouts: readonly CatalogCallout[],
): Promise<CommandResult<MapProfileDetails>> {
  return invokeAndMirror(
    (bridge) => bridge.invoke('maps.updateCallouts', { mapId, profileId, callouts: [...callouts] }),
    cacheProfile,
  );
}

/**
 * The catalog's invoke wrapper: the shared skeleton (invoke.ts) plus store
 * mirroring on success only — the store is written exclusively here.
 */
async function invokeAndMirror<TData>(
  invoke: (bridge: TacticsBridge) => Promise<CommandResult<TData>>,
  mirror: (data: TData) => void,
): Promise<CommandResult<TData>> {
  const result = await invokeCommand(invoke);
  if (result.ok) {
    mirror(result.data);
  }
  return result;
}

function applyMapSummary(map: MapSummary): void {
  useMapCatalogStore.setState((state) =>
    state.list === undefined
      ? state
      : { list: state.list.map((entry) => (entry.id === map.id ? map : entry)) },
  );
}

function cacheProfile(profile: MapProfileDetails): void {
  useMapCatalogStore.setState((state) => ({
    profilesById: { ...state.profilesById, [profile.id]: profile },
  }));
}

function evictProfile(profileId: string): void {
  useMapCatalogStore.setState((state) => {
    if (!(profileId in state.profilesById)) {
      return state;
    }
    const remaining = { ...state.profilesById };
    delete remaining[profileId];
    return { profilesById: remaining };
  });
}
