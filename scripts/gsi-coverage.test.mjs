// Unit tests for the capture-tool coverage tracker (SCB.1): live recording
// feedback that tells the maintainer which of the scenario-critical payload
// states have been observed per game mode, so missed transitions are caught
// during the session instead of after curation.
import { describe, expect, it } from 'vitest';

import { createCoverageTracker } from './gsi-coverage.mjs';

const OWN = '76561198012345678';
const OTHER = '76561198087654321';

const payload = ({ mode = 'competitive', roundPhase, bomb, mapPhase = 'live', player } = {}) => ({
  provider: { steamid: OWN, timestamp: 1 },
  map: { name: 'de_dust2', mode, phase: mapPhase, round: 3 },
  ...(roundPhase || bomb
    ? { round: { ...(roundPhase && { phase: roundPhase }), ...(bomb && { bomb }) } }
    : {}),
  ...(player ? { player } : {}),
});

describe('createCoverageTracker', () => {
  it('returns null for payloads without a map mode (menus)', () => {
    const tracker = createCoverageTracker();
    expect(tracker.observe({ provider: { timestamp: 1 } })).toBe(null);
    expect(tracker.observe(null)).toBe(null);
    expect(tracker.observe('not an object')).toBe(null);
  });

  it('starts at 0/7 with every goal missing', () => {
    const tracker = createCoverageTracker();
    const summary = tracker.observe(payload({ mapPhase: 'warmup' }));
    expect(summary).toBe(
      'competitive 0/7 (missing: freezetime, live round, bomb planted, round over, dead-spectate, halftime swap, match end)',
    );
  });

  it('accumulates round phases, bomb, and match end', () => {
    const tracker = createCoverageTracker();
    tracker.observe(payload({ roundPhase: 'freezetime' }));
    tracker.observe(payload({ roundPhase: 'live' }));
    tracker.observe(payload({ roundPhase: 'live', bomb: 'planted' }));
    tracker.observe(payload({ roundPhase: 'over' }));
    const summary = tracker.observe(payload({ mapPhase: 'gameover' }));
    expect(summary).toBe('competitive 5/7 (missing: dead-spectate, halftime swap)');
  });

  it('detects the dead-spectate flip via a foreign player steamid', () => {
    const tracker = createCoverageTracker();
    const before = tracker.observe(payload({ player: { steamid: OWN, team: 'CT' } }));
    expect(before).toContain('dead-spectate');
    const after = tracker.observe(payload({ player: { steamid: OTHER, team: 'CT' } }));
    expect(after).toContain('1/7');
    expect(after).not.toContain('dead-spectate');
  });

  it('detects the halftime swap once the own player was seen on both sides', () => {
    const tracker = createCoverageTracker();
    tracker.observe(payload({ player: { steamid: OWN, team: 'CT' } }));
    expect(tracker.observe(payload({ player: { steamid: OWN, team: 'CT' } }))).toContain(
      'halftime swap',
    );
    const summary = tracker.observe(payload({ player: { steamid: OWN, team: 'T' } }));
    expect(summary).not.toContain('halftime swap');
  });

  it('ignores the spectated teammate for the halftime swap detection', () => {
    const tracker = createCoverageTracker();
    tracker.observe(payload({ player: { steamid: OWN, team: 'CT' } }));
    const summary = tracker.observe(payload({ player: { steamid: OTHER, team: 'T' } }));
    expect(summary).toContain('halftime swap');
  });

  it('tracks each game mode independently', () => {
    const tracker = createCoverageTracker();
    tracker.observe(payload({ roundPhase: 'freezetime' }));
    const wingman = tracker.observe(payload({ mode: 'scrimcomp2v2', roundPhase: 'live' }));
    expect(wingman).toBe(
      'scrimcomp2v2 1/7 (missing: freezetime, bomb planted, round over, dead-spectate, halftime swap, match end)',
    );
    const comp = tracker.observe(payload({ roundPhase: 'live' }));
    expect(comp).toBe(
      'competitive 2/7 (missing: bomb planted, round over, dead-spectate, halftime swap, match end)',
    );
  });

  it('lists one summary per observed mode for the startup resume message', () => {
    const tracker = createCoverageTracker();
    expect(tracker.summaries()).toEqual([]);
    tracker.observe(payload({ roundPhase: 'freezetime' }));
    tracker.observe(payload({ mode: 'scrimcomp2v2', roundPhase: 'live' }));
    expect(tracker.summaries()).toEqual([
      'competitive 1/7 (missing: live round, bomb planted, round over, dead-spectate, halftime swap, match end)',
      'scrimcomp2v2 1/7 (missing: freezetime, bomb planted, round over, dead-spectate, halftime swap, match end)',
    ]);
  });

  it('detects the dead-spectate flip on already-sanitized payloads (coverage seeding)', () => {
    // Seeded from disk the steamids are placeholders — the own/other
    // distinction must still work because the placeholders differ.
    const tracker = createCoverageTracker();
    const summary = tracker.observe({
      provider: { steamid: '76561190000000000', timestamp: 1 },
      map: { name: 'de_dust2', mode: 'competitive', phase: 'live', round: 3 },
      player: { steamid: '76561190000000001', name: 'Player', team: 'CT' },
    });
    expect(summary).toContain('1/7');
    expect(summary).not.toContain('dead-spectate');
  });

  it('reports full coverage without a missing list', () => {
    const tracker = createCoverageTracker();
    tracker.observe(payload({ roundPhase: 'freezetime' }));
    tracker.observe(payload({ roundPhase: 'live', bomb: 'planted' }));
    tracker.observe(payload({ roundPhase: 'over' }));
    tracker.observe(payload({ player: { steamid: OTHER } }));
    tracker.observe(payload({ player: { steamid: OWN, team: 'CT' } }));
    tracker.observe(payload({ player: { steamid: OWN, team: 'T' } }));
    const summary = tracker.observe(payload({ mapPhase: 'gameover' }));
    expect(summary).toBe('competitive 7/7');
  });
});
