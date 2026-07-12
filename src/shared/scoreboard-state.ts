import { z } from 'zod';

/**
 * The scoreboard slice as it crosses the IPC boundary (live-scoreboard
 * 02-design.md §3.2, ADR-052): payload of `evt:scoreboard.changed` and slice
 * of `app.getSnapshot`. Contract-owned like `game-state.ts`; the scoreboard
 * engine (src/modules/scoreboard) produces exactly this shape and imports
 * these types — one source of truth, no module/contract drift. Deliberately
 * absent by construction: SteamIDs, player names, team names (ADR-030/052).
 */

/** The five display phases of a supported live match (design §3.2). */
export const SCOREBOARD_PHASES = [
  'warmup',
  'freezetime',
  'live',
  'bomb-planted',
  'round-over',
] as const;

export type ScoreboardPhase = (typeof SCOREBOARD_PHASES)[number];

export const TEAM_SIDES = ['CT', 'T'] as const;

export type TeamSide = (typeof TEAM_SIDES)[number];

/** A round from my team's perspective (history strip). */
export const ROUND_OUTCOMES = ['won', 'lost'] as const;

export type RoundOutcome = (typeof ROUND_OUTCOMES)[number];

/** One team's live counters; `null` where GSI omitted the field. */
export interface ScoreboardTeamState {
  readonly side: TeamSide;
  readonly score: number | null;
  readonly lossStreak: number | null;
  readonly timeoutsRemaining: number | null;
}

/** The user's own stats — match totals plus live round state. */
export interface ScoreboardPlayerState {
  readonly kills: number | null;
  readonly assists: number | null;
  readonly deaths: number | null;
  readonly mvps: number | null;
  readonly score: number | null;
  readonly health: number | null;
  readonly armor: number | null;
  readonly helmet: boolean | null;
  readonly money: number | null;
  readonly equipValue: number | null;
  readonly roundKills: number | null;
  readonly roundHsKills: number | null;
}

/** Locally accumulated stats (HS%, HS count); approximate when started mid-match. */
export interface ScoreboardDerivedState {
  readonly approximate: boolean;
  /** `null` until any own kill was observed. */
  readonly hsRatePercent: number | null;
  /** Accumulated headshot kills; `null` until the own player was observed. */
  readonly hsKills: number | null;
}

/**
 * The full slice: inactive outside supported live matches (browse mode,
 * menus, unsupported modes, GSI stale), the match view otherwise.
 */
export type ScoreboardState =
  | { readonly active: false }
  | {
      readonly active: true;
      readonly phase: ScoreboardPhase;
      /** 1-based display round (`map.round` counts completed rounds). */
      readonly roundNumber: number;
      readonly halftimeAfter: number;
      readonly myTeam: ScoreboardTeamState;
      readonly enemyTeam: ScoreboardTeamState;
      readonly roundHistory: readonly RoundOutcome[];
      readonly me: ScoreboardPlayerState;
      readonly derived: ScoreboardDerivedState;
    };

const scoreboardTeamStateSchema = z.object({
  side: z.enum(TEAM_SIDES),
  score: z.number().nullable(),
  lossStreak: z.number().nullable(),
  timeoutsRemaining: z.number().nullable(),
}) satisfies z.ZodType<ScoreboardTeamState>;

const scoreboardPlayerStateSchema = z.object({
  kills: z.number().nullable(),
  assists: z.number().nullable(),
  deaths: z.number().nullable(),
  mvps: z.number().nullable(),
  score: z.number().nullable(),
  health: z.number().nullable(),
  armor: z.number().nullable(),
  helmet: z.boolean().nullable(),
  money: z.number().nullable(),
  equipValue: z.number().nullable(),
  roundKills: z.number().nullable(),
  roundHsKills: z.number().nullable(),
}) satisfies z.ZodType<ScoreboardPlayerState>;

const scoreboardDerivedStateSchema = z.object({
  approximate: z.boolean(),
  hsRatePercent: z.number().nullable(),
  hsKills: z.number().nullable(),
}) satisfies z.ZodType<ScoreboardDerivedState>;

/**
 * Event payload and snapshot slice. The history array is `.readonly()` so
 * the inferred payload type accepts the engine's readonly slices as-is.
 */
export const scoreboardStateSchema = z.discriminatedUnion('active', [
  z.object({ active: z.literal(false) }),
  z.object({
    active: z.literal(true),
    phase: z.enum(SCOREBOARD_PHASES),
    roundNumber: z.number().int().min(1),
    halftimeAfter: z.number().int().min(1),
    myTeam: scoreboardTeamStateSchema,
    enemyTeam: scoreboardTeamStateSchema,
    roundHistory: z.array(z.enum(ROUND_OUTCOMES)).readonly(),
    me: scoreboardPlayerStateSchema,
    derived: scoreboardDerivedStateSchema,
  }),
]) satisfies z.ZodType<ScoreboardState>;
