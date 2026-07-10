import { z } from 'zod';

/**
 * Tolerant "parse what we need" subset validation (ADR-024, GSI-09): only
 * the fields the app needs are extracted; everything else — including the
 * `auth` token echo and any future Valve additions — is stripped by
 * construction. Malformed input yields a named result, never a throw
 * (05-gsi.md error case 5). The schemas state intent (optional map section,
 * numeric heartbeat timestamp) rather than mirroring the recorded corpus.
 */

const gsiPayloadSchema = z.object({
  // Present in every payload CS2 sends; its numeric timestamp is the
  // heartbeat context the state machine consumes (E10.3). Deliberately not
  // constrained further (int/range) — tolerance over strictness.
  provider: z.object({
    timestamp: z.number(),
  }),
  // CS2 sends no `map` section in the menus — absence is a valid state,
  // presence with a valid name is the "match running" trigger (ADR-031).
  map: z
    .object({
      name: z.string().min(1),
    })
    .optional(),
});

/** The validated subset — the only shape leaving the parsing boundary. */
export interface GsiPayloadSubset {
  readonly providerTimestamp: number;
  /** Raw map name, or `null` when the payload carries no `map` section. */
  readonly mapName: string | null;
}

export type GsiPayloadErrorCode = 'NOT_JSON' | 'INVALID_SHAPE';

export interface GsiPayloadError {
  readonly code: GsiPayloadErrorCode;
  /**
   * Path/shape descriptions only (e.g. `provider.timestamp: expected
   * number`) — never received values, so the issues are loggable under the
   * ADR-030 ban list.
   */
  readonly issues: readonly string[];
}

export type GsiPayloadParseResult =
  | { readonly ok: true; readonly payload: GsiPayloadSubset }
  | { readonly ok: false; readonly error: GsiPayloadError };

/**
 * Parses a raw GSI request body into the needed subset. Takes the unparsed
 * body so the whole tolerance boundary — JSON syntax and shape — lives here;
 * the HTTP intake adapter (E10.4) stays a pure sink.
 */
export function parseGsiPayload(rawBody: string): GsiPayloadParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: { code: 'NOT_JSON', issues: ['body is not valid JSON'] } };
  }
  const result = gsiPayloadSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: { code: 'INVALID_SHAPE', issues: result.error.issues.map(formatIssue) },
    };
  }
  return {
    ok: true,
    payload: {
      providerTimestamp: result.data.provider.timestamp,
      mapName: result.data.map?.name ?? null,
    },
  };
}

/**
 * Formats a Zod issue from its path and issue metadata only — the received
 * value never enters the string, guaranteeing ban-list-safe issues by
 * construction instead of relying on Zod's message wording.
 */
function formatIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
  if (issue.code === 'invalid_type') {
    return `${path}: expected ${issue.expected}`;
  }
  return `${path}: ${issue.code}`;
}
