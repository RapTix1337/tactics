/**
 * The strict mode allowlist (ADR-052) — outside it the engine reports
 * `{ active: false }`. Corpus-verified (SCB.1): Premier reports `map.mode` =
 * `"competitive"`, so one entry covers both; wingman (`scrimcomp2v2`) plays
 * MR8, its side swap follows round 8.
 */

/** Per-mode rules the engine needs beyond "supported at all". */
export interface ModeRules {
  readonly halftimeAfter: number;
}

const SUPPORTED_MODES: Readonly<Record<string, ModeRules>> = {
  competitive: { halftimeAfter: 12 },
  scrimcomp2v2: { halftimeAfter: 8 },
};

/** Rules for a supported `map.mode`, or `null` when the mode is gated off. */
export function resolveModeRules(mode: string | null): ModeRules | null {
  if (mode === null) return null;
  return SUPPORTED_MODES[mode] ?? null;
}
