import { describe, expect, expectTypeOf, it } from 'vitest';

import type { ScoreboardState } from './scoreboard-state';
import { scoreboardStateSchema } from './scoreboard-state';

const activeSlice: ScoreboardState = {
  active: true,
  phase: 'bomb-planted',
  roundNumber: 13,
  halftimeAfter: 12,
  myTeam: { side: 'CT', score: 7, lossStreak: 0, timeoutsRemaining: 1 },
  enemyTeam: { side: 'T', score: 5, lossStreak: 2, timeoutsRemaining: 1 },
  roundHistory: ['won', 'lost', 'won'],
  me: {
    kills: 10,
    assists: 3,
    deaths: 6,
    mvps: 2,
    score: 24,
    health: 85,
    armor: 100,
    helmet: true,
    money: 3250,
    equipValue: 4700,
    roundKills: 1,
    roundHsKills: 1,
  },
  derived: { approximate: false, hsRatePercent: 40, hsKills: 2 },
};

describe('scoreboardStateSchema', () => {
  it('parses the inactive slice', () => {
    expect(scoreboardStateSchema.parse({ active: false })).toEqual({ active: false });
  });

  it('round-trips an engine-shaped active slice unchanged', () => {
    expect(scoreboardStateSchema.parse(activeSlice)).toEqual(activeSlice);
  });

  it('accepts null leaves where GSI data was absent', () => {
    const sparse: ScoreboardState = {
      ...activeSlice,
      myTeam: { side: 'T', score: null, lossStreak: null, timeoutsRemaining: null },
      me: {
        kills: null,
        assists: null,
        deaths: null,
        mvps: null,
        score: null,
        health: null,
        armor: null,
        helmet: null,
        money: null,
        equipValue: null,
        roundKills: null,
        roundHsKills: null,
      },
      derived: { approximate: true, hsRatePercent: null, hsKills: null },
    };
    expect(scoreboardStateSchema.parse(sparse)).toEqual(sparse);
  });

  it('rejects a slice without the active discriminator', () => {
    expect(scoreboardStateSchema.safeParse({ phase: 'live' }).success).toBe(false);
  });

  it('rejects an unknown phase', () => {
    expect(scoreboardStateSchema.safeParse({ ...activeSlice, phase: 'halftime' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown round-history outcome', () => {
    expect(
      scoreboardStateSchema.safeParse({ ...activeSlice, roundHistory: ['won', 'draw'] }).success,
    ).toBe(false);
  });

  it('rejects an active slice missing a section', () => {
    const withoutMe: Record<string, unknown> = { ...activeSlice };
    delete withoutMe['me'];
    expect(scoreboardStateSchema.safeParse(withoutMe).success).toBe(false);
  });

  it('matches the hand-written contract type in both directions (drift guard)', () => {
    type Inferred = ReturnType<typeof scoreboardStateSchema.parse>;
    expectTypeOf<Inferred>().toMatchTypeOf<ScoreboardState>();
    expectTypeOf<ScoreboardState>().toMatchTypeOf<Inferred>();
  });
});
