// The read-only custom protocol serving uploaded profile images to the
// renderer (ADR-045, E22.2): `tactics-map://<mapId>/<profileId>.<ext>` — ids,
// not paths, so traversal is impossible by construction. This file holds the
// scheme constant and the pure, testable request handling; the Electron
// wiring (`protocol.registerSchemesAsPrivileged` before ready,
// `protocol.handle` + `net.fetch` after) lives in app-lifecycle.ts, matching
// the security-policy.ts split (ADR-039).

/** Scheme name (maintainer decision, Session 46). Listed in the CSP `img-src`. */
export const MAP_IMAGE_PROTOCOL_SCHEME = 'tactics-map';

/** Lowercase engine-style map id (map-schema convention). */
const MAP_ID_PATTERN = /^[a-z0-9_]+$/;

/** Exactly one path segment: `<profileId>.<ext>` (E22.1 naming). */
const FILE_NAME_PATTERN = /^\/([a-z0-9-]+\.(png|jpg|svg))$/;

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  svg: 'image/svg+xml',
};

export interface MapImageRequest {
  readonly mapId: string;
  readonly fileName: string;
  readonly contentType: string;
}

/**
 * Parses a protocol URL into a map-image request. Anything that is not
 * exactly `tactics-map://<mapId>/<fileName>` — wrong scheme, missing or
 * hostile segments, queries, fragments — is `undefined` and served as 404.
 */
export function parseMapImageRequest(rawUrl: string): MapImageRequest | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== `${MAP_IMAGE_PROTOCOL_SCHEME}:` || url.search !== '' || url.hash !== '') {
    return undefined;
  }
  if (!MAP_ID_PATTERN.test(url.host)) {
    return undefined;
  }
  const fileNameMatch = FILE_NAME_PATTERN.exec(url.pathname);
  if (fileNameMatch === null) {
    return undefined;
  }
  const [, fileName, extension] = fileNameMatch;
  // The pattern guarantees both groups; the map covers every extension it
  // can produce — the fallback only guards a future pattern/map mismatch.
  const contentType = CONTENT_TYPE_BY_EXTENSION[extension ?? ''];
  if (fileName === undefined || contentType === undefined) {
    return undefined;
  }
  return { mapId: url.host, fileName, contentType };
}

export interface MapImageProtocolDeps {
  /** The image store's traversal-guarded resolver (profile-image-store.ts). */
  readonly resolveImagePath: (mapId: string, fileName: string) => string | undefined;
  /** `net.fetch` over a `file://` URL in production; injected for tests. */
  readonly fetchFile: (absolutePath: string) => Promise<Response>;
}

/**
 * Builds the `protocol.handle` handler: GET only, parse → resolve → serve
 * with the correct image content type; every failure mode is a plain 404
 * (no detail leaks about the local file system).
 */
export function createMapImageProtocolHandler(
  deps: MapImageProtocolDeps,
): (request: Request) => Promise<Response> {
  return async (request): Promise<Response> => {
    if (request.method !== 'GET') {
      return new Response(null, { status: 405 });
    }
    const imageRequest = parseMapImageRequest(request.url);
    if (imageRequest === undefined) {
      return new Response(null, { status: 404 });
    }
    const path = deps.resolveImagePath(imageRequest.mapId, imageRequest.fileName);
    if (path === undefined) {
      return new Response(null, { status: 404 });
    }
    let file: Response;
    try {
      file = await deps.fetchFile(path);
    } catch {
      return new Response(null, { status: 404 });
    }
    if (!file.ok) {
      return new Response(null, { status: 404 });
    }
    return new Response(file.body, {
      status: 200,
      headers: {
        'Content-Type': imageRequest.contentType,
        // A replaced image keeps its URL when the extension is unchanged —
        // without this, Chromium would keep rendering the cached old file.
        'Cache-Control': 'no-store',
      },
    });
  };
}
