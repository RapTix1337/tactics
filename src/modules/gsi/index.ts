/**
 * The gsi module surface (03-technical-design.md §4.2) — deferred since
 * E10.2 until the first external consumer, which is the E10.6 app wiring.
 * `app` hands in everything the module must not know itself: the cfg
 * directory (from `steam`), port and auth token (from operational state).
 */
export { type GsiConfigVerifyResult, verifyConfig, writeConfig } from './adapters/config-file';
export {
  createGsiIntakeServer,
  DEFAULT_GSI_PORT,
  type GsiIntakeServer,
  type GsiIntakeStartResult,
} from './adapters/http-intake';
export {
  createRegExeConfigLocationRecorder,
  type GsiConfigLocationRecorder,
} from './adapters/windows/config-location-registry';
export { generateConfigContent, GSI_CONFIG_FILE_NAME } from './core/config-content';
export type { GsiPayloadSubset } from './core/payload-schema';
export {
  createGsiStatusMachine,
  type GsiState,
  type GsiStatus,
  type GsiStatusMachine,
  type StaleScheduler,
} from './core/status-state-machine';
