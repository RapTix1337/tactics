import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ScoreboardLayout } from '../../../shared/settings';
import { MyPerformanceCard } from './MyPerformanceCard';
import { SAMPLE_SCOREBOARD_LAYOUT, SAMPLE_SCOREBOARD_STATE } from './sample-state';
import type { ActiveScoreboardState } from './stat-fields';

function makeState(overrides?: {
  me?: Partial<ActiveScoreboardState['me']>;
  derived?: Partial<ActiveScoreboardState['derived']>;
  myTeam?: Partial<ActiveScoreboardState['myTeam']>;
}): ActiveScoreboardState {
  return {
    ...SAMPLE_SCOREBOARD_STATE,
    myTeam: { ...SAMPLE_SCOREBOARD_STATE.myTeam, ...overrides?.myTeam },
    me: { ...SAMPLE_SCOREBOARD_STATE.me, ...overrides?.me },
    derived: { ...SAMPLE_SCOREBOARD_STATE.derived, ...overrides?.derived },
  };
}

function renderCard(layout: ScoreboardLayout = SAMPLE_SCOREBOARD_LAYOUT): HTMLElement {
  render(<MyPerformanceCard layout={layout} state={makeState()} />);
  return screen.getByRole('region', { name: 'My performance' });
}

describe('MyPerformanceCard', () => {
  it('renders the layout groups in configured order (AC 4)', () => {
    const card = renderCard();

    const groups = within(card).getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Match totals',
      'Derived',
      'Live round state',
    ]);
  });

  it('renders exactly the configured fields per group, in order (AC 4)', () => {
    const card = renderCard({
      groups: [{ label: 'Custom', fields: ['money', 'kills', 'kd'] }],
    });

    const group = within(card).getByRole('group', { name: 'Custom' });
    const labels = within(group)
      .getAllByRole('term')
      .map((term) => term.textContent);
    expect(labels).toEqual(['Money', 'Kills', 'K/D']);
    expect(within(group).getByText('$3,200')).toBeInTheDocument();
    expect(within(group).getByText('19')).toBeInTheDocument();
    expect(within(group).getByText('1.58')).toBeInTheDocument();
  });

  it('skips groups whose fields were all normalized away', () => {
    const card = renderCard({
      groups: [
        { label: 'Empty', fields: [] },
        { label: 'Kept', fields: ['kills'] },
      ],
    });

    expect(within(card).queryByRole('group', { name: 'Empty' })).not.toBeInTheDocument();
    expect(within(card).getByRole('group', { name: 'Kept' })).toBeInTheDocument();
  });

  it('shows my side tag in the card header', () => {
    render(
      <MyPerformanceCard
        layout={SAMPLE_SCOREBOARD_LAYOUT}
        state={makeState({ myTeam: { side: 'T' } })}
      />,
    );

    const card = screen.getByRole('region', { name: 'My performance' });
    expect(within(card).getByText('T')).toBeInTheDocument();
  });

  it('marks approximate groups with the ~ chip and the tile value with a tilde (AC 10)', () => {
    render(
      <MyPerformanceCard
        layout={SAMPLE_SCOREBOARD_LAYOUT}
        state={makeState({ derived: { approximate: true, hsRatePercent: 58 } })}
      />,
    );

    const derivedGroup = screen.getByRole('group', { name: 'Derived' });
    expect(within(derivedGroup).getByText('~ approx')).toBeInTheDocument();
    expect(derivedGroup).toHaveTextContent('~58%');
    expect(
      within(screen.getByRole('group', { name: 'Match totals' })).queryByText('~ approx'),
    ).not.toBeInTheDocument();
  });

  it('shows no approximate marker while accumulation covers the whole match', () => {
    render(
      <MyPerformanceCard
        layout={SAMPLE_SCOREBOARD_LAYOUT}
        state={makeState({ derived: { approximate: false } })}
      />,
    );

    expect(screen.queryByText('~ approx')).not.toBeInTheDocument();
  });

  it('renders the health bar at the health percentage', () => {
    render(
      <MyPerformanceCard
        layout={SAMPLE_SCOREBOARD_LAYOUT}
        state={makeState({ me: { health: 37 } })}
      />,
    );

    const group = screen.getByRole('group', { name: 'Live round state' });
    const bar = group.querySelector('[data-slot="health-bar-fill"]');
    expect(bar).not.toBeNull();
    expect(bar).toHaveStyle({ width: '37%' });
  });

  it('shows the helmet icon on the armor tile only while a helmet is worn', () => {
    const { rerender } = render(
      <MyPerformanceCard
        layout={SAMPLE_SCOREBOARD_LAYOUT}
        state={makeState({ me: { helmet: true } })}
      />,
    );
    expect(screen.getByRole('img', { name: 'Helmet' })).toBeInTheDocument();

    rerender(
      <MyPerformanceCard
        layout={SAMPLE_SCOREBOARD_LAYOUT}
        state={makeState({ me: { helmet: false } })}
      />,
    );
    expect(screen.queryByRole('img', { name: 'Helmet' })).not.toBeInTheDocument();
  });

  it('associates every tile label with its value for screen readers (a11y)', () => {
    const card = renderCard({ groups: [{ label: 'Pair', fields: ['kills', 'deaths'] }] });

    const group = within(card).getByRole('group', { name: 'Pair' });
    expect(
      within(group)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Kills', 'Deaths']);
    expect(within(group).getAllByRole('definition')).toHaveLength(2);
  });
});
