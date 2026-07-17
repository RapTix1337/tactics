import { describe, expect, expectTypeOf, it } from 'vitest';

import type { ContractCommandDefinitions } from './commands';
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
  overlayClose,
  overlayOpen,
  overlayResize,
  settingsUpdate,
  steamPickCs2Path,
  updatesCheck,
  updatesInstall,
} from './commands';
import { COMMAND_NAMES, EVENT_DOMAINS } from './contract-names';
import type { ContractEventDefinitions } from './events';
import {
  gameStateChanged,
  overlayChanged,
  scoreboardChanged,
  settingsChanged,
  updateChanged,
} from './events';

describe('contract name lists', () => {
  it('lists exactly the defined commands (both directions, type level)', () => {
    expectTypeOf<(typeof COMMAND_NAMES)[number]>().toEqualTypeOf<
      keyof ContractCommandDefinitions
    >();

    expect(COMMAND_NAMES).toContain(appGetSnapshot.name);
    expect(COMMAND_NAMES).toContain(appOpenExternal.name);
    expect(COMMAND_NAMES).toContain(appReportRendererError.name);
    expect(COMMAND_NAMES).toContain(gsiGetSetupPlan.name);
    expect(COMMAND_NAMES).toContain(gsiApplySetup.name);
    expect(COMMAND_NAMES).toContain(logsOpenDirectory.name);
    expect(COMMAND_NAMES).toContain(logsExport.name);
    expect(COMMAND_NAMES).toContain(mapsList.name);
    expect(COMMAND_NAMES).toContain(mapsGetProfile.name);
    expect(COMMAND_NAMES).toContain(mapsCreateProfile.name);
    expect(COMMAND_NAMES).toContain(mapsReplaceProfileImage.name);
    expect(COMMAND_NAMES).toContain(mapsSetDefaultProfile.name);
    expect(COMMAND_NAMES).toContain(mapsRenameProfile.name);
    expect(COMMAND_NAMES).toContain(mapsDeleteProfile.name);
    expect(COMMAND_NAMES).toContain(mapsUpdateCallouts.name);
    expect(COMMAND_NAMES).toContain(overlayOpen.name);
    expect(COMMAND_NAMES).toContain(overlayClose.name);
    expect(COMMAND_NAMES).toContain(overlayResize.name);
    expect(COMMAND_NAMES).toContain(settingsUpdate.name);
    expect(COMMAND_NAMES).toContain(steamPickCs2Path.name);
    expect(COMMAND_NAMES).toContain(updatesCheck.name);
    expect(COMMAND_NAMES).toContain(updatesInstall.name);
    expect(new Set(COMMAND_NAMES).size).toBe(COMMAND_NAMES.length);
  });

  it('keys every command definition by its own name (type level)', () => {
    // Load-bearing: the bridge derives channels from the map keys, main
    // registers under definition.name — a mismatch would be a dead command.
    expectTypeOf<{
      [K in keyof ContractCommandDefinitions]: ContractCommandDefinitions[K]['name'];
    }>().toEqualTypeOf<{ [K in keyof ContractCommandDefinitions]: K }>();
  });

  it('lists exactly the defined event domains (type level)', () => {
    expectTypeOf<(typeof EVENT_DOMAINS)[number]>().toEqualTypeOf<keyof ContractEventDefinitions>();

    expect(EVENT_DOMAINS).toContain(gameStateChanged.domain);
    expect(EVENT_DOMAINS).toContain(overlayChanged.domain);
    expect(EVENT_DOMAINS).toContain(scoreboardChanged.domain);
    expect(EVENT_DOMAINS).toContain(settingsChanged.domain);
    expect(EVENT_DOMAINS).toContain(updateChanged.domain);
    expect(new Set(EVENT_DOMAINS).size).toBe(EVENT_DOMAINS.length);
  });
});
