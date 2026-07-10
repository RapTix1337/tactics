import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '../../../shared';
import type { MapRegistry } from './fs-map-registry';
import { createMapRegistry } from './fs-map-registry';

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

const tempDirs: string[] = [];

function newDataDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'tactics-maps-'));
  tempDirs.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function validMapJson(id: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id,
    displayName: 'Test Map',
    gsiNames: [id],
    callouts: [{ name: 'Mid', x: 0.5, y: 0.5 }],
    ...overrides,
  });
}

/** Writes a complete valid map folder (a single map.json, ADR-045). */
function writeValidMap(dataDirectory: string, id: string): void {
  const folder = join(dataDirectory, id);
  mkdirSync(folder);
  writeFileSync(join(folder, 'map.json'), validMapJson(id), 'utf8');
}

async function loadedRegistry(
  dataDirectory: string,
  logger: Logger = silentLogger,
): Promise<MapRegistry> {
  const registry = createMapRegistry({ dataDirectory, logger });
  await registry.loadAll();
  return registry;
}

describe('createMapRegistry', () => {
  it('is empty before loadAll', () => {
    const registry = createMapRegistry({ dataDirectory: newDataDirectory(), logger: silentLogger });

    expect(registry.listMaps()).toEqual([]);
    expect(registry.getMap('de_dust2')).toBeUndefined();
    expect(registry.resolveGsiMapName('de_dust2')).toBeUndefined();
  });

  it('loads a valid map with summary, full data, and resolution', async () => {
    const dataDirectory = newDataDirectory();
    writeValidMap(dataDirectory, 'de_dust2');
    const warn = vi.fn();

    const registry = await loadedRegistry(dataDirectory, { ...silentLogger, warn });

    expect(warn).not.toHaveBeenCalled();
    expect(registry.listMaps()).toEqual([{ id: 'de_dust2', displayName: 'Test Map' }]);
    expect(registry.getMap('de_dust2')?.callouts).toEqual([{ name: 'Mid', x: 0.5, y: 0.5 }]);
    expect(registry.resolveGsiMapName('de_dust2')).toBe('de_dust2');
  });

  it('ignores plain files in the data directory (e.g. the README)', async () => {
    const dataDirectory = newDataDirectory();
    writeFileSync(join(dataDirectory, 'README.md'), '# Map Data', 'utf8');
    const warn = vi.fn();

    const registry = await loadedRegistry(dataDirectory, { ...silentLogger, warn });

    expect(registry.listMaps()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and stays empty when the data directory is missing', async () => {
    const dataDirectory = join(newDataDirectory(), 'does-not-exist');
    const warn = vi.fn();

    const registry = await loadedRegistry(dataDirectory, { ...silentLogger, warn });

    expect(registry.listMaps()).toEqual([]);
    expect(warn).toHaveBeenCalledWith('map data directory is missing or unreadable', {
      dataDirectory,
    });
  });

  describe('skips an invalid map with a warn log naming file and error path', () => {
    async function loadSingleBrokenMap(
      dataDirectory: string,
    ): Promise<{ registry: MapRegistry; warn: ReturnType<typeof vi.fn> }> {
      const warn = vi.fn();
      const registry = await loadedRegistry(dataDirectory, { ...silentLogger, warn });
      expect(registry.listMaps()).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      return { registry, warn };
    }

    it('map.json missing', async () => {
      const dataDirectory = newDataDirectory();
      mkdirSync(join(dataDirectory, 'de_broken'));

      const { warn } = await loadSingleBrokenMap(dataDirectory);

      expect(warn).toHaveBeenCalledWith('invalid map skipped', {
        folder: 'de_broken',
        file: 'map.json',
        issues: ['file is missing or unreadable'],
      });
    });

    it('map.json is not JSON', async () => {
      const dataDirectory = newDataDirectory();
      mkdirSync(join(dataDirectory, 'de_broken'));
      writeFileSync(join(dataDirectory, 'de_broken', 'map.json'), '{ not json', 'utf8');

      const { warn } = await loadSingleBrokenMap(dataDirectory);

      expect(warn).toHaveBeenCalledWith('invalid map skipped', {
        folder: 'de_broken',
        file: 'map.json',
        issues: ['file is not valid JSON'],
      });
    });

    it('map.json fails the schema with the error path in the log', async () => {
      const dataDirectory = newDataDirectory();
      mkdirSync(join(dataDirectory, 'de_broken'));
      writeFileSync(
        join(dataDirectory, 'de_broken', 'map.json'),
        validMapJson('de_broken', { callouts: [{ name: 'Mid', x: 612, y: 0.5 }] }),
        'utf8',
      );

      const { warn } = await loadSingleBrokenMap(dataDirectory);

      const context = warn.mock.calls[0]?.[1] as { file: string; issues: string[] };
      expect(context.file).toBe('map.json');
      expect(context.issues.some((issue) => issue.startsWith('callouts.0.x:'))).toBe(true);
    });

    it('id does not match the folder name', async () => {
      const dataDirectory = newDataDirectory();
      mkdirSync(join(dataDirectory, 'de_folder'));
      writeFileSync(join(dataDirectory, 'de_folder', 'map.json'), validMapJson('de_other'), 'utf8');

      const { warn } = await loadSingleBrokenMap(dataDirectory);

      expect(warn).toHaveBeenCalledWith('invalid map skipped', {
        folder: 'de_folder',
        file: 'map.json',
        issues: ['id: "de_other" does not match the folder name "de_folder"'],
      });
    });
  });

  it('loads valid maps and skips invalid ones in a mixed directory', async () => {
    const dataDirectory = newDataDirectory();
    writeValidMap(dataDirectory, 'de_dust2');
    writeValidMap(dataDirectory, 'de_inferno');
    mkdirSync(join(dataDirectory, 'de_broken'));
    const warn = vi.fn();

    const registry = await loadedRegistry(dataDirectory, { ...silentLogger, warn });

    expect(registry.listMaps().map((summary) => summary.id)).toEqual(['de_dust2', 'de_inferno']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns on a GSI name claimed by two maps; the first folder wins', async () => {
    const dataDirectory = newDataDirectory();
    writeValidMap(dataDirectory, 'de_dust2');
    const folder = join(dataDirectory, 'de_inferno');
    mkdirSync(folder);
    writeFileSync(
      join(folder, 'map.json'),
      validMapJson('de_inferno', { gsiNames: ['de_inferno', 'de_dust2'] }),
      'utf8',
    );
    const warn = vi.fn();

    const registry = await loadedRegistry(dataDirectory, { ...silentLogger, warn });

    expect(registry.resolveGsiMapName('de_dust2')).toBe('de_dust2');
    expect(registry.resolveGsiMapName('de_inferno')).toBe('de_inferno');
    expect(warn).toHaveBeenCalledWith('duplicate GSI map name in map data ignored', {
      gsiName: 'de_dust2',
      keptMapId: 'de_dust2',
      ignoredMapId: 'de_inferno',
    });
  });

  it('replaces the registry state on a second loadAll', async () => {
    const dataDirectory = newDataDirectory();
    writeValidMap(dataDirectory, 'de_dust2');
    const registry = await loadedRegistry(dataDirectory);
    expect(registry.listMaps()).toHaveLength(1);

    rmSync(join(dataDirectory, 'de_dust2'), { recursive: true, force: true });
    writeValidMap(dataDirectory, 'de_inferno');
    await registry.loadAll();

    expect(registry.listMaps().map((summary) => summary.id)).toEqual(['de_inferno']);
    expect(registry.getMap('de_dust2')).toBeUndefined();
    expect(registry.resolveGsiMapName('de_inferno')).toBe('de_inferno');
  });
});

describe('bundled map data (schema gate, 10-testing.md §1.2)', () => {
  const BUNDLED_DATA_DIRECTORY = join(import.meta.dirname, '..', '..', '..', '..', 'data', 'maps');

  const ACTIVE_DUTY_POOL = [
    'de_ancient',
    'de_anubis',
    'de_cache',
    'de_dust2',
    'de_inferno',
    'de_mirage',
    'de_nuke',
    'de_overpass',
  ];

  it('loads the full Active Duty catalog without a skip', async () => {
    const warn = vi.fn();

    const registry = await loadedRegistry(BUNDLED_DATA_DIRECTORY, { ...silentLogger, warn });

    // The gate for every map-data PR (MAP-02): all shipped entries validate.
    expect(warn).not.toHaveBeenCalled();
    expect(registry.listMaps().map((summary) => summary.id)).toEqual(ACTIVE_DUTY_POOL);
    for (const summary of registry.listMaps()) {
      expect(registry.getMap(summary.id)).toBeDefined();
      expect(registry.resolveGsiMapName(summary.id)).toBe(summary.id);
    }
  });

  it('ships a curated default layout for every pool map (E12.3, MAP-04)', async () => {
    const registry = await loadedRegistry(BUNDLED_DATA_DIRECTORY);

    for (const mapId of ACTIVE_DUTY_POOL) {
      expect(registry.getMap(mapId)?.callouts.length, `${mapId} default layout`).toBeGreaterThan(0);
    }
  });
});
