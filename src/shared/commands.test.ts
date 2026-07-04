import { describe, expect, it } from 'vitest';

import { appGetSnapshot } from './commands';

describe('appGetSnapshot', () => {
  it('lives on the contract channel', () => {
    expect(appGetSnapshot.channel).toBe('cmd:app.getSnapshot');
  });

  it('takes no request and returns the (still empty) snapshot object', () => {
    expect(appGetSnapshot.requestSchema.safeParse(undefined).success).toBe(true);
    expect(appGetSnapshot.responseSchema.safeParse({}).success).toBe(true);
  });
});
