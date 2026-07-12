import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { Logger, Settings } from '../../../shared';
import { SETTINGS_DEFAULTS } from '../core/settings-schema';
import type { BooleanSettingsField, SettingsStoragePort } from './settings-repository';
import { createSettingsRepository } from './settings-repository';

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

// The real generated DDL, not a hand-written copy: the test proves the
// repository works against exactly what `pnpm db:generate` produced
// (ADR-040). Reading files crosses no module boundary — imports do.
const MIGRATIONS_DIRECTORY = join(import.meta.dirname, '..', '..', 'storage', 'migrations');

function applyGeneratedMigrations(connection: Database.Database): void {
  const files = readdirSync(MIGRATIONS_DIRECTORY)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    connection.exec(readFileSync(join(MIGRATIONS_DIRECTORY, file), 'utf8'));
  }
}

const connections: Database.Database[] = [];
const tempDirs: string[] = [];

function openPort(databasePath = ':memory:'): SettingsStoragePort {
  const connection = new Database(databasePath);
  connections.push(connection);
  // Only a fresh database gets the DDL — reopening an existing file must not
  // re-apply it (the real runner tracks applied migrations, E7.3).
  const hasSchema = connection
    .prepare("select 1 from sqlite_master where type = 'table' and name = 'settings'")
    .get();
  if (hasSchema === undefined) {
    applyGeneratedMigrations(connection);
  }
  const typedAccess = drizzle(connection);
  return {
    drizzle: typedAccess,
    withTransaction: (fn) => connection.transaction(() => fn(typedAccess))(),
  };
}

function newDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'tactics-settings-'));
  tempDirs.push(directory);
  return join(directory, 'tactics.db');
}

