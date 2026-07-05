import type { LogContext, Logger } from '../../shared';
import { appGetSnapshot, appReportRendererError, success } from '../../shared';
import type { CommandRegistrationDeps } from './register-command';
import { registerCommand } from './register-command';

/**
 * App-level command registrations, called once at startup before the main
 * window exists — no invoke can precede them. The snapshot response gains
 * one slice per mirror store with its owning task (settings E8.3,
 * gameState E10.7, updates E18.1).
 *
 * @param rendererLogger renderer-scoped logger: reported renderer errors
 * must appear in the log under the `renderer` scope, not the IPC layer's
 * (03-technical-design.md §8.3).
 */
export function registerAppCommands<TEvent>(
  deps: CommandRegistrationDeps<TEvent>,
  rendererLogger: Logger,
): void {
  registerCommand(deps, appGetSnapshot, () => success({}));

  registerCommand(deps, appReportRendererError, (report) => {
    const context: LogContext = {
      ...(report.stack === undefined ? {} : { stack: report.stack }),
      ...(report.route === undefined ? {} : { route: report.route }),
    };
    rendererLogger.error(report.message, context);
    return success(undefined);
  });
}
