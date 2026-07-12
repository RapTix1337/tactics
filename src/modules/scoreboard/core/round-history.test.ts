import { describe, expect, it } from 'vitest';

import { deriveFirstHalfSide, deriveRoundHistory } from './round-history';

// Corpus-shaped `round_wins` values (SCB.1): the winner is the value's
// `ct_win`/`t_win` prefix; keys are contiguous 1-based round numbers.
const COMP_FIRST_HALF_WINS = {
  '1': 't_win_elimination',
  '2': 't_win_bomb',
  '3': 'ct_win_defuse',
  '4': 'ct_win_elimination',
};

describe('deriveFirstHalfSide', () => {
  it('returns the own side while the display round is in the first half', () => {
    expect(deriveFirstHalfSide('T', 1, 12)).toBe('T');
    expect(deriveFirstHalfSide('CT', 12, 12)).toBe('CT');
  });

  it('returns the flipped side in the second half', () => {
    expect(deriveFirstHalfSide('CT', 13, 12)).toBe('T');
    expect(deriveFirstHalfSide('T', 24, 12)).toBe('CT');
    expect(deriveFirstHalfSide('CT', 9, 8)).toBe('T');
  });

  it('returns null in overtime — regulation halves are not derivable there', () => {
    expect(deriveFirstHalfSide('CT', 25, 12)).toBeNull();
    expect(deriveFirstHalfSide('T', 17, 8)).toBeNull();
  });
});

describe('deriveRoundHistory', () => {
  it('maps win values from the first-half perspective', () => {
    expect(
      deriveRoundHistory({
        roundWins: COMP_FIRST_HALF_WINS,
        firstHalfSide: 'T',
        halftimeAfter: 12,
      }),
    ).toEqual(['won', 'won', 'lost', 'lost']);
    expect(
      deriveRoundHistory({
        roundWins: COMP_FIRST_HALF_WINS,
        firstHalfSide: 'CT',
        halftimeAfter: 12,
      }),
    ).toEqual(['lost', 'lost', 'won', 'won']);
  });

  it('flips the perspective for second-half rounds at the halftime boundary', () => {
    const roundWins = {
      '1': 't_win_elimination',
      '2': 'ct_win_elimination',
      '3': 't_win_bomb',
    };
    // halftimeAfter 2: rounds 1–2 as T, round 3 as CT.
    expect(deriveRoundHistory({ roundWins, firstHalfSide: 'T', halftimeAfter: 2 })).toEqual([
      'won',
      'lost',
      'lost',
    ]);
  });

  it('handles the wingman MR8 half length', () => {
    const roundWins = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [
        String(i + 1),
        i < 6 ? 't_win_elimination' : 'ct_win_elimination',
      ]),
    );
    // First half (1–8) as T, round 9 as CT — corpus 10-wingman/013 shape.
    expect(deriveRoundHistory({ roundWins, firstHalfSide: 'T', halftimeAfter: 8 })).toEqual([
      'won',
      'won',
      'won',
      'won',
      'won',
      'won',
      'lost',
      'lost',
      'won',
    ]);
  });

  it('truncates overtime rounds beyond regulation', () => {
    const roundWins = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [String(i + 1), 'ct_win_elimination']),
    );
    // halftimeAfter 2 ⇒ regulation is 4 rounds; entries 5–6 are OT.
    expect(deriveRoundHistory({ roundWins, firstHalfSide: 'CT', halftimeAfter: 2 })).toEqual([
      'won',
      'won',
      'lost',
      'lost',
    ]);
  });

  it('stops at the first unknown win value', () => {
    const roundWins = {
      '1': 't_win_elimination',
      '2': 'surrender',
      '3': 't_win_elimination',
    };
    expect(deriveRoundHistory({ roundWins, firstHalfSide: 'T', halftimeAfter: 12 })).toEqual([
      'won',
    ]);
  });

  it('stops at the first gap in the round keys', () => {
    const roundWins = {
      '1': 't_win_elimination',
      '3': 't_win_elimination',
    };
    expect(deriveRoundHistory({ roundWins, firstHalfSide: 'T', halftimeAfter: 12 })).toEqual([
      'won',
    ]);
  });

  it('returns an empty history without data or orientation', () => {
    expect(deriveRoundHistory({ roundWins: null, firstHalfSide: 'T', halftimeAfter: 12 })).toEqual(
      [],
    );
    expect(deriveRoundHistory({ roundWins: {}, firstHalfSide: 'T', halftimeAfter: 12 })).toEqual(
      [],
    );
    expect(
      deriveRoundHistory({
        roundWins: COMP_FIRST_HALF_WINS,
        firstHalfSide: null,
        halftimeAfter: 12,
      }),
    ).toEqual([]);
  });
});
