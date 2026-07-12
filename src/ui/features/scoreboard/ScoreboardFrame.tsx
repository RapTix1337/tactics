import type { JSX, ReactNode } from 'react';

import type { ScoreboardLayout } from '../../../shared/settings';
import { EnemyTeamCard } from './EnemyTeamCard';
import { MyPerformanceCard } from './MyPerformanceCard';
import { ScoreHeader } from './ScoreHeader';
import type { ActiveScoreboardState } from './stat-fields';

/**
 * The scoreboard frame around the live map (SCB.9, design §5): score header
 * above, my card left, enemy card right, `children` (the map view) in the
 * remaining space. Fixed-basis shrinkable card columns keep the frame usable
 * at the minimum window size (UI-05); the map cell is a sized flex child, so
 * `MapView` keeps its own fit/zoom/pan untouched (spec AC 8). The card
 * columns scroll vertically on short windows — the map never loses height.
 */
export function ScoreboardFrame({
  state,
  layout,
  children,
}: {
  readonly state: ActiveScoreboardState;
  readonly layout: ScoreboardLayout;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col gap-2 px-4 pb-1">
      <ScoreHeader state={state} />
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-w-44 shrink basis-60 overflow-y-auto">
          <MyPerformanceCard layout={layout} state={state} />
        </div>
        <div className="min-h-0 min-w-0 flex-1">{children}</div>
        <div className="min-w-44 shrink basis-60 overflow-y-auto">
          <EnemyTeamCard state={state} />
        </div>
      </div>
    </div>
  );
}
