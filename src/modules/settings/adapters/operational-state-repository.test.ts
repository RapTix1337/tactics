import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '../../../shared';
import { isValidGsiToken } from '../core/operational-state-schema';
import { createOperationalStateRepository } from './operational-state-repository';
import type { SettingsStoragePort } from './settings-repository';

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

/**
 * Captures every argument of every level so the "token never appears in any
 * log line" acceptance criterion can be asserted against the full output.
 */
function createCapturingLogger(): { logger: Logger; dump: () => string } {
  const lines: string[] = [];
  const capture =
    (level: string) =>
    (...args: unknown[]): void => {
      lines.push(`${level} ${JSON.stringify(args)}`);
    };
  return {
    logger: {
      error: capture('error'),
      warn: capture('warn'),
      info: capture('info'),
      debug: capture('debug'),
    },
    dump: () => lines.join('\n'),
  };
}

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
    .prepare("select 1 from sqlite_master where type = 'table' and name = 'operational_state'")
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
  const directory = mkdtempSync(join(tmpdir(), 'tactics-opstate-'));
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

describe('getOperationalState', () => {
  it('generates and persists a valid token on first open, without warning', () => {
    const warn = vi.fn();
    const repository = createOperationalStateRepository(openPort(), { ...silentLogger, warn });

    const state = repository.getOperationalState();

    expect(isValidGsiToken(state.gsiToken)).toBe(true);
    expect(state.effectiveGsiPort).toBeNull();
    expect(state.windowBounds).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns the same token on the second open (acceptance criterion)', () => {
    const repository = createOperationalStateRepository(openPort(), silentLogger);

    const first = repository.getOperationalState();
    const second = repository.getOperationalState();

    expect(second.gsiToken).toBe(first.gsiToken);
  });

  it('keeps the token across a database close and reopen', () => {
    const databasePath = newDatabasePath();
    const first = createOperationalStateRepository(openPort(databasePath), silentLogger);
    const token = first.getOperationalState().gsiToken;
    for (const connection of connections.splice(0)) {
      connection.close();
    }

    const second = createOperationalStateRepository(openPort(databasePath), silentLogger);

    expect(second.getOperationalState().gsiToken).toBe(token);
  });

  it('generates distinct tokens for distinct installations (fresh databases)', () => {
    const one = createOperationalStateRepository(openPort(), silentLogger);
    const other = createOperationalStateRepository(openPort(), silentLogger);

    expect(one.getOperationalState().gsiToken).not.toBe(other.getOperationalState().gsiToken);
  });
});

describe('updateOperationalState', () => {
  it('persists a partial update and returns the full new state (round trip)', () => {
    const repository = createOperationalStateRepository(openPort(), silentLogger);
    const bounds = { x: -1920, y: 0, width: 1280, height: 720, maximized: false };

    const updated = repository.updateOperationalState({
      effectiveGsiPort: 42731,
      windowBounds: bounds,
    });

    expect(updated.effectiveGsiPort).toBe(42731);
    expect(updated.windowBounds).toEqual(bounds);
    expect(repository.getOperationalState()).toEqual(updated);
  });

  it('generates the token even when the first access is an update', () => {
    const repository = createOperationalStateRepository(openPort(), silentLogger);

    const updated = repository.updateOperationalState({ effectiveGsiPort: 42730 });

    expect(isValidGsiToken(updated.gsiToken)).toBe(true);
    expect(repository.getOperationalState().gsiToken).toBe(updated.gsiToken);
  });

  it('merges sequential updates instead of resetting earlier ones', () => {
    const repository = createOperationalStateRepository(openPort(), silentLogger);
    const bounds = { x: 0, y: 0, width: 1024, height: 768, maximized: true };

    repository.updateOperationalState({ effectiveGsiPort: 42732 });
    repository.updateOperationalState({ windowBounds: bounds });

    const state = repository.getOperationalState();
    expect(state.effectiveGsiPort).toBe(42732);
    expect(state.windowBounds).toEqual(bounds);
  });

  it('clears with an explicit null (port back to automatic, bounds dropped)', () => {
    const repository = createOperationalStateRepository(openPort(), silentLogger);
    repository.updateOperationalState({
      effectiveGsiPort: 42731,
      windowBounds: { x: 0, y: 0, width: 800, height: 600, maximized: false },
    });

    const updated = repository.updateOperationalState({
      effectiveGsiPort: null,
      windowBounds: null,
    });

    expect(updated.effectiveGsiPort).toBeNull();
    expect(updated.windowBounds).toBeNull();
  });

  it('rejects an invalid value with TypeError and persists nothing', () => {
    const repository = createOperationalStateRepository(openPort(), silentLogger);
    repository.updateOperationalState({ effectiveGsiPort: 42731 });

    expect(() =>
      repository.updateOperationalState({
        effectiveGsiPort: 99999,
        windowBounds: { x: 0, y: 0, width: 800, height: 600, maximized: false },
      }),
    ).toThrow(TypeError);
    const state = repository.getOperationalState();
    expect(state.effectiveGsiPort).toBe(42731);
    expect(state.windowBounds).toBeNull();
  });

  it('keeps exactly one operational-state row across many accesses', () => {
    const port = openPort();
    const repository = createOperationalStateRepository(port, silentLogger);

    repository.getOperationalState();
    repository.updateOperationalState({ effectiveGsiPort: 42730 });
    repository.updateOperationalState({ effectiveGsiPort: 42733 });

    expect(port.drizzle.all(sql`select count(*) as rows from operational_state`)).toEqual([
      { rows: 1 },
    ]);
  });
});

