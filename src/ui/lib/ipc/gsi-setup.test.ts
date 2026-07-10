import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import type { CommandResult } from '../../../shared/envelope';
import type { GsiSetupPlan } from './gsi-setup';
import { applyGsiSetup, loadGsiSetupPlan, pickCs2Path } from './gsi-setup';

const readyPlan: GsiSetupPlan = {
  status: 'ready',
  source: 'detected',
  gameRoot: 'C:\\Games\\Counter-Strike Global Offensive',
  configPath:
    'C:\\Games\\Counter-Strike Global Offensive\\game\\csgo\\cfg\\gamestate_integration_tactics.cfg',
  port: 42730,
};

function installBridge(invoke: ReturnType<typeof vi.fn>): void {
  const bridge = {
    invoke,
    subscribe: (): never => {
      throw new Error('the setup functions never subscribe');
    },
  } as unknown as TacticsBridge;
  Object.defineProperty(window, 'tactics', { value: bridge, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
});

describe('loadGsiSetupPlan', () => {
  it('passes the ready-plan envelope through untouched', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: readyPlan });
    installBridge(invoke);

    await expect(loadGsiSetupPlan()).resolves.toEqual({ ok: true, data: readyPlan });
    expect(invoke).toHaveBeenCalledWith('gsi.getSetupPlan', undefined);
  });

  it('answers INTERNAL when the bridge is not exposed — never rejects', async () => {
    const result = await loadGsiSetupPlan();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL');
    }
  });

  it('converts a bridge rejection into a failed envelope', async () => {
    installBridge(vi.fn().mockRejectedValue(new Error('ipc broke')));

    await expect(loadGsiSetupPlan()).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'ipc broke' },
    });
  });
});

describe('applyGsiSetup', () => {
  it('invokes gsi.applySetup and passes the envelope through', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: undefined });
    installBridge(invoke);

    await expect(applyGsiSetup()).resolves.toEqual({ ok: true, data: undefined });
    expect(invoke).toHaveBeenCalledWith('gsi.applySetup', undefined);
  });

  it('passes named failures through untouched', async () => {
    const failed: CommandResult<never> = {
      ok: false,
      error: { code: 'CFG_DIR_NOT_WRITABLE', message: 'cfg dir is read-only' },
    };
    installBridge(vi.fn().mockResolvedValue(failed));

    await expect(applyGsiSetup()).resolves.toEqual(failed);
  });
});

describe('pickCs2Path', () => {
  it('invokes steam.pickCs2Path and passes the outcome through', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: { status: 'canceled' } });
    installBridge(invoke);

    await expect(pickCs2Path()).resolves.toEqual({ ok: true, data: { status: 'canceled' } });
    expect(invoke).toHaveBeenCalledWith('steam.pickCs2Path', undefined);
  });
});
