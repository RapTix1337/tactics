import { describe, expect, it, vi } from 'vitest';

import {
  createRegExeReader,
  type ExecuteRegQuery,
  readSteamPathFromRegistry,
  type RegistryReader,
} from './steam-registry';

/** Builds reg.exe-shaped output: header line, blank lines, one value line. */
function regQueryOutput(valueName: string, type: string, value: string): string {
  return `\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    ${valueName}    ${type}    ${value}\r\n\r\n`;
}

const succeedingWith =
  (stdout: string): ExecuteRegQuery =>
  () =>
    Promise.resolve({ ok: true, stdout });

const failing: ExecuteRegQuery = () => Promise.resolve({ ok: false, stdout: '' });

describe('createRegExeReader', () => {
  it('passes the query arguments to the executor', async () => {
    const execute = vi.fn<ExecuteRegQuery>().mockResolvedValue({ ok: true, stdout: '' });

    await createRegExeReader(execute).readValue('HKCU\\Software\\Valve\\Steam', 'SteamPath');

    expect(execute).toHaveBeenCalledWith([
      'query',
      'HKCU\\Software\\Valve\\Steam',
      '/v',
      'SteamPath',
    ]);
  });

  it('parses the value from realistic reg.exe output', async () => {
    const reader = createRegExeReader(
      succeedingWith(regQueryOutput('SteamPath', 'REG_SZ', 'c:/program files (x86)/steam')),
    );

    await expect(reader.readValue('HKCU\\Software\\Valve\\Steam', 'SteamPath')).resolves.toBe(
      'c:/program files (x86)/steam',
    );
  });

  it('preserves inner spaces in the value', async () => {
    const reader = createRegExeReader(
      succeedingWith(regQueryOutput('InstallPath', 'REG_SZ', 'C:\\Program Files (x86)\\Steam')),
    );

    await expect(reader.readValue('HKLM\\...', 'InstallPath')).resolves.toBe(
      'C:\\Program Files (x86)\\Steam',
    );
  });

  it('accepts REG_EXPAND_SZ values', async () => {
    const reader = createRegExeReader(
      succeedingWith(regQueryOutput('SteamPath', 'REG_EXPAND_SZ', 'D:\\Steam')),
    );

    await expect(reader.readValue('HKCU\\...', 'SteamPath')).resolves.toBe('D:\\Steam');
  });

  it('matches the value name case-insensitively', async () => {
    const reader = createRegExeReader(
      succeedingWith(regQueryOutput('steampath', 'REG_SZ', 'D:\\Steam')),
    );

    await expect(reader.readValue('HKCU\\...', 'SteamPath')).resolves.toBe('D:\\Steam');
  });

  it('ignores value lines for other names', async () => {
    const reader = createRegExeReader(
      succeedingWith(regQueryOutput('Language', 'REG_SZ', 'english')),
    );

    await expect(reader.readValue('HKCU\\...', 'SteamPath')).resolves.toBeUndefined();
  });

  it('returns undefined when reg.exe fails (missing key, value, or reg.exe itself)', async () => {
    const reader = createRegExeReader(failing);

    await expect(reader.readValue('HKCU\\...', 'SteamPath')).resolves.toBeUndefined();
  });
});

describe('readSteamPathFromRegistry', () => {
  const registryWith = (values: Readonly<Record<string, string>>): RegistryReader => ({
    readValue: (keyPath) => {
      const hive = keyPath.startsWith('HKCU') ? 'HKCU' : 'HKLM';
      return Promise.resolve(values[hive]);
    },
  });

  it('prefers the per-user SteamPath', async () => {
    const registry = registryWith({ HKCU: 'D:\\Steam', HKLM: 'C:\\Machine\\Steam' });

    await expect(readSteamPathFromRegistry(registry)).resolves.toBe('D:\\Steam');
  });

  it('falls back to the machine-wide InstallPath', async () => {
    const registry = registryWith({ HKLM: 'C:\\Machine\\Steam' });

    await expect(readSteamPathFromRegistry(registry)).resolves.toBe('C:\\Machine\\Steam');
  });

  it('skips an empty per-user value', async () => {
    const registry = registryWith({ HKCU: '', HKLM: 'C:\\Machine\\Steam' });

    await expect(readSteamPathFromRegistry(registry)).resolves.toBe('C:\\Machine\\Steam');
  });

  it('returns undefined when no location has a value', async () => {
    await expect(readSteamPathFromRegistry(registryWith({}))).resolves.toBeUndefined();
  });
});
