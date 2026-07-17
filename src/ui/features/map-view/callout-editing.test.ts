import { describe, expect, it } from 'vitest';

import type { CatalogCallout } from '../../../shared/map-catalog';
import {
  addCallout,
  clampNormalized,
  clearCallouts,
  deleteCallout,
  isInsideImage,
  isNameTaken,
  moveCallout,
  renameCallout,
  screenToNormalized,
  toCallouts,
  toDraft,
} from './callout-editing';

const rect = { left: 16, top: 24, width: 800, height: 600 };

describe('screenToNormalized', () => {
  it('inverts the image box at the identity transform', () => {
    // (416, 324) is the image center: rect origin plus half the extent.
    expect(screenToNormalized({ x: 416, y: 324 }, { scale: 1, x: 0, y: 0 }, rect)).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it('inverts the zoom/pan transform at several zoom levels', () => {
    // The wrapper maps layout q to screen p = translate + scale·q; the image
    // center is layout (416, 324) — feed its screen position back in.
    expect(screenToNormalized({ x: 732, y: 598 }, { scale: 2, x: -100, y: -50 }, rect)).toEqual({
      x: 0.5,
      y: 0.5,
    });
    expect(screenToNormalized({ x: 328, y: 1392 }, { scale: 8, x: -3000, y: -1200 }, rect)).toEqual(
      { x: 0.5, y: 0.5 },
    );
  });

  it('round-trips an arbitrary normalized point through the forward mapping', () => {
    const transform = { scale: 3, x: -420, y: -260 };
    const point = { x: 0.25, y: 0.8 };
    const screen = {
      x: transform.x + transform.scale * (rect.left + point.x * rect.width),
      y: transform.y + transform.scale * (rect.top + point.y * rect.height),
    };

    const inverted = screenToNormalized(screen, transform, rect);

    expect(inverted.x).toBeCloseTo(point.x);
    expect(inverted.y).toBeCloseTo(point.y);
  });

  it('reports points outside the image without clamping', () => {
    const outside = screenToNormalized({ x: 0, y: 0 }, { scale: 1, x: 0, y: 0 }, rect);

    expect(outside.x).toBeLessThan(0);
    expect(outside.y).toBeLessThan(0);
    expect(isInsideImage(outside)).toBe(false);
    expect(clampNormalized(outside)).toEqual({ x: 0, y: 0 });
  });
});

describe('draft operations', () => {
  const saved: readonly CatalogCallout[] = [
    { name: 'Long', x: 0.7, y: 0.7 },
    { name: 'Pit', x: 0.2, y: 0.8 },
  ];

  it('round-trips a callout set through the draft shape', () => {
    const draft = toDraft(saved);

    expect(draft.map((callout) => callout.id)).toEqual([0, 1]);
    expect(toCallouts(draft)).toEqual(saved);
  });

  it('adds with a fresh id and a clamped position', () => {
    const draft = addCallout(toDraft(saved), 'New', { x: 1.4, y: -0.2 });

    expect(draft.at(-1)).toEqual({ id: 2, name: 'New', x: 1, y: 0 });

    // Ids never revive a deleted entry's identity: the next id tops the max.
    const afterDelete = addCallout(deleteCallout(draft, 0), 'Next', { x: 0.5, y: 0.5 });
    expect(afterDelete.at(-1)?.id).toBe(3);
  });

  it('moves only the target and clamps the position', () => {
    const draft = moveCallout(toDraft(saved), 0, { x: -0.5, y: 0.25 });

    expect(draft[0]).toEqual({ id: 0, name: 'Long', x: 0, y: 0.25 });
    expect(draft[1]).toEqual({ id: 1, name: 'Pit', x: 0.2, y: 0.8 });
  });

  it('renames only the target', () => {
    const draft = renameCallout(toDraft(saved), 1, 'Pit Upper');

    expect(draft.map((callout) => callout.name)).toEqual(['Long', 'Pit Upper']);
  });

  it('deletes the target', () => {
    expect(deleteCallout(toDraft(saved), 0).map((callout) => callout.name)).toEqual(['Pit']);
  });

  it('clears every callout', () => {
    expect(clearCallouts()).toEqual([]);
  });

  it('checks name uniqueness with a rename exclusion', () => {
    const draft = toDraft(saved);

    expect(isNameTaken(draft, 'Long')).toBe(true);
    // A rename may keep its own name …
    expect(isNameTaken(draft, 'Long', 0)).toBe(false);
    // … but not take another entry's.
    expect(isNameTaken(draft, 'Long', 1)).toBe(true);
    expect(isNameTaken(draft, 'Fresh')).toBe(false);
  });
});
