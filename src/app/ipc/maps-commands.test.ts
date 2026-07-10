import { describe, expect, it, vi } from 'vitest';

import type {
  Callout,
  MapData,
  MapProfile,
  ProfileImageStore,
  ProfileRepository,
} from '../../modules/maps';
import { profileImageFileName } from '../../modules/maps';
import type { Logger } from '../../shared';
import {
  mapsCreateProfile,
  mapsDeleteProfile,
  mapsGetProfile,
  mapsList,
  mapsRenameProfile,
  mapsReplaceProfileImage,
  mapsSetDefaultProfile,
  mapsUpdateCallouts,
} from '../../shared';
import type { AnyCommandDefinition } from '../../shared/contract';
import type { MapsCommandDeps } from './maps-commands';
import { registerMapsCommands } from './maps-commands';
import type { CommandRegistrationDeps } from './register-command';

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

interface FakeEvent {
  trusted: boolean;
}

type RegisteredListener = (event: FakeEvent, request: unknown) => Promise<unknown>;

const dust2: MapData = {
  id: 'de_dust2',
  displayName: 'Dust 2',
  gsiNames: ['de_dust2'],
  callouts: [{ name: 'Long', x: 0.69, y: 0.715 }],
};

const nuke: MapData = {
  id: 'de_nuke',
  displayName: 'Nuke',
  gsiNames: ['de_nuke'],
  callouts: [
    { name: 'Ramp', x: 0.3, y: 0.4 },
    { name: 'Outside', x: 0.2, y: 0.5 },
  ],
};

/**
 * In-memory stand-in for the profile repository (E22.1 semantics: unknown
 * ids are regular `undefined`/`false` results, deterministic ids and
 * creation order). The real repository is covered by its own tests and the
 * integration test — this fake keeps the command flows fast and explicit.
 */
function createFakeProfiles(): ProfileRepository {
  let counter = 0;
  const rows = new Map<string, { profile: MapProfile; callouts: readonly Callout[] }>();
  const defaults = new Map<string, string>();

  const listOf = (mapId: string): MapProfile[] =>
    [...rows.values()]
      .map((row) => row.profile)
      .filter((profile) => profile.mapId === mapId)
      .sort((a, b) => a.createdAt - b.createdAt);

  const resolveDefault = (mapId: string): string | undefined => {
    const marked = defaults.get(mapId);
    if (marked !== undefined && rows.has(marked)) {
      return marked;
    }
    return listOf(mapId)[0]?.id;
  };

  return {
    listProfiles: (mapId) => ({
      profiles: listOf(mapId),
      defaultProfileId: resolveDefault(mapId),
    }),
    getProfile: (profileId) => rows.get(profileId),
    createProfile: (request) => {
      counter += 1;
      const profile: MapProfile = {
        id: `id-${String(counter)}`,
        mapId: request.mapId,
        name: request.name,
        imageFileName: profileImageFileName(`id-${String(counter)}`, request.imageFileExtension),
        createdAt: counter * 1000,
      };
      const created = { profile, callouts: request.defaultLayout.map((c) => ({ ...c })) };
      rows.set(profile.id, created);
      return created;
    },
    forkProfile: (sourceProfileId, request) => {
      const source = rows.get(sourceProfileId);
      if (source === undefined) {
        return undefined;
      }
      counter += 1;
      const profile: MapProfile = {
        id: `id-${String(counter)}`,
        mapId: source.profile.mapId,
        name: request.name,
        imageFileName: profileImageFileName(`id-${String(counter)}`, request.imageFileExtension),
        createdAt: counter * 1000,
      };
      const forked = { profile, callouts: source.callouts.map((c) => ({ ...c })) };
      rows.set(profile.id, forked);
      return forked;
    },
    renameProfile: (profileId, name) => {
      const row = rows.get(profileId);
      if (row === undefined) {
        return undefined;
      }
      const renamed = { ...row.profile, name };
      rows.set(profileId, { ...row, profile: renamed });
      return renamed;
    },
    replaceImage: (profileId, imageFileExtension) => {
      const row = rows.get(profileId);
      if (row === undefined) {
        return undefined;
      }
      const imageFileName = profileImageFileName(profileId, imageFileExtension);
      const previousImageFileName = row.profile.imageFileName;
      const profile = { ...row.profile, imageFileName };
      rows.set(profileId, { ...row, profile });
      return { profile, previousImageFileName };
    },
    deleteProfile: (profileId) => {
      const row = rows.get(profileId);
      if (row === undefined) {
        return undefined;
      }
      rows.delete(profileId);
      if (defaults.get(row.profile.mapId) === profileId) {
        defaults.delete(row.profile.mapId);
      }
      return {
        mapId: row.profile.mapId,
        imageFileName: row.profile.imageFileName,
        defaultProfileId: resolveDefault(row.profile.mapId),
      };
    },
    setDefaultProfile: (mapId, profileId) => {
      const row = rows.get(profileId);
      if (row === undefined || row.profile.mapId !== mapId) {
        return false;
      }
      defaults.set(mapId, profileId);
      return true;
    },
    updateCallouts: (profileId, callouts) => {
      const row = rows.get(profileId);
      if (row === undefined) {
        return undefined;
      }
      // The command boundary validated the set; the fake trusts it like the
      // real repository would after its own parse.
      const parsed = callouts as readonly Callout[];
      const updated = { ...row, callouts: parsed.map((c) => ({ ...c })) };
      rows.set(profileId, updated);
      return updated;
    },
  };
}

