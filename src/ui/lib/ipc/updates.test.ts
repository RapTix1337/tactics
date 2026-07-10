import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import { checkForUpdates, installUpdate } from './updates';

function installBridge(invoke: ReturnType<typeof vi.fn>): void {
  const bridge = {
    invoke,
    subscribe: (): never => {
      throw new Error('the update commands never subscribe');
    },
  } as unknown as TacticsBridge;
  Object.defineProperty(window, 'tactics', { value: bridge, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
});

describe('checkForUpdates', () => {
  it('invokes updates.check and passes the envelope through', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: undefined });
    installBridge(invoke);

    await expect(checkForUpdates()).resolves.toEqual({ ok: true, data: undefined });
    expect(invoke).toHaveBeenCalledWith('updates.check', undefined);
  });

  it('answers INTERNAL when the bridge is not exposed — never rejects', async () => {
    const result = await checkForUpdates();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL');
    }
  });
});

describe('installUpdate', () => {
  it('invokes updates.install and passes a failed envelope through', async () => {
    const invoke = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'UPDATE_NOT_READY', message: 'no update is ready to install' },
    });
    installBridge(invoke);

    await expect(installUpdate()).resolves.toEqual({
      ok: false,
      error: { code: 'UPDATE_NOT_READY', message: 'no update is ready to install' },
    });
    expect(invoke).toHaveBeenCalledWith('updates.install', undefined);
  });

  it('converts a bridge rejection into a failed envelope', async () => {
    installBridge(vi.fn().mockRejectedValue(new Error('ipc broke')));

    await expect(installUpdate()).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'ipc broke' },
    });
  });
});
