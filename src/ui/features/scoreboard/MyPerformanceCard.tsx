import { HardHatIcon } from 'lucide-react';
import type { JSX } from 'react';

import type { ScoreboardLayout, ScoreboardLayoutGroup } from '../../../shared/settings';
import { SideTag } from './SideTag';
import type { ActiveScoreboardState, StatTile } from './stat-fields';
import { STAT_FIELDS } from './stat-fields';

/**
 * The left side card (SCB.8, spec AC 4): the user's own stats, rendered as
 * the configured layout groups of stat tiles. Pure presentation over props —
 * the settings preview reuses it with sample data (design §5).
 */
export function MyPerformanceCard({
  layout,
  state,
}: {
  readonly layout: ScoreboardLayout;
  readonly state: ActiveScoreboardState;
}): JSX.Element {
  const side = state.myTeam.side;
  return (
    <section
      aria-label="My performance"
      className={`flex w-full flex-col overflow-hidden rounded-lg border bg-card ${
        side === 'CT' ? 'shadow-side-ct/30' : 'shadow-side-t/30'
      } shadow-sm`}
    >
      <header
        className={`flex items-center gap-2 border-b px-3 py-2.5 ${
          side === 'CT' ? 'bg-side-ct/15' : 'bg-side-t/15'
        }`}
      >
        <SideTag side={side} />
        <span className="text-[15px] font-semibold">My performance</span>
      </header>
      <div className="flex flex-col gap-3.5 p-3">
        {layout.groups
          .filter((group) => group.fields.length > 0)
          .map((group, index) => (
            <StatGroup key={`${index}-${group.label}`} group={group} state={state} />
          ))}
      </div>
    </section>
  );
}

function StatGroup({
  group,
  state,
}: {
  readonly group: ScoreboardLayoutGroup;
  readonly state: ActiveScoreboardState;
}): JSX.Element {
  const tiles = group.fields.map((fieldId) => ({
    fieldId,
    label: STAT_FIELDS[fieldId].label,
    tile: STAT_FIELDS[fieldId].format(state),
  }));
  const approximate = tiles.some(({ tile }) => tile.approximate);
  return (
    <div role="group" aria-label={group.label} className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-muted-foreground uppercase">
        {group.label}
        {approximate && (
          <span className="rounded border border-amber-500/40 px-1 text-[8px] text-amber-500">
            ~ approx
          </span>
        )}
      </span>
      <dl className="flex flex-wrap gap-1.5">
        {tiles.map(({ fieldId, label, tile }) => (
          <StatTileView key={fieldId} label={label} tile={tile} />
        ))}
      </dl>
    </div>
  );
}

/**
 * One stat tile: value over label. `flex-col-reverse` keeps the DOM order
 * `dt` → `dd` (screen readers read term then definition) while the value
 * renders on top like the Designer card.
 */
function StatTileView({
  label,
  tile,
}: {
  readonly label: string;
  readonly tile: StatTile;
}): JSX.Element {
  return (
    <div
      className={`flex flex-1 flex-col-reverse gap-1 rounded-lg border bg-secondary/55 px-2 py-2 ${
        tile.wide === true ? 'min-w-[5.5rem]' : 'min-w-14'
      }`}
    >
      <dt className="truncate text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="flex flex-col gap-1">
        <span className="flex items-center gap-0.5 font-mono text-lg leading-none font-bold tabular-nums">
          {tile.approximate && (
            <span aria-hidden="true" className="text-amber-500">
              ~
            </span>
          )}
          {tile.value}
          {tile.helmet === true && (
            <HardHatIcon role="img" aria-label="Helmet" className="ml-0.5 size-3 text-side-ct" />
          )}
        </span>
        {tile.healthPercent !== undefined && (
          <span
            aria-hidden="true"
            className="block h-[3px] w-full overflow-hidden rounded-sm bg-muted"
          >
            <span
              data-slot="health-bar-fill"
              className="block h-full bg-emerald-500"
              style={{ width: `${tile.healthPercent}%` }}
            />
          </span>
        )}
      </dd>
    </div>
  );
}
