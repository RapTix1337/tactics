/**
 * Tolerant parser for Valve's KeyValues text format — the shared format of
 * `libraryfolders.vdf` and `appmanifest_*.acf` (risk T4). Malformed input
 * yields a named result, never a throw (E9.1 acceptance). Tolerated quirks:
 * BOM, CRLF, `//` comments, unquoted tokens, `\\`/`\"` escapes (unknown
 * escape sequences pass through literally, covering files written without
 * escaping), duplicate keys (last wins). Values are returned as a `Map` so
 * hostile keys like `__proto__` stay plain data. Issues carry only line
 * numbers and fixed phrases — never file content, so a broken manifest's
 * `LastOwner` SteamID cannot leak into logs (ADR-030).
 */

export type KeyValuesValue = string | KeyValuesBlock;

export type KeyValuesBlock = ReadonlyMap<string, KeyValuesValue>;

export interface KeyValuesError {
  readonly code: 'NOT_KEYVALUES';
  readonly issues: readonly string[];
}

export type KeyValuesParseResult =
  | { readonly ok: true; readonly root: KeyValuesBlock }
  | { readonly ok: false; readonly error: KeyValuesError };

interface Token {
  readonly kind: 'string' | 'open' | 'close';
  readonly value: string;
  readonly line: number;
}

/** Parses KeyValues text into a tree of blocks and string values. */
export function parseKeyValues(text: string): KeyValuesParseResult {
  const tokenized = tokenize(text);
  if ('issue' in tokenized) {
    return notKeyValues(tokenized.issue);
  }

  const root = new Map<string, KeyValuesValue>();
  const parents: Map<string, KeyValuesValue>[] = [];
  let current = root;
  let pendingKey: string | null = null;

  for (const token of tokenized.tokens) {
    switch (token.kind) {
      case 'string':
        if (pendingKey === null) {
          pendingKey = token.value;
        } else {
          current.set(pendingKey, token.value);
          pendingKey = null;
        }
        break;
      case 'open': {
        if (pendingKey === null) {
          return notKeyValues(`line ${token.line}: block without a preceding key`);
        }
        const child = new Map<string, KeyValuesValue>();
        current.set(pendingKey, child);
        parents.push(current);
        current = child;
        pendingKey = null;
        break;
      }
      case 'close': {
        if (pendingKey !== null) {
          return notKeyValues(`line ${token.line}: key without a value before closing brace`);
        }
        const parent = parents.pop();
        if (parent === undefined) {
          return notKeyValues(`line ${token.line}: closing brace without an open block`);
        }
        current = parent;
        break;
      }
    }
  }

  if (pendingKey !== null) {
    return notKeyValues('key without a value at end of input');
  }
  if (parents.length > 0) {
    return notKeyValues('unclosed block at end of input');
  }
  return { ok: true, root };
}

/**
 * Case-insensitive lookup — Valve tooling treats KeyValues keys as
 * case-insensitive and real files mix casings (`AppState` vs
 * `libraryfolders`). Last match wins, consistent with duplicate-key
 * handling in the parser.
 */
export function getCaseInsensitive(block: KeyValuesBlock, key: string): KeyValuesValue | undefined {
  const wanted = key.toLowerCase();
  let found: KeyValuesValue | undefined;
  for (const [candidate, value] of block) {
    if (candidate.toLowerCase() === wanted) {
      found = value;
    }
  }
  return found;
}

function notKeyValues(issue: string): { ok: false; error: KeyValuesError } {
  return { ok: false, error: { code: 'NOT_KEYVALUES', issues: [issue] } };
}

function tokenize(text: string): { tokens: Token[] } | { issue: string } {
  const tokens: Token[] = [];
  // 0xfeff: skip a UTF-8 BOM if present.
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  while (index < text.length) {
    const char = text[index];
    if (char === '\n') {
      line += 1;
      index += 1;
    } else if (char === ' ' || char === '\t' || char === '\r' || char === '\v' || char === '\f') {
      index += 1;
    } else if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') {
        index += 1;
      }
    } else if (char === '{') {
      tokens.push({ kind: 'open', value: '{', line });
      index += 1;
    } else if (char === '}') {
      tokens.push({ kind: 'close', value: '}', line });
      index += 1;
    } else if (char === '"') {
      const startLine = line;
      let value = '';
      index += 1;
      for (;;) {
        if (index >= text.length) {
          return { issue: `line ${startLine}: unterminated quoted string` };
        }
        const c = text[index];
        if (c === '"') {
          index += 1;
          break;
        }
        if (c === '\n') {
          line += 1;
        }
        if (c === '\\') {
          const next = text[index + 1];
          if (next === undefined) {
            return { issue: `line ${startLine}: unterminated quoted string` };
          }
          if (next === '\n') {
            line += 1;
          }
          value += unescape(next);
          index += 2;
        } else {
          value += c;
          index += 1;
        }
      }
      tokens.push({ kind: 'string', value, line: startLine });
    } else {
      const start = index;
      for (let c = text[index]; c !== undefined && !isTokenBoundary(c); c = text[index]) {
        index += 1;
      }
      tokens.push({ kind: 'string', value: text.slice(start, index), line });
    }
  }
  return { tokens };
}

function unescape(next: string): string {
  switch (next) {
    case 'n':
      return '\n';
    case 't':
      return '\t';
    case '"':
      return '"';
    case '\\':
      return '\\';
    default:
      // Files written without escape processing contain lone backslashes
      // (e.g. `D:\Lib`); keep the sequence literal instead of failing.
      return `\\${next}`;
  }
}

function isTokenBoundary(char: string): boolean {
  return (
    char === ' ' ||
    char === '\t' ||
    char === '\r' ||
    char === '\n' ||
    char === '\v' ||
    char === '\f' ||
    char === '{' ||
    char === '}' ||
    char === '"'
  );
}
