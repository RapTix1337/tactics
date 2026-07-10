import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import type { MapData, MapsStoragePort } from '../../modules/maps';
import { createProfileImageStore, createProfileRepository } from '../../modules/maps';
import type { Logger } from '../../shared';
import {
  mapsCreateProfile,
  mapsDeleteProfile,
  mapsGetProfile,
  mapsList,
  mapsReplaceProfileImage,
  mapsUpdateCallouts,
} from '../../shared';
import type { AnyCommandDefinition } from '../../shared/contract';
import { registerMapsCommands } from './maps-commands';
import type { CommandRegistrationDeps } from './register-command';

/**
 * The E22.3 acceptance round trip against the real modules: real SQLite
 * (generated migrations, the profile-repository.test.ts pattern), the real
 * image store in a temp directory, and a dialog fake answering with real
 * fixture files — upload, fork, callout update, image replace, and delete
 * flow through the actual command handlers end to end.
 */

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

const MIGRATIONS_DIRECTORY = join(
  import.meta.dirname,
  '..',
  '..',
  'modules',
  'storage',
  'migrations',
);

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01]);

const dust2: MapData = {
  id: 'de_dust2',
  displayName: 'Dust 2',
  gsiNames: ['de_dust2'],
  callouts: [{ name: 'Long', x: 0.69, y: 0.715 }],
};

interface FakeEvent {
  trusted: boolean;
}

type RegisteredListener = (event: FakeEvent, request: unknown) => Promise<unknown>;

const connections: Database.Database[] = [];
const tempDirs: string[] = [];

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

function newTempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

function openPort(): MapsStoragePort {
  const connection = new Database(':memory:');
  connections.push(connection);
  const files = readdirSync(MIGRATIONS_DIRECTORY)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    connection.exec(readFileSync(join(MIGRATIONS_DIRECTORY, file), 'utf8'));
  }
  const typedAccess = drizzle(connection);
  return {
    drizzle: typedAccess,
    withTransaction: (fn) => connection.transaction(() => fn(typedAccess))(),
  };
}

function setup(): {
  invoke: (definition: AnyCommandDefinition, request: unknown) => Promise<unknown>;
  imagesDirectory: string;
  pickFile: (fileName: string, bytes: Buffer) => void;
} {
  const handlers = new Map<string, RegisteredListener>();
  const deps: CommandRegistrationDeps<FakeEvent> = {
    registerHandler: (channel, listener): void => {
      handlers.set(channel, listener);
    },
    isTrustedSender: (event): boolean => event.trusted,
    logger: silentLogger,
  };

  const imagesDirectory = newTempDir('tactics-maps-images-');
  const picksDirectory = newTempDir('tactics-maps-picks-');
  let nextPick: string | undefined;

  registerMapsCommands(deps, {
    mapsLoaded: Promise.resolve(),
    listMaps: () => [{ id: dust2.id, displayName: dust2.displayName }],
    getMap: (mapId) => (mapId === dust2.id ? dust2 : undefined),
    profiles: createProfileRepository(openPort(), silentLogger),
    images: createProfileImageStore({ imagesDirectory, logger: silentLogger }),
    showImageOpenDialog: () => Promise.resolve(nextPick),
  });

  return {
    invoke: (definition, request): Promise<unknown> => {
      const listener = handlers.get(definition.channel);
      if (listener === undefined) {
        throw new Error(`${definition.channel} was not registered`);
      }
      return listener({ trusted: true }, request);
    },
    imagesDirectory,
    pickFile: (fileName, bytes): void => {
      const path = join(picksDirectory, fileName);
      writeFileSync(path, bytes);
      nextPick = path;
    },
  };
}

function dataOf<T>(result: unknown): T {
  expect(result).toMatchObject({ ok: true });
  return (result as { data: T }).data;
}

