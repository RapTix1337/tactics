import { stat } from 'node:fs/promises';

import type { DirectoryProbe } from '../core/validate-cs2-path';

/**
 * The fs-backed `DirectoryProbe` (E9.3). Platform-neutral — a directory
 * check is the same on every OS, so it lives directly under `adapters/`
 * (unlike the registry reader, which is `windows/`).
 */
export function createFsDirectoryProbe(): DirectoryProbe {
  return {
    isDirectory: async (path: string): Promise<boolean> => {
      try {
        return (await stat(path)).isDirectory();
      } catch {
        return false; // missing, unreadable, or a dangling link — all "no"
      }
    },
  };
}
