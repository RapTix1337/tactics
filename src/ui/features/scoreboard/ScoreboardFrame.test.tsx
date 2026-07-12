import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SAMPLE_SCOREBOARD_LAYOUT, SAMPLE_SCOREBOARD_STATE } from './sample-state';
import { ScoreboardFrame } from './ScoreboardFrame';

function renderFrame(): void {
  render(
    <ScoreboardFrame state={SAMPLE_SCOREBOARD_STATE} layout={SAMPLE_SCOREBOARD_LAYOUT}>
      <div data-testid="map-slot">the map</div>
    </ScoreboardFrame>,
  );
}

describe('ScoreboardFrame', () => {
  it('renders the score header, both side cards, and the children (spec AC 2/4/5)', () => {
    renderFrame();

    expect(screen.getByRole('region', { name: 'Match score' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'My performance' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Enemy team' })).toBeInTheDocument();
    expect(screen.getByTestId('map-slot')).toHaveTextContent('the map');
  });

  it('orders header above and cards beside the map: mine left, enemy right (design §5)', () => {
    renderFrame();
    const header = screen.getByRole('region', { name: 'Match score' });
    const myCard = screen.getByRole('region', { name: 'My performance' });
    const map = screen.getByTestId('map-slot');
    const enemyCard = screen.getByRole('region', { name: 'Enemy team' });

    const precedes = (a: Element, b: Element): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(precedes(header, myCard)).toBe(true);
    expect(precedes(myCard, map)).toBe(true);
    expect(precedes(map, enemyCard)).toBe(true);
  });

  it('forwards the configured layout groups to the performance card (spec AC 4)', () => {
    renderFrame();

    for (const group of SAMPLE_SCOREBOARD_LAYOUT.groups) {
      expect(screen.getByRole('group', { name: group.label })).toBeInTheDocument();
    }
  });

  it('keeps the map slot in a sized flex cell so MapView keeps its own fit (spec AC 8)', () => {
    renderFrame();
    const cell = screen.getByTestId('map-slot').parentElement;

    expect(cell).toHaveClass('flex-1', 'min-w-0', 'min-h-0');
  });
});
