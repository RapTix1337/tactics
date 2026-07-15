import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type { OverlayResizeEdge, OverlayState } from './overlay-state';
import {
  OVERLAY_RESIZE_EDGES,
  overlayResizeRequestSchema,
  overlayStateSchema,
} from './overlay-state';

describe('overlayStateSchema', () => {
  it('accepts the full slice and rejects a missing or non-boolean open', () => {
    expect(overlayStateSchema.safeParse({ open: true }).success).toBe(true);
    expect(overlayStateSchema.safeParse({ open: false }).success).toBe(true);
    expect(overlayStateSchema.safeParse({}).success).toBe(false);
    expect(overlayStateSchema.safeParse({ open: 1 }).success).toBe(false);
    expect(overlayStateSchema.safeParse(undefined).success).toBe(false);
  });

  it('infers exactly the OverlayState interface (both directions, type level)', () => {
    expectTypeOf<z.infer<typeof overlayStateSchema>>().toExtend<OverlayState>();
    expectTypeOf<OverlayState>().toExtend<z.infer<typeof overlayStateSchema>>();
  });
});

describe('overlayResizeRequestSchema', () => {
  it('accepts every edge/corner of the closed enum with screen coordinates', () => {
    for (const edge of OVERLAY_RESIZE_EDGES) {
      expect(
        overlayResizeRequestSchema.safeParse({ edge, pointerX: 120.5, pointerY: -40 }).success,
      ).toBe(true);
    }
  });

  it('rejects unknown edges at the boundary (named INVALID_REQUEST path)', () => {
    expect(
      overlayResizeRequestSchema.safeParse({ edge: 'center', pointerX: 0, pointerY: 0 }).success,
    ).toBe(false);
    expect(overlayResizeRequestSchema.safeParse({ pointerX: 0, pointerY: 0 }).success).toBe(false);
  });

  it('rejects missing and non-finite pointer coordinates', () => {
    expect(overlayResizeRequestSchema.safeParse({ edge: 'left', pointerX: 0 }).success).toBe(false);
    expect(overlayResizeRequestSchema.safeParse({ edge: 'left', pointerY: 0 }).success).toBe(false);
    expect(
      overlayResizeRequestSchema.safeParse({ edge: 'left', pointerX: Number.NaN, pointerY: 0 })
        .success,
    ).toBe(false);
    expect(
      overlayResizeRequestSchema.safeParse({
        edge: 'left',
        pointerX: Number.POSITIVE_INFINITY,
        pointerY: 0,
      }).success,
    ).toBe(false);
    expect(
      overlayResizeRequestSchema.safeParse({ edge: 'left', pointerX: '12', pointerY: 0 }).success,
    ).toBe(false);
  });

  it('covers the closed edge set exactly (type level, 4 edges + 4 corners)', () => {
    expectTypeOf<(typeof OVERLAY_RESIZE_EDGES)[number]>().toEqualTypeOf<OverlayResizeEdge>();
    expectTypeOf<OverlayResizeEdge>().toEqualTypeOf<
      | 'left'
      | 'right'
      | 'top'
      | 'bottom'
      | 'top-left'
      | 'top-right'
      | 'bottom-left'
      | 'bottom-right'
    >();
  });
});
