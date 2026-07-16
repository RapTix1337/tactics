import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import { closeOverlay, openOverlay, resizeOverlay } from './overlay';

function installBridge(invoke: ReturnType<typeof vi.fn>): void {
  const bridge = {
    invoke,
    subscribe: (): never => {
      throw new Error('the overlay command wrappers never subscribe');
    },
  } as unknown as TacticsBridge;
  Object.defineProperty(window, 'tactics', { value: bridge, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
});

describe('openOverlay', () => {
  it('invokes overlay.open and passes the envelope through', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: { open: true } });
    installBridge(invoke);

    await expect(openOverlay()).resolves.toEqual({ ok: true, data: { open: true } });
    expect(invoke).toHaveBeenCalledWith('overlay.open', undefined);
  });

  it('passes failed envelopes through untouched', async () => {
    const failed = {
      ok: false,
      error: { code: 'INTERNAL', message: 'Overlay open failed.' },
    };
    installBridge(vi.fn().mockResolvedValue(failed));

    await expect(openOverlay()).resolves.toEqual(failed);
  });
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

describe('resizeOverlay', () => {
  it('invokes overlay.resize with the request and passes the acknowledgement through', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: undefined });
    installBridge(invoke);

    const request = { edge: 'bottom-right', pointerX: 1280.5, pointerY: 720.25 } as const;
    await expect(resizeOverlay(request)).resolves.toEqual({ ok: true, data: undefined });
    expect(invoke).toHaveBeenCalledWith('overlay.resize', request);
  });

  it('passes failed envelopes through untouched', async () => {
    const failed = {
      ok: false,
      error: { code: 'INTERNAL', message: 'Overlay resize failed.' },
    };
    installBridge(vi.fn().mockResolvedValue(failed));

    await expect(resizeOverlay({ edge: 'left', pointerX: 0, pointerY: 0 })).resolves.toEqual(
      failed,
    );
  });
});
