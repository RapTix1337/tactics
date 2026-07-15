import type { Rectangle } from 'electron';

import type { WindowBounds } from '../../modules/settings';
import type { Logger, OverlayResizeEdge, OverlayState } from '../../shared';
import { computeResizedBounds, OVERLAY_MIN_HEIGHT, OVERLAY_MIN_WIDTH } from './overlay-resize';
import { resolveWindowsClosedAction } from './tray';
import type { BoundsWindowPort } from './window-bounds';
import { createWindowBoundsTracker, planBoundsRestore } from './window-bounds';

/**
 * Overlay window manager (live-overlay 02-design.md §2.1, OVL.4): owns the
 * single transparent always-on-top window from the main process. Pure and
 * testable against faked window ports — the BrowserWindow construction stays
 * in the composition root (the main-window.ts split), injected as
 * `createWindow`.
 */

/** The window events the manager wires; a real BrowserWindow emits all four. */
export type OverlayWindowEvent = 'move' | 'resize' | 'close' | 'closed';

/** The slice of BrowserWindow the manager needs; fakes implement it in tests. */
export interface OverlayWindowPort extends BoundsWindowPort {
  readonly focus: () => void;
  readonly close: () => void;
  readonly getBounds: () => Rectangle;
  readonly setBounds: (bounds: Rectangle) => void;
  readonly on: (event: OverlayWindowEvent, listener: () => void) => void;
}

export interface OverlayWindowManagerDeps {
  /**
   * Creates and shows the overlay window; `undefined` means no restorable
   * placement — the window opens at the defaults, OS-centered.
   */
  readonly createWindow: (restoredBounds: Rectangle | undefined) => OverlayWindowPort;
  /** Persisted overlay placement from operational state, `null` on first open. */
  readonly getStoredBounds: () => WindowBounds | null;
  /** Current display work areas for the restore-plan clamping. */
  readonly getWorkAreas: () => readonly Rectangle[];
  /** Persists the overlay placement to operational state. */
  readonly persistBounds: (bounds: WindowBounds) => void;
  readonly logger: Logger;
}

export interface OverlayWindowManager {
  /** Idempotent: an existing overlay is focused, never duplicated. */
  readonly open: () => void;
  /** Idempotent: a no-op without a window. */
  readonly close: () => void;
  /**
   * Applies the overlay's own resize math (native resize is unavailable for
   * transparent windows on Windows). A call after the window closed is a
   * silent no-op — in-flight drag frames racing a close are normal.
   */
  readonly resize: (edge: OverlayResizeEdge, pointerX: number, pointerY: number) => void;
  readonly isOpen: () => boolean;
  /** Feeds `evt:overlay.changed` and the snapshot slice (OVL.5). */
  readonly onStateChanged: (listener: (state: OverlayState) => void) => () => void;
  /**
   * Close-to-tray interplay (02-design.md §2.1): with close-to-tray off the
   * overlay follows the main window, so `window-all-closed` fires and the
   * app quits as without the overlay; with close-to-tray on it survives.
   */
  readonly handleMainWindowClosed: (closeToTray: boolean) => void;
}

export function createOverlayWindowManager(deps: OverlayWindowManagerDeps): OverlayWindowManager {
  let window: OverlayWindowPort | null = null;
  const listeners = new Set<(state: OverlayState) => void>();

  const notify = (): void => {
    const state: OverlayState = { open: window !== null };
    for (const listener of listeners) {
      listener(state);
    }
  };

  const close = (): void => {
    // The `closed` handler below resets the state and notifies — both close
    // paths (this call, native ✕) converge there on one event.
    window?.close();
  };

  return {
    open: (): void => {
      if (window !== null) {
        window.focus();
        return;
      }
      const plan = planBoundsRestore(deps.getStoredBounds(), deps.getWorkAreas());
      const created = deps.createWindow(plan?.bounds);
      window = created;
      const tracker = createWindowBoundsTracker({
        window: created,
        persist: deps.persistBounds,
        logger: deps.logger,
      });
      created.on('move', tracker.scheduleSave);
      created.on('resize', tracker.scheduleSave);
      // `close` precedes destruction: the final placement is still readable
      // and lands in storage before will-quit closes the database.
      created.on('close', tracker.flush);
      created.on('closed', () => {
        window = null;
        notify();
      });
      notify();
    },
    close,
    resize: (edge, pointerX, pointerY): void => {
      if (window === null || window.isDestroyed()) {
        return;
      }
      window.setBounds(
        computeResizedBounds(
          window.getBounds(),
          edge,
          { x: pointerX, y: pointerY },
          { width: OVERLAY_MIN_WIDTH, height: OVERLAY_MIN_HEIGHT },
        ),
      );
    },
    isOpen: (): boolean => window !== null,
    onStateChanged: (listener): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    handleMainWindowClosed: (closeToTray): void => {
      if (resolveWindowsClosedAction(closeToTray) === 'quit') {
        close();
      }
    },
  };
}
