/* eslint-disable import-x/no-nodejs-modules --
 * ADR-019 keeps production core pure; this test file runs under Node/Vitest
 * and must read the fixture files from disk (10-testing.md §1.1). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseAppManifest } from './app-manifest';

const FIXTURES_DIR = fileURLToPath(new URL('../../../../tests/fixtures/steam', import.meta.url));

function readFixture(...segments: string[]): string {
  return readFileSync(join(FIXTURES_DIR, ...segments), 'utf8');
}

describe('parseAppManifest', () => {
  it('extracts the install dir from the real CS2 manifest capture', () => {
    const result = parseAppManifest(readFixture('real', 'appmanifest_730.acf'));
    expect(result).toEqual({ ok: true, installDir: 'Counter-Strike Global Offensive' });
  });

  it('matches root and field keys case-insensitively', () => {
    const result = parseAppManifest('"appstate" { "INSTALLDIR" "Some Game" }');
    expect(result).toEqual({ ok: true, installDir: 'Some Game' });
  });

  it('rejects a manifest without installdir with INVALID_SHAPE', () => {
    const result = parseAppManifest(readFixture('malformed', 'appmanifest-missing-installdir.acf'));
    expect(result).toEqual({
      ok: false,
      error: { code: 'INVALID_SHAPE', issues: ['AppState.installdir: expected non-empty string'] },
    });
  });

  it('rejects an unexpected root key with INVALID_SHAPE', () => {
    const result = parseAppManifest(readFixture('malformed', 'wrong-root-key.vdf'));
    expect(result).toEqual({
      ok: false,
      error: { code: 'INVALID_SHAPE', issues: ['AppState: expected root block'] },
    });
  });

  it('rejects an empty installdir with INVALID_SHAPE', () => {
    const result = parseAppManifest('"AppState" { "installdir" "" }');
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_SHAPE' } });
  });

  it('rejects a block-valued installdir with INVALID_SHAPE', () => {
    const result = parseAppManifest('"AppState" { "installdir" { "nested" "x" } }');
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_SHAPE' } });
  });

  it('rejects non-KeyValues content with NOT_KEYVALUES', () => {
    const result = parseAppManifest(readFixture('malformed', 'not-keyvalues.txt'));
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_KEYVALUES' } });
  });

  it('never echoes the LastOwner SteamID in issues (ADR-030)', () => {
    const result = parseAppManifest(readFixture('malformed', 'appmanifest-missing-installdir.acf'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join(' ')).not.toMatch(/76561/);
  });
});
