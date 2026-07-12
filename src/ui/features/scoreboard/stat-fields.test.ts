import { describe, expect, it } from 'vitest';

import { FIELD_IDS } from '../../../shared/settings';
import type { ActiveScoreboardState } from './stat-fields';
import { estimateLossBonus, STAT_FIELDS } from './stat-fields';

function makeState(overrides?: {
  me?: Partial<ActiveScoreboardState['me']>;
  derived?: Partial<ActiveScoreboardState['derived']>;
}): ActiveScoreboardState {
  return {
    active: true,
    phase: 'live',
    roundNumber: 17,
    halftimeAfter: 12,
    myTeam: { side: 'CT', score: 8, lossStreak: 0, timeoutsRemaining: 1 },
    enemyTeam: { side: 'T', score: 8, lossStreak: 2, timeoutsRemaining: 1 },
    roundHistory: ['lost', 'won', 'won', 'lost'],
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
      ...overrides?.me,
    },
    derived: { approximate: false, hsRatePercent: 58, ...overrides?.derived },
  };
}

describe('STAT_FIELDS catalog', () => {
  it('covers every FieldId with a non-empty, unique label', () => {
    const labels = FIELD_IDS.map((id) => STAT_FIELDS[id].label);
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it.each([
    ['kills', '19'],
    ['assists', '4'],
    ['deaths', '12'],
    ['mvps', '3'],
    ['score', '47'],
    ['kd', '1.58'],
    ['kMinusD', '+7'],
    ['hsRate', '58%'],
    ['health', '100'],
    ['armor', '100'],
    ['money', '$3,200'],
    ['equipValue', '$4,750'],
    ['roundKills', '1'],
    ['roundHsKills', '1'],
  ] as const)('formats %s from the slice as %s', (fieldId, expected) => {
    expect(STAT_FIELDS[fieldId].format(makeState()).value).toBe(expected);
  });

  it('renders the placeholder for every direct field GSI omitted', () => {
    const state = makeState({
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
      derived: { hsRatePercent: null },
    });
    for (const id of FIELD_IDS) {
      expect(STAT_FIELDS[id].format(state).value).toBe('—');
    }
  });

  it('derives K/D against one death while deaths is zero', () => {
    const tile = STAT_FIELDS.kd.format(makeState({ me: { kills: 5, deaths: 0 } }));
    expect(tile.value).toBe('5.00');
  });

  it('needs both kills and deaths for the derived fields', () => {
    expect(STAT_FIELDS.kd.format(makeState({ me: { kills: null } })).value).toBe('—');
    expect(STAT_FIELDS.kd.format(makeState({ me: { deaths: null } })).value).toBe('—');
    expect(STAT_FIELDS.kMinusD.format(makeState({ me: { kills: null } })).value).toBe('—');
    expect(STAT_FIELDS.kMinusD.format(makeState({ me: { deaths: null } })).value).toBe('—');
  });

  it('signs K−D explicitly, including zero', () => {
    expect(STAT_FIELDS.kMinusD.format(makeState({ me: { kills: 9, deaths: 12 } })).value).toBe(
      '-3',
    );
    expect(STAT_FIELDS.kMinusD.format(makeState({ me: { kills: 12, deaths: 12 } })).value).toBe(
      '+0',
    );
  });

  it('rounds the HS rate to a whole percent', () => {
    const tile = STAT_FIELDS.hsRate.format(makeState({ derived: { hsRatePercent: 58.333 } }));
    expect(tile.value).toBe('58%');
  });

  it('marks only the HS rate approximate, and only while accumulation is incomplete', () => {
    const approximate = makeState({ derived: { approximate: true } });
    expect(STAT_FIELDS.hsRate.format(approximate).approximate).toBe(true);
    expect(STAT_FIELDS.hsRate.format(makeState()).approximate).toBe(false);
    for (const id of FIELD_IDS.filter((fieldId) => fieldId !== 'hsRate')) {
      expect(STAT_FIELDS[id].format(approximate).approximate).toBe(false);
    }
  });

  it('carries the health bar percentage, clamped to 0–100', () => {
    expect(STAT_FIELDS.health.format(makeState({ me: { health: 37 } })).healthPercent).toBe(37);
    expect(STAT_FIELDS.health.format(makeState({ me: { health: 150 } })).healthPercent).toBe(100);
    expect(STAT_FIELDS.health.format(makeState({ me: { health: -5 } })).healthPercent).toBe(0);
    expect(
      STAT_FIELDS.health.format(makeState({ me: { health: null } })).healthPercent,
    ).toBeUndefined();
    expect(STAT_FIELDS.kills.format(makeState()).healthPercent).toBeUndefined();
  });

  it('flags the helmet on the armor tile only', () => {
    expect(STAT_FIELDS.armor.format(makeState({ me: { helmet: true } })).helmet).toBe(true);
    expect(STAT_FIELDS.armor.format(makeState({ me: { helmet: false } })).helmet).toBe(false);
    expect(STAT_FIELDS.armor.format(makeState({ me: { helmet: null } })).helmet).toBe(false);
    expect(STAT_FIELDS.kills.format(makeState()).helmet).toBeUndefined();
  });

  it('formats money deterministically with dollar sign and thousands grouping', () => {
    expect(STAT_FIELDS.money.format(makeState({ me: { money: 0 } })).value).toBe('$0');
    expect(STAT_FIELDS.money.format(makeState({ me: { money: 800 } })).value).toBe('$800');
    expect(STAT_FIELDS.money.format(makeState({ me: { money: 16000 } })).value).toBe('$16,000');
  });
});

describe('estimateLossBonus', () => {
  it.each([
    [0, 1400],
    [1, 1900],
    [2, 2400],
    [3, 2900],
    [4, 3400],
  ] as const)('maps a loss streak of %i to the $%i tier (fixed CS2 table)', (streak, bonus) => {
    expect(estimateLossBonus(streak)).toBe(bonus);
  });

  it('clamps streaks beyond the table to the top tier and below zero to the base', () => {
    expect(estimateLossBonus(7)).toBe(3400);
    expect(estimateLossBonus(-1)).toBe(1400);
  });
});
