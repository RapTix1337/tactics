import type { MenuItemConstructorOptions } from 'electron';

/**
 * Tray menu and close-to-tray decision logic (E17.1). Pure and testable —
 * the Tray/Menu construction itself stays in app-lifecycle.ts, following
 * the window-options.ts pattern.
 */

/**
 * Placeholder tray icon: a 16×16 solid-orange PNG embedded as a data URL,
 * so no asset pipeline is needed yet. Final art is open question #9 and
 * lands with the packaging work (E19.1).
 */
export const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGklEQVR42mO4N9v0PyWYYdSAUQNGDRguBgAAvxGtH5szLAUAAAAASUVORK5CYII=';

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
