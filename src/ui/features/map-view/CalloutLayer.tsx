import type { JSX, KeyboardEvent, PointerEvent } from 'react';
import { useId, useRef } from 'react';

import type { CatalogCallout } from '../../../shared/map-catalog';
import type { DraftCallout, ImageLayoutRect, NormalizedPoint } from './callout-editing';
import { clampNormalized } from './callout-editing';

/** Keyboard moves shift a callout by a constant screen distance (like the
 * counter-scaled labels): the normalized step shrinks as the zoom grows. */
const ARROW_MOVE_STEP_PX = 8;

/** The editor surface the map canvas hands to the layer (E22.6, MVP-13). */
export interface CalloutLayerEditing {
  readonly draft: readonly DraftCallout[];
  /** True while a save is in flight — the labels lock. */
  readonly disabled: boolean;
  /** Client point → normalized image coordinates (the canvas owns the
   * transform and container origin); `undefined` while unmeasured. */
  readonly toNormalized: (point: NormalizedPoint) => NormalizedPoint | undefined;
  readonly onMove: (calloutId: number, position: NormalizedPoint) => void;
  readonly onRename: (calloutId: number) => void;
  readonly onDelete: (calloutId: number) => void;
}

interface CalloutLayerProps {
  /** The saved callouts (view mode); the editor draft replaces them. */
  readonly callouts: readonly CatalogCallout[];
  /** The image's measured layout box; `undefined` renders nothing. */
  readonly rect: ImageLayoutRect | undefined;
  /** Current zoom scale — labels counter-scale to keep a constant screen size. */
  readonly scale: number;
  /** When set, the layer renders the draft as draggable, focusable labels. */
  readonly editing?: CalloutLayerEditing;
}

/**
 * Callout labels over the map image (E14.4/E22.6, MVP-08/13, 06-ui.md §3):
 * positioned by their normalized 0–1 coordinates (ADR-045) inside the same
 * zoom/pan transform as the image. Each label counter-scales by `1/scale`
 * around its anchor point, so labels keep a constant screen size and stay
 * legible across zoom levels. View mode ignores pointer events — panning
 * works through it; in edit mode each label becomes a button that drags with
 * the pointer and moves/renames/deletes via the keyboard (UI-06).
 */
export function CalloutLayer({
  callouts,
  rect,
  scale,
  editing,
}: CalloutLayerProps): JSX.Element | null {
  const keyboardHintId = useId();
  // One drag at a time, identified by pointer and draft id — a ref, since
  // dragging feeds positions through `onMove` and never re-renders by itself.
  const activeDrag = useRef<{ pointerId: number; calloutId: number } | undefined>(undefined);
  const entries = editing?.draft ?? callouts;
  if (rect === undefined || entries.length === 0) {
    return null;
  }

  function labelPosition(callout: CatalogCallout): {
    left: string;
    top: string;
    transform: string;
  } {
    return {
      left: `${callout.x * 100}%`,
      top: `${callout.y * 100}%`,
      // translate centers the label on its anchor; the counter-scale then
      // shrinks it around that same point (origin: center).
      transform: `translate(-50%, -50%) scale(${1 / scale})`,
    };
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>, calloutId: number): void {
    if (event.button !== 0) {
      return;
    }
    // The canvas underneath pans on pointer down and adds on click — a drag
    // that starts on a label belongs to the label alone.
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeDrag.current = { pointerId: event.pointerId, calloutId };
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>, calloutId: number): void {
    const drag = activeDrag.current;
    if (
      editing === undefined ||
      drag === undefined ||
      drag.pointerId !== event.pointerId ||
      drag.calloutId !== calloutId
    ) {
      return;
    }
    const position = editing.toNormalized({ x: event.clientX, y: event.clientY });
    if (position !== undefined) {
      // Dragging past the image edge pins the callout to that edge.
      editing.onMove(calloutId, clampNormalized(position));
    }
  }

  function handlePointerEnd(event: PointerEvent<HTMLButtonElement>): void {
    if (activeDrag.current?.pointerId === event.pointerId) {
      activeDrag.current = undefined;
    }
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    callout: DraftCallout,
    imageRect: ImageLayoutRect,
  ): void {
    if (editing === undefined) {
      return;
    }
    // A constant screen-pixel step, converted through the current zoom.
    const stepX = ARROW_MOVE_STEP_PX / (scale * imageRect.width);
    const stepY = ARROW_MOVE_STEP_PX / (scale * imageRect.height);
    switch (event.key) {
      case 'ArrowLeft':
        editing.onMove(callout.id, clampNormalized({ x: callout.x - stepX, y: callout.y }));
        break;
      case 'ArrowRight':
        editing.onMove(callout.id, clampNormalized({ x: callout.x + stepX, y: callout.y }));
        break;
      case 'ArrowUp':
        editing.onMove(callout.id, clampNormalized({ x: callout.x, y: callout.y - stepY }));
        break;
      case 'ArrowDown':
        editing.onMove(callout.id, clampNormalized({ x: callout.x, y: callout.y + stepY }));
        break;
      case 'Enter':
      case 'F2':
        editing.onRename(callout.id);
        break;
      case 'Delete':
      case 'Backspace':
        editing.onDelete(callout.id);
        break;
      default:
        return;
    }
    // Handled keys stay here — the canvas underneath pans on the same arrows.
    event.stopPropagation();
    event.preventDefault();
  }

  const chipClassName =
    'max-w-40 truncate rounded bg-background/70 px-1.5 py-0.5 text-xs font-medium text-foreground';
  return (
    <ul
      aria-label="Callouts"
      className="pointer-events-none absolute m-0 list-none p-0"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      {editing !== undefined ? (
        <>
          <span id={keyboardHintId} className="sr-only">
            Move with the arrow keys, rename with Enter, delete with Delete.
          </span>
          {editing.draft.map((callout) => (
            <li key={callout.id} className="absolute" style={labelPosition(callout)}>
              <button
                type="button"
                disabled={editing.disabled}
                aria-describedby={keyboardHintId}
                className={`${chipClassName} pointer-events-auto cursor-move ring-1 ring-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                style={{ touchAction: 'none' }}
                onPointerDown={(event) => {
                  handlePointerDown(event, callout.id);
                }}
                onPointerMove={(event) => {
                  handlePointerMove(event, callout.id);
                }}
                onPointerUp={handlePointerEnd}
                onPointerCancel={handlePointerEnd}
                onKeyDown={(event) => {
                  handleKeyDown(event, callout, rect);
                }}
              >
                {callout.name}
              </button>
            </li>
          ))}
        </>
      ) : (
        callouts.map((callout) => (
          // Callout names are unique within a profile (calloutListSchema).
          <li
            key={callout.name}
            className={`absolute ${chipClassName}`}
            style={labelPosition(callout)}
          >
            {callout.name}
          </li>
        ))
      )}
    </ul>
  );
}
