export {
  createOperationalStateRepository,
  type OperationalStateRepository,
} from './adapters/operational-state-repository';
export {
  createSettingsRepository,
  type SettingsRepository,
  type SettingsStoragePort,
} from './adapters/settings-repository';
export {
  type OperationalState,
  type OperationalStateUpdate,
  type WindowBounds,
} from './core/operational-state-schema';
// The Settings type and its field schemas are contract-owned and live in
// `shared/settings.ts` (E8.3) — consumers import them from there.
export { SETTINGS_DEFAULTS } from './core/settings-schema';
