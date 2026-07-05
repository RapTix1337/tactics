import { describe, expect, it } from 'vitest';

import { LOG_DEBUG_ENV_VAR, LOG_DEBUG_FLAG, resolveLogLevel } from './log-level';

describe('resolveLogLevel', () => {
  it('defaults to info', () => {
    expect(resolveLogLevel([], {})).toBe('info');
  });

  it('enables debug via the start flag', () => {
    expect(resolveLogLevel(['/path/to/app', LOG_DEBUG_FLAG], {})).toBe('debug');
  });

  it('enables debug via a non-empty environment variable', () => {
    expect(resolveLogLevel([], { [LOG_DEBUG_ENV_VAR]: '1' })).toBe('debug');
  });

  it('ignores an empty or whitespace-only environment variable', () => {
    expect(resolveLogLevel([], { [LOG_DEBUG_ENV_VAR]: '' })).toBe('info');
    expect(resolveLogLevel([], { [LOG_DEBUG_ENV_VAR]: '   ' })).toBe('info');
  });

  it('ignores unrelated arguments and variables', () => {
    expect(resolveLogLevel(['--inspect'], { OTHER: 'x' })).toBe('info');
  });
});
