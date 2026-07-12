import { join } from 'node:path';

import type { MenuItemConstructorOptions } from 'electron';

/**
 * Tray menu and close-to-tray decision logic (E17.1). Pure and testable —
 * the Tray/Menu construction itself stays in app-lifecycle.ts, following
 * the window-options.ts pattern.
 */

/** The electron `app` values needed to locate the bundled icon. */
export interface AppIconLocation {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly appPath: string;
}

/**
 * Resolves the multi-size `icon.ico` used for both the tray and the app icon:
 * it lives in the repo `build/` folder in dev and is copied next to the
 * packaged app via electron-builder `extraResources` (electron-builder.yml).
 * Mirrors the bundled-map-data resolution in app-lifecycle.ts.
 */
export function resolveAppIconPath(location: AppIconLocation): string {
  return location.isPackaged
    ? join(location.resourcesPath, 'icon.ico')
    : join(location.appPath, 'build', 'icon.ico');
}

export interface TrayMenuActions {
  /** Show the main window, recreating it when it was closed to tray. */
  readonly showWindow: () => void;
  /** Hide the main window; a no-op when no window exists. */
  readonly hideWindow: () => void;
  /** Quit the app regardless of the close-to-tray setting. */
  readonly quit: () => void;
}

/** The tray context menu: show / hide / quit (ADR-020 single window + tray). */
export function buildTrayMenuTemplate(actions: TrayMenuActions): MenuItemConstructorOptions[] {
  return [
    { label: 'Show', click: (): void => actions.showWindow() },
    { label: 'Hide', click: (): void => actions.hideWindow() },
    { type: 'separator' },
    { label: 'Quit', click: (): void => actions.quit() },
  ];
}

export type WindowsClosedAction = 'keep-running' | 'quit';

/**
 * The close-behavior decision (requirements §9): with close-to-tray enabled
 * the app stays alive in the tray when the last window closes; disabled
 * means close quits. Quit paths (tray menu, app.quit()) never reach this —
 * Electron skips `window-all-closed` for programmatic quits.
 */
export function resolveWindowsClosedAction(closeToTray: boolean): WindowsClosedAction {
  return closeToTray ? 'keep-running' : 'quit';
}
