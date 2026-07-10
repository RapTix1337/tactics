import type { Rectangle } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WindowBounds } from '../../modules/settings';
import type { Logger } from '../../shared';
import type { BoundsWindowPort } from './window-bounds';
import {
  BOUNDS_SAVE_DEBOUNCE_MS,
  captureWindowBounds,
  createWindowBoundsTracker,
  planBoundsRestore,
} from './window-bounds';

const PRIMARY_WORK_AREA: Rectangle = { x: 0, y: 0, width: 2560, height: 1400 };
const SECOND_WORK_AREA: Rectangle = { x: 2560, y: 0, width: 1920, height: 1040 };

function bounds(partial?: Partial<WindowBounds>): WindowBounds {
  return { x: 100, y: 80, width: 1280, height: 800, maximized: false, ...partial };
}

function createWindowFake(overrides?: Partial<BoundsWindowPort>): BoundsWindowPort {
  return {
    getNormalBounds: (): Rectangle => ({ x: 100, y: 80, width: 1280, height: 800 }),
    isMaximized: (): boolean => false,
    isDestroyed: (): boolean => false,
    ...overrides,
  };
}

function createLoggerFake(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = [];
  return {
    logger: {
      error: (): void => {},
      warn: (message): void => {
        warnings.push(message);
      },
      info: (): void => {},
      debug: (): void => {},
    },
    warnings,
  };
}

describe('captureWindowBounds', () => {
  it('reads the normal bounds and the maximized flag', () => {
    const window = createWindowFake({ isMaximized: (): boolean => true });

    expect(captureWindowBounds(window)).toEqual(bounds({ maximized: true }));
  });

  it('rounds fractional bounds from scaled displays to integers', () => {
    const window = createWindowFake({
      getNormalBounds: (): Rectangle => ({ x: 99.5, y: 80.2, width: 1280.4, height: 799.6 }),
    });

    expect(captureWindowBounds(window)).toEqual(
      bounds({ x: 100, y: 80, width: 1280, height: 800 }),
    );
  });
});

describe('planBoundsRestore', () => {
  it('returns null when nothing was captured yet', () => {
    expect(planBoundsRestore(null, [PRIMARY_WORK_AREA])).toBeNull();
  });

  it('returns null without any display (defensive)', () => {
    expect(planBoundsRestore(bounds(), [])).toBeNull();
  });

  it('restores fully visible bounds unchanged, maximized round-tripping', () => {
    for (const maximized of [false, true]) {
      const plan = planBoundsRestore(bounds({ maximized }), [PRIMARY_WORK_AREA, SECOND_WORK_AREA]);

      expect(plan).toEqual({
        bounds: { x: 100, y: 80, width: 1280, height: 800 },
        maximized,
      });
    }
  });

  it('keeps a window on a secondary display when that display still exists', () => {
    const stored = bounds({ x: 3000, y: 100 });

    const plan = planBoundsRestore(stored, [PRIMARY_WORK_AREA, SECOND_WORK_AREA]);

    expect(plan?.bounds).toEqual({ x: 3000, y: 100, width: 1280, height: 800 });
  });

  it('moves off-screen bounds onto the primary work area (monitor removed)', () => {
    const stored = bounds({ x: 3000, y: 100 });

    const plan = planBoundsRestore(stored, [PRIMARY_WORK_AREA]);

    expect(plan?.bounds).toEqual({ x: 1280, y: 100, width: 1280, height: 800 });
  });

  it('clamps a partially visible window fully into its work area', () => {
    const stored = bounds({ x: -200, y: 1300 });

    const plan = planBoundsRestore(stored, [PRIMARY_WORK_AREA]);

    expect(plan?.bounds).toEqual({ x: 0, y: 600, width: 1280, height: 800 });
  });

  it('caps bounds larger than the work area to its size and origin', () => {
    const stored = bounds({ x: 10, y: 10, width: 4000, height: 3000 });

    const plan = planBoundsRestore(stored, [PRIMARY_WORK_AREA]);

    expect(plan?.bounds).toEqual({
      x: PRIMARY_WORK_AREA.x,
      y: PRIMARY_WORK_AREA.y,
      width: PRIMARY_WORK_AREA.width,
      height: PRIMARY_WORK_AREA.height,
    });
  });

  it('respects a work-area origin offset (taskbar on top/left)', () => {
    const offsetArea: Rectangle = { x: 60, y: 40, width: 2500, height: 1360 };
    const stored = bounds({ x: 0, y: 0 });

    const plan = planBoundsRestore(stored, [offsetArea]);

    expect(plan?.bounds).toEqual({ x: 60, y: 40, width: 1280, height: 800 });
  });
});

