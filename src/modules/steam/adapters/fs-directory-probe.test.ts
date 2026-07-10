import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createFsDirectoryProbe } from './fs-directory-probe';

const tempDirectories: string[] = [];

async function makeTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tactics-probe-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('createFsDirectoryProbe', () => {
  it('answers true for an existing directory', async () => {
    const directory = await makeTempDirectory();
    await expect(createFsDirectoryProbe().isDirectory(directory)).resolves.toBe(true);
  });

  it('answers false for a missing path', async () => {
    const directory = await makeTempDirectory();
    await expect(createFsDirectoryProbe().isDirectory(join(directory, 'absent'))).resolves.toBe(
      false,
    );
  });

  it('answers false for a file', async () => {
    const directory = await makeTempDirectory();
    const filePath = join(directory, 'file.txt');
    await writeFile(filePath, 'not a directory', 'utf8');
    await expect(createFsDirectoryProbe().isDirectory(filePath)).resolves.toBe(false);
  });
});
