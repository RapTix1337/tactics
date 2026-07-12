import type { ScoreboardState } from '../../../shared/scoreboard-state';
import type { FieldId } from '../../../shared/settings';

/**
 * Field catalog of the scoreboard feature (live-scoreboard 02-design.md §3.3,
 * SCB.8): one entry per layout `FieldId`, mapping the IPC slice to display
 * text. `kd`/`kMinusD` are renderer-derived here (deliberately absent from
 * the slice, design §3.2); `—` stands in wherever GSI omitted a value.
 */

/** The slice variant during a supported live match. */
export type ActiveScoreboardState = Extract<ScoreboardState, { active: true }>;

/** Display data for one stat tile. */
export interface StatTile {
  readonly value: string;
  /** Render the `~` marker (HS rate while accumulation is incomplete). */
  readonly approximate: boolean;
  /** Health bar fill, 0–100 — present on the health tile only. */
  readonly healthPercent?: number;
  /** Helmet indicator — present on the armor tile only. */
  readonly helmet?: boolean;
  /** Needs a wider tile — `$1,234`-format values overflow the default
   * minimum width (up to `$16,000` must fit without crossing the border). */
  readonly wide?: boolean;
}

export interface StatField {
  readonly label: string;
  readonly format: (state: ActiveScoreboardState) => StatTile;
}

const PLACEHOLDER = '—';

/** Deterministic `$1,234` formatting — no locale dependence (test stability). */
export function formatMoney(amount: number): string {
  return `$${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function plainTile(value: number | null): StatTile {
  return { value: value === null ? PLACEHOLDER : String(value), approximate: false };
}

function moneyTile(value: number | null): StatTile {
  return {
    value: value === null ? PLACEHOLDER : formatMoney(value),
    approximate: false,
    wide: true,
  };
}

export const STAT_FIELDS: Record<FieldId, StatField> = {
  kills: { label: 'Kills', format: (state) => plainTile(state.me.kills) },
  assists: { label: 'Assists', format: (state) => plainTile(state.me.assists) },
  deaths: { label: 'Deaths', format: (state) => plainTile(state.me.deaths) },
  mvps: { label: 'MVPs', format: (state) => plainTile(state.me.mvps) },
  score: { label: 'Score', format: (state) => plainTile(state.me.score) },
  kd: {
    label: 'K/D',
    format: ({ me }) => ({
      value:
        me.kills === null || me.deaths === null
          ? PLACEHOLDER
          : (me.kills / Math.max(1, me.deaths)).toFixed(2),
      approximate: false,
    }),
  },
  kMinusD: {
    label: 'K−D',
    format: ({ me }) => ({
      value:
        me.kills === null || me.deaths === null
          ? PLACEHOLDER
          : `${me.kills - me.deaths < 0 ? '' : '+'}${me.kills - me.deaths}`,
      approximate: false,
    }),
  },
  hsRate: {
    label: 'HS Rate',
    format: ({ derived }) => ({
      value: derived.hsRatePercent === null ? PLACEHOLDER : `${Math.round(derived.hsRatePercent)}%`,
      approximate: derived.approximate,
    }),
  },
  health: {
    label: 'Health',
    format: ({ me }) => ({
      ...plainTile(me.health),
      ...(me.health === null ? {} : { healthPercent: Math.min(100, Math.max(0, me.health)) }),
    }),
  },
  armor: {
    label: 'Armor',
    format: ({ me }) => ({ ...plainTile(me.armor), helmet: me.helmet === true }),
  },
  money: { label: 'Money', format: (state) => moneyTile(state.me.money) },
  equipValue: { label: 'Equip', format: (state) => moneyTile(state.me.equipValue) },
  roundKills: { label: 'Round kills', format: (state) => plainTile(state.me.roundKills) },
  roundHsKills: { label: 'Round HS kills', format: (state) => plainTile(state.me.roundHsKills) },
};

/**
 * CS2's fixed loss-bonus ladder: payout of the *next* lost round at a given
 * consecutive-loss count (UI-derived estimate, design §1 "Designer extras").
 */
export const LOSS_BONUS_TIERS = [1400, 1900, 2400, 2900, 3400] as const;

export function estimateLossBonus(lossStreak: number): number {
  const tier = Math.min(LOSS_BONUS_TIERS.length - 1, Math.max(0, lossStreak));
  // Bounds-checked one line above — the index is always inside the table.
  return LOSS_BONUS_TIERS[tier]!;
}
