import { z } from 'zod';

/**
 * The settings shape as it crosses the IPC boundary (03-technical-design.md
 * §5.3/§5.4) — the single source of truth for the MVP settings
 * (01-requirements.md §9) plus the live-scoreboard fields (ADR-053). The
 * `settings` module builds its tolerant persistence on the same field
 * schemas (E8.1/E8.3); the renderer imports the types only — validation
 * stays main-only (ADR-022).
 */
export const THEMES = ['dark', 'light', 'system'] as const;

export type Theme = (typeof THEMES)[number];

/**
 * The closed set of scoreboard stat fields a layout may reference
 * (live-scoreboard 02-design.md §3.3; no `adr` — ADR-055). `kd`/`kMinusD`
 * are renderer-derived but are layout entries like any other.
 */
export const FIELD_IDS = [
  'kills',
  'assists',
  'deaths',
  'mvps',
  'score',
  'kd',
  'kMinusD',
  'hsRate',
  'hsKills',
  'health',
  'armor',
  'money',
  'equipValue',
  'roundKills',
  'roundHsKills',
] as const;

export type FieldId = (typeof FIELD_IDS)[number];

/** GSI timing profiles (ADR-051): buffer/throttle presets for the CS2 config. */
export const GSI_TIMINGS = ['slow', 'default', 'fast'] as const;

export type GsiTiming = (typeof GSI_TIMINGS)[number];

export interface ScoreboardLayoutGroup {
  readonly label: string;
  readonly fields: readonly FieldId[];
}

/** The user-composed scoreboard: ordered groups of stat tiles (ADR-053). */
export interface ScoreboardLayout {
  readonly groups: readonly ScoreboardLayoutGroup[];
}

export const SCOREBOARD_GROUP_LABEL_MAX_LENGTH = 24;

const FIELD_ID_SET: ReadonlySet<string> = new Set(FIELD_IDS);

function isFieldId(value: unknown): value is FieldId {
  return typeof value === 'string' && FIELD_ID_SET.has(value);
}

/**
 * Normalizing layout schema (ADR-053): unknown field ids are dropped and
 * duplicates collapsed (first occurrence wins, across groups) so a layout
 * written by a different app version degrades instead of failing whole;
 * a layout without a single surviving field is invalid — the tolerant read
 * then falls back to the complete default layout, never partially.
 */
export const scoreboardLayoutSchema = z
  .object({
    groups: z.array(
      z.object({
        label: z.string().max(SCOREBOARD_GROUP_LABEL_MAX_LENGTH),
        fields: z.array(z.unknown()).transform((fields) => fields.filter(isFieldId)),
      }),
    ),
  })
  .transform(({ groups }): ScoreboardLayout => {
    const seen = new Set<FieldId>();
    return {
      groups: groups.map((group) => ({
        label: group.label,
        fields: group.fields.filter((field) => {
          if (seen.has(field)) {
            return false;
          }
          seen.add(field);
          return true;
        }),
      })),
    };
  })
  .refine((layout) => layout.groups.some((group) => group.fields.length > 0), {
    message: 'scoreboard layout needs at least one field',
  });

/**
 * The MVP settings of 01-requirements.md §9 plus the scoreboard fields
 * (ADR-053) and the live-overlay fields (ADR-058).
 */
export interface Settings {
  readonly theme: Theme;
  /** Absolute CS2 install path; `null` = automatic detection via `steam`. */
  readonly cs2Path: string | null;
  /** Fixed GSI port; `null` = automatic (42730 + fallback chain, 05-gsi.md §6). */
  readonly gsiPort: number | null;
  readonly autostart: boolean;
  readonly closeToTray: boolean;
  readonly autoUpdate: boolean;
  readonly scoreboardEnabled: boolean;
  readonly scoreboardLayout: ScoreboardLayout;
  readonly gsiTiming: GsiTiming;
  /** Overlay base fade, 0–1 with no floor (ADR-058); exemptions pin a region to 1. */
  readonly overlayOpacity: number;
  readonly overlayMapExempt: boolean;
  readonly overlayScoreboardExempt: boolean;
}

export type SettingsField = keyof Settings;

export const SETTINGS_FIELDS = [
  'theme',
  'cs2Path',
  'gsiPort',
  'autostart',
  'closeToTray',
  'autoUpdate',
  'scoreboardEnabled',
  'scoreboardLayout',
  'gsiTiming',
  'overlayOpacity',
  'overlayMapExempt',
  'overlayScoreboardExempt',
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
  scoreboardEnabled: z.boolean(),
  scoreboardLayout: scoreboardLayoutSchema,
  gsiTiming: z.enum(GSI_TIMINGS),
  overlayOpacity: z.number().min(0).max(1),
  overlayMapExempt: z.boolean(),
  overlayScoreboardExempt: z.boolean(),
} satisfies { [K in SettingsField]: z.ZodType<Settings[K]> };

/** The full settings slice: `settings.update` response, event payload, snapshot slice. */
export const settingsSchema = z.object(SETTINGS_FIELD_SCHEMAS);

/**
 * The `settings.update` request: a partial of the settings fields. Absent or
 * `undefined` fields keep their persisted value; an explicit `null` resets
 * `cs2Path`/`gsiPort` to automatic.
 */
export const settingsUpdateSchema = z.object(SETTINGS_FIELD_SCHEMAS).partial();

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