describe('overlay bounds (OVL.2, ADR-058)', () => {
  it('round-trips the overlay bounds across close and reopen', () => {
    const databasePath = newDatabasePath();
    const overlayBounds = { x: -100, y: 40, width: 960, height: 540, maximized: false } as const;
    const first = createOperationalStateRepository(openPort(databasePath), silentLogger);
    first.updateOperationalState({ overlayBounds });
    for (const connection of connections.splice(0)) {
      connection.close();
    }

    const second = createOperationalStateRepository(openPort(databasePath), silentLogger);

    expect(second.getOperationalState().overlayBounds).toEqual(overlayBounds);
  });

  it('keeps the overlay bounds independent of the window bounds', () => {
    const repository = createOperationalStateRepository(openPort(), silentLogger);
    const windowBounds = { x: 0, y: 0, width: 1280, height: 720, maximized: true };
    const overlayBounds = { x: 500, y: 300, width: 480, height: 320, maximized: false } as const;

    repository.updateOperationalState({ windowBounds });
    repository.updateOperationalState({ overlayBounds });

    const state = repository.getOperationalState();
    expect(state.windowBounds).toEqual(windowBounds);
    expect(state.overlayBounds).toEqual(overlayBounds);
  });

  it('clears the overlay bounds with an explicit null', () => {
    const repository = createOperationalStateRepository(openPort(), silentLogger);
    repository.updateOperationalState({
      overlayBounds: { x: 0, y: 0, width: 960, height: 540, maximized: false },
    });

    const updated = repository.updateOperationalState({ overlayBounds: null });

    expect(updated.overlayBounds).toBeNull();
    expect(repository.getOperationalState().overlayBounds).toBeNull();
  });

  it('falls back to null on unparseable overlay-bounds JSON, keeping the other fields (logged)', () => {
    const warn = vi.fn();
    const port = openPort();
    const repository = createOperationalStateRepository(port, { ...silentLogger, warn });
    const windowBounds = { x: 10, y: 20, width: 1280, height: 720, maximized: false };
    const token = repository.updateOperationalState({
      effectiveGsiPort: 42731,
      windowBounds,
      overlayBounds: { x: 0, y: 0, width: 960, height: 540, maximized: false },
    }).gsiToken;
    port.drizzle.run(sql`update operational_state set overlay_bounds = '{"x": broken'`);

    const state = repository.getOperationalState();

    expect(state.overlayBounds).toBeNull();
    expect(state.gsiToken).toBe(token);
    expect(state.effectiveGsiPort).toBe(42731);
    expect(state.windowBounds).toEqual(windowBounds);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'invalid stored operational-state value replaced by its default',
      { field: 'overlayBounds' },
    );
  });

  it('falls back to null on parseable JSON with an invalid shape (maximized overlay)', () => {
    const warn = vi.fn();
    const port = openPort();
    const repository = createOperationalStateRepository(port, { ...silentLogger, warn });
    repository.updateOperationalState({
      overlayBounds: { x: 0, y: 0, width: 960, height: 540, maximized: false },
    });
    // Parses as JSON, but the overlay is never maximizable — corruption.
    port.drizzle.run(
      sql`update operational_state set overlay_bounds = '{"x":0,"y":0,"width":960,"height":540,"maximized":true}'`,
    );

    expect(repository.getOperationalState().overlayBounds).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'invalid stored operational-state value replaced by its default',
      { field: 'overlayBounds' },
    );
  });

  it('rejects a maximized overlay-bounds update with TypeError and persists nothing', () => {
    const repository = createOperationalStateRepository(openPort(), silentLogger);

    expect(() =>
      repository.updateOperationalState({
        // Type-valid (WindowBounds allows any boolean) — the runtime schema
        // is what pins the overlay's maximized to false.
        overlayBounds: { x: 0, y: 0, width: 960, height: 540, maximized: true },
      }),
    ).toThrow(TypeError);
    expect(repository.getOperationalState().overlayBounds).toBeNull();
  });
});

