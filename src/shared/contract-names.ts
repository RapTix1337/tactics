import type { ContractCommandDefinitions } from './commands';
import type { ContractEventDefinitions } from './events';

/**
 * Zod-free runtime projection of the contract's names, so the sandboxed
 * preload can build its closed channel maps without bundling the schemas
 * (validation is main-only, ADR-022; E5.1 watch item). `satisfies` pins
 * every listed name to a real definition; the reverse direction (every
 * definition is listed) is proven by the type test in
 * contract-names.test.ts. Grows in lockstep with commands.ts / events.ts.
 */
export const COMMAND_NAMES = [
  'app.getSnapshot',
  'app.openExternal',
  'app.reportRendererError',
  'gsi.getSetupPlan',
  'gsi.applySetup',
  'logs.openDirectory',
  'logs.export',
  'maps.list',
  'maps.getProfile',
  'maps.createProfile',
  'maps.replaceProfileImage',
  'maps.setDefaultProfile',
  'maps.renameProfile',
  'maps.deleteProfile',
  'maps.updateCallouts',
  'settings.update',
  'steam.pickCs2Path',
  'updates.check',
  'updates.install',
] as const satisfies readonly (keyof ContractCommandDefinitions)[];

export const EVENT_DOMAINS = [
  'gameState',
  'settings',
  'update',
] as const satisfies readonly (keyof ContractEventDefinitions)[];
