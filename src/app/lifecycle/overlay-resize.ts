import type { Rectangle } from 'electron';

import type { OverlayResizeEdge } from '../../shared';

// Live-overlay 02-design.md §2.1 / OVL.3: minimum overlay size, clamped by
// `computeResizedBounds` (native minimums are moot with `resizable: false`).
export const OVERLAY_MIN_WIDTH = 480;
export const OVERLAY_MIN_HEIGHT = 320;

/** Which sides a dragged edge/corner moves. */
const EDGE_SIDES: Record<
  OverlayResizeEdge,
  { readonly horizontal?: 'left' | 'right'; readonly vertical?: 'top' | 'bottom' }
> = {
  left: { horizontal: 'left' },
  right: { horizontal: 'right' },
  top: { vertical: 'top' },
  bottom: { vertical: 'bottom' },
  'top-left': { horizontal: 'left', vertical: 'top' },
  'top-right': { horizontal: 'right', vertical: 'top' },
  'bottom-left': { horizontal: 'left', vertical: 'bottom' },
  'bottom-right': { horizontal: 'right', vertical: 'bottom' },
};

/**
 * Pure resize math for the overlay's own resize handles (02-design.md §3.1):
 * moves the dragged edge/corner to the pointer's screen position and clamps
 * the size to `minSize` anchored on the opposite edge — the non-dragged side
 * never moves, even when the pointer jumps past it. Pointer coordinates are
 * fractional under DPI scaling and get rounded; anchor edges are taken from
 * `current` verbatim so repeated resizes cannot drift. Position is
 * deliberately not clamped to work areas — that matches native resize
 * behavior; off-screen recovery is the restore plan's job.
 */
export function computeResizedBounds(
  current: Rectangle,
  edge: OverlayResizeEdge,
  pointer: { readonly x: number; readonly y: number },
  minSize: { readonly width: number; readonly height: number },
): Rectangle {
  const sides = EDGE_SIDES[edge];
  let { x, y, width, height } = current;

  if (sides.horizontal === 'left') {
    const right = current.x + current.width;
    width = Math.max(right - Math.round(pointer.x), minSize.width);
    x = right - width;
  } else if (sides.horizontal === 'right') {
    width = Math.max(Math.round(pointer.x) - current.x, minSize.width);
  }

  if (sides.vertical === 'top') {
    const bottom = current.y + current.height;
    height = Math.max(bottom - Math.round(pointer.y), minSize.height);
    y = bottom - height;
  } else if (sides.vertical === 'bottom') {
    height = Math.max(Math.round(pointer.y) - current.y, minSize.height);
  }

  return { x, y, width, height };
}
