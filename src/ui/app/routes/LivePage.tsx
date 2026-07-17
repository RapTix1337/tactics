import type { JSX } from 'react';

import { LiveContent } from '../../features/live-content/LiveContent';
import { MapView } from '../../features/map-view/MapView';
import { OverlayPlaceholder } from '../../features/overlay-controls/OverlayPlaceholder';
import { OverlayToggle } from '../../features/overlay-controls/OverlayToggle';
import { ScoreboardFrame } from '../../features/scoreboard/ScoreboardFrame';
import { ScoreboardToggle } from '../../features/scoreboard/ScoreboardToggle';
import { useAppStore } from '../../stores/app-store';
import { useGameStateStore } from '../../stores/game-state-store';
import { useOverlayStore } from '../../stores/overlay-store';
import { useScoreboardStore } from '../../stores/scoreboard-store';
import { useSettingsStore } from '../../stores/settings-store';

/**
 * `/live` (E15.3, 06-ui.md §2): the game-state-driven view, rendered 1:1
 * from `useGameStateStore` (ADR-028 — no auto-navigation machinery). The
 * ADR-045 states live in the shared `live-content` feature (OVL.6,
 * live-overlay design §5.2), rendered here in the interactive variant;
 * the resolved map view is this window's arrangement (`FramedMapView`).
 * During a supported live match (SCB.9) the header carries the scoreboard
 * toggle; the overlay toggle is always available (OVL.9, design §5.4).
 * While the overlay is open the content area — including the waiting
 * state — yields to the placeholder: the live content renders only in the
 * overlay (spec AC 1/7).
 * The frame keeps the `ipc-status` E2E selector (E5.4) in every state —
 * renaming or dropping it breaks the suite.
 */
export function LivePage(): JSX.Element {
  const ipcStatus = useAppStore((state) => state.ipcStatus);
  const gameState = useGameStateStore((state) => state.gameState);
  const overlayOpen = useOverlayStore((state) => state.overlay?.open === true);
  // The toggle shows whenever a supported live match runs (design §5) —
  // including with the scoreboard off, so it can be turned back on here.
  const scoreboardActive = useScoreboardStore((state) => state.scoreboard?.active === true);

  return (
    <div className="flex h-full flex-col gap-2">
      <header className="flex items-center justify-between px-4 pt-4">
        <h1 className="text-2xl font-semibold">Live</h1>
        <div className="flex items-center gap-2">
          {scoreboardActive && <ScoreboardToggle />}
          <OverlayToggle />
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {overlayOpen ? (
          <OverlayPlaceholder />
        ) : gameState === undefined ? (
          <p
            role="status"
            className="flex h-full items-center justify-center text-muted-foreground"
          >
            Waiting for game state…
          </p>
        ) : (
          <LiveContent
            status={gameState.status}
            map={gameState.map}
            interactive
            renderMap={(mapId) => <FramedMapView mapId={mapId} />}
          />
        )}
      </div>
      <p data-testid="ipc-status" className="px-4 pb-2 text-xs text-muted-foreground">
        IPC: {ipcStatus}
      </p>
    </div>
  );
}

/**
 * SCB.9 (spec AC 6/7): the frame renders only when the slice is active
 * AND the toggle is on — every other combination (including missing
 * snapshots) is exactly the plain map view. The arrangement is
 * window-specific presentation (the overlay owns its own frame), so it
 * stays here rather than in the shared `live-content` machine.
 */
function FramedMapView({ mapId }: { readonly mapId: string }): JSX.Element {
  const scoreboard = useScoreboardStore((state) => state.scoreboard);
  const settings = useSettingsStore((state) => state.settings);
  if (scoreboard?.active === true && settings?.scoreboardEnabled === true) {
    return (
      <ScoreboardFrame state={scoreboard} layout={settings.scoreboardLayout}>
        <MapView mapId={mapId} />
      </ScoreboardFrame>
    );
  }
  return <MapView mapId={mapId} />;
}
