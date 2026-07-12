import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ScoreboardPhase } from '../../../shared/scoreboard-state';
import { SAMPLE_SCOREBOARD_STATE } from './sample-state';
import { ScoreHeader } from './ScoreHeader';
import type { ActiveScoreboardState } from './stat-fields';

function makeState(overrides?: Partial<ActiveScoreboardState>): ActiveScoreboardState {
  return { ...SAMPLE_SCOREBOARD_STATE, ...overrides };
}

function myTeamGroup(): HTMLElement {
  return screen.getByRole('group', { name: 'Your Team' });
}

function enemyTeamGroup(): HTMLElement {
  return screen.getByRole('group', { name: 'Enemy' });
}

describe('ScoreHeader', () => {
  it('renders my team on the left and the enemy on the right (AC 3)', () => {
    render(<ScoreHeader state={makeState()} />);

    const mine = myTeamGroup();
    const enemy = enemyTeamGroup();
    expect(mine.compareDocumentPosition(enemy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(mine).getByText('CT')).toBeInTheDocument();
    expect(within(enemy).getByText('T')).toBeInTheDocument();
  });

  it('swaps the side tags after halftime but keeps my team left', () => {
    render(
      <ScoreHeader
        state={makeState({
          myTeam: { side: 'T', score: 9, lossStreak: 1, timeoutsRemaining: 1 },
          enemyTeam: { side: 'CT', score: 8, lossStreak: 0, timeoutsRemaining: 1 },
        })}
      />,
    );

    const mine = myTeamGroup();
    const enemy = enemyTeamGroup();
    expect(mine.compareDocumentPosition(enemy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(mine).getByText('T')).toBeInTheDocument();
    expect(within(enemy).getByText('CT')).toBeInTheDocument();
  });

  it('shows both scores and degrades a missing score to the placeholder', () => {
    render(
      <ScoreHeader
        state={makeState({
          myTeam: { side: 'CT', score: 8, lossStreak: 0, timeoutsRemaining: 1 },
          enemyTeam: { side: 'T', score: null, lossStreak: null, timeoutsRemaining: null },
        })}
      />,
    );

    expect(within(myTeamGroup()).getByText('8')).toBeInTheDocument();
    expect(within(enemyTeamGroup()).getByText('—')).toBeInTheDocument();
  });

  it('labels the loss-streak and timeout pips per team (a11y, AC 2)', () => {
    render(<ScoreHeader state={makeState()} />);

    expect(within(myTeamGroup()).getByRole('img', { name: 'Loss streak: 0' })).toBeInTheDocument();
    expect(
      within(enemyTeamGroup()).getByRole('img', { name: 'Loss streak: 2' }),
    ).toBeInTheDocument();
    expect(
      within(myTeamGroup()).getByRole('img', { name: 'Timeouts remaining: 1' }),
    ).toBeInTheDocument();
  });

  it('fills the loss pips in each team side color (2026-07-12 report)', () => {
    render(
      <ScoreHeader
        state={makeState({
          myTeam: { side: 'CT', score: 8, lossStreak: 2, timeoutsRemaining: 1 },
          enemyTeam: { side: 'T', score: 8, lossStreak: 3, timeoutsRemaining: 1 },
        })}
      />,
    );

    const minePips = within(myTeamGroup()).getByRole('img', { name: 'Loss streak: 2' });
    expect(minePips.querySelectorAll('.bg-side-ct')).toHaveLength(2);
    const enemyPips = within(enemyTeamGroup()).getByRole('img', { name: 'Loss streak: 3' });
    expect(enemyPips.querySelectorAll('.bg-side-t')).toHaveLength(3);
  });

  it('renders timeout pips remaining-only — one pip per remaining timeout', () => {
    render(
      <ScoreHeader
        state={makeState({
          myTeam: { side: 'CT', score: 8, lossStreak: 0, timeoutsRemaining: 3 },
        })}
      />,
    );

    const pips = within(myTeamGroup()).getByRole('img', { name: 'Timeouts remaining: 3' });
    expect(pips.querySelectorAll('[data-slot="pip"]')).toHaveLength(3);
  });

  it('omits the indicators GSI did not fill', () => {
    render(
      <ScoreHeader
        state={makeState({
          enemyTeam: { side: 'T', score: 8, lossStreak: null, timeoutsRemaining: null },
        })}
      />,
    );

    expect(within(enemyTeamGroup()).queryByRole('img')).not.toBeInTheDocument();
  });

  it.each<readonly [ScoreboardPhase, string]>([
    ['warmup', 'Warmup'],
    ['freezetime', 'Freezetime'],
    ['live', 'Live'],
    ['bomb-planted', 'Bomb planted'],
    ['round-over', 'Round over'],
  ])('shows the %s phase as "%s" next to the round number (AC 2)', (phase, label) => {
    render(<ScoreHeader state={makeState({ phase, roundNumber: 17 })} />);

    const badge = screen.getByRole('status', { name: 'Match phase' });
    expect(badge).toHaveTextContent('Round 17');
    expect(badge).toHaveTextContent(label);
  });

  it('renders the round history from my perspective with a halftime divider after 12 (comp)', () => {
    render(<ScoreHeader state={makeState()} />);

    const history = screen.getByRole('list', { name: 'Round history' });
    expect(within(history).getAllByRole('listitem')).toHaveLength(16);
    expect(within(history).getByRole('listitem', { name: 'Round 1: lost' })).toBeInTheDocument();
    expect(within(history).getByRole('listitem', { name: 'Round 16: lost' })).toBeInTheDocument();
    const divider = within(history).getByRole('separator', { name: 'Halftime' });
    // The divider sits between round 12 and round 13.
    expect(Array.from(history.children).indexOf(divider)).toBe(12);
  });

  it('places the wingman halftime divider after 8 rounds (AC 14)', () => {
    render(
      <ScoreHeader
        state={makeState({
          halftimeAfter: 8,
          roundHistory: ['won', 'won', 'lost', 'won', 'lost', 'won', 'won', 'lost', 'won', 'won'],
        })}
      />,
    );

    const history = screen.getByRole('list', { name: 'Round history' });
    expect(within(history).getAllByRole('listitem')).toHaveLength(10);
    expect(
      Array.from(history.children).indexOf(
        within(history).getByRole('separator', { name: 'Halftime' }),
      ),
    ).toBe(8);
  });

  it('shows no divider while the first half is still running', () => {
    render(<ScoreHeader state={makeState({ roundHistory: ['won', 'lost', 'won'] })} />);

    const history = screen.getByRole('list', { name: 'Round history' });
    expect(within(history).getAllByRole('listitem')).toHaveLength(3);
    expect(within(history).queryByRole('separator')).not.toBeInTheDocument();
  });
});
