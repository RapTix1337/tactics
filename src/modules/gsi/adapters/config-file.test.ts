import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateConfigContent, GSI_CONFIG_FILE_NAME } from '../core/config-content';
import { verifyConfig, writeConfig } from './config-file';

const PORT = 42730;
const TOKEN = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0';
const TIMING = 'default';

describe('GSI config file adapter', () => {
  let cfgDir: string;

  beforeEach(() => {
    cfgDir = mkdtempSync(join(tmpdir(), 'tactics-gsi-cfg-'));
  });

  afterEach(() => {
    rmSync(cfgDir, { recursive: true, force: true });
  });

  const configPath = (): string => join(cfgDir, GSI_CONFIG_FILE_NAME);

  describe('verifyConfig', () => {
    it('reports missing when no config exists', async () => {
      await expect(verifyConfig(cfgDir, PORT, TOKEN, TIMING)).resolves.toBe('missing');
    });

    it('reports ok for exactly the expected content', async () => {
      writeFileSync(configPath(), generateConfigContent(PORT, TOKEN, TIMING), 'utf8');

      await expect(verifyConfig(cfgDir, PORT, TOKEN, TIMING)).resolves.toBe('ok');
    });

    it('reports outdated for byte-different content (hand-edited file)', async () => {
      writeFileSync(configPath(), `${generateConfigContent(PORT, TOKEN, TIMING)}\n`, 'utf8');

      await expect(verifyConfig(cfgDir, PORT, TOKEN, TIMING)).resolves.toBe('outdated');
    });

    it('reports outdated when the effective port changed', async () => {
      writeFileSync(configPath(), generateConfigContent(PORT, TOKEN, TIMING), 'utf8');

      await expect(verifyConfig(cfgDir, PORT + 1, TOKEN, TIMING)).resolves.toBe('outdated');
    });

    it('reports outdated when the token changed', async () => {
      writeFileSync(configPath(), generateConfigContent(PORT, TOKEN, TIMING), 'utf8');

      await expect(verifyConfig(cfgDir, PORT, 'regenerated-token', TIMING)).resolves.toBe(
        'outdated',
      );
    });

    it('reports outdated when only the timing profile changed (ADR-051)', async () => {
      writeFileSync(configPath(), generateConfigContent(PORT, TOKEN, 'default'), 'utf8');

      await expect(verifyConfig(cfgDir, PORT, TOKEN, 'fast')).resolves.toBe('outdated');
    });

    it('reports outdated for an old format version (§7.4 — no migration run)', async () => {
      writeFileSync(configPath(), '"TactiCS"\n{\n    "uri" "http://127.0.0.1:42730"\n}\n', 'utf8');

      await expect(verifyConfig(cfgDir, PORT, TOKEN, TIMING)).resolves.toBe('outdated');
    });

    it('reports missing for a vanished cfg directory (CS2 moved/uninstalled)', async () => {
      await expect(verifyConfig(join(cfgDir, 'no-such-dir'), PORT, TOKEN, TIMING)).resolves.toBe(
        'missing',
      );
    });

    it('propagates fs errors other than a missing file', async () => {
      // A directory where the file should be is a real error, not "missing".
      mkdirSync(configPath());

      await expect(verifyConfig(cfgDir, PORT, TOKEN, TIMING)).rejects.toThrow();
    });
  });

  describe('writeConfig', () => {
    it('writes content that verifies as ok', async () => {
      await writeConfig(cfgDir, PORT, TOKEN, TIMING);

      expect(readFileSync(configPath(), 'utf8')).toBe(generateConfigContent(PORT, TOKEN, TIMING));
      await expect(verifyConfig(cfgDir, PORT, TOKEN, TIMING)).resolves.toBe('ok');
    });

    it('replaces an outdated config (same path serves repair, GSI-06)', async () => {
      writeFileSync(configPath(), 'stale content from an old version', 'utf8');

      await writeConfig(cfgDir, PORT, TOKEN, TIMING);

      await expect(verifyConfig(cfgDir, PORT, TOKEN, TIMING)).resolves.toBe('ok');
    });

    it('leaves no temp file behind and touches only the cfg dir', async () => {
      await writeConfig(cfgDir, PORT, TOKEN, TIMING);

      expect(readdirSync(cfgDir)).toEqual([GSI_CONFIG_FILE_NAME]);
    });

    it('cleans up the temp file when the atomic rename fails', async () => {
      // A directory at the target path makes the rename fail after the temp
      // file was written — the cfg dir must not keep the temp file.
      mkdirSync(configPath());

      await expect(writeConfig(cfgDir, PORT, TOKEN, TIMING)).rejects.toThrow();
      expect(readdirSync(cfgDir)).toEqual([GSI_CONFIG_FILE_NAME]);
    });

    it('rejects when the cfg dir does not exist instead of writing elsewhere', async () => {
      await expect(writeConfig(join(cfgDir, 'no-such-dir'), PORT, TOKEN, TIMING)).rejects.toThrow();
      expect(readdirSync(cfgDir)).toEqual([]);
    });
  });
});
