import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';

import { PROJECT_REPOSITORY_URL } from '../../../shared/external-urls';
import type { GameStateMap, GsiConnectionStatus } from '../../../shared/game-state';
import { Button } from '../../components/ui/button';
import { STATUS_PRESENTATIONS } from '../../features/gsi-status/GsiStatusBadge';
import { MapView } from '../../features/map-view/MapView';
import { ScoreboardFrame } from '../../features/scoreboard/ScoreboardFrame';
import { ScoreboardToggle } from '../../features/scoreboard/ScoreboardToggle';
import { openExternal } from '../../lib/ipc/external-links';
import { loadMapList } from '../../lib/ipc/map-catalog';
import { useAppStore } from '../../stores/app-store';
import { useGameStateStore } from '../../stores/game-state-store';
import { useMapCatalogStore } from '../../stores/map-catalog-store';
import { useScoreboardStore } from '../../stores/scoreboard-store';
import { useSettingsStore } from '../../stores/settings-store';

/**
 * `/live` (E15.3, 06-ui.md §2): the game-state-driven view, rendered 1:1
 * from `useGameStateStore` (ADR-028 — no auto-navigation machinery). The
 * ADR-045 states: a resolved map renders the browse-mode `map-view`
 * components (default profile); a resolved map without a profile links into
 * the upload flow (MVP-09); an unknown raw name shows the informative
 * contribute state (MVP-09); no game shows the GSI diagnostics (GSI-05).
 * During a supported live match (SCB.9) the header carries the scoreboard
 * toggle, and the resolved map view is wrapped in `ScoreboardFrame` when
 * the scoreboard is enabled.
 * The frame keeps the `ipc-status` E2E selector (E5.4) in every state —
 * renaming or dropping it breaks the suite.
 */
export function LivePage(): JSX.Element {
  const ipcStatus = useAppStore((state) => state.ipcStatus);
  const gameState = useGameStateStore((state) => state.gameState);
  // The toggle shows whenever a supported live match runs (design §5) —
  // including with the scoreboard off, so it can be turned back on here.
  const scoreboardActive = useScoreboardStore((state) => state.scoreboard?.active === true);

  return (
    <div className="flex h-full flex-col gap-2">
      <header className="flex items-center justify-between px-4 pt-4">
        <h1 className="text-2xl font-semibold">Live</h1>
        {scoreboardActive && <ScoreboardToggle />}
      </header>
      <div className="min-h-0 flex-1">
        {gameState === undefined ? (
          <p
            role="status"
            className="flex h-full items-center justify-center text-muted-foreground"
          >
            Waiting for game state…
          </p>
        ) : (
          <LiveContent status={gameState.status} map={gameState.map} />
        )}
      </div>
      <p data-testid="ipc-status" className="px-4 pb-2 text-xs text-muted-foreground">
        IPC: {ipcStatus}
      </p>
    </div>
  );
}

interface LiveContentProps {
  readonly status: GsiConnectionStatus;
  readonly map: GameStateMap;
}

function LiveContent({ status, map }: LiveContentProps): JSX.Element {
  switch (map.kind) {
    case 'resolved':
      return <ResolvedMapContent mapId={map.mapId} />;
    case 'unsupported':
      return <UnsupportedMapState rawName={map.rawName} />;
    case 'none':
      return <NoGameState status={status} />;
  }
}

/** A settled list fetch failure, tagged with the request it answered —
 * "loading" is derived from the tag mismatch (the MapPage pattern). */
interface ListFailure {
  readonly request: number;
  readonly message: string;
}

/**
 * The resolved-map states: the summary decides between the live map view
 * (default profile) and the MVP-09 upload hint. Keyed by mapId at the call
 * site is unnecessary — the store selector re-renders on a live map change,
 * and MapView keys its fetch on the mapId prop.
 */
