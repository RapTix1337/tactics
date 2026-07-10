import {
  DEFAULT_GSI_PORT,
  type GsiIntakeServer,
  type GsiPayloadSubset,
  type GsiState,
  type GsiStatusMachine,
} from '../../modules/gsi';
import type { OperationalState } from '../../modules/settings';
import type { GameState, GameStateMap, Logger, Settings } from '../../shared';
import { describeError } from '../ipc/register-command';

/**
 * The E10.7 live state pipeline (04-data-flow.md §2, composition only): the
 * intake feeds the shared status machine; on every relevant change the raw
 * map name is resolved via the maps registry and the full new gameState
 * slice is published as `evt:gameState.changed`. Also owns the intake
 * server's lifecycle: start with port/token from settings/operational state,
 * restart on a `gsiPort` settings change, stop on quit.
 */

export interface GameStateWiringOptions {
  /** The main process' single machine instance (created by createGsiWiring). */
  readonly statusMachine: GsiStatusMachine;
  /** Builds the intake whose payloads feed this pipeline (real server in prod). */
  readonly createIntake: (onPayload: (payload: GsiPayloadSubset) => void) => GsiIntakeServer;
  /** The maps registry's exact-match resolution; `undefined` = unsupported. */
  readonly resolveGsiMapName: (rawName: string) => string | undefined;
  /** Publishes `evt:gameState.changed` to all windows. */
  readonly publish: (state: GameState) => void;
  readonly getSettings: () => Settings;
  readonly getOperationalState: () => OperationalState;
  /**
   * Test-mode port override (`TACTICS_GSI_PORT`, E20.1): wins over settings
   * and operational state so E2E runs get a deterministic port. Must match
   * the override handed to `createGsiWiring` — both sides share the same
   * resolution rule.
   */
  readonly gsiPortOverride?: number;
  /** Persists the port the server actually bound (E10.6 reads it for the config). */
  readonly persistEffectivePort: (port: number) => void;
  /**
   * Re-checks the written GSI config against the current expectation after
   * the effective port changed (a rebind makes it outdated → repair-needed;
   * maintainer decision in this session). `runStartupConfigVerify` in prod.
   */
  readonly verifyConfigAgainstCurrent: () => Promise<void>;
  readonly logger: Logger;
}

export interface GameStateWiring {
  /** The current slice for `app.getSnapshot` — derived, never cached. */
  readonly getGameState: () => GameState;
  /** Starts the intake with the current port/token; safe to call once. */
  readonly start: () => Promise<void>;
  /** Reacts to a settings change: restarts the intake when the port changed. */
  readonly handleSettingsChanged: () => Promise<void>;
  /** Stops the intake and detaches from the machine; idempotent. */
  readonly stop: () => Promise<void>;
}

export function createGameStateWiring(options: GameStateWiringOptions): GameStateWiring {
  const { statusMachine, resolveGsiMapName, logger } = options;
  const intake = options.createIntake((payload) => {
    statusMachine.handlePayload(payload);
  });

  function toGameState(state: GsiState): GameState {
    return { status: state.status, map: toGameStateMap(state.mapName) };
  }

  function toGameStateMap(rawName: string | null): GameStateMap {
    if (rawName === null) {
      return { kind: 'none' };
    }
    const mapId = resolveGsiMapName(rawName);
    // Unknown map: the informative unsupported state (MVP-09, error case 7).
    return mapId === undefined ? { kind: 'unsupported', rawName } : { kind: 'resolved', mapId };
  }

  const unsubscribe = statusMachine.onStateChanged((state) => {
    options.publish(toGameState(state));
  });

  // The port the intake starts its fallback chain from — the same resolution
  // rule as the config side (getSetupPort, E10.6), so server and written
  // config agree whenever possible.
  function desiredPort(): number {
    return (
      options.gsiPortOverride ??
      options.getSettings().gsiPort ??
      options.getOperationalState().effectiveGsiPort ??
      DEFAULT_GSI_PORT
    );
  }

  let running = false;
  let disposed = false;
  let activeDesiredPort: number | null = null;
  // Start/stop transitions are serialized: a burst of settings updates must
  // never overlap a restart with another (the intake forbids
  // start-while-running). Every step is caught, so the chain never sticks
  // in a rejected state and later transitions still run.
  let transitions: Promise<void> = Promise.resolve();

  function enqueue(step: () => Promise<void>): Promise<void> {
    transitions = transitions.then(async () => {
      try {
        await step();
      } catch (error) {
        logger.error('GSI intake lifecycle transition failed', { error: describeError(error) });
      }
    });
    return transitions;
  }

  async function startIntake(): Promise<void> {
    // After stop the machine listener is detached — a rebind would produce
    // a silent pipeline, so a stopped wiring never starts again.
    if (disposed) {
      return;
    }
    const port = desiredPort();
    activeDesiredPort = port;
    const result = await intake.start(port, options.getOperationalState().gsiToken);
    if (!result.ok) {
      // Error case 3, chain exhausted: manual configuration required — the
      // status badge/diagnostics surface it (E15.1); nothing to transition.
      logger.error('GSI intake could not bind any port of the fallback chain', {
        firstPort: port,
      });
      return;
    }
    running = true;
    logger.info('GSI intake listening', { port: result.port });
    syncEffectivePort(result.port);
  }

  function syncEffectivePort(boundPort: number): void {
    if (options.getOperationalState().effectiveGsiPort === boundPort) {
      return;
    }
    try {
      options.persistEffectivePort(boundPort);
    } catch (error) {
      // The pipeline must survive a persistence hiccup; the config side then
      // works with the previous port until the next successful sync.
      logger.error('Persisting the effective GSI port failed', {
        port: boundPort,
        error: describeError(error),
      });
      return;
    }
    // The bound port changed, so a previously written config announces a
    // stale port now — re-verify so the machine flips to repair-needed
    // instead of silently waiting on the wrong port (05-gsi.md §7 case 1/3).
    void options.verifyConfigAgainstCurrent();
  }

  return {
    getGameState: (): GameState => toGameState(statusMachine.getState()),

    start: (): Promise<void> => enqueue(startIntake),

    handleSettingsChanged: (): Promise<void> =>
      enqueue(async () => {
        if (disposed || desiredPort() === activeDesiredPort) {
          return;
        }
        // Also the recovery path for an exhausted fallback chain (error
        // case 3, "manually fixable in settings"): a not-running intake is
        // simply started on the newly desired port.
        if (running) {
          await intake.stop();
          running = false;
        }
        await startIntake();
      }),

    stop: (): Promise<void> =>
      enqueue(async () => {
        disposed = true;
        unsubscribe();
        await intake.stop();
        running = false;
      }),
  };
}
