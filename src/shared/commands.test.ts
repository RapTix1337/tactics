import { describe, expect, it } from 'vitest';

import {
  appGetSnapshot,
  appOpenExternal,
  appReportRendererError,
  gsiApplySetup,
  gsiGetSetupPlan,
  logsExport,
  logsOpenDirectory,
  mapsCreateProfile,
  mapsDeleteProfile,
  mapsGetProfile,
  mapsList,
  mapsRenameProfile,
  mapsReplaceProfileImage,
  mapsSetDefaultProfile,
  mapsUpdateCallouts,
  settingsUpdate,
  steamPickCs2Path,
  updatesCheck,
  updatesInstall,
} from './commands';
import { EXTERNAL_URLS } from './external-urls';
import type { GameState } from './game-state';
import type { MapProfileDetails, MapSummary } from './map-catalog';
import type { Settings } from './settings';
import type { UpdateState } from './update-state';

const validGameState: GameState = { status: 'waiting', map: { kind: 'none' } };

const validUpdateState: UpdateState = { status: 'idle', version: null, errorKind: null };

const validSettings: Settings = {
  theme: 'dark',
  cs2Path: null,
  gsiPort: null,
  autostart: false,
  closeToTray: true,
  autoUpdate: true,
  scoreboardEnabled: true,
  scoreboardLayout: { groups: [{ label: 'Match totals', fields: ['kills'] }] },
  gsiTiming: 'default',
};

describe('appGetSnapshot', () => {
  it('lives on the contract channel', () => {
    expect(appGetSnapshot.channel).toBe('cmd:app.getSnapshot');
  });

  it('takes no request and returns the snapshot with one slice per mirror store', () => {
    expect(appGetSnapshot.requestSchema.safeParse(undefined).success).toBe(true);
    expect(
      appGetSnapshot.responseSchema.safeParse({
        gameState: validGameState,
        settings: validSettings,
        updateState: validUpdateState,
      }).success,
    ).toBe(true);
    // Every slice is mandatory — an empty snapshot was the pre-E8.3 skeleton.
    expect(appGetSnapshot.responseSchema.safeParse({}).success).toBe(false);
    expect(
      appGetSnapshot.responseSchema.safeParse({
        gameState: validGameState,
        settings: validSettings,
      }).success,
    ).toBe(false);
  });
});

describe('settingsUpdate', () => {
  it('lives on the contract channel', () => {
    expect(settingsUpdate.channel).toBe('cmd:settings.update');
  });

  it('accepts any partial of the settings fields, including the empty one', () => {
    const { requestSchema } = settingsUpdate;
    expect(requestSchema.safeParse({}).success).toBe(true);
    expect(requestSchema.safeParse({ theme: 'light' }).success).toBe(true);
    expect(requestSchema.safeParse({ theme: 'system', autostart: true }).success).toBe(true);
    // The scoreboard fields ride the same command — no new command (ADR-053).
    expect(
      requestSchema.safeParse({
        scoreboardEnabled: false,
        scoreboardLayout: { groups: [{ label: 'Mine', fields: ['kills'] }] },
        gsiTiming: 'fast',
      }).success,
    ).toBe(true);
  });

  it('accepts explicit null to reset cs2Path/gsiPort to automatic', () => {
    const { requestSchema } = settingsUpdate;
    expect(requestSchema.safeParse({ cs2Path: null, gsiPort: null }).success).toBe(true);
  });

  it('rejects invalid field values at the boundary (named INVALID_REQUEST path)', () => {
    const { requestSchema } = settingsUpdate;
    expect(requestSchema.safeParse({ theme: 'blurple' }).success).toBe(false);
    expect(requestSchema.safeParse({ gsiPort: 65536 }).success).toBe(false);
    expect(requestSchema.safeParse({ cs2Path: '' }).success).toBe(false);
    expect(requestSchema.safeParse({ autostart: 'yes' }).success).toBe(false);
    expect(requestSchema.safeParse({ gsiTiming: 'turbo' }).success).toBe(false);
    expect(requestSchema.safeParse({ scoreboardLayout: { groups: [] } }).success).toBe(false);
  });

  it('responds with the full new settings state', () => {
    expect(settingsUpdate.responseSchema.safeParse(validSettings).success).toBe(true);
    expect(settingsUpdate.responseSchema.safeParse({ theme: 'dark' }).success).toBe(false);
  });
});

