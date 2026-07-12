import { z } from 'zod';

import { defineCommand } from './contract';
import { EXTERNAL_URLS } from './external-urls';
import { gameStateSchema } from './game-state';
import {
  calloutListSchema,
  createProfileSourceSchema,
  mapIdSchema,
  mapProfileDetailsSchema,
  mapSummarySchema,
  profileIdSchema,
  profileNameSchema,
} from './map-catalog';
import { scoreboardStateSchema } from './scoreboard-state';
import { settingsSchema, settingsUpdateSchema } from './settings';
import { updateStateSchema } from './update-state';

/**
 * `app.getSnapshot` (ADR-022): the renderer's state bootstrap. The response
 * object gains one slice per mirror store with its owning task (settings
 * E8.3, gameState E10.7, updates E18.1, scoreboard SCB.7).
 */
export const appGetSnapshot = defineCommand(
  'app.getSnapshot',
  z.void(),
  z.object({
    gameState: gameStateSchema,
    scoreboard: scoreboardStateSchema,
    settings: settingsSchema,
    updateState: updateStateSchema,
  }),
);

/**
 * `settings.update` (03-technical-design.md §5.3, 01-requirements.md §9):
 * partial in, validated and persisted in main, full new state back. The same
 * full slice is published as `evt:settings.changed` — the response exists
 * for the caller's error handling, stores are fed by the event (ADR-033).
 */
export const settingsUpdate = defineCommand(
  'settings.update',
  settingsUpdateSchema,
  settingsSchema,
);

/**
 * `app.reportRendererError` (03-technical-design.md §5.3/§8.3, PRV-04): the
 * renderer's only error escalation path — the global handlers (E6.2) and
 * the route error boundary (E13.3) report through it; main logs the report
 * under the `renderer` scope. `route` stays optional: pre-router errors and
 * suppression notices carry none. The length caps bound a single log line;
 * the renderer truncates before sending, these are the boundary guard.
 */
export const appReportRendererError = defineCommand(
  'app.reportRendererError',
  z.object({
    message: z.string().max(2_000),
    stack: z.string().max(16_000).optional(),
    route: z.string().max(500).optional(),
  }),
  z.void(),
);

/**
 * `app.openExternal` (03-technical-design.md §5.3, ADR-036, MVP-09): opens
 * one of the contract's allowlisted URLs in the default browser — the
 * renderer never navigates (ADR-025). The closed allowlist IS the request
 * schema, so main's boundary validation rejects every other URL as
 * `INVALID_REQUEST`; no separate check exists to drift.
 */
export const appOpenExternal = defineCommand(
  'app.openExternal',
  z.object({ url: z.enum(EXTERNAL_URLS) }),
  z.void(),
);

/**
 * `logs.openDirectory` (03-technical-design.md §5.3, PRV-04): opens the log
 * folder in the file manager so users can inspect the files they would
 * attach to a bug report.
 */
export const logsOpenDirectory = defineCommand('logs.openDirectory', z.void(), z.void());

/**
 * `logs.export` (03-technical-design.md §5.3, PRV-04): main opens a native
 * save dialog and writes current + archived logs as one text file. Cancel
 * is a regular outcome, not an error — hence the status union.
 */
export const logsExport = defineCommand(
  'logs.export',
  z.void(),
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('saved'), filePath: z.string() }),
    z.object({ status: z.literal('canceled') }),
  ]),
);

/**
 * `maps.list` (03-technical-design.md §5.3, MVP-07/11): the sidebar's and
 * overview's map list — catalog summaries with profile summaries, upload
 * state (derived from `profiles`), and the resolved default profile
 * (ADR-045, E22.3); an empty catalog is a regular empty array, never an
 * error.
 */
export const mapsList = defineCommand('maps.list', z.void(), z.array(mapSummarySchema));

/**
 * `maps.getProfile` (03-technical-design.md §5.3, MVP-08): one profile's
 * details — callouts plus image URL. With `profileId` omitted, the map's
 * resolved default profile answers; a map without profiles is the named
 * `PROFILE_NOT_FOUND` error (the overview shows its upload state from
 * `maps.list` instead). Unknown ids are the named `MAP_NOT_FOUND` /
 * `PROFILE_NOT_FOUND` errors.
 */
