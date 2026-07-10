// Vitest setup for the ui project (wired in vitest.config.ts): registers
// the jest-dom matchers (toBeInTheDocument, …) on Vitest's expect.
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// RTL only auto-cleans when test globals exist; this project uses explicit
// vitest imports (E1.4), so unmount rendered trees between tests here.
afterEach(cleanup);

// jsdom does not implement scrollTo (the router resets scroll on
// navigation, E13.3); a no-op keeps the test output free of jsdom's
// "Not implemented" noise.
window.scrollTo = () => undefined;

// jsdom does not implement pointer capture (used by the map canvas drag
// pan, E14.2); no-ops keep pointer-event tests working.
Element.prototype.setPointerCapture = () => undefined;
Element.prototype.releasePointerCapture = () => undefined;

// jsdom implements neither the pointer-capture query nor scrollIntoView,
// both used by the Radix Select (the profile switcher, E22.5).
Element.prototype.hasPointerCapture = () => false;
Element.prototype.scrollIntoView = () => undefined;

// jsdom does not implement ResizeObserver (the callout layer tracks the map
// image's layout box, E14.4); observations never fire under jsdom's zero
// layout — tests drive measurements through the image load event instead.
window.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

// jsdom does not implement matchMedia (needed by useIsMobile, E13.2); this
// is the standard non-matching stub — media queries never match in tests.
window.matchMedia = (query: string): MediaQueryList => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
});
