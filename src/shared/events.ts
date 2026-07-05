import { defineEvent } from './contract';
import { settingsSchema } from './settings';

/**
 * `evt:settings.changed` (03-technical-design.md §5.4): always the full new
 * settings state, published by main after every successful mutation
 * (`settings.update`; `steam.pickCs2Path` joins with E9.3).
 */
export const settingsChanged = defineEvent('settings', settingsSchema);

/**
 * The contract's event definitions, keyed by domain — the counterpart of
 * `ContractCommandDefinitions`. Grows with the owning tasks (gameState
 * E10.7, updates E18.1); each entry pairs a domain with its `defineEvent`
 * definition.
 */
export interface ContractEventDefinitions {
  settings: typeof settingsChanged;
}