describe('tolerant reads of a corrupted row', () => {
  it('falls back per field: a bad port keeps token and bounds', () => {
    const warn = vi.fn();
    const port = openPort();
    const repository = createOperationalStateRepository(port, { ...silentLogger, warn });
    const bounds = { x: 10, y: 20, width: 1280, height: 720, maximized: false };
    const token = repository.updateOperationalState({
      effectiveGsiPort: 42731,
      windowBounds: bounds,
    }).gsiToken;
    port.drizzle.run(sql`update operational_state set effective_gsi_port = 'not-a-port'`);

    const state = repository.getOperationalState();

    expect(state.gsiToken).toBe(token);
    expect(state.effectiveGsiPort).toBeNull();
    expect(state.windowBounds).toEqual(bounds);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'invalid stored operational-state value replaced by its default',
      { field: 'effectiveGsiPort' },
    );
  });

  it('drops the whole bounds when a single bounds column is corrupt', () => {
    const port = openPort();
    const repository = createOperationalStateRepository(port, silentLogger);
    repository.updateOperationalState({
      windowBounds: { x: 0, y: 0, width: 1280, height: 720, maximized: false },
    });
    // 7 is truthy — silent coercion would resurrect a maximized window.
    port.drizzle.run(sql`update operational_state set window_maximized = 7`);

    expect(repository.getOperationalState().windowBounds).toBeNull();
  });

  it('drops the whole bounds when only some bounds columns are set', () => {
    const port = openPort();
    const repository = createOperationalStateRepository(port, silentLogger);
    repository.updateOperationalState({
      windowBounds: { x: 0, y: 0, width: 1280, height: 720, maximized: false },
    });
    port.drizzle.run(sql`update operational_state set window_width = null`);

    expect(repository.getOperationalState().windowBounds).toBeNull();
  });

  it('regenerates and persists a fresh token when the stored one is corrupt', () => {
    const warn = vi.fn();
    const port = openPort();
    const repository = createOperationalStateRepository(port, { ...silentLogger, warn });
    const original = repository.getOperationalState().gsiToken;
    port.drizzle.run(sql`update operational_state set gsi_token = 'tampered'`);

    const regenerated = repository.getOperationalState().gsiToken;

    expect(isValidGsiToken(regenerated)).toBe(true);
    expect(regenerated).not.toBe(original);
    // Persisted: the next read returns the regenerated token, not another one.
    expect(repository.getOperationalState().gsiToken).toBe(regenerated);
    expect(warn).toHaveBeenCalledWith(
      'invalid stored operational-state value replaced by its default',
      { field: 'gsiToken' },
    );
  });
});

describe('token privacy (ADR-025/030)', () => {
  it('never emits a token on any log line, including generation and regeneration', () => {
    const { logger, dump } = createCapturingLogger();
    const port = openPort();
    const repository = createOperationalStateRepository(port, logger);
    const seenTokens: string[] = [];

    seenTokens.push(repository.getOperationalState().gsiToken);
    repository.updateOperationalState({
      effectiveGsiPort: 42731,
      windowBounds: { x: 0, y: 0, width: 1280, height: 720, maximized: false },
    });
    port.drizzle.run(sql`update operational_state set gsi_token = 'tampered'`);
    seenTokens.push(repository.getOperationalState().gsiToken);

    const output = dump();
    expect(seenTokens).toHaveLength(2);
    for (const token of seenTokens) {
      expect(output).not.toContain(token);
    }
  });
});
