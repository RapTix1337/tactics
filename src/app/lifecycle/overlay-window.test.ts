import type { Rectangle } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WindowBounds } from '../../modules/settings';
import type { Logger, OverlayState } from '../../shared';
import { OVERLAY_MIN_HEIGHT, OVERLAY_MIN_WIDTH } from './overlay-resize';
import type { OverlayWindowManager, OverlayWindowPort } from './overlay-window';
import { createOverlayWindowManager, OVERLAY_TOPMOST_REASSERT_MS } from './overlay-window';
import { BOUNDS_SAVE_DEBOUNCE_MS } from './window-bounds';

const WORK_AREA: Rectangle = { x: 0, y: 0, width: 2560, height: 1400 };
const INITIAL_BOUNDS: Rectangle = { x: 100, y: 100, width: 960, height: 540 };

interface FakeWindow {
  readonly port: OverlayWindowPort;
  readonly focus: ReturnType<typeof vi.fn>;
  readonly moveTop: ReturnType<typeof vi.fn>;
  readonly setBounds: ReturnType<typeof vi.fn>;
  /** Simulates a native close (window ✕ / Alt+F4): close → destroy → closed. */
  readonly emitNativeClose: () => void;
  readonly emit: (event: string) => void;
}

function createFakeWindow(initialBounds: Rectangle = INITIAL_BOUNDS): FakeWindow {
  const listeners = new Map<string, Array<() => void>>();
  let bounds = { ...initialBounds };
  let destroyed = false;

  const emit = (event: string): void => {
    for (const listener of listeners.get(event) ?? []) {
      listener();
    }
  };
  const emitNativeClose = (): void => {
    emit('close');
    destroyed = true;
    emit('closed');
  };

  const focus = vi.fn();
  const moveTop = vi.fn();
  const setBounds = vi.fn((next: Rectangle) => {
    bounds = { ...next };
  });

  const port: OverlayWindowPort = {
    focus,
    moveTop,
    // The real BrowserWindow.close() runs the same sequence as a native ✕.
    close: () => emitNativeClose(),
    getBounds: () => ({ ...bounds }),
    setBounds,
    getNormalBounds: () => ({ ...bounds }),
    isMaximized: () => false,
    isDestroyed: () => destroyed,
    on: (event, listener) => {
      const existing = listeners.get(event) ?? [];
      listeners.set(event, [...existing, listener]);
    },
  };

  return { port, focus, moveTop, setBounds, emitNativeClose, emit };
}

function createLoggerFake(): Logger {
  return {
    error: (): void => {},
    warn: (): void => {},
    info: (): void => {},
    debug: (): void => {},
  };
}

interface Harness {
  readonly manager: OverlayWindowManager;
  readonly windows: FakeWindow[];
  readonly createWindow: ReturnType<typeof vi.fn>;
  readonly persisted: WindowBounds[];
  readonly states: OverlayState[];
}

function createHarness(options?: { storedBounds?: WindowBounds | null }): Harness {
  const windows: FakeWindow[] = [];
  const persisted: WindowBounds[] = [];
  const states: OverlayState[] = [];
  const createWindow = vi.fn((restoredBounds: Rectangle | undefined): OverlayWindowPort => {
    const window = createFakeWindow(restoredBounds ?? INITIAL_BOUNDS);
    windows.push(window);
    return window.port;
  });
  const manager = createOverlayWindowManager({
    createWindow,
    getStoredBounds: () => options?.storedBounds ?? null,
    getWorkAreas: () => [WORK_AREA],
    persistBounds: (bounds) => {
      persisted.push(bounds);
    },
    logger: createLoggerFake(),
  });
  manager.onStateChanged((state) => {
    states.push(state);
  });
  return { manager, windows, createWindow, persisted, states };
}

describe('createOverlayWindowManager — open', () => {
  it('opens without restore bounds on first open (defaults, OS-centered)', () => {
    const { manager, createWindow } = createHarness();

    manager.open();

    expect(createWindow).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(manager.isOpen()).toBe(true);
  });

  it('passes persisted bounds through the restore plan, clamped to the work areas', () => {
    const { manager, createWindow } = createHarness({
      storedBounds: { x: -200, y: 1300, width: 960, height: 540, maximized: false },
    });

    manager.open();

    // planBoundsRestore semantics: shifted fully into the work area.
    expect(createWindow).toHaveBeenCalledExactlyOnceWith({
      x: 0,
      y: 860,
      width: 960,
      height: 540,
    });
  });

  it('focuses the existing window instead of creating a second one', () => {
    const { manager, windows, createWindow } = createHarness();
    manager.open();

    manager.open();

    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(windows[0]?.focus).toHaveBeenCalledTimes(1);
  });

  it('notifies listeners once with open: true, without repeats on idempotent opens', () => {
    const { manager, states } = createHarness();

    manager.open();
    manager.open();

    expect(states).toEqual([{ open: true }]);
  });
});

describe('createOverlayWindowManager — close', () => {
  it('closes the window and notifies open: false exactly once', () => {
    const { manager, states } = createHarness();
    manager.open();

    manager.close();

    expect(manager.isOpen()).toBe(false);
    expect(states).toEqual([{ open: true }, { open: false }]);
  });

  it('is a no-op without a window', () => {
    const { manager, states } = createHarness();

    expect(() => manager.close()).not.toThrow();
    expect(states).toEqual([]);
  });

  it('converges the native close path (window ✕) on the same single event', () => {
    const { manager, windows, states } = createHarness();
    manager.open();

    windows[0]?.emitNativeClose();

    expect(manager.isOpen()).toBe(false);
    expect(states).toEqual([{ open: true }, { open: false }]);
  });

  it('reopens with a fresh window after a close', () => {
    const { manager, createWindow } = createHarness();
    manager.open();
    manager.close();

    manager.open();

    expect(createWindow).toHaveBeenCalledTimes(2);
    expect(manager.isOpen()).toBe(true);
  });
});