export const mapsGetProfile = defineCommand(
  'maps.getProfile',
  z.object({ mapId: mapIdSchema, profileId: profileIdSchema.optional() }),
  mapProfileDetailsSchema,
);

/**
 * `maps.createProfile` (03-technical-design.md §5.3, MVP-11/12): creates a
 * profile from a fresh upload (main owns the native file dialog and the
 * boundary validation, E22.2) or as a fork of an existing profile (image
 * file and callouts copied). Upload cancel is a regular outcome (the
 * `logs.export` precedent); a rejected image is the named `IMAGE_INVALID`
 * error. Responds with the new profile plus the updated map summary so the
 * catalog store refreshes from the response (ADR-033).
 */
export const mapsCreateProfile = defineCommand(
  'maps.createProfile',
  z.object({
    mapId: mapIdSchema,
    name: profileNameSchema,
    source: createProfileSourceSchema,
  }),
  z.discriminatedUnion('status', [
    z.object({
      status: z.literal('created'),
      map: mapSummarySchema,
      profile: mapProfileDetailsSchema,
    }),
    z.object({ status: z.literal('canceled') }),
  ]),
);

/**
 * `maps.replaceProfileImage` (03-technical-design.md §5.3, MVP-12): replaces
 * one profile's image via the same main-owned dialog + validation path as
 * the upload flow; callouts stay untouched. Cancel is a regular outcome; a
 * rejected image is the named `IMAGE_INVALID` error and changes nothing.
 */
export const mapsReplaceProfileImage = defineCommand(
  'maps.replaceProfileImage',
  z.object({ mapId: mapIdSchema, profileId: profileIdSchema }),
  z.discriminatedUnion('status', [
    z.object({
      status: z.literal('replaced'),
      map: mapSummarySchema,
      profile: mapProfileDetailsSchema,
    }),
    z.object({ status: z.literal('canceled') }),
  ]),
);

/**
 * `maps.setDefaultProfile` (03-technical-design.md §5.3, MVP-12): marks the
 * map's explicit default profile (ADR-045). Responds with the updated map
 * summary — the default is a map-level fact, no profile data changes.
 */
export const mapsSetDefaultProfile = defineCommand(
  'maps.setDefaultProfile',
  z.object({ mapId: mapIdSchema, profileId: profileIdSchema }),
  mapSummarySchema,
);

/**
 * `maps.renameProfile` (03-technical-design.md §5.3, MVP-12): renames one
 * profile. Responds with the updated map summary plus the profile details —
 * the name appears in both store slices (ADR-033).
 */
export const mapsRenameProfile = defineCommand(
  'maps.renameProfile',
  z.object({ mapId: mapIdSchema, profileId: profileIdSchema, name: profileNameSchema }),
  z.object({ map: mapSummarySchema, profile: mapProfileDetailsSchema }),
);

/**
 * `maps.deleteProfile` (03-technical-design.md §5.3, MVP-12): deletes the
 * profile, its callouts, and its image file. Deleting the marked default
 * falls back to the first remaining profile (ADR-045); deleting the last
 * profile returns the map to its empty/upload state — both readable from
 * the responded map summary.
 */
export const mapsDeleteProfile = defineCommand(
  'maps.deleteProfile',
  z.object({ mapId: mapIdSchema, profileId: profileIdSchema }),
  mapSummarySchema,
);

/**
 * `maps.updateCallouts` (03-technical-design.md §5.3, MVP-13): replaces one
 * profile's callout set (validated at the boundary: normalized 0–1 bounds,
 * unique names, bounded size). Responds with the full new profile details —
 * the editor re-renders from the response, never optimistically (ADR-033).
 */
export const mapsUpdateCallouts = defineCommand(
  'maps.updateCallouts',
  z.object({ mapId: mapIdSchema, profileId: profileIdSchema, callouts: calloutListSchema }),
  mapProfileDetailsSchema,
);

