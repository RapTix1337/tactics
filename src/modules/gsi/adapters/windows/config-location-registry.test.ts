import { describe, expect, it, vi } from 'vitest';

import {
  createRegExeConfigLocationRecorder,
  type ExecuteRegAdd,
  GSI_CONFIG_LOCATION_KEY,
  GSI_CONFIG_LOCATION_VALUE,
} from './config-location-registry';

describe('createRegExeConfigLocationRecorder', () => {
  it('writes the config path as a forced REG_SZ under the app key', async () => {
    const execute = vi.fn<ExecuteRegAdd>().mockResolvedValue({ ok: true });

    const recorded = await createRegExeConfigLocationRecorder(execute).record(
      'D:\\Games\\CS2\\game\\csgo\\cfg\\gamestate_integration_tactics.cfg',
    );

    expect(recorded).toBe(true);
    expect(execute).toHaveBeenCalledWith([
      'add',
      GSI_CONFIG_LOCATION_KEY,
      '/v',
      GSI_CONFIG_LOCATION_VALUE,
      '/t',
      'REG_SZ',
      '/d',
      'D:\\Games\\CS2\\game\\csgo\\cfg\\gamestate_integration_tactics.cfg',
      '/f',
    ]);
  });

  it('resolves false when reg.exe fails — never rejects (best-effort contract)', async () => {
    const failing: ExecuteRegAdd = () => Promise.resolve({ ok: false });

    await expect(
      createRegExeConfigLocationRecorder(failing).record('C:\\cfg\\x.cfg'),
    ).resolves.toBe(false);
  });
});
