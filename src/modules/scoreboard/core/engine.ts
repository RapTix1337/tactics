import type { Logger } from '../../../shared';
import { isOwnPlayer } from './identity';
import type {
  LiveMatchInput,
  LiveMatchMap,
  LiveMatchPlayerMatchStats,
  LiveMatchPlayerRoundState,
  LiveMatchRound,
  LiveMatchTeam,
} from './input';
import { resolveModeRules } from './modes';

/**
 * The scoreboard state machine (ADR-052, design §2.2): consumes
 * `LiveMatchInput` observations, holds the own-player snapshot across the
 * dead-spectate flip, gates by mode, and notifies listeners only on
 * structural change (02-architecture §4.2 — CS2 posts several times per
 * second, the slice changes rarely). `roundHistory` and `derived` are the
 * SCB.6 stubs: empty history, `approximate` by construction (no
 * accumulation exists yet), no HS rate.
 */

/** The five display phases of the slice (design §3.2). */
export type ScoreboardPhase = 'warmup' | 'freezetime' | 'live' | 'bomb-planted' | 'round-over';

export type TeamSide = 'CT' | 'T';

/** A round from my team's perspective (filled by SCB.6). */
export type RoundOutcome = 'won' | 'lost';

export interface ScoreboardTeamState {
  readonly side: TeamSide;
  readonly score: number | null;
  readonly lossStreak: number | null;
  readonly timeoutsRemaining: number | null;
}

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

export interface ScoreboardDerivedState {
  readonly approximate: boolean;
  readonly hsRatePercent: number | null;
}

/**
 * The outgoing slice — deliberately free of SteamIDs, player names, and team
 * names (ADR-030/052); SCB.7 lifts this shape into the shared IPC contract.
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

export interface ScoreboardEngine {
  /** Feeds one validated observation (mapped by the app wiring, SCB.7). */
  handleInput(input: LiveMatchInput): void;
  /** GSI went stale or back to the menus: deactivate and start fresh. */
  notifyGsiInactive(): void;
  getState(): ScoreboardState;
  /** Subscribes to structural-change notifications; returns an unsubscribe. */
  onStateChanged(listener: (state: ScoreboardState) => void): () => void;
  /** Stops all transitions and notifications. */
  dispose(): void;
}

const INACTIVE: ScoreboardState = { active: false };

