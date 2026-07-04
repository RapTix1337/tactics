import { describe, expect, expectTypeOf, it } from 'vitest';

import type { ErrorCode } from './error-codes';
import { ERROR_CODES } from './error-codes';

describe('ERROR_CODES', () => {
  it('contains no duplicates', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it('contains the generic INTERNAL and INVALID_REQUEST codes every handler relies on', () => {
    expect(ERROR_CODES).toContain('INTERNAL');
    expect(ERROR_CODES).toContain('INVALID_REQUEST');
  });

  it('is a closed union — arbitrary strings are not error codes', () => {
    expectTypeOf<'NOT_A_CODE'>().not.toExtend<ErrorCode>();
    expectTypeOf<'INTERNAL'>().toExtend<ErrorCode>();
  });
});
