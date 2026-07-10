import { act, fireEvent, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { useCallback, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useImageLayoutRect } from './use-image-layout-rect';

/** Renders the hook against the image it measures, like `MapCanvas` does. */
function Harness(): JSX.Element {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const rect = useImageLayoutRect(imageRef);
  // jsdom has no layout, so `offsetParent` is always null there — mirror the
  // browser (the wrapper is the positioned ancestor) before the effect runs.
  const attachImage = useCallback((element: HTMLImageElement | null): void => {
    if (element !== null) {
      Object.defineProperty(element, 'offsetParent', {
        value: element.parentElement,
        configurable: true,
      });
    }
    imageRef.current = element;
  }, []);
  return (
    <div>
      <img ref={attachImage} data-testid="image" src="tactics-map://de_dust2/p.png" alt="" />
      <output data-testid="rect">
        {rect === undefined
          ? 'unmeasured'
          : `${rect.left},${rect.top},${rect.width}x${rect.height}`}
      </output>
    </div>
  );
}

interface LayoutRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** jsdom has no layout — stub the image's offset box before firing `load`. */
function stubImageLayout(image: HTMLElement, rect: LayoutRect): void {
  Object.defineProperties(image, {
    offsetLeft: { value: rect.left, configurable: true },
    offsetTop: { value: rect.top, configurable: true },
    offsetWidth: { value: rect.width, configurable: true },
    offsetHeight: { value: rect.height, configurable: true },
  });
}

describe('useImageLayoutRect', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays unmeasured while the image has no size', () => {
    render(<Harness />);

    // A load event on a zero-sized image (jsdom default) measures nothing.
    fireEvent.load(screen.getByTestId('image'));

    expect(screen.getByTestId('rect')).toHaveTextContent('unmeasured');
  });

  it('measures the offset box when the image loads', () => {
    render(<Harness />);
    const image = screen.getByTestId('image');
    stubImageLayout(image, { left: 16, top: 24, width: 800, height: 600 });

    fireEvent.load(image);

    expect(screen.getByTestId('rect')).toHaveTextContent('16,24,800x600');
  });

  it('re-measures when the offset parent resizes without the image resizing', () => {
    // Recording stub: like the real observer, the callback only fires for
    // targets that were actually observed.
    const observed: Element[] = [];
    let notify: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe(target: Element): void {
          observed.push(target);
        }
        unobserve(): void {}
        disconnect(): void {}
      },
    );

    render(<Harness />);
    const image = screen.getByTestId('image');
    stubImageLayout(image, { left: 16, top: 24, width: 800, height: 600 });
    fireEvent.load(image);
    expect(screen.getByTestId('rect')).toHaveTextContent('16,24,800x600');

    // A window-width change re-centers a height-constrained image: only its
    // offset moves, its size (and thus its own observation) never fires.
    stubImageLayout(image, { left: 216, top: 24, width: 800, height: 600 });
    const parent = image.parentElement;
    if (parent !== null && observed.includes(parent) && notify !== undefined) {
      const fire = notify;
      act(() => {
        fire();
      });
    }

    expect(screen.getByTestId('rect')).toHaveTextContent('216,24,800x600');
  });

  it('re-measures when the image loads a new file', () => {
    render(<Harness />);
    const image = screen.getByTestId('image');
    stubImageLayout(image, { left: 16, top: 24, width: 800, height: 600 });
    fireEvent.load(image);

    stubImageLayout(image, { left: 0, top: 40, width: 400, height: 520 });
    fireEvent.load(image);

    expect(screen.getByTestId('rect')).toHaveTextContent('0,40,400x520');
  });
});
