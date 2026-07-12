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

  describe('real corpus — sanitization hygiene (ADR-030, SCB.1)', () => {
    // The capture-side guarantee lives in scripts/gsi-sanitize.mjs (unit
    // tested there); this block makes the checked-in corpus itself prove the
    // guarantee held: whatever the recording session produced, nothing
    // identifying may sit in the repository.
    // Own and foreign (dead-spectate) placeholder — the distinction is
    // deliberate, the player-block flip must survive sanitization (SCB.1).
    const STEAMID_PLACEHOLDERS = ['76561190000000000', '76561190000000001'];

    function walk(value: unknown, inPlayer: boolean, assertNode: (args: NodeContext) => void) {
      if (Array.isArray(value)) {
        for (const entry of value) walk(entry, inPlayer, assertNode);
        return;
      }
      if (value === null || typeof value !== 'object') return;
      for (const [key, entry] of Object.entries(value)) {
        assertNode({ key, entry, inPlayer });
        walk(entry, inPlayer || key === 'player', assertNode);
      }
    }
    interface NodeContext {
      key: string;
      entry: unknown;
      inPlayer: boolean;
    }

    const realDir = join(FIXTURES_DIR, 'real');
    for (const scenario of readdirSync(realDir)) {
      for (const file of readdirSync(join(realDir, scenario))) {
        it(`${scenario}/${file} carries no identifying data`, () => {
          const payload: unknown = JSON.parse(readFixture('real', scenario, file));
          walk(payload, false, ({ key, entry, inPlayer }) => {
            expect(key).not.toBe('allplayers');
            if (key === 'steamid') expect(STEAMID_PLACEHOLDERS).toContain(entry);
            if (inPlayer && key === 'name') expect(entry).toBe('Player');
            if (inPlayer && key === 'clan') expect(entry).toBe('REDACTED');
            if (key === 'auth' && entry !== null && typeof entry === 'object') {
              expect(Object.values(entry)).toEqual(Object.values(entry).map(() => 'REDACTED'));
            }
            // No SteamID64 may hide in any string value under any key.
            if (typeof entry === 'string' && !STEAMID_PLACEHOLDERS.includes(entry)) {
              expect(entry).not.toMatch(/7656\d{13}/);
            }
          });
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
    // The E10.2 future-extension pattern, extended to the SCB.2 sections:
    // unknown fields on map/round are dropped, the known ones extracted.
    const extended = JSON.stringify({
      provider: { timestamp: 1234567890, futureField: { nested: true } },
      map: { name: 'de_future', futureMode: 'wingman2' },
      round: { phase: 'live', futureBomb: 'teleported' },
      newTopLevelSection: [1, 2, 3],
    });
    expect(parseGsiPayload(extended)).toEqual({
      ok: true,
      payload: {
        providerTimestamp: 1234567890,
        mapName: 'de_future',
        providerSteamId: null,
        map: {
          mode: null,
          phase: null,
          round: null,
          teamCt: null,
          teamT: null,
          roundWins: null,
        },
        round: { phase: 'live', bomb: null },
        player: null,
      },
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

  // The widened scoreboard subset (design §2.1): map/round/player sections are
  // extracted tolerantly (all optional) so the scoreboard module (SCB.5) has a
  // single parse point. Values below are read from the SCB.1 corpus.
  describe('widened subset (SCB.2)', () => {
    it('extracts the full map/round/player subset from a scoreboard payload', () => {
      const result = parseGsiPayload(readFixture('real', '06-comp-rounds', '001.json'));
      expect(result).toEqual({
        ok: true,
        payload: {
          providerTimestamp: 1783804468,
          mapName: 'de_fachwerk',
          providerSteamId: '76561190000000000',
          map: {
            mode: 'competitive',
            phase: 'live',
            round: 10,
            teamCt: { score: 4, consecutiveRoundLosses: 2, timeoutsRemaining: 1 },
            teamT: { score: 6, consecutiveRoundLosses: 0, timeoutsRemaining: 1 },
            roundWins: {
              '1': 't_win_elimination',
              '2': 't_win_bomb',
              '3': 'ct_win_defuse',
              '4': 'ct_win_elimination',
              '5': 't_win_elimination',
              '6': 't_win_elimination',
              '7': 'ct_win_elimination',
              '8': 'ct_win_elimination',
              '9': 't_win_elimination',
              '10': 't_win_elimination',
            },
          },
          round: { phase: 'freezetime', bomb: null },
          player: {
            steamId: '76561190000000000',
            team: 'T',
            matchStats: { kills: 6, assists: 2, deaths: 9, mvps: 1, score: 17 },
            state: {
              health: 100,
              armor: 0,
              helmet: false,
              money: 4950,
              equipValue: 200,
              roundKills: 0,
              roundHsKills: 0,
            },
          },
        },
      });
    });

    it('extracts round.bomb when the bomb component is present', () => {
      const result = parseGsiPayload(readFixture('real', '09-match-end', '003.json'));
      expect(result).toMatchObject({ ok: true, payload: { round: { bomb: 'planted' } } });
    });

    it('reports null sections for menu payloads (no map/round/player)', () => {
      const result = parseGsiPayload(readFixture('real', '01-menus', '001.json'));
      // provider.steamid is still present in the menus — only the match
      // sections are absent, and absence is null, never a throw.
      expect(result).toMatchObject({
        ok: true,
        payload: {
          mapName: null,
          providerSteamId: '76561190000000000',
          map: null,
          round: null,
          player: null,
        },
      });
    });

    it('preserves the dead-spectate identity flip (provider vs player steamid)', () => {
      // The spectated teammate carries the foreign placeholder; the identity
      // filter (SCB.5) relies on this distinction surviving parsing (spec AC 11).
      const result = parseGsiPayload(readFixture('real', '07-dead-spectate', '001.json'));
      expect(result).toMatchObject({
        ok: true,
        payload: {
          providerSteamId: '76561190000000000',
          player: { steamId: '76561190000000001' },
        },
      });
    });

    it('degrades a malformed scoreboard sub-field to null without failing the payload', () => {
      // Tolerance intent (not corpus-mirroring): a future type drift in a
      // non-essential field must not kill map-name extraction — the core map
      // feature keeps working. Only the bad leaf degrades to null.
      const drifted = JSON.stringify({
        provider: { timestamp: 7, steamid: '76561190000000000' },
        map: { name: 'de_dust2', round: 'soon', phase: 'live' },
        player: { team: 'CT', state: { health: 100, money: 'lots' } },
      });
      expect(parseGsiPayload(drifted)).toMatchObject({
        ok: true,
        payload: {
          mapName: 'de_dust2',
          map: { round: null, phase: 'live' },
          player: { team: 'CT', state: { health: 100, money: null } },
        },
      });
    });
  });
});
