import type { CommandResult } from '../../../shared/envelope';
import type { OverlayResizeRequest, OverlayState } from '../../../shared/overlay-state';
import { invokeCommand } from './invoke';

/**
 * Opens the overlay window (or focuses the existing one) via `overlay.open`
 * (live-overlay 02-design.md §3.1, OVL.9) — the live page's toggle.
 * Idempotent on main; the mirror follows through `evt:overlay.changed`, so
 * the response exists for error handling only.
 */
export async function openOverlay(): Promise<CommandResult<OverlayState>> {
  return invokeCommand((bridge) => bridge.invoke('overlay.open', undefined));
}

/**
 * Closes the overlay window via `overlay.close` (live-overlay 02-design.md
 * §3.1, OVL.7) — the chrome's ✕ control. Idempotent on main; the mirror
 * follows through `evt:overlay.changed`, so the response exists for error
 * handling only.
 */
export async function closeOverlay(): Promise<CommandResult<OverlayState>> {
  return invokeCommand((bridge) => bridge.invoke('overlay.close', undefined));
}

/**
 * Reports a resize-drag frame via `overlay.resize` (live-overlay 02-design.md
 * §3.1, OVL.8): the dragged edge plus the pointer in screen coordinates —
 * main computes, clamps, and applies the bounds; the response only
 * acknowledges (a frame racing the window's close is a no-op success).
 */
export async function resizeOverlay(request: OverlayResizeRequest): Promise<CommandResult<void>> {
  return invokeCommand((bridge) => bridge.invoke('overlay.resize', request));
}
