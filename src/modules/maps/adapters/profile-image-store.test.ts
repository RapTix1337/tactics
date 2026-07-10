import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Logger } from '../../../shared';
import type { ProfileImageStore } from './profile-image-store';
import { createProfileImageStore } from './profile-image-store';

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1"/></svg>';

const tempDirs: string[] = [];

function newTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'tactics-images-'));
  tempDirs.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface Harness {
  readonly store: ProfileImageStore;
  readonly imagesDirectory: string;
  readonly sourceDirectory: string;
  writeSource(name: string, content: Buffer | string): Promise<string>;
}

function createHarness(maxImageBytes?: number): Harness {
  const root = newTempDir();
  const imagesDirectory = join(root, 'maps');
  const sourceDirectory = join(root, 'downloads');
  return {
    store: createProfileImageStore({ imagesDirectory, logger: silentLogger, maxImageBytes }),
    imagesDirectory,
    sourceDirectory,
    writeSource: async (name, content): Promise<string> => {
      await mkdir(sourceDirectory, { recursive: true });
      const path = join(sourceDirectory, name);
      await writeFile(path, content);
      return path;
    },
  };
}

describe('loadImage (MAP-07 boundary validation)', () => {
  it('accepts PNG, JPG, and SVG by content, not by extension', async () => {
    const harness = createHarness();
    // Deliberately lying extensions: only the magic bytes decide.
    const cases = [
      { file: 'radar.dat', content: PNG_BYTES, extension: 'png' },
      { file: 'radar.png', content: JPEG_BYTES, extension: 'jpg' },
      { file: 'radar.bin', content: Buffer.from(SVG_TEXT, 'utf8'), extension: 'svg' },
    ] as const;
    for (const { file, content, extension } of cases) {
      const result = await harness.store.loadImage(await harness.writeSource(file, content));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.image.extension).toBe(extension);
        expect(Buffer.from(result.image.bytes)).toEqual(content);
      }
    }
  });

  it('rejects unsupported content with a named error', async () => {
    const harness = createHarness();
    const path = await harness.writeSource('radar.png', Buffer.from('GIF89a not supported'));
    const result = await harness.store.loadImage(path);
    expect(result).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_TYPE' } });
  });

  it('rejects an oversized file before reading it', async () => {
    const harness = createHarness(64);
    const path = await harness.writeSource('radar.png', Buffer.alloc(65, 0x89));
    const result = await harness.store.loadImage(path);
    expect(result).toMatchObject({ ok: false, error: { code: 'TOO_LARGE' } });
  });

  it('accepts a file exactly at the cap', async () => {
    const harness = createHarness(PNG_BYTES.length);
    const path = await harness.writeSource('radar.png', PNG_BYTES);
    expect((await harness.store.loadImage(path)).ok).toBe(true);
  });

  it('rejects a hostile SVG with the scan issues', async () => {
    const harness = createHarness();
    const path = await harness.writeSource('radar.svg', '<svg onload="alert(1)"><script/></svg>');
    const result = await harness.store.loadImage(path);
    expect(result).toMatchObject({ ok: false, error: { code: 'SVG_REJECTED' } });
    expect(!result.ok && result.error.issues.length).toBe(2);
  });

  it('reports missing files and directories as UNREADABLE', async () => {
    const harness = createHarness();
    const missing = await harness.store.loadImage(join(harness.sourceDirectory, 'missing.png'));
    expect(missing).toMatchObject({ ok: false, error: { code: 'UNREADABLE' } });

    await mkdir(join(harness.sourceDirectory, 'folder.png'), { recursive: true });
    const directory = await harness.store.loadImage(join(harness.sourceDirectory, 'folder.png'));
    expect(directory).toMatchObject({ ok: false, error: { code: 'UNREADABLE' } });
  });
});

