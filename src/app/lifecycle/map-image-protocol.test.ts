import { describe, expect, it, vi } from 'vitest';

import {
  createMapImageProtocolHandler,
  MAP_IMAGE_PROTOCOL_SCHEME,
  parseMapImageRequest,
} from './map-image-protocol';

describe('parseMapImageRequest (ids, not paths, in the URL)', () => {
  it('parses a well-formed image URL with the matching content type', () => {
    const cases = [
      ['tactics-map://de_dust2/profile-1.png', 'image/png'],
      ['tactics-map://de_dust2/0f8b3a52-9c1d-4e7a-b7c2-1a2b3c4d5e6f.jpg', 'image/jpeg'],
      ['tactics-map://de_nuke/profile-2.svg', 'image/svg+xml'],
    ] as const;
    for (const [url, contentType] of cases) {
      const request = parseMapImageRequest(url);
      expect(request).toBeDefined();
      expect(request?.contentType).toBe(contentType);
    }
    expect(parseMapImageRequest('tactics-map://de_dust2/profile-1.png')).toEqual({
      mapId: 'de_dust2',
      fileName: 'profile-1.png',
      contentType: 'image/png',
    });
  });

  it('rejects every other URL shape', () => {
    const hostile = [
      'not a url',
      'file:///etc/passwd',
      'https://de_dust2/profile-1.png',
      'tactics-map://de_dust2',
      'tactics-map://de_dust2/',
      'tactics-map:///profile-1.png',
      'tactics-map://de_dust2/a/profile-1.png',
      'tactics-map://de_dust2/%2e%2e%2fprofile-1.png',
      'tactics-map://../profile-1.png',
      'tactics-map://de_dust2/profile-1.exe',
      'tactics-map://de_dust2/profile-1.png?raw=1',
      'tactics-map://de_dust2/profile-1.png#x',
      'tactics-map://DE_DUST2/profile-1.png',
    ];
    for (const url of hostile) {
      expect(parseMapImageRequest(url)).toBeUndefined();
    }
  });

  it('normalizes dot segments away instead of letting them through', () => {
    // WHATWG URL parsing resolves `..` before we ever see the path — the
    // result must either normalize inside the map or be rejected, never
    // reach the resolver with dots intact.
    const parsed = parseMapImageRequest('tactics-map://de_dust2/sub/../profile-1.png');
    expect(parsed === undefined || parsed.fileName === 'profile-1.png').toBe(true);
  });
});

describe('createMapImageProtocolHandler', () => {
  const imageUrl = `${MAP_IMAGE_PROTOCOL_SCHEME}://de_dust2/profile-1.png`;

  function createHandler(overrides?: {
    resolveImagePath?: (mapId: string, fileName: string) => string | undefined;
    fetchFile?: (absolutePath: string) => Promise<Response>;
  }): ReturnType<typeof createMapImageProtocolHandler> {
    return createMapImageProtocolHandler({
      resolveImagePath: overrides?.resolveImagePath ?? (() => 'C:/images/de_dust2/profile-1.png'),
      fetchFile: overrides?.fetchFile ?? (() => Promise.resolve(new Response('binary'))),
    });
  }

  it('serves a resolvable image with the image content type', async () => {
    const fetchFile = vi.fn(() => Promise.resolve(new Response('png-bytes')));
    const resolveImagePath = vi.fn(() => 'C:/images/de_dust2/profile-1.png');
    const response = await createHandler({ resolveImagePath, fetchFile })(new Request(imageUrl));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    // A replaced image keeps its URL when the extension is unchanged (E22.3)
    // — the renderer must never see the cached old file.
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.text()).resolves.toBe('png-bytes');
    expect(resolveImagePath).toHaveBeenCalledWith('de_dust2', 'profile-1.png');
    expect(fetchFile).toHaveBeenCalledWith('C:/images/de_dust2/profile-1.png');
  });

  it('answers 404 when the resolver rejects the ids', async () => {
    const fetchFile = vi.fn();
    const handler = createHandler({ resolveImagePath: () => undefined, fetchFile });
    const response = await handler(new Request(imageUrl));
    expect(response.status).toBe(404);
    expect(fetchFile).not.toHaveBeenCalled();
  });

  it('answers 404 for malformed URLs without touching the resolver', async () => {
    const resolveImagePath = vi.fn();
    const handler = createHandler({ resolveImagePath });
    const response = await handler(new Request('tactics-map://de_dust2/extra/escape.png'));
    expect(response.status).toBe(404);
    expect(resolveImagePath).not.toHaveBeenCalled();
  });

  it('answers 404 when the file read fails or the file is missing', async () => {
    const failing = createHandler({ fetchFile: () => Promise.reject(new Error('EACCES')) });
    expect((await failing(new Request(imageUrl))).status).toBe(404);

    const notFound = createHandler({
      fetchFile: () => Promise.resolve(new Response(null, { status: 404 })),
    });
    expect((await notFound(new Request(imageUrl))).status).toBe(404);
  });

  it('answers 405 for non-GET methods', async () => {
    const response = await createHandler()(new Request(imageUrl, { method: 'POST' }));
    expect(response.status).toBe(405);
  });
});
