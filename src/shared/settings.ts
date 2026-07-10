import { z } from 'zod';

/**
 * The settings shape as it crosses the IPC boundary (03-technical-design.md
 * §5.3/§5.4) — the single source of truth for the six MVP settings
 * (01-requirements.md §9). The `settings` module builds its tolerant
 * persistence on the same field schemas (E8.1/E8.3); the renderer imports
 * the types only — validation stays main-only (ADR-022).
 */
export const THEMES = ['dark', 'light', 'system'] as const;

export type Theme = (typeof THEMES)[number];

/** The six MVP settings — exactly 01-requirements.md §9, nothing more. */
export interface Settings {
  readonly theme: Theme;
  /** Absolute CS2 install path; `null` = automatic detection via `steam`. */
  readonly cs2Path: string | null;
  /** Fixed GSI port; `null` = automatic (42730 + fallback chain, 05-gsi.md §6). */
  readonly gsiPort: number | null;
  readonly autostart: boolean;
  readonly closeToTray: boolean;
  readonly autoUpdate: boolean;
}

export type SettingsField = keyof Settings;

export const SETTINGS_FIELDS = [
  'theme',
  'cs2Path',
  'gsiPort',
  'autostart',
  'closeToTray',
  'autoUpdate',
] as const satisfies readonly SettingsField[];

/**
 * Per-field schemas — the unit of the module's tolerant per-field reads.
 * `satisfies` (not an annotation) keeps the concrete schema types visible:
 * the E16.1 form resolver needs the input types, which `z.ZodType<…>`
 * would erase to `unknown`.
 */
export const SETTINGS_FIELD_SCHEMAS = {
  theme: z.enum(THEMES),
  cs2Path: z.string().min(1).nullable(),
  gsiPort: z.number().int().min(1).max(65535).nullable(),
  autostart: z.boolean(),
  closeToTray: z.boolean(),
  autoUpdate: z.boolean(),
} satisfies { [K in SettingsField]: z.ZodType<Settings[K]> };

/** The full settings slice: `settings.update` response, event payload, snapshot slice. */
export const settingsSchema = z.object(SETTINGS_FIELD_SCHEMAS);

/**
 * The `settings.update` request: a partial of the six settings. Absent or
 * `undefined` fields keep their persisted value; an explicit `null` resets
 * `cs2Path`/`gsiPort` to automatic.
 */
export const settingsUpdateSchema = z.object(SETTINGS_FIELD_SCHEMAS).partial();

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
