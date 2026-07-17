import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMapCatalogStore } from '@/stores/map-catalog-store';

import type { TacticsBridge } from '../../../shared/bridge';
import type { CommandResult } from '../../../shared/envelope';
import type { MapProfileDetails, MapSummary } from '../../../shared/map-catalog';
import {
  createProfile,
  deleteProfile,
  loadMapList,
  loadProfile,
  renameProfile,
  replaceProfileImage,
  setDefaultProfile,
  updateCallouts,
} from './map-catalog';

const profileDetails: MapProfileDetails = {
  id: 'profile-1',
  mapId: 'de_dust2',
  name: 'Mine',
  imageUrl: 'tactics-map://de_dust2/profile-1.png',
  callouts: [{ name: 'Long', x: 0.69, y: 0.715 }],
};

const dust2Summary: MapSummary = {
  id: 'de_dust2',
  displayName: 'Dust 2',
  profiles: [{ id: 'profile-1', name: 'Mine', imageUrl: profileDetails.imageUrl }],
  defaultProfileId: 'profile-1',
};

const nukeSummary: MapSummary = { id: 'de_nuke', displayName: 'Nuke', profiles: [] };

const summaries: MapSummary[] = [dust2Summary, nukeSummary];

function installBridge(invoke: ReturnType<typeof vi.fn>): void {
  const bridge = {
    invoke,
    subscribe: (): never => {
      throw new Error('the catalog fetchers never subscribe');
    },
  } as unknown as TacticsBridge;
  Object.defineProperty(window, 'tactics', { value: bridge, configurable: true });
}

beforeEach(() => {
  useMapCatalogStore.setState({ list: undefined, profilesById: {} });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
});

describe('loadMapList', () => {
  it('fetches the list and mirrors it into the catalog store', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: summaries });
    installBridge(invoke);

    await expect(loadMapList()).resolves.toEqual({ ok: true, data: summaries });

    expect(invoke).toHaveBeenCalledWith('maps.list', undefined);
    expect(useMapCatalogStore.getState().list).toEqual(summaries);
  });

  it('returns a failed envelope untouched and writes nothing', async () => {
    const failed: CommandResult<never> = {
      ok: false,
      error: { code: 'INTERNAL', message: 'An unexpected error occurred.' },
    };
    installBridge(vi.fn().mockResolvedValue(failed));

    await expect(loadMapList()).resolves.toEqual(failed);
    expect(useMapCatalogStore.getState().list).toBeUndefined();
  });

  it('answers INTERNAL when the bridge is not exposed — never rejects', async () => {
    const result = await loadMapList();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL');
    }
    expect(useMapCatalogStore.getState().list).toBeUndefined();
  });

  it('converts a rejecting invoke into a failed envelope — never rejects', async () => {
    installBridge(vi.fn().mockRejectedValue(new Error('ipc torn down')));

    const result = await loadMapList();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'INTERNAL', message: 'ipc torn down' });
    }
  });
});

describe('loadProfile', () => {
  it('fetches a profile, caches it, and serves the repeat call without IPC', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: profileDetails });
    installBridge(invoke);

    await expect(loadProfile('de_dust2', 'profile-1')).resolves.toEqual({
      ok: true,
      data: profileDetails,
    });
    expect(invoke).toHaveBeenCalledWith('maps.getProfile', {
      mapId: 'de_dust2',
      profileId: 'profile-1',
    });
    expect(useMapCatalogStore.getState().profilesById).toEqual({ 'profile-1': profileDetails });

    await expect(loadProfile('de_dust2', 'profile-1')).resolves.toEqual({
      ok: true,
      data: profileDetails,
    });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('always invokes for default resolution — the default can change', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: profileDetails });
    installBridge(invoke);

    await loadProfile('de_dust2');
    await loadProfile('de_dust2');

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures — a retry invokes again', async () => {
    const notFound: CommandResult<never> = {
      ok: false,
      error: { code: 'PROFILE_NOT_FOUND', message: 'Map "de_dust2" has no profiles yet.' },
    };
    const invoke = vi.fn().mockResolvedValue(notFound);
    installBridge(invoke);

    await expect(loadProfile('de_dust2', 'missing')).resolves.toEqual(notFound);
    await expect(loadProfile('de_dust2', 'missing')).resolves.toEqual(notFound);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(useMapCatalogStore.getState().profilesById).toEqual({});
  });
});

