import { describe, expect, it } from 'vitest';

import { failure, success } from './envelope';

describe('command envelope', () => {
  it('success matches the ADR-032 shape exactly', () => {
    expect(success({ value: 1 })).toEqual({ ok: true, data: { value: 1 } });
  });

  it('failure matches the ADR-032 shape exactly', () => {
    expect(failure('CS2_NOT_FOUND', 'CS2 installation not found.')).toEqual({
      ok: false,
      error: { code: 'CS2_NOT_FOUND', message: 'CS2 installation not found.' },
    });
  });

  it('discriminates on ok', () => {
    const result = failure('INTERNAL', 'Something went wrong.');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL');
    }
  });
});
