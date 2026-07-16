import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { success } from '../../../shared/envelope';
import type { OverlayResizeEdge } from '../../../shared/overlay-state';
import { OVERLAY_RESIZE_EDGES } from '../../../shared/overlay-state';
import { resizeOverlay } from '../../lib/ipc/overlay';
import { ResizeHandles } from './ResizeHandles';

vi.mock('../../lib/ipc/overlay', () => ({ resizeOverlay: vi.fn() }));

const CURSOR_BY_EDGE: Record<OverlayResizeEdge, string> = {
  left: 'cursor-ew-resize',
  right: 'cursor-ew-resize',
  top: 'cursor-ns-resize',
  bottom: 'cursor-ns-resize',
  'top-left': 'cursor-nwse-resize',
  'bottom-right': 'cursor-nwse-resize',
  'top-right': 'cursor-nesw-resize',
  'bottom-left': 'cursor-nesw-resize',
};

function handle(edge: OverlayResizeEdge): HTMLElement {
  return screen.getByTestId(`resize-handle-${edge}`);
}

describe('ResizeHandles', () => {
  beforeEach(() => {
    // rAF-throttled dispatch (ADR-058): frames are driven explicitly, never
    // by real timing.
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    vi.mocked(resizeOverlay).mockReset().mockResolvedValue(success(undefined));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders all 8 handles outside the drag region with edge-matching cursors', () => {
    render(<ResizeHandles />);

    for (const edge of OVERLAY_RESIZE_EDGES) {
      const element = handle(edge);
      expect(element).toHaveClass('app-region-no-drag');
      expect(element).toHaveClass(CURSOR_BY_EDGE[edge]);
    }
  });

  it.each(OVERLAY_RESIZE_EDGES)(
    'coalesces a %s drag burst into one resize per frame with the latest screen coordinates',
    (edge) => {
      render(<ResizeHandles />);
      const element = handle(edge);

      fireEvent.pointerDown(element, { button: 0, pointerId: 1, screenX: 100, screenY: 100 });
      fireEvent.pointerMove(element, { pointerId: 1, screenX: 110, screenY: 105 });
      fireEvent.pointerMove(element, { pointerId: 1, screenX: 120.5, screenY: 111.25 });
      expect(resizeOverlay).not.toHaveBeenCalled();

      vi.advanceTimersToNextFrame();

      expect(resizeOverlay).toHaveBeenCalledTimes(1);
      expect(resizeOverlay).toHaveBeenCalledWith({ edge, pointerX: 120.5, pointerY: 111.25 });
    },
  );

  it('dispatches one resize per frame across consecutive move bursts', () => {
    render(<ResizeHandles />);
    const element = handle('right');

    fireEvent.pointerDown(element, { button: 0, pointerId: 1, screenX: 100, screenY: 100 });
    fireEvent.pointerMove(element, { pointerId: 1, screenX: 110, screenY: 100 });
    vi.advanceTimersToNextFrame();
    fireEvent.pointerMove(element, { pointerId: 1, screenX: 130, screenY: 102 });
    fireEvent.pointerMove(element, { pointerId: 1, screenX: 140, screenY: 104 });
    vi.advanceTimersToNextFrame();

    expect(resizeOverlay).toHaveBeenCalledTimes(2);
    expect(resizeOverlay).toHaveBeenLastCalledWith({ edge: 'right', pointerX: 140, pointerY: 104 });
  });

  it('flushes one final resize with the release coordinates instead of the pending frame', () => {
    render(<ResizeHandles />);
    const element = handle('bottom');

    fireEvent.pointerDown(element, { button: 0, pointerId: 1, screenX: 100, screenY: 100 });
    fireEvent.pointerMove(element, { pointerId: 1, screenX: 100, screenY: 130 });
    fireEvent.pointerUp(element, { pointerId: 1, screenX: 100, screenY: 137 });

    expect(resizeOverlay).toHaveBeenCalledTimes(1);
    expect(resizeOverlay).toHaveBeenCalledWith({ edge: 'bottom', pointerX: 100, pointerY: 137 });

    vi.advanceTimersToNextFrame();
    expect(resizeOverlay).toHaveBeenCalledTimes(1);
  });

  it('never dispatches after the pointer is released', () => {
    render(<ResizeHandles />);
    const element = handle('top-left');

    fireEvent.pointerDown(element, { button: 0, pointerId: 1, screenX: 50, screenY: 50 });
    fireEvent.pointerUp(element, { pointerId: 1, screenX: 40, screenY: 40 });
    expect(resizeOverlay).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(element, { pointerId: 1, screenX: 10, screenY: 10 });
    vi.advanceTimersToNextFrame();

    expect(resizeOverlay).toHaveBeenCalledTimes(1);
  });

  it('abandons the drag without a flush when the pointer is cancelled', () => {
    render(<ResizeHandles />);
    const element = handle('left');

    fireEvent.pointerDown(element, { button: 0, pointerId: 1, screenX: 100, screenY: 100 });
    fireEvent.pointerMove(element, { pointerId: 1, screenX: 90, screenY: 100 });
    fireEvent.pointerCancel(element, { pointerId: 1, screenX: 80, screenY: 100 });
    vi.advanceTimersToNextFrame();

    expect(resizeOverlay).not.toHaveBeenCalled();
  });

  it('ignores non-primary-button drags and moves without a drag', () => {
    render(<ResizeHandles />);
    const element = handle('top');

    fireEvent.pointerDown(element, { button: 2, pointerId: 1, screenX: 100, screenY: 100 });
    fireEvent.pointerMove(element, { pointerId: 1, screenX: 100, screenY: 80 });
    fireEvent.pointerUp(element, { pointerId: 1, screenX: 100, screenY: 80 });
    vi.advanceTimersToNextFrame();

    expect(resizeOverlay).not.toHaveBeenCalled();
  });
});
