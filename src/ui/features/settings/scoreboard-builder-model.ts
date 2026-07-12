import type { FieldId, ScoreboardLayout } from '../../../shared/settings';
import { SCOREBOARD_GROUP_LABEL_MAX_LENGTH } from '../../../shared/settings';

/**
 * Pure editing model of the scoreboard builder (SCB.10, live-scoreboard
 * 02-design.md §5): a draft is the persisted layout plus a synthetic stable
 * id per group — dnd-kit needs ids that survive renames and reorders, which
 * labels (editable, not unique) cannot provide. All mutations are pure; the
 * dnd/click handlers in `ScoreboardBuilder` stay thin translations. Guarded
 * mutations return `null` instead of violating the min-1-field rule the
 * shared layout schema enforces on persist.
 */

export interface DraftGroup {
  readonly id: string;
  readonly label: string;
  readonly fields: readonly FieldId[];
}

export type DraftLayout = readonly DraftGroup[];

export interface FieldCategory {
  readonly label: string;
  /** Values are locally accumulated — the available list shows the ~ hint. */
  readonly approximate: boolean;
  readonly fields: readonly FieldId[];
}

/**
 * The three catalog categories of the Designer settings card (spec §4 field
 * catalog). A model test guards that they cover every `FieldId` exactly once.
 */
export const FIELD_CATEGORIES: readonly FieldCategory[] = [
  {
    label: 'Match totals',
    approximate: false,
    fields: ['kills', 'assists', 'deaths', 'mvps', 'score', 'kd', 'kMinusD'],
  },
  { label: 'Derived', approximate: true, fields: ['hsRate'] },
  {
    label: 'Live round state',
    approximate: false,
    fields: ['health', 'armor', 'money', 'equipValue', 'roundKills', 'roundHsKills'],
  },
];

let groupIdSequence = 0;

function nextGroupId(): string {
  groupIdSequence += 1;
  return `builder-group-${String(groupIdSequence)}`;
}

export function toDraft(layout: ScoreboardLayout): DraftLayout {
  return layout.groups.map((group) => ({
    id: nextGroupId(),
    label: group.label,
    fields: group.fields,
  }));
}

export function toLayout(draft: DraftLayout): ScoreboardLayout {
  return { groups: draft.map((group) => ({ label: group.label, fields: group.fields })) };
}

export function layoutsEqual(a: ScoreboardLayout, b: ScoreboardLayout): boolean {
  return (
    a.groups.length === b.groups.length &&
    a.groups.every((group, index) => {
      const other = b.groups.at(index);
      return (
        other !== undefined &&
        group.label === other.label &&
        group.fields.length === other.fields.length &&
        group.fields.every((field, fieldIndex) => field === other.fields[fieldIndex])
      );
    })
  );
}

export function countFields(draft: DraftLayout): number {
  return draft.reduce((total, group) => total + group.fields.length, 0);
}

function withoutField(draft: DraftLayout, field: FieldId): DraftLayout {
  return draft.map((group) => ({
    ...group,
    fields: group.fields.filter((candidate) => candidate !== field),
  }));
}

function categoryOf(field: FieldId): FieldCategory {
  const category = FIELD_CATEGORIES.find((candidate) => candidate.fields.includes(field));
  if (category === undefined) {
    // The drift-guard test keeps FIELD_CATEGORIES exhaustive over FieldId.
    throw new Error(`field ${field} is missing from FIELD_CATEGORIES`);
  }
  return category;
}

/**
 * Click-to-add from the available list: into the group whose label matches
 * the field's catalog category (case-insensitive), else the last group; an
 * empty draft gets a fresh group named after the category.
 */
export function clickAddField(draft: DraftLayout, field: FieldId): DraftLayout {
  const category = categoryOf(field);
  const cleaned = withoutField(draft, field);
  const target =
    cleaned.find((group) => group.label.trim().toLowerCase() === category.label.toLowerCase()) ??
    cleaned.at(-1);
  if (target === undefined) {
    return [{ id: nextGroupId(), label: category.label, fields: [field] }];
  }
  return cleaned.map((group) =>
    group.id === target.id ? { ...group, fields: [...group.fields, field] } : group,
  );
}

/** Removes the field; `null` when it is the last one (min-1 guard). */
export function removeField(draft: DraftLayout, field: FieldId): DraftLayout | null {
  if (countFields(draft) <= 1) {
    return null;
  }
  return withoutField(draft, field);
}

/**
 * Drop onto another field chip: same-group drops reorder with dnd-kit's
 * `arrayMove` semantics (indices of the pre-move list), cross-group drops
 * insert at the over field's position.
 */
export function moveFieldOverField(
  draft: DraftLayout,
  field: FieldId,
  overField: FieldId,
): DraftLayout {
  if (field === overField) {
    return draft;
  }
  const sourceGroup = draft.find((group) => group.fields.includes(field));
  const targetGroup = draft.find((group) => group.fields.includes(overField));
  if (sourceGroup === undefined || targetGroup === undefined) {
    return draft;
  }
  if (sourceGroup.id === targetGroup.id) {
    const fields = [...sourceGroup.fields];
    const from = fields.indexOf(field);
    const to = fields.indexOf(overField);
    fields.splice(from, 1);
    fields.splice(to, 0, field);
    return draft.map((group) => (group.id === sourceGroup.id ? { ...group, fields } : group));
  }
  const overIndex = targetGroup.fields.indexOf(overField);
  return withoutField(draft, field).map((group) => {
    if (group.id !== targetGroup.id) {
      return group;
    }
    const fields = [...group.fields];
    fields.splice(overIndex, 0, field);
    return { ...group, fields };
  });
}

/** Drop onto a group's body (its empty area): append to that group. */
export function moveFieldToGroupEnd(
  draft: DraftLayout,
  field: FieldId,
  groupId: string,
): DraftLayout {
  if (!draft.some((group) => group.id === groupId)) {
    return draft;
  }
  return withoutField(draft, field).map((group) =>
    group.id === groupId ? { ...group, fields: [...group.fields, field] } : group,
  );
}

/** Group reorder: move `groupId` to `overGroupId`'s position. */
export function moveGroupOverGroup(
  draft: DraftLayout,
  groupId: string,
  overGroupId: string,
): DraftLayout {
  const moving = draft.find((group) => group.id === groupId);
  const overIndex = draft.findIndex((group) => group.id === overGroupId);
  if (moving === undefined || overIndex < 0 || groupId === overGroupId) {
    return draft;
  }
  const remaining = draft.filter((group) => group.id !== groupId);
  const next = [...remaining];
  next.splice(overIndex, 0, moving);
  return next;
}

export function addGroup(draft: DraftLayout): { draft: DraftLayout; groupId: string } {
  const groupId = nextGroupId();
  return { draft: [...draft, { id: groupId, label: 'New group', fields: [] }], groupId };
}

export function renameGroup(draft: DraftLayout, groupId: string, label: string): DraftLayout {
  const capped = label.slice(0, SCOREBOARD_GROUP_LABEL_MAX_LENGTH);
  return draft.map((group) => (group.id === groupId ? { ...group, label: capped } : group));
}

/**
 * Removes the group, releasing its fields back to available; `null` when the
 * removal would leave zero fields overall (min-1 guard).
 */
export function removeGroup(draft: DraftLayout, groupId: string): DraftLayout | null {
  const target = draft.find((group) => group.id === groupId);
  if (target === undefined) {
    return draft;
  }
  if (countFields(draft) - target.fields.length < 1) {
    return null;
  }
  return draft.filter((group) => group.id !== groupId);
}
