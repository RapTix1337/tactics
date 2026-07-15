import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Single-row settings table (ADR-029, 03-technical-design.md §7.2): typed
 * columns instead of key-value pairs; the repository pins the row to id 1.
 * Booleans are deliberately plain integers (0/1) without drizzle's boolean
 * mode: the mode would silently coerce a corrupt value instead of letting the
 * tolerant read fall back to the field's default (settings-repository.ts).
 * Domain validation is the core schema's job — columns stay loose on purpose.
 */
/**
 * DDL default for `scoreboard_layout`, frozen when migration 0003 was
 * generated so a v1.0 row upgrades to real values (no fallback warnings).
 * Deliberately a literal, not derived from the code default: a later change
 * to DEFAULT_SCOREBOARD_LAYOUT must not alter this column default —
 * drizzle-kit would generate a table-recreate migration for it.
 */
const SCOREBOARD_LAYOUT_COLUMN_DEFAULT =
  '{"groups":[{"label":"Match totals","fields":["kills","deaths","assists","kd","mvps"]},' +
  '{"label":"Derived","fields":["hsRate"]},' +
  '{"label":"Live round state","fields":["health","armor","money","equipValue"]}]}';

export const settingsTable = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  theme: text('theme').notNull(),
  cs2Path: text('cs2_path'),
  gsiPort: integer('gsi_port'),
  autostart: integer('autostart').notNull(),
  closeToTray: integer('close_to_tray').notNull(),
  autoUpdate: integer('auto_update').notNull(),
  scoreboardEnabled: integer('scoreboard_enabled').notNull().default(1),
  scoreboardLayout: text('scoreboard_layout').notNull().default(SCOREBOARD_LAYOUT_COLUMN_DEFAULT),
  gsiTiming: text('gsi_timing').notNull().default('default'),
  overlayOpacity: real('overlay_opacity').notNull().default(1),
  overlayMapExempt: integer('overlay_map_exempt').notNull().default(0),
  overlayScoreboardExempt: integer('overlay_scoreboard_exempt').notNull().default(0),
});

/**
 * Single-row operational-state table (ADR-029), separate from user settings:
 * GSI auth token, effective GSI port, window bounds. The bounds group is
 * all-or-nothing — the repository flattens/reassembles it and treats a
 * partially set group as invalid. `window_maximized` is a plain 0/1 integer
 * for the same tolerant-read reason as the settings booleans above.
 */
export const operationalStateTable = sqliteTable('operational_state', {
  id: integer('id').primaryKey(),
  gsiToken: text('gsi_token').notNull(),
  effectiveGsiPort: integer('effective_gsi_port'),
  windowX: integer('window_x'),
  windowY: integer('window_y'),
  windowWidth: integer('window_width'),
  windowHeight: integer('window_height'),
  windowMaximized: integer('window_maximized'),
  // One JSON text column, not a second five-column group (OVL.2, ADR-058):
  // the overlay bounds are read/written only as a whole, and invalid JSON
  // degrades to null via the tolerant parse — no per-column repair needed.
  overlayBounds: text('overlay_bounds'),
});
