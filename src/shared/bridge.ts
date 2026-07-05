import type { ContractCommandDefinitions } from './commands';
import type {
  AnyCommandDefinition,
  AnyEventDefinition,
  CommandRequest,
  CommandResponse,
  EventPayload,
} from './contract';
import type { CommandResult } from './envelope';
import type { ContractEventDefinitions } from './events';

/**
 * The renderer-facing bridge surface (ADR-022/025, 03-technical-design.md
 * §2.3): exactly `invoke` and `subscribe`, a 1:1 projection of the contract.
 * The type lives in `shared` because `ui` may import only `shared`
 * (ADR-021) and types `window.tactics` against it (E5.4); the
 * implementation is the preload's (src/app/preload/bridge.ts).
 */
export interface ContractBridge<
  // Mapped-type constraints (not Record<string, …>) so plain interfaces
  // like ContractCommandDefinitions qualify without an index signature.
  TCommands extends { [K in keyof TCommands]: AnyCommandDefinition },
  TEvents extends { [K in keyof TEvents]: AnyEventDefinition },
> {
  // Function properties, not methods: the bridge crosses contextBridge,
  // so `this` must never matter on either side.
  readonly invoke: <TName extends keyof TCommands & string>(
    command: TName,
    input: CommandRequest<TCommands[TName]>,
  ) => Promise<CommandResult<CommandResponse<TCommands[TName]>>>;
  /** Returns the unsubscribe function for exactly this subscription. */
  readonly subscribe: <TDomain extends keyof TEvents & string>(
    event: TDomain,
    handler: (payload: EventPayload<TEvents[TDomain]>) => void,
  ) => () => void;
}

export type TacticsBridge = ContractBridge<ContractCommandDefinitions, ContractEventDefinitions>;
