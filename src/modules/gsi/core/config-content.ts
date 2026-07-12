import type { GsiTiming } from '../../../shared';

/**
 * GSI config content generation (05-gsi.md §6): the exact Valve KeyValues
 * block CS2 reads at game start. The subscribed component set and the
 * buffer/throttle timing are fixed by ADR-051 (revising ADR-031) — the widened
 * `data` block ships in every profile (still no positions, weapons, or
 * `allplayers_*`; ADR-015 stays structural), while `timing` selects one of
 * three buffer/throttle presets. Verification is a byte comparison against this
 * generated content (03-technical-design.md §7.4), so any format change here —
 * including a timing-profile switch — makes existing configs "outdated":
 * repair-needed, never a silent rewrite (GSI-06). The structure matches the
 * widened capture config validated against a real CS2 in SCB.1
 * (tests/fixtures/gsi/README.md), including the quoted name line — without it
 * CS2 silently ignores the file.
 */

/** Target file name inside the CS2 cfg directory (03-technical-design.md §7.1). */
export const GSI_CONFIG_FILE_NAME = 'gamestate_integration_tactics.cfg';

/**
 * Buffer/throttle presets per timing profile (ADR-051). Heartbeat is a
 * constant 10.0 in all profiles, so the 30 s stale timeout (3×) is untouched.
 * The values are KeyValues float literals, mirrored byte-for-byte by the
 * config-content tests.
 */
const GSI_TIMING_PROFILES: Record<
  GsiTiming,
  { readonly buffer: string; readonly throttle: string }
> = {
  slow: { buffer: '0.5', throttle: '1.0' },
  default: { buffer: '0.1', throttle: '0.5' },
  fast: { buffer: '0.0', throttle: '0.1' },
};

/**
 * Renders the config content for the given intake endpoint and timing profile.
 * Pure string generation — where the file lands and whether the user consented
 * is the adapter's and `app`'s concern (ADR-032: only `gsi.applySetup` writes).
 * The token needs no KeyValues escaping: it is lowercase hex by construction
 * (settings operational state, ADR-029).
 */
export function generateConfigContent(port: number, token: string, timing: GsiTiming): string {
  const { buffer, throttle } = GSI_TIMING_PROFILES[timing];
  return [
    '"TactiCS"',
    '{',
    `    "uri" "http://127.0.0.1:${String(port)}"`,
    `    "buffer" "${buffer}"`,
    `    "throttle" "${throttle}"`,
    '    "heartbeat" "10.0"',
    '    "auth"',
    '    {',
    `        "token" "${token}"`,
    '    }',
    '    "data"',
    '    {',
    '        "provider" "1"',
    '        "map" "1"',
    '        "map_round_wins" "1"',
    '        "round" "1"',
    '        "player_id" "1"',
    '        "player_state" "1"',
    '        "player_match_stats" "1"',
    '    }',
    '}',
    '',
  ].join('\n');
}
