import { getCaseInsensitive, parseKeyValues } from './keyvalues';

/**
 * Extracts the library root paths from `libraryfolders.vdf` (GSI-01,
 * detection chain step "all libraries"). Tolerates both layouts Steam has
 * shipped: the current one (numeric key → block with a `path` value) and
 * the legacy pre-2021 one (numeric key → path string; note the legacy file
 * lists only *additional* libraries — the Steam install dir itself comes
 * from the registry step, E9.2). Entries without a usable path are skipped
 * rather than failing the file: a partial parse that still finds CS2 beats
 * an error (risk T4 tolerance).
 */

export type LibraryFoldersErrorCode = 'NOT_KEYVALUES' | 'INVALID_SHAPE';

export interface LibraryFoldersError {
  readonly code: LibraryFoldersErrorCode;
  /** Line numbers and fixed phrases only — never file content (ADR-030). */
  readonly issues: readonly string[];
}

export type LibraryFoldersParseResult =
  | { readonly ok: true; readonly libraryPaths: readonly string[] }
  | { readonly ok: false; readonly error: LibraryFoldersError };

const NUMERIC_KEY = /^\d+$/;

/** Parses `libraryfolders.vdf` content into the list of library root paths. */
export function parseLibraryFolders(content: string): LibraryFoldersParseResult {
  const parsed = parseKeyValues(content);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const rootBlock = getCaseInsensitive(parsed.root, 'libraryfolders');
  if (rootBlock === undefined) {
    return invalidShape('libraryfolders: expected root block');
  }
  if (typeof rootBlock === 'string') {
    return invalidShape('libraryfolders: expected block, found string value');
  }

  const libraryPaths: string[] = [];
  for (const [key, entry] of rootBlock) {
    if (!NUMERIC_KEY.test(key)) {
      continue; // legacy metadata siblings such as ContentStatsID
    }
    if (typeof entry === 'string') {
      if (entry.length > 0) {
        libraryPaths.push(entry); // legacy layout: the value is the path
      }
      continue;
    }
    const path = getCaseInsensitive(entry, 'path');
    if (typeof path === 'string' && path.length > 0) {
      libraryPaths.push(path);
    }
  }
  return { ok: true, libraryPaths };
}

function invalidShape(issue: string): { ok: false; error: LibraryFoldersError } {
  return { ok: false, error: { code: 'INVALID_SHAPE', issues: [issue] } };
}
