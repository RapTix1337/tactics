import type { BrowserWindowConstructorOptions } from 'electron';

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
 * E2E spike's job (E4.1).
 */
export function buildMainWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: APP_NAME,
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
