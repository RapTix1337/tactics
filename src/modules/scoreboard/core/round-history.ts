/**
 * Round-history mapping (ADR-052, design §2.2): `map.round_wins` values
 * (`ct_win_*` / `t_win_*`, contiguous 1-based keys) become won/lost from the
 * user's perspective via the side they played each half. Overtime is out of
 * scope (SCB.6): the history covers regulation rounds only, and once the
 * match is past regulation the orientation must come from a first-half side
 * remembered during regulation (the engine's job) — sides swap on OT's own
 * rhythm, so it is not derivable from the current side anymore.
 */

import type { RoundOutcome, TeamSide } from '../../../shared';

// Lifted into the shared IPC contract by SCB.7; re-exported so the module's
// internals keep one import site.
export type { RoundOutcome, TeamSide } from '../../../shared';

function flip(side: TeamSide): TeamSide {
  return side === 'CT' ? 'T' : 'CT';
}

/**
 * The side the user played in the first half, inferred from their current
 * side — or `null` once the display round is past regulation (overtime).
 */
export function deriveFirstHalfSide(
  ownSide: TeamSide,
  displayRound: number,
  halftimeAfter: number,
): TeamSide | null {
  if (displayRound <= halftimeAfter) return ownSide;
  if (displayRound <= halftimeAfter * 2) return flip(ownSide);
  return null;
}

function parseWinner(value: string): TeamSide | null {
  if (value.startsWith('ct_win')) return 'CT';
  if (value.startsWith('t_win')) return 'T';
  return null;
}

/**
 * Maps the contiguous prefix of `round_wins` to outcomes — stopping at the
 * first missing key or unknown value keeps index `i` = round `i + 1` even on
 * malformed data, and regulation's end caps the walk (OT rounds truncated).
 */
export function deriveRoundHistory(args: {
  roundWins: Readonly<Record<string, string>> | null;
  firstHalfSide: TeamSide | null;
  halftimeAfter: number;
}): readonly RoundOutcome[] {
  const { roundWins, firstHalfSide, halftimeAfter } = args;
  if (roundWins === null || firstHalfSide === null) return [];

  const history: RoundOutcome[] = [];
  for (let round = 1; round <= halftimeAfter * 2; round += 1) {
    const value = roundWins[String(round)];
    if (value === undefined) break;
    const winner = parseWinner(value);
    if (winner === null) break;
    const mySide = round <= halftimeAfter ? firstHalfSide : flip(firstHalfSide);
    history.push(winner === mySide ? 'won' : 'lost');
  }
  return history;
}
