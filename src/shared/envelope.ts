import type { ErrorCode } from './error-codes';

/**
 * The response envelope every command returns (ADR-032):
 * `{ ok: true, data } | { ok: false, error: { code, message } }`.
 */
export interface CommandError {
  readonly code: ErrorCode;
  readonly message: string;
}

export type CommandResult<TData> =
  | { readonly ok: true; readonly data: TData }
  | { readonly ok: false; readonly error: CommandError };

export function success<TData>(data: TData): CommandResult<TData> {
  return { ok: true, data };
}

/**
 * @param code machine-readable error code the renderer branches on.
 * @param message user-presentable — no stack traces or internals (ADR-025).
 */
export function failure(code: ErrorCode, message: string): CommandResult<never> {
  return { ok: false, error: { code, message } };
}
