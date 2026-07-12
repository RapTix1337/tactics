import type { ScoreboardLayout } from '../../../shared/settings';
import type { ActiveScoreboardState } from './stat-fields';

/**
 * A realistic mid-match slice mirroring the Designer "Live match" card:
 * shared fixture for the component tests and sample data for the settings
 * preview (design §5 — the preview renders the real `MyPerformanceCard`).
 */
export const SAMPLE_SCOREBOARD_STATE: ActiveScoreboardState = {
  active: true,
  phase: 'bomb-planted',
  roundNumber: 17,
  halftimeAfter: 12,
  myTeam: { side: 'CT', score: 8, lossStreak: 0, timeoutsRemaining: 1 },
  enemyTeam: { side: 'T', score: 8, lossStreak: 2, timeoutsRemaining: 1 },
  roundHistory: [
    'lost',
    'won',
    'won',
    'lost',
    'won',
    'lost',
    'lost',
    'won',
    'won',
    'lost',
    'won',
    'lost',
    'won',
    'lost',
    'won',
    'lost',
  ],
  me: {
    kills: 19,
    assists: 4,
    deaths: 12,
    mvps: 3,
    score: 47,
    health: 100,
    armor: 100,
    helmet: true,
    money: 3200,
    equipValue: 4750,
    roundKills: 1,
    roundHsKills: 1,
  },
  derived: { approximate: true, hsRatePercent: 58 },
};

/** The default grouping of 02-design.md §4, as preview/test sample layout. */
export const SAMPLE_SCOREBOARD_LAYOUT: ScoreboardLayout = {
  groups: [
    { label: 'Match totals', fields: ['kills', 'deaths', 'assists', 'kd', 'mvps'] },
    { label: 'Derived', fields: ['hsRate'] },
    { label: 'Live round state', fields: ['health', 'armor', 'money', 'equipValue'] },
  ],
};
