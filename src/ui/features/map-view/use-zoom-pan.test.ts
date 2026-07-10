import { describe, expect, it } from 'vitest';

import type { ZoomPanTransform } from './use-zoom-pan';
import { MAX_SCALE, panBy, ZOOM_PAN_IDENTITY, zoomTowards } from './use-zoom-pan';

const viewport = { width: 800, height: 600 };

describe('zoomTowards', () => {
  it('keeps the content point under the focus fixed on screen', () => {
    const focus = { x: 200, y: 150 };

    const zoomed = zoomTowards(ZOOM_PAN_IDENTITY, focus, 2, viewport);

    // The content point at screen (200, 150) before the zoom must project
    // back to the same screen position: t + scale · world = focus.
    expect(zoomed.scale).toBe(2);
    expect(zoomed.x + zoomed.scale * 200).toBeCloseTo(focus.x);
    expect(zoomed.y + zoomed.scale * 150).toBeCloseTo(focus.y);
  });

  it('clamps the scale to the maximum', () => {
    const zoomed = zoomTowards(ZOOM_PAN_IDENTITY, { x: 400, y: 300 }, 1000, viewport);

    expect(zoomed.scale).toBe(MAX_SCALE);
  });

  it('clamps zooming out below the fit scale to the identity', () => {
    const zoomed = zoomTowards(ZOOM_PAN_IDENTITY, { x: 400, y: 300 }, 0.5, viewport);

    expect(zoomed).toEqual(ZOOM_PAN_IDENTITY);
  });

  it('clamps the translation so the image keeps covering the viewport', () => {
    // Zooming towards the bottom-right corner pushes the translation to its
    // most negative bound — the content edge must not cross the viewport edge.
    const zoomed = zoomTowards(ZOOM_PAN_IDENTITY, { x: 800, y: 600 }, 2, viewport);

    expect(zoomed.x).toBe(-800);
    expect(zoomed.y).toBe(-600);
  });
});

describe('panBy', () => {
  const zoomedIn: ZoomPanTransform = { scale: 2, x: -400, y: -300 };

  it('moves the content by the drag delta', () => {
    const panned = panBy(zoomedIn, 50, -40, viewport);

    expect(panned).toEqual({ scale: 2, x: -350, y: -340 });
  });

  it('clamps the pan to the content bounds', () => {
    const panned = panBy(zoomedIn, 10_000, -10_000, viewport);

    expect(panned).toEqual({ scale: 2, x: 0, y: -600 });
  });

  it('is a no-op at the fit scale', () => {
    const panned = panBy(ZOOM_PAN_IDENTITY, 120, -80, viewport);

    expect(panned).toEqual(ZOOM_PAN_IDENTITY);
  });
});
