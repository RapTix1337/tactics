import { describe, expect, it } from 'vitest';

import { resolveModeRules } from './modes';

// Allowlist evidence: the SCB.1 corpus (02-design.md §2.2). Premier reports
// `map.mode` = "competitive" — GSI does not distinguish it, so `competitive`
// covers both; wingman is `scrimcomp2v2` with its MR8 halftime.
describe('resolveModeRules', () => {
  it('resolves competitive (also covering Premier) to halftime after 12', () => {
    expect(resolveModeRules('competitive')).toEqual({ halftimeAfter: 12 });
  });

  it('resolves wingman (scrimcomp2v2) to halftime after 8', () => {
    expect(resolveModeRules('scrimcomp2v2')).toEqual({ halftimeAfter: 8 });
  });

  it.each(['casual', 'deathmatch', 'gungameprogressive', 'cooperative', ''])(
    'rejects unsupported mode %j',
    (mode) => {
      expect(resolveModeRules(mode)).toBeNull();
    },
  );

  it('rejects a missing mode', () => {
    expect(resolveModeRules(null)).toBeNull();
  });
});
