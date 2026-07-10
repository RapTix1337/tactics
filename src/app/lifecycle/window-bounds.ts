import type { Rectangle } from 'electron';

import type { WindowBounds } from '../../modules/settings';
import type { Logger } from '../../shared';
import { describeError } from '../ipc/register-command';

/**
 * Window-bounds capture and restore logic (E17.3). Pure and testable — the
 * BrowserWindow/screen calls stay in app-lifecycle.ts, following the
 * tray.ts/autostart.ts pattern.
 */

/** Debounce for bounds persistence: `move` fires per pixel during a drag. */
export const BOUNDS_SAVE_DEBOUNCE_MS = 500;

/** The slice of BrowserWindow the capture side needs. */
export interface BoundsWindowPort {
  /** The un-maximized placement — stable while the window is maximized. */
  readonly getNormalBounds: () => Rectangle;
  readonly isMaximized: () => boolean;
  readonly isDestroyed: () => boolean;
}

/**
 * Reads the persistable placement: always the *normal* bounds plus the
 * maximized flag, so un-maximizing after a restore lands where the user
 * left the window. Rounded — scaled displays can yield fractional values,
 * and the stored schema requires integers.
 */
export function captureWindowBounds(window: BoundsWindowPort): WindowBounds {
  const bounds = window.getNormalBounds();
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
    maximized: window.isMaximized(),
  };
}

export interface BoundsRestorePlan {
  /** Clamped normal bounds to hand to the BrowserWindow constructor. */
  readonly bounds: Rectangle;
  /** Maximize after creation (before show). */
  readonly maximized: boolean;
}

/**
 * Turns stored bounds into a restore plan, clamped to the currently visible
 * work areas (E17.3 risk note: a monitor may be gone since the last run).
 * The target is the work area overlapping the stored placement most; with
 * no overlap at all the bounds move to the first (primary) work area. Size
 * is capped to the target area, position shifted so the window is fully
 * visible. `null` means nothing to restore — the caller uses the defaults.
 */
export function planBoundsRestore(
  stored: WindowBounds | null,
  workAreas: readonly Rectangle[],
): BoundsRestorePlan | null {
  if (stored === null || workAreas.length === 0) {
    return null;
  }
  const target = workAreas.reduce((best, candidate) =>
    intersectionArea(candidate, stored) > intersectionArea(best, stored) ? candidate : best,
  );
  const width = Math.min(stored.width, target.width);
  const height = Math.min(stored.height, target.height);
  return {
    bounds: {
      x: clamp(stored.x, target.x, target.x + target.width - width),
      y: clamp(stored.y, target.y, target.y + target.height - height),
      width,
      height,
    },
    maximized: stored.maximized,
  };
}

function intersectionArea(a: Rectangle, b: Rectangle): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface WindowBoundsTracker {
  /** Debounced save; wire to `move`/`resize`/`maximize`/`unmaximize`. */
  readonly scheduleSave: () => void;
  /** Cancels a pending save and persists immediately; wire to `close`. */
  readonly flush: () => void;
}

export interface WindowBoundsTrackerOptions {
  readonly window: BoundsWindowPort;
  readonly persist: (bounds: WindowBounds) => void;
  readonly logger: Logger;
  readonly debounceMs?: number;
}

/**
 * Persists the window placement on change. Saves are debounced (a drag emits
 * a `move` stream) and best-effort: a failing write is logged, never thrown —
 * losing a placement must not take the app down. `close` fires before the
 * window is destroyed, so the flush there captures the final placement; the
 * destroyed-guard covers a stray timer racing the window teardown.
 */
export function createWindowBoundsTracker(
  options: WindowBoundsTrackerOptions,
): WindowBoundsTracker {
  const { window, persist, logger } = options;
  const debounceMs = options.debounceMs ?? BOUNDS_SAVE_DEBOUNCE_MS;
  let pending: ReturnType<typeof setTimeout> | undefined;

  const save = (): void => {
    pending = undefined;
    if (window.isDestroyed()) {
      return;
    }
    try {
      persist(captureWindowBounds(window));
    } catch (error) {
      logger.warn('Persisting window bounds failed', { error: describeError(error) });
    }
  };

  return {
    scheduleSave: (): void => {
      clearTimeout(pending);
      pending = setTimeout(save, debounceMs);
    },
    flush: (): void => {
      clearTimeout(pending);
      save();
    },
  };
}