describe('createWindowBoundsTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createTrackerHarness(window: BoundsWindowPort = createWindowFake()): {
    tracker: ReturnType<typeof createWindowBoundsTracker>;
    persisted: WindowBounds[];
    warnings: string[];
  } {
    const persisted: WindowBounds[] = [];
    const { logger, warnings } = createLoggerFake();
    const tracker = createWindowBoundsTracker({
      window,
      persist: (next) => {
        persisted.push(next);
      },
      logger,
    });
    return { tracker, persisted, warnings };
  }

  it('debounces an event burst into a single save', () => {
    const { tracker, persisted } = createTrackerHarness();

    for (let i = 0; i < 25; i += 1) {
      tracker.scheduleSave();
      vi.advanceTimersByTime(BOUNDS_SAVE_DEBOUNCE_MS - 1);
    }
    expect(persisted).toEqual([]);

    vi.advanceTimersByTime(BOUNDS_SAVE_DEBOUNCE_MS);

    expect(persisted).toEqual([bounds()]);
  });

  it('flush cancels the pending save and persists immediately', () => {
    const { tracker, persisted } = createTrackerHarness();
    tracker.scheduleSave();

    tracker.flush();

    expect(persisted).toEqual([bounds()]);
    vi.runAllTimers();
    expect(persisted).toHaveLength(1);
  });

  it('skips the save when the window is already destroyed', () => {
    const { tracker, persisted } = createTrackerHarness(
      createWindowFake({ isDestroyed: (): boolean => true }),
    );
    tracker.scheduleSave();

    vi.runAllTimers();
    tracker.flush();

    expect(persisted).toEqual([]);
  });

  it('logs a failing persist as a warning instead of throwing', () => {
    const { logger, warnings } = createLoggerFake();
    const tracker = createWindowBoundsTracker({
      window: createWindowFake(),
      persist: () => {
        throw new Error('database is closed');
      },
      logger,
    });

    expect(() => tracker.flush()).not.toThrow();
    expect(warnings).toEqual(['Persisting window bounds failed']);
  });

  it('round-trips capture → persist → restore against a stateful store', () => {
    // The E17.3 acceptance restart, with a stateful fake standing in for the
    // operational-state repository (the E17.2 read-back pattern): what the
    // tracker persists on close is exactly what the next launch restores.
    let stored: WindowBounds | null = null;
    const { logger } = createLoggerFake();
    const window = createWindowFake({
      getNormalBounds: (): Rectangle => ({ x: 2600, y: 50, width: 1400, height: 900 }),
      isMaximized: (): boolean => true,
    });
    const tracker = createWindowBoundsTracker({
      window,
      persist: (next) => {
        stored = next;
      },
      logger,
    });

    tracker.scheduleSave();
    tracker.flush();

    // Same displays: the placement comes back exactly, still maximized.
    expect(planBoundsRestore(stored, [PRIMARY_WORK_AREA, SECOND_WORK_AREA])).toEqual({
      bounds: { x: 2600, y: 50, width: 1400, height: 900 },
      maximized: true,
    });
    // Second monitor gone: same stored state, clamped into the primary.
    expect(planBoundsRestore(stored, [PRIMARY_WORK_AREA])).toEqual({
      bounds: { x: 1160, y: 50, width: 1400, height: 900 },
      maximized: true,
    });
  });
});
