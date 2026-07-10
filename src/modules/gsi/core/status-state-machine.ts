import type { GsiConnectionStatus } from '../../../shared';
import type { GsiPayloadSubset } from './payload-schema';

/**
 * The ADR-024 status state machine (transitions: 05-gsi.md §6.1) plus
 * "current raw map name or none", driven by validated payloads, config
 * verification results, and the ADR-031 stale timeout. Listeners fire only
 * on relevant change — the change filtering of 02-architecture.md §4.2:
 * CS2 posts several times per second, the derived state changes rarely,
 * and only real changes may cross the IPC boundary later (E10.7).
 */

/** Stale timeout: 3× the 10 s heartbeat interval (ADR-031). */
export const STALE_TIMEOUT_MS = 30_000;

/** The machine's statuses are the contract's (shared/game-state.ts, §5.4). */
export type GsiStatus = GsiConnectionStatus;

export interface GsiState {
  readonly status: GsiStatus;
  /** Raw map name from the last payload, or `null` when none is known. */
  readonly mapName: string | null;
}

/**
 * Timer port injected by the composition root (ADR-019: core stays free of
 * platform APIs — `setTimeout` is not part of the neutral ES lib).
 */
export interface StaleScheduler {
  /** Schedules `callback` once after `delayMs`; returns a cancel function. */
  schedule(callback: () => void, delayMs: number): () => void;
}

export interface GsiStatusMachine {
  /** Feeds a validated payload (any payload counts as a heartbeat). */
  handlePayload(payload: GsiPayloadSubset): void;
  /** Config verified ok or (re)written: not-set-up | repair-needed → waiting. */
  reportConfigValid(): void;
  /** Config missing/outdated: not-set-up | waiting | stale → repair-needed. */
  reportConfigInvalid(): void;
  getState(): GsiState;
  /** Subscribes to relevant-change notifications; returns an unsubscribe. */
  onStateChanged(listener: (state: GsiState) => void): () => void;
  /** Cancels any pending stale timeout; the machine stops transitioning. */
  dispose(): void;
}

export function createGsiStatusMachine(scheduler: StaleScheduler): GsiStatusMachine {
  let state: GsiState = { status: 'not-set-up', mapName: null };
  let cancelStaleTimer: (() => void) | null = null;
  let disposed = false;
  const listeners = new Set<(state: GsiState) => void>();

  function commit(next: GsiState): void {
    if (next.status === state.status && next.mapName === state.mapName) return;
    state = next;
    for (const listener of [...listeners]) listener(state);
  }

  function restartStaleTimer(): void {
    cancelStaleTimer?.();
    cancelStaleTimer = scheduler.schedule(() => {
      cancelStaleTimer = null;
      commit({ status: 'stale', mapName: null });
    }, STALE_TIMEOUT_MS);
  }

  return {
    handlePayload(payload: GsiPayloadSubset): void {
      if (disposed) return;
      // No payload-driven transitions out of not-set-up/repair-needed in
      // §6.1 — a stray config may still post, but it must not drive status.
      if (state.status !== 'waiting' && state.status !== 'connected' && state.status !== 'stale') {
        return;
      }
      restartStaleTimer();
      commit({ status: 'connected', mapName: payload.mapName });
    },

    reportConfigValid(): void {
      if (disposed) return;
      if (state.status === 'not-set-up' || state.status === 'repair-needed') {
        commit({ status: 'waiting', mapName: null });
      }
    },

    reportConfigInvalid(): void {
      if (disposed) return;
      // Not from connected: flowing data proves the config works (§6.1).
      if (state.status === 'not-set-up' || state.status === 'waiting' || state.status === 'stale') {
        commit({ status: 'repair-needed', mapName: null });
      }
    },

    getState(): GsiState {
      return state;
    },

    onStateChanged(listener: (state: GsiState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose(): void {
      disposed = true;
      cancelStaleTimer?.();
      cancelStaleTimer = null;
      listeners.clear();
    },
  };
}