export function createScoreboardEngine(deps: { logger: Logger }): ScoreboardEngine {
  // Own-player tracking survives foreign (dead-spectate) payloads and is
  // dropped whenever the match context ends: map change, menus, GSI
  // inactivity. Full match-reset detection (round/total regression) is SCB.6.
  let ownSide: TeamSide | null = null;
  let ownMatchStats: LiveMatchPlayerMatchStats | null = null;
  let ownRoundState: LiveMatchPlayerRoundState | null = null;
  let lastMapName: string | null = null;
  let lastUnsupportedMode: string | null = null;

  let state: ScoreboardState = INACTIVE;
  let disposed = false;
  const listeners = new Set<(state: ScoreboardState) => void>();

  function clearOwnTracking(): void {
    ownSide = null;
    ownMatchStats = null;
    ownRoundState = null;
  }

  function commit(next: ScoreboardState): void {
    if (statesEqual(state, next)) return;
    state = next;
    for (const listener of [...listeners]) listener(state);
  }

  function trackOwnPlayer(input: LiveMatchInput): void {
    if (input.player === null || !isOwnPlayer(input.providerSteamId, input.player.steamId)) {
      return;
    }
    const side = parseSide(input.player.team);
    if (side !== null) ownSide = side;
    if (input.player.matchStats !== null) ownMatchStats = input.player.matchStats;
    if (input.player.state !== null) ownRoundState = input.player.state;
  }

  function deriveState(input: LiveMatchInput): ScoreboardState {
    if (input.mapName === null || input.map === null) return INACTIVE;
    const rules = resolveModeRules(input.map.mode);
    if (rules === null) {
      if (input.map.mode !== null && input.map.mode !== lastUnsupportedMode) {
        lastUnsupportedMode = input.map.mode;
        // Mode strings are not on the ADR-030 ban list.
        deps.logger.debug('scoreboard inactive: unsupported mode', { mode: input.map.mode });
      }
      return INACTIVE;
    }
    // The slice needs a side to orient `myTeam`/`enemyTeam`; until the own
    // player was observed once, there is no trustworthy side (freeze bias).
    if (ownSide === null) return INACTIVE;

    const teamCt = toTeamState('CT', input.map.teamCt);
    const teamT = toTeamState('T', input.map.teamT);
    return {
      active: true,
      phase: derivePhase(input.map, input.round),
      roundNumber: deriveDisplayRound(input.map, input.round),
      halftimeAfter: rules.halftimeAfter,
      myTeam: ownSide === 'CT' ? teamCt : teamT,
      enemyTeam: ownSide === 'CT' ? teamT : teamCt,
      roundHistory: [],
      me: {
        kills: ownMatchStats?.kills ?? null,
        assists: ownMatchStats?.assists ?? null,
        deaths: ownMatchStats?.deaths ?? null,
        mvps: ownMatchStats?.mvps ?? null,
        score: ownMatchStats?.score ?? null,
        health: ownRoundState?.health ?? null,
        armor: ownRoundState?.armor ?? null,
        helmet: ownRoundState?.helmet ?? null,
        money: ownRoundState?.money ?? null,
        equipValue: ownRoundState?.equipValue ?? null,
        roundKills: ownRoundState?.roundKills ?? null,
        roundHsKills: ownRoundState?.roundHsKills ?? null,
      },
      derived: { approximate: true, hsRatePercent: null },
    };
  }

  return {
    handleInput(input: LiveMatchInput): void {
      if (disposed) return;
      if (input.mapName !== lastMapName) {
        clearOwnTracking();
        lastMapName = input.mapName;
      }
      trackOwnPlayer(input);
      commit(deriveState(input));
    },

    notifyGsiInactive(): void {
      if (disposed) return;
      clearOwnTracking();
      lastMapName = null;
      commit(INACTIVE);
    },

    getState(): ScoreboardState {
      return state;
    },

    onStateChanged(listener: (state: ScoreboardState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose(): void {
      disposed = true;
      listeners.clear();
    },
  };
}

function parseSide(team: string | null): TeamSide | null {
  if (team === 'CT' || team === 'T') return team;
  return null;
}

function toTeamState(side: TeamSide, team: LiveMatchTeam | null): ScoreboardTeamState {
  return {
    side,
    score: team?.score ?? null,
    lossStreak: team?.consecutiveRoundLosses ?? null,
    timeoutsRemaining: team?.timeoutsRemaining ?? null,
  };
}

/**
 * Phase mapping, corpus-verified over all 12 observed
 * `map.phase`/`round.phase`/`round.bomb` combinations (SCB.1 corpus):
 * `map.phase` decides warmup and match end (CS2 keeps `round.phase` on
 * `freezetime` after `gameover`), the bomb beats the plain round phase, and
 * a missing `round` section (pre-scoreboard capture, spectator edges) reads
 * as a plain live round.
 */
function derivePhase(map: LiveMatchMap, round: LiveMatchRound | null): ScoreboardPhase {
  if (map.phase === 'warmup') return 'warmup';
  if (map.phase === 'gameover') return 'round-over';
  if (round?.bomb === 'planted') return 'bomb-planted';
  switch (round?.phase) {
    case 'freezetime':
      return 'freezetime';
    case 'over':
      return 'round-over';
    default:
      return 'live';
  }
}

/**
 * `map.round` counts *completed* rounds and increments the moment a round
 * ends (corpus-verified) — during `over`/after `gameover` it already names
 * the display round, otherwise the running round is the next one.
 */
function deriveDisplayRound(map: LiveMatchMap, round: LiveMatchRound | null): number {
  const completed = map.round ?? 0;
  if (round?.phase === 'over' || map.phase === 'gameover') return Math.max(completed, 1);
  return completed + 1;
}

function statesEqual(a: ScoreboardState, b: ScoreboardState): boolean {
  if (!a.active || !b.active) return a.active === b.active;
  return (
    a.phase === b.phase &&
    a.roundNumber === b.roundNumber &&
    a.halftimeAfter === b.halftimeAfter &&
    teamStatesEqual(a.myTeam, b.myTeam) &&
    teamStatesEqual(a.enemyTeam, b.enemyTeam) &&
    playerStatesEqual(a.me, b.me) &&
    a.derived.approximate === b.derived.approximate &&
    a.derived.hsRatePercent === b.derived.hsRatePercent &&
    a.roundHistory.length === b.roundHistory.length &&
    a.roundHistory.every((outcome, index) => outcome === b.roundHistory[index])
  );
}

function teamStatesEqual(a: ScoreboardTeamState, b: ScoreboardTeamState): boolean {
  return (
    a.side === b.side &&
    a.score === b.score &&
    a.lossStreak === b.lossStreak &&
    a.timeoutsRemaining === b.timeoutsRemaining
  );
}

function playerStatesEqual(a: ScoreboardPlayerState, b: ScoreboardPlayerState): boolean {
  return (
    a.kills === b.kills &&
    a.assists === b.assists &&
    a.deaths === b.deaths &&
    a.mvps === b.mvps &&
    a.score === b.score &&
    a.health === b.health &&
    a.armor === b.armor &&
    a.helmet === b.helmet &&
    a.money === b.money &&
    a.equipValue === b.equipValue &&
    a.roundKills === b.roundKills &&
    a.roundHsKills === b.roundHsKills
  );
}