/**
 * `steam.pickCs2Path` (03-technical-design.md §5.3, GSI-02): the manual
 * fallback when detection fails — main opens the native directory dialog,
 * validates the expected CS2 structure (ADR-025 §4), and persists the
 * selection as the `cs2Path` setting. A valid pick answers with the full new
 * settings state (the `settings.update` precedent) and is also published as
 * `evt:settings.changed`; cancel is a regular outcome, not an error (the
 * `logs.export` precedent). A failed validation is the named `INVALID_PATH`
 * error and persists nothing.
 */
export const steamPickCs2Path = defineCommand(
  'steam.pickCs2Path',
  z.void(),
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('selected'), settings: settingsSchema }),
    z.object({ status: z.literal('canceled') }),
  ]),
);

/**
 * `gsi.getSetupPlan` (03-technical-design.md §5.3, MVP-01/02, GSI-04): what
 * `gsi.applySetup` would configure — the dialog previews it before the
 * consent click. `cs2-not-found` is a regular outcome for the dialog (it
 * offers the manual pick then), not an error — the `logs.export` precedent.
 * The dialog always shows the static restart note (GSI-04, ADR-042), so the
 * plan carries no "CS2 is running" flag.
 */
export const gsiGetSetupPlan = defineCommand(
  'gsi.getSetupPlan',
  z.void(),
  z.discriminatedUnion('status', [
    z.object({
      status: z.literal('ready'),
      /** Where the CS2 path came from: detection chain or the cs2Path setting. */
      source: z.enum(['detected', 'manual']),
      gameRoot: z.string().min(1),
      /** Absolute path of the config file the apply would write. */
      configPath: z.string().min(1),
      port: z.number().int().min(1).max(65535),
    }),
    z.object({ status: z.literal('cs2-not-found') }),
  ]),
);

/**
 * `gsi.applySetup` (03-technical-design.md §5.3, GSI-03/06, MVP-02): writes
 * the GSI config — the contract's only write path, called exclusively from
 * the confirmation dialog (structural consent, ADR-032). Repair is the same
 * command (identical effect). Success is the envelope; failures are the
 * named `CS2_NOT_FOUND` / `CFG_DIR_NOT_WRITABLE` errors.
 */
export const gsiApplySetup = defineCommand('gsi.applySetup', z.void(), z.void());

/**
 * `updates.check` (03-technical-design.md §5.3, REL-02): manual check-now.
 * The command only acknowledges — the result arrives as `evt:update.changed`.
 * While the auto-update setting is disabled the module refuses the check
 * (PRV-02: disabled means zero network calls; maintainer decision E18.1),
 * still acknowledged — the E18.2 UI disables the affordance instead.
 */
export const updatesCheck = defineCommand('updates.check', z.void(), z.void());

/**
 * `updates.install` (03-technical-design.md §5.3, REL-02): quits the app and
 * installs the downloaded update. Without one ready it is the named
 * `UPDATE_NOT_READY` error and nothing happens.
 */
export const updatesInstall = defineCommand('updates.install', z.void(), z.void());

/**
 * The contract's command definitions, keyed by name — the map the typed
 * bridge surface (bridge.ts) and the zod-free name list (contract-names.ts)
 * are checked against. Every new command adds one line here.
 */
export interface ContractCommandDefinitions {
  'app.getSnapshot': typeof appGetSnapshot;
  'app.openExternal': typeof appOpenExternal;
  'app.reportRendererError': typeof appReportRendererError;
  'gsi.getSetupPlan': typeof gsiGetSetupPlan;
  'gsi.applySetup': typeof gsiApplySetup;
  'logs.openDirectory': typeof logsOpenDirectory;
  'logs.export': typeof logsExport;
  'maps.list': typeof mapsList;
  'maps.getProfile': typeof mapsGetProfile;
  'maps.createProfile': typeof mapsCreateProfile;
  'maps.replaceProfileImage': typeof mapsReplaceProfileImage;
  'maps.setDefaultProfile': typeof mapsSetDefaultProfile;
  'maps.renameProfile': typeof mapsRenameProfile;
  'maps.deleteProfile': typeof mapsDeleteProfile;
  'maps.updateCallouts': typeof mapsUpdateCallouts;
  'settings.update': typeof settingsUpdate;
  'steam.pickCs2Path': typeof steamPickCs2Path;
  'updates.check': typeof updatesCheck;
  'updates.install': typeof updatesInstall;
}
