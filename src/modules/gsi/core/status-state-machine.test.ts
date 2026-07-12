/* eslint-disable import-x/no-nodejs-modules --
 * ADR-019 keeps production core pure; this test file runs under Node/Vitest
 * and must read the binding fixture corpus from disk (10-testing.md §2). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GsiPayloadSubset } from './payload-schema';
import { parseGsiPayload } from './payload-schema';
import type { GsiState, GsiStatusMachine, StaleScheduler } from './status-state-machine';
import { createGsiStatusMachine, STALE_TIMEOUT_MS } from './status-state-machine';

const FIXTURES_DIR = fileURLToPath(new URL('../../../../tests/fixtures/gsi', import.meta.url));

/** All real corpus payloads in recording order (scenario dirs sort 01→05). */
function readCorpusInOrder(): GsiPayloadSubset[] {
  const realDir = join(FIXTURES_DIR, 'real');
  const payloads: GsiPayloadSubset[] = [];
  for (const scenario of readdirSync(realDir)) {
    for (const file of readdirSync(join(realDir, scenario))) {
      const result = parseGsiPayload(readFileSync(join(realDir, scenario, file), 'utf8'));
      if (!result.ok) throw new Error(`corpus fixture failed to parse: ${scenario}/${file}`);
      payloads.push(result.payload);
    }
  }
  return payloads;
}

function payload(mapName: string | null, providerTimestamp = 1): GsiPayloadSubset {
  // The status machine reads only `mapName`/`providerTimestamp`; the widened
  // scoreboard sections (SCB.2) are irrelevant here and stay empty.
  return {
    providerTimestamp,
    mapName,
    providerSteamId: null,
    map: null,
    round: null,
    player: null,
  };
}

