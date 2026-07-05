import type Database from 'better-sqlite3';

import type { Logger } from '../../../shared';
import type { AppliedMigration, Migration } from '../core/migration-plan';
import { planMigrations } from '../core/migration-plan';

/**
 * The tracking table is created by the runner itself — deliberately not a
 * Drizzle schema, or drizzle-kit would generate a migration for the table
 * that records migrations (ADR-040).
 */
const TRACKING_TABLE_DDL = `create table if not exists schema_migrations (
  id integer primary key,
  name text not null,
  applied_at text not null
)`;

/**
 * Applies all pending migrations forward-only (ADR-029): each migration runs
 * atomically in its own transaction together with its tracking row, so a
 * failing migration leaves the database exactly at the previous version.
 * Re-running with the same list is a no-op; a database written by a newer app
 * throws `SchemaDowngradeError` before touching anything.
 */
export function runMigrations(
  connection: Database.Database,
  migrations: readonly Migration[],
  logger: Logger,
): void {
  connection.exec(TRACKING_TABLE_DDL);
  // Cast, not Zod: this reads the runner's own table created above, whose
  // shape is fixed by the DDL — not external input (CLAUDE.md §5 boundary).
  const applied = connection
    .prepare('select id, name from schema_migrations order by id')
    .all() as AppliedMigration[];
  const pending = planMigrations(applied, migrations);
  const insertTrackingRow = connection.prepare(
    'insert into schema_migrations (id, name, applied_at) values (?, ?, ?)',
  );
  for (const migration of pending) {
    connection.transaction(() => {
      connection.exec(migration.sql);
      insertTrackingRow.run(migration.id, migration.name, new Date().toISOString());
    })();
  }
  const last = pending.at(-1);
  if (last !== undefined) {
    logger.info('database migrations applied', {
      appliedCount: pending.length,
      schemaVersion: last.id,
    });
  }
}
