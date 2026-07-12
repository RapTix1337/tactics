import { beforeEach, describe, expect, it } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import type { GameState } from '../../../shared/game-state';
import type { ScoreboardState } from '../../../shared/scoreboard-state';
import type { Settings } from '../../../shared/settings';
import type { UpdateState } from '../../../shared/update-state';
import { useAppStore } from '../../stores/app-store';
import { useGameStateStore } from '../../stores/game-state-store';
import { useScoreboardStore } from '../../stores/scoreboard-store';
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
  scoreboardEnabled: true,
  scoreboardLayout: { groups: [{ label: 'Match totals', fields: ['kills'] }] },
  gsiTiming: 'default',
};

const snapshotGameState: GameState = { status: 'waiting', map: { kind: 'none' } };

const snapshotUpdateState: UpdateState = { status: 'idle', version: null, errorKind: null };

const snapshotScoreboard: ScoreboardState = { active: false };

const snapshot: AppSnapshot = {
  gameState: snapshotGameState,
  scoreboard: snapshotScoreboard,
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

const eventScoreboard: ScoreboardState = {
  active: true,
  phase: 'live',
  roundNumber: 4,
  halftimeAfter: 12,
  myTeam: { side: 'CT', score: 2, lossStreak: 1, timeoutsRemaining: 1 },
  enemyTeam: { side: 'T', score: 1, lossStreak: 2, timeoutsRemaining: 1 },
  roundHistory: ['won', 'lost', 'won'],
  me: {
    kills: 5,
    assists: 1,
    deaths: 2,
    mvps: 1,
    score: 12,
    health: 100,
    armor: 100,
    helmet: true,
    money: 4300,
    equipValue: 5100,
    roundKills: 0,
    roundHsKills: 0,
  },
  derived: { approximate: false, hsRatePercent: 40, hsKills: 2 },
};

function createFakeBridge(): {
  bridge: TacticsBridge;
  emitSettings: (settings: Settings) => void;
  emitGameState: (gameState: GameState) => void;
  emitUpdateState: (updateState: UpdateState) => void;
  emitScoreboard: (scoreboard: ScoreboardState) => void;
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
    emitScoreboard: (scoreboard): void => {
      handlers.get('scoreboard')?.(scoreboard);
    },
  };
}

describe('ipcWiring', () => {
  beforeEach(() => {
    useAppStore.setState({ ipcStatus: 'connecting', lastError: undefined });
    useGameStateStore.setState({ gameState: undefined });
    useScoreboardStore.setState({ scoreboard: undefined });
    useSettingsStore.setState({ settings: undefined });
    useUpdateStore.setState({ updateState: undefined });
  });

  it('marks the store ready and fills every mirror slice when the snapshot arrives', () => {
    ipcWiring.applySnapshot(snapshot);

    expect(useAppStore.getState()).toEqual({ ipcStatus: 'ready', lastError: undefined });
    expect(useGameStateStore.getState().gameState).toEqual(snapshotGameState);
    expect(useScoreboardStore.getState().scoreboard).toEqual(snapshotScoreboard);
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

  it('subscribes the scoreboard event and mirrors the full slice into the store', () => {
    const { bridge, emitScoreboard, subscribedDomains } = createFakeBridge();

    ipcWiring.subscribeAll(bridge);
    expect(subscribedDomains).toContain('scoreboard');

    emitScoreboard(eventScoreboard);
    expect(useScoreboardStore.getState().scoreboard).toEqual(eventScoreboard);
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
