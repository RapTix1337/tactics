import type { z } from 'zod';

import type {
  AnyCommandDefinition,
  CommandRequest,
  CommandResponse,
  CommandResult,
  Logger,
} from '../../shared';
import { failure } from '../../shared';

// One shared message for both INTERNAL paths (rejection and thrown handler):
// an untrusted caller must not be able to tell them apart (ADR-025).
const INTERNAL_MESSAGE = 'An unexpected error occurred.';

/**
 * Command registration flow (ADR-022/032, 03-technical-design.md §2.4):
 * sender check → Zod parse → dispatch → envelope response. Dependencies are
 * injected as narrow structural interfaces so the flow is testable without
 * Electron (the E3.1 pattern); the `ipcMain`-backed dependencies live in
 * electron-ipc.ts.
 */
export interface CommandRegistrationDeps<TEvent> {
  /** `ipcMain.handle`-shaped registration point. */
  registerHandler(
    channel: string,
    listener: (event: TEvent, request: unknown) => Promise<unknown>,
  ): void;
  /** ADR-025: only the app's own windows may invoke commands. */
  isTrustedSender(event: TEvent): boolean;
  logger: Logger;
}

/**
 * A command handler receives the validated request and returns the envelope;
 * named failures are returned via `failure(...)`, never thrown. Anything
 * thrown is a bug and surfaces as `INTERNAL`.
 */
export type CommandHandler<TDefinition extends AnyCommandDefinition> = (
  request: CommandRequest<TDefinition>,
) =>
  | CommandResult<CommandResponse<TDefinition>>
  | Promise<CommandResult<CommandResponse<TDefinition>>>;

/**
 * Wires one contract command to the IPC handle point. The channel comes
 * exclusively from the contract definition — there is no way to register a
 * free-form channel through this door (E5.2 acceptance criterion).
 */
export function registerCommand<TEvent, TDefinition extends AnyCommandDefinition>(
  deps: CommandRegistrationDeps<TEvent>,
  definition: TDefinition,
  handler: CommandHandler<TDefinition>,
): void {
  deps.registerHandler(definition.channel, async (event, request): Promise<unknown> => {
    if (!deps.isTrustedSender(event)) {
      deps.logger.warn('Rejected command invocation from untrusted sender', {
        command: definition.name,
      });
      return failure('INTERNAL', INTERNAL_MESSAGE);
    }

    const parsed = definition.requestSchema.safeParse(request);
    if (!parsed.success) {
      deps.logger.warn('Command request failed validation', {
        command: definition.name,
        // Issue paths only — request contents never reach a log line (ADR-030).
        issuePaths: formatIssuePaths(parsed.error),
      });
      return failure('INVALID_REQUEST', `Invalid request for ${definition.name}.`);
    }

    try {
      // safeParse on the abstract schema type widens the output to unknown;
      // the value is by construction the definition's request type.
      return await handler(parsed.data as CommandRequest<TDefinition>);
    } catch (error) {
      deps.logger.error('Command handler threw unexpectedly', {
        command: definition.name,
        error: describeError(error),
      });
      return failure('INTERNAL', INTERNAL_MESSAGE);
    }
  });
}

function formatIssuePaths(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) =>
    issue.path.length === 0 ? '<root>' : issue.path.map(String).join('.'),
  );
}

/** One-line error description for log contexts — never a stack trace. */
export function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
