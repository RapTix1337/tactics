import { defineEvent } from './contract';
import { gameStateSchema } from './game-state';
import { overlayStateSchema } from './overlay-state';
import { scoreboardStateSchema } from './scoreboard-state';
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
 * `evt:scoreboard.changed` (live-scoreboard 02-design.md §3.1, ADR-052):
 * the full new scoreboard slice, published by the app wiring on every
 * structural change the scoreboard engine reports — its change filtering
 * keeps the frequent GSI posts off the IPC boundary (02-architecture §4.2).
 */
export const scoreboardChanged = defineEvent('scoreboard', scoreboardStateSchema);

/**
 * `evt:overlay.changed` (live-overlay 02-design.md §3.2, ADR-058): the full
 * overlay slice, published by the app wiring when the overlay window
 * manager's state changes — both close paths (live-page control, window ✕)
 * converge on this one event.
 */
export const overlayChanged = defineEvent('overlay', overlayStateSchema);

/**
 * The contract's event definitions, keyed by domain — the counterpart of
 * `ContractCommandDefinitions`; each entry pairs a domain with its
 * `defineEvent` definition.
 */
export interface ContractEventDefinitions {
  gameState: typeof gameStateChanged;
  overlay: typeof overlayChanged;
  scoreboard: typeof scoreboardChanged;
  settings: typeof settingsChanged;
  update: typeof updateChanged;
}
