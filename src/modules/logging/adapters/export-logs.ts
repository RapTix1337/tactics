import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { archiveFileName, MAX_ARCHIVE_COUNT } from './archive-rotation';
import { getLogDirectory, LOG_FILE_NAME } from './electron-log-logging';

/**
 * Writes the log export for `logs.export` (E6.3, PRV-04): archived logs
 * (oldest first) followed by the live log, concatenated into one plain-text
 * file with a header line per source file — directly attachable to a GitHub
 * issue. Log files that don't exist (yet) are skipped. The target is the
 * user-chosen save-dialog path — one of the two consent-gated exceptions to
 * the user-data write rule (ADR-025).
 */
export async function exportLogs(targetPath: string): Promise<void> {
  const directory = getLogDirectory();
  const sections: string[] = [];
  for (const fileName of exportSourceFileNames()) {
    const content = await readLogFile(join(directory, fileName));
    if (content !== undefined) {
      sections.push(`===== ${fileName} =====\n${withTrailingNewline(content)}`);
    }
  }
  await writeFile(targetPath, sections.join('\n'), 'utf8');
}

/** Oldest archive first, the live log last — the export reads chronologically. */
function exportSourceFileNames(): string[] {
  const names: string[] = [];
  for (let index = MAX_ARCHIVE_COUNT; index >= 1; index -= 1) {
    names.push(archiveFileName(LOG_FILE_NAME, index));
  }
  names.push(LOG_FILE_NAME);
  return names;
}

async function readLogFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function withTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}
