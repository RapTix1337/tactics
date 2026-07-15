import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import { closeOverlay } from './overlay';

function installBridge(invoke: ReturnType<typeof vi.fn>): void {
  const bridge = {
    invoke,
    subscribe: (): never => {
      throw new Error('closeOverlay never subscribes');
    },
  } as unknown as TacticsBridge;
  Object.defineProperty(window, 'tactics', { value: bridge, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
});

describe('closeOverlay', () => {
  it('invokes overlay.close and passes the envelope through', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: { open: false } });
    installBridge(invoke);

    await expect(closeOverlay()).resolves.toEqual({ ok: true, data: { open: false } });
    expect(invoke).toHaveBeenCalledWith('overlay.close', undefined);
  });

  it('answers INTERNAL when the bridge is not exposed — never rejects', async () => {
    const result = await closeOverlay();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL');
    }
  });

  it('passes failed envelopes through untouched', async () => {
    const failed = {
      ok: false,
      error: { code: 'INTERNAL', message: 'Overlay close failed.' },
    };
    installBridge(vi.fn().mockResolvedValue(failed));

    await expect(closeOverlay()).resolves.toEqual(failed);
  });
});
