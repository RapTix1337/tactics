import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type { Logger, Settings, SettingsField } from '../../../shared';
import { mergeSettings, parseSettings, SETTINGS_DEFAULTS } from '../core/settings-schema';
import { settingsTable } from './schema';

/**
 * The narrow slice of the storage handle this module needs. A structural port
 * on purpose: modules never import each other (ADR-021), so `settings` cannot
 * import `storage` — `app` injects the real StorageDatabase, which satisfies
 * this shape as-is.
 */
export interface SettingsStoragePort {
  readonly drizzle: BetterSQLite3Database;
  withTransaction<T>(fn: (transaction: BetterSQLite3Database) => T): T;
}

export interface SettingsRepository {
  /**
   * Loads the persisted settings tolerantly: a missing row (first run) is the
   * defaults; an invalid stored value falls back to that field's default with
   * a warning — never total loss (03-technical-design.md §7.2).
   */
  getSettings(): Settings;
  /**
   * Validates and persists a partial update, returning the full new state.
   * `undefined` fields keep their value; explicit `null` resets
   * `cs2Path`/`gsiPort` to automatic. An invalid value throws `TypeError`
   * and persists nothing.
   */
  updateSettings(partial: Partial<Settings>): Settings;
}

const SETTINGS_ROW_ID = 1;

/** The settings fields persisted as 0/1 integers (see schema.ts). */
export type BooleanSettingsField = {
  [K in SettingsField]: Settings[K] extends boolean ? K : never;
}[SettingsField];

// `satisfies` pins membership; completeness is type-tested in the colocated
// test — a new boolean setting missing here would persist unencoded.
const BOOLEAN_FIELDS = [
  'autostart',
  'closeToTray',
  'autoUpdate',
] as const satisfies readonly BooleanSettingsField[];

export function createSettingsRepository(
  storage: SettingsStoragePort,
  logger: Logger,
): SettingsRepository {
  return {
    getSettings(): Settings {
      return readSettings(storage.drizzle, logger);
    },
    updateSettings(partial: Partial<Settings>): Settings {
      return storage.withTransaction((transaction) => {
        const merged = mergeSettings(readSettings(transaction, logger), partial);
        const { settings, fallbacks } = parseSettings({ ...merged });
        if (fallbacks.length > 0) {
          // The stored state is already validated, so any invalid field can
          // only come from the partial — reject instead of falling back.
          throw new TypeError(`invalid settings update for field(s): ${fallbacks.join(', ')}`);
        }
        transaction
          .insert(settingsTable)
          .values({ id: SETTINGS_ROW_ID, ...encodeStoredSettings(settings) })
          .onConflictDoUpdate({
            target: settingsTable.id,
            set: encodeStoredSettings(settings),
          })
          .run();
        return settings;
      });
    },
  };
}

function readSettings(database: BetterSQLite3Database, logger: Logger): Settings {
  const row = database
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.id, SETTINGS_ROW_ID))
    .get();
  if (row === undefined) {
    // First run — nothing stored yet; not an anomaly, so no warning.
    return SETTINGS_DEFAULTS;
  }
  // SQLite's dynamic typing means the row may hold anything despite the
  // column types — treat it as untrusted and re-validate (CLAUDE.md §5).
  const { settings, fallbacks } = parseSettings(decodeStoredRow({ ...row }));
  for (const field of fallbacks) {
    logger.warn('invalid stored settings value replaced by its default', { field });
  }
  return settings;
}

/**
 * Stored → domain representation: booleans persist as 0/1 integers. Only the
 * exact literals decode; anything else stays as-is so the tolerant parse
 * falls back to the default instead of silently coercing.
 */
function decodeStoredRow(row: Record<string, unknown>): Record<string, unknown> {
  const decoded = { ...row };
  for (const field of BOOLEAN_FIELDS) {
    const value = decoded[field];
    if (value === 0 || value === 1) {
      decoded[field] = value === 1;
    }
  }
  return decoded;
}

function encodeStoredSettings(settings: Settings): Omit<typeof settingsTable.$inferInsert, 'id'> {
  return {
    theme: settings.theme,
    cs2Path: settings.cs2Path,
    gsiPort: settings.gsiPort,
    autostart: settings.autostart ? 1 : 0,
    closeToTray: settings.closeToTray ? 1 : 0,
    autoUpdate: settings.autoUpdate ? 1 : 0,
  };
}