const PNG_IMAGE = { extension: 'png', bytes: new Uint8Array([1]) } as const;
const SVG_IMAGE = { extension: 'svg', bytes: new Uint8Array([2]) } as const;

interface Harness {
  invoke: (
    definition: AnyCommandDefinition,
    request: unknown,
    trusted?: boolean,
  ) => Promise<unknown>;
  profiles: ProfileRepository;
  images: {
    loadImage: ReturnType<typeof vi.fn<ProfileImageStore['loadImage']>>;
    saveImage: ReturnType<typeof vi.fn<ProfileImageStore['saveImage']>>;
    copyImage: ReturnType<typeof vi.fn<ProfileImageStore['copyImage']>>;
    deleteImage: ReturnType<typeof vi.fn<ProfileImageStore['deleteImage']>>;
  };
  showImageOpenDialog: ReturnType<typeof vi.fn<() => Promise<string | undefined>>>;
}

function setup(
  maps: readonly MapData[] = [dust2, nuke],
  overrides: Partial<MapsCommandDeps> = {},
): Harness {
  const handlers = new Map<string, RegisteredListener>();
  const deps: CommandRegistrationDeps<FakeEvent> = {
    registerHandler: (channel, listener): void => {
      handlers.set(channel, listener);
    },
    isTrustedSender: (event): boolean => event.trusted,
    logger: silentLogger,
  };

  // The registry is consulted only after the startup scan finished — the
  // guard turns a skipped await into a loud INTERNAL instead of a silently
  // empty catalog.
  let loaded = false;
  const mapsLoaded = Promise.resolve().then(() => {
    loaded = true;
  });
  const requireLoaded = <T>(value: T): T => {
    if (!loaded) {
      throw new Error('registry consulted before the startup scan finished');
    }
    return value;
  };

  const profiles = createFakeProfiles();
  const images = {
    loadImage: vi.fn<ProfileImageStore['loadImage']>().mockResolvedValue({
      ok: true,
      image: PNG_IMAGE,
    }),
    saveImage: vi.fn<ProfileImageStore['saveImage']>().mockResolvedValue(undefined),
    copyImage: vi.fn<ProfileImageStore['copyImage']>().mockResolvedValue(true),
    deleteImage: vi.fn<ProfileImageStore['deleteImage']>().mockResolvedValue(undefined),
  };
  const showImageOpenDialog = vi
    .fn<() => Promise<string | undefined>>()
    .mockResolvedValue('C:/picked/radar.png');

  registerMapsCommands(deps, {
    mapsLoaded,
    listMaps: () => requireLoaded(maps.map(({ id, displayName }) => ({ id, displayName }))),
    getMap: (mapId) => requireLoaded(maps.find((map) => map.id === mapId)),
    profiles,
    images,
    showImageOpenDialog,
    ...overrides,
  });

  const invoke = (
    definition: AnyCommandDefinition,
    request: unknown,
    trusted = true,
  ): Promise<unknown> => {
    const listener = handlers.get(definition.channel);
    if (listener === undefined) {
      throw new Error(`${definition.channel} was not registered`);
    }
    return listener({ trusted }, request);
  };

  return { invoke, profiles, images, showImageOpenDialog };
}

