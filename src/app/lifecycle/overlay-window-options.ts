import type { BrowserWindowConstructorOptions, Rectangle } from 'electron';

import { APP_NAME } from '../../shared';

// Live-overlay 02-design.md §2.1: first open uses the 16:9 default, OS-centered.
export const OVERLAY_DEFAULT_WIDTH = 960;
export const OVERLAY_DEFAULT_HEIGHT = 540;

/**
 * Overlay-window construction options (ADR-057): transparent, frameless,
 * always-on-top at the default floating level. Native resize/maximize/minimize
 * are disabled — Windows strips WS_THICKFRAME from transparent windows, so
 * resizing is the overlay's own handles plus `computeResizedBounds`. The
 * taskbar entry and title stay for recovery/alt-tab reachability. Pure builder
 * so every flag is unit-testable without launching Electron; `initialBounds`
 * replaces the default placement with the restored one — already clamped by
 * the caller.
 */
export function buildOverlayWindowOptions(
  preloadPath: string,
  initialBounds?: Rectangle,
): BrowserWindowConstructorOptions {
  return {
    width: initialBounds?.width ?? OVERLAY_DEFAULT_WIDTH,
    height: initialBounds?.height ?? OVERLAY_DEFAULT_HEIGHT,
    // x and y only as a pair — Electron centers the window otherwise.
    ...(initialBounds === undefined ? {} : { x: initialBounds.x, y: initialBounds.y }),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: false,
    title: `${APP_NAME} Overlay`,
    // Shown on ready-to-show to avoid a flash (the main-window pattern).
    show: false,
    webPreferences: {
      preload: preloadPath,
      // ADR-025: the renderer is always unprivileged. These match
      // Electron's secure defaults but are pinned explicitly so a
      // regression is a visible diff and a failing test.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      // An always-on-top visible window is never occluded; revisit only if
      // live updates demonstrably stall (02-design.md §2.1).
      backgroundThrottling: true,
    },
  };
}
