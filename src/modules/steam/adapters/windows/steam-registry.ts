import { execFile } from 'node:child_process';

/**
 * Windows registry access for the Steam path (GSI-01, detection chain step
 * "registry"). The access is isolated behind `RegistryReader` so the
 * detection chain is testable with a fake (E9.2 acceptance) and a Linux
 * adapter can substitute its own Steam-path source later (ADR-004). The
 * real reader shells out to `reg.exe` — no new dependency; only the value
 * line is parsed, never localized message text. Known limitation: reg.exe
 * writes redirected output in the console codepage, so non-ASCII Steam
 * paths can arrive garbled — the manual path selection (E9.3, GSI-02) is
 * the fallback for that rare case.
 */

export interface RegistryReader {
  /** Reads a string value; `undefined` when the key or value does not exist. */
  readValue(keyPath: string, valueName: string): Promise<string | undefined>;
}

/**
 * Where Steam records its install path: the per-user value first (written
 * when the user runs Steam), then the machine-wide install value as the
 * fallback for "installed by another user, never started by this one".
 */
const STEAM_REGISTRY_LOCATIONS = [
  { keyPath: 'HKCU\\Software\\Valve\\Steam', valueName: 'SteamPath' },
  { keyPath: 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', valueName: 'InstallPath' },
] as const;

/** Tries the known Steam registry locations in order; first non-empty value wins. */
export async function readSteamPathFromRegistry(
  registry: RegistryReader,
): Promise<string | undefined> {
  for (const location of STEAM_REGISTRY_LOCATIONS) {
    const value = await registry.readValue(location.keyPath, location.valueName);
    if (value !== undefined && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

export type ExecuteRegQuery = (
  args: readonly string[],
) => Promise<{ readonly ok: boolean; readonly stdout: string }>;

/** Creates the reg.exe-backed reader; `execute` is injectable for tests. */
export function createRegExeReader(execute: ExecuteRegQuery = execRegExe): RegistryReader {
  return {
    async readValue(keyPath: string, valueName: string): Promise<string | undefined> {
      const result = await execute(['query', keyPath, '/v', valueName]);
      if (!result.ok) {
        return undefined; // missing key/value, missing reg.exe — all "not found"
      }
      return parseRegQueryOutput(result.stdout, valueName);
    },
  };
}

/**
 * Matches the value line of `reg query` output, e.g.
 * `    SteamPath    REG_SZ    c:/program files (x86)/steam`.
 * Only value names without spaces are supported — both Steam values qualify.
 */
const REG_VALUE_LINE = /^\s*(?<name>\S+)\s+REG_(?:EXPAND_)?SZ\s+(?<value>\S.*)$/;

function parseRegQueryOutput(stdout: string, valueName: string): string | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    const groups = REG_VALUE_LINE.exec(line)?.groups;
    const name = groups?.['name'];
    const value = groups?.['value'];
    if (name?.toLowerCase() === valueName.toLowerCase() && value !== undefined) {
      return value.trimEnd();
    }
  }
  return undefined;
}

function execRegExe(args: readonly string[]): ReturnType<ExecuteRegQuery> {
  return new Promise((resolve) => {
    execFile('reg.exe', [...args], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      resolve({ ok: error === null, stdout });
    });
  });
}
