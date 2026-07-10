import { describe, expect, it } from 'vitest';

import { checkSvgUpload, MAX_IMAGE_BYTES, sniffBinaryImageType } from './image-validation';

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('sniffBinaryImageType (MAP-07: extension is never trusted)', () => {
  it('recognizes the PNG signature', () => {
    expect(sniffBinaryImageType(PNG_BYTES)).toBe('png');
  });

  it('recognizes the JPEG signature', () => {
    expect(sniffBinaryImageType(JPEG_BYTES)).toBe('jpg');
  });

  it('rejects truncated signatures', () => {
    expect(sniffBinaryImageType(PNG_BYTES.slice(0, 4))).toBeUndefined();
    expect(sniffBinaryImageType(JPEG_BYTES.slice(0, 2))).toBeUndefined();
  });

  it('rejects empty and non-image content', () => {
    expect(sniffBinaryImageType(Uint8Array.of())).toBeUndefined();
    expect(sniffBinaryImageType(new TextEncoder().encode('GIF89a...'))).toBeUndefined();
    expect(sniffBinaryImageType(new TextEncoder().encode('<svg/>'))).toBeUndefined();
  });
});

describe('checkSvgUpload (ADR-045: the shrunk upload security scan)', () => {
  it('accepts a minimal clean SVG', () => {
    expect(
      checkSvgUpload('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1"/></svg>'),
    ).toEqual({ ok: true });
  });

  it('accepts an XML declaration and a leading BOM', () => {
    const svg = '<?xml version="1.0" encoding="UTF-8"?><svg><circle r="1"/></svg>';
    expect(checkSvgUpload(svg)).toEqual({ ok: true });
    expect(checkSvgUpload(String.fromCharCode(0xfeff) + svg)).toEqual({ ok: true });
  });

  it('reports non-XML content as NOT_SVG', () => {
    const result = checkSvgUpload('this is not markup');
    expect(result).toMatchObject({ ok: false, code: 'NOT_SVG' });
  });

  it('reports well-formed XML without an <svg> root as NOT_SVG', () => {
    const result = checkSvgUpload('<html><body/></html>');
    expect(result).toMatchObject({ ok: false, code: 'NOT_SVG' });
  });

  it('rejects a DOCTYPE even though the parser silently discards it', () => {
    const result = checkSvgUpload('<!DOCTYPE svg><svg><rect/></svg>');
    expect(result).toMatchObject({ ok: false, code: 'REJECTED' });
    expect(result.ok === false && result.issues.join(' ')).toContain('<!DOCTYPE');
  });

  it('rejects entity declarations (XXE vector)', () => {
    const hostile = '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>';
    const result = checkSvgUpload(hostile);
    expect(result).toMatchObject({ ok: false, code: 'REJECTED' });
    expect(result.ok === false && result.issues.join(' ')).toContain('<!ENTITY');
  });

  it('rejects <script> elements, including namespaced and nested ones', () => {
    for (const hostile of [
      '<svg><script>alert(1)</script></svg>',
      '<svg><svg:script xmlns:svg="http://www.w3.org/2000/svg"/></svg>',
      '<svg><g><g><SCRIPT/></g></g></svg>',
    ]) {
      expect(checkSvgUpload(hostile)).toMatchObject({ ok: false, code: 'REJECTED' });
    }
  });

  it('rejects on* event-handler attributes anywhere in the tree', () => {
    for (const hostile of [
      '<svg onload="alert(1)"><rect/></svg>',
      '<svg><rect onclick="alert(1)"/></svg>',
      '<svg><g><circle OnMouseOver="x"/></g></svg>',
    ]) {
      expect(checkSvgUpload(hostile)).toMatchObject({ ok: false, code: 'REJECTED' });
    }
  });

  it('keeps attributes that merely contain "on" untouched', () => {
    const result = checkSvgUpload(
      '<svg><text font-family="mono" stroke-linejoin="round">Long</text></svg>',
    );
    expect(result).toEqual({ ok: true });
  });

  it('reports every violation at once (one fix pass per upload)', () => {
    const result = checkSvgUpload('<svg onload="x"><script/><rect onclick="y"/></svg>');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues).toHaveLength(3);
  });

  it('rejects hostile nesting depth without crashing', () => {
    // The walk is iterative; a parser stack overflow is caught and reported
    // as a regular rejection — hostile depth must never crash the process.
    const depth = 20_000;
    const nested = `<svg>${'<g>'.repeat(depth)}<script/>${'</g>'.repeat(depth)}</svg>`;
    expect(checkSvgUpload(nested)).toMatchObject({ ok: false });
  });
});

describe('MAX_IMAGE_BYTES', () => {
  it('is the decided 50 MB upload cap', () => {
    expect(MAX_IMAGE_BYTES).toBe(50 * 1024 * 1024);
  });
});
