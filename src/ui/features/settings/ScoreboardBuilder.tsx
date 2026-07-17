import type { Announcements, DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVerticalIcon, PlusIcon, XIcon } from 'lucide-react';
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import type { FieldId } from '../../../shared/settings';
import { FIELD_IDS, SCOREBOARD_GROUP_LABEL_MAX_LENGTH } from '../../../shared/settings';
import { STAT_FIELDS } from '../scoreboard/stat-fields';
import type { DraftGroup, DraftLayout } from './scoreboard-builder-model';
import {
  addGroup,
  clickAddField,
  countFields,
  FIELD_CATEGORIES,
  moveFieldOverField,
  moveFieldToGroupEnd,
  moveGroupOverGroup,
  removeField,
  removeGroup,
  renameGroup,
} from './scoreboard-builder-model';

/** Droppable id of the available-fields zone — dropping a chip there removes it. */
const AVAILABLE_DROP_ID = 'available';
/** Droppable-id prefix for a group's body (the drop target of an empty group). */
const GROUP_BODY_PREFIX = 'drop:';

const FIELD_ID_SET: ReadonlySet<string> = new Set(FIELD_IDS);

function isFieldId(id: string): id is FieldId {
  return FIELD_ID_SET.has(id);
}

/** Maps any droppable id a drag can end over to the group it belongs to. */
function overGroupId(draft: DraftLayout, overId: string): string | undefined {
  if (isFieldId(overId)) {
    return draft.find((group) => group.fields.includes(overId))?.id;
  }
  const groupId = overId.startsWith(GROUP_BODY_PREFIX)
    ? overId.slice(GROUP_BODY_PREFIX.length)
    : overId;
  return draft.some((group) => group.id === groupId) ? groupId : undefined;
}

function describeId(draft: DraftLayout, id: string): string {
  if (isFieldId(id)) {
    return `field ${STAT_FIELDS[id].label}`;
  }
  if (id === AVAILABLE_DROP_ID) {
    return 'the available fields';
  }
  const groupId = overGroupId(draft, id);
  const group = draft.find((candidate) => candidate.id === groupId);
  return group === undefined ? 'the scoreboard' : `group ${group.label}`;
}

/**
 * The dnd-kit group composer of the scoreboard settings section (SCB.10,
 * live-scoreboard 02-design.md §5, ADR-054): sortable field chips inside
 * sortable groups, an available-fields zone (drop or × to remove, click to
 * add), and add/rename/remove-group affordances. Controlled: every committed
 * mutation goes up through `onDraftChange` — the section persists it
 * (autosave per mutation, maintainer decision at SCB.10 plan approval).
 * Keyboard operability and announcements come from dnd-kit (UI-06).
 */
