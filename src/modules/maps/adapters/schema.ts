import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Profile persistence tables (ADR-045, E22.1), generated into the central
 * migration journal per ADR-040. No SQLite foreign keys — consistent with the
 * existing schema (the `foreign_keys` pragma is off); the profile repository
 * maintains integrity inside transactions. Domain validation is the core
 * model's job — columns stay loose on purpose (see settings/adapters/schema.ts
 * for the same rationale).
 */

/**
 * One row per profile: a map has 0..n profiles, each owning its image file
 * (stored under userData by E22.2 — only the file name is persisted here) and
 * its own callout set. `created_at` (epoch ms) plus `id` give the
 * deterministic "first by creation" order behind the default fallback.
 */
export const mapProfilesTable = sqliteTable('map_profiles', {
  id: text('id').primaryKey(),
  mapId: text('map_id').notNull(),
  name: text('name').notNull(),
  imageFileName: text('image_file_name').notNull(),
  createdAt: integer('created_at').notNull(),
});

/**
 * The callouts of one profile, one row per callout. The composite primary key
 * makes callout names unique per profile by construction — the same invariant
 * the core schema enforces for default layouts.
 */
export const profileCalloutsTable = sqliteTable(
  'profile_callouts',
  {
    profileId: text('profile_id').notNull(),
    name: text('name').notNull(),
    x: real('x').notNull(),
    y: real('y').notNull(),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.name] })],
);

/**
 * The explicit default-profile marker: `map_id` as primary key makes "at most
 * one default per map" structural. Maps without a row fall back to the first
 * profile by creation (core/profile-model.ts).
 */
export const mapDefaultProfilesTable = sqliteTable('map_default_profiles', {
  mapId: text('map_id').primaryKey(),
  profileId: text('profile_id').notNull(),
});
