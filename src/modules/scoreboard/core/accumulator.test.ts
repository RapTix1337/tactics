import { describe, expect, it } from 'vitest';

import { createHsAccumulator } from './accumulator';

// Shorthand: an own observation carrying only the fields the accumulator
// reads (match kills + per-round kill counters).
function own(kills: number, roundKills: number, roundHsKills: number) {
  return { kills, roundKills, roundHsKills };
}

describe('createHsAccumulator', () => {
  it('reports approximate with no rate before any own observation', () => {
    const acc = createHsAccumulator();
    expect(acc.getDerived()).toEqual({ approximate: true, hsRatePercent: null, hsKills: null });

    acc.observe({ displayRound: 3, own: null }); // foreign-only payloads
    expect(acc.getDerived()).toEqual({ approximate: true, hsRatePercent: null, hsKills: null });
  });

  it('is exact from a fresh-match start and null until the first kill', () => {
    const acc = createHsAccumulator();
    acc.observe({ displayRound: 1, own: own(0, 0, 0) });
    expect(acc.getDerived()).toEqual({ approximate: false, hsRatePercent: null, hsKills: 0 });
  });

  it('includes the in-progress round in the rate immediately', () => {
    const acc = createHsAccumulator();
    acc.observe({ displayRound: 1, own: own(0, 0, 0) });
    acc.observe({ displayRound: 1, own: own(2, 2, 1) });
    expect(acc.getDerived()).toEqual({ approximate: false, hsRatePercent: 50, hsKills: 1 });
  });

  it('folds completed rounds into the totals on round advance', () => {
    const acc = createHsAccumulator();
    acc.observe({ displayRound: 1, own: own(2, 2, 2) });
    acc.observe({ displayRound: 2, own: own(2, 0, 0) }); // round 1 folded
    acc.observe({ displayRound: 2, own: own(3, 1, 0) });
    // 2 kills (2 HS) folded + 1 pending (0 HS) ⇒ 2/3.
    expect(acc.getDerived()).toEqual({
      approximate: false,
      hsRatePercent: (2 / 3) * 100,
      hsKills: 2,
    });
  });

  it('folds a completed round exactly once under repeated payloads', () => {
    const acc = createHsAccumulator();
    acc.observe({ displayRound: 1, own: own(1, 1, 1) });
    acc.observe({ displayRound: 2, own: own(1, 0, 0) });
    acc.observe({ displayRound: 2, own: own(1, 0, 0) });
    acc.observe({ displayRound: 2, own: null });
    acc.observe({ displayRound: 3, own: own(1, 0, 0) });
    expect(acc.getDerived()).toEqual({ approximate: false, hsRatePercent: 100, hsKills: 1 });
  });

  it('skips rounds without an own observation instead of misfolding stale values', () => {
    const acc = createHsAccumulator();
    acc.observe({ displayRound: 1, own: own(1, 1, 1) });
    // Rounds 2–3 pass with foreign payloads only (dead-spectate / gap).
    acc.observe({ displayRound: 2, own: null });
    acc.observe({ displayRound: 4, own: own(3, 1, 0) });
    // Only round 1 (1 kill, 1 HS) folded + round-4 pending (1 kill, 0 HS).
    expect(acc.getDerived()).toEqual({ approximate: false, hsRatePercent: 50, hsKills: 1 });
  });

  it('counts accumulated headshot kills for the counter field (2026-07-12 request)', () => {
    const acc = createHsAccumulator();
    expect(acc.getDerived().hsKills).toBeNull();

    acc.observe({ displayRound: 1, own: own(0, 0, 0) });
    expect(acc.getDerived().hsKills).toBe(0);

    acc.observe({ displayRound: 1, own: own(2, 2, 1) });
    expect(acc.getDerived().hsKills).toBe(1);

    acc.observe({ displayRound: 2, own: own(2, 0, 0) }); // round 1 folded
    acc.observe({ displayRound: 2, own: own(4, 2, 2) });
    expect(acc.getDerived().hsKills).toBe(3);
  });

  it('rates 0 percent once kills exist without headshots', () => {
    const acc = createHsAccumulator();
    acc.observe({ displayRound: 1, own: own(1, 1, 0) });
    expect(acc.getDerived()).toEqual({ approximate: false, hsRatePercent: 0, hsKills: 0 });
  });

  it('flags approximate when accumulation starts past round 1 (AC 10)', () => {
    const acc = createHsAccumulator();
    acc.observe({ displayRound: 11, own: own(6, 0, 0) });
    expect(acc.getDerived()).toEqual({ approximate: true, hsRatePercent: null, hsKills: 0 });
  });

  it('stays exact on a round-1 mid-round start whose kills are all pending', () => {
    const acc = createHsAccumulator();
    acc.observe({ displayRound: 1, own: own(2, 2, 1) });
    expect(acc.getDerived()).toEqual({ approximate: false, hsRatePercent: 50, hsKills: 1 });
  });

  it('flags approximate when first-sight kills exceed the pending round kills', () => {
    const acc = createHsAccumulator();
    acc.observe({ displayRound: 1, own: own(2, 1, 1) });
    expect(acc.getDerived().approximate).toBe(true);
  });

  it('resets on a display-round regression and reports it', () => {
    const acc = createHsAccumulator();
    acc.observe({ displayRound: 5, own: own(4, 1, 1) });
    expect(acc.getDerived().approximate).toBe(true);

    // mp_restartgame: the round drops, the same payload is a fresh round 1.
    const result = acc.observe({ displayRound: 1, own: own(0, 0, 0) });
    expect(result.wasReset).toBe(true);
    expect(acc.getDerived()).toEqual({ approximate: false, hsRatePercent: null, hsKills: 0 });
  });

  it('survives a torn round-end regression without resetting or double-folding', () => {
    const acc = createHsAccumulator();
    acc.observe({ displayRound: 4, own: own(1, 1, 0) });
    acc.observe({ displayRound: 5, own: own(1, 0, 0) }); // round 4 folded
    acc.observe({ displayRound: 5, own: own(2, 1, 1) });

    // Torn snapshot: phase `over` while map.round still derives round 4.
    const torn = acc.observe({ displayRound: 4, roundOver: true, own: own(2, 1, 1) });
    expect(torn.wasReset).toBe(false);

    acc.observe({ displayRound: 5, roundOver: true, own: own(2, 1, 1) });
    acc.observe({ displayRound: 6, own: own(2, 0, 0) }); // round 5 folds once
    expect(acc.getDerived()).toEqual({ approximate: true, hsRatePercent: 50, hsKills: 1 });
  });

  it('survives the torn regression to display round 1 at the end of round 2', () => {
    const acc = createHsAccumulator();
    acc.observe({ displayRound: 1, own: own(0, 0, 0) });
    acc.observe({ displayRound: 2, own: own(1, 1, 0) });

    // Round 2 ends torn: `over` with map.round still 1 derives display 1.
    const torn = acc.observe({ displayRound: 1, roundOver: true, own: own(1, 1, 0) });
    expect(torn.wasReset).toBe(false);

    acc.observe({ displayRound: 3, own: own(1, 0, 0) });
    expect(acc.getDerived()).toEqual({ approximate: false, hsRatePercent: 0, hsKills: 0 });
  });

  it('resets on an own-kills regression', () => {
    const acc = createHsAccumulator();
    acc.observe({ displayRound: 2, own: own(3, 1, 1) });
    const result = acc.observe({ displayRound: 2, own: own(0, 0, 0) });
    expect(result.wasReset).toBe(true);
    expect(acc.getDerived()).toEqual({ approximate: true, hsRatePercent: null, hsKills: 0 });
  });

  it('does not report a reset on ordinary progress', () => {
    const acc = createHsAccumulator();
    expect(acc.observe({ displayRound: 1, own: own(0, 0, 0) }).wasReset).toBe(false);
    expect(acc.observe({ displayRound: 2, own: own(1, 0, 0) }).wasReset).toBe(false);
  });

  it('clears everything on reset()', () => {
    const acc = createHsAccumulator();
    acc.observe({ displayRound: 1, own: own(2, 2, 2) });
    acc.observe({ displayRound: 2, own: own(2, 0, 0) });
    acc.reset();
    expect(acc.getDerived()).toEqual({ approximate: true, hsRatePercent: null, hsKills: null });

    // Fresh accumulation after the reset behaves like a new match.
    acc.observe({ displayRound: 1, own: own(0, 0, 0) });
    expect(acc.getDerived()).toEqual({ approximate: false, hsRatePercent: null, hsKills: 0 });
  });

  it('tolerates null own leaves without corrupting the totals', () => {
    const acc = createHsAccumulator();
    acc.observe({ displayRound: 1, own: { kills: null, roundKills: null, roundHsKills: null } });
    expect(acc.getDerived()).toEqual({ approximate: false, hsRatePercent: null, hsKills: 0 });
    acc.observe({ displayRound: 1, own: own(1, 1, 1) });
    acc.observe({ displayRound: 2, own: own(1, 0, 0) });
    expect(acc.getDerived()).toEqual({ approximate: false, hsRatePercent: 100, hsKills: 1 });
  });
});