/** Creates a profile through the command path (upload flow, PNG). */
async function createProfileVia(harness: Harness, mapId = 'de_dust2', name = 'Default') {
  const result = (await harness.invoke(mapsCreateProfile, {
    mapId,
    name,
    source: { kind: 'upload' },
  })) as { ok: true; data: { status: 'created'; profile: { id: string } } };
  expect(result.ok).toBe(true);
  return result.data.profile.id;
}

function expectFailure(result: unknown, code: string): void {
  expect(result).toMatchObject({ ok: false, error: { code } });
}

describe('maps.list', () => {
  it('answers catalog summaries with profiles, image URLs, and the default', async () => {
    const harness = setup();
    const profileId = await createProfileVia(harness);

    await expect(harness.invoke(mapsList, undefined)).resolves.toEqual({
      ok: true,
      data: [
        {
          id: 'de_dust2',
          displayName: 'Dust 2',
          profiles: [
            {
              id: profileId,
              name: 'Default',
              imageUrl: `tactics-map://de_dust2/${profileId}.png`,
            },
          ],
          defaultProfileId: profileId,
        },
        { id: 'de_nuke', displayName: 'Nuke', profiles: [], defaultProfileId: undefined },
      ],
    });
  });

  it('answers the empty catalog as a regular empty list', async () => {
    const { invoke } = setup([]);

    await expect(invoke(mapsList, undefined)).resolves.toEqual({ ok: true, data: [] });
  });

  it('rejects an untrusted sender (ADR-025)', async () => {
    const { invoke } = setup();

    expectFailure(await invoke(mapsList, undefined, false), 'INTERNAL');
  });
});

describe('maps.getProfile', () => {
  it('answers profile details for an explicit profileId', async () => {
    const harness = setup();
    const profileId = await createProfileVia(harness);

    await expect(harness.invoke(mapsGetProfile, { mapId: 'de_dust2', profileId })).resolves.toEqual(
      {
        ok: true,
        data: {
          id: profileId,
          mapId: 'de_dust2',
          name: 'Default',
          imageUrl: `tactics-map://de_dust2/${profileId}.png`,
          callouts: dust2.callouts,
        },
      },
    );
  });

  it('resolves the default profile when profileId is omitted', async () => {
    const harness = setup();
    const first = await createProfileVia(harness, 'de_dust2', 'First');
    await createProfileVia(harness, 'de_dust2', 'Second');

    const result = (await harness.invoke(mapsGetProfile, { mapId: 'de_dust2' })) as {
      ok: true;
      data: { id: string };
    };

    expect(result.data.id).toBe(first);
  });

  it('answers PROFILE_NOT_FOUND for a map without profiles', async () => {
    const { invoke } = setup();

    expectFailure(await invoke(mapsGetProfile, { mapId: 'de_dust2' }), 'PROFILE_NOT_FOUND');
  });

  it('answers MAP_NOT_FOUND for an unknown map', async () => {
    const { invoke } = setup();

    expectFailure(await invoke(mapsGetProfile, { mapId: 'de_unknown' }), 'MAP_NOT_FOUND');
  });

  it('does not serve a profile through another map id (defense in depth)', async () => {
    const harness = setup();
    const profileId = await createProfileVia(harness, 'de_dust2');

    expectFailure(
      await harness.invoke(mapsGetProfile, { mapId: 'de_nuke', profileId }),
      'PROFILE_NOT_FOUND',
    );
  });

  it('rejects an empty mapId at the boundary (INVALID_REQUEST)', async () => {
    const { invoke } = setup();

    expectFailure(await invoke(mapsGetProfile, { mapId: '' }), 'INVALID_REQUEST');
  });
});

