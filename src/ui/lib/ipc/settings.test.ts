import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import type { Settings } from '../../../shared/settings';
import { updateSettings } from './settings';

const fullSettings: Settings = {
  theme: 'light',
  cs2Path: null,
  gsiPort: null,
  autostart: true,
  closeToTray: true,
  autoUpdate: false,
  scoreboardEnabled: true,
  scoreboardLayout: { groups: [{ label: 'Match totals', fields: ['kills'] }] },
  gsiTiming: 'default',
  overlayScoreboardOpacity: 1,
  overlayMapOpacity: 1,
  overlayCalloutOpacity: 1,
  overlayChromeOpacity: 1,
};

function installBridge(invoke: ReturnType<typeof vi.fn>): void {
  const bridge = {
    invoke,
    subscribe: (): never => {
      throw new Error('updateSettings never subscribes');
    },
  } as unknown as TacticsBridge;
  Object.defineProperty(window, 'tactics', { value: bridge, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
});

describe('updateSettings', () => {
  it('invokes settings.update with the partial and passes the envelope through', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: fullSettings });
    installBridge(invoke);

    await expect(updateSettings({ theme: 'light', autostart: true })).resolves.toEqual({
      ok: true,
      data: fullSettings,
    });
    expect(invoke).toHaveBeenCalledWith('settings.update', { theme: 'light', autostart: true });
  });

  it('answers INTERNAL when the bridge is not exposed — never rejects', async () => {
    const result = await updateSettings({ theme: 'dark' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL');
    }
  });

  it('converts a bridge rejection into a failed envelope', async () => {
    installBridge(vi.fn().mockRejectedValue(new Error('ipc broke')));

    await expect(updateSettings({ autoUpdate: false })).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'ipc broke' },
    });
  });
});
