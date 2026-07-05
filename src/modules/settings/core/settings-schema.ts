import type { Settings, SettingsField } from '../../../shared';
import { SETTINGS_FIELD_SCHEMAS, SETTINGS_FIELDS } from '../../../shared';

/**
 * Persistence-side settings logic over the contract-owned shape and field
 * schemas in `shared/settings.ts` (E8.3 — one source of truth; modules may
 * import `shared`, ADR-021). This file owns what only persistence needs:
 * the binding defaults and the tolerant per-field read/merge.
 */

/** Binding defaults per 03-technical-design.md §7.3. */
export const SETTINGS_DEFAULTS: Settings = {
  theme: 'dark',
  cs2Path: null,
  gsiPort: null,
  autostart: false,
  closeToTray: true,
  autoUpdate: true,
};

export interface ParsedSettings {
  readonly settings: Settings;
  /** Fields whose raw value was invalid and fell back to their default. */
  readonly fallbacks: readonly SettingsField[];
}

/**
 * Tolerant per-field read (ADR-029, 03-technical-design.md §7.2): every field
 * is validated on its own; an invalid value falls back to that field's
 * default — one bad column never costs the other five. Unknown keys in `raw`
 * are ignored.
 */
export function parseSettings(raw: Readonly<Record<string, unknown>>): ParsedSettings {
  const fallbacks: SettingsField[] = [];
  const settings = { ...SETTINGS_DEFAULTS };
  for (const field of SETTINGS_FIELDS) {
    if (!applyField(settings, field, raw[field])) {
      fallbacks.push(field);
    }
  }
  return { settings, fallbacks };
}

function applyField<K extends SettingsField>(
  target: { -readonly [F in SettingsField]: Settings[F] },
  field: K,
  value: unknown,
): boolean {
  const result = SETTINGS_FIELD_SCHEMAS[field].safeParse(value);
  if (!result.success) {
    return false;
  }
  target[field] = result.data;
  return true;
}

/**
 * Applies a partial update over the current settings. Fields that are absent
 * or `undefined` keep their current value; an explicit `null` is a real value
 * (it resets `cs2Path` / `gsiPort` to automatic).
 */
export function mergeSettings(current: Settings, partial: Partial<Settings>): Settings {
  const merged = { ...current };
  for (const field of SETTINGS_FIELDS) {
    const value = partial[field];
    if (value !== undefined) {
      applyRawMerge(merged, field, value);
    }
  }
  return merged;
}

function applyRawMerge<K extends SettingsField>(
  target: { -readonly [F in SettingsField]: Settings[F] },
  field: K,
  value: Settings[K],
): void {
  target[field] = value;
}
