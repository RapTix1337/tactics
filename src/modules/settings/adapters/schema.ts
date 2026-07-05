import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Single-row settings table (ADR-029, 03-technical-design.md §7.2): typed
 * columns instead of key-value pairs; the repository pins the row to id 1.
 * Booleans are deliberately plain integers (0/1) without drizzle's boolean
 * mode: the mode would silently coerce a corrupt value instead of letting the
 * tolerant read fall back to the field's default (settings-repository.ts).
 * Domain validation is the core schema's job — columns stay loose on purpose.
 */
export const settingsTable = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  theme: text('theme').notNull(),
  cs2Path: text('cs2_path'),
  gsiPort: integer('gsi_port'),
  autostart: integer('autostart').notNull(),
  closeToTray: integer('close_to_tray').notNull(),
  autoUpdate: integer('auto_update').notNull(),
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
});
