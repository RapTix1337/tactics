import type {
  GameState,
  LogContext,
  Logger,
  ScoreboardState,
  Settings,
  UpdateState,
} from '../../shared';
import {
  appGetSnapshot,
  appOpenExternal,
  appReportRendererError,
  failure,
  success,
} from '../../shared';
import type { CommandRegistrationDeps } from './register-command';
import { describeError, registerCommand } from './register-command';

/**
 * The snapshot's slice providers, injected by the composition root. Grows by
 * one getter per mirror store with its owning task (updates E18.1).
 */
export interface SnapshotDeps {
  readonly getGameState: () => GameState;
  readonly getScoreboardState: () => ScoreboardState;
  readonly getSettings: () => Settings;
  readonly getUpdateState: () => UpdateState;
}

/** `shell.openExternal`-shaped: rejects when the OS handoff fails (E15.3). */
export interface ExternalLinkDeps {
  readonly openExternal: (url: string) => Promise<void>;
}

/**
 * App-level command registrations, called once at startup before the main
 * window exists — no invoke can precede them.
 *
 * @param rendererLogger renderer-scoped logger: reported renderer errors
 * must appear in the log under the `renderer` scope, not the IPC layer's
 * (03-technical-design.md §8.3).
 */
export function registerAppCommands<TEvent>(
  deps: CommandRegistrationDeps<TEvent>,
  rendererLogger: Logger,
  snapshot: SnapshotDeps,
  external: ExternalLinkDeps,
): void {
  registerCommand(deps, appGetSnapshot, () =>
    success({
      gameState: snapshot.getGameState(),
      scoreboard: snapshot.getScoreboardState(),
      settings: snapshot.getSettings(),
      updateState: snapshot.getUpdateState(),
    }),
  );

  // The allowlist check IS the request schema (commands.ts): only contract
  // URLs reach this handler — anything else already failed as INVALID_REQUEST.
  registerCommand(deps, appOpenExternal, async ({ url }) => {
    try {
      await external.openExternal(url);
    } catch (error) {
      deps.logger.error('Opening an external URL failed', { error: describeError(error) });
      return failure('INTERNAL', 'Could not open the link in the default browser.');
    }
    return success(undefined);
  });

  registerCommand(deps, appReportRendererError, (report) => {
    const context: LogContext = {
      ...(report.stack === undefined ? {} : { stack: report.stack }),
      ...(report.route === undefined ? {} : { route: report.route }),
    };
    rendererLogger.error(report.message, context);
    return success(undefined);
  });
}
