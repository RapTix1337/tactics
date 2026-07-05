import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '../../../shared';
import type { Migration } from '../core/migration-plan';
import { SchemaDowngradeError } from '../core/migration-plan';
import type { StorageDatabase } from './sqlite-database';
import { openDatabase } from './sqlite-database';

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

const createSettings: Migration = {
  id: 0,
  name: '0000_create_settings',
  sql: 'create table settings (id integer primary key, theme text not null);',
};

const createState: Migration = {
  id: 1,
  name: '0001_create_state',
  sql:
    // Mirrors a real drizzle-kit file: multiple statements separated by its
    // breakpoint marker, which is a plain SQL line comment.
    'create table state (id integer primary key, port integer not null);\n' +
    '--> statement-breakpoint\n' +
    'create index state_port_idx on state (port);',
};

const tempDirs: string[] = [];
const openHandles: StorageDatabase[] = [];

function newDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'tactics-migrations-'));
  tempDirs.push(directory);
  return join(directory, 'tactics.db');
}

function open(databasePath: string, logger: Logger = silentLogger): StorageDatabase {
  const { database } = openDatabase(databasePath, logger);
  openHandles.push(database);
  return database;
}

function openFresh(logger: Logger = silentLogger): StorageDatabase {
  return open(newDatabasePath(), logger);
}

function appliedVersions(database: StorageDatabase): number[] {
  const rows = database.drizzle.all<{ id: number }>(
    sql`select id from schema_migrations order by id`,
  );
  return rows.map((row) => row.id);
}

function tableNames(database: StorageDatabase): string[] {
  const rows = database.drizzle.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' order by name`,
  );
  return rows.map((row) => row.name);
}

afterEach(() => {
  for (const handle of openHandles.splice(0)) {
    handle.close();
  }
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('migrate', () => {
  it('applies all migrations to a fresh database and records the schema version', () => {
    const info = vi.fn();
    const database = openFresh({ ...silentLogger, info });

    database.migrate([createSettings, createState]);

    expect(tableNames(database)).toEqual(['schema_migrations', 'settings', 'state']);
    expect(appliedVersions(database)).toEqual([0, 1]);
    expect(info).toHaveBeenCalledWith('database migrations applied', {
      appliedCount: 2,
      schemaVersion: 1,
    });
  });

  it('applies only the pending migration to an existing database, keeping its data', () => {
    const databasePath = newDatabasePath();
    const first = open(databasePath);
    first.migrate([createSettings]);
    first.drizzle.run(sql`insert into settings (theme) values ('dark')`);
    first.close();

    const second = open(databasePath);
    second.migrate([createSettings, createState]);

    expect(appliedVersions(second)).toEqual([0, 1]);
    expect(second.drizzle.all(sql`select theme from settings`)).toEqual([{ theme: 'dark' }]);
  });

  it('re-running with the same migrations is a no-op and does not log', () => {
    const info = vi.fn();
    const database = openFresh({ ...silentLogger, info });
    database.migrate([createSettings]);
    info.mockClear();

    database.migrate([createSettings]);

    expect(appliedVersions(database)).toEqual([0]);
    expect(info).not.toHaveBeenCalled();
  });

  it('rejects an older app opening a newer database without touching it', () => {
    const database = openFresh();
    database.migrate([createSettings, createState]);
    database.drizzle.run(sql`insert into settings (theme) values ('dark')`);

    expect(() => {
      database.migrate([createSettings]);
    }).toThrow(SchemaDowngradeError);
    expect(appliedVersions(database)).toEqual([0, 1]);
    expect(database.drizzle.all(sql`select theme from settings`)).toEqual([{ theme: 'dark' }]);
  });

  it('rolls a failing migration back completely, keeping the previous version', () => {
    const database = openFresh();
    const failing: Migration = {
      id: 1,
      name: '0001_failing',
      sql:
        'create table state (id integer primary key);\n' +
        '--> statement-breakpoint\n' +
        'this is not sql;',
    };

    expect(() => {
      database.migrate([createSettings, failing]);
    }).toThrow();
    // The first migration stays applied; the failing one left nothing behind —
    // neither its tracking row nor its first, individually valid statement.
    expect(appliedVersions(database)).toEqual([0]);
    expect(tableNames(database)).toEqual(['schema_migrations', 'settings']);
  });
});

describe('withTransaction', () => {
  it('commits the callback result', () => {
    const database = openFresh();
    database.migrate([createSettings]);

    const inserted = database.withTransaction((transaction) => {
      transaction.run(sql`insert into settings (theme) values ('dark')`);
      transaction.run(sql`insert into settings (theme) values ('light')`);
      return 2;
    });

    expect(inserted).toBe(2);
    expect(database.drizzle.all(sql`select count(*) as rows from settings`)).toEqual([{ rows: 2 }]);
  });

  it('rolls everything back when the callback throws', () => {
    const database = openFresh();
    database.migrate([createSettings]);

    expect(() =>
      database.withTransaction((transaction) => {
        transaction.run(sql`insert into settings (theme) values ('dark')`);
        throw new Error('domain failure');
      }),
    ).toThrow('domain failure');
    expect(database.drizzle.all(sql`select count(*) as rows from settings`)).toEqual([{ rows: 0 }]);
  });

  it('rejects an async callback and rolls its statements back', () => {
    const database = openFresh();
    database.migrate([createSettings]);

    expect(() =>
      database.withTransaction(async (transaction) => {
        transaction.run(sql`insert into settings (theme) values ('dark')`);
        return Promise.resolve();
      }),
    ).toThrow(TypeError);
    expect(database.drizzle.all(sql`select count(*) as rows from settings`)).toEqual([{ rows: 0 }]);
  });
});