describe('maps.createProfile (upload)', () => {
  it('creates a profile seeded from the default layout and saves the image', async () => {
    const harness = setup();

    const result = await harness.invoke(mapsCreateProfile, {
      mapId: 'de_dust2',
      name: 'My radar',
      source: { kind: 'upload' },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: 'created',
        map: { id: 'de_dust2', profiles: [{ name: 'My radar' }] },
        profile: { mapId: 'de_dust2', name: 'My radar', callouts: dust2.callouts },
      },
    });
    const created = (result as { data: { profile: { id: string } } }).data.profile;
    expect(harness.images.saveImage).toHaveBeenCalledWith('de_dust2', `${created.id}.png`, {
      extension: 'png',
      bytes: PNG_IMAGE.bytes,
    });
  });

  it('answers a canceled dialog as a regular outcome and creates nothing', async () => {
    const harness = setup();
    harness.showImageOpenDialog.mockResolvedValue(undefined);

    await expect(
      harness.invoke(mapsCreateProfile, {
        mapId: 'de_dust2',
        name: 'Mine',
        source: { kind: 'upload' },
      }),
    ).resolves.toEqual({ ok: true, data: { status: 'canceled' } });
    expect(harness.profiles.listProfiles('de_dust2').profiles).toHaveLength(0);
  });

  it('answers a rejected image as IMAGE_INVALID and creates nothing', async () => {
    const harness = setup();
    harness.images.loadImage.mockResolvedValue({
      ok: false,
      error: { code: 'SVG_REJECTED', issues: ['script element'] },
    });

    expectFailure(
      await harness.invoke(mapsCreateProfile, {
        mapId: 'de_dust2',
        name: 'Mine',
        source: { kind: 'upload' },
      }),
      'IMAGE_INVALID',
    );
    expect(harness.profiles.listProfiles('de_dust2').profiles).toHaveLength(0);
  });

  it('rolls the created rows back when the file write fails (DB_ERROR)', async () => {
    const harness = setup();
    harness.images.saveImage.mockRejectedValue(new Error('disk full'));

    expectFailure(
      await harness.invoke(mapsCreateProfile, {
        mapId: 'de_dust2',
        name: 'Mine',
        source: { kind: 'upload' },
      }),
      'DB_ERROR',
    );
    expect(harness.profiles.listProfiles('de_dust2').profiles).toHaveLength(0);
  });

  it('answers MAP_NOT_FOUND before opening any dialog', async () => {
    const harness = setup();

    expectFailure(
      await harness.invoke(mapsCreateProfile, {
        mapId: 'de_unknown',
        name: 'Mine',
        source: { kind: 'upload' },
      }),
      'MAP_NOT_FOUND',
    );
    expect(harness.showImageOpenDialog).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only name at the boundary (INVALID_REQUEST)', async () => {
    const { invoke } = setup();

    expectFailure(
      await invoke(mapsCreateProfile, {
        mapId: 'de_dust2',
        name: '   ',
        source: { kind: 'upload' },
      }),
      'INVALID_REQUEST',
    );
  });
});

describe('maps.createProfile (fork)', () => {
  it('copies callouts and the image file from the source profile', async () => {
    const harness = setup();
    const sourceId = await createProfileVia(harness, 'de_dust2', 'Source');
    harness.showImageOpenDialog.mockClear();

    const result = await harness.invoke(mapsCreateProfile, {
      mapId: 'de_dust2',
      name: 'Copy',
      source: { kind: 'fork', profileId: sourceId },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: 'created',
        profile: { name: 'Copy', callouts: dust2.callouts },
      },
    });
    const forked = (result as { data: { profile: { id: string } } }).data.profile;
    expect(harness.images.copyImage).toHaveBeenCalledWith(
      'de_dust2',
      `${sourceId}.png`,
      `${forked.id}.png`,
    );
    // Fork never opens a dialog — the image comes from the source profile.
    expect(harness.showImageOpenDialog).not.toHaveBeenCalled();
  });

  it('answers PROFILE_NOT_FOUND for an unknown fork source', async () => {
    const harness = setup();

    expectFailure(
      await harness.invoke(mapsCreateProfile, {
        mapId: 'de_dust2',
        name: 'Copy',
        source: { kind: 'fork', profileId: 'missing' },
      }),
      'PROFILE_NOT_FOUND',
    );
  });

  it('rolls back and answers IMAGE_INVALID when the source file is missing', async () => {
    const harness = setup();
    const sourceId = await createProfileVia(harness, 'de_dust2', 'Source');
    harness.images.copyImage.mockResolvedValue(false);

    expectFailure(
      await harness.invoke(mapsCreateProfile, {
        mapId: 'de_dust2',
        name: 'Copy',
        source: { kind: 'fork', profileId: sourceId },
      }),
      'IMAGE_INVALID',
    );
    expect(harness.profiles.listProfiles('de_dust2').profiles).toHaveLength(1);
  });
});

