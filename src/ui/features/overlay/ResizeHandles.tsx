import type { JSX, PointerEvent } from 'react';
import { useEffect, useRef } from 'react';

import type { OverlayResizeEdge } from '../../../shared/overlay-state';
import { OVERLAY_RESIZE_EDGES } from '../../../shared/overlay-state';
import { resizeOverlay } from '../../lib/ipc/overlay';

/**
 * Placement and cursor per handle. Edges are 6 px strips, corners 12 px
 * squares; the enum lists corners after edges, so the corners paint (and
 * hit-test) on top where they overlap.
 */
const HANDLE_CLASSES: Record<OverlayResizeEdge, string> = {
  left: 'inset-y-0 left-0 w-1.5 cursor-ew-resize',
  right: 'inset-y-0 right-0 w-1.5 cursor-ew-resize',
  top: 'inset-x-0 top-0 h-1.5 cursor-ns-resize',
  bottom: 'inset-x-0 bottom-0 h-1.5 cursor-ns-resize',
  'top-left': 'left-0 top-0 size-3 cursor-nwse-resize',
  'top-right': 'right-0 top-0 size-3 cursor-nesw-resize',
  'bottom-left': 'bottom-0 left-0 size-3 cursor-nesw-resize',
  'bottom-right': 'bottom-0 right-0 size-3 cursor-nwse-resize',
};

interface ActiveDrag {
  pointerId: number;
  edge: OverlayResizeEdge;
  pointerX: number;
  pointerY: number;
  /** Scheduled dispatch frame; `undefined` while none is pending. */
  frame: number | undefined;
}

/**
 * The overlay's resize affordance (live-overlay 02-design.md §5.3, spec
 * AC 6): 8 invisible edge/corner strips at the window border — native resize
 * is unavailable for transparent frameless windows on Windows, so the
 * handles capture the pointer and report `overlay.resize` frames; main owns
 * math and clamping (OVL.3/4). Dispatch is throttled to animation frames
 * (ADR-058): moves only record the latest screen position, one command per
 * frame. Release flushes one final resize with the release coordinates
 * (maintainer decision, OVL.8) so the window lands exactly where the mouse
 * let go — nothing dispatches after that. Deliberately outside the fade
 * regions: interaction-only surfaces that must keep working at 0 % opacity
 * (design §6 case 5).
 */
export function ResizeHandles(): JSX.Element {
  const drag = useRef<ActiveDrag | undefined>(undefined);

  // A frame scheduled right before unmount would dispatch from a dead tree.
  useEffect(() => {
    return (): void => {
      if (drag.current?.frame !== undefined) {
        cancelAnimationFrame(drag.current.frame);
      }
      drag.current = undefined;
    };
  }, []);

  const onPointerDown = (edge: OverlayResizeEdge, event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    // Keeps the drag alive once the pointer leaves the thin strip (stubbed
    // in jsdom via test-setup).
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      edge,
      pointerX: event.screenX,
      pointerY: event.screenY,
      frame: undefined,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const active = drag.current;
    if (active === undefined || active.pointerId !== event.pointerId) {
      return;
    }
    active.pointerX = event.screenX;
    active.pointerY = event.screenY;
    if (active.frame === undefined) {
      active.frame = requestAnimationFrame(() => {
        active.frame = undefined;
        // Fire-and-forget: the command only acknowledges, and a failed frame
        // is visible as the window not following the pointer.
        void resizeOverlay({
          edge: active.edge,
          pointerX: active.pointerX,
          pointerY: active.pointerY,
        });
      });
    }
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>): ActiveDrag | undefined => {
    const active = drag.current;
    if (active === undefined || active.pointerId !== event.pointerId) {
      return undefined;
    }
    if (active.frame !== undefined) {
      cancelAnimationFrame(active.frame);
      active.frame = undefined;
    }
    drag.current = undefined;
    return active;
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const active = endDrag(event);
    if (active === undefined) {
      return;
    }
    void resizeOverlay({ edge: active.edge, pointerX: event.screenX, pointerY: event.screenY });
  };

  // Capture loss (OS gesture, window switch) abandons the drag without a
  // flush — the window stays where the last applied frame put it.
  const onPointerCancel = (event: PointerEvent<HTMLDivElement>): void => {
    endDrag(event);
  };

  return (
    <>
      {OVERLAY_RESIZE_EDGES.map((edge) => (
        <div
          key={edge}
          data-testid={`resize-handle-${edge}`}
          className={`app-region-no-drag fixed z-50 ${HANDLE_CLASSES[edge]}`}
          onPointerDown={(event) => {
            onPointerDown(edge, event);
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
      ))}
    </>
  );
}
