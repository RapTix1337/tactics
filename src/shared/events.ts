import { defineEvent } from './contract';
import { gameStateSchema } from './game-state';
import { settingsSchema } from './settings';
import { updateStateSchema } from './update-state';

/**
 * `evt:gameState.changed` (03-technical-design.md §5.4, 04-data-flow.md §2):
 * the full new gameState slice — status plus the map already resolved in
 * main. Published on every relevant change the gsi state machine reports
 * (change filtering, 02-architecture.md §4.2); raw payloads never cross IPC.
 */
export const gameStateChanged = defineEvent('gameState', gameStateSchema);

/**
 * `evt:settings.changed` (03-technical-design.md §5.4): always the full new
 * settings state, published by main after every successful mutation
 * (`settings.update`, `steam.pickCs2Path`).
 */
export const settingsChanged = defineEvent('settings', settingsSchema);

/**
 * `evt:update.changed` (03-technical-design.md §5.4, REL-02): the full new
 * update state on every relevant transition of the `updates` module — the
 * results of `updates.check` and the periodic checks arrive here.
 */
export const updateChanged = defineEvent('update', updateStateSchema);

/**
 * The contract's event definitions, keyed by domain — the counterpart of
 * `ContractCommandDefinitions`; each entry pairs a domain with its
 * `defineEvent` definition.
 */
export interface ContractEventDefinitions {
  gameState: typeof gameStateChanged;
  settings: typeof settingsChanged;
  update: typeof updateChanged;
}
