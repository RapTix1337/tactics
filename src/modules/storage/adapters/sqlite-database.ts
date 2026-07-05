import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { Logger } from '../../../shared';
import { corruptBackupFileName } from '../core/corrupt-backup';
import type { Migration } from '../core/migration-plan';
import { runMigrations } from './migration-runner';

/** An open database handle (03-technical-design.md §4.6). */
export interface StorageDatabase {
  /** Typed query access per ADR-029. */
  readonly drizzle: BetterSQLite3Database;
  /**
   * Applies pending migrations forward-only; `app` calls this at startup
   * before any module access. Throws `SchemaDowngradeError` when the database
   * was written by a newer app version (see migration-runner).
   */
  migrate(migrations: readonly Migration[]): void;
  /**
   * Runs `fn` inside a single transaction: any throw rolls every statement
   * back and rethrows. Synchronous only (better-sqlite3) — a callback
   * returning a Promise is rejected before commit.
   */
  withTransaction<T>(fn: (transaction: BetterSQLite3Database) => T): T;
  /** Idempotent: closing an already closed database is a no-op. */
  close(): void;
}

export interface OpenDatabaseResult {
  database: StorageDatabase;
  /**
   * True when the existing file was corrupt: it was backed up aside as
   * `<name>.corrupt-<timestamp>` and a fresh database was created in its
   * place (ADR-023) — `app` uses this flag to inform the user.
   */
  recovered: boolean;
}

/**
 * Opens the single SQLite database (ADR-023) tolerantly: a file that fails
 * to open or fails `PRAGMA integrity_check` is moved aside — together with
 * its WAL sidecars — and a fresh database is created. Only environment-level
 * failures (the backup rename or the fresh creation itself failing) throw.
 */
export function openDatabase(databasePath: string, logger: Logger): OpenDatabaseResult {
  mkdirSync(dirname(databasePath), { recursive: true });
  const attempt = openVerified(databasePath);
  if (attempt.ok) {
    return { database: toStorageDatabase(attempt.connection, logger), recovered: false };
  }
  backUpCorruptDatabase(databasePath, attempt.reason, logger);
  const retry = openVerified(databasePath);
  if (!retry.ok) {
    throw new Error(`opening a freshly created database failed: ${retry.reason}`);
  }
  return { database: toStorageDatabase(retry.connection, logger), recovered: true };
}

type OpenAttempt = { ok: true; connection: Database.Database } | { ok: false; reason: string };

function openVerified(databasePath: string): OpenAttempt {
  let connection: Database.Database | undefined;
  try {
    connection = new Database(databasePath);
    connection.pragma('journal_mode = WAL');
    const integrity: unknown = connection.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error(`integrity check reported: ${String(integrity)}`);
    }
    return { ok: true, connection };
  } catch (error) {
    try {
      connection?.close();
    } catch {
      // the connection is being discarded — a failing close changes nothing
    }
    return { ok: false, reason: errorMessage(error) };
  }
}

function backUpCorruptDatabase(databasePath: string, reason: string, logger: Logger): void {
  const directory = dirname(databasePath);
  const backupName = corruptBackupFileName(basename(databasePath), new Date());
  renameSync(databasePath, join(directory, backupName));
  // Stale WAL sidecars must not attach to the recreated database; they move
  // next to the backup so their unflushed data stays inspectable too.
  for (const suffix of ['-wal', '-shm']) {
    moveIfExists(`${databasePath}${suffix}`, join(directory, `${backupName}${suffix}`));
  }
  logger.warn('corrupt database backed up aside; recreating fresh', {
    reason,
    backupFileName: backupName,
  });
}

function moveIfExists(sourcePath: string, targetPath: string): void {
  if (existsSync(sourcePath)) {
    renameSync(sourcePath, targetPath);
  }
}

function toStorageDatabase(connection: Database.Database, logger: Logger): StorageDatabase {
  const typedAccess = drizzle(connection);
  return {
    drizzle: typedAccess,
    migrate(migrations: readonly Migration[]): void {
      runMigrations(connection, migrations, logger);
    },
    withTransaction<T>(fn: (transaction: BetterSQLite3Database) => T): T {
      return connection.transaction(() => {
        const result = fn(typedAccess);
        if (result instanceof Promise) {
          // Throwing inside the transaction rolls it back — an async callback
          // would otherwise commit before its work ran (better-sqlite3 is sync).
          throw new TypeError('withTransaction callback must be synchronous');
        }
        return result;
      })();
    },
    close(): void {
      if (connection.open) {
        connection.close();
      }
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
