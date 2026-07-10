import type { JSX, PointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { MapProfileDetails } from '../../../shared/map-catalog';
import { MAX_CALLOUTS_PER_PROFILE } from '../../../shared/map-catalog';
import { Button } from '../../components/ui/button';
import { loadProfile } from '../../lib/ipc/map-catalog';
import { useMapCatalogStore } from '../../stores/map-catalog-store';
import type { NormalizedPoint } from './callout-editing';
import { clampNormalized, isInsideImage, screenToNormalized } from './callout-editing';
import { CalloutLayer } from './CalloutLayer';
import { CalloutNameDialog } from './CalloutNameDialog';
import type { CalloutEditorSession } from './use-callout-editor';
import { useCalloutEditor } from './use-callout-editor';
import { useImageLayoutRect } from './use-image-layout-rect';
import { useZoomPan } from './use-zoom-pan';

/** A pointer that travels further than this between down and up is a pan,
 * not a click — the editor only adds callouts on clicks. */
const CLICK_MOVE_TOLERANCE_PX = 4;

interface MapViewProps {
  readonly mapId: string;
  /** Explicit profile to show (E22.5 switcher); omitted = the map's default. */
  readonly profileId?: string;
  /** Offers the callout editor (E22.6) — browse mode only (06-ui.md §2). */
  readonly editable?: boolean;
}

/**
 * Outcome of the profile lookup — local view state (ADR-033 level 2).
 * `ready` holds only the profile id: the details stay in the catalog store,
 * so later mutation responses (rename, callout edits) re-render this view.
 */
type FetchOutcome =
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly profileId: string };

/**
 * The outcome is keyed by the request it answers: a mapId or profileId
 * change derives the loading state from the mismatch at render time instead
 * of resetting state in the effect (react-hooks/set-state-in-effect).
 */
interface FetchState {
  readonly mapId: string;
  readonly profileId: string | undefined;
  readonly outcome: FetchOutcome;
}

/**
 * The image canvas of the map view (E14.1, 06-ui.md §3): fetches the named
 * (or default, E22.5) profile via `maps.getProfile` and renders its image as an image
 * element sourced from the `tactics-map://` protocol — never inlined into
 * the DOM (MAP-07) inside the zoom/pan canvas (E14.2). The callout layer
 * (E14.4) builds on top; upload affordances for maps without an image are
 * the map-manage feature's job (E22.4/E22.5), so a missing profile renders
 * as a plain named error here.
 */
export function MapView({ mapId, profileId, editable = false }: MapViewProps): JSX.Element {
  const [fetchState, setFetchState] = useState<FetchState | undefined>(undefined);
  // Image failures are tracked per URL: a later image replacement changes
  // the URL and thereby retries automatically, with no reset bookkeeping.
  const [failedImageUrl, setFailedImageUrl] = useState<string | undefined>(undefined);
  const outcome =
    fetchState?.mapId === mapId && fetchState.profileId === profileId
      ? fetchState.outcome
      : undefined;
  const profile = useMapCatalogStore((state) =>
    outcome?.kind === 'ready' ? state.profilesById[outcome.profileId] : undefined,
  );

  useEffect(() => {
    let stale = false;
    void loadProfile(mapId, profileId).then((result) => {
      if (stale) {
        return;
      }
      setFetchState({
        mapId,
        profileId,
        outcome: result.ok
          ? { kind: 'ready', profileId: result.data.id }
          : { kind: 'failed', message: result.error.message },
      });
    });
    return (): void => {
      stale = true;
    };
  }, [mapId, profileId]);

  if (outcome === undefined) {
    return (
      <p role="status" className="flex h-full items-center justify-center text-muted-foreground">
        Loading map…
      </p>
    );
  }
  if (outcome.kind === 'failed') {
    return <MapViewError message={outcome.message} />;
  }
  if (profile === undefined) {
    // Loaded, but evicted from the cache since (e.g. the profile was
    // deleted from another surface) — the next mount refetches.
    return <MapViewError message="This map profile is no longer available." />;
  }
  if (failedImageUrl === profile.imageUrl) {
    return (
      <MapViewError message="The map image could not be loaded — the image file is missing or unreadable." />
    );
  }
  return (
    // Keyed by mapId: switching maps remounts the canvas, resetting zoom/pan.
    <MapCanvas
      key={mapId}
      profile={profile}
      editable={editable}
      onImageError={(): void => {
        setFailedImageUrl(profile.imageUrl);
      }}
    />
  );
}

