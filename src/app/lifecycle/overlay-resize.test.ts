import type { Rectangle } from 'electron';
import { describe, expect, it } from 'vitest';

import { OVERLAY_RESIZE_EDGES } from '../../shared';
import { computeResizedBounds, OVERLAY_MIN_HEIGHT, OVERLAY_MIN_WIDTH } from './overlay-resize';

// OVL.3 acceptance criterion: all 8 edges/corners, min-size clamping on
// both axes, and anchor-edge stability (the non-dragged edge never moves)
// — including pointer jumps past the opposite edge (the stated risk).
describe('computeResizedBounds', () => {
  // right = 1060, bottom = 740
  const current: Rectangle = { x: 100, y: 200, width: 960, height: 540 };
  const minSize = { width: 480, height: 320 };

  it('finalizes the minimum overlay size at 480×320', () => {
    expect(OVERLAY_MIN_WIDTH).toBe(480);
    expect(OVERLAY_MIN_HEIGHT).toBe(320);
  });

  it('moves the right edge to the pointer, left edge anchored', () => {
    expect(computeResizedBounds(current, 'right', { x: 1300, y: 999 }, minSize)).toEqual({
      x: 100,
      y: 200,
      width: 1200,
      height: 540,
    });
  });

  it('moves the left edge to the pointer, right edge anchored', () => {
    expect(computeResizedBounds(current, 'left', { x: 40, y: 999 }, minSize)).toEqual({
      x: 40,
      y: 200,
      width: 1020,
      height: 540,
    });
  });

  it('moves the bottom edge to the pointer, top edge anchored', () => {
    expect(computeResizedBounds(current, 'bottom', { x: 999, y: 800 }, minSize)).toEqual({
      x: 100,
      y: 200,
      width: 960,
      height: 600,
    });
  });

  it('moves the top edge to the pointer, bottom edge anchored', () => {
    expect(computeResizedBounds(current, 'top', { x: 999, y: 150 }, minSize)).toEqual({
      x: 100,
      y: 150,
      width: 960,
      height: 590,
    });
  });

  it('moves both axes on the bottom-right corner', () => {
    expect(computeResizedBounds(current, 'bottom-right', { x: 1300, y: 800 }, minSize)).toEqual({
      x: 100,
      y: 200,
      width: 1200,
      height: 600,
    });
  });

  it('moves both axes on the top-left corner', () => {
    expect(computeResizedBounds(current, 'top-left', { x: 40, y: 150 }, minSize)).toEqual({
      x: 40,
      y: 150,
      width: 1020,
      height: 590,
    });
  });

  it('moves both axes on the top-right corner', () => {
    expect(computeResizedBounds(current, 'top-right', { x: 1300, y: 150 }, minSize)).toEqual({
      x: 100,
      y: 150,
      width: 1200,
      height: 590,
    });
  });

  it('moves both axes on the bottom-left corner', () => {
    expect(computeResizedBounds(current, 'bottom-left', { x: 40, y: 800 }, minSize)).toEqual({
      x: 40,
      y: 200,
      width: 1020,
      height: 600,
    });
  });

  it('clamps width to the minimum when dragging right inward, left anchored', () => {
    expect(computeResizedBounds(current, 'right', { x: 300, y: 999 }, minSize)).toEqual({
      x: 100,
      y: 200,
      width: 480,
      height: 540,
    });
  });

  it('clamps width to the minimum when dragging left inward, right anchored', () => {
    // Anchor: right edge stays at 1060 ⇒ x = 1060 - 480 = 580.
    expect(computeResizedBounds(current, 'left', { x: 900, y: 999 }, minSize)).toEqual({
      x: 580,
      y: 200,
      width: 480,
      height: 540,
    });
  });

  it('clamps height to the minimum when dragging bottom inward, top anchored', () => {
    expect(computeResizedBounds(current, 'bottom', { x: 999, y: 300 }, minSize)).toEqual({
      x: 100,
      y: 200,
      width: 960,
      height: 320,
    });
  });

  it('clamps height to the minimum when dragging top inward, bottom anchored', () => {
    // Anchor: bottom edge stays at 740 ⇒ y = 740 - 320 = 420.
    expect(computeResizedBounds(current, 'top', { x: 999, y: 700 }, minSize)).toEqual({
      x: 100,
      y: 420,
      width: 960,
      height: 320,
    });
  });

  it('holds the anchors when the pointer jumps past the opposite edges (no inversion)', () => {
    // Dragging the top-left corner far past the bottom-right corner.
    expect(computeResizedBounds(current, 'top-left', { x: 2000, y: 1500 }, minSize)).toEqual({
      x: 580,
      y: 420,
      width: 480,
      height: 320,
    });
    // Dragging the bottom-right corner far past the top-left corner.
    expect(computeResizedBounds(current, 'bottom-right', { x: -500, y: -500 }, minSize)).toEqual({
      x: 100,
      y: 200,
      width: 480,
      height: 320,
    });
  });

  it('never moves the non-dragged sides, for every edge and corner', () => {
    for (const edge of OVERLAY_RESIZE_EDGES) {
      const result = computeResizedBounds(current, edge, { x: 1300, y: 800 }, minSize);
      if (!edge.includes('left')) {
        expect(result.x, edge).toBe(current.x);
      }
      if (!edge.includes('top')) {
        expect(result.y, edge).toBe(current.y);
      }
      if (!edge.includes('right') && !edge.includes('left')) {
        expect(result.width, edge).toBe(current.width);
      }
      if (!edge.includes('top') && !edge.includes('bottom')) {
        expect(result.height, edge).toBe(current.height);
      }
    }
  });

  it('rounds fractional pointer positions to integer bounds (DPI scaling)', () => {
    const result = computeResizedBounds(current, 'bottom-right', { x: 1300.6, y: 800.4 }, minSize);
    expect(result).toEqual({ x: 100, y: 200, width: 1201, height: 600 });
    expect(Number.isInteger(result.width)).toBe(true);
    expect(Number.isInteger(result.height)).toBe(true);
  });

  it('returns the current rectangle when the pointer sits on the dragged corner', () => {
    expect(computeResizedBounds(current, 'bottom-right', { x: 1060, y: 740 }, minSize)).toEqual(
      current,
    );
  });
});
