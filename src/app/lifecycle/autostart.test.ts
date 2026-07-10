import { describe, expect, it } from 'vitest';

import type { LoginItemsPort } from './autostart';
import { syncAutostart } from './autostart';

/**
 * The E17.2 acceptance round trip via API read-back: a stateful fake of the
 * login-item port — set stores, get reads back — stands in for the OS, since
 * tests must never mutate the real registry (docs/10-testing.md).
 */
function createLoginItemsFake(openAtLogin: boolean): {
  port: LoginItemsPort;
  setCalls: boolean[];
  readBack: () => boolean;
} {
  let state = openAtLogin;
  const setCalls: boolean[] = [];
  return {
    port: {
      getOpenAtLogin: (): boolean => state,
      setOpenAtLogin: (next: boolean): void => {
        setCalls.push(next);
        state = next;
      },
    },
    setCalls,
    readBack: (): boolean => state,
  };
}

describe('syncAutostart', () => {
  it('registers the login item when the setting turns on', () => {
    const fake = createLoginItemsFake(false);

    syncAutostart(fake.port, true);

    expect(fake.readBack()).toBe(true);
    expect(fake.setCalls).toEqual([true]);
  });

  it('deregisters the login item when the setting turns off', () => {
    const fake = createLoginItemsFake(true);

    syncAutostart(fake.port, false);

    expect(fake.readBack()).toBe(false);
    expect(fake.setCalls).toEqual([false]);
  });

  it('does not write when the OS state already matches (idempotent)', () => {
    // false/false is also the shipped default: autostart off, nothing registered.
    for (const state of [false, true]) {
      const fake = createLoginItemsFake(state);

      syncAutostart(fake.port, state);

      expect(fake.readBack()).toBe(state);
      expect(fake.setCalls).toEqual([]);
    }
  });
});
