import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { archiveLogFile, MAX_ARCHIVE_COUNT } from './archive-rotation';

describe('archiveLogFile', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'tactics-rotation-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const livePath = (): string => join(directory, 'main.log');
  const archivePath = (index: number): string => join(directory, `main.old.${String(index)}.log`);

  it('moves the live file to the first archive slot', () => {
    writeFileSync(livePath(), 'live');

    archiveLogFile(livePath());

    expect(readdirSync(directory)).toEqual(['main.old.1.log']);
    expect(readFileSync(archivePath(1), 'utf8')).toBe('live');
  });

  it('shifts existing archives up by one', () => {
    writeFileSync(livePath(), 'new');
    writeFileSync(archivePath(1), 'older');
    writeFileSync(archivePath(2), 'oldest');

    archiveLogFile(livePath());

    expect(readFileSync(archivePath(1), 'utf8')).toBe('new');
    expect(readFileSync(archivePath(2), 'utf8')).toBe('older');
    expect(readFileSync(archivePath(3), 'utf8')).toBe('oldest');
  });

  it('drops the oldest archive at the cap', () => {
    writeFileSync(livePath(), 'new');
    for (let index = 1; index <= MAX_ARCHIVE_COUNT; index += 1) {
      writeFileSync(archivePath(index), `archive-${String(index)}`);
    }

    archiveLogFile(livePath());

    const files = readdirSync(directory).sort();
    expect(files).toHaveLength(MAX_ARCHIVE_COUNT);
    expect(readFileSync(archivePath(1), 'utf8')).toBe('new');
    expect(readFileSync(archivePath(MAX_ARCHIVE_COUNT), 'utf8')).toBe(
      `archive-${String(MAX_ARCHIVE_COUNT - 1)}`,
    );
  });

  it('handles gaps in the archive sequence', () => {
    writeFileSync(livePath(), 'new');
    writeFileSync(archivePath(3), 'lonely');

    archiveLogFile(livePath());

    expect(readFileSync(archivePath(1), 'utf8')).toBe('new');
    expect(readFileSync(archivePath(4), 'utf8')).toBe('lonely');
  });
});
