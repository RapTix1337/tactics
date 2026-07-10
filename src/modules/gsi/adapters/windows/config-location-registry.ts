import { execFile } from 'node:child_process';

/**
 * Records where the GSI config was written so the NSIS uninstaller can
 * remove the file (E19.2, ADR-048, resolves open question #5): without
 * this, CS2 keeps POSTing to a dead endpoint after uninstall (ADR-036
 * finding). The path lives as a registry value under the app's own HKCU
 * key; `build/installer.nsh` reads it natively with `ReadRegStr` (no
 * codepage issue), deletes the file, and removes the whole key. Writing
 * shells out to `reg.exe` (the steam-registry precedent — no new
 * dependency); execFile hands the arguments over as a Unicode command
 * line, so non-ASCII paths survive. A Linux build substitutes a no-op —
 * there is no NSIS uninstaller to feed (ADR-004).
 */

/** Key and value name — must match `build/installer.nsh`. The key embeds the final appId (ADR-047). */
export const GSI_CONFIG_LOCATION_KEY = 'HKCU\\Software\\io.github.raptix1337.tactics';
export const GSI_CONFIG_LOCATION_VALUE = 'GsiConfigPath';

export interface GsiConfigLocationRecorder {
  /**
   * Records the absolute config path for the uninstaller. Best-effort by
   * contract: resolves `false` instead of rejecting when the write fails —
   * callers log a warning, the setup itself must never fail on this.
   */
  record(configPath: string): Promise<boolean>;
}

export type ExecuteRegAdd = (args: readonly string[]) => Promise<{ readonly ok: boolean }>;

/** Creates the reg.exe-backed recorder; `execute` is injectable for tests. */
export function createRegExeConfigLocationRecorder(
  execute: ExecuteRegAdd = execRegExe,
): GsiConfigLocationRecorder {
  return {
    async record(configPath: string): Promise<boolean> {
      const result = await execute([
        'add',
        GSI_CONFIG_LOCATION_KEY,
        '/v',
        GSI_CONFIG_LOCATION_VALUE,
        '/t',
        'REG_SZ',
        '/d',
        configPath,
        '/f',
      ]);
      return result.ok;
    },
  };
}

function execRegExe(args: readonly string[]): ReturnType<ExecuteRegAdd> {
  return new Promise((resolve) => {
    execFile('reg.exe', [...args], { windowsHide: true, timeout: 5000 }, (error) => {
      resolve({ ok: error === null });
    });
  });
}
