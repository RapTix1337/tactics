/**
 * HS% accumulation (ADR-052, design §2.2; ADR is gone — ADR-055): CS2's
 * `round_kills`/`round_killhs` keep the ended round's values through the
 * `over` phase and reset at the next freezetime, so accumulation is keyed by
 * the engine's *display round*. The latest own per-round counters stay
 * pending and fold into the totals exactly once when the display round
 * advances past them; the reported rate includes the pending round, so a
 * live kill shows immediately and the match's final round (whose display
 * round never advances) is covered. A round that completes without an own
 * observation folds nothing — indistinguishable from being dead all round,
 * which correctly contributes zero kills.
 */

export interface HsDerivedState {
  readonly approximate: boolean;
  readonly hsRatePercent: number | null;
  /** Accumulated headshot kills; `null` until the own player was observed. */
  readonly hsKills: number | null;
}

export interface HsObservation {
  /** The engine's 1-based display round for this payload. */
  readonly displayRound: number;
  /**
   * The display round was derived from an `over`/`gameover` phase. CS2
   * updates `round.phase` and `map.round` non-atomically at round end, so
   * such a snapshot can transiently derive one round *back* — never treat
   * that as a new match (2026-07-12 regression). Real restarts land in
   * warmup/freezetime, never in `over`.
   */
  readonly roundOver?: boolean;
  /** Own-identity counters, or `null` for foreign/absent player blocks. */
  readonly own: {
    readonly kills: number | null;
    readonly roundKills: number | null;
    readonly roundHsKills: number | null;
  } | null;
}

export interface HsObservationResult {
  /** True when this observation revealed a new match (regression reset). */
  readonly wasReset: boolean;
}

export interface HsAccumulator {
  observe(observation: HsObservation): HsObservationResult;
  getDerived(): HsDerivedState;
  reset(): void;
}

interface FirstSight {
  readonly displayRound: number;
  readonly kills: number;
  readonly roundKills: number;
}

interface PendingRound {
  readonly displayRound: number;
  readonly kills: number;
  readonly hsKills: number;
}

export function createHsAccumulator(): HsAccumulator {
  let firstSight: FirstSight | null = null;
  let foldedKills = 0;
  let foldedHsKills = 0;
  let pending: PendingRound | null = null;
  let lastDisplayRound: number | null = null;
  let lastOwnKills: number | null = null;

  function clear(): void {
    firstSight = null;
    foldedKills = 0;
    foldedHsKills = 0;
    pending = null;
    lastDisplayRound = null;
    lastOwnKills = null;
  }

  return {
    observe(observation: HsObservation): HsObservationResult {
      const { own } = observation;
      let { displayRound } = observation;

      // A regression means a new match on the same map (mp_restartgame,
      // rematch without a menu hop); design §2.2 reset detection. Map
      // changes and menus reset via the engine before this is reached.
      // Regressions derived from an `over` phase are excluded: they are
      // torn round-end snapshots (see `roundOver`), not restarts.
      const roundRegressed =
        lastDisplayRound !== null &&
        displayRound < lastDisplayRound &&
        observation.roundOver !== true;
      const killsRegressed =
        own?.kills !== null &&
        own?.kills !== undefined &&
        lastOwnKills !== null &&
        own.kills < lastOwnKills;
      const wasReset = roundRegressed || killsRegressed;
      if (wasReset) clear();

      // Clamp a surviving (torn) regression so the pending round keeps its
      // real key — re-keying it backward would fold the round twice.
      if (!wasReset && lastDisplayRound !== null && displayRound < lastDisplayRound) {
        displayRound = lastDisplayRound;
      }

      if (pending !== null && displayRound > pending.displayRound) {
        foldedKills += pending.kills;
        foldedHsKills += pending.hsKills;
        pending = null;
      }

      if (own !== null) {
        if (firstSight === null) {
          firstSight = {
            displayRound,
            kills: own.kills ?? 0,
            roundKills: own.roundKills ?? 0,
          };
        }
        pending = {
          displayRound,
          kills: own.roundKills ?? 0,
          hsKills: own.roundHsKills ?? 0,
        };
        if (own.kills !== null) lastOwnKills = own.kills;
      }

      lastDisplayRound = displayRound;
      return { wasReset };
    },

    getDerived(): HsDerivedState {
      if (firstSight === null) return { approximate: true, hsRatePercent: null, hsKills: null };
      // Approximate when kills exist that accumulation can never attribute:
      // a start past round 1, or first-sight match kills beyond the pending
      // round's own kills (spec AC 10, design §2.2).
      const approximate = firstSight.displayRound > 1 || firstSight.kills > firstSight.roundKills;
      const kills = foldedKills + (pending?.kills ?? 0);
      const hsKills = foldedHsKills + (pending?.hsKills ?? 0);
      return {
        approximate,
        hsRatePercent: kills > 0 ? (hsKills / kills) * 100 : null,
        hsKills,
      };
    },

    reset(): void {
      clear();
    },
  };
}
