/**
 * GSI config content generation (05-gsi.md §1 no. 1): the exact Valve
 * KeyValues block CS2 reads at game start, with the fixed ADR-031 protocol
 * parameters. Verification is a byte comparison against this generated
 * content (03-technical-design.md §7.4), so any format change here makes
 * existing configs "outdated" — repair-needed, never a silent rewrite
 * (GSI-06). The structure matches the capture config validated against a
 * real CS2 in E10.1 (tests/fixtures/gsi/README.md), including the quoted
 * name line — without it CS2 silently ignores the file.
 */

/** Target file name inside the CS2 cfg directory (03-technical-design.md §7.1). */
export const GSI_CONFIG_FILE_NAME = 'gamestate_integration_tactics.cfg';

/**
 * Renders the config content for the given intake endpoint. Pure string
 * generation — where the file lands and whether the user consented is the
 * adapter's and `app`'s concern (ADR-032: only `gsi.applySetup` writes).
 * The token needs no KeyValues escaping: it is lowercase hex by construction
 * (settings operational state, ADR-029).
 */
export function generateConfigContent(port: number, token: string): string {
  return [
    '"TactiCS"',
    '{',
    `    "uri" "http://127.0.0.1:${String(port)}"`,
    '    "buffer" "0.1"',
    '    "throttle" "0.5"',
    '    "heartbeat" "10.0"',
    '    "auth"',
    '    {',
    `        "token" "${token}"`,
    '    }',
    '    "data"',
    '    {',
    '        "provider" "1"',
    '        "map" "1"',
    '    }',
    '}',
    '',
  ].join('\n');
}
