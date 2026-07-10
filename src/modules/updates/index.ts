/**
 * The updates module surface (03-technical-design.md §4.7) — `app` hands in
 * everything the module must not know itself: the auto-update setting, the
 * timer, and the updater port (the real electron-updater adapter packaged
 * only; dev runs on a no-op port).
 */
export { createElectronUpdaterPort } from './adapters/electron-updater-adapter';
export {
  classifyUpdaterError,
  createUpdateService,
  UPDATE_CHECK_INTERVAL_MS,
  type UpdaterEvent,
  type UpdaterPort,
  type UpdateScheduler,
  type UpdateService,
  type UpdateServiceOptions,
} from './core/update-service';
