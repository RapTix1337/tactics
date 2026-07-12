import type { JSX } from 'react';

interface PipsProps {
  /** Accessible name carrying count and meaning, e.g. `Loss streak: 2`. */
  readonly label: string;
  readonly filled: number;
  /**
   * Slots to render. Omit for remaining-only pips (one per unit, no empty
   * slots) — GSI sends no totals, e.g. `timeouts_remaining` without an
   * allowance (corpus: 1 in competitive, 3 in Premier).
   */
  readonly total?: number;
  readonly filledClassName: string;
}

/**
 * A row of square indicator pips (SCB.8). Decorative squares behind a single
 * `img` label — the count is carried by the label, not by counting pips.
 */
export function Pips({ label, filled, total, filledClassName }: PipsProps): JSX.Element {
  const slots = total ?? filled;
  return (
    <span role="img" aria-label={label} className="inline-flex items-center gap-0.5">
      {Array.from({ length: slots }, (_, index) => (
        <span
          key={index}
          data-slot="pip"
          aria-hidden="true"
          className={`size-1.5 rounded-[2px] ${index < filled ? filledClassName : 'bg-muted'}`}
        />
      ))}
    </span>
  );
}
