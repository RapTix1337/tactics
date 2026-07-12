import type { JSX } from 'react';

import type {
  RoundOutcome,
  ScoreboardPhase,
  ScoreboardTeamState,
} from '../../../shared/scoreboard-state';
import { Pips } from './Pips';
import { SideTag } from './SideTag';
import type { ActiveScoreboardState } from './stat-fields';
import { LOSS_BONUS_TIERS } from './stat-fields';

/**
 * The score header above the live map (SCB.8, spec AC 2/3): my team always
 * left, phase badge with the round number in the middle, round-win history
 * below. Team names are static labels — GSI carries none (design §3.2).
 */
export function ScoreHeader({ state }: { readonly state: ActiveScoreboardState }): JSX.Element {
  return (
    <section aria-label="Match score" className="flex w-full flex-col items-center gap-2 py-1">
      <div className="flex items-center justify-center gap-5">
        <TeamBlock team={state.myTeam} label="Your Team" mirrored={false} />
        <PhaseBadge phase={state.phase} roundNumber={state.roundNumber} />
        <TeamBlock team={state.enemyTeam} label="Enemy" mirrored={true} />
      </div>
      <RoundHistoryStrip history={state.roundHistory} halftimeAfter={state.halftimeAfter} />
    </section>
  );
}

/** Loss pips render against the full bonus ladder — its length is fixed. */
const LOSS_PIP_SLOTS = LOSS_BONUS_TIERS.length - 1;

function TeamBlock({
  team,
  label,
  mirrored,
}: {
  readonly team: ScoreboardTeamState;
  readonly label: string;
  readonly mirrored: boolean;
}): JSX.Element {
  const direction = mirrored ? 'flex-row-reverse' : 'flex-row';
  return (
    <div role="group" aria-label={label} className={`flex items-center gap-3 ${direction}`}>
      <div className={`flex flex-col gap-1 ${mirrored ? 'items-start' : 'items-end'}`}>
        <span className={`flex items-center gap-2 text-sm font-semibold ${direction}`}>
          {label}
          <SideTag side={team.side} />
        </span>
        <span className={`flex items-center gap-3 ${direction}`}>
          {team.lossStreak !== null && (
            <MiniIndicator caption="Loss">
              <Pips
                label={`Loss streak: ${team.lossStreak}`}
                filled={Math.min(team.lossStreak, LOSS_PIP_SLOTS)}
                total={LOSS_PIP_SLOTS}
                filledClassName="bg-amber-500"
              />
            </MiniIndicator>
          )}
          {team.timeoutsRemaining !== null && (
            <MiniIndicator caption="T/O">
              <Pips
                label={`Timeouts remaining: ${team.timeoutsRemaining}`}
                filled={team.timeoutsRemaining}
                filledClassName="bg-foreground"
              />
            </MiniIndicator>
          )}
        </span>
      </div>
      <span
        className={`font-mono text-3xl leading-none font-bold tabular-nums ${
          team.side === 'CT' ? 'text-side-ct' : 'text-side-t'
        }`}
      >
        {team.score ?? '—'}
      </span>
    </div>
  );
}

function MiniIndicator({
  caption,
  children,
}: {
  readonly caption: string;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <span className="flex items-center gap-1">
      <span
        aria-hidden="true"
        className="text-[9px] font-bold tracking-wider text-muted-foreground uppercase"
      >
        {caption}
      </span>
      {children}
    </span>
  );
}

const PHASE_PRESENTATIONS: Record<
  ScoreboardPhase,
  { readonly label: string; readonly badgeClass: string; readonly dotClass: string }
> = {
  warmup: {
    label: 'Warmup',
    badgeClass: 'text-muted-foreground',
    dotClass: 'bg-muted-foreground',
  },
  freezetime: { label: 'Freezetime', badgeClass: 'text-side-ct', dotClass: 'bg-side-ct' },
  live: { label: 'Live', badgeClass: 'text-emerald-500', dotClass: 'bg-emerald-500' },
  'bomb-planted': {
    label: 'Bomb planted',
    badgeClass: 'text-red-500',
    dotClass: 'animate-pulse bg-red-500',
  },
  'round-over': {
    label: 'Round over',
    badgeClass: 'text-muted-foreground',
    dotClass: 'bg-muted-foreground',
  },
};

/** `role="status"` so phase transitions are announced (UI-06). */
function PhaseBadge({
  phase,
  roundNumber,
}: {
  readonly phase: ScoreboardPhase;
  readonly roundNumber: number;
}): JSX.Element {
  const presentation = PHASE_PRESENTATIONS[phase];
  return (
    <span
      role="status"
      aria-label="Match phase"
      className={`flex items-center gap-1.5 rounded-full border bg-secondary/50 px-3 py-1 text-[11px] font-bold tracking-wider whitespace-nowrap uppercase ${presentation.badgeClass}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${presentation.dotClass}`} />
      Round {roundNumber} · {presentation.label}
    </span>
  );
}

const OUTCOME_CLASSES: Record<RoundOutcome, string> = {
  won: 'border-emerald-500/40 bg-emerald-500/60',
  lost: 'border-red-500/30 bg-red-500/45',
};

function RoundHistoryStrip({
  history,
  halftimeAfter,
}: {
  readonly history: readonly RoundOutcome[];
  readonly halftimeAfter: number;
}): JSX.Element {
  const items: JSX.Element[] = [];
  history.forEach((outcome, index) => {
    if (index === halftimeAfter) {
      items.push(
        <li
          key="halftime"
          role="separator"
          aria-label="Halftime"
          className="mx-1 h-4 w-0 border-l border-dashed"
        />,
      );
    }
    items.push(
      <li
        key={index}
        aria-label={`Round ${index + 1}: ${outcome}`}
        className={`size-[13px] rounded-[2px] border ${OUTCOME_CLASSES[outcome]}`}
      />,
    );
  });
  return (
    <ol aria-label="Round history" className="flex items-center gap-[3px]">
      {items}
    </ol>
  );
}