afterEach(() => {
  for (const connection of connections.splice(0)) {
    if (connection.open) {
      connection.close();
    }
  }
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('getSettings', () => {
  it('returns the defaults on a fresh database without warning (first run)', () => {
    const warn = vi.fn();
    const repository = createSettingsRepository(openPort(), { ...silentLogger, warn });

    expect(repository.getSettings()).toEqual(SETTINGS_DEFAULTS);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('updateSettings', () => {
  it('persists a partial update and returns the full new state (round trip)', () => {
    const repository = createSettingsRepository(openPort(), silentLogger);

    const updated = repository.updateSettings({ theme: 'light', gsiPort: 42731 });

    expect(updated).toEqual({ ...SETTINGS_DEFAULTS, theme: 'light', gsiPort: 42731 });
    expect(repository.getSettings()).toEqual(updated);
  });

  it('merges sequential updates instead of resetting earlier ones', () => {
    const repository = createSettingsRepository(openPort(), silentLogger);

    repository.updateSettings({ theme: 'light' });
    repository.updateSettings({ autostart: true });

    expect(repository.getSettings()).toEqual({
      ...SETTINGS_DEFAULTS,
      theme: 'light',
      autostart: true,
    });
  });

  it('survives a database close and reopen (persistence round trip)', () => {
    const databasePath = newDatabasePath();
    const first = createSettingsRepository(openPort(databasePath), silentLogger);
    first.updateSettings({ theme: 'system', cs2Path: 'C:\\Games\\CS2', closeToTray: false });
    for (const connection of connections.splice(0)) {
      connection.close();
    }

    const second = createSettingsRepository(openPort(databasePath), silentLogger);

    expect(second.getSettings()).toEqual({
      ...SETTINGS_DEFAULTS,
      theme: 'system',
      cs2Path: 'C:\\Games\\CS2',
      closeToTray: false,
    });
  });

  it('resets cs2Path to automatic on an explicit null', () => {
    const repository = createSettingsRepository(openPort(), silentLogger);
    repository.updateSettings({ cs2Path: 'C:\\Games\\CS2' });

    const updated = repository.updateSettings({ cs2Path: null });

    expect(updated.cs2Path).toBeNull();
    expect(repository.getSettings().cs2Path).toBeNull();
  });

  it('rejects an invalid value with TypeError and persists nothing', () => {
    const port = openPort();
    const repository = createSettingsRepository(port, silentLogger);
    repository.updateSettings({ theme: 'light' });

    expect(() =>
      repository.updateSettings({ theme: 'blurple' as Settings['theme'], autostart: true }),
    ).toThrow(TypeError);
    expect(repository.getSettings()).toEqual({ ...SETTINGS_DEFAULTS, theme: 'light' });
  });

  it('keeps exactly one settings row across many updates', () => {
    const port = openPort();
    const repository = createSettingsRepository(port, silentLogger);

    repository.updateSettings({ theme: 'light' });
    repository.updateSettings({ theme: 'dark' });
    repository.updateSettings({ autoUpdate: false });

    expect(port.drizzle.all(sql`select count(*) as rows from settings`)).toEqual([{ rows: 1 }]);
  });
});

describe('scoreboard and timing fields (SCB.3, ADR-053)', () => {
  it('round-trips the layout JSON and enum fields across close and reopen', () => {
    const databasePath = newDatabasePath();
    const layout = {
      groups: [
        { label: 'Mine', fields: ['kills', 'hsRate'] },
        { label: 'Cash', fields: ['money'] },
      ],
    } as const;
    const first = createSettingsRepository(openPort(databasePath), silentLogger);
    first.updateSettings({ scoreboardEnabled: false, scoreboardLayout: layout, gsiTiming: 'fast' });
    for (const connection of connections.splice(0)) {
      connection.close();
    }

    const second = createSettingsRepository(openPort(databasePath), silentLogger);

    expect(second.getSettings()).toEqual({
      ...SETTINGS_DEFAULTS,
      scoreboardEnabled: false,
      scoreboardLayout: layout,
      gsiTiming: 'fast',
    });
  });

  it('falls back to the whole default layout on unparseable JSON (logged)', () => {
    const warn = vi.fn();
    const port = openPort();
    const repository = createSettingsRepository(port, { ...silentLogger, warn });
    repository.updateSettings({ theme: 'light' });
    port.drizzle.run(sql`update settings set scoreboard_layout = '{"groups": [broken'`);

    const settings = repository.getSettings();

    expect(settings.scoreboardLayout).toEqual(SETTINGS_DEFAULTS.scoreboardLayout);
    expect(settings.theme).toBe('light');
    expect(warn).toHaveBeenCalledWith('invalid stored settings value replaced by its default', {
      field: 'scoreboardLayout',
    });
  });

  it('falls back to the whole default layout on valid JSON with an invalid shape', () => {
    const warn = vi.fn();
    const port = openPort();
    const repository = createSettingsRepository(port, { ...silentLogger, warn });
    repository.updateSettings({ theme: 'light' });
    // Parses as JSON but has zero fields — must never survive partially.
    port.drizzle.run(sql`update settings set scoreboard_layout = '{"groups":[]}'`);

    expect(repository.getSettings().scoreboardLayout).toEqual(SETTINGS_DEFAULTS.scoreboardLayout);
    expect(warn).toHaveBeenCalledWith('invalid stored settings value replaced by its default', {
      field: 'scoreboardLayout',
    });
  });

  it('falls back to the default timing on an unknown profile value', () => {
    const warn = vi.fn();
    const port = openPort();
    const repository = createSettingsRepository(port, { ...silentLogger, warn });
    repository.updateSettings({ gsiTiming: 'fast' });
    port.drizzle.run(sql`update settings set gsi_timing = 'turbo'`);

    expect(repository.getSettings().gsiTiming).toBe(SETTINGS_DEFAULTS.gsiTiming);
    expect(warn).toHaveBeenCalledWith('invalid stored settings value replaced by its default', {
      field: 'gsiTiming',
    });
  });

  it('rejects an invalid layout update with TypeError and persists nothing', () => {
    const repository = createSettingsRepository(openPort(), silentLogger);

    // Type-valid but runtime-invalid: zero fields fails the schema's refine.
    expect(() => repository.updateSettings({ scoreboardLayout: { groups: [] } })).toThrow(
      TypeError,
    );
    expect(repository.getSettings().scoreboardLayout).toEqual(SETTINGS_DEFAULTS.scoreboardLayout);
  });
});

describe('v1.0 database upgrade (migration 0003)', () => {
  it('adds the three columns with real defaults — existing values kept, no warnings', () => {
    const warn = vi.fn();
    const connection = new Database(':memory:');
    connections.push(connection);
    const files = readdirSync(MIGRATIONS_DIRECTORY)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    const preScoreboard = files.filter((name) => !name.startsWith('0003'));
    expect(preScoreboard.length).toBe(files.length - 1);
    for (const file of preScoreboard) {
      connection.exec(readFileSync(join(MIGRATIONS_DIRECTORY, file), 'utf8'));
    }
    // A settled v1.0 row written before the scoreboard columns existed.
    connection
      .prepare(
        `insert into settings (id, theme, cs2_path, gsi_port, autostart, close_to_tray, auto_update)
         values (1, 'light', 'C:\\Games\\CS2', 42731, 1, 0, 1)`,
      )
      .run();

    for (const file of files.filter((name) => name.startsWith('0003'))) {
      connection.exec(readFileSync(join(MIGRATIONS_DIRECTORY, file), 'utf8'));
    }
    const typedAccess = drizzle(connection);
    const repository = createSettingsRepository(
      {
        drizzle: typedAccess,
        withTransaction: (fn) => connection.transaction(() => fn(typedAccess))(),
      },
      { ...silentLogger, warn },
    );

    expect(repository.getSettings()).toEqual({
      ...SETTINGS_DEFAULTS,
      theme: 'light',
      cs2Path: 'C:\\Games\\CS2',
      gsiPort: 42731,
      autostart: true,
      closeToTray: false,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('tolerant reads of a corrupted row', () => {
  it('falls back per field: one bad column keeps the others', () => {
    const warn = vi.fn();
    const port = openPort();
    const repository = createSettingsRepository(port, { ...silentLogger, warn });
    repository.updateSettings({
      theme: 'light',
      cs2Path: 'C:\\Games\\CS2',
      gsiPort: 42731,
      autostart: true,
    });
    port.drizzle.run(sql`update settings set theme = 'blurple'`);

    const settings = repository.getSettings();

    expect(settings).toEqual({
      ...SETTINGS_DEFAULTS,
      cs2Path: 'C:\\Games\\CS2',
      gsiPort: 42731,
      autostart: true,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('invalid stored settings value replaced by its default', {
      field: 'theme',
    });
  });

  it('treats a non-0/1 boolean column as invalid instead of coercing it', () => {
    const warn = vi.fn();
    const port = openPort();
    const repository = createSettingsRepository(port, { ...silentLogger, warn });
    repository.updateSettings({ closeToTray: false });
    // 7 is truthy — silent coercion would flip close-to-tray back to true.
    port.drizzle.run(sql`update settings set close_to_tray = 7`);

    expect(repository.getSettings().closeToTray).toBe(SETTINGS_DEFAULTS.closeToTray);
    expect(warn).toHaveBeenCalledWith('invalid stored settings value replaced by its default', {
      field: 'closeToTray',
    });
  });

  it('recovers from a text value in an integer column (SQLite dynamic typing)', () => {
    const port = openPort();
    const repository = createSettingsRepository(port, silentLogger);
    repository.updateSettings({ gsiPort: 42731 });
    port.drizzle.run(sql`update settings set gsi_port = 'not-a-port'`);

    expect(repository.getSettings().gsiPort).toBeNull();
  });
});

describe('boolean codec coverage', () => {
  it('covers exactly the boolean settings fields', () => {
    // Completeness direction of the satisfies-pin in settings-repository.ts.
    expectTypeOf<BooleanSettingsField>().toEqualTypeOf<
      'autostart' | 'closeToTray' | 'autoUpdate' | 'scoreboardEnabled'
    >();
  });
});