interface MapCanvasProps {
  readonly profile: MapProfileDetails;
  readonly editable: boolean;
  readonly onImageError: () => void;
}

/**
 * The zoomable/pannable canvas around the map image (E14.2, UI-03/UI-06).
 * The CSS transform lives on a wrapper div shared by the image and the
 * callout layer (E14.4); only `transform` changes per interaction — no
 * re-layout (risk P2). When `editable`, the callout editor (E22.6, MVP-13)
 * adds its toolbar and makes the layer interactive: clicks place new
 * callouts, labels drag, and everything is keyboard-operable (UI-06).
 */
function MapCanvas({ profile, editable, onImageError }: MapCanvasProps): JSX.Element {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const {
    transform,
    isPanning,
    containerRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onKeyDown,
  } = useZoomPan();
  const imageRect = useImageLayoutRect(imageRef);
  const editor = useCalloutEditor(profile);
  const session = editor.session;
  // A potential click-to-add, armed on pointer down and judged on pointer up
  // by the travel distance — pans and label drags never arm it.
  const clickCandidate = useRef<
    { readonly pointerId: number; readonly x: number; readonly y: number } | undefined
  >(undefined);

  /** Client point → normalized image coordinates (unclamped — the callers
   * decide between ignoring and pinning out-of-image points). */
  function toNormalized(point: NormalizedPoint): NormalizedPoint | undefined {
    const container = containerRef.current;
    if (container === null || imageRect === undefined) {
      return undefined;
    }
    const bounds = container.getBoundingClientRect();
    return screenToNormalized(
      { x: point.x - bounds.left, y: point.y - bounds.top },
      transform,
      imageRect,
    );
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    onPointerDown(event);
    if (session !== undefined && !session.saving && event.button === 0) {
      clickCandidate.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
    }
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>): void {
    onPointerUp(event);
    const candidate = clickCandidate.current;
    if (candidate?.pointerId !== event.pointerId) {
      return;
    }
    clickCandidate.current = undefined;
    if (
      session === undefined ||
      session.saving ||
      Math.abs(event.clientX - candidate.x) > CLICK_MOVE_TOLERANCE_PX ||
      Math.abs(event.clientY - candidate.y) > CLICK_MOVE_TOLERANCE_PX
    ) {
      return;
    }
    const position = toNormalized({ x: event.clientX, y: event.clientY });
    // A click outside the image (on the canvas padding) places nothing.
    if (position === undefined || !isInsideImage(position)) {
      return;
    }
    editor.requestAdd(position);
  }

  function handlePointerCancel(event: PointerEvent<HTMLDivElement>): void {
    if (clickCandidate.current?.pointerId === event.pointerId) {
      clickCandidate.current = undefined;
    }
    onPointerUp(event);
  }

  /** The keyboard path to "add" (UI-06): places at the viewport center,
   * pinned to the image edge when the center lies outside the image. */
  function handleAddAtCenter(): void {
    const container = containerRef.current;
    if (container === null || imageRect === undefined) {
      return;
    }
    const bounds = container.getBoundingClientRect();
    const position = screenToNormalized(
      { x: bounds.width / 2, y: bounds.height / 2 },
      transform,
      imageRect,
    );
    editor.requestAdd(clampNormalized(position));
  }

  function focusCanvas(): void {
    containerRef.current?.focus();
  }

  const dialog = session?.dialog;
  const renamedCallout =
    session !== undefined && dialog?.kind === 'rename'
      ? session.draft.find((callout) => callout.id === dialog.calloutId)
      : undefined;
  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        role="application"
        aria-label={
          session === undefined
            ? 'Map canvas. Zoom with plus and minus, pan with the arrow keys, press 0 to reset the view.'
            : 'Map canvas, editing callouts. Click the image to place a new callout. Zoom with plus and minus, pan with the arrow keys, press 0 to reset the view.'
        }
        tabIndex={0}
        className="h-full w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{
          // Panning is a no-op at the fit scale — only advertise it beyond.
          cursor: transform.scale > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={onKeyDown}
      >
        <div
          data-testid="map-view-transform"
          // `relative` anchors the callout layer's absolute rect to this
          // wrapper — the image's offset parent.
          className="relative flex h-full w-full items-center justify-center p-4"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
          }}
        >
          <img
            ref={imageRef}
            data-testid="map-view-image"
            src={profile.imageUrl}
            alt={`Map image (profile "${profile.name}")`}
            draggable={false}
            className="max-h-full max-w-full object-contain"
            onError={onImageError}
          />
          <CalloutLayer
            callouts={profile.callouts}
            rect={imageRect}
            scale={transform.scale}
            editing={
              session === undefined
                ? undefined
                : {
                    draft: session.draft,
                    disabled: session.saving,
                    toNormalized,
                    onMove: editor.move,
                    onRename: editor.requestRename,
                    onDelete: (calloutId): void => {
                      editor.remove(calloutId);
                      // The deleted label held the focus — hand it back.
                      focusCanvas();
                    },
                  }
            }
          />
        </div>
      </div>
      {editable && (
        <CalloutEditorToolbar
          session={session}
          canEdit={imageRect !== undefined}
          onStart={(): void => {
            editor.start();
            focusCanvas();
          }}
          onAdd={handleAddAtCenter}
          onSave={editor.save}
          onCancel={(): void => {
            editor.cancel();
            focusCanvas();
          }}
        />
      )}
      {dialog !== undefined && (
        <CalloutNameDialog
          title={dialog.kind === 'add' ? 'Add callout' : 'Rename callout'}
          description={
            dialog.kind === 'add'
              ? 'Names the callout at the placed position. You can move it afterwards.'
              : `Renaming “${renamedCallout?.name ?? ''}” keeps its position.`
          }
          submitLabel={dialog.kind === 'add' ? 'Add callout' : 'Rename callout'}
          initialName={renamedCallout?.name ?? ''}
          isNameTaken={editor.isDialogNameTaken}
          onSubmit={editor.submitDialog}
          onOpenChange={(open): void => {
            if (!open) {
              editor.closeDialog();
            }
          }}
        />
      )}
    </div>
  );
}

