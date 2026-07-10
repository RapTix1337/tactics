import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import { PROJECT_REPOSITORY_URL } from '../../../shared/external-urls';
import { openExternal } from './external-links';

function installBridge(invoke: ReturnType<typeof vi.fn>): void {
  const bridge = {
    invoke,
    subscribe: (): never => {
      throw new Error('openExternal never subscribes');
    },
  } as unknown as TacticsBridge;
  Object.defineProperty(window, 'tactics', { value: bridge, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
});

describe('openExternal', () => {
  it('invokes app.openExternal with the URL and passes the envelope through', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: undefined });
    installBridge(invoke);

    await expect(openExternal(PROJECT_REPOSITORY_URL)).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(invoke).toHaveBeenCalledWith('app.openExternal', { url: PROJECT_REPOSITORY_URL });
  });

  it('answers INTERNAL when the bridge is not exposed — never rejects', async () => {
    const result = await openExternal(PROJECT_REPOSITORY_URL);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL');
    }
  });

  it('passes failed envelopes through untouched', async () => {
    const failed = {
      ok: false,
      error: { code: 'INTERNAL', message: 'Could not open the link in the default browser.' },
    };
    installBridge(vi.fn().mockResolvedValue(failed));

    await expect(openExternal(PROJECT_REPOSITORY_URL)).resolves.toEqual(failed);
  });
});
