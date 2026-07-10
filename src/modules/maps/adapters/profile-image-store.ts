import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import type { Logger } from '../../../shared';
import { checkSvgUpload, MAX_IMAGE_BYTES, sniffBinaryImageType } from '../core/image-validation';
import type { ProfileImageExtension } from '../core/profile-model';

/**
 * The file side of map profiles (ADR-045, MAP-07, E22.2): profile images live
 * in the app-managed image directory under userData —
 * `maps/<mapId>/<profileId>.<ext>` — written exclusively through this store
 * (ADR-025: file writes stay inside the user data directory). Reads for the
 * renderer go through the read-only `tactics-map:` protocol, which resolves
 * paths via `resolveImagePath` only.
 *
 * Like the profile repository (E22.1), unknown files are regular results
 * (`false`/`undefined`), invalid identifiers from our own code are bugs and
 * throw `TypeError`; the named IPC errors are E22.3's job.
 */

/** Lowercase engine-style map id, e.g. `de_dust2` (map-schema convention). */
const MAP_ID_PATTERN = /^[a-z0-9_]+$/;

/** `<profileId>.<ext>` as produced by `profileImageFileName` (E22.1). */
const IMAGE_FILE_NAME_PATTERN = /^[a-z0-9-]+\.(?:png|jpg|svg)$/;

export type LoadImageErrorCode = 'UNREADABLE' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'SVG_REJECTED';

export interface LoadImageError {
  readonly code: LoadImageErrorCode;
  readonly issues: readonly string[];
}

/**
 * A source file that passed the boundary validation. Only values of this
 * shape can be handed to `saveImage` — the type is the seam that keeps
 * unvalidated bytes out of the image directory.
 */
export interface ValidatedImage {
  readonly extension: ProfileImageExtension;
  readonly bytes: Uint8Array;
}

export type LoadImageResult =
  | { readonly ok: true; readonly image: ValidatedImage }
  | { readonly ok: false; readonly error: LoadImageError };

export interface ProfileImageStore {
  /**
   * Reads and validates a user-picked source file (MAP-07): size cap before
   * reading, magic-byte type sniff (extension not trusted), SVG security
   * scan. Never throws — every rejection is a named result.
   */
  loadImage(sourcePath: string): Promise<LoadImageResult>;
  /** Writes a validated image to `maps/<mapId>/<fileName>`, replacing any existing file. */
  saveImage(mapId: string, fileName: string, image: ValidatedImage): Promise<void>;
  /** File copy for profile forks (E22.1); `false` = source file missing. */
  copyImage(mapId: string, sourceFileName: string, targetFileName: string): Promise<boolean>;
  /**
   * Best-effort deletion alongside profile removal: a missing file is fine,
   * a failing delete is logged and swallowed (an orphaned image is harmless;
   * the profile row is already gone).
   */
  deleteImage(mapId: string, fileName: string): Promise<void>;
  /**
   * Resolves an image path for the read-only protocol. Identifiers that are
   * not shaped like ours or escape the image directory yield `undefined` —
   * requests carry ids, not paths, so traversal is impossible by
   * construction.
   */
  resolveImagePath(mapId: string, fileName: string): string | undefined;
}

export interface ProfileImageStoreOptions {
  /** Absolute path to the image root, `<userData>/maps` in production. */
  readonly imagesDirectory: string;
  readonly logger: Logger;
  /** Overridable for tests (the ProfileRepositoryOptions precedent). */
  readonly maxImageBytes?: number;
}

export function createProfileImageStore(options: ProfileImageStoreOptions): ProfileImageStore {
  const imagesRoot = resolve(options.imagesDirectory);
  const maxImageBytes = options.maxImageBytes ?? MAX_IMAGE_BYTES;
  const logger = options.logger;

  const resolveSafePath = (mapId: string, fileName: string): string | undefined => {
    if (!MAP_ID_PATTERN.test(mapId) || !IMAGE_FILE_NAME_PATTERN.test(fileName)) {
      return undefined;
    }
    const path = resolve(imagesRoot, mapId, fileName);
    // Belt and suspenders: the patterns above already exclude every path
    // construct, so this can only fire on a future pattern regression.
    return path.startsWith(imagesRoot + sep) ? path : undefined;
  };

  // Invalid identifiers here come from our own persistence layer, never from
  // user input — a violation is a bug, reported like the repository does.
  const requireSafePath = (mapId: string, fileName: string): string => {
    const path = resolveSafePath(mapId, fileName);
    if (path === undefined) {
      throw new TypeError(`invalid image location: "${mapId}/${fileName}"`);
    }
    return path;
  };

  return {
    async loadImage(sourcePath): Promise<LoadImageResult> {
      let size: number;
      try {
        const sourceStat = await stat(sourcePath);
        if (!sourceStat.isFile()) {
          return loadError('UNREADABLE', 'source is not a regular file');
        }
        size = sourceStat.size;
      } catch {
        return loadError('UNREADABLE', 'source file is missing or unreadable');
      }
      // Checked before reading so an oversized pick never loads into memory.
      if (size > maxImageBytes) {
        return loadError('TOO_LARGE', `file exceeds the ${String(maxImageBytes)} byte limit`);
      }

      let bytes: Buffer;
      try {
        bytes = await readFile(sourcePath);
      } catch {
        return loadError('UNREADABLE', 'source file is missing or unreadable');
      }
      // Re-checked on the actual bytes: the file may have grown between the
      // stat above and the read.
      if (bytes.length > maxImageBytes) {
        return loadError('TOO_LARGE', `file exceeds the ${String(maxImageBytes)} byte limit`);
      }

      const binaryType = sniffBinaryImageType(bytes);
      if (binaryType !== undefined) {
        return { ok: true, image: { extension: binaryType, bytes } };
      }
      const svgCheck = checkSvgUpload(bytes.toString('utf8'));
      if (svgCheck.ok) {
        return { ok: true, image: { extension: 'svg', bytes } };
      }
      if (svgCheck.code === 'NOT_SVG') {
        return loadError('UNSUPPORTED_TYPE', 'file is neither a PNG, JPG, nor SVG image');
      }
      return { ok: false, error: { code: 'SVG_REJECTED', issues: svgCheck.issues } };
    },

    async saveImage(mapId, fileName, image): Promise<void> {
      const path = requireSafePath(mapId, fileName);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, image.bytes);
    },

    async copyImage(mapId, sourceFileName, targetFileName): Promise<boolean> {
      const sourcePath = requireSafePath(mapId, sourceFileName);
      const targetPath = requireSafePath(mapId, targetFileName);
      await mkdir(dirname(targetPath), { recursive: true });
      try {
        await copyFile(sourcePath, targetPath);
      } catch (error) {
        if (isMissingFileError(error)) {
          return false;
        }
        throw error;
      }
      return true;
    },

    async deleteImage(mapId, fileName): Promise<void> {
      const path = requireSafePath(mapId, fileName);
      try {
        // `force` makes a missing file a no-op — deletion is idempotent.
        await rm(path, { force: true });
      } catch {
        logger.warn('profile image could not be deleted', { mapId, fileName });
      }
    },

    resolveImagePath(mapId, fileName): string | undefined {
      return resolveSafePath(mapId, fileName);
    },
  };
}

function loadError(code: LoadImageErrorCode, issue: string): LoadImageResult {
  return { ok: false, error: { code, issues: [issue] } };
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
