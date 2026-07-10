import type { Logger, UpdateErrorKind, UpdateState } from '../../../shared';

/**
 * The updates module core (03-technical-design.md §4.7, REL-02/PRV-02): the
 * update state machine plus the check scheduling, both behind injected ports
 * (ADR-019) — the updater port is faked in tests, which is exactly how the
 * "disabled setting ⇒ zero network calls" acceptance criterion is proven.
 * `app` hands in the auto-update setting; the module never reads it itself.
 */

/**
 * Interval between periodic checks while auto-update is enabled
 * (maintainer decision E18.1 — the design fixes no value).
 */
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** The updater lifecycle as the adapter reports it (electron-updater's events, §2.5). */
export type UpdaterEvent =
  | { readonly kind: 'checking' }
  | { readonly kind: 'available'; readonly version: string }
  | { readonly kind: 'not-available' }
  | { readonly kind: 'downloading' }
  | { readonly kind: 'ready'; readonly version: string }
  | { readonly kind: 'error'; readonly message: string };

/** The module's door to electron-updater (real adapter in prod, fake in tests). */
export interface UpdaterPort {
  /** Starts one check-and-download cycle; results arrive via `onEvent`. */
  checkForUpdates(): void;
  /** Quits the app and installs the downloaded update. */
  quitAndInstall(): void;
  /** Subscribes to the updater's lifecycle events; returns an unsubscribe. */
  onEvent(listener: (event: UpdaterEvent) => void): () => void;
}

/**
 * Timer port injected by the composition root (ADR-019: core stays free of
 * platform APIs — the `StaleScheduler` precedent, gsi module).
 */
export interface UpdateScheduler {
  /** Schedules `callback` once after `delayMs`; returns a cancel function. */
  schedule(callback: () => void, delayMs: number): () => void;
}

export interface UpdateServiceOptions {
  readonly updater: UpdaterPort;
  readonly scheduler: UpdateScheduler;
  /** The auto-update setting, read per decision — a toggle applies immediately. */
  readonly isAutoUpdateEnabled: () => boolean;
  readonly logger: Logger;
}

export interface UpdateService {
  /** The current slice for `app.getSnapshot`. */
  getState(): UpdateState;
  /** Subscribes to relevant-change notifications; returns an unsubscribe. */
  onStateChanged(listener: (state: UpdateState) => void): () => void;
  /** Startup entry: begins check-now-plus-periodic when the setting is enabled. */
  start(): void;
  /** Reacts to a settings change: starts or stops the periodic cycle. */
  handleSettingsChanged(): void;
  /** Manual check; refused while the setting is disabled (PRV-02: zero network). */
  checkNow(): void;
  /** Installs the downloaded update; `false` when none is ready. */
  quitAndInstall(): boolean;
  /** Cancels the timer and detaches from the updater; the state freezes. */
  dispose(): void;
}

const IDLE_STATE: UpdateState = { status: 'idle', version: null, errorKind: null };

export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  const { updater, scheduler, logger } = options;
  let state = IDLE_STATE;
  let cancelTimer: (() => void) | null = null;
  let disposed = false;
  const listeners = new Set<(state: UpdateState) => void>();

  function commit(next: UpdateState): void {
    if (
      next.status === state.status &&
      next.version === state.version &&
      next.errorKind === state.errorKind
    ) {
      return;
    }
    state = next;
    for (const listener of [...listeners]) listener(state);
  }

  const unsubscribe = updater.onEvent((event) => {
    if (disposed) {
      return;
    }
    // Once downloaded the update installs on quit either way — nothing may
    // regress the state (e.g. a late updater error), so ready sticks.
    if (state.status === 'ready') {
      return;
    }
    switch (event.kind) {
      case 'checking':
        commit({ status: 'checking', version: null, errorKind: null });
        break;
      case 'available':
        commit({ status: 'available', version: event.version, errorKind: null });
        break;
      case 'not-available':
        commit(IDLE_STATE);
        break;
      case 'downloading':
        // No version of its own — progress events follow an `available`.
        commit({ status: 'downloading', version: state.version, errorKind: null });
        break;
      case 'ready':
        commit({ status: 'ready', version: event.version, errorKind: null });
        break;
      case 'error': {
        const errorKind = classifyUpdaterError(event.message);
        // Named, never fatal (§4.7): the raw text goes to the log only —
        // the state carries the class.
        logger.warn('Update check failed', { errorKind, error: event.message });
        commit({ status: 'error', version: null, errorKind });
        break;
      }
    }
  });

  function triggerCheck(reason: string): void {
    // idle and error are the resting states; anything else means a cycle is
    // already running (or done, for ready) — never stack checks.
    if (state.status !== 'idle' && state.status !== 'error') {
      logger.debug('Update check skipped — a cycle is in progress', {
        reason,
        status: state.status,
      });
      return;
    }
    logger.info('Checking for updates', { reason });
    updater.checkForUpdates();
  }

  // One-shot timers chained into a cycle: `cancelTimer !== null` exactly
  // while the periodic cycle is active, which keeps the settings toggle
  // idempotent (a burst of unrelated settings updates never stacks timers).
  function scheduleNext(): void {
    cancelTimer?.();
    cancelTimer = scheduler.schedule(() => {
      cancelTimer = null;
      triggerCheck('periodic');
      scheduleNext();
    }, UPDATE_CHECK_INTERVAL_MS);
  }

  function startCycle(reason: string): void {
    triggerCheck(reason);
    scheduleNext();
  }

  return {
    getState: (): UpdateState => state,

    onStateChanged(listener: (state: UpdateState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start(): void {
      if (disposed) {
        return;
      }
      if (!options.isAutoUpdateEnabled()) {
        logger.debug('Automatic update checks disabled — cycle not started');
        return;
      }
      startCycle('startup');
    },

    handleSettingsChanged(): void {
      if (disposed) {
        return;
      }
      const enabled = options.isAutoUpdateEnabled();
      if (enabled && cancelTimer === null) {
        startCycle('setting-enabled');
      } else if (!enabled && cancelTimer !== null) {
        cancelTimer();
        cancelTimer = null;
        logger.debug('Automatic update checks stopped (setting disabled)');
      }
    },

    checkNow(): void {
      if (disposed) {
        return;
      }
      // PRV-02, strictly (maintainer decision E18.1): disabled means zero
      // network calls — the manual path included. The UI disables the
      // affordance; this guard is the module-side enforcement.
      if (!options.isAutoUpdateEnabled()) {
        logger.debug('Manual update check refused — auto-update is disabled');
        return;
      }
      triggerCheck('manual');
    },

    quitAndInstall(): boolean {
      if (disposed || state.status !== 'ready') {
        return false;
      }
      updater.quitAndInstall();
      return true;
    },

    dispose(): void {
      disposed = true;
      cancelTimer?.();
      cancelTimer = null;
      unsubscribe();
      listeners.clear();
    },
  };
}

const OFFLINE_PATTERNS = [
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NETWORK',
  'ERR_CONNECTION',
  'ERR_NAME_NOT_RESOLVED',
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'net::',
];

/**
 * Maps an updater error message to its named class (§4.7: offline and rate
 * limit are the failures the design calls out). Message-based on purpose:
 * electron-updater surfaces both Chromium net errors and Node error codes
 * only through the message text.
 */
export function classifyUpdaterError(message: string): UpdateErrorKind {
  if (OFFLINE_PATTERNS.some((pattern) => message.includes(pattern))) {
    return 'offline';
  }
  if (/\b403\b|\b429\b|rate ?limit/i.test(message)) {
    return 'rate-limited';
  }
  return 'unknown';
}
