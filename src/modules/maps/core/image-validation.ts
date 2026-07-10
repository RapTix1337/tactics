import { parseXml, XmlElement } from '@rgrove/parse-xml';

/**
 * Pure validation logic for uploaded profile images (ADR-045, MAP-07, E22.2):
 * magic-byte type sniffing for the binary formats and the lightweight SVG
 * security scan — shrunk from the retired ADR-043 load-path allowlist
 * (`checkSvgPolicy`, E11.4) to the three upload rules: no DOCTYPE/ENTITY, no
 * `<script>` elements, no `on*` event-handler attributes. The scan is defense
 * in depth only: uploaded images render exclusively via `<img>` (never
 * inlined into the DOM), so SVG scripts are inert by construction.
 *
 * Reading files, decoding bytes to text, and the size cap check are the
 * adapter's job (`adapters/profile-image-store.ts`) — this module stays free
 * of I/O.
 */

/** Upload size cap (maintainer decision, Session 46): 50 MB. */
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;

/**
 * Sniffs the binary image formats by their magic bytes — the file extension
 * is never trusted (MAP-07). SVG has no magic bytes; it is detected by the
 * XML parse in `checkSvgUpload`.
 */
export function sniffBinaryImageType(bytes: Uint8Array): 'png' | 'jpg' | undefined {
  if (matchesSignature(bytes, PNG_SIGNATURE)) {
    return 'png';
  }
  if (matchesSignature(bytes, JPEG_SIGNATURE)) {
    return 'jpg';
  }
  return undefined;
}

function matchesSignature(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => bytes[index] === byte);
}

export type SvgUploadCheckResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** `NOT_SVG`: not well-formed XML with an `<svg>` root at all. */
      readonly code: 'NOT_SVG' | 'REJECTED';
      readonly issues: readonly string[];
    };

/**
 * The upload security scan for SVG text. `NOT_SVG` means the content is no
 * SVG document to begin with (the caller reports an unsupported type);
 * `REJECTED` means it is an SVG that violates the security rules. All
 * violations are reported at once (the E11.4 convention).
 */
export function checkSvgUpload(text: string): SvgUploadCheckResult {
  // A UTF-8 BOM survives decoding as U+FEFF and would trip the XML parser.
  const content = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  // Raw-string check, and before the parse, on purpose: the parser silently
  // discards doctypes (the E11.4 finding) and throws on the custom entity
  // references a doctype would declare — either way the parsed tree cannot
  // reveal them. May flag look-alikes inside CDATA — acceptable for a
  // reject-not-clean boundary check.
  const declarationIssues = checkRawDeclarations(content);
  if (declarationIssues.length > 0) {
    return { ok: false, code: 'REJECTED', issues: declarationIssues };
  }

  let root: XmlElement | null;
  try {
    root = parseXml(content).root;
  } catch {
    return { ok: false, code: 'NOT_SVG', issues: ['content is not well-formed XML'] };
  }
  if (root === null || localName(root.name) !== 'svg') {
    return { ok: false, code: 'NOT_SVG', issues: ['root element is not <svg>'] };
  }

  const issues = checkElementTree(root);
  return issues.length === 0 ? { ok: true } : { ok: false, code: 'REJECTED', issues };
}

function checkRawDeclarations(content: string): string[] {
  const issues: string[] = [];
  if (/<!DOCTYPE/i.test(content)) {
    issues.push('document type definition (<!DOCTYPE) is not allowed');
  }
  if (/<!ENTITY/i.test(content)) {
    issues.push('entity declaration (<!ENTITY) is not allowed');
  }
  return issues;
}

/**
 * Iterative walk (the E11.4 convention: hostile nesting depth must not
 * overflow the call stack) rejecting `<script>` elements and `on*`
 * event-handler attributes, namespace prefixes ignored.
 */
function checkElementTree(root: XmlElement): string[] {
  const issues: string[] = [];
  const queue: XmlElement[] = [root];
  for (let element = queue.pop(); element !== undefined; element = queue.pop()) {
    if (localName(element.name).toLowerCase() === 'script') {
      issues.push(`<${element.name}> element is not allowed`);
    }
    for (const attributeName of Object.keys(element.attributes)) {
      if (localName(attributeName).toLowerCase().startsWith('on')) {
        issues.push(`event handler attribute "${attributeName}" is not allowed`);
      }
    }
    for (const child of element.children) {
      if (child instanceof XmlElement) {
        queue.push(child);
      }
    }
  }
  return issues;
}

/** `svg:script` → `script`; XML names contain at most one meaningful colon. */
function localName(name: string): string {
  const colonIndex = name.indexOf(':');
  return colonIndex === -1 ? name : name.slice(colonIndex + 1);
}
