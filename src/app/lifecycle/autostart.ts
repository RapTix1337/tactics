/**
 * Autostart registration logic (E17.2). Pure and testable — the Electron
 * login-item calls stay in app-lifecycle.ts, following the tray.ts pattern.
 */

/** The slice of Electron's login-item API this module needs (per-user, GSI-08). */
export interface LoginItemsPort {
  /** Whether the app is currently registered as a login item. */
  readonly getOpenAtLogin: () => boolean;
  /** Registers (`true`) or deregisters (`false`) the login item. */
  readonly setOpenAtLogin: (openAtLogin: boolean) => void;
}

/**
 * Aligns the OS login-item state with the autostart setting (requirements §9,
 * default off). Idempotent — it writes only when the OS state differs — so
 * the same call serves both the immediate toggle apply and the startup
 * reconcile that heals outside drift (e.g. a manually removed registry
 * entry) without redundant writes.
 */
export function syncAutostart(loginItems: LoginItemsPort, autostart: boolean): void {
  if (loginItems.getOpenAtLogin() !== autostart) {
    loginItems.setOpenAtLogin(autostart);
  }
}
