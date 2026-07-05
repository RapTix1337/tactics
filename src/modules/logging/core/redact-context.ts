import type { LogContext } from '../../../shared';

/**
 * Defense-in-depth for the ADR-030 privacy ban list: call sites must never
 * pass the GSI auth token, raw GSI payloads, SteamIDs, or player names —
 * this filter additionally redacts context entries whose key matches a
 * banned pattern before anything reaches a transport. Keys are matched, not
 * values: values are opaque and legit keys (e.g., a map `name`) must survive.
 */
const BANNED_KEY_PATTERNS = [/token/i, /steamid/i, /player/i, /payload/i];

export const REDACTED_VALUE = '[redacted]';

/** Returns a copy of the context with banned entries replaced. */
export function redactContext(context: LogContext): LogContext {
  return redactRecord(context, new WeakSet());
}

function isBannedKey(key: string): boolean {
  return BANNED_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function redactRecord(
  record: Readonly<Record<string, unknown>>,
  seen: WeakSet<object>,
): LogContext {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = isBannedKey(key) ? REDACTED_VALUE : redactValue(value, seen);
  }
  return result;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return REDACTED_VALUE;
    }
    seen.add(value);
    return value.map((entry) => redactValue(entry, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return REDACTED_VALUE;
    }
    seen.add(value);
    return redactRecord(value, seen);
  }
  // Class instances (Error, Date, …) pass through unchanged: recursing into
  // them would break their serialization, and the ban list names data that
  // call sites pass as plain fields.
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
