import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_ARCHIVE_COUNT } from './archive-rotation';
import {
  createLogger,
  getLogDirectory,
  initializeLogging,
  MAX_LOG_FILE_SIZE_BYTES,
} from './electron-log-logging';

describe('electron-log adapter', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'tactics-logging-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const liveLog = (): string => join(directory, 'main.log');
  const readLiveLog = (): string => readFileSync(liveLog(), 'utf8');

  it('throws when used before initialization', async () => {
    vi.resetModules();
    const fresh = await import('./electron-log-logging');
    expect(() => {
      fresh.createLogger('app').info('too early');
    }).toThrow('initializeLogging must be called');
    expect(() => fresh.getLogDirectory()).toThrow('initializeLogging must be called');
  });

  it('writes lines with timestamp, level, scope, message, and context', () => {
    initializeLogging({ logDirectory: directory, level: 'info', enableConsole: false });

    createLogger('ipc').info('Command handled', { command: 'app.getSnapshot', durationMs: 3 });

    const lines = readLiveLog().trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[info\] \[ipc\] Command handled \{ command: 'app\.getSnapshot', durationMs: 3 \}$/,
    );
  });

  it('suppresses debug lines at level info and writes them at level debug', () => {
    initializeLogging({ logDirectory: directory, level: 'info', enableConsole: false });
    const logger = createLogger('app');

    logger.debug('hidden');
    logger.warn('visible');
    expect(readLiveLog()).not.toContain('hidden');
    expect(readLiveLog()).toContain('[warn] [app] visible');

    initializeLogging({ logDirectory: directory, level: 'debug', enableConsole: false });
    createLogger('app').debug('now visible');
    expect(readLiveLog()).toContain('[debug] [app] now visible');
  });

  it('redacts banned context keys before writing (ADR-030 ban list)', () => {
    initializeLogging({ logDirectory: directory, level: 'info', enableConsole: false });

    createLogger('gsi').warn('Rejected payload', {
      reason: 'wrong token',
      token: 'super-secret',
      details: { steamId: '7656119...' },
    });

    const content = readLiveLog();
    expect(content).toContain("reason: 'wrong token'");
    expect(content).toContain("token: '[redacted]'");
    expect(content).toContain("steamId: '[redacted]'");
    expect(content).not.toContain('super-secret');
    expect(content).not.toContain('7656119');
  });

  it('rotates past the size cap and keeps at most five archives', () => {
    const maxFileSizeBytes = 512;
    initializeLogging({
      logDirectory: directory,
      level: 'info',
      enableConsole: false,
      maxFileSizeBytes,
    });
    const logger = createLogger('app');

    // Each line is ~100 bytes; 100 lines force well over five rotations.
    for (let index = 0; index < 100; index += 1) {
      logger.info(`filler line ${String(index)} ${'x'.repeat(60)}`);
    }

    const files = readdirSync(directory).sort();
    expect(files).toContain('main.log');
    const archives = files.filter((name) => name.startsWith('main.old.'));
    expect(archives.length).toBeGreaterThanOrEqual(1);
    expect(archives.length).toBeLessThanOrEqual(MAX_ARCHIVE_COUNT);
    // The live file never grows far past the cap (one line of slack).
    expect(statSync(liveLog()).size).toBeLessThan(maxFileSizeBytes + 200);
  });

  it('exposes the configured log directory and a 5 MB production cap', () => {
    initializeLogging({ logDirectory: directory, level: 'info', enableConsole: false });
    expect(getLogDirectory()).toBe(directory);
    expect(MAX_LOG_FILE_SIZE_BYTES).toBe(5 * 1024 * 1024);
    expect(existsSync(directory)).toBe(true);
  });
});
