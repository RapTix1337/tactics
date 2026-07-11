/* eslint-disable import-x/no-nodejs-modules --
 * ADR-019 keeps production core pure; this test file runs under Node/Vitest
 * and must read the binding fixture corpus from disk (10-testing.md §2). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createScoreboardEngine, type ScoreboardState } from './engine';
import type { LiveMatchInput } from './input';

const FIXTURES_DIR = fileURLToPath(new URL('../../../../tests/fixtures/gsi/real', import.meta.url));

// Raw fixture shape as recorded (snake_case). The mapping below mirrors what
// the app wiring will do in SCB.7 — deliberately test-local, because this
// module must not import `gsi` types (ADR-021, design §2.2).
interface RawTeam {
  score?: number;
  consecutive_round_losses?: number;
  timeouts_remaining?: number;
}
interface RawFixture {
  provider?: { steamid?: string };
  map?: {
    name?: string;
    mode?: string;
    phase?: string;
    round?: number;
    team_ct?: RawTeam;
    team_t?: RawTeam;
    round_wins?: Record<string, string>;
  };
  round?: { phase?: string; bomb?: string };
  player?: {
    steamid?: string;
    team?: string;
    match_stats?: {
      kills?: number;
      assists?: number;
      deaths?: number;
      mvps?: number;
      score?: number;
    };
    state?: {
      health?: number;
      armor?: number;
      helmet?: boolean;
      money?: number;
      equip_value?: number;
      round_kills?: number;
      round_killhs?: number;
    };
  };
}

function toTeam(team: RawTeam | undefined) {
  if (team === undefined) return null;
  return {
    score: team.score ?? null,
    consecutiveRoundLosses: team.consecutive_round_losses ?? null,
    timeoutsRemaining: team.timeouts_remaining ?? null,
  };
}

function toInput(raw: RawFixture): LiveMatchInput {
  return {
    mapName: raw.map?.name ?? null,
    providerSteamId: raw.provider?.steamid ?? null,
    map:
      raw.map === undefined
        ? null
        : {
            mode: raw.map.mode ?? null,
            phase: raw.map.phase ?? null,
            round: raw.map.round ?? null,
            teamCt: toTeam(raw.map.team_ct),
            teamT: toTeam(raw.map.team_t),
            roundWins: raw.map.round_wins ?? null,
          },
    round:
      raw.round === undefined
        ? null
        : { phase: raw.round.phase ?? null, bomb: raw.round.bomb ?? null },
    player:
      raw.player === undefined
        ? null
        : {
            steamId: raw.player.steamid ?? null,
            team: raw.player.team ?? null,
            matchStats:
              raw.player.match_stats === undefined
                ? null
                : {
                    kills: raw.player.match_stats.kills ?? null,
                    assists: raw.player.match_stats.assists ?? null,
                    deaths: raw.player.match_stats.deaths ?? null,
                    mvps: raw.player.match_stats.mvps ?? null,
                    score: raw.player.match_stats.score ?? null,
                  },
            state:
              raw.player.state === undefined
                ? null
                : {
                    health: raw.player.state.health ?? null,
                    armor: raw.player.state.armor ?? null,
                    helmet: raw.player.state.helmet ?? null,
                    money: raw.player.state.money ?? null,
                    equipValue: raw.player.state.equip_value ?? null,
                    roundKills: raw.player.state.round_kills ?? null,
                    roundHsKills: raw.player.state.round_killhs ?? null,
                  },
          },
  };
}

function fixture(relativePath: string): LiveMatchInput {
  const rawText = readFileSync(join(FIXTURES_DIR, `${relativePath}.json`), 'utf8');
  return toInput(JSON.parse(rawText) as RawFixture);
}

function scenario(name: string): LiveMatchInput[] {
  return readdirSync(join(FIXTURES_DIR, name)).map((file) =>
    fixture(`${name}/${file.replace(/\.json$/, '')}`),
  );
}

// Synthetic input parts for cases the corpus cannot express.
const SYNTHETIC_MAP = {
  mode: 'competitive',
  phase: 'live',
  round: 3,
  teamCt: { score: 2, consecutiveRoundLosses: 1, timeoutsRemaining: 1 },
  teamT: { score: 1, consecutiveRoundLosses: 0, timeoutsRemaining: 1 },
  roundWins: null,
} as const;
const SYNTHETIC_PLAYER = {
  steamId: '76561190000000000',
  team: 'T',
  matchStats: { kills: 1, assists: 0, deaths: 2, mvps: 0, score: 3 },
  state: {
    health: 100,
    armor: 100,
    helmet: true,
    money: 1000,
    equipValue: 3000,
    roundKills: 0,
    roundHsKills: 0,
  },
} as const;

function syntheticInput(overrides: Partial<LiveMatchInput>): LiveMatchInput {
  return {
    mapName: 'de_fachwerk',
    providerSteamId: '76561190000000000',
    map: SYNTHETIC_MAP,
    round: { phase: 'live', bomb: null },
    player: SYNTHETIC_PLAYER,
    ...overrides,
  };
}

const noopLogger = { error(): void {}, warn(): void {}, info(): void {}, debug(): void {} };

function createEngine() {
  const engine = createScoreboardEngine({ logger: noopLogger });
  const events: ScoreboardState[] = [];
  engine.onStateChanged((state) => events.push(state));
  return { engine, events };
}

// The frozen own snapshot after 06-comp-rounds/002 (last own-identity
// payload before the dead-spectate flip) — spec AC 11 evidence.
const ME_AFTER_06_002 = {
  kills: 6,
  assists: 2,
  deaths: 9,
  mvps: 1,
  score: 17,
  health: 100,
  armor: 100,
  helmet: true,
  money: 1250,
  equipValue: 3900,
  roundKills: 0,
  roundHsKills: 0,
};

describe('createScoreboardEngine', () => {
  it('starts inactive', () => {
    const { engine } = createEngine();
    expect(engine.getState()).toEqual({ active: false });
  });

  it('stays inactive on menu payloads without notifying', () => {
    const { engine, events } = createEngine();
    for (const input of scenario('01-menus')) engine.handleInput(input);
    expect(engine.getState()).toEqual({ active: false });
    expect(events).toEqual([]);
  });

  it('reports inactive for an unsupported mode even with an own player (AC 7)', () => {
    const { engine } = createEngine();
    engine.handleInput(syntheticInput({ map: { ...SYNTHETIC_MAP, mode: 'casual' } }));
    expect(engine.getState()).toEqual({ active: false });
  });

  it('deactivates when a running match switches to an unsupported mode', () => {
    const { engine, events } = createEngine();
    engine.handleInput(syntheticInput({}));
    expect(engine.getState().active).toBe(true);
    engine.handleInput(syntheticInput({ map: { ...SYNTHETIC_MAP, mode: 'casual' } }));
    expect(engine.getState()).toEqual({ active: false });
    expect(events).toHaveLength(2);
  });

  it('stays inactive until the own player has been observed once', () => {
    const { engine } = createEngine();
    engine.handleInput(fixture('07-dead-spectate/001')); // spectated teammate
    expect(engine.getState()).toEqual({ active: false });
    engine.handleInput(fixture('07-dead-spectate/004')); // own player again
    expect(engine.getState().active).toBe(true);
  });

  it('builds the full slice from a competitive freezetime payload', () => {
    const { engine } = createEngine();
    engine.handleInput(fixture('06-comp-rounds/001'));
    expect(engine.getState()).toEqual({
      active: true,
      phase: 'freezetime',
      roundNumber: 11,
      halftimeAfter: 12,
      myTeam: { side: 'T', score: 6, lossStreak: 0, timeoutsRemaining: 1 },
      enemyTeam: { side: 'CT', score: 4, lossStreak: 2, timeoutsRemaining: 1 },
      roundHistory: [],
      me: {
        kills: 6,
        assists: 2,
        deaths: 9,
        mvps: 1,
        score: 17,
        health: 100,
        armor: 0,
        helmet: false,
        money: 4950,
        equipValue: 200,
        roundKills: 0,
        roundHsKills: 0,
      },
      derived: { approximate: true, hsRatePercent: null },
    });
  });

  it('freezes own stats while dead-spectating and unfreezes on the own payload (AC 11)', () => {
    const { engine } = createEngine();
    engine.handleInput(fixture('06-comp-rounds/002')); // own snapshot
    engine.handleInput(fixture('06-comp-rounds/003')); // teammate (alive)
    engine.handleInput(fixture('07-dead-spectate/001')); // teammate
    engine.handleInput(fixture('07-dead-spectate/002')); // teammate, round over
    engine.handleInput(fixture('07-dead-spectate/003')); // no player block

    const frozen = engine.getState();
    expect(frozen.active).toBe(true);
    if (frozen.active) {
      expect(frozen.me).toEqual(ME_AFTER_06_002);
      // Team/round data kept flowing while the own stats stayed frozen.
      expect(frozen.phase).toBe('round-over');
      expect(frozen.roundNumber).toBe(11);
    }

    engine.handleInput(fixture('07-dead-spectate/004')); // own player again
    const unfrozen = engine.getState();
    expect(unfrozen.active).toBe(true);
    if (unfrozen.active) {
      expect(unfrozen.me).toEqual({
        kills: 6,
        assists: 3,
        deaths: 10,
        mvps: 1,
        score: 18,
        health: 100,
        armor: 0,
        helmet: false,
        money: 2650,
        equipValue: 200,
        roundKills: 0,
        roundHsKills: 0,
      });
      expect(unfrozen.myTeam).toEqual({ side: 'T', score: 6, lossStreak: 1, timeoutsRemaining: 1 });
      expect(unfrozen.enemyTeam).toEqual({
        side: 'CT',
        score: 5,
        lossStreak: 0,
        timeoutsRemaining: 1,
      });
    }
  });

  // Display round rule (corpus-verified): `map.round` counts completed
  // rounds and increments the moment a round ends — so during `over` (and
  // after `gameover`) it already names the display round, otherwise the
  // display round is the next one.
  it.each([
    { setup: null, target: '10-wingman/001', phase: 'warmup', roundNumber: 1 },
    { setup: null, target: '06-comp-rounds/001', phase: 'freezetime', roundNumber: 11 },
    { setup: null, target: '06-comp-rounds/002', phase: 'live', roundNumber: 11 },
    {
      setup: '08-halftime-swap/005',
      target: '09-match-end/003',
      phase: 'bomb-planted',
      roundNumber: 13,
    },
    {
      setup: '06-comp-rounds/002',
      target: '07-dead-spectate/002',
      phase: 'round-over',
      roundNumber: 11,
    },
    {
      setup: '08-halftime-swap/005',
      target: '09-match-end/012',
      phase: 'round-over',
      roundNumber: 24,
    },
  ])(
    'maps $target to phase $phase, display round $roundNumber',
    ({ setup, target, phase, roundNumber }) => {
      const { engine } = createEngine();
      if (setup !== null) engine.handleInput(fixture(setup));
      engine.handleInput(fixture(target));
      const state = engine.getState();
      expect(state.active).toBe(true);
      if (state.active) {
        expect(state.phase).toBe(phase);
        expect(state.roundNumber).toBe(roundNumber);
      }
    },
  );

  it('falls back to the live phase when the round section is missing', () => {
    const { engine } = createEngine();
    engine.handleInput(syntheticInput({ round: null }));
    const state = engine.getState();
    expect(state.active).toBe(true);
    if (state.active) expect(state.phase).toBe('live');
  });

  it('follows the halftime side swap (AC 3)', () => {
    const { engine } = createEngine();
    engine.handleInput(fixture('08-halftime-swap/003')); // intermission, still T
    const beforeSwap = engine.getState();
    expect(beforeSwap.active).toBe(true);
    if (beforeSwap.active) {
      expect(beforeSwap.phase).toBe('round-over');
      expect(beforeSwap.roundNumber).toBe(12);
      expect(beforeSwap.myTeam).toEqual({
        side: 'T',
        score: 6,
        lossStreak: 2,
        timeoutsRemaining: 1,
      });
      expect(beforeSwap.enemyTeam).toEqual({
        side: 'CT',
        score: 6,
        lossStreak: 0,
        timeoutsRemaining: 1,
      });
    }

    engine.handleInput(fixture('08-halftime-swap/005')); // second half, now CT
    const afterSwap = engine.getState();
    expect(afterSwap.active).toBe(true);
    if (afterSwap.active) {
      expect(afterSwap.phase).toBe('freezetime');
      expect(afterSwap.roundNumber).toBe(13);
      expect(afterSwap.myTeam).toEqual({
        side: 'CT',
        score: 6,
        lossStreak: 1,
        timeoutsRemaining: 1,
      });
      expect(afterSwap.enemyTeam).toEqual({
        side: 'T',
        score: 6,
        lossStreak: 1,
        timeoutsRemaining: 1,
      });
    }
  });

  it('handles wingman with its MR8 halftime (AC 14)', () => {
    const { engine } = createEngine();
    engine.handleInput(fixture('10-wingman/001'));
    const firstHalf = engine.getState();
    expect(firstHalf.active).toBe(true);
    if (firstHalf.active) {
      expect(firstHalf.halftimeAfter).toBe(8);
      expect(firstHalf.myTeam.side).toBe('T');
    }

    engine.handleInput(fixture('10-wingman/011')); // second half, now CT
    const secondHalf = engine.getState();
    expect(secondHalf.active).toBe(true);
    if (secondHalf.active) {
      expect(secondHalf.roundNumber).toBe(9);
      expect(secondHalf.myTeam).toEqual({
        side: 'CT',
        score: 6,
        lossStreak: 0,
        timeoutsRemaining: 1,
      });
      expect(secondHalf.enemyTeam).toEqual({
        side: 'T',
        score: 2,
        lossStreak: 0,
        timeoutsRemaining: 1,
      });
    }
  });

  it('notifies only on structural change', () => {
    const { engine, events } = createEngine();
    engine.handleInput(fixture('06-comp-rounds/001'));
    engine.handleInput(fixture('06-comp-rounds/001')); // identical burst
    expect(events).toHaveLength(1);
    engine.handleInput(fixture('06-comp-rounds/002')); // real change
    expect(events).toHaveLength(2);
  });

  it('deactivates once on notifyGsiInactive and starts fresh afterwards', () => {
    const { engine, events } = createEngine();
    engine.handleInput(fixture('06-comp-rounds/002'));
    expect(events).toHaveLength(1);

    engine.notifyGsiInactive();
    expect(engine.getState()).toEqual({ active: false });
    engine.notifyGsiInactive(); // no state change — no second event
    expect(events).toHaveLength(2);

    // Own tracking was cleared: a foreign payload alone cannot reactivate.
    engine.handleInput(fixture('06-comp-rounds/003'));
    expect(engine.getState()).toEqual({ active: false });
    engine.handleInput(fixture('06-comp-rounds/002'));
    expect(engine.getState().active).toBe(true);
  });

  it('drops the own snapshot on a map change', () => {
    const { engine } = createEngine();
    engine.handleInput(fixture('06-comp-rounds/002'));
    expect(engine.getState().active).toBe(true);

    // Same supported mode, new map, but only a foreign player observed yet.
    engine.handleInput(
      syntheticInput({
        mapName: 'de_mirage',
        player: { ...SYNTHETIC_PLAYER, steamId: '76561190000000001' },
      }),
    );
    expect(engine.getState()).toEqual({ active: false });
  });

  it('deactivates when CS2 returns to the menus mid-replay', () => {
    const { engine } = createEngine();
    engine.handleInput(fixture('06-comp-rounds/002'));
    expect(engine.getState().active).toBe(true);
    engine.handleInput(fixture('06-comp-rounds/004')); // menu payload
    expect(engine.getState()).toEqual({ active: false });
  });

  it('emits no SteamIDs anywhere in any state across the whole corpus', () => {
    const { engine, events } = createEngine();
    for (const scenarioName of readdirSync(FIXTURES_DIR)) {
      for (const input of scenario(scenarioName)) engine.handleInput(input);
    }
    for (const state of [...events, engine.getState()]) {
      expect(JSON.stringify(state)).not.toMatch(/7656\d{13}/);
    }
    expect(events.length).toBeGreaterThan(0);
  });

  it('stops handling input and notifying after dispose', () => {
    const { engine, events } = createEngine();
    engine.handleInput(fixture('06-comp-rounds/001'));
    engine.dispose();
    engine.handleInput(fixture('06-comp-rounds/002'));
    engine.notifyGsiInactive();
    expect(events).toHaveLength(1);
  });
});
