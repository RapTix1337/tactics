import type { JSX } from 'react';
import { useLayoutEffect } from 'react';

import { useScoreboardStore } from '../../stores/scoreboard-store';
import { useSettingsStore } from '../../stores/settings-store';
import { MapView } from '../map-view/MapView';
import { EnemyTeamCard } from '../scoreboard/EnemyTeamCard';
import { MyPerformanceCard } from '../scoreboard/MyPerformanceCard';
import { ScoreHeader } from '../scoreboard/ScoreHeader';

interface OverlayFrameProps {
  readonly mapId: string;
  /**
   * The slot-fade hand-over (maintainer decision, OVL.7): while the frame is
   * mounted it owns the fading per region, so `OverlayRoot` must lift the
   * base fade off the content slot — CSS child opacity can never exceed its
   * parent's, and a faded slot would cap the exempted regions.
   */
  readonly onActiveChange: (active: boolean) => void;
}

/**
 * The overlay window's map arrangement (live-overlay 02-design.md §5.3),
 * gated exactly like the live page's `FramedMapView` (SCB.9): score header
 * top, my card left, map center, enemy card right — only while the slice is
 * active AND the scoreboard setting is on; every other combination is the
 * plain map filling the row. Unlike the main window's `ScoreboardFrame`,
 * every region is a sibling carrying its own fade variable — per-region
 * fade is overlay-specific presentation (ADR-057, spec AC 5).
 */
export function OverlayFrame({ mapId, onActiveChange }: OverlayFrameProps): JSX.Element {
  const scoreboard = useScoreboardStore((state) => state.scoreboard);
  const settings = useSettingsStore((state) => state.settings);

  // Layout effect: the slot fade must flip in the same commit the frame
  // appears/disappears in, or one frame paints with the wrong opacity.
  useLayoutEffect(() => {
    onActiveChange(true);
    return (): void => {
      onActiveChange(false);
    };
  }, [onActiveChange]);

  // The window surface is transparent (02-design.md §5.1), so background-free
  // regions (score header, map cell) get their opaque panel here — the cards
  // bring their own `bg-card`. Fading a region fades its panel with it.
  if (scoreboard?.active !== true || settings?.scoreboardEnabled !== true) {
    return (
      <div
        data-testid="overlay-map-cell"
        className="h-full rounded-md border bg-background"
        style={MAP_FADE}
      >
        <MapView mapId={mapId} />
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col gap-2">
      <div
        data-testid="overlay-score-header"
        className="rounded-md border bg-background px-3"
        style={SCOREBOARD_FADE}
      >
        <ScoreHeader state={scoreboard} />
      </div>
      <div className="flex min-h-0 flex-1 gap-3">
        <div
          data-testid="overlay-my-card"
          className="min-w-44 shrink basis-60 overflow-y-auto"
          style={SCOREBOARD_FADE}
        >
          <MyPerformanceCard layout={settings.scoreboardLayout} state={scoreboard} />
        </div>
        <div
          data-testid="overlay-map-cell"
          className="min-h-0 min-w-0 flex-1 rounded-md border bg-background"
          style={MAP_FADE}
        >
          <MapView mapId={mapId} />
        </div>
        <div
          data-testid="overlay-enemy-card"
          className="min-w-44 shrink basis-60 overflow-y-auto"
          style={SCOREBOARD_FADE}
        >
          <EnemyTeamCard state={scoreboard} />
        </div>
      </div>
    </div>
  );
}

const MAP_FADE = { opacity: 'var(--fade-map)' } as const;
const SCOREBOARD_FADE = { opacity: 'var(--fade-scoreboard)' } as const;
