import { beforeEach, describe, expect, it } from 'vitest';

import { useAppStore } from '../../stores/app-store';
import { ipcWiring } from './wiring';

describe('ipcWiring', () => {
  beforeEach(() => {
    useAppStore.setState({ ipcStatus: 'connecting', lastError: undefined });
  });

  it('marks the store ready when the snapshot arrives', () => {
    ipcWiring.applySnapshot({});

    expect(useAppStore.getState()).toEqual({ ipcStatus: 'ready', lastError: undefined });
  });

  it('marks the store as errored with the message', () => {
    ipcWiring.onError('bridge gone');

    expect(useAppStore.getState()).toEqual({ ipcStatus: 'error', lastError: 'bridge gone' });
  });

  it('re-initializes to ready after a previous error (reload semantics)', () => {
    ipcWiring.onError('first try failed');
    ipcWiring.applySnapshot({});

    expect(useAppStore.getState()).toEqual({ ipcStatus: 'ready', lastError: undefined });
  });
});
