import { InfoIcon } from 'lucide-react';
import type { JSX } from 'react';
import { useId } from 'react';

import { Pips } from './Pips';
import { SideTag } from './SideTag';
import type { ActiveScoreboardState } from './stat-fields';
import { estimateLossBonus, formatMoney, LOSS_BONUS_TIERS } from './stat-fields';

const PLACEHOLDER = '—';

/** Loss pips render against the full bonus ladder — its length is fixed. */
const LOSS_PIP_SLOTS = LOSS_BONUS_TIERS.length - 1;

/**
 * The right side card (SCB.8, spec AC 5): enemy *team* state — GSI gives a
 * playing client no enemy per-player data. Score and streak deliberately
 * duplicate the header for visual symmetry (spec §4). The loss bonus is a
 * renderer-side estimate from the fixed CS2 tier ladder.
 */
export function EnemyTeamCard({ state }: { readonly state: ActiveScoreboardState }): JSX.Element {
  const { enemyTeam } = state;
  return (
    <section
      aria-label="Enemy team"
      className={`flex w-full flex-col overflow-hidden rounded-lg border bg-card ${
        enemyTeam.side === 'CT' ? 'shadow-side-ct/30' : 'shadow-side-t/30'
      } shadow-sm`}
    >
      <header
        className={`flex items-center justify-between gap-2 border-b px-3 py-2.5 ${
          enemyTeam.side === 'CT' ? 'bg-side-ct/15' : 'bg-side-t/15'
        }`}
      >
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          <SideTag side={enemyTeam.side} />
          Enemy team
        </span>
        <span
          className={`font-mono text-2xl leading-none font-bold tabular-nums ${
            enemyTeam.side === 'CT' ? 'text-side-ct' : 'text-side-t'
          }`}
        >
          {enemyTeam.score ?? PLACEHOLDER}
        </span>
      </header>
      <div className="flex flex-col gap-3.5 p-3">
        <RowGroup caption="Round economy">
          <TeamRow
            label="Consecutive losses"
            hint="Loss-bonus tier climbs each loss"
            value={enemyTeam.lossStreak === null ? PLACEHOLDER : String(enemyTeam.lossStreak)}
            pips={
              enemyTeam.lossStreak === null ? undefined : (
                <Pips
                  label={`Loss streak: ${enemyTeam.lossStreak}`}
                  filled={Math.min(enemyTeam.lossStreak, LOSS_PIP_SLOTS)}
                  total={LOSS_PIP_SLOTS}
                  filledClassName={enemyTeam.side === 'CT' ? 'bg-side-ct' : 'bg-side-t'}
                />
              )
            }
          />
          <TeamRow
            label="Est. loss bonus"
            hint="Next-round payout if they lose"
            value={
              enemyTeam.lossStreak === null
                ? PLACEHOLDER
                : formatMoney(estimateLossBonus(enemyTeam.lossStreak))
            }
          />
        </RowGroup>
        <RowGroup caption="Match state">
          <TeamRow
            label="Rounds won"
            value={enemyTeam.score === null ? PLACEHOLDER : String(enemyTeam.score)}
          />
          <TeamRow
            label="Timeouts remaining"
            value={
              enemyTeam.timeoutsRemaining === null
                ? PLACEHOLDER
                : String(enemyTeam.timeoutsRemaining)
            }
            pips={
              enemyTeam.timeoutsRemaining === null ? undefined : (
                <Pips
                  label={`Timeouts remaining: ${enemyTeam.timeoutsRemaining}`}
                  filled={enemyTeam.timeoutsRemaining}
                  filledClassName={enemyTeam.side === 'CT' ? 'bg-side-ct' : 'bg-side-t'}
                />
              )
            }
          />
        </RowGroup>
        <p className="flex gap-1.5 border-t border-dashed pt-2.5 text-[10px] leading-relaxed text-muted-foreground">
          <InfoIcon aria-hidden="true" className="mt-px size-3 shrink-0" />
          GSI exposes no per-player data for the enemy — only team-level state is shown.
        </p>
      </div>
    </section>
  );
}

function RowGroup({
  caption,
  children,
}: {
  readonly caption: string;
  readonly children: readonly JSX.Element[];
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[9px] font-bold tracking-widest text-muted-foreground uppercase">
        {caption}
      </span>
      <dl className="flex flex-col gap-1.5">{children}</dl>
    </div>
  );
}

function TeamRow({
  label,
  hint,
  value,
  pips,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly pips?: JSX.Element;
}): JSX.Element {
  const labelId = useId();
  return (
    <div className="flex items-center justify-between gap-2.5 rounded-lg border bg-secondary/55 px-3 py-2">
      <dt className="flex min-w-0 flex-col">
        <span id={labelId} className="text-[11px] font-medium">
          {label}
        </span>
        {hint !== undefined && <span className="text-[9px] text-muted-foreground">{hint}</span>}
      </dt>
      <dd aria-labelledby={labelId} className="flex shrink-0 items-center gap-2">
        {pips}
        <span className="font-mono text-[15px] font-bold tabular-nums">{value}</span>
      </dd>
    </div>
  );
}