describe('appReportRendererError', () => {
  it('lives on the contract channel', () => {
    expect(appReportRendererError.channel).toBe('cmd:app.reportRendererError');
  });

  it('requires only the message; stack and route are optional', () => {
    const { requestSchema } = appReportRendererError;
    expect(requestSchema.safeParse({ message: 'boom' }).success).toBe(true);
    expect(
      requestSchema.safeParse({ message: 'boom', stack: 'at x', route: '/live' }).success,
    ).toBe(true);
    expect(requestSchema.safeParse({}).success).toBe(false);
  });

  it('caps the field lengths as the boundary guard above the renderer truncation', () => {
    const { requestSchema } = appReportRendererError;
    expect(requestSchema.safeParse({ message: 'm'.repeat(2_001) }).success).toBe(false);
    expect(requestSchema.safeParse({ message: 'boom', stack: 's'.repeat(16_001) }).success).toBe(
      false,
    );
    expect(requestSchema.safeParse({ message: 'boom', route: 'r'.repeat(501) }).success).toBe(
      false,
    );
  });
});

describe('appOpenExternal', () => {
  it('lives on the contract channel and returns no data', () => {
    expect(appOpenExternal.channel).toBe('cmd:app.openExternal');
    expect(appOpenExternal.responseSchema.safeParse(undefined).success).toBe(true);
  });

  it('accepts exactly the contract-allowlisted URLs (ADR-036)', () => {
    for (const url of EXTERNAL_URLS) {
      expect(appOpenExternal.requestSchema.safeParse({ url }).success).toBe(true);
    }
  });

  it('rejects every other URL at the boundary (named INVALID_REQUEST path)', () => {
    const { requestSchema } = appOpenExternal;
    expect(requestSchema.safeParse({ url: 'https://example.com' }).success).toBe(false);
    // The list is closed over exact strings — even sub-paths of an entry fail.
    expect(
      requestSchema.safeParse({ url: 'https://github.com/RapTix1337/tactics/issues' }).success,
    ).toBe(false);
    expect(requestSchema.safeParse({ url: 'file:///C:/Windows' }).success).toBe(false);
    expect(requestSchema.safeParse({}).success).toBe(false);
  });
});

describe('logsOpenDirectory', () => {
  it('lives on the contract channel and takes no request', () => {
    expect(logsOpenDirectory.channel).toBe('cmd:logs.openDirectory');
    expect(logsOpenDirectory.requestSchema.safeParse(undefined).success).toBe(true);
    expect(logsOpenDirectory.responseSchema.safeParse(undefined).success).toBe(true);
  });
});

describe('logsExport', () => {
  it('lives on the contract channel and takes no request', () => {
    expect(logsExport.channel).toBe('cmd:logs.export');
    expect(logsExport.requestSchema.safeParse(undefined).success).toBe(true);
  });

  it('responds with saved (incl. file path) or canceled — nothing else', () => {
    const { responseSchema } = logsExport;
    expect(
      responseSchema.safeParse({ status: 'saved', filePath: 'C:\\Downloads\\logs.log' }).success,
    ).toBe(true);
    expect(responseSchema.safeParse({ status: 'canceled' }).success).toBe(true);
    expect(responseSchema.safeParse({ status: 'saved' }).success).toBe(false);
    expect(responseSchema.safeParse({ status: 'failed' }).success).toBe(false);
  });
});