describe('saveImage / copyImage / deleteImage (the app-managed image directory)', () => {
  it('round-trips a validated image into maps/<mapId>/<fileName>', async () => {
    const harness = createHarness();
    const loaded = await harness.store.loadImage(await harness.writeSource('r.png', PNG_BYTES));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    await harness.store.saveImage('de_dust2', 'profile-1.png', loaded.image);
    const written = await readFile(join(harness.imagesDirectory, 'de_dust2', 'profile-1.png'));
    expect(written).toEqual(PNG_BYTES);
  });

  it('replaces an existing file on save (replace-image flow)', async () => {
    const harness = createHarness();
    const replacement = Buffer.concat([PNG_BYTES, Buffer.from([0xff])]);
    await harness.store.saveImage('de_dust2', 'profile-1.png', {
      extension: 'png',
      bytes: PNG_BYTES,
    });
    await harness.store.saveImage('de_dust2', 'profile-1.png', {
      extension: 'png',
      bytes: replacement,
    });
    const written = await readFile(join(harness.imagesDirectory, 'de_dust2', 'profile-1.png'));
    expect(written).toEqual(replacement);
  });

  it('copies an image for a fork and keeps the source', async () => {
    const harness = createHarness();
    await harness.store.saveImage('de_mirage', 'source.svg', {
      extension: 'svg',
      bytes: Buffer.from(SVG_TEXT, 'utf8'),
    });
    expect(await harness.store.copyImage('de_mirage', 'source.svg', 'fork.svg')).toBe(true);
    const copied = await readFile(join(harness.imagesDirectory, 'de_mirage', 'fork.svg'), 'utf8');
    expect(copied).toBe(SVG_TEXT);
    await expect(
      stat(join(harness.imagesDirectory, 'de_mirage', 'source.svg')),
    ).resolves.toBeDefined();
  });

  it('returns false when the fork source file is missing', async () => {
    const harness = createHarness();
    expect(await harness.store.copyImage('de_mirage', 'missing.png', 'fork.png')).toBe(false);
  });

  it('deletes an image and treats a missing file as already deleted', async () => {
    const harness = createHarness();
    await harness.store.saveImage('de_nuke', 'profile-1.png', {
      extension: 'png',
      bytes: PNG_BYTES,
    });
    await harness.store.deleteImage('de_nuke', 'profile-1.png');
    await expect(stat(join(harness.imagesDirectory, 'de_nuke', 'profile-1.png'))).rejects.toThrow();
    // Idempotent: the second delete must not throw.
    await harness.store.deleteImage('de_nuke', 'profile-1.png');
  });

  it('throws TypeError on invalid internal identifiers (bug, not user input)', async () => {
    const harness = createHarness();
    const image = { extension: 'png', bytes: PNG_BYTES } as const;
    await expect(harness.store.saveImage('../evil', 'p.png', image)).rejects.toThrow(TypeError);
    await expect(harness.store.saveImage('de_dust2', '../p.png', image)).rejects.toThrow(TypeError);
    await expect(harness.store.copyImage('de_dust2', 'a.png', 'b.exe')).rejects.toThrow(TypeError);
    await expect(harness.store.deleteImage('DE_DUST2', 'p.png')).rejects.toThrow(TypeError);
  });
});

describe('resolveImagePath (traversal impossible by construction)', () => {
  it('resolves well-formed ids to a path inside the image directory', () => {
    const harness = createHarness();
    const path = harness.store.resolveImagePath(
      'de_dust2',
      '0f8b3a52-9c1d-4e7a-b7c2-1a2b3c4d5e6f.png',
    );
    expect(path).toBeDefined();
    expect(path?.startsWith(resolve(harness.imagesDirectory) + sep)).toBe(true);
  });

  it('rejects every hostile identifier shape', () => {
    const harness = createHarness();
    const hostile: readonly (readonly [string, string])[] = [
      ['..', 'p.png'],
      ['de_dust2', '..'],
      ['de_dust2', '../../tactics.db'],
      ['de_dust2/..', 'p.png'],
      ['de_dust2', 'p.png/../../x.png'],
      ['de_dust2', '%2e%2e%2fp.png'],
      ['de_dust2', 'p.exe'],
      ['de_dust2', 'p.png.exe'],
      ['de_dust2', ''],
      ['', 'p.png'],
      ['DE_DUST2', 'p.png'],
      ['de_dust2', 'P.PNG'],
      ['c:\\windows', 'p.png'],
      ['de_dust2', 'c:\\p.png'],
    ];
    for (const [mapId, fileName] of hostile) {
      expect(harness.store.resolveImagePath(mapId, fileName)).toBeUndefined();
    }
  });
});
