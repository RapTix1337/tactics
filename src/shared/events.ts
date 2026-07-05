import type { AnyEventDefinition } from './contract';

/**
 * The contract's event definitions, keyed by domain — the counterpart of
 * `ContractCommandDefinitions`. Empty until the first event lands with its
 * owning task (settings E8.3, gameState E10.7, updates E18.1); each entry
 * pairs a domain with its `defineEvent` definition.
 */
export type ContractEventDefinitions = Record<never, AnyEventDefinition>;
