import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '../../../shared';
import type { StorageDatabase } from './sqlite-database';
import { openDatabase } from './sqlite-database';

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

const tempDirs: string[] = [];
const openHandles: StorageDatabase[] = [];

function newTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'tactics-storage-'));
  tempDirs.push(directory);
  return directory;
}

function open(
  databasePath: string,
  logger: Logger = silentLogger,
): ReturnType<typeof openDatabase> {
  const result = openDatabase(databasePath, logger);
  openHandles.push(result.database);
  return result;
}

function corruptBackupsIn(directory: string): string[] {
  return readdirSync(directory).filter((name) => name.includes('.corrupt-'));
}

function single(items: readonly string[]): string {
  expect(items).toHaveLength(1);
  const [item] = items;
  if (item === undefined) {
    throw new Error('expected exactly one item');
  }
  return item;
}

afterEach(() => {
  for (const handle of openHandles.splice(0)) {
    handle.close();
  }
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('openDatabase', () => {
  it('opens a fresh database without recovery', () => {
    const databasePath = join(newTempDir(), 'tactics.db');

    const { database, recovered } = open(databasePath);

    expect(recovered).toBe(false);
    expect(database.drizzle.all(sql`select 1 as probe`)).toEqual([{ probe: 1 }]);
  });

  it('creates a missing parent directory', () => {
    const databasePath = join(newTempDir(), 'nested', 'tactics.db');

    const { recovered } = open(databasePath);

    expect(recovered).toBe(false);
  });

  it('reopens an existing healthy database with its data intact', () => {
    const databasePath = join(newTempDir(), 'tactics.db');
    const first = open(databasePath);
    first.database.drizzle.run(sql`create table probe (value text not null)`);
    first.database.drizzle.run(sql`insert into probe (value) values ('kept')`);
    first.database.close();

    const second = open(databasePath);

    expect(second.recovered).toBe(false);
    expect(second.database.drizzle.all(sql`select value from probe`)).toEqual([{ value: 'kept' }]);
  });

  it('backs up a file that is not a database and recreates a fresh one', () => {
    const directory = newTempDir();
    const databasePath = join(directory, 'tactics.db');
    const garbage = 'this is definitely not a SQLite database\n'.repeat(20);
    writeFileSync(databasePath, garbage);
    const warn = vi.fn();

    const { database, recovered } = open(databasePath, { ...silentLogger, warn });

    expect(recovered).toBe(true);
    const backupName = single(
      corruptBackupsIn(directory).filter(
        (name) => !name.endsWith('-wal') && !name.endsWith('-shm'),
      ),
    );
    expect(backupName).toMatch(/^tactics\.db\.corrupt-/);
    expect(readFileSync(join(directory, backupName), 'utf8')).toBe(garbage);
    expect(database.drizzle.all(sql`select 1 as probe`)).toEqual([{ probe: 1 }]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('recovers when the database body is corrupted behind a valid header', () => {
    const directory = newTempDir();
    const databasePath = join(directory, 'tactics.db');
    const seeded = open(databasePath);
    seeded.database.drizzle.run(sql`create table probe (value text not null)`);
    for (let row = 0; row < 200; row += 1) {
      seeded.database.drizzle.run(sql`insert into probe (value) values (${'x'.repeat(100)})`);
    }
    seeded.database.close();
    const content = readFileSync(databasePath);
    content.fill(0xff, 4096);
    writeFileSync(databasePath, content);

    const { database, recovered } = open(databasePath);

    expect(recovered).toBe(true);
    expect(corruptBackupsIn(directory).length).toBeGreaterThanOrEqual(1);
    expect(database.drizzle.all(sql`select 1 as probe`)).toEqual([{ probe: 1 }]);
  });

  it('does not let stale WAL sidecars survive next to the recreated database', () => {
    const directory = newTempDir();
    const databasePath = join(directory, 'tactics.db');
    writeFileSync(databasePath, 'garbage');
    writeFileSync(`${databasePath}-wal`, 'stale wal');
    writeFileSync(`${databasePath}-shm`, 'stale shm');

    const { database, recovered } = open(databasePath);

    expect(recovered).toBe(true);
    // The stale sidecars never attach to the new database: SQLite removes
    // invalid ones during the failed open; anything it leaves behind is
    // moved aside next to the backup by the recovery.
    for (const suffix of ['-wal', '-shm']) {
      const livePath = `${databasePath}${suffix}`;
      if (existsSync(livePath)) {
        expect(readFileSync(livePath, 'utf8')).not.toContain('stale');
      }
    }
    expect(database.drizzle.all(sql`select 1 as probe`)).toEqual([{ probe: 1 }]);
  });

  it('close is idempotent', () => {
    const { database } = open(join(newTempDir(), 'tactics.db'));

    database.close();

    expect(() => {
      database.close();
    }).not.toThrow();
  });
});
