import type { ContractBridge } from '../../shared/bridge';
import type {
  AnyCommandDefinition,
  AnyEventDefinition,
  CommandRequest,
  CommandResponse,
  EventPayload,
} from '../../shared/contract';
import type { CommandResult } from '../../shared/envelope';

/**
 * The bridge factory — testable core of the preload (the E3.1/E5.2 pattern):
 * `ipcRenderer` is injected as a narrow structural interface; the
 * contextBridge wiring lives in index.ts. Channels come exclusively from the
 * closed name lists — unknown names throw before any channel is reached, so
 * there is no generic passthrough (ADR-022/025). No validation here by
 * design: main validates every request (E5.2) and guarantees the envelope.
 */
export interface BridgeIpc {
  invoke(channel: string, input: unknown): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  off(channel: string, listener: (event: unknown, payload: unknown) => void): void;
}

export function createBridge<
  TCommands extends { [K in keyof TCommands]: AnyCommandDefinition },
  TEvents extends { [K in keyof TEvents]: AnyEventDefinition },
>(
  ipc: BridgeIpc,
  commandNames: readonly (keyof TCommands & string)[],
  eventDomains: readonly (keyof TEvents & string)[],
): ContractBridge<TCommands, TEvents> {
  const commandChannels = new Map<string, string>(
    commandNames.map((name) => [name, `cmd:${name}`]),
  );
  const eventChannels = new Map<string, string>(
    eventDomains.map((domain) => [domain, `evt:${domain}.changed`]),
  );

  return {
    invoke: <TName extends keyof TCommands & string>(
      command: TName,
      input: CommandRequest<TCommands[TName]>,
    ): Promise<CommandResult<CommandResponse<TCommands[TName]>>> => {
      const channel = commandChannels.get(command);
      if (channel === undefined) {
        throw new Error(`Unknown command: ${command}`);
      }
      // The envelope shape is main's guarantee (E5.2); the preload projects
      // it without validating, so the cast is the design, not a shortcut.
      return ipc.invoke(channel, input) as Promise<
        CommandResult<CommandResponse<TCommands[TName]>>
      >;
    },
    subscribe: <TDomain extends keyof TEvents & string>(
      event: TDomain,
      handler: (payload: EventPayload<TEvents[TDomain]>) => void,
    ): (() => void) => {
      const channel = eventChannels.get(event);
      if (channel === undefined) {
        throw new Error(`Unknown event: ${event}`);
      }
      // One wrapper per subscription, so unsubscribing removes exactly this
      // handler; the IPC event object never crosses into the renderer.
      const listener = (_event: unknown, payload: unknown): void => {
        handler(payload as EventPayload<TEvents[TDomain]>);
      };
      ipc.on(channel, listener);
      return (): void => {
        ipc.off(channel, listener);
      };
    },
  };
}
