import { BrowserWindow } from 'electron';

import { buildMainWindowOptions } from './window-options';

export interface MainWindowTarget {
  preloadPath: string;
  rendererHtmlPath: string;
  devServerUrl: string | undefined;
}

/**
 * Creates the hardened main window and loads the renderer (dev server in
 * dev mode, the built bundle otherwise). Navigation and window.open guards
 * are attached app-wide in app-lifecycle.ts, not per window.
 */
export function createMainWindow(target: MainWindowTarget): BrowserWindow {
  const window = new BrowserWindow(buildMainWindowOptions(target.preloadPath));

  window.once('ready-to-show', () => {
    window.show();
  });

  if (target.devServerUrl !== undefined) {
    void window.loadURL(target.devServerUrl);
  } else {
    void window.loadFile(target.rendererHtmlPath);
  }

  return window;
}
