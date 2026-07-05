import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, type BrowserWindow, session } from 'electron';

import { createLogger, initializeLogging, resolveLogLevel } from '../../modules/logging';
import { createSettingsRepository } from '../../modules/settings';
import type { StorageDatabase } from '../../modules/storage';
import { openDatabase } from '../../modules/storage';
import { registerAppCommands } from '../ipc/app-commands';
import {
  createAppEventPublisher,
  createElectronCommandDeps,
  createElectronLogsDeps,
} from '../ipc/electron-ipc';
import { registerLogsCommands } from '../ipc/logs-commands';
import { describeError } from '../ipc/register-command';
import { registerSettingsCommands } from '../ipc/settings-commands';
import { loadBundledMigrations } from '../wiring/bundled-migrations';
import { installMainErrorCapture } from './error-capture';
import { createMainWindow } from './main-window';
import { DEV_CONTENT_SECURITY_POLICY, shouldAllowNavigation } from './security-policy';
import { resolveUserDataDirOverride } from './user-data-override';

/**
 * App lifecycle skeleton (E3.1): single-instance lock, session hardening,
 * main-window creation. Tray, close-to-tray, and window-bounds persistence
 * land in E17.x.
 */
export function startApp(): void {
  // Must precede the single-instance lock: the lock is keyed on the
  // user-data directory, so an overridden test instance never collides
  // with a regular installation.
  const userDataDirOverride = resolveUserDataDirOverride(process.env);
  if (userDataDirOverride !== undefined) {
    app.setPath('userData', userDataDirOverride);
  }

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  // Set by electron-vite in dev mode; absent in the packaged app.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  const devServerOrigin = devServerUrl === undefined ? undefined : new URL(devServerUrl).origin;

  // After the user-data override so the log directory follows it (ADR-030:
  // file target <userData>/logs, console in dev only).
  initializeLogging({
    logDirectory: join(app.getPath('userData'), 'logs'),
    level: resolveLogLevel(process.argv, process.env),
    enableConsole: devServerUrl !== undefined,
  });
  const logger = createLogger('app');

  // Last-resort handlers, installed as early as logging permits (§8.3);
  // the sliver before initializeLogging keeps the default fatal handling.
  installMainErrorCapture(process, createLogger('main'));

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
    // Storage first (ADR-023): the single database opens and migrates before
    // any command that could touch it is registered. Open failures are
    // environment-level (corruption is recovered inside openDatabase) and a
    // downgrade must never touch the data — without storage the app cannot
    // run, so both quit deliberately instead of limping on.
    let database: StorageDatabase | undefined;
    try {
      database = openDatabase(
        join(app.getPath('userData'), 'tactics.db'),
        createLogger('storage'),
      ).database;
      database.migrate(loadBundledMigrations());
    } catch (error) {
      logger.error('Storage initialization failed — quitting', { error: describeError(error) });
      // A migration refusal (e.g. SchemaDowngradeError) leaves an open
      // handle on a database that must stay untouched — close it cleanly.
      database?.close();
      app.quit();
      return;
    }
    const storage = database;
    app.on('will-quit', () => {
      storage.close();
    });
    const settingsRepository = createSettingsRepository(storage, createLogger('settings'));
    const eventPublisher = createAppEventPublisher();

    // Registered before any window exists, so no invoke can precede them.
    const commandDeps = createElectronCommandDeps(createLogger('ipc'));
    registerAppCommands(commandDeps, createLogger('renderer'), {
      getSettings: () => settingsRepository.getSettings(),
    });
    registerLogsCommands(commandDeps, createElectronLogsDeps());
    registerSettingsCommands(commandDeps, {
      updateSettings: (partial) => settingsRepository.updateSettings(partial),
      publisher: eventPublisher,
    });

    hardenSession(devServerUrl !== undefined);

    mainWindow = createMainWindow({
      preloadPath: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      rendererHtmlPath: fileURLToPath(new URL('../renderer/index.html', import.meta.url)),
      devServerUrl,
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    // Lifecycle milestone (03-technical-design.md §8.1).
    logger.info('App started', { version: app.getVersion() });
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
