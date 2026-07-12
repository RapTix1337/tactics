import { describe, expect, it } from 'vitest';

import type { GsiPayloadSubset, GsiState } from '../../modules/gsi';
import type { Logger, ScoreboardState } from '../../shared';
import { createScoreboardWiring } from './scoreboard-wiring';

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

// Sanitizer-style placeholder (tests/fixtures/gsi/real README) — the slice
// hygiene test below proves it never leaves the wiring.
const OWN_STEAMID = '76561190000000000';

const livePayload: GsiPayloadSubset = {
  providerTimestamp: 1,
  mapName: 'de_mirage',
  providerSteamId: OWN_STEAMID,
  map: {
    mode: 'competitive',
    phase: 'live',
    round: 3,
    teamCt: { score: 2, consecutiveRoundLosses: 1, timeoutsRemaining: 1 },
    teamT: { score: 1, consecutiveRoundLosses: 2, timeoutsRemaining: 1 },
    roundWins: { '1': 'ct_win_elimination', '2': 't_win_bomb', '3': 'ct_win_defuse' },
  },
  round: { phase: 'live', bomb: null },
  player: {
    steamId: OWN_STEAMID,
    team: 'CT',
    matchStats: { kills: 5, assists: 1, deaths: 2, mvps: 1, score: 12 },
    state: {
      health: 100,
      armor: 100,
      helmet: true,
      money: 4300,
      equipValue: 5100,
      roundKills: 0,
      roundHsKills: 0,
    },
  },
};

const menuPayload: GsiPayloadSubset = {
  providerTimestamp: 2,
  mapName: null,
  providerSteamId: OWN_STEAMID,
  map: null,
  round: null,
  player: null,
};

function setup(): {
  wiring: ReturnType<typeof createScoreboardWiring>;
  published: ScoreboardState[];
  emitGsiState: (state: GsiState) => void;
} {
  const published: ScoreboardState[] = [];
  const listeners = new Set<(state: GsiState) => void>();
  const wiring = createScoreboardWiring({
    statusMachine: {
      onStateChanged: (listener): (() => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    publish: (state) => published.push(state),
    logger: silentLogger,
  });
  return {
    wiring,
    published,
    emitGsiState: (state): void => {
      for (const listener of listeners) listener(state);
    },
  };
}

describe('createScoreboardWiring', () => {
  it('publishes the active slice once the own player was observed', () => {
    const { wiring, published } = setup();

    wiring.handlePayload(livePayload);

    expect(published).toHaveLength(1);
    const state = published[0];
    expect(state).toMatchObject({
      active: true,
      phase: 'live',
      roundNumber: 4,
      halftimeAfter: 12,
      myTeam: { side: 'CT', score: 2 },
      enemyTeam: { side: 'T', score: 1 },
      roundHistory: ['won', 'lost', 'won'],
      me: { kills: 5, health: 100 },
    });
  });

  it('publishes exactly once for an identical payload burst (no publish storm)', () => {
    const { wiring, published } = setup();

    for (let i = 0; i < 25; i += 1) {
      wiring.handlePayload(livePayload);
    }

    expect(published).toHaveLength(1);
  });

  it('deactivates when CS2 goes back to the menus (payload without a map)', () => {
    const { wiring, published } = setup();

    wiring.handlePayload(livePayload);
    wiring.handlePayload(menuPayload);

    expect(published).toHaveLength(2);
    expect(published[1]).toEqual({ active: false });
  });

  it('deactivates when the gsi status machine leaves connected (stale)', () => {
    const { wiring, published, emitGsiState } = setup();

    wiring.handlePayload(livePayload);
    emitGsiState({ status: 'stale', mapName: null });

    expect(published).toHaveLength(2);
    expect(published[1]).toEqual({ active: false });
  });

  it('ignores status transitions to connected (payloads already drive the engine)', () => {
    const { wiring, published, emitGsiState } = setup();

    wiring.handlePayload(livePayload);
    emitGsiState({ status: 'connected', mapName: 'de_mirage' });

    expect(published).toHaveLength(1);
    expect(wiring.getScoreboardState().active).toBe(true);
  });

  it('serves the current slice for the snapshot', () => {
    const { wiring } = setup();

    expect(wiring.getScoreboardState()).toEqual({ active: false });
    wiring.handlePayload(livePayload);
    expect(wiring.getScoreboardState().active).toBe(true);
  });

  it('never lets a SteamID into a published slice (ADR-030)', () => {
    const { wiring, published, emitGsiState } = setup();

    wiring.handlePayload(livePayload);
    emitGsiState({ status: 'stale', mapName: null });

    for (const state of published) {
      expect(JSON.stringify(state)).not.toContain(OWN_STEAMID.slice(0, 12));
    }
  });

  it('stops publishing after dispose', () => {
    const { wiring, published, emitGsiState } = setup();

    wiring.handlePayload(livePayload);
    wiring.dispose();
    wiring.handlePayload(menuPayload);
    emitGsiState({ status: 'stale', mapName: null });

    expect(published).toHaveLength(1);
  });
});
