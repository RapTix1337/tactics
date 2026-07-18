import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/button';
import { loadMapList } from '../../lib/ipc/map-catalog';
import { useMapCatalogStore } from '../../stores/map-catalog-store';

/** A settled list fetch failure, tagged with the request it answered —
 * "loading" is derived from the tag mismatch (the MapPage pattern). */
interface ListFailure {
  readonly request: number;
  readonly message: string;
}

interface ResolvedMapContentProps {
  readonly mapId: string;
  readonly interactive: boolean;
  readonly renderMap: (mapId: string) => JSX.Element;
  /**
   * When set, every pre-map state (list loading/failure, out of sync,
   * upload-needed) renders this node instead of its diagnostic UI — the
   * overlay's idle placeholder (live-overlay enhancement, ADR-062). The usable
   * profile still reaches `renderMap`.
   */
  readonly fallback?: JSX.Element;
}

/**
 * The resolved-map states: the summary decides between the injected map
 * experience (default profile) and the MVP-09 upload hint. Keyed by mapId at
 * the call site is unnecessary — the store selector re-renders on a live map
 * change, and the map view keys its fetch on the mapId prop.
 */
export function ResolvedMapContent({
  mapId,
  interactive,
  renderMap,
  fallback,
}: ResolvedMapContentProps): JSX.Element {
  const map = useMapCatalogStore((state) => state.list?.find((entry) => entry.id === mapId));
  const listLoaded = useMapCatalogStore((state) => state.list !== undefined);
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
        fallback ?? (
          <p
            role="alert"
            className="flex h-full items-center justify-center text-sm text-destructive"
          >
            The detected map is not in the loaded map list.
          </p>
        )
      );
    }
    const failure = listFailure?.request === listRequest ? listFailure : undefined;
    if (failure !== undefined) {
      return (
        fallback ?? (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-2">
            <p className="text-sm text-destructive">
              The map list could not be loaded: {failure.message}
            </p>
            {interactive && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setListRequest((request) => request + 1);
                }}
              >
                Try again
              </Button>
            )}
          </div>
        )
      );
    }
    return (
      fallback ?? (
        <p role="status" className="flex h-full items-center justify-center text-muted-foreground">
          Loading maps…
        </p>
      )
    );
  }
  if (map.profiles.length === 0) {
    return (
      fallback ?? (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
          <p className="font-medium">You are playing {map.displayName}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {map.displayName} has no radar image yet, so there is nothing to show in live mode.
            Upload one to see the map with its callouts here.
          </p>
          {interactive && (
            <Button asChild className="mt-2">
              <Link to="/maps/$mapId" params={{ mapId }}>
                Upload image…
              </Link>
            </Button>
          )}
        </div>
      )
    );
  }
  return renderMap(mapId);
}