describe('gsiGetSetupPlan', () => {
  it('lives on the contract channel and takes no request', () => {
    expect(gsiGetSetupPlan.channel).toBe('cmd:gsi.getSetupPlan');
    expect(gsiGetSetupPlan.requestSchema.safeParse(undefined).success).toBe(true);
  });

  it('responds with a ready plan (source, paths, port) or cs2-not-found — nothing else', () => {
    const { responseSchema } = gsiGetSetupPlan;
    expect(
      responseSchema.safeParse({
        status: 'ready',
        source: 'detected',
        gameRoot: 'C:\\Steam\\steamapps\\common\\Counter-Strike Global Offensive',
        configPath:
          'C:\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg\\gamestate_integration_tactics.cfg',
        port: 42730,
      }).success,
    ).toBe(true);
    expect(
      responseSchema.safeParse({
        status: 'ready',
        source: 'manual',
        gameRoot: '/games/cs2',
        configPath: '/games/cs2/game/csgo/cfg/gamestate_integration_tactics.cfg',
        port: 42731,
      }).success,
    ).toBe(true);
    expect(responseSchema.safeParse({ status: 'cs2-not-found' }).success).toBe(true);
    // A ready plan without its target would leave the consent dialog blind.
    expect(responseSchema.safeParse({ status: 'ready', port: 42730 }).success).toBe(false);
    expect(responseSchema.safeParse({ status: 'unknown' }).success).toBe(false);
  });
});

describe('gsiApplySetup', () => {
  it('lives on the contract channel, takes no request, returns no data', () => {
    expect(gsiApplySetup.channel).toBe('cmd:gsi.applySetup');
    expect(gsiApplySetup.requestSchema.safeParse(undefined).success).toBe(true);
    // CS2_NOT_FOUND / CFG_DIR_NOT_WRITABLE travel as named envelope errors.
    expect(gsiApplySetup.responseSchema.safeParse(undefined).success).toBe(true);
  });
});

const profileSummary = {
  id: '3f2c1a9e-0b5d-4e7f-8a6b-1c2d3e4f5a6b',
  name: 'My radar',
  imageUrl: 'tactics-map://de_dust2/3f2c1a9e-0b5d-4e7f-8a6b-1c2d3e4f5a6b.png',
};

const mapSummary: MapSummary = {
  id: 'de_dust2',
  displayName: 'Dust 2',
  profiles: [profileSummary],
  defaultProfileId: profileSummary.id,
};

const profileDetails: MapProfileDetails = {
  ...profileSummary,
  mapId: 'de_dust2',
  callouts: [{ name: 'Long', x: 0.69, y: 0.715 }],
};

describe('mapsList', () => {
  it('lives on the contract channel and takes no request', () => {
    expect(mapsList.channel).toBe('cmd:maps.list');
    expect(mapsList.requestSchema.safeParse(undefined).success).toBe(true);
  });

  it('responds with summaries — the empty catalog is a regular empty array', () => {
    const { responseSchema } = mapsList;
    expect(responseSchema.safeParse([mapSummary]).success).toBe(true);
    expect(responseSchema.safeParse([]).success).toBe(true);
    expect(responseSchema.safeParse([{ id: 'de_dust2', displayName: 'Dust 2' }]).success).toBe(
      false,
    );
  });

  it('answers a map without an image as an empty profiles array, not a flag', () => {
    expect(
      mapsList.responseSchema.safeParse([{ id: 'de_nuke', displayName: 'Nuke', profiles: [] }])
        .success,
    ).toBe(true);
  });
});

describe('mapsGetProfile', () => {
  it('lives on the contract channel', () => {
    expect(mapsGetProfile.channel).toBe('cmd:maps.getProfile');
  });

  it('requires a mapId; profileId stays optional (default resolution)', () => {
    const { requestSchema } = mapsGetProfile;
    expect(requestSchema.safeParse({ mapId: 'de_dust2' }).success).toBe(true);
    expect(
      requestSchema.safeParse({ mapId: 'de_dust2', profileId: profileSummary.id }).success,
    ).toBe(true);
    expect(requestSchema.safeParse({ mapId: '' }).success).toBe(false);
    expect(requestSchema.safeParse({ mapId: 'x'.repeat(65) }).success).toBe(false);
    expect(requestSchema.safeParse({}).success).toBe(false);
  });

  it('responds with profile details', () => {
    const { responseSchema } = mapsGetProfile;
    expect(responseSchema.safeParse(profileDetails).success).toBe(true);
    // MAP_NOT_FOUND / PROFILE_NOT_FOUND travel as named envelope errors.
    expect(responseSchema.safeParse(undefined).success).toBe(false);
  });
});

