import type { GsiPayloadSubset, GsiStatusMachine } from '../../modules/gsi';
import type { LiveMatchInput } from '../../modules/scoreboard';
import { createScoreboardEngine } from '../../modules/scoreboard';
import type { Logger, ScoreboardState } from '../../shared';

/**
 * The SCB.7 scoreboard pipeline (live-scoreboard 02-design.md §2.3,
 * composition only): every validated payload is mapped onto the scoreboard
 * module's own input model — the ADR-021 boundary price, paid once here —
 * and fed to the engine; gsi status transitions away from `connected`
 * (stale, repair) end the match context. The engine's structural change
 * filtering decides what crosses the IPC boundary as
 * `evt:scoreboard.changed` (02-architecture §4.2).
 */

export interface ScoreboardWiringOptions {
  /** Only the subscription is needed — narrowed for testability. */
  readonly statusMachine: Pick<GsiStatusMachine, 'onStateChanged'>;
  /** Publishes `evt:scoreboard.changed` to all windows. */
  readonly publish: (state: ScoreboardState) => void;
  readonly logger: Logger;
}

export interface ScoreboardWiring {
  /** Feeds one validated payload (called from the intake pipeline). */
  readonly handlePayload: (payload: GsiPayloadSubset) => void;
  /** The current slice for `app.getSnapshot` — derived, never cached. */
  readonly getScoreboardState: () => ScoreboardState;
  /** Detaches from the machine and stops the engine; idempotent. */
  readonly dispose: () => void;
}

export function createScoreboardWiring(options: ScoreboardWiringOptions): ScoreboardWiring {
  const engine = createScoreboardEngine({ logger: options.logger });
  const unsubscribeEngine = engine.onStateChanged((state) => {
    options.publish(state);
  });
  // Menus deactivate through the payloads themselves (no `map` section);
  // this covers the payload-less endings: stale timeout and config loss.
  const unsubscribeMachine = options.statusMachine.onStateChanged((state) => {
    if (state.status !== 'connected') {
      engine.notifyGsiInactive();
    }
  });

  return {
    handlePayload: (payload): void => {
      engine.handleInput(toLiveMatchInput(payload));
    },
    getScoreboardState: (): ScoreboardState => engine.getState(),
    dispose: (): void => {
      unsubscribeMachine();
      unsubscribeEngine();
      engine.dispose();
    },
  };
}

/**
 * The near-identity mapping onto the module's input model. The section
 * shapes are structurally identical by design (SCB.2/SCB.5), so only the
 * top level is picked — `providerTimestamp` stays behind (heartbeat
 * context, not scoreboard data).
 */
function toLiveMatchInput(payload: GsiPayloadSubset): LiveMatchInput {
  return {
    mapName: payload.mapName,
    providerSteamId: payload.providerSteamId,
    map: payload.map,
    round: payload.round,
    player: payload.player,
  };
}
