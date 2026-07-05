import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '../../shared';
import { logsExport, logsOpenDirectory } from '../../shared';
import type { LogsCommandDeps } from './logs-commands';
import { buildExportFileName, registerLogsCommands } from './logs-commands';
import type { CommandRegistrationDeps } from './register-command';

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

interface FakeEvent {
  trusted: boolean;
}

type RegisteredListener = (event: FakeEvent, request: unknown) => Promise<unknown>;

function setup(overrides: Partial<LogsCommandDeps> = {}): {
  handlers: Map<string, RegisteredListener>;
  logs: LogsCommandDeps;
  ipcError: ReturnType<typeof vi.fn>;
} {
  const handlers = new Map<string, RegisteredListener>();
  const ipcError = vi.fn();
  const deps: CommandRegistrationDeps<FakeEvent> = {
    registerHandler: (channel, listener): void => {
      handlers.set(channel, listener);
    },
    isTrustedSender: (event): boolean => event.trusted,
    logger: { ...silentLogger, error: ipcError },
  };
  const logs: LogsCommandDeps = {
    getLogDirectory: vi.fn(() => '/user-data/logs'),
    openPath: vi.fn(() => Promise.resolve('')),
    showSaveDialog: vi.fn(() => Promise.resolve<string | undefined>('/downloads/export.log')),
    exportLogs: vi.fn(() => Promise.resolve()),
    ...overrides,
  };

  registerLogsCommands(deps, logs);

  return { handlers, logs, ipcError };
}

describe('registerLogsCommands', () => {
  describe('logs.openDirectory', () => {
    it('opens the log directory and acknowledges', async () => {
      const { handlers, logs } = setup();

      await expect(
        handlers.get(logsOpenDirectory.channel)?.({ trusted: true }, undefined),
      ).resolves.toEqual({ ok: true, data: undefined });

      expect(logs.openPath).toHaveBeenCalledWith('/user-data/logs');
    });

    it('logs and fails with INTERNAL when the file manager cannot open the path', async () => {
      const { handlers, ipcError } = setup({
        openPath: () => Promise.resolve('no handler for this path'),
      });

      const result = await handlers.get(logsOpenDirectory.channel)?.({ trusted: true }, undefined);

      expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
      expect(ipcError).toHaveBeenCalledWith('Opening the log directory failed', {
        detail: 'no handler for this path',
      });
    });
  });

  describe('logs.export', () => {
    it('writes the export to the chosen path and returns it', async () => {
      const { handlers, logs } = setup();

      await expect(
        handlers.get(logsExport.channel)?.({ trusted: true }, undefined),
      ).resolves.toEqual({
        ok: true,
        data: { status: 'saved', filePath: '/downloads/export.log' },
      });

      expect(logs.exportLogs).toHaveBeenCalledWith('/downloads/export.log');
    });

    it('suggests a dated default file name to the save dialog', async () => {
      const { handlers, logs } = setup();

      await handlers.get(logsExport.channel)?.({ trusted: true }, undefined);

      expect(logs.showSaveDialog).toHaveBeenCalledWith(
        expect.stringMatching(/^tactics-logs-\d{4}-\d{2}-\d{2}\.log$/),
      );
    });

    it('returns a clean canceled result without writing when the dialog is dismissed', async () => {
      const { handlers, logs } = setup({
        showSaveDialog: () => Promise.resolve(undefined),
      });

      await expect(
        handlers.get(logsExport.channel)?.({ trusted: true }, undefined),
      ).resolves.toEqual({ ok: true, data: { status: 'canceled' } });

      expect(logs.exportLogs).not.toHaveBeenCalled();
    });

    it('logs and fails with EXPORT_FAILED when the write fails', async () => {
      const { handlers, ipcError } = setup({
        exportLogs: () => Promise.reject(new Error('EACCES: permission denied')),
      });

      const result = await handlers.get(logsExport.channel)?.({ trusted: true }, undefined);

      expect(result).toMatchObject({ ok: false, error: { code: 'EXPORT_FAILED' } });
      expect(ipcError).toHaveBeenCalledWith('Writing the log export failed', {
        error: 'Error: EACCES: permission denied',
      });
    });
  });
});

describe('buildExportFileName', () => {
  it('formats the date with zero padding', () => {
    expect(buildExportFileName(new Date(2026, 6, 5))).toBe('tactics-logs-2026-07-05.log');
  });
});
