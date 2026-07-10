import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '../../../shared';
import type { Callout } from '../core/map-schema';
import type { MapsStoragePort, ProfileRepository } from './profile-repository';
import { createProfileRepository } from './profile-repository';

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

function openPort(databasePath = ':memory:'): MapsStoragePort {
  const connection = new Database(databasePath);
  connections.push(connection);
  // Only a fresh database gets the DDL — reopening an existing file must not
  // re-apply it (the real runner tracks applied migrations, E7.3).
  const hasSchema = connection
    .prepare("select 1 from sqlite_master where type = 'table' and name = 'map_profiles'")
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
  const directory = mkdtempSync(join(tmpdir(), 'tactics-profiles-'));
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

const LAYOUT: readonly Callout[] = [
  { name: 'A Site', x: 0.2, y: 0.3 },
  { name: 'Mid', x: 0.5, y: 0.5 },
];

/** Deterministic ids (`id-1`, `id-2`, …) and timestamps (1000, 2000, …). */
function openRepository(
  port = openPort(),
  logger: Logger = silentLogger,
): { repository: ProfileRepository; port: MapsStoragePort } {
  let counter = 0;
  const repository = createProfileRepository(port, logger, {
    generateId: () => `id-${(counter += 1)}`,
    now: () => counter * 1000,
  });
  return { repository, port };
}

function createDust2Profile(
  repository: ProfileRepository,
  name = 'Default',
  defaultLayout: readonly Callout[] = LAYOUT,
): string {
  return repository.createProfile({
    mapId: 'de_dust2',
    name,
    imageFileExtension: 'png',
    defaultLayout,
  }).profile.id;
}

describe('createProfile and getProfile', () => {
  it('persists the profile with callouts seeded from the default layout', () => {
    const { repository } = openRepository();

    const created = repository.createProfile({
      mapId: 'de_dust2',
      name: '  My radar ',
      imageFileExtension: 'png',
      defaultLayout: LAYOUT,
    });

    expect(created.profile).toEqual({
      id: 'id-1',
      mapId: 'de_dust2',
      name: 'My radar',
      imageFileName: 'id-1.png',
      createdAt: 1000,
    });
    expect(repository.getProfile('id-1')).toEqual({ profile: created.profile, callouts: LAYOUT });
  });

  it('accepts an empty default layout', () => {
    const { repository } = openRepository();
    const id = createDust2Profile(repository, 'Empty', []);
    expect(repository.getProfile(id)?.callouts).toEqual([]);
  });

  it('rejects a whitespace-only name without persisting anything', () => {
    const { repository } = openRepository();
    expect(() => createDust2Profile(repository, '   ')).toThrow(TypeError);
    expect(repository.listProfiles('de_dust2').profiles).toEqual([]);
  });

  it('returns undefined for an unknown profile id', () => {
    const { repository } = openRepository();
    expect(repository.getProfile('missing')).toBeUndefined();
  });
});

describe('listProfiles and default resolution', () => {
  it('lists profiles first-by-creation with the first as implicit default', () => {
    const { repository } = openRepository();
    const first = createDust2Profile(repository, 'One');
    const second = createDust2Profile(repository, 'Two');

    const list = repository.listProfiles('de_dust2');

    expect(list.profiles.map((profile) => profile.id)).toEqual([first, second]);
    expect(list.defaultProfileId).toBe(first);
  });

  it('does not leak profiles of other maps', () => {
    const { repository } = openRepository();
    createDust2Profile(repository);
    expect(repository.listProfiles('de_mirage')).toEqual({
      profiles: [],
      defaultProfileId: undefined,
    });
  });

  it('setDefaultProfile marks an explicit default', () => {
    const { repository } = openRepository();
    createDust2Profile(repository, 'One');
    const second = createDust2Profile(repository, 'Two');

    expect(repository.setDefaultProfile('de_dust2', second)).toBe(true);
    expect(repository.listProfiles('de_dust2').defaultProfileId).toBe(second);
  });

  it('setDefaultProfile refuses unknown profiles and wrong maps', () => {
    const { repository } = openRepository();
    const id = createDust2Profile(repository);

    expect(repository.setDefaultProfile('de_dust2', 'missing')).toBe(false);
    expect(repository.setDefaultProfile('de_mirage', id)).toBe(false);
    expect(repository.listProfiles('de_dust2').defaultProfileId).toBe(id);
  });
});

describe('forkProfile', () => {
  it('copies the source callouts onto an independent new profile', () => {
    const { repository } = openRepository();
    const sourceId = createDust2Profile(repository);

    const forked = repository.forkProfile(sourceId, { name: 'Fork', imageFileExtension: 'png' });

    expect(forked?.profile.id).toBe('id-2');
    expect(forked?.profile.imageFileName).toBe('id-2.png');
    expect(forked?.callouts).toEqual(LAYOUT);

    // Editing the fork leaves the source untouched.
    repository.updateCallouts('id-2', [{ name: 'Only', x: 0.1, y: 0.1 }]);
    expect(repository.getProfile(sourceId)?.callouts).toEqual(LAYOUT);
  });

  it('returns undefined for an unknown source', () => {
    const { repository } = openRepository();
    expect(
      repository.forkProfile('missing', { name: 'Fork', imageFileExtension: 'png' }),
    ).toBeUndefined();
  });
});

describe('renameProfile', () => {
  it('persists the trimmed new name', () => {
    const { repository } = openRepository();
    const id = createDust2Profile(repository);

    expect(repository.renameProfile(id, ' New name ')?.name).toBe('New name');
    expect(repository.getProfile(id)?.profile.name).toBe('New name');
  });

  it('rejects an empty name and keeps the stored one', () => {
    const { repository } = openRepository();
    const id = createDust2Profile(repository, 'Kept');

    expect(() => repository.renameProfile(id, '  ')).toThrow(TypeError);
    expect(repository.getProfile(id)?.profile.name).toBe('Kept');
  });

  it('returns undefined for an unknown profile', () => {
    const { repository } = openRepository();
    expect(repository.renameProfile('missing', 'Name')).toBeUndefined();
  });
});

describe('replaceImage', () => {
  it('points the profile at the new extension and reports the previous file', () => {
    const { repository } = openRepository();
    const id = createDust2Profile(repository);

    const replaced = repository.replaceImage(id, 'svg');

    expect(replaced).toEqual({
      profile: expect.objectContaining({ id, imageFileName: `${id}.svg` }) as unknown,
      previousImageFileName: `${id}.png`,
    });
    expect(repository.getProfile(id)?.profile.imageFileName).toBe(`${id}.svg`);
  });

  it('is a no-op row-wise when the extension is unchanged', () => {
    const { repository } = openRepository();
    const id = createDust2Profile(repository);

    const replaced = repository.replaceImage(id, 'png');

    expect(replaced?.profile.imageFileName).toBe(`${id}.png`);
    expect(replaced?.previousImageFileName).toBe(`${id}.png`);
  });

  it('returns undefined for an unknown profile', () => {
    const { repository } = openRepository();
    expect(repository.replaceImage('missing', 'png')).toBeUndefined();
  });
});

describe('updateCallouts', () => {
  it('replaces the whole callout set', () => {
    const { repository } = openRepository();
    const id = createDust2Profile(repository);
    const next = [{ name: 'B Site', x: 0.9, y: 0.1 }];

    expect(repository.updateCallouts(id, next)?.callouts).toEqual(next);
    expect(repository.getProfile(id)?.callouts).toEqual(next);
  });

  it('allows clearing all callouts', () => {
    const { repository } = openRepository();
    const id = createDust2Profile(repository);
    expect(repository.updateCallouts(id, [])?.callouts).toEqual([]);
  });

  it.each<[unknown, string]>([
    [[{ name: 'Off map', x: 1.5, y: 0 }], 'out-of-bounds coordinate'],
    [[{ name: '', x: 0.5, y: 0.5 }], 'empty name'],
    [
      [
        { name: 'Twin', x: 0.1, y: 0.1 },
        { name: 'Twin', x: 0.2, y: 0.2 },
      ],
      'duplicate name',
    ],
    ['not a list', 'not an array'],
  ])('rejects %j (%s) and keeps the stored callouts', (invalid) => {
    const { repository } = openRepository();
    const id = createDust2Profile(repository);

    expect(() => repository.updateCallouts(id, invalid)).toThrow(TypeError);
    expect(repository.getProfile(id)?.callouts).toEqual(LAYOUT);
  });

  it('returns undefined for an unknown profile', () => {
    const { repository } = openRepository();
    expect(repository.updateCallouts('missing', [])).toBeUndefined();
  });
});

describe('deleteProfile', () => {
  it('removes the profile with its callouts and reports the image file', () => {
    const { repository, port } = openRepository();
    const id = createDust2Profile(repository);

    const deleted = repository.deleteProfile(id);

    expect(deleted).toEqual({
      mapId: 'de_dust2',
      imageFileName: `${id}.png`,
      defaultProfileId: undefined,
    });
    expect(repository.getProfile(id)).toBeUndefined();
    const calloutRows = port.drizzle.get<{ n: number }>(
      sql`select count(*) as n from profile_callouts`,
    );
    expect(calloutRows.n).toBe(0);
  });

  it('falls back to the first remaining profile when the marked default dies', () => {
    const { repository } = openRepository();
    const first = createDust2Profile(repository, 'One');
    const second = createDust2Profile(repository, 'Two');
    createDust2Profile(repository, 'Three');
    repository.setDefaultProfile('de_dust2', second);

    const deleted = repository.deleteProfile(second);

    expect(deleted?.defaultProfileId).toBe(first);
    expect(repository.listProfiles('de_dust2').defaultProfileId).toBe(first);
  });

  it('keeps an explicit default that was not the deleted profile', () => {
    const { repository } = openRepository();
    const first = createDust2Profile(repository, 'One');
    const second = createDust2Profile(repository, 'Two');
    repository.setDefaultProfile('de_dust2', second);

    expect(repository.deleteProfile(first)?.defaultProfileId).toBe(second);
    expect(repository.listProfiles('de_dust2').defaultProfileId).toBe(second);
  });

  it('clears the marker when the last profile goes', () => {
    const { repository } = openRepository();
    const id = createDust2Profile(repository);
    repository.setDefaultProfile('de_dust2', id);

    expect(repository.deleteProfile(id)?.defaultProfileId).toBeUndefined();
    expect(repository.listProfiles('de_dust2')).toEqual({
      profiles: [],
      defaultProfileId: undefined,
    });
  });

  it('returns undefined for an unknown profile', () => {
    const { repository } = openRepository();
    expect(repository.deleteProfile('missing')).toBeUndefined();
  });
});

describe('restart-equivalent reload (acceptance, real file)', () => {
  it('reloads the identical state from the same database file', () => {
    const databasePath = newDatabasePath();
    const { repository } = openRepository(openPort(databasePath));
    createDust2Profile(repository, 'One');
    const second = createDust2Profile(repository, 'Two');
    repository.setDefaultProfile('de_dust2', second);
    repository.updateCallouts(second, [{ name: 'Edited', x: 0.4, y: 0.6 }]);
    const before = {
      list: repository.listProfiles('de_dust2'),
      second: repository.getProfile(second),
    };

    // Restart-equivalent: a fresh connection and repository over the same file.
    const reopened = createProfileRepository(openPort(databasePath), silentLogger);

    expect(reopened.listProfiles('de_dust2')).toEqual(before.list);
    expect(reopened.getProfile(second)).toEqual(before.second);
  });
});

describe('tolerant reads', () => {
  it('skips a corrupt profile row with a warning instead of failing', () => {
    const warn = vi.fn();
    const port = openPort();
    const { repository } = openRepository(port, { ...silentLogger, warn });
    const kept = createDust2Profile(repository, 'Kept');
    const corrupt = createDust2Profile(repository, 'Corrupt');
    // SQLite's dynamic typing lets a corrupt writer store text in the
    // integer column — exactly what the tolerant read must survive.
    port.drizzle.run(sql`update map_profiles set created_at = 'yesterday' where id = ${corrupt}`);

    const list = repository.listProfiles('de_dust2');

    expect(list.profiles.map((profile) => profile.id)).toEqual([kept]);
    expect(warn).toHaveBeenCalledWith('invalid stored map profile skipped', {
      profileId: corrupt,
    });
  });

  it('skips a corrupt callout row with a warning', () => {
    const warn = vi.fn();
    const port = openPort();
    const { repository } = openRepository(port, { ...silentLogger, warn });
    const id = createDust2Profile(repository);
    port.drizzle.run(sql`update profile_callouts set x = 7 where name = 'Mid'`);

    expect(repository.getProfile(id)?.callouts).toEqual([LAYOUT[0]]);
    expect(warn).toHaveBeenCalledWith('invalid stored profile callout skipped', {
      profileId: id,
    });
  });
});
