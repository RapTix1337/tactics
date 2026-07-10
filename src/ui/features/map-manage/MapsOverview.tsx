import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';

import { RADAR_IMAGE_HELP_URL } from '../../../shared/external-urls';
import type { MapSummary } from '../../../shared/map-catalog';
import { Button } from '../../components/ui/button';
import { openExternal } from '../../lib/ipc/external-links';
import { createProfile, loadMapList } from '../../lib/ipc/map-catalog';
import { useMapCatalogStore } from '../../stores/map-catalog-store';

/**
 * The first profile created from the overview's one-click upload gets a
 * fixed name (maintainer decision, E22.4) — naming and renaming arrive with
 * the E22.5 profile management surface.
 */
const DEFAULT_PROFILE_NAME = 'Default';

/** A settled list fetch failure, tagged with the request it answered —
 * "loading" is derived from the tag mismatch (the GsiSetupDialog pattern). */
interface ListFailure {
  readonly request: number;
  readonly message: string;
}

/** The one upload in flight or its failure — the native dialog in main is
 * modal, so a single slot is enough and blocks concurrent uploads. */
type UploadState =
  | { readonly mapId: string; readonly phase: 'pending' }
  | { readonly mapId: string; readonly phase: 'failed'; readonly message: string };

/**
 * The maps overview (E22.4, 06-ui.md §2, MVP-11): every catalog map with its
 * upload state, derived from the summary — empty `profiles` means no image
 * (E22.3 contract). The upload affordance runs the `maps.createProfile`
 * upload flow (native dialog in main, ADR-045); successes arrive back
 * through the catalog store, so the card flips state from the command
 * response (ADR-033). While no map has an image, the overview doubles as
 * first-run onboarding with the "where do I get a radar image" help block
 * (external link via `app.openExternal`, E15.3).
 */
export function MapsOverview(): JSX.Element {
  const maps = useMapCatalogStore((state) => state.list);
  // Bumped by "Try again": re-runs the fetch and hides the stale failure.
  const [listRequest, setListRequest] = useState(0);
  const [listFailure, setListFailure] = useState<ListFailure | undefined>(undefined);
  const [upload, setUpload] = useState<UploadState | undefined>(undefined);

  useEffect(() => {
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

  async function handleUpload(map: MapSummary): Promise<void> {
    setUpload({ mapId: map.id, phase: 'pending' });
    const result = await createProfile(map.id, DEFAULT_PROFILE_NAME, { kind: 'upload' });
    if (!result.ok) {
      setUpload({ mapId: map.id, phase: 'failed', message: result.error.message });
      return;
    }
    // `created` already refreshed the catalog store; `canceled` is a no-op.
    setUpload(undefined);
  }

  if (maps === undefined) {
    const failure = listFailure?.request === listRequest ? listFailure : undefined;
    if (failure !== undefined) {
      return (
        <div role="alert" className="flex flex-col items-start gap-2">
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
      <p role="status" className="text-sm text-muted-foreground">
        Loading maps…
      </p>
    );
  }

  const isFirstRun = maps.every((map) => map.profiles.length === 0);
  return (
    <div className="flex flex-col gap-4">
      {isFirstRun && <GetStartedHelp />}
      <ul className="grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {maps.map((map) => (
          <MapCard
            key={map.id}
            map={map}
            uploadDisabled={upload?.phase === 'pending'}
            uploadError={
              upload?.phase === 'failed' && upload.mapId === map.id ? upload.message : undefined
            }
            onUpload={() => {
              void handleUpload(map);
            }}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * The first-run onboarding block (E22.4): concrete "where do I get a radar
 * image" help. The SimpleRadar link opens externally via the allowlisted
 * `app.openExternal` (E15.3, ADR-036).
 */
function GetStartedHelp(): JSX.Element {
  const [openFailure, setOpenFailure] = useState<string | undefined>(undefined);

  async function handleOpenHelp(): Promise<void> {
    const result = await openExternal(RADAR_IMAGE_HELP_URL);
    setOpenFailure(result.ok ? undefined : result.error.message);
  }

  return (
    <section className="rounded-lg border bg-muted/50 p-4">
      <h2 className="font-medium">Get started</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        TactiCS ships no map imagery — you provide the radar image. Take a screenshot of the in-game
        overview map, or use a community radar pack (e.g. SimpleRadar). PNG, JPG and SVG are
        supported. Pick a map below and upload its image.
      </p>
      <Button
        type="button"
        variant="link"
        className="mt-1 h-auto p-0 text-sm"
        onClick={() => {
          void handleOpenHelp();
        }}
      >
        Get a radar image (SimpleRadar)
      </Button>
      {openFailure !== undefined && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {openFailure}
        </p>
      )}
    </section>
  );
}

interface MapCardProps {
  readonly map: MapSummary;
  readonly uploadDisabled: boolean;
  readonly uploadError: string | undefined;
  readonly onUpload: () => void;
}

function MapCard({ map, uploadDisabled, uploadError, onUpload }: MapCardProps): JSX.Element {
  const profileCount = map.profiles.length;
  return (
    <li className="flex flex-col items-start gap-2 rounded-lg border p-4">
      <h3 className="font-medium">{map.displayName}</h3>
      {profileCount > 0 ? (
        <>
          <p className="text-sm text-muted-foreground">
            {profileCount === 1 ? '1 profile' : `${String(profileCount)} profiles`}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link
              to="/maps/$mapId"
              params={{ mapId: map.id }}
              aria-label={`View map ${map.displayName}`}
            >
              View map
            </Link>
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">No image yet</p>
          <Button
            type="button"
            size="sm"
            disabled={uploadDisabled}
            onClick={onUpload}
            aria-label={`Upload image… for ${map.displayName}`}
          >
            Upload image…
          </Button>
          {uploadError !== undefined && (
            <p role="alert" className="text-sm text-destructive">
              {uploadError}
            </p>
          )}
        </>
      )}
    </li>
  );
}
