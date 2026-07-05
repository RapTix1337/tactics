import { beforeEach, describe, expect, it } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import type { Settings } from '../../../shared/settings';
import { useAppStore } from '../../stores/app-store';
import { useSettingsStore } from '../../stores/settings-store';
import type { AppSnapshot } from './bootstrap';
import { ipcWiring } from './wiring';

const snapshotSettings: Settings = {
  theme: 'dark',
  cs2Path: null,
  gsiPort: null,
  autostart: false,
  closeToTray: true,
  autoUpdate: true,
};

const snapshot: AppSnapshot = { settings: snapshotSettings };

const eventSettings: Settings = {
  ...snapshotSettings,
  theme: 'light',
  gsiPort: 42731,
};

function createFakeBridge(): {
  bridge: TacticsBridge;
  emitSettings: (settings: Settings) => void;
  subscribedDomains: string[];
} {
  const handlers = new Map<string, (payload: Settings) => void>();
  const subscribedDomains: string[] = [];
  const bridge = {
    invoke: (): never => {
      throw new Error('the wiring never invokes commands');
    },
    subscribe: (event: string, handler: (payload: Settings) => void): (() => void) => {
      subscribedDomains.push(event);
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
  } as unknown as TacticsBridge;
  return {
    bridge,
    subscribedDomains,
    emitSettings: (settings): void => {
      handlers.get('settings')?.(settings);
    },
  };
}

describe('ipcWiring', () => {
  beforeEach(() => {
    useAppStore.setState({ ipcStatus: 'connecting', lastError: undefined });
    useSettingsStore.setState({ settings: undefined });
  });

  it('marks the store ready and fills the settings slice when the snapshot arrives', () => {
    ipcWiring.applySnapshot(snapshot);

    expect(useAppStore.getState()).toEqual({ ipcStatus: 'ready', lastError: undefined });
    expect(useSettingsStore.getState().settings).toEqual(snapshotSettings);
  });

  it('marks the store as errored with the message', () => {
    ipcWiring.onError('bridge gone');

    expect(useAppStore.getState()).toEqual({ ipcStatus: 'error', lastError: 'bridge gone' });
  });

  it('re-initializes to ready after a previous error (reload semantics)', () => {
    ipcWiring.onError('first try failed');
    ipcWiring.applySnapshot(snapshot);

    expect(useAppStore.getState()).toEqual({ ipcStatus: 'ready', lastError: undefined });
  });

  it('subscribes the settings event and mirrors the full slice into the store', () => {
    const { bridge, emitSettings, subscribedDomains } = createFakeBridge();

    ipcWiring.subscribeAll(bridge);
    expect(subscribedDomains).toContain('settings');

    emitSettings(eventSettings);
    expect(useSettingsStore.getState().settings).toEqual(eventSettings);
    // The event never touches the bootstrap status — that is snapshot territory.
    expect(useAppStore.getState().ipcStatus).toBe('connecting');
  });

  it('converges when an event precedes the snapshot and later events win again', () => {
    const { bridge, emitSettings } = createFakeBridge();
    ipcWiring.subscribeAll(bridge);

    emitSettings(eventSettings); // arrives while the snapshot is in flight
    ipcWiring.applySnapshot(snapshot); // snapshot overwrites (full slice)
    expect(useSettingsStore.getState().settings).toEqual(snapshotSettings);

    emitSettings(eventSettings); // a later event wins again
    expect(useSettingsStore.getState().settings).toEqual(eventSettings);
  });
});