describe('maps commands against real modules', () => {
  it('runs the full profile lifecycle: upload → list → fork → edit → replace → delete', async () => {
    const { invoke, imagesDirectory, pickFile } = setup();

    // Upload: rows in SQLite, file under <images>/<mapId>/<profileId>.png.
    pickFile('radar.png', PNG_BYTES);
    const created = dataOf<{
      status: string;
      profile: { id: string; imageUrl: string; callouts: readonly unknown[] };
    }>(
      await invoke(mapsCreateProfile, {
        mapId: 'de_dust2',
        name: 'Mine',
        source: { kind: 'upload' },
      }),
    );
    expect(created.status).toBe('created');
    expect(created.profile.callouts).toEqual(dust2.callouts);
    const uploadedFile = join(imagesDirectory, 'de_dust2', `${created.profile.id}.png`);
    expect(existsSync(uploadedFile)).toBe(true);
    expect(readFileSync(uploadedFile)).toEqual(PNG_BYTES);

    // List: the summary reflects the upload and the resolved default.
    const list = dataOf<readonly { id: string; profiles: readonly unknown[] }[]>(
      await invoke(mapsList, undefined),
    );
    expect(list).toMatchObject([
      {
        id: 'de_dust2',
        profiles: [{ id: created.profile.id }],
        defaultProfileId: created.profile.id,
      },
    ]);

    // Fork: rows and file copied.
    const forked = dataOf<{ profile: { id: string } }>(
      await invoke(mapsCreateProfile, {
        mapId: 'de_dust2',
        name: 'Copy',
        source: { kind: 'fork', profileId: created.profile.id },
      }),
    );
    const forkedFile = join(imagesDirectory, 'de_dust2', `${forked.profile.id}.png`);
    expect(readFileSync(forkedFile)).toEqual(PNG_BYTES);

    // Callout edit on the fork; the original stays untouched.
    const newCallouts = [{ name: 'Car', x: 0.1, y: 0.2 }];
    const edited = dataOf<{ callouts: readonly unknown[] }>(
      await invoke(mapsUpdateCallouts, {
        mapId: 'de_dust2',
        profileId: forked.profile.id,
        callouts: newCallouts,
      }),
    );
    expect(edited.callouts).toEqual(newCallouts);
    const original = dataOf<{ callouts: readonly unknown[] }>(
      await invoke(mapsGetProfile, { mapId: 'de_dust2', profileId: created.profile.id }),
    );
    expect(original.callouts).toEqual(dust2.callouts);

    // Replace with a different format: new file, old one gone, URL updated.
    pickFile('radar.jpg', JPEG_BYTES);
    const replaced = dataOf<{ profile: { imageUrl: string } }>(
      await invoke(mapsReplaceProfileImage, {
        mapId: 'de_dust2',
        profileId: created.profile.id,
      }),
    );
    expect(replaced.profile.imageUrl).toBe(`tactics-map://de_dust2/${created.profile.id}.jpg`);
    expect(existsSync(join(imagesDirectory, 'de_dust2', `${created.profile.id}.jpg`))).toBe(true);
    expect(existsSync(uploadedFile)).toBe(false);

    // Delete both: the map returns to the empty state, files removed.
    await invoke(mapsDeleteProfile, { mapId: 'de_dust2', profileId: forked.profile.id });
    const afterDelete = dataOf<{ profiles: readonly unknown[] }>(
      await invoke(mapsDeleteProfile, { mapId: 'de_dust2', profileId: created.profile.id }),
    );
    expect(afterDelete.profiles).toEqual([]);
    expect(existsSync(forkedFile)).toBe(false);
    expect(existsSync(join(imagesDirectory, 'de_dust2', `${created.profile.id}.jpg`))).toBe(false);
  });

  it('rejects a hostile pick with IMAGE_INVALID and persists nothing', async () => {
    const { invoke, imagesDirectory, pickFile } = setup();

    pickFile('not-an-image.txt', Buffer.from('just text'));
    const result = await invoke(mapsCreateProfile, {
      mapId: 'de_dust2',
      name: 'Mine',
      source: { kind: 'upload' },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'IMAGE_INVALID' } });
    const list = dataOf<readonly { profiles: readonly unknown[] }[]>(
      await invoke(mapsList, undefined),
    );
    expect(list[0]?.profiles).toEqual([]);
    expect(existsSync(join(imagesDirectory, 'de_dust2'))).toBe(false);
  });
});
