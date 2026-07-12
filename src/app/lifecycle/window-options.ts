import type { BrowserWindowConstructorOptions, Rectangle } from 'electron';

import { APP_NAME } from '../../shared';

// UI-05: freely resizable above a sensible minimum of ~1024×700.
export const MIN_WINDOW_WIDTH = 1024;
export const MIN_WINDOW_HEIGHT = 700;

export const DEFAULT_WINDOW_WIDTH = 1280;
export const DEFAULT_WINDOW_HEIGHT = 800;

/**
 * Main-window construction options with the full ADR-025 hardening.
 * Kept as a pure builder so the security flags are unit-testable without
 * launching Electron (E3.1 acceptance criterion); real-app evidence is the
 * E2E spike's job (E4.1). `initialBounds` (E17.3) replaces the default
 * placement with the restored one — already clamped by the caller.
 */
export function buildMainWindowOptions(
  preloadPath: string,
  iconPath: string,
  initialBounds?: Rectangle,
): BrowserWindowConstructorOptions {
  return {
    width: initialBounds?.width ?? DEFAULT_WINDOW_WIDTH,
    height: initialBounds?.height ?? DEFAULT_WINDOW_HEIGHT,
    // x and y only as a pair — Electron centers the window otherwise.
    ...(initialBounds === undefined ? {} : { x: initialBounds.x, y: initialBounds.y }),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: APP_NAME,
    // Window/taskbar icon in dev and on Linux; the packaged Windows exe uses
    // the electron-builder `win.icon` embedded in the binary instead.
    icon: iconPath,
    // Shown on ready-to-show to avoid a white flash.
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
      // Requirements §10: throttle rendering while minimized.
      backgroundThrottling: true,
    },
  };
}
