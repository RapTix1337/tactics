import type { JSX } from 'react';

import type { TeamSide } from '../../../shared/scoreboard-state';

const SIDE_TAG_CLASSES: Record<TeamSide, string> = {
  CT: 'border-side-ct/45 bg-side-ct/15 text-side-ct',
  T: 'border-side-t/45 bg-side-t/15 text-side-t',
};

/** The CT/T side chip used by the header and both side cards (SCB.8). */
export function SideTag({ side }: { readonly side: TeamSide }): JSX.Element {
  return (
    <span
      className={`rounded border px-1.5 py-px text-[10px] font-bold tracking-wider ${SIDE_TAG_CLASSES[side]}`}
    >
      {side}
    </span>
  );
}
