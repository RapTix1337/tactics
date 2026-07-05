import type { z } from 'zod';

/**
 * Typed command/event definition helpers (ADR-022/032). A definition binds a
 * name to its Zod schemas and derives the native channel; both processes
 * compile against the same definition object, so request/response/payload
 * types are inferred — never declared twice.
 *
 * Channel scheme (03-technical-design.md §5.1):
 * commands `cmd:<domain>.<action>`, events `evt:<domain>.changed`.
 */
export type CommandName = `${string}.${string}`;
export type CommandChannel<TName extends CommandName> = `cmd:${TName}`;
export type EventChannel<TDomain extends string> = `evt:${TDomain}.changed`;

export interface CommandDefinition<
  TName extends CommandName,
  TRequestSchema extends z.ZodType,
  TResponseSchema extends z.ZodType,
> {
  readonly name: TName;
  readonly channel: CommandChannel<TName>;
  readonly requestSchema: TRequestSchema;
  readonly responseSchema: TResponseSchema;
}

export interface EventDefinition<TDomain extends string, TPayloadSchema extends z.ZodType> {
  readonly domain: TDomain;
  readonly channel: EventChannel<TDomain>;
  readonly payloadSchema: TPayloadSchema;
}

export function defineCommand<
  TName extends CommandName,
  TRequestSchema extends z.ZodType,
  TResponseSchema extends z.ZodType,
>(
  name: TName,
  requestSchema: TRequestSchema,
  responseSchema: TResponseSchema,
): CommandDefinition<TName, TRequestSchema, TResponseSchema> {
  return { name, channel: `cmd:${name}`, requestSchema, responseSchema };
}

export function defineEvent<TDomain extends string, TPayloadSchema extends z.ZodType>(
  domain: TDomain,
  payloadSchema: TPayloadSchema,
): EventDefinition<TDomain, TPayloadSchema> {
  return { domain, channel: `evt:${domain}.changed`, payloadSchema };
}

/** Constraint aliases for infrastructure generic over the whole contract (app/ipc, preload). */
export type AnyCommandDefinition = CommandDefinition<CommandName, z.ZodType, z.ZodType>;
export type AnyEventDefinition = EventDefinition<string, z.ZodType>;

export type CommandRequest<TDef extends AnyCommandDefinition> = z.infer<TDef['requestSchema']>;
export type CommandResponse<TDef extends AnyCommandDefinition> = z.infer<TDef['responseSchema']>;
export type EventPayload<TDef extends AnyEventDefinition> = z.infer<TDef['payloadSchema']>;
