import { fileURLToPath } from 'node:url';

import { app, type BrowserWindow, session } from 'electron';

import { createMainWindow } from './main-window';
import { DEV_CONTENT_SECURITY_POLICY, shouldAllowNavigation } from './security-policy';

/**
 * App lifecycle skeleton (E3.1): single-instance lock, session hardening,
 * main-window creation. Tray, close-to-tray, and window-bounds persistence
 * land in E17.x.
 */
export function startApp(): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  // Set by electron-vite in dev mode; absent in the packaged app.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  const devServerOrigin = devServerUrl === undefined ? undefined : new URL(devServerUrl).origin;

  // Defense in depth beyond the per-window `sandbox: true`: force the
  // sandbox for every process (ADR-025). Must be called before app ready.
  app.enableSandbox();

  let mainWindow: BrowserWindow | null = null;

  app.on('second-instance', () => {
    if (mainWindow === null) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  // ADR-025: navigation and window.open are blocked. Attached at the app
  // level so every current and future webContents is covered.
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!shouldAllowNavigation(url, devServerOrigin)) {
        event.preventDefault();
      }
    });
  });

  void app.whenReady().then(() => {
    hardenSession(devServerUrl !== undefined);

    mainWindow = createMainWindow({
      preloadPath: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      rendererHtmlPath: fileURLToPath(new URL('../renderer/index.html', import.meta.url)),
      devServerUrl,
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  });

  // Close means quit until close-to-tray arrives (E17.1).
  app.on('window-all-closed', () => {
    app.quit();
  });
}

function hardenSession(isDev: boolean): void {
  const appSession = session.defaultSession;

  // ADR-025: permission requests are denied — the app needs none.
  appSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  appSession.setPermissionCheckHandler(() => false);

  // Dev/prod CSP split (documented in security-policy.ts): in dev the
  // policy is a response header on dev-server responses; in production it
  // is a meta tag injected at build time (file:// has no headers), so no
  // header hook is needed here.
  if (isDev) {
    appSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [DEV_CONTENT_SECURITY_POLICY],
        },
      });
    });
  }
}
