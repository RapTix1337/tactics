import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DISABLE_UPDATES_ENV_VAR,
  GSI_PORT_ENV_VAR,
  resolveGsiPortOverride,
  resolveUpdatesDisabled,
  resolveUserDataDirOverride,
  USER_DATA_DIR_ENV_VAR,
} from './env-overrides';

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

describe('resolveGsiPortOverride', () => {
  it('returns a valid port number', () => {
    expect(resolveGsiPortOverride({ [GSI_PORT_ENV_VAR]: '45123' })).toBe(45_123);
  });

  it('trims surrounding whitespace', () => {
    expect(resolveGsiPortOverride({ [GSI_PORT_ENV_VAR]: ' 45123 ' })).toBe(45_123);
  });

  it('returns undefined when the variable is unset, empty, or blank', () => {
    expect(resolveGsiPortOverride({})).toBeUndefined();
    expect(resolveGsiPortOverride({ [GSI_PORT_ENV_VAR]: '' })).toBeUndefined();
    expect(resolveGsiPortOverride({ [GSI_PORT_ENV_VAR]: '   ' })).toBeUndefined();
  });

  it('returns undefined for non-numeric and non-integer values', () => {
    expect(resolveGsiPortOverride({ [GSI_PORT_ENV_VAR]: 'default' })).toBeUndefined();
    expect(resolveGsiPortOverride({ [GSI_PORT_ENV_VAR]: '42730.5' })).toBeUndefined();
  });

  it('returns undefined for out-of-range ports', () => {
    expect(resolveGsiPortOverride({ [GSI_PORT_ENV_VAR]: '0' })).toBeUndefined();
    expect(resolveGsiPortOverride({ [GSI_PORT_ENV_VAR]: '-1' })).toBeUndefined();
    expect(resolveGsiPortOverride({ [GSI_PORT_ENV_VAR]: '65536' })).toBeUndefined();
  });
});

describe('resolveUpdatesDisabled', () => {
  it('is disabled for any non-empty value', () => {
    expect(resolveUpdatesDisabled({ [DISABLE_UPDATES_ENV_VAR]: '1' })).toBe(true);
    expect(resolveUpdatesDisabled({ [DISABLE_UPDATES_ENV_VAR]: 'true' })).toBe(true);
  });

  it('is enabled when the variable is unset, empty, or blank', () => {
    expect(resolveUpdatesDisabled({})).toBe(false);
    expect(resolveUpdatesDisabled({ [DISABLE_UPDATES_ENV_VAR]: '' })).toBe(false);
    expect(resolveUpdatesDisabled({ [DISABLE_UPDATES_ENV_VAR]: '   ' })).toBe(false);
  });
});
