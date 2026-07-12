/**
 * The scoreboard module surface (ADR-052). A pure-core module: the engine
 * consumes `LiveMatchInput` observations the `app` wiring maps from the gsi
 * subset (SCB.7) and exposes the `ScoreboardState` slice.
 */
export {
  createScoreboardEngine,
  type RoundOutcome,
  type ScoreboardDerivedState,
  type ScoreboardEngine,
  type ScoreboardPhase,
  type ScoreboardPlayerState,
  type ScoreboardState,
  type ScoreboardTeamState,
  type TeamSide,
} from './core/engine';
export type {
  LiveMatchInput,
  LiveMatchMap,
  LiveMatchPlayer,
  LiveMatchPlayerMatchStats,
  LiveMatchPlayerRoundState,
  LiveMatchRound,
  LiveMatchTeam,
} from './core/input';