export function ScoreboardBuilder({
  draft,
  onDraftChange,
}: {
  readonly draft: DraftLayout;
  readonly onDraftChange: (next: DraftLayout) => void;
}): JSX.Element {
  const [blocked, setBlocked] = useState(false);
  // The chip currently dragged — rendered in a portaled DragOverlay because
  // the group containers clip their content (overflow-hidden): without the
  // overlay the chip disappears the moment it crosses its group's border.
  const [activeField, setActiveField] = useState<FieldId | undefined>(undefined);
  const containerRef = useRef<HTMLElement | null>(null);
  const pendingFocusGroupId = useRef<string | undefined>(undefined);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Focus the name input of a group created via "Add group" once it exists —
  // the draft change round-trips through the controlling parent first.
  useEffect(() => {
    if (pendingFocusGroupId.current === undefined) {
      return;
    }
    const input = containerRef.current?.querySelector<HTMLInputElement>(
      `[data-focus-target="${pendingFocusGroupId.current}"]`,
    );
    if (input !== null && input !== undefined) {
      input.focus();
      input.select();
      pendingFocusGroupId.current = undefined;
    }
  });

  /** Central guard: `null` means the min-1-field rule blocked the mutation. */
  function apply(next: DraftLayout | null): void {
    if (next === null) {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    if (next !== draft) {
      onDraftChange(next);
    }
  }

  function handleDragStart(event: DragStartEvent): void {
    const activeId = String(event.active.id);
    setActiveField(isFieldId(activeId) ? activeId : undefined);
  }

  function handleDragEnd(event: DragEndEvent): void {
    setActiveField(undefined);
    const activeId = String(event.active.id);
    const overId = event.over === null ? null : String(event.over.id);
    if (overId === null || overId === activeId) {
      return;
    }
    if (isFieldId(activeId)) {
      if (overId === AVAILABLE_DROP_ID) {
        apply(removeField(draft, activeId));
        return;
      }
      if (isFieldId(overId)) {
        apply(moveFieldOverField(draft, activeId, overId));
        return;
      }
      const targetGroup = overGroupId(draft, overId);
      if (targetGroup !== undefined) {
        apply(moveFieldToGroupEnd(draft, activeId, targetGroup));
      }
      return;
    }
    const targetGroup = overGroupId(draft, overId);
    if (targetGroup !== undefined) {
      apply(moveGroupOverGroup(draft, activeId, targetGroup));
    }
  }

  function handleAddGroup(): void {
    const result = addGroup(draft);
    pendingFocusGroupId.current = result.groupId;
    apply(result.draft);
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${describeId(draft, String(active.id))}.`,
    onDragOver: ({ active, over }) =>
      over === null
        ? `${describeId(draft, String(active.id))} is no longer over a drop area.`
        : `${describeId(draft, String(active.id))} is over ${describeId(draft, String(over.id))}.`,
    onDragEnd: ({ active, over }) =>
      over === null
        ? `Dropped ${describeId(draft, String(active.id))}.`
        : `Dropped ${describeId(draft, String(active.id))} over ${describeId(draft, String(over.id))}.`,
    onDragCancel: ({ active }) => `Dragging ${describeId(draft, String(active.id))} was cancelled.`,
  };

  const fieldCount = countFields(draft);
  const usedFields = new Set(draft.flatMap((group) => [...group.fields]));

  return (
    <section ref={containerRef} aria-label="Scoreboard builder" className="flex flex-col gap-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveField(undefined);
        }}
        accessibility={{ announcements }}
      >
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Your scoreboard
            <span className="font-mono font-medium normal-case tracking-normal text-foreground">
              {fieldCount} {fieldCount === 1 ? 'field' : 'fields'} · {draft.length}{' '}
              {draft.length === 1 ? 'group' : 'groups'}
            </span>
          </span>
          <SortableContext
            items={draft.map((group) => group.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-2.5">
              {draft.map((group) => (
                <GroupRow
                  key={group.id}
                  group={group}
                  onRename={(label) => {
                    apply(renameGroup(draft, group.id, label));
                  }}
                  onRemoveGroup={() => {
                    apply(removeGroup(draft, group.id));
                  }}
                  onRemoveField={(field) => {
                    apply(removeField(draft, field));
                  }}
                />
              ))}
            </div>
          </SortableContext>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={handleAddGroup}
          >
            <PlusIcon aria-hidden="true" className="size-3.5" />
            Add group
          </Button>
          {blocked && (
            <p role="alert" className="text-destructive text-sm">
              Keep at least one field in the scoreboard.
            </p>
          )}
        </div>
        <AvailableFields
          usedFields={usedFields}
          onAdd={(field) => {
            apply(clickAddField(draft, field));
          }}
        />
        <DragOverlay>
          {activeField !== undefined && (
            <div
              data-testid="drag-overlay-chip"
              className="flex w-fit cursor-grabbing items-center gap-1 rounded-lg border bg-card py-1 pr-1 pl-1.5 text-[13px] font-medium shadow-md"
            >
              <GripVerticalIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
              {STAT_FIELDS[activeField].label}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </section>
  );
}

function GroupRow({
  group,
  onRename,
  onRemoveGroup,
  onRemoveField,
}: {
  readonly group: DraftGroup;
  readonly onRename: (label: string) => void;
  readonly onRemoveGroup: () => void;
  readonly onRemoveField: (field: FieldId) => void;
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
  });
  const { setNodeRef: setBodyRef, isOver: bodyIsOver } = useDroppable({
    id: `${GROUP_BODY_PREFIX}${group.id}`,
  });

  function commitRename(input: HTMLInputElement): void {
    if (input.value !== group.label) {
      onRename(input.value);
    }
  }

  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={group.label}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`overflow-hidden rounded-lg border bg-muted/30 ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center gap-1 border-b p-1.5">
        <button
          type="button"
          aria-label={`Reorder group ${group.label}`}
          className="flex cursor-grab items-center rounded p-1 text-muted-foreground hover:text-foreground"
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon aria-hidden="true" className="size-3.5" />
        </button>
        <Input
          key={group.id}
          aria-label="Group name"
          data-focus-target={group.id}
          defaultValue={group.label}
          maxLength={SCOREBOARD_GROUP_LABEL_MAX_LENGTH}
          className="h-7 border-transparent bg-transparent text-xs font-bold tracking-widest uppercase"
          onBlur={(event) => {
            commitRename(event.currentTarget);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
        <button
          type="button"
          aria-label={`Remove group ${group.label}`}
          className="flex items-center rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={onRemoveGroup}
        >
          <XIcon aria-hidden="true" className="size-3.5" />
        </button>
      </div>
      <SortableContext items={[...group.fields]} strategy={rectSortingStrategy}>
        <ul
          ref={setBodyRef}
          className={`m-0 flex min-h-11 list-none flex-wrap items-center gap-2 p-2.5 ${
            bodyIsOver ? 'bg-muted/55' : ''
          }`}
        >
          {group.fields.length === 0 && (
            <li className="text-sm text-muted-foreground">Drag fields here</li>
          )}
          {group.fields.map((field) => (
            <FieldChip
              key={field}
              field={field}
              onRemove={() => {
                onRemoveField(field);
              }}
            />
          ))}
        </ul>
      </SortableContext>
    </div>
  );
}

function FieldChip({
  field,
  onRemove,
}: {
  readonly field: FieldId;
  readonly onRemove: () => void;
}): JSX.Element {
  const label = STAT_FIELDS[field].label;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-1 rounded-lg border bg-card py-1 pr-1 pl-1.5 text-[13px] font-medium ${
        isDragging ? 'opacity-35' : ''
      }`}
    >
      <button
        type="button"
        aria-label={`Reorder ${label}`}
        className="flex cursor-grab items-center text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon aria-hidden="true" className="size-3.5" />
      </button>
      {label}
      <button
        type="button"
        aria-label={`Remove ${label}`}
        className="flex items-center rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        onClick={onRemove}
      >
        <XIcon aria-hidden="true" className="size-3.5" />
      </button>
    </li>
  );
}

function AvailableFields({
  usedFields,
  onAdd,
}: {
  readonly usedFields: ReadonlySet<FieldId>;
  readonly onAdd: (field: FieldId) => void;
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: AVAILABLE_DROP_ID });
  return (
    <section aria-label="Available fields" className="flex flex-col gap-2">
      <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        Available fields
      </span>
      <div
        ref={setNodeRef}
        className={`flex min-h-14 flex-col gap-3.5 rounded-lg border border-dashed p-3 ${
          isOver ? 'border-ring bg-muted/65' : 'bg-muted/40'
        }`}
      >
        {FIELD_CATEGORIES.map((category) => {
          const unused = category.fields.filter((field) => !usedFields.has(field));
          return (
            <div key={category.label} className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
                {category.label}
                {category.approximate && (
                  <span className="rounded border border-amber-500/40 px-1 text-[8px] text-amber-500 normal-case">
                    ~ approx
                  </span>
                )}
              </span>
              {category.approximate && (
                <span className="text-[11px] text-muted-foreground">
                  Accumulated locally each round — values are approximate.
                </span>
              )}
              {unused.length === 0 ? (
                <span className="text-xs text-muted-foreground/70">All in use</span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {unused.map((field) => (
                    <button
                      key={field}
                      type="button"
                      aria-label={`Add ${STAT_FIELDS[field].label} to the scoreboard`}
                      className="flex items-center gap-1.5 rounded-lg border bg-input/25 px-2.5 py-1 text-[13px] font-medium hover:bg-secondary"
                      onClick={() => {
                        onAdd(field);
                      }}
                    >
                      <PlusIcon aria-hidden="true" className="size-3 text-muted-foreground" />
                      {STAT_FIELDS[field].label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
