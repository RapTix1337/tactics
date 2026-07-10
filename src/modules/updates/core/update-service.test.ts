import { describe, expect, it } from 'vitest';

import type { Logger, UpdateState } from '../../../shared';
import type { UpdaterEvent, UpdaterPort, UpdateScheduler } from './update-service';
import {
  classifyUpdaterError,
  createUpdateService,
  UPDATE_CHECK_INTERVAL_MS,
} from './update-service';

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

function createFakeUpdater(): {
  updater: UpdaterPort;
  checkCalls: number[];
  installCalls: number[];
  emit: (event: UpdaterEvent) => void;
  listenerCount: () => number;
} {
  const listeners = new Set<(event: UpdaterEvent) => void>();
  const checkCalls: number[] = [];
  const installCalls: number[] = [];
  return {
    updater: {
      checkForUpdates: (): void => {
        checkCalls.push(checkCalls.length);
      },
      quitAndInstall: (): void => {
        installCalls.push(installCalls.length);
      },
      onEvent: (listener): (() => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    checkCalls,
    installCalls,
    emit: (event): void => {
      for (const listener of [...listeners]) listener(event);
    },
    listenerCount: () => listeners.size,
  };
}

interface ScheduledTimer {
  callback: () => void;
  delayMs: number;
  canceled: boolean;
}

function createFakeScheduler(): {
  scheduler: UpdateScheduler;
  timers: ScheduledTimer[];
  pendingCount: () => number;
  firePending: () => void;
} {
  const timers: ScheduledTimer[] = [];
  return {
    scheduler: {
      schedule: (callback, delayMs): (() => void) => {
        const timer: ScheduledTimer = { callback, delayMs, canceled: false };
        timers.push(timer);
        return () => {
          timer.canceled = true;
        };
      },
    },
    timers,
    pendingCount: () => timers.filter((timer) => !timer.canceled).length,
    firePending: (): void => {
      // Snapshot first: firing typically schedules the next timer.
      for (const timer of timers.splice(0)) {
        if (!timer.canceled) {
          timer.callback();
        }
      }
    },
  };
}

function setup(options: { enabled?: boolean; logger?: Logger } = {}): {
  service: ReturnType<typeof createUpdateService>;
  updater: ReturnType<typeof createFakeUpdater>;
  timers: ReturnType<typeof createFakeScheduler>;
  states: UpdateState[];
  setEnabled: (enabled: boolean) => void;
} {
  let enabled = options.enabled ?? true;
  const updater = createFakeUpdater();
  const timers = createFakeScheduler();
  const service = createUpdateService({
    updater: updater.updater,
    scheduler: timers.scheduler,
    isAutoUpdateEnabled: () => enabled,
    logger: options.logger ?? silentLogger,
  });
  const states: UpdateState[] = [];
  service.onStateChanged((state) => states.push(state));
  return {
    service,
    updater,
    timers,
    states,
    setEnabled: (next): void => {
      enabled = next;
    },
  };
}

describe('createUpdateService — check scheduling', () => {
  it('start() with the setting enabled checks immediately and schedules the periodic cycle', () => {
    const { service, updater, timers } = setup({ enabled: true });

    service.start();

    expect(updater.checkCalls).toHaveLength(1);
    expect(timers.timers).toHaveLength(1);
    expect(timers.timers[0]?.delayMs).toBe(UPDATE_CHECK_INTERVAL_MS);
  });

  it('a fired periodic timer checks again and reschedules', () => {
    const { service, updater, timers } = setup({ enabled: true });
    service.start();
    updater.emit({ kind: 'checking' });
    updater.emit({ kind: 'not-available' });

    timers.firePending();

    expect(updater.checkCalls).toHaveLength(2);
    expect(timers.pendingCount()).toBe(1);
  });

  it('disabled setting ⇒ zero updater calls from start, timers, and checkNow (PRV-02)', () => {
    const { service, updater, timers } = setup({ enabled: false });

    service.start();
    service.checkNow();
    timers.firePending();

    expect(updater.checkCalls).toHaveLength(0);
    expect(timers.timers).toHaveLength(0);
  });

  it('checkNow() with the setting enabled triggers a check without touching the cycle', () => {
    const { service, updater, timers } = setup({ enabled: true });

    service.checkNow();

    expect(updater.checkCalls).toHaveLength(1);
    expect(timers.timers).toHaveLength(0);
  });

  it('never stacks checks: a running cycle swallows periodic and manual triggers', () => {
    const { service, updater, timers } = setup({ enabled: true });
    service.start();
    updater.emit({ kind: 'checking' });

    service.checkNow();
    timers.firePending();

    // Only the startup check reached the port; checking blocked both.
    expect(updater.checkCalls).toHaveLength(1);
    // The periodic cycle itself stays alive.
    expect(timers.pendingCount()).toBe(1);
  });

  it('stops checking once an update is ready — it installs on quit anyway', () => {
    const { service, updater, timers } = setup({ enabled: true });
    service.start();
    updater.emit({ kind: 'ready', version: '1.2.3' });

    timers.firePending();
    service.checkNow();

    expect(updater.checkCalls).toHaveLength(1);
  });
});

describe('createUpdateService — settings toggle', () => {
  it('toggling the setting off cancels the periodic cycle', () => {
    const { service, updater, timers, setEnabled } = setup({ enabled: true });
    service.start();

    setEnabled(false);
    service.handleSettingsChanged();
    timers.firePending();

    expect(updater.checkCalls).toHaveLength(1);
    expect(timers.pendingCount()).toBe(0);
  });

  it('toggling the setting on checks immediately and resumes the cycle', () => {
    const { service, updater, timers, setEnabled } = setup({ enabled: false });
    service.start();

    setEnabled(true);
    service.handleSettingsChanged();

    expect(updater.checkCalls).toHaveLength(1);
    expect(timers.pendingCount()).toBe(1);
  });

  it('unrelated settings changes while enabled never stack or reset timers', () => {
    const { service, timers } = setup({ enabled: true });
    service.start();

    service.handleSettingsChanged();
    service.handleSettingsChanged();

    expect(timers.timers).toHaveLength(1);
  });
});

describe('createUpdateService — state machine', () => {
  it('starts idle', () => {
    const { service } = setup();
    expect(service.getState()).toEqual({ status: 'idle', version: null, errorKind: null });
  });

  it('walks the full found-update chain: checking → available → downloading → ready', () => {
    const { service, updater, states } = setup();

    updater.emit({ kind: 'checking' });
    updater.emit({ kind: 'available', version: '1.2.3' });
    updater.emit({ kind: 'downloading' });
    updater.emit({ kind: 'ready', version: '1.2.3' });

    expect(states).toEqual([
      { status: 'checking', version: null, errorKind: null },
      { status: 'available', version: '1.2.3', errorKind: null },
      // No version of its own — progress events follow the available one.
      { status: 'downloading', version: '1.2.3', errorKind: null },
      { status: 'ready', version: '1.2.3', errorKind: null },
    ]);
    expect(service.getState().status).toBe('ready');
  });

  it('returns to idle when no update is available', () => {
    const { service, updater } = setup();

    updater.emit({ kind: 'checking' });
    updater.emit({ kind: 'not-available' });

    expect(service.getState()).toEqual({ status: 'idle', version: null, errorKind: null });
  });

  it('maps a failure to the error state carrying only the named class, never the raw text', () => {
    const warnings: unknown[] = [];
    const { service, updater } = setup({
      logger: {
        ...silentLogger,
        warn: (message, context) => warnings.push({ message, context }),
      },
    });

    updater.emit({ kind: 'checking' });
    updater.emit({ kind: 'error', message: 'HttpError: 403 rate limit exceeded' });

    expect(service.getState()).toEqual({
      status: 'error',
      version: null,
      errorKind: 'rate-limited',
    });
    // §4.7/ADR-030: the raw message goes to the log, not across IPC.
    expect(JSON.stringify(service.getState())).not.toContain('HttpError');
    expect(warnings).toHaveLength(1);
  });

  it('notifies only on relevant change (duplicate events are filtered)', () => {
    const { updater, states } = setup();

    updater.emit({ kind: 'checking' });
    updater.emit({ kind: 'checking' });

    expect(states).toHaveLength(1);
  });

  it('ready sticks: a late error never regresses a downloaded update', () => {
    const { service, updater } = setup();

    updater.emit({ kind: 'ready', version: '1.2.3' });
    updater.emit({ kind: 'error', message: 'boom' });

    expect(service.getState().status).toBe('ready');
  });

  it('recovers from error: the next cycle may run again', () => {
    const { service, updater } = setup({ enabled: true });
    updater.emit({ kind: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' });

    service.checkNow();

    expect(updater.checkCalls).toHaveLength(1);
  });

  it('unsubscribing a state listener stops its notifications', () => {
    const { service, updater } = setup();
    const seen: UpdateState[] = [];
    const unsubscribe = service.onStateChanged((state) => seen.push(state));

    updater.emit({ kind: 'checking' });
    unsubscribe();
    updater.emit({ kind: 'available', version: '1.2.3' });

    expect(seen).toHaveLength(1);
  });
});

describe('createUpdateService — install and dispose', () => {
  it('quitAndInstall installs only with a ready update', () => {
    const { service, updater } = setup();

    expect(service.quitAndInstall()).toBe(false);
    expect(updater.installCalls).toHaveLength(0);

    updater.emit({ kind: 'ready', version: '1.2.3' });
    expect(service.quitAndInstall()).toBe(true);
    expect(updater.installCalls).toHaveLength(1);
  });

  it('dispose cancels the cycle, detaches from the updater, and freezes the state', () => {
    const { service, updater, timers } = setup({ enabled: true });
    service.start();

    service.dispose();
    timers.firePending();
    updater.emit({ kind: 'ready', version: '1.2.3' });

    expect(updater.checkCalls).toHaveLength(1);
    expect(updater.listenerCount()).toBe(0);
    expect(service.getState().status).toBe('idle');
    expect(service.quitAndInstall()).toBe(false);
  });
});

describe('classifyUpdaterError', () => {
  it('classifies connectivity failures as offline', () => {
    expect(classifyUpdaterError('net::ERR_INTERNET_DISCONNECTED')).toBe('offline');
    expect(classifyUpdaterError('getaddrinfo ENOTFOUND github.com')).toBe('offline');
    expect(classifyUpdaterError('connect ETIMEDOUT 140.82.121.3:443')).toBe('offline');
  });

  it('classifies HTTP 403/429 and rate-limit texts as rate-limited', () => {
    expect(classifyUpdaterError('HttpError: 403 Forbidden')).toBe('rate-limited');
    expect(classifyUpdaterError('HttpError: 429 Too Many Requests')).toBe('rate-limited');
    expect(classifyUpdaterError('API rate limit exceeded')).toBe('rate-limited');
  });

  it('falls back to unknown for everything else', () => {
    expect(classifyUpdaterError('Cannot parse latest.yml')).toBe('unknown');
  });
});