describe('mapsCreateProfile', () => {
  it('lives on the contract channel', () => {
    expect(mapsCreateProfile.channel).toBe('cmd:maps.createProfile');
  });

  it('accepts the upload and fork sources — nothing else', () => {
    const { requestSchema } = mapsCreateProfile;
    expect(
      requestSchema.safeParse({ mapId: 'de_dust2', name: 'Mine', source: { kind: 'upload' } })
        .success,
    ).toBe(true);
    expect(
      requestSchema.safeParse({
        mapId: 'de_dust2',
        name: 'Mine',
        source: { kind: 'fork', profileId: profileSummary.id },
      }).success,
    ).toBe(true);
    expect(
      requestSchema.safeParse({ mapId: 'de_dust2', name: 'Mine', source: { kind: 'fork' } })
        .success,
    ).toBe(false);
    expect(
      requestSchema.safeParse({ mapId: 'de_dust2', name: 'Mine', source: { kind: 'paste' } })
        .success,
    ).toBe(false);
  });

  it('trims the profile name and rejects whitespace-only names at the boundary', () => {
    const { requestSchema } = mapsCreateProfile;
    const parsed = requestSchema.safeParse({
      mapId: 'de_dust2',
      name: '  Mine ',
      source: { kind: 'upload' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe('Mine');
    }
    expect(
      requestSchema.safeParse({ mapId: 'de_dust2', name: '   ', source: { kind: 'upload' } })
        .success,
    ).toBe(false);
  });

  it('responds with created (map + profile) or canceled — nothing else', () => {
    const { responseSchema } = mapsCreateProfile;
    expect(
      responseSchema.safeParse({ status: 'created', map: mapSummary, profile: profileDetails })
        .success,
    ).toBe(true);
    expect(responseSchema.safeParse({ status: 'canceled' }).success).toBe(true);
    // IMAGE_INVALID travels as a named envelope error, never as a status.
    expect(responseSchema.safeParse({ status: 'created' }).success).toBe(false);
    expect(responseSchema.safeParse({ status: 'rejected' }).success).toBe(false);
  });
});

describe('mapsReplaceProfileImage', () => {
  it('lives on the contract channel and names map and profile', () => {
    expect(mapsReplaceProfileImage.channel).toBe('cmd:maps.replaceProfileImage');
    const { requestSchema } = mapsReplaceProfileImage;
    expect(
      requestSchema.safeParse({ mapId: 'de_dust2', profileId: profileSummary.id }).success,
    ).toBe(true);
    expect(requestSchema.safeParse({ mapId: 'de_dust2' }).success).toBe(false);
  });

  it('responds with replaced (map + profile) or canceled — nothing else', () => {
    const { responseSchema } = mapsReplaceProfileImage;
    expect(
      responseSchema.safeParse({ status: 'replaced', map: mapSummary, profile: profileDetails })
        .success,
    ).toBe(true);
    expect(responseSchema.safeParse({ status: 'canceled' }).success).toBe(true);
    expect(responseSchema.safeParse({ status: 'replaced' }).success).toBe(false);
  });
});

describe('mapsSetDefaultProfile', () => {
  it('lives on the contract channel and responds with the updated map summary', () => {
    expect(mapsSetDefaultProfile.channel).toBe('cmd:maps.setDefaultProfile');
    expect(
      mapsSetDefaultProfile.requestSchema.safeParse({
        mapId: 'de_dust2',
        profileId: profileSummary.id,
      }).success,
    ).toBe(true);
    expect(mapsSetDefaultProfile.responseSchema.safeParse(mapSummary).success).toBe(true);
  });
});

describe('mapsRenameProfile', () => {
  it('lives on the contract channel and requires the trimmed new name', () => {
    expect(mapsRenameProfile.channel).toBe('cmd:maps.renameProfile');
    const { requestSchema } = mapsRenameProfile;
    expect(
      requestSchema.safeParse({
        mapId: 'de_dust2',
        profileId: profileSummary.id,
        name: 'Renamed',
      }).success,
    ).toBe(true);
    expect(
      requestSchema.safeParse({ mapId: 'de_dust2', profileId: profileSummary.id, name: ' ' })
        .success,
    ).toBe(false);
  });

  it('responds with the updated map summary plus the profile details', () => {
    expect(
      mapsRenameProfile.responseSchema.safeParse({ map: mapSummary, profile: profileDetails })
        .success,
    ).toBe(true);
    expect(mapsRenameProfile.responseSchema.safeParse({ map: mapSummary }).success).toBe(false);
  });
});

describe('mapsDeleteProfile', () => {
  it('lives on the contract channel and responds with the updated map summary', () => {
    expect(mapsDeleteProfile.channel).toBe('cmd:maps.deleteProfile');
    expect(
      mapsDeleteProfile.requestSchema.safeParse({
        mapId: 'de_dust2',
        profileId: profileSummary.id,
      }).success,
    ).toBe(true);
    // Deleting the last profile answers with the empty/upload state.
    expect(
      mapsDeleteProfile.responseSchema.safeParse({
        id: 'de_dust2',
        displayName: 'Dust 2',
        profiles: [],
      }).success,
    ).toBe(true);
  });
});

describe('mapsUpdateCallouts', () => {
  it('lives on the contract channel', () => {
    expect(mapsUpdateCallouts.channel).toBe('cmd:maps.updateCallouts');
  });

  it('validates the callout set at the boundary: bounds, names, uniqueness', () => {
    const { requestSchema } = mapsUpdateCallouts;
    const base = { mapId: 'de_dust2', profileId: profileSummary.id };
    expect(
      requestSchema.safeParse({ ...base, callouts: [{ name: 'Long', x: 0.69, y: 0.715 }] }).success,
    ).toBe(true);
    expect(requestSchema.safeParse({ ...base, callouts: [] }).success).toBe(true);
    expect(
      requestSchema.safeParse({ ...base, callouts: [{ name: 'Long', x: 1.2, y: 0.5 }] }).success,
    ).toBe(false);
    expect(
      requestSchema.safeParse({
        ...base,
        callouts: [
          { name: 'Long', x: 0.1, y: 0.2 },
          { name: 'Long', x: 0.3, y: 0.4 },
        ],
      }).success,
    ).toBe(false);
  });

  it('responds with the full new profile details', () => {
    expect(mapsUpdateCallouts.responseSchema.safeParse(profileDetails).success).toBe(true);
  });
});

describe('updatesCheck', () => {
  it('lives on the contract channel, takes no request, returns no data', () => {
    expect(updatesCheck.channel).toBe('cmd:updates.check');
    expect(updatesCheck.requestSchema.safeParse(undefined).success).toBe(true);
    // The check only acknowledges — results arrive as evt:update.changed.
    expect(updatesCheck.responseSchema.safeParse(undefined).success).toBe(true);
  });
});

describe('updatesInstall', () => {
  it('lives on the contract channel, takes no request, returns no data', () => {
    expect(updatesInstall.channel).toBe('cmd:updates.install');
    expect(updatesInstall.requestSchema.safeParse(undefined).success).toBe(true);
    // UPDATE_NOT_READY travels as a named envelope error.
    expect(updatesInstall.responseSchema.safeParse(undefined).success).toBe(true);
  });
});

describe('steamPickCs2Path', () => {
  it('lives on the contract channel and takes no request', () => {
    expect(steamPickCs2Path.channel).toBe('cmd:steam.pickCs2Path');
    expect(steamPickCs2Path.requestSchema.safeParse(undefined).success).toBe(true);
  });

  it('responds with selected (incl. the full settings state) or canceled — nothing else', () => {
    const { responseSchema } = steamPickCs2Path;
    expect(responseSchema.safeParse({ status: 'selected', settings: validSettings }).success).toBe(
      true,
    );
    expect(responseSchema.safeParse({ status: 'canceled' }).success).toBe(true);
    // INVALID_PATH travels as a named error in the envelope, never as a status.
    expect(responseSchema.safeParse({ status: 'selected' }).success).toBe(false);
    expect(responseSchema.safeParse({ status: 'invalid' }).success).toBe(false);
  });
});
