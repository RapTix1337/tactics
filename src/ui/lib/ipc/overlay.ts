import type { CommandResult } from '../../../shared/envelope';
import type { OverlayState } from '../../../shared/overlay-state';
import { invokeCommand } from './invoke';

/**
 * Closes the overlay window via `overlay.close` (live-overlay 02-design.md
 * §3.1, OVL.7) — the chrome's ✕ control. Idempotent on main; the mirror
 * follows through `evt:overlay.changed`, so the response exists for error
 * handling only. The open/resize wrappers arrive with their consumers
 * (OVL.9/OVL.8).
 */
export async function closeOverlay(): Promise<CommandResult<OverlayState>> {
  return invokeCommand((bridge) => bridge.invoke('overlay.close', undefined));
}
