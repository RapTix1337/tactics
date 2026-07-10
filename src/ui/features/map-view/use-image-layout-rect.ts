import type { RefObject } from 'react';
import { useEffect, useState } from 'react';

import type { ImageLayoutRect } from './callout-editing';

/**
 * Tracks the map image's layout box (E14.4): the image sizes itself
 * (`max-h/max-w` constraints preserve the aspect ratio, so its element box
 * equals the displayed image) and the callout overlay cannot follow it with
 * CSS alone. Re-measures when the image loads and whenever layout resizes it
 * (window or sidebar resize); zoom/pan only changes the transform, not the
 * layout. Lives in `MapCanvas` since E22.6 — the callout layer positions by
 * the rect and the editor inverts through it. Returns `undefined` while the
 * image is unmeasured or has a zero-size box.
 */
export function useImageLayoutRect(
  imageRef: RefObject<HTMLImageElement | null>,
): ImageLayoutRect | undefined {
  const [rect, setRect] = useState<ImageLayoutRect | undefined>(undefined);

  useEffect(() => {
    const image = imageRef.current;
    if (image === null) {
      return undefined;
    }
    const measure = (): void => {
      setRect(
        image.offsetWidth === 0 || image.offsetHeight === 0
          ? undefined
          : {
              left: image.offsetLeft,
              top: image.offsetTop,
              width: image.offsetWidth,
              height: image.offsetHeight,
            },
      );
    };
    // The load listener measures a fresh (or replaced) image immediately;
    // the observer keeps the rect current across layout resizes and covers
    // an image that was already loaded when this effect ran.
    image.addEventListener('load', measure);
    const observer = new ResizeObserver(measure);
    observer.observe(image);
    // A height-constrained image re-centers without resizing when the
    // window or sidebar changes width — only its offset parent (the
    // transform wrapper the offsets are measured against) resizes then.
    if (image.offsetParent !== null) {
      observer.observe(image.offsetParent);
    }
    return (): void => {
      image.removeEventListener('load', measure);
      observer.disconnect();
    };
  }, [imageRef]);

  return rect;
}
