import { BrowserWindow } from 'electron';

import type { BoundsRestorePlan } from './window-bounds';
import { buildMainWindowOptions } from './window-options';

export interface MainWindowTarget {
  preloadPath: string;
  rendererHtmlPath: string;
  devServerUrl: string | undefined;
  /** Clamped placement to restore (E17.3); `null` opens at the defaults. */
  restorePlan: BoundsRestorePlan | null;
}

/**
 * Creates the hardened main window and loads the renderer (dev server in
 * dev mode, the built bundle otherwise). Navigation and window.open guards
 * are attached app-wide in app-lifecycle.ts, not per window.
 */
export function createMainWindow(target: MainWindowTarget): BrowserWindow {
  const window = new BrowserWindow(
    buildMainWindowOptions(target.preloadPath, target.restorePlan?.bounds),
  );

  window.once('ready-to-show', () => {
    // Maximizing earlier would show the window before ready-to-show
    // (maximize() implies show) and bring back the white flash the
    // hidden start avoids. The constructor bounds stay the normal bounds,
    // so un-maximizing lands on the restored placement.
    if (target.restorePlan?.maximized === true) {
      window.maximize();
    }
    window.show();
  });

  if (target.devServerUrl !== undefined) {
    void window.loadURL(target.devServerUrl);
  } else {
    void window.loadFile(target.rendererHtmlPath);
  }

  return window;
}
