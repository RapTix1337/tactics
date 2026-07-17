import type { CatalogCallout } from '../../../shared/map-catalog';
import type { ZoomPanTransform } from './use-zoom-pan';

/**
 * Pure callout-editor logic (E22.6, MVP-13): the screen→normalized coordinate
 * inversion under the zoom/pan transform — the fiddly core, isolated here for
 * unit testing — plus the draft operations the editor applies before saving
 * the whole set via `maps.updateCallouts` (ADR-033: the draft is local view
 * state; persistence happens only through the command).
 */

/**
 * The image's layout rectangle relative to the transform wrapper (its offset
 * parent). Offset values are layout metrics, so they are unaffected by the
 * wrapper's zoom/pan CSS transform.
 */
export interface ImageLayoutRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A point in normalized image coordinates: 0–1 on both axes (ADR-045). */
export interface NormalizedPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Inverts the zoom/pan transform and the image layout box: a canvas-relative
 * screen point → normalized image coordinates. The wrapper maps layout point
 * `q` to screen point `p = translate + scale·q`, so the inversion is
 * `q = (p − translate) / scale`, then the image box normalizes. Deliberately
 * unclamped — values outside [0, 1] mean the point lies outside the image
 * (`isInsideImage` checks, `clampNormalized` clamps; callers pick).
 */
export function screenToNormalized(
  point: NormalizedPoint,
  transform: ZoomPanTransform,
  rect: ImageLayoutRect,
): NormalizedPoint {
  const layoutX = (point.x - transform.x) / transform.scale;
  const layoutY = (point.y - transform.y) / transform.scale;
  return {
    x: (layoutX - rect.left) / rect.width,
    y: (layoutY - rect.top) / rect.height,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function clampNormalized(point: NormalizedPoint): NormalizedPoint {
  return { x: clamp01(point.x), y: clamp01(point.y) };
}

export function isInsideImage(point: NormalizedPoint): boolean {
  return point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

/**
 * A callout in the editor's draft: the catalog shape plus a session-local id.
 * Names are editable in the draft, so they cannot serve as the identity that
 * selection, focus, and drag state hang on to across renames.
 */
export interface DraftCallout extends CatalogCallout {
  readonly id: number;
}

export function toDraft(callouts: readonly CatalogCallout[]): readonly DraftCallout[] {
  return callouts.map((callout, index) => ({ ...callout, id: index }));
}

/** Strips the draft ids back off for the `maps.updateCallouts` payload. */
export function toCallouts(draft: readonly DraftCallout[]): CatalogCallout[] {
  return draft.map(({ name, x, y }) => ({ name, x, y }));
}

export function addCallout(
  draft: readonly DraftCallout[],
  name: string,
  position: NormalizedPoint,
): readonly DraftCallout[] {
  const nextId = draft.reduce((max, callout) => Math.max(max, callout.id), -1) + 1;
  const { x, y } = clampNormalized(position);
  return [...draft, { id: nextId, name, x, y }];
}

export function moveCallout(
  draft: readonly DraftCallout[],
  id: number,
  position: NormalizedPoint,
): readonly DraftCallout[] {
  const { x, y } = clampNormalized(position);
  return draft.map((callout) => (callout.id === id ? { ...callout, x, y } : callout));
}

export function renameCallout(
  draft: readonly DraftCallout[],
  id: number,
  name: string,
): readonly DraftCallout[] {
  return draft.map((callout) => (callout.id === id ? { ...callout, name } : callout));
}

export function deleteCallout(draft: readonly DraftCallout[], id: number): readonly DraftCallout[] {
  return draft.filter((callout) => callout.id !== id);
}

/** The empty draft — the "remove all" editor action; Cancel still restores
 * the saved set, so nothing is lost until the cleared draft is saved. */
export function clearCallouts(): readonly DraftCallout[] {
  return [];
}

/**
 * Callout names are unique within a profile (`calloutListSchema`) — the
 * editor validates against the draft so a duplicate is caught in the name
 * dialog instead of surfacing as `INVALID_REQUEST` at save time.
 */
export function isNameTaken(
  draft: readonly DraftCallout[],
  name: string,
  excludeId?: number,
): boolean {
  return draft.some((callout) => callout.id !== excludeId && callout.name === name);
}