describe('createOverlayWindowManager — bounds persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes the final placement on close, maximized structurally false', () => {
    const { manager, persisted } = createHarness();
    manager.open();

    manager.close();

    expect(persisted).toEqual([{ ...INITIAL_BOUNDS, maximized: false }]);
  });

  it('persists debounced after move and resize events', () => {
    const { manager, windows, persisted } = createHarness();
    manager.open();

    windows[0]?.emit('move');
    windows[0]?.emit('resize');
    expect(persisted).toEqual([]);

    vi.advanceTimersByTime(BOUNDS_SAVE_DEBOUNCE_MS);

    expect(persisted).toEqual([{ ...INITIAL_BOUNDS, maximized: false }]);
  });
});

describe('createOverlayWindowManager — resize', () => {
  it('applies the resize math via setBounds, clamped to the minimum size', () => {
    const { manager, windows } = createHarness();
    manager.open();

    // Dragging the right edge far past the left edge clamps at the minimum
    // width anchored on the left edge; the vertical axis stays untouched.
    manager.resize('right', INITIAL_BOUNDS.x - 500, 300);

    expect(windows[0]?.setBounds).toHaveBeenCalledExactlyOnceWith({
      x: INITIAL_BOUNDS.x,
      y: INITIAL_BOUNDS.y,
      width: OVERLAY_MIN_WIDTH,
      height: INITIAL_BOUNDS.height,
    });
  });

  it('clamps the vertical axis to the minimum height', () => {
    const { manager, windows } = createHarness();
    manager.open();

    manager.resize('bottom', 300, INITIAL_BOUNDS.y - 500);

    expect(windows[0]?.setBounds).toHaveBeenCalledExactlyOnceWith({
      x: INITIAL_BOUNDS.x,
      y: INITIAL_BOUNDS.y,
      width: INITIAL_BOUNDS.width,
      height: OVERLAY_MIN_HEIGHT,
    });
  });

  it('is a silent no-op after the window closed (in-flight drag frames)', () => {
    const { manager, windows } = createHarness();
    manager.open();
    manager.close();

    expect(() => manager.resize('right', 1200, 300)).not.toThrow();
    expect(windows[0]?.setBounds).not.toHaveBeenCalled();
  });

  it('is a silent no-op before any open', () => {
    const { manager } = createHarness();

    expect(() => manager.resize('left', 10, 10)).not.toThrow();
  });
});

// Regression (2026-07-16): a focused borderless CS2 also enters the topmost
// band and raises above the overlay — a one-shot alwaysOnTop set at creation
// loses the band fight (the WS_EX_TOPMOST bit was verified present). The
// manager re-raises the open overlay on an interval, the same effect as
// PowerToys' event-hook re-pinning (spec AC 2).
describe('createOverlayWindowManager — topmost re-assertion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-raises the open overlay once per interval', () => {
    const { manager, windows } = createHarness();
    manager.open();

    vi.advanceTimersByTime(OVERLAY_TOPMOST_REASSERT_MS);
    expect(windows[0]?.moveTop).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(OVERLAY_TOPMOST_REASSERT_MS * 3);
    expect(windows[0]?.moveTop).toHaveBeenCalledTimes(4);
  });

  it('stops re-raising after the window closes (either path)', () => {
    const { manager, windows } = createHarness();
    manager.open();
    vi.advanceTimersByTime(OVERLAY_TOPMOST_REASSERT_MS);

    windows[0]?.emitNativeClose();
    vi.advanceTimersByTime(OVERLAY_TOPMOST_REASSERT_MS * 5);

    expect(windows[0]?.moveTop).toHaveBeenCalledTimes(1);
  });

  it('re-assertion resumes with a fresh window after reopen', () => {
    const { manager, windows } = createHarness();
    manager.open();
    manager.close();
    manager.open();

    vi.advanceTimersByTime(OVERLAY_TOPMOST_REASSERT_MS);

    expect(windows[0]?.moveTop).not.toHaveBeenCalled();
    expect(windows[1]?.moveTop).toHaveBeenCalledTimes(1);
  });
});

describe('createOverlayWindowManager — state listeners', () => {
  it('stops notifying after unsubscribe', () => {
    const { manager } = createHarness();
    const states: OverlayState[] = [];
    const unsubscribe = manager.onStateChanged((state) => {
      states.push(state);
    });

    manager.open();
    unsubscribe();
    manager.close();

    expect(states).toEqual([{ open: true }]);
  });
});

describe('createOverlayWindowManager — main-window interplay (02-design.md §2.1)', () => {
  it('closes the overlay with the main window when close-to-tray is off', () => {
    const { manager, states } = createHarness();
    manager.open();

    manager.handleMainWindowClosed(false);

    expect(manager.isOpen()).toBe(false);
    expect(states).toEqual([{ open: true }, { open: false }]);
  });

  it('keeps the overlay alive when close-to-tray is on', () => {
    const { manager } = createHarness();
    manager.open();

    manager.handleMainWindowClosed(true);

    expect(manager.isOpen()).toBe(true);
  });

  it('is a no-op when the overlay is not open', () => {
    const { manager, states } = createHarness();

    expect(() => manager.handleMainWindowClosed(false)).not.toThrow();
    expect(states).toEqual([]);
  });
});
