import { z } from 'zod';

/**
 * The overlay slice as it crosses the IPC boundary (live-overlay 02-design.md
 * §3.2, ADR-058): runtime open state owned by the main-process window manager
 * — snapshot slice, `evt:overlay.changed` payload, and the `useOverlayStore`
 * content. Deliberately not persisted (manual reopen, restored geometry).
 */
export interface OverlayState {
  readonly open: boolean;
}

export const overlayStateSchema = z.object({
  open: z.boolean(),
});

/**
 * The closed set of draggable edges/corners for `overlay.resize` (02-design.md
 * §3.1): native resize is unavailable for transparent windows on Windows, so
 * the overlay's own handles name what they drag and main computes the bounds.
 */
export const OVERLAY_RESIZE_EDGES = [
  'left',
  'right',
  'top',
  'bottom',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const;

export type OverlayResizeEdge = (typeof OVERLAY_RESIZE_EDGES)[number];

/**
 * The `overlay.resize` request: the dragged edge/corner plus the pointer in
 * screen coordinates (fractional under DPI scaling). Main clamps and applies —
 * the response only acknowledges.
 */
export const overlayResizeRequestSchema = z.object({
  edge: z.enum(OVERLAY_RESIZE_EDGES),
  pointerX: z.number(),
  pointerY: z.number(),
});

export type OverlayResizeRequest = z.infer<typeof overlayResizeRequestSchema>;