// The machine's scheduler port backed by (fake-timer-controlled) globals —
// production wiring provides the real equivalent (E10.7).
const timerScheduler: StaleScheduler = {
  schedule(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
};

describe('createGsiStatusMachine', () => {
  let machine: GsiStatusMachine;
  let events: GsiState[];

  beforeEach(() => {
    vi.useFakeTimers();
    machine = createGsiStatusMachine(timerScheduler);
    events = [];
    machine.onStateChanged((state) => events.push(state));
  });

  afterEach(() => {
    machine.dispose();
    vi.useRealTimers();
  });

  /** Drives the machine from not-set-up into connected with no map. */
  function connect(): void {
    machine.reportConfigValid();
    machine.handlePayload(payload(null));
  }

  it('starts as not-set-up with no map', () => {
    expect(machine.getState()).toEqual({ status: 'not-set-up', mapName: null });
    expect(events).toEqual([]);
  });

  describe('config verification transitions (05-gsi.md §6.1)', () => {
    it('not-set-up → waiting on a valid config', () => {
      machine.reportConfigValid();
      expect(machine.getState()).toEqual({ status: 'waiting', mapName: null });
    });

    it('not-set-up → repair-needed on a missing/outdated config', () => {
      machine.reportConfigInvalid();
      expect(machine.getState().status).toBe('repair-needed');
    });

    it('waiting → repair-needed on a missing/outdated config', () => {
      machine.reportConfigValid();
      machine.reportConfigInvalid();
      expect(machine.getState().status).toBe('repair-needed');
    });

    it('repair-needed → waiting after repair (config valid again)', () => {
      machine.reportConfigInvalid();
      machine.reportConfigValid();
      expect(machine.getState().status).toBe('waiting');
    });

    it('stale → repair-needed on a missing/outdated config', () => {
      connect();
      vi.advanceTimersByTime(STALE_TIMEOUT_MS);
      machine.reportConfigInvalid();
      expect(machine.getState().status).toBe('repair-needed');
    });

    it('ignores config results that trigger no transition (diagram has no such arrows)', () => {
      connect();
      machine.reportConfigInvalid(); // connected: flowing data proves the config
      expect(machine.getState().status).toBe('connected');
      machine.reportConfigValid(); // connected: nothing to change
      expect(machine.getState().status).toBe('connected');
    });
  });

  describe('payload transitions', () => {
    it('waiting → connected on the first valid payload (a menus heartbeat suffices)', () => {
      machine.reportConfigValid();
      machine.handlePayload(payload(null));
      expect(machine.getState()).toEqual({ status: 'connected', mapName: null });
    });

    it('tracks the raw map name from payloads while connected', () => {
      connect();
      machine.handlePayload(payload('de_dust2'));
      expect(machine.getState()).toEqual({ status: 'connected', mapName: 'de_dust2' });
    });

    it('clears the map when the map section disappears (back in menus), staying connected', () => {
      connect();
      machine.handlePayload(payload('de_dust2'));
      machine.handlePayload(payload(null));
      expect(machine.getState()).toEqual({ status: 'connected', mapName: null });
    });

    it('ignores payloads while not-set-up (no transition defined in §6.1)', () => {
      machine.handlePayload(payload('de_dust2'));
      expect(machine.getState()).toEqual({ status: 'not-set-up', mapName: null });
      expect(events).toEqual([]);
    });

    it('ignores payloads while repair-needed (no transition defined in §6.1)', () => {
      machine.reportConfigInvalid();
      machine.handlePayload(payload('de_dust2'));
      expect(machine.getState()).toEqual({ status: 'repair-needed', mapName: null });
    });
  });

  describe('stale timeout (ADR-031: 30 s without any payload)', () => {
    it('connected → stale after exactly 30 s without a payload, clearing the map', () => {
      connect();
      machine.handlePayload(payload('de_dust2'));
      vi.advanceTimersByTime(STALE_TIMEOUT_MS - 1);
      expect(machine.getState().status).toBe('connected');
      vi.advanceTimersByTime(1);
      expect(machine.getState()).toEqual({ status: 'stale', mapName: null });
    });

    it('every payload resets the timeout — heartbeats keep the connection alive', () => {
      connect();
      // Two heartbeat gaps of 29 999 ms each: 59 998 ms total without going
      // stale, pinning the reset-on-payload semantics at the boundary.
      vi.advanceTimersByTime(STALE_TIMEOUT_MS - 1);
      machine.handlePayload(payload(null));
      vi.advanceTimersByTime(STALE_TIMEOUT_MS - 1);
      expect(machine.getState().status).toBe('connected');
      vi.advanceTimersByTime(1);
      expect(machine.getState().status).toBe('stale');
    });

    it('stale → connected when a payload arrives again (recovery)', () => {
      connect();
      vi.advanceTimersByTime(STALE_TIMEOUT_MS);
      machine.handlePayload(payload('de_dust2'));
      expect(machine.getState()).toEqual({ status: 'connected', mapName: 'de_dust2' });
    });

    it('waiting has no timeout — it never goes stale on its own', () => {
      machine.reportConfigValid();
      vi.advanceTimersByTime(STALE_TIMEOUT_MS * 10);
      expect(machine.getState().status).toBe('waiting');
    });

    it('dispose cancels the pending timeout', () => {
      connect();
      machine.dispose();
      vi.advanceTimersByTime(STALE_TIMEOUT_MS);
      expect(machine.getState().status).toBe('connected');
    });
  });

  describe('change filtering (02-architecture.md §4.2)', () => {
    it('identical consecutive payloads emit no event', () => {
      connect();
      machine.handlePayload(payload('de_dust2'));
      const eventsSoFar = events.length;
      machine.handlePayload(payload('de_dust2'));
      machine.handlePayload(payload('de_dust2'));
      expect(events.length).toBe(eventsSoFar);
    });

    it('heartbeats differing only in provider timestamp emit no event', () => {
      connect();
      const eventsSoFar = events.length;
      machine.handlePayload(payload(null, 1000));
      machine.handlePayload(payload(null, 1010));
      expect(events.length).toBe(eventsSoFar);
    });

    it('a map change while connected emits exactly one event with the new name', () => {
      connect();
      machine.handlePayload(payload('de_dust2'));
      const eventsSoFar = events.length;
      machine.handlePayload(payload('de_cache'));
      expect(events.length).toBe(eventsSoFar + 1);
      expect(events.at(-1)).toEqual({ status: 'connected', mapName: 'de_cache' });
    });

    it('listeners receive the same state getState() reports', () => {
      machine.reportConfigValid();
      expect(events.at(-1)).toEqual(machine.getState());
    });

    it('an unsubscribed listener receives no further events', () => {
      const received: GsiState[] = [];
      const unsubscribe = machine.onStateChanged((state) => received.push(state));
      machine.reportConfigValid();
      unsubscribe();
      machine.handlePayload(payload('de_dust2'));
      expect(received).toEqual([{ status: 'waiting', mapName: null }]);
    });

    it('replaying the full real corpus emits one event per distinct consecutive map state (change filtering)', () => {
      // Change filtering (02-architecture §4.2): the machine emits only on a
      // structural change, so replaying the corpus reproduces exactly its
      // map-name sequence with consecutive duplicates collapsed — far fewer
      // events than payloads, and robust to the corpus growing (SCB.1 added
      // the scoreboard scenarios/maps to the same directory tree).
      const corpus = readCorpusInOrder();
      const expectedMapNames = corpus
        .map((p) => p.mapName)
        .filter((mapName, index, all) => index === 0 || mapName !== all[index - 1]);

      machine.reportConfigValid();
      const start = events.length;
      for (const p of corpus) machine.handlePayload(p);

      expect(events.slice(start)).toEqual(
        expectedMapNames.map((mapName) => ({ status: 'connected', mapName })),
      );
      expect(events.slice(start).length).toBeLessThan(corpus.length);
    });
  });
});
