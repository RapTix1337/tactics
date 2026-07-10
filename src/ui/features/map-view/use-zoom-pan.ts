import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Zoom/pan transform of the map canvas (E14.2, 06-ui.md §3): a scale plus a
 * screen-pixel translation, applied as `translate(x, y) scale(scale)` with
 * origin `0 0`. Local view state only (ADR-033 level 2) — never persisted.
 */
export interface ZoomPanTransform {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export const ZOOM_PAN_IDENTITY: ZoomPanTransform = { scale: 1, x: 0, y: 0 };

/** Scale 1 = the image fits the viewport; zooming out below that is pointless. */
export const MIN_SCALE = 1;
export const MAX_SCALE = 8;

const WHEEL_ZOOM_SENSITIVITY = 0.002;
const KEYBOARD_ZOOM_FACTOR = 1.2;
const KEYBOARD_PAN_STEP = 48;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * With origin `0 0` the scaled content spans `[t, t + scale·extent]`; keeping
 * the viewport `[0, extent]` covered bounds the translation to
 * `[extent·(1 − scale), 0]`. At scale 1 this collapses to 0 — panning the
 * fitted image is a no-op by construction.
 */
function clampTranslation(value: number, scale: number, extent: number): number {
  return Math.min(0, Math.max(extent * (1 - scale), value));
}

/**
 * Scales around `focus` (viewport-relative screen point): the content point
 * currently under the focus stays under it after the zoom.
 */
export function zoomTowards(
  current: ZoomPanTransform,
  focus: { readonly x: number; readonly y: number },
  factor: number,
  viewport: ViewportSize,
): ZoomPanTransform {
  const scale = clampScale(current.scale * factor);
  return {
    scale,
    x: clampTranslation(
      focus.x - ((focus.x - current.x) / current.scale) * scale,
      scale,
      viewport.width,
    ),
    y: clampTranslation(
      focus.y - ((focus.y - current.y) / current.scale) * scale,
      scale,
      viewport.height,
    ),
  };
}

/** Moves the content by a screen-pixel delta (drag direction), clamped. */
export function panBy(
  current: ZoomPanTransform,
  deltaX: number,
  deltaY: number,
  viewport: ViewportSize,
): ZoomPanTransform {
  return {
    scale: current.scale,
    x: clampTranslation(current.x + deltaX, current.scale, viewport.width),
    y: clampTranslation(current.y + deltaY, current.scale, viewport.height),
  };
}

interface ActivePan {
  readonly pointerId: number;
  lastX: number;
  lastY: number;
}

export interface ZoomPan {
  readonly transform: ZoomPanTransform;
  readonly isPanning: boolean;
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  readonly onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  readonly onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

function viewportOf(element: HTMLElement): ViewportSize {
  const rect = element.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

/**
 * Wheel zoom (cursor-centered), drag pan, and keyboard equivalents (UI-06:
 * `+`/`-` zoom on the viewport center, arrow keys pan, `0` resets) for the
 * element carrying `containerRef`. Only the returned CSS transform changes
 * per interaction — no re-layout (risk P2).
 */
export function useZoomPan(): ZoomPan {
  const [transform, setTransform] = useState<ZoomPanTransform>(ZOOM_PAN_IDENTITY);
  const [isPanning, setIsPanning] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activePan = useRef<ActivePan | undefined>(undefined);

  // React registers `wheel` passively; preventing the default (page scroll /
  // Electron page zoom) needs a native non-passive listener.
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) {
      return;
    }
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const focus = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
      setTransform((current) =>
        zoomTowards(current, focus, factor, { width: rect.width, height: rect.height }),
      );
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return (): void => {
      element.removeEventListener('wheel', onWheel);
    };
  }, []);

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    // Keeps the drag alive when the pointer leaves the canvas (stubbed in
    // jsdom via test-setup).
    event.currentTarget.setPointerCapture(event.pointerId);
    activePan.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
    setIsPanning(true);
  }, []);

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    const pan = activePan.current;
    if (pan === undefined || pan.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - pan.lastX;
    const deltaY = event.clientY - pan.lastY;
    pan.lastX = event.clientX;
    pan.lastY = event.clientY;
    const viewport = viewportOf(event.currentTarget);
    setTransform((current) => panBy(current, deltaX, deltaY, viewport));
  }, []);

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    if (activePan.current?.pointerId !== event.pointerId) {
      return;
    }
    activePan.current = undefined;
    setIsPanning(false);
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    const viewport = viewportOf(event.currentTarget);
    const center = { x: viewport.width / 2, y: viewport.height / 2 };
    switch (event.key) {
      case '+':
      case '=':
        setTransform((current) => zoomTowards(current, center, KEYBOARD_ZOOM_FACTOR, viewport));
        break;
      case '-':
      case '_':
        setTransform((current) => zoomTowards(current, center, 1 / KEYBOARD_ZOOM_FACTOR, viewport));
        break;
      case 'ArrowLeft':
        setTransform((current) => panBy(current, KEYBOARD_PAN_STEP, 0, viewport));
        break;
      case 'ArrowRight':
        setTransform((current) => panBy(current, -KEYBOARD_PAN_STEP, 0, viewport));
        break;
      case 'ArrowUp':
        setTransform((current) => panBy(current, 0, KEYBOARD_PAN_STEP, viewport));
        break;
      case 'ArrowDown':
        setTransform((current) => panBy(current, 0, -KEYBOARD_PAN_STEP, viewport));
        break;
      case '0':
        setTransform(ZOOM_PAN_IDENTITY);
        break;
      default:
        return;
    }
    event.preventDefault();
  }, []);

  return {
    transform,
    isPanning,
    containerRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onKeyDown,
  };
}
