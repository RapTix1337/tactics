/* eslint-disable import-x/no-nodejs-modules --
 * ADR-019 keeps production core pure; this test file runs under Node/Vitest
 * and must read the binding fixture corpus from disk (10-testing.md §2). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseGsiPayload } from './payload-schema';

// The binding T1 corpus (10-testing.md §2): every real and malformed fixture
// runs through the schemas — re-recording after a Valve format change
// reproduces breakage as failing tests here.
const FIXTURES_DIR = fileURLToPath(new URL('../../../../tests/fixtures/gsi', import.meta.url));

function readFixture(...segments: string[]): string {
  return readFileSync(join(FIXTURES_DIR, ...segments), 'utf8');
}

describe('parseGsiPayload', () => {
  describe('real corpus — every fixture parses', () => {
    const realDir = join(FIXTURES_DIR, 'real');
    for (const scenario of readdirSync(realDir)) {
      for (const file of readdirSync(join(realDir, scenario))) {
        it(`${scenario}/${file}`, () => {
          const result = parseGsiPayload(readFixture('real', scenario, file));
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(typeof result.payload.providerTimestamp).toBe('number');
          }
        });
      }
    }
  });

  it('extracts no map name from menu payloads (no map section)', () => {
    for (const file of readdirSync(join(FIXTURES_DIR, 'real', '01-menus'))) {
      const result = parseGsiPayload(readFixture('real', '01-menus', file));
      expect(result).toMatchObject({ ok: true, payload: { mapName: null } });
    }
  });

  it('extracts the raw map name from a mid-match payload', () => {
    const result = parseGsiPayload(readFixture('real', '03-mid-match', '001.json'));
    expect(result).toMatchObject({ ok: true, payload: { mapName: 'de_dust2' } });
  });

  describe('malformed corpus — named error, never a throw', () => {
    const malformedDir = join(FIXTURES_DIR, 'malformed');
    for (const file of readdirSync(malformedDir)) {
      const expectedCode = file.endsWith('.json') ? 'INVALID_SHAPE' : 'NOT_JSON';
      it(`${file} → ${expectedCode}`, () => {
        const result = parseGsiPayload(readFixture('malformed', file));
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe(expectedCode);
          expect(result.error.issues.length).toBeGreaterThan(0);
        }
      });
    }

    it('issues name only path and expected shape — no received values (ADR-030)', () => {
      for (const file of readdirSync(malformedDir)) {
        const result = parseGsiPayload(readFixture('malformed', file));
        if (result.ok) continue;
        const joined = result.error.issues.join(' ');
        // Values present in the malformed fixtures must never leak.
        expect(joined).not.toMatch(/76561/);
        expect(joined).not.toContain('Counter-Strike');
        expect(joined).not.toContain('de_dust2');
        expect(joined).not.toContain('yesterday');
        expect(joined).not.toContain('42');
      }
    });

    it('names the failing path', () => {
      const missingProvider = parseGsiPayload(readFixture('malformed', 'provider-missing.json'));
      expect(missingProvider).toMatchObject({
        ok: false,
        error: { issues: ['provider: expected object'] },
      });

      const wrongTimestamp = parseGsiPayload(
        readFixture('malformed', 'provider-timestamp-wrong-type.json'),
      );
      expect(wrongTimestamp).toMatchObject({
        ok: false,
        error: { issues: ['provider.timestamp: expected number'] },
      });

      const rootArray = parseGsiPayload(readFixture('malformed', 'root-array.json'));
      expect(rootArray).toMatchObject({
        ok: false,
        error: { issues: ['(root): expected object'] },
      });
    });
  });

  it('ignores unknown extra fields on every level (GSI-09)', () => {
    // Deliberately not from the corpus: simulates a future Valve extension.
    const extended = JSON.stringify({
      provider: { timestamp: 1234567890, futureField: { nested: true } },
      map: { name: 'de_future', futureMode: 'wingman2' },
      round: { phase: 'live' },
      newTopLevelSection: [1, 2, 3],
    });
    expect(parseGsiPayload(extended)).toEqual({
      ok: true,
      payload: { providerTimestamp: 1234567890, mapName: 'de_future' },
    });
  });

  it('rejects a map section with an empty name (ADR-031: valid name required)', () => {
    const emptyName = JSON.stringify({ provider: { timestamp: 1 }, map: { name: '' } });
    const result = parseGsiPayload(emptyName);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_SHAPE');
      expect(result.error.issues[0]).toMatch(/^map\.name: /);
    }
  });
});
