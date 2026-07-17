import { z } from 'zod';

/**
 * Tolerant "parse what we need" subset validation (ADR-024, GSI-09): only
 * the fields the app needs are extracted; everything else — including the
 * `auth` token echo and any future Valve additions — is stripped by
 * construction. Malformed input yields a named result, never a throw
 * (05-gsi.md error case 5). The schemas state intent (optional map section,
 * numeric heartbeat timestamp) rather than mirroring the recorded corpus.
 */

// The widened scoreboard subset (SCB.2, design §2.1) is deliberately tolerant:
// every scoreboard field is optional and `.catch`-guarded, so a malformed or
// future-drifted non-essential field degrades to absent instead of failing the
// whole payload. This protects the essential path — `provider.timestamp` (the
// heartbeat) and `map.name` (the match trigger) stay strict — from a widening
// regression: a bad `player.state.money` must never block map-name extraction.
const optionalNumber = z.number().optional().catch(undefined);
const optionalString = z.string().optional().catch(undefined);
const optionalBoolean = z.boolean().optional().catch(undefined);

const teamStateSchema = z
  .object({
    score: optionalNumber,
    consecutive_round_losses: optionalNumber,
    timeouts_remaining: optionalNumber,
  })
  .optional()
  .catch(undefined);

const gsiPayloadSchema = z.object({
  // Present in every payload CS2 sends; its numeric timestamp is the
  // heartbeat context the state machine consumes (E10.3). Deliberately not
  // constrained further (int/range) — tolerance over strictness. `steamid`
  // is the identity anchor (provider vs. player, SCB.5) — never logged,
  // never crosses IPC (ADR-030); optional so old menu payloads still parse.
  provider: z.object({
    timestamp: z.number(),
    steamid: optionalString,
  }),
  // CS2 sends no `map` section in the menus — absence is a valid state,
  // presence with a valid name is the "match running" trigger (ADR-031). The
  // name stays strict; the scoreboard extras are tolerant.
  map: z
    .object({
      name: z.string().min(1),
      mode: optionalString,
      phase: optionalString,
      round: optionalNumber,
      team_ct: teamStateSchema,
      team_t: teamStateSchema,
      round_wins: z.record(z.string(), z.string()).optional().catch(undefined),
    })
    .optional(),
  // Round context (freezetime/live/over, bomb state) — absent in the menus.
  round: z
    .object({
      phase: optionalString,
      bomb: optionalString,
    })
    .optional()
    .catch(undefined),
  // The own/spectated player block — `round_totaldmg` is deliberately absent
  // (ADR-055: CS2 GSI never sends it). No `name` extraction (ADR-030).
  player: z
    .object({
      steamid: optionalString,
      team: optionalString,
      match_stats: z
        .object({
          kills: optionalNumber,
          assists: optionalNumber,
          deaths: optionalNumber,
          mvps: optionalNumber,
          score: optionalNumber,
        })
        .optional()
        .catch(undefined),
      state: z
        .object({
          health: optionalNumber,
          armor: optionalNumber,
          helmet: optionalBoolean,
          money: optionalNumber,
          equip_value: optionalNumber,
          round_kills: optionalNumber,
          round_killhs: optionalNumber,
        })
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
});

/** A team's live scoreboard state (my/enemy side, resolved by SCB.5). */
export interface GsiTeamState {
  readonly score: number | null;
  readonly consecutiveRoundLosses: number | null;
  readonly timeoutsRemaining: number | null;
}

/** The scoreboard-relevant `map` fields; the raw name lives in `mapName`. */
export interface GsiMapState {
  readonly mode: string | null;
  readonly phase: string | null;
  readonly round: number | null;
  readonly teamCt: GsiTeamState | null;
  readonly teamT: GsiTeamState | null;
  /** `round_wins` component: round number (string key) → win-condition tag. */
  readonly roundWins: Readonly<Record<string, string>> | null;
}

/** The `round` context the scoreboard phase badge derives from. */
export interface GsiRoundState {
  readonly phase: string | null;
  readonly bomb: string | null;
}

/** The player's cumulative match stats. */
export interface GsiPlayerMatchStats {
  readonly kills: number | null;
  readonly assists: number | null;
  readonly deaths: number | null;
  readonly mvps: number | null;
  readonly score: number | null;
}

/** The player's live per-round state. */
export interface GsiPlayerRoundState {
  readonly health: number | null;
  readonly armor: number | null;
  readonly helmet: boolean | null;
  readonly money: number | null;
  readonly equipValue: number | null;
  readonly roundKills: number | null;
  readonly roundHsKills: number | null;
}

/**
 * The `player` block. `steamId` is the identity anchor compared against
 * `providerSteamId` (SCB.5) — never logged, never in the outgoing slice.
 */
export interface GsiPlayerState {
  readonly steamId: string | null;
  readonly team: string | null;
  readonly matchStats: GsiPlayerMatchStats | null;
  readonly state: GsiPlayerRoundState | null;
}

/**
 * The validated subset — the only shape leaving the parsing boundary. The
 * scoreboard sections are `null` when the payload omits them (menus,
 * spectator edges); their leaves are `null` when a single field is absent or
 * malformed. No throw — an unparseable body is a named error (below).
 */
export interface GsiPayloadSubset {
  readonly providerTimestamp: number;
  /** Raw map name, or `null` when the payload carries no `map` section. */
  readonly mapName: string | null;
  /** Provider SteamID (identity anchor), or `null` when absent. */
  readonly providerSteamId: string | null;
  /** Scoreboard `map` fields, or `null` when the payload has no `map` section. */
  readonly map: GsiMapState | null;
  /** Round context, or `null` when the payload has no `round` section. */
  readonly round: GsiRoundState | null;
  /** The player block, or `null` when the payload has no `player` section. */
  readonly player: GsiPlayerState | null;
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
  return { ok: true, payload: toSubset(result.data) };
}

type ValidatedPayload = z.infer<typeof gsiPayloadSchema>;

/**
 * Maps the validated Zod shape onto the outgoing subset: raw snake_case keys
 * become camelCase, and every optional (`undefined`) field collapses to `null`
 * so consumers see one consistent absence marker.
 */
function toSubset(data: ValidatedPayload): GsiPayloadSubset {
  return {
    providerTimestamp: data.provider.timestamp,
    mapName: data.map?.name ?? null,
    providerSteamId: data.provider.steamid ?? null,
    map: toMapState(data.map),
    round: toRoundState(data.round),
    player: toPlayerState(data.player),
  };
}

function toMapState(map: ValidatedPayload['map']): GsiMapState | null {
  if (map === undefined) return null;
  return {
    mode: map.mode ?? null,
    phase: map.phase ?? null,
    round: map.round ?? null,
    teamCt: toTeamState(map.team_ct),
    teamT: toTeamState(map.team_t),
    roundWins: map.round_wins ?? null,
  };
}

function toTeamState(team: NonNullable<ValidatedPayload['map']>['team_ct']): GsiTeamState | null {
  if (team === undefined) return null;
  return {
    score: team.score ?? null,
    consecutiveRoundLosses: team.consecutive_round_losses ?? null,
    timeoutsRemaining: team.timeouts_remaining ?? null,
  };
}

function toRoundState(round: ValidatedPayload['round']): GsiRoundState | null {
  if (round === undefined) return null;
  return { phase: round.phase ?? null, bomb: round.bomb ?? null };
}

function toPlayerState(player: ValidatedPayload['player']): GsiPlayerState | null {
  if (player === undefined) return null;
  const stats = player.match_stats;
  const state = player.state;
  return {
    steamId: player.steamid ?? null,
    team: player.team ?? null,
    matchStats:
      stats === undefined
        ? null
        : {
            kills: stats.kills ?? null,
            assists: stats.assists ?? null,
            deaths: stats.deaths ?? null,
            mvps: stats.mvps ?? null,
            score: stats.score ?? null,
          },
    state:
      state === undefined
        ? null
        : {
            health: state.health ?? null,
            armor: state.armor ?? null,
            helmet: state.helmet ?? null,
            money: state.money ?? null,
            equipValue: state.equip_value ?? null,
            roundKills: state.round_kills ?? null,
            roundHsKills: state.round_killhs ?? null,
          },
  };
}

/**
 * Formats a Zod issue from its path and issue metadata only — the received
 * value never enters the string, guaranteeing ban-list-safe issues by
 * construction instead of relying on Zod's message wording.
 */
function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
  if (issue.code === 'invalid_type') {
    return `${path}: expected ${issue.expected}`;
  }
  return `${path}: ${issue.code}`;
}
