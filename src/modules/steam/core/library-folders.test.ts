/* eslint-disable import-x/no-nodejs-modules --
 * ADR-019 keeps production core pure; this test file runs under Node/Vitest
 * and must read the fixture files from disk (10-testing.md §1.1). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseLibraryFolders } from './library-folders';

const FIXTURES_DIR = fileURLToPath(new URL('../../../../tests/fixtures/steam', import.meta.url));

function readFixture(...segments: string[]): string {
  return readFileSync(join(FIXTURES_DIR, ...segments), 'utf8');
}

describe('parseLibraryFolders', () => {
  it('extracts both libraries from the real multi-library capture (GSI-01)', () => {
    const result = parseLibraryFolders(readFixture('real', 'libraryfolders.vdf'));
    expect(result).toEqual({
      ok: true,
      libraryPaths: ['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary'],
    });
  });

  it('extracts the single library from the single-library variant', () => {
    const result = parseLibraryFolders(readFixture('synthetic', 'libraryfolders-single.vdf'));
    expect(result).toEqual({
      ok: true,
      libraryPaths: ['C:\\Program Files (x86)\\Steam'],
    });
  });

  it('handles the legacy pre-2021 layout including its metadata siblings', () => {
    const result = parseLibraryFolders(readFixture('synthetic', 'libraryfolders-legacy.vdf'));
    expect(result).toEqual({
      ok: true,
      libraryPaths: ['D:\\SteamLibrary', 'E:\\Games\\SteamLibrary'],
    });
  });

  it('skips entries without a usable path instead of failing the file', () => {
    const result = parseLibraryFolders(
      readFixture('synthetic', 'libraryfolders-entry-without-path.vdf'),
    );
    expect(result).toEqual({ ok: true, libraryPaths: ['D:\\SteamLibrary'] });
  });

  it('returns an empty list for a libraryfolders block without entries', () => {
    const result = parseLibraryFolders('"libraryfolders" {}');
    expect(result).toEqual({ ok: true, libraryPaths: [] });
  });

  it('rejects non-KeyValues content with NOT_KEYVALUES', () => {
    const result = parseLibraryFolders(readFixture('malformed', 'unclosed-brace.vdf'));
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_KEYVALUES' } });
  });

  it('rejects an unexpected root key with INVALID_SHAPE', () => {
    const result = parseLibraryFolders(readFixture('malformed', 'wrong-root-key.vdf'));
    expect(result).toEqual({
      ok: false,
      error: { code: 'INVALID_SHAPE', issues: ['libraryfolders: expected root block'] },
    });
  });

  it('rejects an empty file with INVALID_SHAPE', () => {
    const result = parseLibraryFolders(readFixture('malformed', 'empty.vdf'));
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_SHAPE' } });
  });

  it('rejects a string-valued root with INVALID_SHAPE', () => {
    const result = parseLibraryFolders('"libraryfolders" "not-a-block"');
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_SHAPE',
        issues: ['libraryfolders: expected block, found string value'],
      },
    });
  });

  it('never echoes file content in issues (ADR-030)', () => {
    for (const fixture of [
      readFixture('malformed', 'not-keyvalues.txt'),
      readFixture('malformed', 'unclosed-brace.vdf'),
      readFixture('malformed', 'wrong-root-key.vdf'),
      '"libraryfolders" "D:\\\\SteamLibrary"',
    ]) {
      const result = parseLibraryFolders(fixture);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.issues.join(' ')).not.toMatch(/76561|SteamLibrary|Valve/);
    }
  });
});
