import { beforeEach, describe, expect, it } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import type { GameState } from '../../../shared/game-state';
import type { Settings } from '../../../shared/settings';
import type { UpdateState } from '../../../shared/update-state';
import { useAppStore } from '../../stores/app-store';
import { useGameStateStore } from '../../stores/game-state-store';
import { useSettingsStore } from '../../stores/settings-store';
import { useUpdateStore } from '../../stores/update-store';
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

const snapshotGameState: GameState = { status: 'waiting', map: { kind: 'none' } };

const snapshotUpdateState: UpdateState = { status: 'idle', version: null, errorKind: null };

const snapshot: AppSnapshot = {
  gameState: snapshotGameState,
  settings: snapshotSettings,
  updateState: snapshotUpdateState,
};

const eventSettings: Settings = {
  ...snapshotSettings,
  theme: 'light',
  gsiPort: 42731,
};

const eventGameState: GameState = {
  status: 'connected',
  map: { kind: 'resolved', mapId: 'de_dust2' },
};

const eventUpdateState: UpdateState = { status: 'ready', version: '1.2.3', errorKind: null };

function createFakeBridge(): {
  bridge: TacticsBridge;
  emitSettings: (settings: Settings) => void;
  emitGameState: (gameState: GameState) => void;
  emitUpdateState: (updateState: UpdateState) => void;
  subscribedDomains: string[];
} {
  const handlers = new Map<string, (payload: unknown) => void>();
  const subscribedDomains: string[] = [];
  const bridge = {
    invoke: (): never => {
      throw new Error('the wiring never invokes commands');
    },
    subscribe: (event: string, handler: (payload: unknown) => void): (() => void) => {
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
    emitGameState: (gameState): void => {
      handlers.get('gameState')?.(gameState);
    },
    emitUpdateState: (updateState): void => {
      handlers.get('update')?.(updateState);
    },
  };
}

describe('ipcWiring', () => {
  beforeEach(() => {
    useAppStore.setState({ ipcStatus: 'connecting', lastError: undefined });
    useGameStateStore.setState({ gameState: undefined });
    useSettingsStore.setState({ settings: undefined });
    useUpdateStore.setState({ updateState: undefined });
  });

  it('marks the store ready and fills every mirror slice when the snapshot arrives', () => {
    ipcWiring.applySnapshot(snapshot);

    expect(useAppStore.getState()).toEqual({ ipcStatus: 'ready', lastError: undefined });
    expect(useGameStateStore.getState().gameState).toEqual(snapshotGameState);
    expect(useSettingsStore.getState().settings).toEqual(snapshotSettings);
    expect(useUpdateStore.getState().updateState).toEqual(snapshotUpdateState);
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

  it('subscribes the gameState event and mirrors the full slice into the store', () => {
    const { bridge, emitGameState, subscribedDomains } = createFakeBridge();

    ipcWiring.subscribeAll(bridge);
    expect(subscribedDomains).toContain('gameState');

    emitGameState(eventGameState);
    expect(useGameStateStore.getState().gameState).toEqual(eventGameState);
    expect(useAppStore.getState().ipcStatus).toBe('connecting');
  });

  it('subscribes the update event and mirrors the full slice into the store', () => {
    const { bridge, emitUpdateState, subscribedDomains } = createFakeBridge();

    ipcWiring.subscribeAll(bridge);
    expect(subscribedDomains).toContain('update');

    emitUpdateState(eventUpdateState);
    expect(useUpdateStore.getState().updateState).toEqual(eventUpdateState);
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
