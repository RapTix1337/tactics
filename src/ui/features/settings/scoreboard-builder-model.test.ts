import { describe, expect, it } from 'vitest';

import type { ScoreboardLayout } from '../../../shared/settings';
import { FIELD_IDS, SCOREBOARD_GROUP_LABEL_MAX_LENGTH } from '../../../shared/settings';
import type { DraftGroup, DraftLayout } from './scoreboard-builder-model';
import {
  addGroup,
  clickAddField,
  countFields,
  FIELD_CATEGORIES,
  layoutsEqual,
  moveFieldOverField,
  moveFieldToGroupEnd,
  moveGroupOverGroup,
  removeField,
  removeGroup,
  renameGroup,
  toDraft,
  toLayout,
} from './scoreboard-builder-model';

const sampleLayout: ScoreboardLayout = {
  groups: [
    { label: 'Match totals', fields: ['kills', 'deaths', 'assists'] },
    { label: 'Derived', fields: ['hsRate'] },
    { label: 'Live round state', fields: ['health', 'money'] },
  ],
};

function labels(draft: DraftLayout | null): string[] {
  expect(draft).not.toBeNull();
  return (draft ?? []).map((group) => group.label);
}

function groupAt(draft: DraftLayout, index: number): DraftGroup {
  const group = draft.at(index);
  if (group === undefined) {
    throw new Error(`no group at index ${String(index)}`);
  }
  return group;
}

function fieldsOf(draft: DraftLayout | null, label: string): readonly string[] {
  expect(draft).not.toBeNull();
  const group = (draft ?? []).find((candidate) => candidate.label === label);
  if (group === undefined) {
    throw new Error(`no group labeled ${label}`);
  }
  return group.fields;
}

