import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  app,
  type BrowserWindow,
  Menu,
  nativeImage,
  net,
  protocol,
  screen,
  session,
  shell,
  Tray,
} from 'electron';

import { createGsiIntakeServer, createRegExeConfigLocationRecorder } from '../../modules/gsi';
import { createLogger, initializeLogging, resolveLogLevel } from '../../modules/logging';
import {
  createMapRegistry,
  createProfileImageStore,
  createProfileRepository,
} from '../../modules/maps';
import { createOperationalStateRepository, createSettingsRepository } from '../../modules/settings';
import { createRegExeReader } from '../../modules/steam';
import type { StorageDatabase } from '../../modules/storage';
import { openDatabase } from '../../modules/storage';
import type { UpdaterPort } from '../../modules/updates';
import { createElectronUpdaterPort, createUpdateService } from '../../modules/updates';
import { APP_NAME, gameStateChanged, scoreboardChanged, updateChanged } from '../../shared';
import { registerAppCommands } from '../ipc/app-commands';
import {
  createAppEventPublisher,
  createElectronCommandDeps,
  createElectronLogsDeps,
  createElectronMapsImageDialog,
  createElectronSteamDeps,
} from '../ipc/electron-ipc';
import { registerGsiCommands, runStartupConfigVerify } from '../ipc/gsi-commands';
import { registerLogsCommands } from '../ipc/logs-commands';
import { registerMapsCommands } from '../ipc/maps-commands';
import { describeError } from '../ipc/register-command';
import { registerSettingsCommands } from '../ipc/settings-commands';
import { registerSteamCommands } from '../ipc/steam-commands';
import { registerUpdatesCommands } from '../ipc/updates-commands';
import { loadBundledMigrations } from '../wiring/bundled-migrations';
import { createGameStateWiring } from '../wiring/game-state-wiring';
import { createGsiWiring } from '../wiring/gsi-wiring';
import { createScoreboardWiring } from '../wiring/scoreboard-wiring';
import type { LoginItemsPort } from './autostart';
import { syncAutostart } from './autostart';
import {
  resolveGsiPortOverride,
  resolveUpdatesDisabled,
  resolveUserDataDirOverride,
} from './env-overrides';
import { installMainErrorCapture } from './error-capture';
import { createMainWindow } from './main-window';
import { createMapImageProtocolHandler, MAP_IMAGE_PROTOCOL_SCHEME } from './map-image-protocol';
import { DEV_CONTENT_SECURITY_POLICY, shouldAllowNavigation } from './security-policy';
import { buildTrayMenuTemplate, resolveAppIconPath, resolveWindowsClosedAction } from './tray';
import { createWindowBoundsTracker, planBoundsRestore } from './window-bounds';

