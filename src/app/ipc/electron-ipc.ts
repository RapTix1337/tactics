import { join } from 'node:path';

import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, shell } from 'electron';

import { exportLogs, getLogDirectory } from '../../modules/logging';
import type { Logger } from '../../shared';
import type { EventPublisher } from './event-publisher';
import { createEventPublisher } from './event-publisher';
import type { LogsCommandDeps } from './logs-commands';
import type { CommandRegistrationDeps } from './register-command';

/**
 * The Electron-backed dependencies for the testable IPC core — thin wiring
 * only (the main-window.ts pattern); everything with logic lives in
 * register-command.ts / event-publisher.ts.
 */

/**
 * ADR-025 sender check: own windows only. DevTools' own webContents (and any
 * other window-less contents) resolve to no BrowserWindow and are rejected;
 * code typed into the DevTools console runs in the page context of an app
 * window and is therefore indistinguishable from the renderer — accepted.
 */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  return BrowserWindow.fromWebContents(event.sender) !== null;
}

export function createElectronCommandDeps(
  logger: Logger,
): CommandRegistrationDeps<IpcMainInvokeEvent> {
  return {
    registerHandler: (channel, listener): void => {
      ipcMain.handle(channel, listener);
    },
    isTrustedSender,
    logger,
  };
}

/** The Electron-backed log command dependencies (E6.3). */
export function createElectronLogsDeps(): LogsCommandDeps {
  return {
    getLogDirectory,
    openPath: (path): Promise<string> => shell.openPath(path),
    showSaveDialog: async (defaultFileName): Promise<string | undefined> => {
      const options = {
        title: 'Export logs',
        defaultPath: join(app.getPath('downloads'), defaultFileName),
        filters: [{ name: 'Log files', extensions: ['log'] }],
      };
      // Modal to the app window when one is focused; detached otherwise.
      const window = BrowserWindow.getFocusedWindow();
      const result =
        window === null
          ? await dialog.showSaveDialog(options)
          : await dialog.showSaveDialog(window, options);
      return result.canceled || result.filePath === '' ? undefined : result.filePath;
    },
    exportLogs,
  };
}

/** Publishes to every open app window (03-technical-design.md §5.4). */
export function createAppEventPublisher(): EventPublisher {
  return createEventPublisher(() =>
    BrowserWindow.getAllWindows().map((window) => window.webContents),
  );
}