describe('maps.replaceProfileImage', () => {
  it('replaces the image in place when the extension is unchanged', async () => {
    const harness = setup();
    const profileId = await createProfileVia(harness);
    harness.images.deleteImage.mockClear();

    const result = await harness.invoke(mapsReplaceProfileImage, {
      mapId: 'de_dust2',
      profileId,
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: 'replaced',
        profile: { id: profileId, imageUrl: `tactics-map://de_dust2/${profileId}.png` },
      },
    });
    expect(harness.images.saveImage).toHaveBeenLastCalledWith('de_dust2', `${profileId}.png`, {
      extension: 'png',
      bytes: PNG_IMAGE.bytes,
    });
    expect(harness.images.deleteImage).not.toHaveBeenCalled();
  });

  it('deletes the old file when the extension changed', async () => {
    const harness = setup();
    const profileId = await createProfileVia(harness);
    harness.images.loadImage.mockResolvedValue({ ok: true, image: SVG_IMAGE });

    const result = await harness.invoke(mapsReplaceProfileImage, {
      mapId: 'de_dust2',
      profileId,
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: 'replaced',
        map: { profiles: [{ imageUrl: `tactics-map://de_dust2/${profileId}.svg` }] },
        profile: { imageUrl: `tactics-map://de_dust2/${profileId}.svg` },
      },
    });
    expect(harness.images.deleteImage).toHaveBeenCalledWith('de_dust2', `${profileId}.png`);
  });

  it('keeps the profile untouched on cancel and on a rejected image', async () => {
    const harness = setup();
    const profileId = await createProfileVia(harness);

    harness.showImageOpenDialog.mockResolvedValueOnce(undefined);
    await expect(
      harness.invoke(mapsReplaceProfileImage, { mapId: 'de_dust2', profileId }),
    ).resolves.toEqual({ ok: true, data: { status: 'canceled' } });

    harness.images.loadImage.mockResolvedValueOnce({
      ok: false,
      error: { code: 'TOO_LARGE', issues: ['too big'] },
    });
    expectFailure(
      await harness.invoke(mapsReplaceProfileImage, { mapId: 'de_dust2', profileId }),
      'IMAGE_INVALID',
    );
    expect(harness.profiles.getProfile(profileId)?.profile.imageFileName).toBe(`${profileId}.png`);
  });

  it('answers PROFILE_NOT_FOUND for an unknown profile without opening a dialog', async () => {
    const harness = setup();

    expectFailure(
      await harness.invoke(mapsReplaceProfileImage, { mapId: 'de_dust2', profileId: 'missing' }),
      'PROFILE_NOT_FOUND',
    );
    expect(harness.showImageOpenDialog).not.toHaveBeenCalled();
  });
});

describe('maps.setDefaultProfile', () => {
  it('marks the default and answers the updated map summary', async () => {
    const harness = setup();
    await createProfileVia(harness, 'de_dust2', 'First');
    const second = await createProfileVia(harness, 'de_dust2', 'Second');

    await expect(
      harness.invoke(mapsSetDefaultProfile, { mapId: 'de_dust2', profileId: second }),
    ).resolves.toMatchObject({ ok: true, data: { id: 'de_dust2', defaultProfileId: second } });
  });

  it('answers PROFILE_NOT_FOUND for a profile of another map', async () => {
    const harness = setup();
    const profileId = await createProfileVia(harness, 'de_dust2');

    expectFailure(
      await harness.invoke(mapsSetDefaultProfile, { mapId: 'de_nuke', profileId }),
      'PROFILE_NOT_FOUND',
    );
  });
});

