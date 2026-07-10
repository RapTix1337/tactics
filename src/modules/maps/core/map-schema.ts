import { z } from 'zod';

/**
 * Schema for `data/maps/<mapId>/map.json` — the ADR-045 data model (E12.2):
 * the app ships facts only. Each file holds one **catalog entry** (`id`,
 * `displayName`, `gsiNames`) plus the map's **default callout layout**
 * (`callouts` — curated names with approximate normalized positions users
 * start from). No imagery, no levels, no bomb-site/spawn markers: users
 * provide their own map image, which carries those visually. Field-by-field
 * documentation and the authoring conventions live in `data/maps/README.md`
 * (MAP-02). The fs loader parses every map.json through `parseMapJson`; an
 * invalid map is logged and skipped, never fatal.
 *
 * All objects are strict: unknown keys are rejected so typos in community
 * data PRs fail the schema gate instead of being silently ignored.
 */

/** Lowercase engine-style identifier, e.g. `de_dust2`. */
const ID_PATTERN = /^[a-z0-9_]+$/;

const idSchema = z.string().regex(ID_PATTERN);

/**
 * Callout positions are normalized to the map image: 0–1 on both axes
 * (ADR-045). Default-layout positions are deliberately approximate — users
 * fine-tune them on their own image (MVP-13, E22.6).
 */
const normalizedCoordinateSchema = z.number().min(0).max(1);

/**
 * A single callout. Exported for the profile repository's tolerant row reads
 * (E22.1) — persisted callouts are re-validated one by one on load.
 */
export const calloutSchema = z.strictObject({
  name: z.string().min(1),
  x: normalizedCoordinateSchema,
  y: normalizedCoordinateSchema,
});

/**
 * A callout set with unique names — shared between the bundled default
 * layouts (below) and per-profile callout updates (E22.1, profile-model.ts).
 */
const calloutListSchema = z.array(calloutSchema).superRefine((callouts, ctx) => {
  checkUnique(
    callouts,
    (callout) => callout.name,
    (callout, index) =>
      addCustomIssue(ctx, [index, 'name'], `duplicate callout name "${callout.name}"`),
  );
});

const mapJsonObjectSchema = z.strictObject({
  // The catalog entry (MVP-07): what the map is and how GSI names it.
  id: idSchema,
  displayName: z.string().min(1),
  gsiNames: z.array(z.string().min(1)).min(1),
  // The default layout. The schema allows an empty array (the catalog entry
  // is meaningful on its own — upload state, GSI resolution), but every
  // shipped pool map carries a curated layout, enforced by the bundled-data
  // gate test (E12.3, MAP-04).
  callouts: calloutListSchema,
});

export const mapJsonSchema = mapJsonObjectSchema.superRefine((map, ctx) => {
  checkUnique(
    map.gsiNames,
    (name) => name,
    (name, index) => addCustomIssue(ctx, ['gsiNames', index], `duplicate GSI name "${name}"`),
  );
});

export type MapData = z.infer<typeof mapJsonSchema>;
export type Callout = z.infer<typeof calloutSchema>;

export type MapJsonErrorCode = 'NOT_JSON' | 'INVALID_SHAPE';

export interface MapJsonError {
  readonly code: MapJsonErrorCode;
  /** Formatted as `path: message` — ready for the E11.2 skip log. */
  readonly issues: readonly string[];
}

export type MapJsonParseResult =
  | { readonly ok: true; readonly map: MapData }
  | { readonly ok: false; readonly error: MapJsonError };

/**
 * Parses raw `map.json` file content into validated map data. Takes the
 * unparsed string so the whole tolerance boundary — JSON syntax and shape —
 * lives here (same split as `parseGsiPayload`, E10.2).
 */
export function parseMapJson(rawJson: string): MapJsonParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: { code: 'NOT_JSON', issues: ['file is not valid JSON'] } };
  }
  const result = mapJsonSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: { code: 'INVALID_SHAPE', issues: result.error.issues.map(formatIssue) },
    };
  }
  return { ok: true, map: result.data };
}

export type CalloutListParseResult =
  | { readonly ok: true; readonly callouts: readonly Callout[] }
  | { readonly ok: false; readonly issues: readonly string[] };

/**
 * Validates an untrusted callout set (normalized 0–1 bounds, unique non-empty
 * names) — the boundary check behind per-profile callout updates (E22.1).
 */
export function parseCalloutList(value: unknown): CalloutListParseResult {
  const result = calloutListSchema.safeParse(value);
  if (!result.success) {
    return { ok: false, issues: result.error.issues.map(formatIssue) };
  }
  return { ok: true, callouts: result.data };
}

function formatIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
  return `${path}: ${issue.message}`;
}

function addCustomIssue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({ code: 'custom', path: [...path], message });
}

function checkUnique<T>(
  entries: readonly T[],
  keyOf: (entry: T) => string,
  report: (entry: T, index: number) => void,
): void {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const key = keyOf(entry);
    if (seen.has(key)) {
      report(entry, index);
    }
    seen.add(key);
  });
}
