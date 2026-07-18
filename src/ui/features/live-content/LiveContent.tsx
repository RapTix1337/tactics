import type { JSX } from 'react';

import type { GameStateMap, GsiConnectionStatus } from '../../../shared/game-state';
import { NoGameState } from './NoGameState';
import { ResolvedMapContent } from './ResolvedMapContent';
import { UnsupportedMapState } from './UnsupportedMapState';

/**
 * The live-view state machine shared by the main window and the overlay
 * (live-overlay 02-design.md §5.2): a resolved map runs the catalog-driven
 * states (loading/failure/out-of-sync/upload-needed) and hands a usable map
 * to `renderMap`; an unknown raw name shows the informative contribute state
 * (MVP-09); no game shows the GSI diagnostics (GSI-05). Both windows render
 * these states from the same stores (spec AC 9/10).
 */
export interface LiveContentProps {
  readonly status: GsiConnectionStatus;
  readonly map: GameStateMap;
  /**
   * The interactive variant renders the action controls (upload link,
   * repository button, retry); the non-interactive overlay variant renders
   * informational text only — the overlay is pure display, and router-bound
   * links cannot exist in the router-less overlay window.
   */
  readonly interactive: boolean;
  /**
   * Renders the map experience once the catalog confirms a usable profile —
   * each window owns its own arrangement (scoreboard frame vs. overlay frame).
   */
  readonly renderMap: (mapId: string) => JSX.Element;
  /**
   * When set, every non-map state (no game, unsupported, catalog
   * loading/error, upload-needed) renders this node instead of its diagnostic
   * UI — the overlay's clean idle placeholder (live-overlay enhancement,
   * ADR-062). Omitted on the main live page, which keeps its diagnostics.
   */
  readonly fallback?: JSX.Element;
}

export function LiveContent({
  status,
  map,
  interactive,
  renderMap,
  fallback,
}: LiveContentProps): JSX.Element {
  switch (map.kind) {
    case 'resolved':
      return (
        <ResolvedMapContent
          mapId={map.mapId}
          interactive={interactive}
          renderMap={renderMap}
          fallback={fallback}
        />
      );
    case 'unsupported':
      return fallback ?? <UnsupportedMapState rawName={map.rawName} interactive={interactive} />;
    case 'none':
      return fallback ?? <NoGameState status={status} />;
  }
}