function ResolvedMapContent({ mapId }: { readonly mapId: string }): JSX.Element {
  const map = useMapCatalogStore((state) => state.list?.find((entry) => entry.id === mapId));
  const listLoaded = useMapCatalogStore((state) => state.list !== undefined);
  const scoreboard = useScoreboardStore((state) => state.scoreboard);
  const settings = useSettingsStore((state) => state.settings);
  // Bumped by "Try again": re-runs the fetch and hides the stale failure.
  const [listRequest, setListRequest] = useState(0);
  const [listFailure, setListFailure] = useState<ListFailure | undefined>(undefined);

  useEffect(() => {
    // Always refresh: the summary may be stale (the MapPage pattern; the
    // repeat call doubles as the retry path).
    let stale = false;
    void loadMapList().then((result) => {
      if (!stale && !result.ok) {
        setListFailure({ request: listRequest, message: result.error.message });
      }
    });
    return (): void => {
      stale = true;
    };
  }, [listRequest]);

  if (map === undefined) {
    if (listLoaded) {
      // A resolved mapId always names a catalog map (main resolved it); a
      // fetched list without it means the renderer's list is out of sync.
      return (
        <p
          role="alert"
          className="flex h-full items-center justify-center text-sm text-destructive"
        >
          The detected map is not in the loaded map list.
        </p>
      );
    }
    const failure = listFailure?.request === listRequest ? listFailure : undefined;
    if (failure !== undefined) {
      return (
        <div role="alert" className="flex h-full flex-col items-center justify-center gap-2">
          <p className="text-sm text-destructive">
            The map list could not be loaded: {failure.message}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setListRequest((request) => request + 1);
            }}
          >
            Try again
          </Button>
        </div>
      );
    }
    return (
      <p role="status" className="flex h-full items-center justify-center text-muted-foreground">
        Loading maps…
      </p>
    );
  }
  if (map.profiles.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="font-medium">You are playing {map.displayName}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {map.displayName} has no radar image yet, so there is nothing to show in live mode. Upload
          one to see the map with its callouts here.
        </p>
        <Button asChild className="mt-2">
          <Link to="/maps/$mapId" params={{ mapId }}>
            Upload image…
          </Link>
        </Button>
      </div>
    );
  }
  // SCB.9 (spec AC 6/7): the frame renders only when the slice is active
  // AND the toggle is on — every other combination (including missing
  // snapshots) is exactly today's plain map view.
  if (scoreboard?.active === true && settings?.scoreboardEnabled === true) {
    return (
      <ScoreboardFrame state={scoreboard} layout={settings.scoreboardLayout}>
        <MapView mapId={mapId} />
      </ScoreboardFrame>
    );
  }
  return <MapView mapId={mapId} />;
}

/**
 * The MVP-09 unknown-map state: the raw GSI name is informative, and map
 * support is data-driven (MAP-02) — the contribute link opens the project
 * repository via the allowlisted `app.openExternal` (ADR-036).
 */
function UnsupportedMapState({ rawName }: { readonly rawName: string }): JSX.Element {
  const [openFailure, setOpenFailure] = useState<string | undefined>(undefined);

  async function handleOpenRepository(): Promise<void> {
    const result = await openExternal(PROJECT_REPOSITORY_URL);
    setOpenFailure(result.ok ? undefined : result.error.message);
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
      <p className="font-medium">Unsupported map</p>
      <p className="max-w-md text-sm text-muted-foreground">
        CS2 reports <span className="font-mono break-all">{rawName}</span>, which is not in the map
        catalog. Maps are data, not code — new ones can be contributed to the project.
      </p>
      <Button
        type="button"
        variant="outline"
        className="mt-2"
        onClick={() => {
          void handleOpenRepository();
        }}
      >
        Open project repository
      </Button>
      {openFailure !== undefined && (
        <p role="alert" className="text-sm text-destructive">
          {openFailure}
        </p>
      )}
    </div>
  );
}

/**
 * The GSI-05 no-game state: what the badge says, spelled out on the page.
 * `connected` with no map is the in-menus case — its badge diagnostic
 * ("Receiving data") would read like a contradiction here, so it gets a
 * specific line instead.
 */
function NoGameState({ status }: { readonly status: GsiConnectionStatus }): JSX.Element {
  const presentation = STATUS_PRESENTATIONS[status];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
      <p className="font-medium">No game detected</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {status === 'connected'
          ? 'CS2 is connected but no map is active — join a match and it appears here.'
          : `${presentation.label} — ${presentation.diagnostic}`}
      </p>
    </div>
  );
}
