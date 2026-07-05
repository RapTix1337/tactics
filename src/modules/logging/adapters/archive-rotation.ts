import { existsSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

/** ADR-030: at most five archive files next to the live log. */
export const MAX_ARCHIVE_COUNT = 5;

/** `<stem>.old.<index><ext>` — the archive names `archiveLogFile` maintains. */
export function archiveFileName(logFileName: string, index: number): string {
  const extension = extname(logFileName);
  return `${basename(logFileName, extension)}.old.${String(index)}${extension}`;
}

/**
 * Rotation callback for electron-log's file transport, which by default
 * keeps exactly one archive. Called synchronously when the live file
 * exceeds `maxSize`: shifts `<stem>.old.N<ext>` up by one (dropping the
 * oldest) and moves the live file to `<stem>.old.1<ext>`.
 */
export function archiveLogFile(logFilePath: string): void {
  const directory = dirname(logFilePath);
  const archivePath = (index: number): string =>
    join(directory, archiveFileName(basename(logFilePath), index));

  try {
    rmSync(archivePath(MAX_ARCHIVE_COUNT), { force: true });
    for (let index = MAX_ARCHIVE_COUNT - 1; index >= 1; index -= 1) {
      if (existsSync(archivePath(index))) {
        renameSync(archivePath(index), archivePath(index + 1));
      }
    }
    renameSync(logFilePath, archivePath(1));
  } catch {
    // Rotation must never break logging: if a rename is blocked, discard
    // the live file instead of letting it grow without bound.
    rmSync(logFilePath, { force: true });
  }
}