describe('scoreboard-builder-model', () => {
  describe('field categories', () => {
    it('covers every FieldId exactly once (catalog drift guard)', () => {
      const categorized = FIELD_CATEGORIES.flatMap((category) => category.fields);
      expect([...categorized].sort()).toEqual([...FIELD_IDS].sort());
      expect(new Set(categorized).size).toBe(categorized.length);
    });

    it('marks only the derived category approximate', () => {
      const approximate = FIELD_CATEGORIES.filter((category) => category.approximate);
      expect(approximate.map((category) => category.label)).toEqual(['Derived']);
    });
  });

  describe('toDraft / toLayout', () => {
    it('round-trips a layout unchanged', () => {
      expect(toLayout(toDraft(sampleLayout))).toEqual(sampleLayout);
    });

    it('assigns each group a unique id, fresh per conversion', () => {
      const draft = toDraft(sampleLayout);
      const ids = draft.map((group) => group.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(toDraft(sampleLayout).map((group) => group.id)).not.toEqual(ids);
    });
  });

  describe('layoutsEqual', () => {
    it('treats structurally identical layouts as equal', () => {
      expect(layoutsEqual(sampleLayout, toLayout(toDraft(sampleLayout)))).toBe(true);
    });

    it('detects field order differences', () => {
      const reordered: ScoreboardLayout = {
        groups: [
          { label: 'Match totals', fields: ['deaths', 'kills', 'assists'] },
          { label: 'Derived', fields: ['hsRate'] },
          { label: 'Live round state', fields: ['health', 'money'] },
        ],
      };
      expect(layoutsEqual(sampleLayout, reordered)).toBe(false);
    });
  });

  describe('countFields', () => {
    it('counts fields across all groups', () => {
      expect(countFields(toDraft(sampleLayout))).toBe(6);
    });
  });

  describe('clickAddField', () => {
    it('adds into the group whose label matches the field category (case-insensitive)', () => {
      const draft = toDraft({
        groups: [
          { label: 'match TOTALS', fields: ['kills'] },
          { label: 'Other', fields: ['health'] },
        ],
      });
      const next = clickAddField(draft, 'score');
      expect(fieldsOf(next, 'match TOTALS')).toEqual(['kills', 'score']);
    });

    it('falls back to the last group when no label matches', () => {
      const draft = toDraft({
        groups: [
          { label: 'First', fields: ['kills'] },
          { label: 'Second', fields: ['health'] },
        ],
      });
      const next = clickAddField(draft, 'mvps');
      expect(fieldsOf(next, 'Second')).toEqual(['health', 'mvps']);
    });

    it('creates a group named after the category when the draft has none', () => {
      const next = clickAddField([], 'hsRate');
      expect(labels(next)).toEqual(['Derived']);
      expect(fieldsOf(next, 'Derived')).toEqual(['hsRate']);
    });
  });

  describe('removeField', () => {
    it('removes the field and keeps everything else', () => {
      const next = removeField(toDraft(sampleLayout), 'deaths');
      expect(fieldsOf(next, 'Match totals')).toEqual(['kills', 'assists']);
      expect(countFields(next ?? [])).toBe(5);
    });

    it('refuses to remove the last remaining field (min-1 guard)', () => {
      const draft = toDraft({ groups: [{ label: 'Only', fields: ['kills'] }] });
      expect(removeField(draft, 'kills')).toBeNull();
      expect(fieldsOf(draft, 'Only')).toEqual(['kills']);
    });
  });

  describe('moveFieldOverField', () => {
    it('reorders within a group with arrayMove semantics (forward)', () => {
      const next = moveFieldOverField(toDraft(sampleLayout), 'kills', 'assists');
      expect(fieldsOf(next, 'Match totals')).toEqual(['deaths', 'assists', 'kills']);
    });

    it('reorders within a group with arrayMove semantics (backward)', () => {
      const next = moveFieldOverField(toDraft(sampleLayout), 'assists', 'kills');
      expect(fieldsOf(next, 'Match totals')).toEqual(['assists', 'kills', 'deaths']);
    });

    it('moves between groups, inserting at the over field position', () => {
      const next = moveFieldOverField(toDraft(sampleLayout), 'kills', 'money');
      expect(fieldsOf(next, 'Match totals')).toEqual(['deaths', 'assists']);
      expect(fieldsOf(next, 'Live round state')).toEqual(['health', 'kills', 'money']);
    });
  });

  describe('moveFieldToGroupEnd', () => {
    it('appends the field to the target group', () => {
      const draft = toDraft(sampleLayout);
      const next = moveFieldToGroupEnd(draft, 'kills', groupAt(draft, 1).id);
      expect(fieldsOf(next, 'Derived')).toEqual(['hsRate', 'kills']);
      expect(fieldsOf(next, 'Match totals')).toEqual(['deaths', 'assists']);
    });
  });

  describe('moveGroupOverGroup', () => {
    it('reorders groups', () => {
      const draft = toDraft(sampleLayout);
      const next = moveGroupOverGroup(draft, groupAt(draft, 0).id, groupAt(draft, 2).id);
      expect(labels(next)).toEqual(['Derived', 'Live round state', 'Match totals']);
    });
  });

  describe('addGroup', () => {
    it('appends an empty "New group" and returns its id', () => {
      const { draft: next, groupId } = addGroup(toDraft(sampleLayout));
      expect(labels(next)).toEqual(['Match totals', 'Derived', 'Live round state', 'New group']);
      expect(groupAt(next, 3).id).toBe(groupId);
      expect(groupAt(next, 3).fields).toEqual([]);
    });
  });

  describe('renameGroup', () => {
    it('renames the group', () => {
      const draft = toDraft(sampleLayout);
      const next = renameGroup(draft, groupAt(draft, 1).id, 'My stats');
      expect(labels(next)).toEqual(['Match totals', 'My stats', 'Live round state']);
    });

    it('caps the label at the shared maximum length', () => {
      const draft = toDraft(sampleLayout);
      const next = renameGroup(draft, groupAt(draft, 0).id, 'x'.repeat(40));
      expect(groupAt(next, 0).label).toHaveLength(SCOREBOARD_GROUP_LABEL_MAX_LENGTH);
    });
  });

  describe('removeGroup', () => {
    it('removes the group and releases its fields', () => {
      const draft = toDraft(sampleLayout);
      const next = removeGroup(draft, groupAt(draft, 1).id);
      expect(labels(next)).toEqual(['Match totals', 'Live round state']);
      expect(countFields(next ?? [])).toBe(5);
    });

    it('refuses when removal would leave zero fields (min-1 guard)', () => {
      const draft = toDraft({
        groups: [
          { label: 'Only fields', fields: ['kills'] },
          { label: 'Empty', fields: [] },
        ],
      });
      expect(removeGroup(draft, groupAt(draft, 0).id)).toBeNull();
      expect(removeGroup(draft, groupAt(draft, 1).id)).not.toBeNull();
    });
  });
});