describe('maps.renameProfile', () => {
  it('renames and answers map summary plus profile details', async () => {
    const harness = setup();
    const profileId = await createProfileVia(harness, 'de_dust2', 'Old');

    await expect(
      harness.invoke(mapsRenameProfile, { mapId: 'de_dust2', profileId, name: 'New' }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        map: { profiles: [{ id: profileId, name: 'New' }] },
        profile: { id: profileId, name: 'New', callouts: dust2.callouts },
      },
    });
  });

  it('answers PROFILE_NOT_FOUND for an unknown profile', async () => {
    const harness = setup();

    expectFailure(
      await harness.invoke(mapsRenameProfile, {
        mapId: 'de_dust2',
        profileId: 'missing',
        name: 'New',
      }),
      'PROFILE_NOT_FOUND',
    );
  });
});

describe('maps.deleteProfile', () => {
  it('deletes rows and image; deleting the last profile answers the empty state', async () => {
    const harness = setup();
    const profileId = await createProfileVia(harness);

    await expect(
      harness.invoke(mapsDeleteProfile, { mapId: 'de_dust2', profileId }),
    ).resolves.toEqual({
      ok: true,
      data: { id: 'de_dust2', displayName: 'Dust 2', profiles: [], defaultProfileId: undefined },
    });
    expect(harness.images.deleteImage).toHaveBeenCalledWith('de_dust2', `${profileId}.png`);
  });

  it('falls back to the first remaining profile as default', async () => {
    const harness = setup();
    const first = await createProfileVia(harness, 'de_dust2', 'First');
    const second = await createProfileVia(harness, 'de_dust2', 'Second');
    await harness.invoke(mapsSetDefaultProfile, { mapId: 'de_dust2', profileId: first });

    await expect(
      harness.invoke(mapsDeleteProfile, { mapId: 'de_dust2', profileId: first }),
    ).resolves.toMatchObject({ ok: true, data: { defaultProfileId: second } });
  });

  it('answers PROFILE_NOT_FOUND for an unknown profile', async () => {
    const harness = setup();

    expectFailure(
      await harness.invoke(mapsDeleteProfile, { mapId: 'de_dust2', profileId: 'missing' }),
      'PROFILE_NOT_FOUND',
    );
  });
});

describe('maps.updateCallouts', () => {
  it('replaces the callout set and answers the full new details', async () => {
    const harness = setup();
    const profileId = await createProfileVia(harness);
    const callouts = [{ name: 'Car', x: 0.1, y: 0.2 }];

    await expect(
      harness.invoke(mapsUpdateCallouts, { mapId: 'de_dust2', profileId, callouts }),
    ).resolves.toMatchObject({ ok: true, data: { id: profileId, callouts } });
  });

  it('rejects duplicate callout names at the boundary (INVALID_REQUEST)', async () => {
    const harness = setup();
    const profileId = await createProfileVia(harness);

    expectFailure(
      await harness.invoke(mapsUpdateCallouts, {
        mapId: 'de_dust2',
        profileId,
        callouts: [
          { name: 'Car', x: 0.1, y: 0.2 },
          { name: 'Car', x: 0.3, y: 0.4 },
        ],
      }),
      'INVALID_REQUEST',
    );
  });

  it('answers PROFILE_NOT_FOUND for an unknown profile', async () => {
    const harness = setup();

    expectFailure(
      await harness.invoke(mapsUpdateCallouts, {
        mapId: 'de_dust2',
        profileId: 'missing',
        callouts: [],
      }),
      'PROFILE_NOT_FOUND',
    );
  });
});

describe('error mapping', () => {
  it('answers a storage failure as the named DB_ERROR', async () => {
    const failing: ProfileRepository = {
      ...createFakeProfiles(),
      setDefaultProfile: () => {
        throw new Error('database is locked');
      },
    };
    const harness = setup([dust2, nuke], { profiles: failing });

    expectFailure(
      await harness.invoke(mapsSetDefaultProfile, { mapId: 'de_dust2', profileId: 'any' }),
      'DB_ERROR',
    );
  });

  it('surfaces a TypeError (module drift — a bug) as INTERNAL', async () => {
    const failing: ProfileRepository = {
      ...createFakeProfiles(),
      setDefaultProfile: () => {
        throw new TypeError('drift');
      },
    };
    const harness = setup([dust2, nuke], { profiles: failing });

    expectFailure(
      await harness.invoke(mapsSetDefaultProfile, { mapId: 'de_dust2', profileId: 'any' }),
      'INTERNAL',
    );
  });
});
