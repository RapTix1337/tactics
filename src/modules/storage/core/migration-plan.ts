/**
 * A single forward-only schema migration (ADR-029/040): the content of one
 * drizzle-kit-generated SQL file. `id` is its position in the central journal
 * (0-based file prefix); the highest applied id is the database's schema
 * version. `sql` may contain multiple statements — drizzle-kit's
 * `--> statement-breakpoint` lines are SQL comments and pass through as-is.
 */
export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

/** A migration recorded as applied in the database's tracking table. */
export interface AppliedMigration {
  readonly id: number;
  readonly name: string;
}

/**
 * The database was written by a newer app version: it records migrations this
 * build does not know. Forward-only means never touching such a database —
 * `app` surfaces this to the user instead of risking data loss (E7.3).
 */
export class SchemaDowngradeError extends Error {
  override readonly name = 'SchemaDowngradeError';

  constructor(
    readonly databaseVersion: number,
    readonly applicationVersion: number,
  ) {
    super(
      `database schema version ${String(databaseVersion)} is newer than this app's ` +
        `version ${String(applicationVersion)} — refusing to run an older app against a newer database`,
    );
  }
}

/**
 * The applied history diverges from the bundled migration sequence (an id or
 * name mismatch). This never happens under the single central journal
 * (ADR-040) — it signals a manually altered database or a broken build.
 */
export class MigrationHistoryMismatchError extends Error {
  override readonly name = 'MigrationHistoryMismatchError';

  constructor(detail: string) {
    super(`database migration history does not match the bundled migrations: ${detail}`);
  }
}

/**
 * Decides which of the bundled migrations still need to run. The applied
 * history must be exactly the first N bundled migrations (the central journal
 * guarantees a strictly total order, ADR-040); anything else is one of the
 * typed errors above.
 */
export function planMigrations(
  applied: readonly AppliedMigration[],
  available: readonly Migration[],
): readonly Migration[] {
  assertStrictlyIncreasingIds(available);
  const appliedInOrder = [...applied].sort((a, b) => a.id - b.id);
  if (appliedInOrder.length > available.length) {
    throw new SchemaDowngradeError(
      schemaVersion(appliedInOrder),
      available.length > 0 ? schemaVersion(available) : -1,
    );
  }
  appliedInOrder.forEach((record, position) => {
    const bundled = available[position];
    if (bundled === undefined || bundled.id !== record.id || bundled.name !== record.name) {
      throw new MigrationHistoryMismatchError(
        `applied migration ${String(record.id)} "${record.name}" does not match bundled ` +
          `migration ${bundled === undefined ? '(none)' : `${String(bundled.id)} "${bundled.name}"`} at position ${String(position)}`,
      );
    }
  });
  return available.slice(appliedInOrder.length);
}

function assertStrictlyIncreasingIds(available: readonly Migration[]): void {
  for (let index = 1; index < available.length; index += 1) {
    const previous = available[index - 1];
    const current = available[index];
    if (previous !== undefined && current !== undefined && current.id <= previous.id) {
      throw new MigrationHistoryMismatchError(
        `bundled migration ids must be strictly increasing, got ${String(previous.id)} before ${String(current.id)}`,
      );
    }
  }
}

function schemaVersion(records: ReadonlyArray<{ readonly id: number }>): number {
  const last = records.at(-1);
  if (last === undefined) {
    throw new Error('schemaVersion requires at least one record');
  }
  return last.id;
}
