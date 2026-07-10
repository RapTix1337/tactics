import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createGsiStatusMachine,
  generateConfigContent,
  GSI_CONFIG_FILE_NAME,
  type GsiStatusMachine,
  verifyConfig,
  writeConfig,
} from '../../modules/gsi';
import type { Logger } from '../../shared';
import { gsiApplySetup, gsiGetSetupPlan } from '../../shared';
import type { GsiCommandDeps, GsiSetupTarget } from './gsi-commands';
import { registerGsiCommands, runStartupConfigVerify } from './gsi-commands';
import type { CommandRegistrationDeps } from './register-command';

const PORT = 42730;
const TOKEN = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0';

interface FakeEvent {
  trusted: boolean;
}

type RegisteredListener = (event: FakeEvent, request: unknown) => Promise<unknown>;

/** Captures every log line so ban-list assertions can scan them (ADR-030). */
function createCapturingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const capture =
    () =>
    (message: string, context?: Record<string, unknown>): void => {
      lines.push(`${message} ${JSON.stringify(context ?? {})}`);
    };
  return {
    logger: { error: capture(), warn: capture(), info: capture(), debug: capture() },
    lines,
  };
}

describe('gsi commands (E10.6)', () => {
  let cfgDir: string;
  let machine: GsiStatusMachine;

  beforeEach(() => {
    cfgDir = mkdtempSync(join(tmpdir(), 'tactics-gsi-commands-'));
    // Real machine, inert scheduler: E10.6 feeds only config inputs, so no
    // stale timeout may ever fire here.
    machine = createGsiStatusMachine({ schedule: () => () => undefined });
  });

  afterEach(() => {
    machine.dispose();
    rmSync(cfgDir, { recursive: true, force: true });
  });

  function createDeps(overrides: Partial<GsiCommandDeps> = {}): { deps: GsiCommandDeps } {
    const target: GsiSetupTarget = {
      source: 'detected',
      gameRoot: join(cfgDir, '..'),
      cfgDir,
    };
    return {
      deps: {
        resolveSetupTarget: () => Promise.resolve(target),
        getSetupPort: () => PORT,
        getAuthToken: () => TOKEN,
        getConfigPath: (directory) => join(directory, GSI_CONFIG_FILE_NAME),
        verifyConfig,
        writeConfig,
        recordConfigLocation: () => Promise.resolve(true),
        reportConfigValid: () => machine.reportConfigValid(),
        reportConfigInvalid: () => machine.reportConfigInvalid(),
        ...overrides,
      },
    };
  }

  function register(deps: GsiCommandDeps): {
    invoke: (channel: string) => Promise<unknown>;
    lines: string[];
  } {
    const handlers = new Map<string, RegisteredListener>();
    const { logger, lines } = createCapturingLogger();
    const registration: CommandRegistrationDeps<FakeEvent> = {
      registerHandler: (channel, listener): void => {
        handlers.set(channel, listener);
      },
      isTrustedSender: (event): boolean => event.trusted,
      logger,
    };
    registerGsiCommands(registration, deps);
    return {
      invoke: (channel): Promise<unknown> => {
        const listener = handlers.get(channel);
        if (listener === undefined) {
          throw new Error(`${channel} was not registered`);
        }
        return listener({ trusted: true }, undefined);
      },
      lines,
    };
  }

  describe('gsi.getSetupPlan', () => {
    it('previews the detected target with config path and port', async () => {
      const { deps } = createDeps();
      const { invoke } = register(deps);

      await expect(invoke(gsiGetSetupPlan.channel)).resolves.toEqual({
        ok: true,
        data: {
          status: 'ready',
          source: 'detected',
          gameRoot: join(cfgDir, '..'),
          configPath: join(cfgDir, GSI_CONFIG_FILE_NAME),
          port: PORT,
        },
      });
    });

    it('reports cs2-not-found as a regular outcome, not an error', async () => {
      const { deps } = createDeps({ resolveSetupTarget: () => Promise.resolve(undefined) });
      const { invoke } = register(deps);

      await expect(invoke(gsiGetSetupPlan.channel)).resolves.toEqual({
        ok: true,
        data: { status: 'cs2-not-found' },
      });
    });

    it('changes nothing — no file appears, the machine stays not-set-up', async () => {
      const { deps } = createDeps();
      const { invoke } = register(deps);

      await invoke(gsiGetSetupPlan.channel);

      expect(() => readFileSync(join(cfgDir, GSI_CONFIG_FILE_NAME))).toThrow();
      expect(machine.getState().status).toBe('not-set-up');
    });
  });

  describe('gsi.applySetup', () => {
    it('writes the expected config, re-verifies, and moves the machine to waiting', async () => {
      const { deps } = createDeps();
      const { invoke } = register(deps);

      await expect(invoke(gsiApplySetup.channel)).resolves.toEqual({ ok: true, data: undefined });

      expect(readFileSync(join(cfgDir, GSI_CONFIG_FILE_NAME), 'utf8')).toBe(
        generateConfigContent(PORT, TOKEN),
      );
      expect(machine.getState().status).toBe('waiting');
    });

    it('repairs identically: overwrites a hand-edited config (GSI-06)', async () => {
      machine.reportConfigInvalid(); // repair-needed after a startup verify hit
      const { deps } = createDeps();
      const { invoke } = register(deps);
      await deps.writeConfig(cfgDir, PORT, 'a'.repeat(64));

      await expect(invoke(gsiApplySetup.channel)).resolves.toEqual({ ok: true, data: undefined });

      expect(readFileSync(join(cfgDir, GSI_CONFIG_FILE_NAME), 'utf8')).toBe(
        generateConfigContent(PORT, TOKEN),
      );
      expect(machine.getState().status).toBe('waiting');
    });

    it('fails with CS2_NOT_FOUND when no target exists — machine untouched', async () => {
      const { deps } = createDeps({ resolveSetupTarget: () => Promise.resolve(undefined) });
      const { invoke } = register(deps);

      const result = (await invoke(gsiApplySetup.channel)) as {
        ok: boolean;
        error: { code: string };
      };

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('CS2_NOT_FOUND');
      expect(machine.getState().status).toBe('not-set-up');
    });

    it('maps a write failure to CFG_DIR_NOT_WRITABLE without leaking internals or the token', async () => {
      const missingDir = join(cfgDir, 'does', 'not', 'exist');
      const { deps } = createDeps({
        resolveSetupTarget: () =>
          Promise.resolve({ source: 'manual', gameRoot: cfgDir, cfgDir: missingDir } as const),
      });
      const { invoke, lines } = register(deps);

      const result = (await invoke(gsiApplySetup.channel)) as {
        ok: boolean;
        error: { code: string; message: string };
      };

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('CFG_DIR_NOT_WRITABLE');
      expect(result.error.message).not.toContain('ENOENT');
      expect(machine.getState().status).toBe('not-set-up');
      // ADR-030 ban list: the token never reaches a log line.
      expect(lines.join('\n')).not.toContain(TOKEN);
      expect(lines.some((line) => line.includes('Writing the GSI config failed'))).toBe(true);
    });

    it('records the config location for the uninstaller after a successful apply (E19.2)', async () => {
      const recordConfigLocation = vi.fn(() => Promise.resolve(true));
      const { deps } = createDeps({ recordConfigLocation });
      const { invoke } = register(deps);

      await expect(invoke(gsiApplySetup.channel)).resolves.toEqual({ ok: true, data: undefined });

      expect(recordConfigLocation).toHaveBeenCalledExactlyOnceWith(
        join(cfgDir, GSI_CONFIG_FILE_NAME),
      );
    });

    it('does not record a location when the write fails', async () => {
      const recordConfigLocation = vi.fn(() => Promise.resolve(true));
      const { deps } = createDeps({
        recordConfigLocation,
        writeConfig: () => Promise.reject(new Error('EACCES')),
      });
      const { invoke } = register(deps);

      await invoke(gsiApplySetup.channel);

      expect(recordConfigLocation).not.toHaveBeenCalled();
    });

    it('treats a recording failure as best-effort: setup succeeds, a warning is logged', async () => {
      const { deps } = createDeps({ recordConfigLocation: () => Promise.resolve(false) });
      const { invoke, lines } = register(deps);

      await expect(invoke(gsiApplySetup.channel)).resolves.toEqual({ ok: true, data: undefined });

      expect(machine.getState().status).toBe('waiting');
      expect(lines.some((line) => line.includes('Recording the GSI config location'))).toBe(true);
    });

    it('even a throwing recorder cannot fail the setup', async () => {
      const { deps } = createDeps({
        recordConfigLocation: () => Promise.reject(new Error('reg.exe exploded')),
      });
      const { invoke, lines } = register(deps);

      await expect(invoke(gsiApplySetup.channel)).resolves.toEqual({ ok: true, data: undefined });

      expect(lines.some((line) => line.includes('threw'))).toBe(true);
    });

    it('surfaces a failed re-verification and reports the config invalid', async () => {
      const { deps } = createDeps({
        writeConfig: () => Promise.resolve(),
        verifyConfig: () => Promise.resolve('outdated' as const),
      });
      const { invoke } = register(deps);

      const result = (await invoke(gsiApplySetup.channel)) as {
        ok: boolean;
        error: { code: string };
      };

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('CFG_DIR_NOT_WRITABLE');
      expect(machine.getState().status).toBe('repair-needed');
    });
  });

  describe('runStartupConfigVerify', () => {
    it('moves a healthy install to waiting (E10.3 healthy-boot case)', async () => {
      const { deps } = createDeps();
      await deps.writeConfig(cfgDir, PORT, TOKEN);
      const { logger } = createCapturingLogger();

      await runStartupConfigVerify(deps, logger);

      expect(machine.getState().status).toBe('waiting');
    });

    it('yields repair-needed for a deleted config (E10.6 acceptance)', async () => {
      const { deps } = createDeps();
      const { logger } = createCapturingLogger();

      await runStartupConfigVerify(deps, logger);

      expect(machine.getState().status).toBe('repair-needed');
    });

    it('yields repair-needed for a stale config (old port)', async () => {
      const { deps } = createDeps();
      await deps.writeConfig(cfgDir, PORT + 1, TOKEN);
      const { logger } = createCapturingLogger();

      await runStartupConfigVerify(deps, logger);

      expect(machine.getState().status).toBe('repair-needed');
    });

    it('leaves not-set-up untouched when no CS2 installation is known', async () => {
      const { deps } = createDeps({ resolveSetupTarget: () => Promise.resolve(undefined) });
      const { logger } = createCapturingLogger();

      await runStartupConfigVerify(deps, logger);

      expect(machine.getState().status).toBe('not-set-up');
    });

    it('never throws: a failing resolution is logged and leaves not-set-up', async () => {
      const { deps } = createDeps({
        resolveSetupTarget: () => Promise.reject(new Error('reg.exe exploded')),
      });
      const { logger, lines } = createCapturingLogger();

      await expect(runStartupConfigVerify(deps, logger)).resolves.toBeUndefined();

      expect(machine.getState().status).toBe('not-set-up');
      expect(lines.some((line) => line.includes('startup verify failed'))).toBe(true);
    });

    it('treats an unreadable config as invalid (repair flow owns it)', async () => {
      const { deps } = createDeps({
        verifyConfig: () => Promise.reject(new Error('EACCES: permission denied')),
      });
      const { logger } = createCapturingLogger();

      await runStartupConfigVerify(deps, logger);

      expect(machine.getState().status).toBe('repair-needed');
    });

    it('verifies against the current port and token', async () => {
      const getSetupPort = vi.fn(() => PORT);
      const getAuthToken = vi.fn(() => TOKEN);
      const { deps } = createDeps({ getSetupPort, getAuthToken });
      const { logger } = createCapturingLogger();

      await runStartupConfigVerify(deps, logger);

      expect(getSetupPort).toHaveBeenCalledOnce();
      expect(getAuthToken).toHaveBeenCalledOnce();
    });
  });
});