describe('mutation commands refresh the store from their responses (ADR-033)', () => {
  beforeEach(() => {
    useMapCatalogStore.setState({ list: summaries, profilesById: {} });
  });

  it('createProfile applies the map summary and caches the profile', async () => {
    const invoke = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        status: 'created',
        map: { ...dust2Summary, displayName: 'Dust 2*' },
        profile: profileDetails,
      },
    });
    installBridge(invoke);

    const result = await createProfile('de_dust2', 'Mine', { kind: 'upload' });

    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('maps.createProfile', {
      mapId: 'de_dust2',
      name: 'Mine',
      source: { kind: 'upload' },
    });
    const state = useMapCatalogStore.getState();
    expect(state.list?.[0]?.displayName).toBe('Dust 2*');
    expect(state.list?.[1]).toEqual(nukeSummary);
    expect(state.profilesById['profile-1']).toEqual(profileDetails);
  });

  it('createProfile leaves the store untouched on cancel', async () => {
    installBridge(vi.fn().mockResolvedValue({ ok: true, data: { status: 'canceled' } }));

    await createProfile('de_dust2', 'Mine', { kind: 'upload' });

    const state = useMapCatalogStore.getState();
    expect(state.list).toEqual(summaries);
    expect(state.profilesById).toEqual({});
  });

  it('replaceProfileImage applies map and profile on success', async () => {
    const invoke = vi.fn().mockResolvedValue({
      ok: true,
      data: { status: 'replaced', map: dust2Summary, profile: profileDetails },
    });
    installBridge(invoke);

    await replaceProfileImage('de_dust2', 'profile-1');

    expect(invoke).toHaveBeenCalledWith('maps.replaceProfileImage', {
      mapId: 'de_dust2',
      profileId: 'profile-1',
    });
    expect(useMapCatalogStore.getState().profilesById['profile-1']).toEqual(profileDetails);
  });

  it('setDefaultProfile applies the returned map summary', async () => {
    const updated: MapSummary = { ...dust2Summary, defaultProfileId: 'profile-2' };
    installBridge(vi.fn().mockResolvedValue({ ok: true, data: updated }));

    await setDefaultProfile('de_dust2', 'profile-2');

    expect(useMapCatalogStore.getState().list?.[0]).toEqual(updated);
  });

  it('renameProfile applies map summary and profile details', async () => {
    const renamed = { ...profileDetails, name: 'Renamed' };
    installBridge(
      vi.fn().mockResolvedValue({ ok: true, data: { map: dust2Summary, profile: renamed } }),
    );

    await renameProfile('de_dust2', 'profile-1', 'Renamed');

    expect(useMapCatalogStore.getState().profilesById['profile-1']).toEqual(renamed);
  });

  it('deleteProfile applies the map summary and evicts the cached profile', async () => {
    useMapCatalogStore.setState({
      list: summaries,
      profilesById: { 'profile-1': profileDetails },
    });
    const emptied: MapSummary = { id: 'de_dust2', displayName: 'Dust 2', profiles: [] };
    installBridge(vi.fn().mockResolvedValue({ ok: true, data: emptied }));

    await deleteProfile('de_dust2', 'profile-1');

    const state = useMapCatalogStore.getState();
    expect(state.list?.[0]).toEqual(emptied);
    expect(state.profilesById).toEqual({});
  });

  it('updateCallouts caches the returned profile details', async () => {
    const edited = { ...profileDetails, callouts: [{ name: 'Car', x: 0.1, y: 0.2 }] };
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: edited });
    installBridge(invoke);

    await updateCallouts('de_dust2', 'profile-1', edited.callouts);

    expect(invoke).toHaveBeenCalledWith('maps.updateCallouts', {
      mapId: 'de_dust2',
      profileId: 'profile-1',
      callouts: edited.callouts,
    });
    expect(useMapCatalogStore.getState().profilesById['profile-1']).toEqual(edited);
  });

  it('leaves the store untouched when a mutation fails', async () => {
    installBridge(
      vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'PROFILE_NOT_FOUND', message: 'gone' },
      }),
    );

    await setDefaultProfile('de_dust2', 'missing');

    expect(useMapCatalogStore.getState().list).toEqual(summaries);
  });

  it('applies mutation responses even before the list was ever loaded', async () => {
    useMapCatalogStore.setState({ list: undefined, profilesById: {} });
    installBridge(vi.fn().mockResolvedValue({ ok: true, data: dust2Summary }));

    const result = await setDefaultProfile('de_dust2', 'profile-1');

    expect(result.ok).toBe(true);
    // No list to patch — the summary is not invented into a partial list.
    expect(useMapCatalogStore.getState().list).toBeUndefined();
  });
});
