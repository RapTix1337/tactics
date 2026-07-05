import type { TacticsBridge } from '../../../shared/bridge';
import type { ContractCommandDefinitions } from '../../../shared/commands';
import type { CommandResponse } from '../../../shared/contract';

export type AppSnapshot = CommandResponse<ContractCommandDefinitions['app.getSnapshot']>;

/**
 * The wiring the bootstrap drives — implemented by wiring.ts, faked in
 * tests. Splitting it out keeps the sequence testable with synthetic
 * events although the contract has none yet.
 */
export interface IpcWiring {
  /** Subscribes every contract event; runs BEFORE the snapshot fetch. */
  readonly subscribeAll: (bridge: TacticsBridge) => void;
  /** Applies the snapshot, overwriting whatever an earlier event wrote. */
  readonly applySnapshot: (snapshot: AppSnapshot) => void;
  readonly onError: (message: string) => void;
}

/**
 * Startup sequence (04-data-flow.md §4, ADR-022): subscribe first, then
 * fetch the snapshot; the snapshot overwrites, later events win again —
 * slices are full states, so both directions converge. Runs once per
 * renderer context; a window reload creates a fresh context and
 * bootstraps again. Never rejects: every failure ends in wiring.onError.
 */
export async function bootstrapIpc(
  bridge: TacticsBridge | undefined,
  wiring: IpcWiring,
): Promise<void> {
  if (bridge === undefined) {
    wiring.onError('IPC bridge is not exposed on window');
    return;
  }
  try {
    wiring.subscribeAll(bridge);
    const result = await bridge.invoke('app.getSnapshot', undefined);
    if (result.ok) {
      wiring.applySnapshot(result.data);
    } else {
      wiring.onError(result.error.message);
    }
  } catch (error) {
    wiring.onError(error instanceof Error ? error.message : String(error));
  }
}
