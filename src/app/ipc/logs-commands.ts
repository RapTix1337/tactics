import { failure, logsExport, logsOpenDirectory, success } from '../../shared';
import type { CommandRegistrationDeps } from './register-command';
import { describeError, registerCommand } from './register-command';

/**
 * Dependencies of the log commands (E6.3, PRV-04) as narrow structural
 * interfaces (the E3.1/E5.2 pattern) — the Electron-backed implementations
 * live in electron-ipc.ts.
 */
export interface LogsCommandDeps {
  /** The directory holding the live log and its archives (logging module). */
  readonly getLogDirectory: () => string;
  /** `shell.openPath`-shaped: resolves to `''` on success, else an error description. */
  readonly openPath: (path: string) => Promise<string>;
  /** Native save dialog: resolves to the chosen path, or undefined on cancel. */
  readonly showSaveDialog: (defaultFileName: string) => Promise<string | undefined>;
  /** Writes the export file to the chosen path (logging module). */
  readonly exportLogs: (targetPath: string) => Promise<void>;
}

/** `tactics-logs-<yyyy-mm-dd>.log` — the save dialog's suggested file name. */
export function buildExportFileName(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const day = `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `tactics-logs-${day}.log`;
}

/**
 * Registers `logs.openDirectory` and `logs.export` (03-technical-design.md
 * §5.3). The export write is consent-gated by the save dialog itself — the
 * user picks the target, main writes nothing without that choice (ADR-025).
 */
export function registerLogsCommands<TEvent>(
  deps: CommandRegistrationDeps<TEvent>,
  logs: LogsCommandDeps,
): void {
  registerCommand(deps, logsOpenDirectory, async () => {
    const openError = await logs.openPath(logs.getLogDirectory());
    if (openError !== '') {
      deps.logger.error('Opening the log directory failed', { detail: openError });
      return failure('INTERNAL', 'Could not open the log directory.');
    }
    return success(undefined);
  });

  registerCommand(deps, logsExport, async () => {
    const targetPath = await logs.showSaveDialog(buildExportFileName(new Date()));
    if (targetPath === undefined) {
      // Cancel is a regular outcome, not an error (E6.3 acceptance criterion).
      return success({ status: 'canceled' } as const);
    }
    try {
      await logs.exportLogs(targetPath);
    } catch (error) {
      deps.logger.error('Writing the log export failed', { error: describeError(error) });
      return failure('EXPORT_FAILED', 'Could not write the log export to the selected location.');
    }
    return success({ status: 'saved', filePath: targetPath } as const);
  });
}
