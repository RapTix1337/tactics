import { describe, expect, it, vi } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import type { CommandResult } from '../../../shared/envelope';
import type { AppSnapshot, IpcWiring } from './bootstrap';
import { bootstrapIpc } from './bootstrap';

type SnapshotResult = CommandResult<AppSnapshot>;

const snapshot: AppSnapshot = {
  settings: {
    theme: 'dark',
    cs2Path: null,
    gsiPort: null,
    autostart: false,
    closeToTray: true,
    autoUpdate: true,
  },
};

const neverSubscribe = (): never => {
  // The bootstrap never touches the bridge's subscribe itself — event
  // subscriptions are the wiring's job, faked in these tests.
  throw new Error('bootstrap must not subscribe directly');
};

function createFakeBridge(invoke: () => Promise<SnapshotResult>): TacticsBridge {
  // Cast: the fake only needs the snapshot command; TacticsBridge's
  // surface is exactly invoke + subscribe.
  return { invoke, subscribe: neverSubscribe } as unknown as TacticsBridge;
}

function createRecordingWiring(record?: (step: string) => void): IpcWiring & {
  snapshots: AppSnapshot[];
  errors: string[];
} {
  const snapshots: AppSnapshot[] = [];
  const errors: string[] = [];
  return {
    snapshots,
    errors,
    subscribeAll: (): void => {
      record?.('subscribeAll');
    },
    applySnapshot: (snapshot): void => {
      record?.('applySnapshot');
      snapshots.push(snapshot);
    },
    onError: (message): void => {
      errors.push(message);
    },
  };
}

describe('bootstrapIpc', () => {
  it('subscribes before fetching the snapshot (04-data-flow.md §4)', async () => {
    const order: string[] = [];
    const bridge = createFakeBridge(() => {
      order.push('invoke');
      return Promise.resolve({ ok: true, data: snapshot });
    });
    const wiring = createRecordingWiring((step) => order.push(step));

    await bootstrapIpc(bridge, wiring);

    expect(order).toEqual(['subscribeAll', 'invoke', 'applySnapshot']);
    expect(wiring.snapshots).toEqual([snapshot]);
    expect(wiring.errors).toEqual([]);
  });

  it('lets the snapshot overwrite an event that arrived first, and later events win again', async () => {
    // Simulates the race from the task's risk note with a store the test
    // owns: full slices are idempotent, so both orders converge.
    let state = 'initial';
    let emitEvent = (): void => undefined;
    let resolveSnapshot!: (result: SnapshotResult) => void;
    const bridge = createFakeBridge(
      () =>
        new Promise<SnapshotResult>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );
    const wiring: IpcWiring = {
      subscribeAll: (): void => {
        emitEvent = (): void => {
          state = 'from-event';
        };
      },
      applySnapshot: (): void => {
        state = 'from-snapshot';
      },
      onError: (): void => undefined,
    };

    const bootstrap = bootstrapIpc(bridge, wiring);
    emitEvent(); // event arrives while the snapshot is still in flight
    expect(state).toBe('from-event');

    resolveSnapshot({ ok: true, data: snapshot });
    await bootstrap;
    expect(state).toBe('from-snapshot'); // snapshot overwrites

    emitEvent(); // event after the snapshot wins again
    expect(state).toBe('from-event');
  });

  it('reports a missing bridge as an error without subscribing', async () => {
    const wiring = createRecordingWiring();
    const subscribeSpy = vi.spyOn(wiring, 'subscribeAll');

    await bootstrapIpc(undefined, wiring);

    expect(wiring.errors).toEqual(['IPC bridge is not exposed on window']);
    expect(subscribeSpy).not.toHaveBeenCalled();
  });

  it('maps a failure envelope to the error path', async () => {
    const bridge = createFakeBridge(() =>
      Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: 'nope' } }),
    );
    const wiring = createRecordingWiring();

    await bootstrapIpc(bridge, wiring);

    expect(wiring.errors).toEqual(['nope']);
    expect(wiring.snapshots).toEqual([]);
  });

  it('never rejects — a throwing invoke ends in onError', async () => {
    const bridge = createFakeBridge(() => Promise.reject(new Error('ipc broke')));
    const wiring = createRecordingWiring();

    await expect(bootstrapIpc(bridge, wiring)).resolves.toBeUndefined();
    expect(wiring.errors).toEqual(['ipc broke']);
  });
});