/**
 * App lifecycle (E3.1/E17.1/E17.2/E17.3): single-instance lock, session
 * hardening, main-window creation with bounds restore, tray, close-to-tray,
 * and autostart.
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

  // The read-only map-image protocol (ADR-045, E22.2). Privileges must be
  // locked in before app ready; `standard`/`secure` make the renderer treat
  // image URLs like regular secure content. The handler is attached after
  // ready, below.
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MAP_IMAGE_PROTOCOL_SCHEME,
      privileges: { standard: true, secure: true, stream: true },
    },
  ]);

  let mainWindow: BrowserWindow | null = null;
  // Held at startApp scope: Electron's Tray disappears once the instance is
  // garbage-collected, so the reference must outlive the whenReady callback.
  let tray: Tray | null = null;

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
    const operationalStateRepository = createOperationalStateRepository(
      storage,
      createLogger('settings'),
    );
    const eventPublisher = createAppEventPublisher();

    // E17.2: the OS login-item state follows the autostart setting (per-user,
    // no admin — GSI-08). Real writes only in the packaged build: in dev and
    // E2E the executable is the Electron dev binary, which must never land in
    // the OS autostart. The startup call reconciles outside drift (e.g. a
    // manually removed registry entry); syncAutostart itself is idempotent.
    const loginItems: LoginItemsPort = {
      getOpenAtLogin: () => app.getLoginItemSettings().openAtLogin,
      setOpenAtLogin: (openAtLogin) => {
        app.setLoginItemSettings({ openAtLogin });
      },
    };
    const applyAutostart = (autostart: boolean): void => {
      if (app.isPackaged) {
        syncAutostart(loginItems, autostart);
      } else {
        logger.debug('Autostart sync skipped (unpackaged build)', { autostart });
      }
    };
    applyAutostart(settingsRepository.getSettings().autostart);

    // E18.1: the updates module behind its port (REL-02). electron-updater
    // only works packaged (it reads the app-update.yml electron-builder
    // bakes in), so dev and E2E get a no-op port — state stays idle, zero
    // network, and the real check chain is verified in E19.3. Test mode
    // (E20.1) forces the no-op explicitly so "no network" stays guaranteed
    // once the E2E suite exercises the packaged app.
    const updatesLogger = createLogger('updates');
    const updatesDisabled = resolveUpdatesDisabled(process.env);
    const updaterPort: UpdaterPort =
      app.isPackaged && !updatesDisabled
        ? createElectronUpdaterPort(updatesLogger)
        : {
            checkForUpdates: (): void => {
              updatesLogger.debug('Update check skipped (unpackaged build or disabled)', {
                updatesDisabled,
              });
            },
            quitAndInstall: (): void => undefined,
            onEvent: (): (() => void) => () => undefined,
          };
    const updateService = createUpdateService({
      updater: updaterPort,
      scheduler: {
        schedule: (callback, delayMs): (() => void) => {
          const timer = setTimeout(callback, delayMs);
          return () => clearTimeout(timer);
        },
      },
      isAutoUpdateEnabled: () => settingsRepository.getSettings().autoUpdate,
      logger: updatesLogger,
    });
    updateService.onStateChanged((state) => {
      eventPublisher.publish(updateChanged, state);
    });
    updateService.start();
    app.on('will-quit', () => {
      updateService.dispose();
    });

    const gsiLogger = createLogger('gsi');
    // One resolution for both wirings: intake and written config must share
    // the same port expectation (E20.1 test mode).
    const gsiPortOverride = resolveGsiPortOverride(process.env);
    const gsiWiring = createGsiWiring({
      getSettings: () => settingsRepository.getSettings(),
      getOperationalState: () => operationalStateRepository.getOperationalState(),
      registry: createRegExeReader(),
      steamLogger: createLogger('steam'),
      configLocationRecorder: createRegExeConfigLocationRecorder(),
      gsiPortOverride,
    });
    // Bundled map data (§4.3): repo root in dev; extraResources next to the
    // packaged app — the copy step itself is E19.1 ("maps data all resolve").
    const mapRegistry = createMapRegistry({
      dataDirectory: app.isPackaged
        ? join(process.resourcesPath, 'data', 'maps')
        : join(app.getAppPath(), 'data', 'maps'),
      logger: createLogger('maps'),
    });
    // The app-managed image directory (`<userData>/maps/<mapId>/<file>`):
    // written only through the store; the renderer reads it exclusively over
    // the protocol registered here (ADR-045).
    const profileImageStore = createProfileImageStore({
      imagesDirectory: join(app.getPath('userData'), 'maps'),
      logger: createLogger('maps'),
    });
    // Profile persistence (E22.1) — the storage handle satisfies the maps
    // module's structural port as-is (ADR-040 pattern, like settings).
    const profileRepository = createProfileRepository(storage, createLogger('maps'));
    protocol.handle(
      MAP_IMAGE_PROTOCOL_SCHEME,
      createMapImageProtocolHandler({
        resolveImagePath: (mapId, fileName) => profileImageStore.resolveImagePath(mapId, fileName),
        fetchFile: (absolutePath) => net.fetch(pathToFileURL(absolutePath).toString()),
      }),
    );
    // SCB.7: the scoreboard pipeline shares the intake's payload stream —
    // created before the game-state wiring so its intake callback can tee.
    const scoreboardWiring = createScoreboardWiring({
      statusMachine: gsiWiring.statusMachine,
      publish: (state) => eventPublisher.publish(scoreboardChanged, state),
      logger: createLogger('scoreboard'),
    });
    const gameStateWiring = createGameStateWiring({
      statusMachine: gsiWiring.statusMachine,
      createIntake: (onPayload) =>
        createGsiIntakeServer({
          logger: gsiLogger,
          onPayload: (payload) => {
            // Status machine first: waiting→connected must be committed
            // before the engine consumes the same payload.
            onPayload(payload);
            scoreboardWiring.handlePayload(payload);
          },
        }),
      resolveGsiMapName: (rawName) => mapRegistry.resolveGsiMapName(rawName),
      publish: (state) => eventPublisher.publish(gameStateChanged, state),
      getSettings: () => settingsRepository.getSettings(),
      getOperationalState: () => operationalStateRepository.getOperationalState(),
      gsiPortOverride,
      persistEffectivePort: (port) => {
        operationalStateRepository.updateOperationalState({ effectiveGsiPort: port });
      },
      verifyConfigAgainstCurrent: () => runStartupConfigVerify(gsiWiring.commandDeps, gsiLogger),
      logger: gsiLogger,
    });
    app.on('will-quit', () => {
      scoreboardWiring.dispose();
      gsiWiring.statusMachine.dispose();
      // Best-effort: quit must not wait on socket teardown — the process
      // exit closes the listener either way.
      void gameStateWiring.stop();
    });

    // Registered before any window exists, so no invoke can precede them.
    const commandDeps = createElectronCommandDeps(createLogger('ipc'));
    registerAppCommands(
      commandDeps,
      createLogger('renderer'),
      {
        getGameState: () => gameStateWiring.getGameState(),
        getScoreboardState: () => scoreboardWiring.getScoreboardState(),
        getSettings: () => settingsRepository.getSettings(),
        getUpdateState: () => updateService.getState(),
      },
      // Only contract-allowlisted URLs reach this (the request schema).
      { openExternal: (url) => shell.openExternal(url) },
    );
    registerLogsCommands(commandDeps, createElectronLogsDeps());
    registerSettingsCommands(commandDeps, {
      updateSettings: (partial) => {
        const next = settingsRepository.updateSettings(partial);
        // A gsiPort change must rebind the intake (05-gsi.md error case 3);
        // fire-and-forget — the response must not wait on the restart.
        void gameStateWiring.handleSettingsChanged();
        // E17.2: an autostart toggle registers/deregisters immediately.
        applyAutostart(next.autostart);
        // E18.1: an autoUpdate toggle starts/stops the periodic check cycle.
        updateService.handleSettingsChanged();
        return next;
      },
      publisher: eventPublisher,
    });
    registerSteamCommands(
      commandDeps,
      createElectronSteamDeps({
        updateSettings: (partial) => settingsRepository.updateSettings(partial),
        publisher: eventPublisher,
      }),
    );
    registerGsiCommands(commandDeps, gsiWiring.commandDeps);
    registerUpdatesCommands(commandDeps, {
      checkNow: () => updateService.checkNow(),
      quitAndInstall: () => updateService.quitAndInstall(),
    });

    // Maps before intake: the first payload may already need resolution.
    // Fire-and-forget like the verify below — the window must not wait on fs
    // scans or the port bind; early snapshots simply carry map "none".
    const mapsLoaded = mapRegistry.loadAll();
    void mapsLoaded
      .then(() => gameStateWiring.start())
      .catch((error: unknown) => {
        logger.error('Starting the live state pipeline failed', {
          error: describeError(error),
        });
      });
    registerMapsCommands(commandDeps, {
      // loadAll degrades scan errors to warnings and never rejects by design;
      // the catch keeps a violated assumption from failing every maps command.
      mapsLoaded: mapsLoaded.catch(() => undefined),
      listMaps: () => mapRegistry.listMaps(),
      getMap: (mapId) => mapRegistry.getMap(mapId),
      profiles: profileRepository,
      images: profileImageStore,
      showImageOpenDialog: createElectronMapsImageDialog(),
    });

    // Fire-and-forget by design (never throws): the window must not wait on
    // reg.exe + fs probing; the machine state is consumed via the gameState
    // events published by gameStateWiring.
    void runStartupConfigVerify(gsiWiring.commandDeps, gsiLogger);

    hardenSession(devServerUrl !== undefined);

    // Multi-size icon.ico shared by the window/taskbar icon and the tray. In
    // dev it reads the repo `build/` folder; packaged it reads the resource
    // copied via electron-builder `extraResources`. Same resolution as the
    // bundled map data above.
    const appIconPath = resolveAppIconPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    });

    // Shows the existing window or recreates it after close-to-tray. A
    // recreated renderer re-runs the snapshot bootstrap on its own (E5.4);
    // main-process state lives on while no window exists (ADR-020/022).
    const openMainWindow = (): void => {
      if (mainWindow !== null) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
        return;
      }
      // E17.3: reopen where the user left the window, clamped to the
      // displays present right now (a monitor may be gone since then).
      // Primary first — getAllDisplays guarantees no order, but the
      // planner falls back to the first work area on zero overlap.
      const primaryDisplay = screen.getPrimaryDisplay();
      const workAreas = [
        primaryDisplay,
        ...screen.getAllDisplays().filter((display) => display.id !== primaryDisplay.id),
      ].map((display) => display.workArea);
      mainWindow = createMainWindow({
        preloadPath: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
        rendererHtmlPath: fileURLToPath(new URL('../renderer/index.html', import.meta.url)),
        devServerUrl,
        iconPath: appIconPath,
        restorePlan: planBoundsRestore(
          operationalStateRepository.getOperationalState().windowBounds,
          workAreas,
        ),
      });
      const boundsTracker = createWindowBoundsTracker({
        window: mainWindow,
        persist: (bounds) => {
          operationalStateRepository.updateOperationalState({ windowBounds: bounds });
        },
        logger,
      });
      mainWindow.on('move', boundsTracker.scheduleSave);
      mainWindow.on('resize', boundsTracker.scheduleSave);
      mainWindow.on('maximize', boundsTracker.scheduleSave);
      mainWindow.on('unmaximize', boundsTracker.scheduleSave);
      // `close` precedes destruction: the final placement is still readable
      // and lands in storage before will-quit closes the database.
      mainWindow.on('close', boundsTracker.flush);
      mainWindow.on('closed', () => {
        mainWindow = null;
      });
    };

    // Launching the app again while it sits in the tray is the natural
    // reopen path, so `second-instance` shows or recreates the window.
    // Registered after ready: a window can only exist from here on.
    app.on('second-instance', openMainWindow);

    // E17.1: closing the last window quits only when close-to-tray is off.
    // The setting is read per event, so a settings change applies to the
    // next close without a restart. Quit paths (tray menu, app.quit())
    // skip `window-all-closed` entirely, so quit always works.
    app.on('window-all-closed', () => {
      if (resolveWindowsClosedAction(settingsRepository.getSettings().closeToTray) === 'quit') {
        app.quit();
      }
    });

    // Windows picks the 16/32 frame from the multi-size icon.ico for the tray.
    tray = new Tray(nativeImage.createFromPath(appIconPath));
    tray.setToolTip(APP_NAME);
    tray.setContextMenu(
      Menu.buildFromTemplate(
        buildTrayMenuTemplate({
          showWindow: openMainWindow,
          hideWindow: () => mainWindow?.hide(),
          quit: () => {
            app.quit();
          },
        }),
      ),
    );
    tray.on('click', openMainWindow);

    openMainWindow();

    // Lifecycle milestone (03-technical-design.md §8.1).
    logger.info('App started', { version: app.getVersion() });
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