interface CalloutEditorToolbarProps {
  readonly session: CalloutEditorSession | undefined;
  /** Editing needs the measured image — the editor stays off until then. */
  readonly canEdit: boolean;
  readonly onStart: () => void;
  readonly onAdd: () => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}

/**
 * The editor toolbar floating over the canvas (E22.6): enter edit mode, add
 * via keyboard, save (`maps.updateCallouts`, ADR-033 — the view re-renders
 * from the response), or cancel back to the saved state.
 */
function CalloutEditorToolbar({
  session,
  canEdit,
  onStart,
  onAdd,
  onSave,
  onCancel,
}: CalloutEditorToolbarProps): JSX.Element {
  return (
    <div className="absolute right-2 top-2 z-10 flex max-w-72 flex-wrap items-center justify-end gap-1 rounded-md border bg-background/90 p-1 shadow-sm">
      {session === undefined ? (
        <Button type="button" variant="outline" size="sm" disabled={!canEdit} onClick={onStart}>
          Edit callouts
        </Button>
      ) : (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={session.saving || session.draft.length >= MAX_CALLOUTS_PER_PROFILE}
            onClick={onAdd}
          >
            Add callout…
          </Button>
          <Button type="button" size="sm" disabled={session.saving} onClick={onSave}>
            Save
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={session.saving}
            onClick={onCancel}
          >
            Cancel
          </Button>
          {session.error !== undefined && (
            <p role="alert" className="w-full text-right text-sm text-destructive">
              {session.error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

interface MapViewErrorProps {
  readonly message: string;
}

function MapViewError({ message }: MapViewErrorProps): JSX.Element {
  return (
    <div
      role="alert"
      className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center"
    >
      <p className="font-medium">Cannot show this map</p>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
