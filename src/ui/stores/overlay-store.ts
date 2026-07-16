import { create } from 'zustand';

import type { OverlayState } from '../../shared/overlay-state';

/**
 * Mirror store for the overlay window's runtime state (ADR-033, live-overlay
 * 02-design.md §5.4, OVL.9): written ONLY by the renderer IPC layer
 * (src/ui/lib/ipc) — components read via selectors. `undefined` until the
 * snapshot arrives; every `evt:overlay.changed` carries the full new slice.
 */
interface OverlayStoreState {
  readonly overlay: OverlayState | undefined;
}

export const useOverlayStore = create<OverlayStoreState>(() => ({
  overlay: undefined,
}));
