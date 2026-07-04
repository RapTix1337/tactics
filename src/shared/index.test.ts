import { describe, expect, it } from 'vitest';

import { APP_NAME } from './index';

// Harness proof for the node test environment (E1.4).
describe('shared/index (node environment)', () => {
  it('exposes the app name', () => {
    expect(APP_NAME).toBe('TactiCS');
  });
});
