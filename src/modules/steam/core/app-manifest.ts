import { getCaseInsensitive, parseKeyValues } from './keyvalues';

/**
 * Extracts the install directory name from `appmanifest_730.acf` (GSI-01,
 * detection chain step "manifest hit"). Only `installdir` is needed — the
 * file name already pins app 730, and the game root derivation
 * (`cs2-paths.ts`) consumes the raw directory name.
 */

export type AppManifestErrorCode = 'NOT_KEYVALUES' | 'INVALID_SHAPE';

export interface AppManifestError {
  readonly code: AppManifestErrorCode;
  /** Line numbers and fixed phrases only — never file content (ADR-030). */
  readonly issues: readonly string[];
}

export type AppManifestParseResult =
  | { readonly ok: true; readonly installDir: string }
  | { readonly ok: false; readonly error: AppManifestError };

/** Parses `appmanifest_*.acf` content into the app's install directory name. */
export function parseAppManifest(content: string): AppManifestParseResult {
  const parsed = parseKeyValues(content);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const appState = getCaseInsensitive(parsed.root, 'appstate');
  if (appState === undefined) {
    return invalidShape('AppState: expected root block');
  }
  if (typeof appState === 'string') {
    return invalidShape('AppState: expected block, found string value');
  }

  const installDir = getCaseInsensitive(appState, 'installdir');
  if (typeof installDir !== 'string' || installDir.length === 0) {
    return invalidShape('AppState.installdir: expected non-empty string');
  }
  return { ok: true, installDir };
}

function invalidShape(issue: string): { ok: false; error: AppManifestError } {
  return { ok: false, error: { code: 'INVALID_SHAPE', issues: [issue] } };
}
