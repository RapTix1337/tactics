import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initializeLogging } from './electron-log-logging';
import { exportLogs } from './export-logs';

describe('exportLogs', () => {
  let logDirectory: string;
  let targetDirectory: string;

  beforeEach(() => {
    logDirectory = mkdtempSync(join(tmpdir(), 'tactics-export-logs-'));
    targetDirectory = mkdtempSync(join(tmpdir(), 'tactics-export-target-'));
    initializeLogging({ logDirectory, level: 'info', enableConsole: false });
  });

  afterEach(() => {
    rmSync(logDirectory, { recursive: true, force: true });
    rmSync(targetDirectory, { recursive: true, force: true });
  });

  const targetPath = (): string => join(targetDirectory, 'export.log');

  it('concatenates archives oldest-first, the live log last, with file headers', async () => {
    writeFileSync(join(logDirectory, 'main.log'), 'live line\n');
    writeFileSync(join(logDirectory, 'main.old.1.log'), 'newest archive line\n');
    writeFileSync(join(logDirectory, 'main.old.2.log'), 'oldest archive line\n');

    await exportLogs(targetPath());

    const content = readFileSync(targetPath(), 'utf8');
    const headerOrder = [
      content.indexOf('===== main.old.2.log ====='),
      content.indexOf('===== main.old.1.log ====='),
      content.indexOf('===== main.log ====='),
    ];
    expect(headerOrder.every((index) => index >= 0)).toBe(true);
    expect([...headerOrder].sort((a, b) => a - b)).toEqual(headerOrder);
    expect(content).toContain('oldest archive line');
    expect(content).toContain('newest archive line');
    expect(content).toContain('live line');
  });

  it('skips missing archives and exports the live log alone', async () => {
    writeFileSync(join(logDirectory, 'main.log'), 'only the live log\n');

    await exportLogs(targetPath());

    const content = readFileSync(targetPath(), 'utf8');
    expect(content).toBe('===== main.log =====\nonly the live log\n');
  });

  it('appends the missing trailing newline before the next header', async () => {
    writeFileSync(join(logDirectory, 'main.log'), 'live');
    writeFileSync(join(logDirectory, 'main.old.1.log'), 'archived');

    await exportLogs(targetPath());

    expect(readFileSync(targetPath(), 'utf8')).toBe(
      '===== main.old.1.log =====\narchived\n\n===== main.log =====\nlive\n',
    );
  });

  it('writes an empty export when no log files exist', async () => {
    rmSync(logDirectory, { recursive: true, force: true });
    mkdirSync(logDirectory);

    await exportLogs(targetPath());

    expect(readFileSync(targetPath(), 'utf8')).toBe('');
  });

  it('rejects when the target location is not writable', async () => {
    writeFileSync(join(logDirectory, 'main.log'), 'live line\n');

    await expect(
      exportLogs(join(targetDirectory, 'missing-subdir', 'export.log')),
    ).rejects.toThrow();
  });
});
