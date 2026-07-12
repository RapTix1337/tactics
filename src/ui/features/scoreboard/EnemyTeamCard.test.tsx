import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ScoreboardTeamState } from '../../../shared/scoreboard-state';
import { EnemyTeamCard } from './EnemyTeamCard';
import { SAMPLE_SCOREBOARD_STATE } from './sample-state';
import type { ActiveScoreboardState } from './stat-fields';

function makeState(enemyTeam?: Partial<ScoreboardTeamState>): ActiveScoreboardState {
  return {
    ...SAMPLE_SCOREBOARD_STATE,
    enemyTeam: { ...SAMPLE_SCOREBOARD_STATE.enemyTeam, ...enemyTeam },
  };
}

function renderCard(enemyTeam?: Partial<ScoreboardTeamState>): HTMLElement {
  render(<EnemyTeamCard state={makeState(enemyTeam)} />);
  return screen.getByRole('region', { name: 'Enemy team' });
}

describe('EnemyTeamCard', () => {
  it('shows the enemy side tag and score in the header (AC 5)', () => {
    const card = renderCard();

    // <header> inside <section> carries no banner role — scope structurally.
    const header = card.querySelector('header');
    expect(header).not.toBeNull();
    // The non-null assertion above is the test's own guard.
    expect(within(header!).getByText('T')).toBeInTheDocument();
    expect(within(header!).getByText('8')).toBeInTheDocument();
  });

  it('renders the loss streak with labeled pips and value', () => {
    const card = renderCard({ lossStreak: 2 });

    expect(within(card).getByText('Consecutive losses')).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: 'Loss streak: 2' })).toBeInTheDocument();
    expect(within(card).getByRole('definition', { name: 'Consecutive losses' })).toHaveTextContent(
      '2',
    );
  });

  it.each([
    ['T', 'bg-side-t'],
    ['CT', 'bg-side-ct'],
  ] as const)(
    'fills the loss pips in the enemy side color (%s, 2026-07-12 report)',
    (side, pipClass) => {
      const card = renderCard({ side, lossStreak: 2 });

      const pips = within(card).getByRole('img', { name: 'Loss streak: 2' });
      expect(pips.querySelectorAll(`.${pipClass}`)).toHaveLength(2);
    },
  );

  it.each([
    [0, '$1,400'],
    [2, '$2,400'],
    [5, '$3,400'],
  ] as const)(
    'derives the estimated loss bonus from the fixed tier table (%i losses → %s)',
    (lossStreak, bonus) => {
      const card = renderCard({ lossStreak });

      expect(within(card).getByRole('definition', { name: 'Est. loss bonus' })).toHaveTextContent(
        bonus,
      );
    },
  );

  it('shows the rounds won equal to the enemy score', () => {
    const card = renderCard({ score: 11 });

    expect(within(card).getByRole('definition', { name: 'Rounds won' })).toHaveTextContent('11');
  });

  it('renders remaining-only timeout pips with the value', () => {
    const card = renderCard({ timeoutsRemaining: 3 });

    const pips = within(card).getByRole('img', { name: 'Timeouts remaining: 3' });
    expect(pips.querySelectorAll('[data-slot="pip"]')).toHaveLength(3);
    expect(within(card).getByRole('definition', { name: 'Timeouts remaining' })).toHaveTextContent(
      '3',
    );
  });

  it('degrades missing team values to placeholders without pips', () => {
    const card = renderCard({ score: null, lossStreak: null, timeoutsRemaining: null });

    expect(within(card).queryByRole('img')).not.toBeInTheDocument();
    expect(within(card).getByRole('definition', { name: 'Consecutive losses' })).toHaveTextContent(
      '—',
    );
    expect(within(card).getByRole('definition', { name: 'Est. loss bonus' })).toHaveTextContent(
      '—',
    );
    expect(within(card).getByRole('definition', { name: 'Rounds won' })).toHaveTextContent('—');
    expect(within(card).getByRole('definition', { name: 'Timeouts remaining' })).toHaveTextContent(
      '—',
    );
  });

  it('explains the data boundary — no enemy per-player data in GSI', () => {
    const card = renderCard();

    expect(card).toHaveTextContent(
      'GSI exposes no per-player data for the enemy — only team-level state is shown.',
    );
  });
});
