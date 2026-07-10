import type { UpdateDownloadedEvent, UpdateInfo } from 'electron-updater';
import electronUpdater from 'electron-updater';

import type { Logger } from '../../../shared';
import type { UpdaterEvent, UpdaterPort } from '../core/update-service';

/**
 * Wraps electron-updater's `autoUpdater` as the module's `UpdaterPort` (thin
 * untested wiring around the tested core — the E3.1 pattern). The GitHub
 * Releases provider comes from electron-builder's publish configuration
 * baked into the packaged app (ADR-027, E19.1/E19.3); electron-updater only
 * works there, so the composition root wires this port packaged-only.
 */
export function createElectronUpdaterPort(logger: Logger): UpdaterPort {
  // electron-updater is CJS — the default-import destructure is its
  // documented ESM consumption form.
  const { autoUpdater } = electronUpdater;
  // §4.7: download when available, install on quit (or on user command).
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Internal updater chatter lands in our log under the module scope;
  // its info level is verbose by design, so it maps to debug.
  autoUpdater.logger = {
    debug: (message: string) => logger.debug(message),
    info: (message: unknown) => logger.debug(String(message)),
    warn: (message: unknown) => logger.warn(String(message)),
    error: (message: unknown) => logger.error(String(message)),
  };

  return {
    checkForUpdates: (): void => {
      // Failures surface as 'error' events on the emitter; the catch only
      // silences the duplicate rejection of the returned promise.
      void autoUpdater.checkForUpdates().catch(() => undefined);
    },

    quitAndInstall: (): void => {
      autoUpdater.quitAndInstall();
    },

    onEvent: (listener: (event: UpdaterEvent) => void): (() => void) => {
      const onChecking = (): void => listener({ kind: 'checking' });
      const onAvailable = (info: UpdateInfo): void =>
        listener({ kind: 'available', version: info.version });
      const onNotAvailable = (): void => listener({ kind: 'not-available' });
      const onProgress = (): void => listener({ kind: 'downloading' });
      const onDownloaded = (event: UpdateDownloadedEvent): void =>
        listener({ kind: 'ready', version: event.version });
      const onError = (error: Error): void => listener({ kind: 'error', message: error.message });

      autoUpdater.on('checking-for-update', onChecking);
      autoUpdater.on('update-available', onAvailable);
      autoUpdater.on('update-not-available', onNotAvailable);
      autoUpdater.on('download-progress', onProgress);
      autoUpdater.on('update-downloaded', onDownloaded);
      autoUpdater.on('error', onError);

      return () => {
        autoUpdater.off('checking-for-update', onChecking);
        autoUpdater.off('update-available', onAvailable);
        autoUpdater.off('update-not-available', onNotAvailable);
        autoUpdater.off('download-progress', onProgress);
        autoUpdater.off('update-downloaded', onDownloaded);
        autoUpdater.off('error', onError);
      };
    },
  };
}
