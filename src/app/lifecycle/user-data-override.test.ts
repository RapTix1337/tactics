import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveUserDataDirOverride, USER_DATA_DIR_ENV_VAR } from './user-data-override';

const ABSOLUTE_DIR = resolve('/tmp/tactics-e2e');

describe('resolveUserDataDirOverride', () => {
  it('returns an absolute override path', () => {
    expect(resolveUserDataDirOverride({ [USER_DATA_DIR_ENV_VAR]: ABSOLUTE_DIR })).toBe(
      ABSOLUTE_DIR,
    );
  });

  it('trims surrounding whitespace', () => {
    expect(resolveUserDataDirOverride({ [USER_DATA_DIR_ENV_VAR]: ` ${ABSOLUTE_DIR} ` })).toBe(
      ABSOLUTE_DIR,
    );
  });

  it('returns undefined when the variable is unset', () => {
    expect(resolveUserDataDirOverride({})).toBeUndefined();
  });

  it('returns undefined for an empty or blank value', () => {
    expect(resolveUserDataDirOverride({ [USER_DATA_DIR_ENV_VAR]: '' })).toBeUndefined();
    expect(resolveUserDataDirOverride({ [USER_DATA_DIR_ENV_VAR]: '   ' })).toBeUndefined();
  });

  it('returns undefined for a relative path', () => {
    expect(resolveUserDataDirOverride({ [USER_DATA_DIR_ENV_VAR]: 'relative/dir' })).toBeUndefined();
  });
});
