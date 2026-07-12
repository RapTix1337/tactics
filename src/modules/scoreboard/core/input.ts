/**
 * The scoreboard module's own input model (ADR-052, design §2.2): a
 * near-identity mirror of the gsi payload subset, owned here so this module
 * never imports `gsi` types (ADR-021). The `app` wiring pays the mapping
 * price once at composition (SCB.7). As in the subset, `null` is the single
 * absence marker — a missing section nulls the section, a missing leaf nulls
 * the leaf.
 */

/** One team's live counters from the `map` section (side resolved later). */
export interface LiveMatchTeam {
  readonly score: number | null;
  readonly consecutiveRoundLosses: number | null;
  readonly timeoutsRemaining: number | null;
}

/** The `map`-section fields the engine consumes. */
export interface LiveMatchMap {
  readonly mode: string | null;
  readonly phase: string | null;
  /** Completed rounds — CS2 increments this when a round ends. */
  readonly round: number | null;
  readonly teamCt: LiveMatchTeam | null;
  readonly teamT: LiveMatchTeam | null;
  /** `round_wins`: round number (string key) → win-condition tag (SCB.6). */
  readonly roundWins: Readonly<Record<string, string>> | null;
}

/** The `round`-section context (phase badge, bomb state). */
export interface LiveMatchRound {
  readonly phase: string | null;
  readonly bomb: string | null;
}

/** The player's cumulative match stats. */
export interface LiveMatchPlayerMatchStats {
  readonly kills: number | null;
  readonly assists: number | null;
  readonly deaths: number | null;
  readonly mvps: number | null;
  readonly score: number | null;
}

/** The player's live per-round state. */
export interface LiveMatchPlayerRoundState {
  readonly health: number | null;
  readonly armor: number | null;
  readonly helmet: boolean | null;
  readonly money: number | null;
  readonly equipValue: number | null;
  readonly roundKills: number | null;
  readonly roundHsKills: number | null;
}

/**
 * The `player` block — the *own or spectated* player. `steamId` is compared
 * against `providerSteamId` transiently (identity filter); it never enters
 * the outgoing state or a log line (ADR-030).
 */
export interface LiveMatchPlayer {
  readonly steamId: string | null;
  readonly team: string | null;
  readonly matchStats: LiveMatchPlayerMatchStats | null;
  readonly state: LiveMatchPlayerRoundState | null;
}

/** One validated GSI observation, mapped by the app wiring. */
export interface LiveMatchInput {
  /** Raw map name, or `null` when CS2 is in the menus. */
  readonly mapName: string | null;
  /** Identity anchor for the own-player filter, or `null` when absent. */
  readonly providerSteamId: string | null;
  readonly map: LiveMatchMap | null;
  readonly round: LiveMatchRound | null;
  readonly player: LiveMatchPlayer | null;
}
