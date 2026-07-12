import type {
  Logger,
  ScoreboardPhase,
  ScoreboardPlayerState,
  ScoreboardState,
  ScoreboardTeamState,
} from '../../../shared';
import { createHsAccumulator } from './accumulator';
import { isOwnPlayer } from './identity';
import type {
  LiveMatchInput,
  LiveMatchMap,
  LiveMatchPlayer,
  LiveMatchPlayerMatchStats,
  LiveMatchPlayerRoundState,
  LiveMatchRound,
  LiveMatchTeam,
} from './input';
import { resolveModeRules } from './modes';
import { deriveFirstHalfSide, deriveRoundHistory, type TeamSide } from './round-history';

/**
 * The scoreboard state machine (ADR-052, design §2.2): consumes
 * `LiveMatchInput` observations, holds the own-player snapshot across the
 * dead-spectate flip, gates by mode, folds the HS accumulation, maps the
 * round history, and notifies listeners only on structural change
 * (02-architecture §4.2 — CS2 posts several times per second, the slice
 * changes rarely).
 */

// The outgoing slice IS the shared IPC contract shape (lifted there by
// SCB.7, one source of truth) — re-exported so module consumers and tests
// keep importing it from the module surface.
export type {
  RoundOutcome,
  ScoreboardDerivedState,
  ScoreboardPhase,
  ScoreboardPlayerState,
  ScoreboardState,
  ScoreboardTeamState,
  TeamSide,
} from '../../../shared';

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
  // inactivity. A regression reset (mp_restartgame, rematch — detected by
  // the accumulator) clears only the accumulation and the history
  // orientation: the own side survives, every own payload refreshes it.
  let ownSide: TeamSide | null = null;
  let ownMatchStats: LiveMatchPlayerMatchStats | null = null;
  let ownRoundState: LiveMatchPlayerRoundState | null = null;
  let lastMapName: string | null = null;
  let lastUnsupportedMode: string | null = null;

  const accumulator = createHsAccumulator();
  // The first-half side remembered while the match is in regulation — the
  // only orientation source for the history strip once overtime starts.
  let firstHalfSideMemory: TeamSide | null = null;

  let state: ScoreboardState = INACTIVE;
  let disposed = false;
  const listeners = new Set<(state: ScoreboardState) => void>();

  function clearMatchTracking(): void {
    ownSide = null;
    ownMatchStats = null;
    ownRoundState = null;
    firstHalfSideMemory = null;
    accumulator.reset();
  }

  function commit(next: ScoreboardState): void {
    if (statesEqual(state, next)) return;
    state = next;
    for (const listener of [...listeners]) listener(state);
  }

  function ownPlayerOf(input: LiveMatchInput): LiveMatchPlayer | null {
    if (input.player === null || !isOwnPlayer(input.providerSteamId, input.player.steamId)) {
      return null;
    }
    return input.player;
  }

  function trackOwnPlayer(input: LiveMatchInput): void {
    const player = ownPlayerOf(input);
    if (player === null) return;
    const side = parseSide(player.team);
    if (side !== null) ownSide = side;
    if (player.matchStats !== null) ownMatchStats = player.matchStats;
    if (player.state !== null) ownRoundState = player.state;
  }

  function observeAccumulation(input: LiveMatchInput): void {
    // Accumulate only inside a supported match context — menus and map
    // changes reset via `clearMatchTracking` before this is reached.
    if (input.mapName === null || input.map === null) return;
    if (resolveModeRules(input.map.mode) === null) return;
    const player = ownPlayerOf(input);
    const { wasReset } = accumulator.observe({
      displayRound: deriveDisplayRound(input.map, input.round),
      own:
        player === null
          ? null
          : {
              kills: player.matchStats?.kills ?? null,
              roundKills: player.state?.roundKills ?? null,
              roundHsKills: player.state?.roundHsKills ?? null,
            },
    });
    if (wasReset) firstHalfSideMemory = null;
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

    const displayRound = deriveDisplayRound(input.map, input.round);
    // Within regulation the orientation is derivable from the current side;
    // remember it so an overtime history can still render (design §2.2 —
    // OT itself is out of scope, only regulation rounds are mapped).
    const regulationFirstHalfSide = deriveFirstHalfSide(ownSide, displayRound, rules.halftimeAfter);
    if (regulationFirstHalfSide !== null) firstHalfSideMemory = regulationFirstHalfSide;

    const teamCt = toTeamState('CT', input.map.teamCt);
    const teamT = toTeamState('T', input.map.teamT);
    return {
      active: true,
      phase: derivePhase(input.map, input.round),
      roundNumber: displayRound,
      halftimeAfter: rules.halftimeAfter,
      myTeam: ownSide === 'CT' ? teamCt : teamT,
      enemyTeam: ownSide === 'CT' ? teamT : teamCt,
      roundHistory: deriveRoundHistory({
        roundWins: input.map.roundWins,
        firstHalfSide: regulationFirstHalfSide ?? firstHalfSideMemory,
        halftimeAfter: rules.halftimeAfter,
      }),
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
      derived: accumulator.getDerived(),
    };
  }

  return {
    handleInput(input: LiveMatchInput): void {
      if (disposed) return;
      if (input.mapName !== lastMapName) {
        clearMatchTracking();
        lastMapName = input.mapName;
      }
      trackOwnPlayer(input);
      observeAccumulation(input);
      commit(deriveState(input));
    },

    notifyGsiInactive(): void {
      if (disposed) return;
      clearMatchTracking();
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
