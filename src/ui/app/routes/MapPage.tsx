import type { JSX } from 'react';
import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/button';
import { MapEmptyState } from '../../features/map-manage/MapEmptyState';
import { MapProfileManager } from '../../features/map-manage/MapProfileManager';
import { MapView } from '../../features/map-view/MapView';
import { loadMapList } from '../../lib/ipc/map-catalog';
import { useMapCatalogStore } from '../../stores/map-catalog-store';

interface MapPageProps {
  readonly mapId: string;
}

/** A settled list fetch failure, tagged with the request it answered —
 * "loading" is derived from the tag mismatch (the MapsOverview pattern). */
interface ListFailure {
  readonly request: number;
  readonly message: string;
}

/**
 * `/maps/$mapId` (06-ui.md §2): browse mode for a manually chosen map with
 * the E22.5 profile surface (MVP-12) around the map view (E14.1). The route
 * param arrives as a prop so the page stays a plain component.
 */
export function MapPage({ mapId }: MapPageProps): JSX.Element {
  // Keyed by mapId: switching maps resets profile selection and view epoch.
  return <MapPageContent key={mapId} mapId={mapId} />;
}

function MapPageContent({ mapId }: MapPageProps): JSX.Element {
  const map = useMapCatalogStore((state) => state.list?.find((entry) => entry.id === mapId));
  const listLoaded = useMapCatalogStore((state) => state.list !== undefined);
  // Bumped by "Try again": re-runs the fetch and hides the stale failure.
  const [listRequest, setListRequest] = useState(0);
  const [listFailure, setListFailure] = useState<ListFailure | undefined>(undefined);
  // The user's explicit switcher choice; undefined follows the map default.
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(undefined);
  // Bumped after an image replace: a same-extension replace keeps the URL,
  // so only a remount makes the <img> refetch (the protocol answers with
  // `Cache-Control: no-store`, E22.3 — the E14.1 known limitation).
  const [viewEpoch, setViewEpoch] = useState(0);

  useEffect(() => {
    // Always refresh: the summary may be stale (the list is cheap, and the
    // repeat call doubles as the retry path — the MapsOverview pattern).
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
    return (
      <MapPageFrame title={mapId}>
        <MapListState
          listLoaded={listLoaded}
          failure={listFailure?.request === listRequest ? listFailure : undefined}
          onRetry={() => {
            setListRequest((request) => request + 1);
          }}
        />
      </MapPageFrame>
    );
  }
  if (map.profiles.length === 0) {
    return (
      <MapPageFrame title={map.displayName}>
        <MapEmptyState map={map} onProfileCreated={setSelectedProfileId} />
      </MapPageFrame>
    );
  }
  // Self-healing: a selection pointing at a deleted profile falls back to
  // the resolved default from the summary (present whenever profiles exist).
  const displayedProfileId =
    selectedProfileId !== undefined &&
    map.profiles.some((profile) => profile.id === selectedProfileId)
      ? selectedProfileId
      : map.defaultProfileId;
  if (displayedProfileId === undefined) {
    // Contract-unreachable (profiles exist ⇒ a default resolves); the guard
    // only keeps the narrowing honest.
    return <MapPageFrame title={map.displayName} />;
  }
  return (
    <MapPageFrame
      title={map.displayName}
      toolbar={
        <MapProfileManager
          map={map}
          displayedProfileId={displayedProfileId}
          onSelectProfile={setSelectedProfileId}
          onProfileCreated={setSelectedProfileId}
          onImageReplaced={() => {
            setViewEpoch((epoch) => epoch + 1);
          }}
        />
      }
    >
      {/* Browse mode offers the callout editor (E22.6, 06-ui.md §2). */}
      <MapView key={viewEpoch} mapId={mapId} profileId={displayedProfileId} editable />
    </MapPageFrame>
  );
}

interface MapPageFrameProps {
  readonly title: string;
  readonly toolbar?: JSX.Element;
  readonly children?: JSX.Element;
}

/** The shared page scaffold: title, optional profile toolbar, content area. */
function MapPageFrame({ title, toolbar, children }: MapPageFrameProps): JSX.Element {
  return (
    <div className="flex h-full flex-col gap-2">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-4">
        <h1 className="text-2xl font-semibold" data-testid="map-page-title">
          {title}
        </h1>
        {toolbar}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

interface MapListStateProps {
  readonly listLoaded: boolean;
  readonly failure: ListFailure | undefined;
  readonly onRetry: () => void;
}

/** The pre-summary states: list loading, list failure, unknown map id. */
function MapListState({ listLoaded, failure, onRetry }: MapListStateProps): JSX.Element {
  if (listLoaded) {
    return (
      <p role="alert" className="flex h-full items-center justify-center text-sm text-destructive">
        This map is not in the catalog.
      </p>
    );
  }
  if (failure !== undefined) {
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">
          The map list could not be loaded: {failure.message}
        </p>
        <Button type="button" variant="outline" onClick={onRetry}>
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
