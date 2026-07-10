// Content-Security-Policy and navigation policy for all app windows
// (ADR-025). Pure values and predicates only — the Electron wiring lives in
// app-lifecycle.ts, the build-time meta-tag injection in
// electron.vite.config.ts.

import { MAP_IMAGE_PROTOCOL_SCHEME } from './map-image-protocol';

// `img-src` additionally allows the read-only map-image protocol (ADR-045,
// E22.2) — the one sanctioned way uploaded images reach the renderer.
const IMG_SRC = `img-src 'self' data: ${MAP_IMAGE_PROTOCOL_SCHEME}:`;

/**
 * Production CSP. Injected as a `<meta http-equiv>` tag into the built
 * renderer HTML at build time: packaged windows load via `file://`, which
 * carries no HTTP response headers, so `webRequest.onHeadersReceived`
 * cannot enforce a policy there (Electron security tutorial).
 *
 * The renderer loads only bundled local code (ADR-025): everything not
 * explicitly listed is denied via `default-src 'none'`.
 */
export const PROD_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  IMG_SRC,
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Development CSP. Applied as a response header on Vite dev-server
 * responses (HTTP, so the header mechanism works). Dev-only relaxations,
 * deliberately absent from production:
 *
 * - `script-src 'unsafe-inline'` — Vite injects inline bootstrap scripts
 *   (e.g., the React refresh preamble once E3.2 lands).
 * - `style-src 'unsafe-inline'` — Vite injects `<style>` tags during HMR.
 * - `connect-src` websocket entries — the Vite HMR websocket.
 */
export const DEV_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  IMG_SRC,
  "font-src 'self'",
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Navigation policy (ADR-025: navigation is blocked). The single allowed
 * case is same-origin navigation on the Vite dev server (its HMR
 * full-reload path); without a dev server every navigation is denied.
 */
export function shouldAllowNavigation(
  targetUrl: string,
  devServerOrigin: string | undefined,
): boolean {
  if (devServerOrigin === undefined) {
    return false;
  }
  try {
    return new URL(targetUrl).origin === devServerOrigin;
  } catch {
    return false;
  }
}
