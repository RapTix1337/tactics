import { useState } from 'react';

import { updateCallouts } from '@/lib/ipc/map-catalog';

import type { MapProfileDetails } from '../../../shared/map-catalog';
import type { DraftCallout, NormalizedPoint } from './callout-editing';
import {
  addCallout,
  deleteCallout,
  isNameTaken,
  moveCallout,
  renameCallout,
  toCallouts,
  toDraft,
} from './callout-editing';

/** The open name dialog: adding at a placed position or renaming a draft entry. */
export type CalloutEditorDialog =
  | { readonly kind: 'add'; readonly position: NormalizedPoint }
  | { readonly kind: 'rename'; readonly calloutId: number };

export interface CalloutEditorSession {
  readonly draft: readonly DraftCallout[];
  readonly dialog: CalloutEditorDialog | undefined;
  readonly saving: boolean;
  readonly error: string | undefined;
}

export interface CalloutEditor {
  /** The active session — `undefined` renders the view-only layer. */
  readonly session: CalloutEditorSession | undefined;
  readonly start: () => void;
  /** Discards the draft; the view falls back to the saved callouts. */
  readonly cancel: () => void;
  /** Saves via `maps.updateCallouts`; success exits the editor (ADR-033 —
   * the mirrored response re-renders the layer), failure keeps the draft. */
  readonly save: () => void;
  readonly requestAdd: (position: NormalizedPoint) => void;
  readonly requestRename: (calloutId: number) => void;
  readonly closeDialog: () => void;
  /** Applies the open dialog (add or rename) to the draft and closes it. */
  readonly submitDialog: (name: string) => void;
  readonly move: (calloutId: number, position: NormalizedPoint) => void;
  readonly remove: (calloutId: number) => void;
  /** Duplicate check for the open dialog (a rename may keep its own name). */
  readonly isDialogNameTaken: (name: string) => boolean;
}

interface EditorState extends CalloutEditorSession {
  /** The profile the draft belongs to — a switched profile hides the session
   * (derived at render time, the `FetchState` pattern) instead of editing the
   * wrong callout set; switching back resumes the unsaved draft. */
  readonly profileId: string;
}

/**
 * The callout-editor state of the map canvas (E22.6, MVP-13): a draft copy of
 * the profile's callouts as local view state (ADR-033 level 2), mutated by
 * the pure `callout-editing` operations and persisted only through
 * `maps.updateCallouts`. All mutations no-op while a save is in flight.
 */
export function useCalloutEditor(profile: MapProfileDetails): CalloutEditor {
  const [state, setState] = useState<EditorState | undefined>(undefined);
  const session = state?.profileId === profile.id ? state : undefined;

  function updateSession(recipe: (current: EditorState) => EditorState): void {
    setState((current) =>
      current !== undefined && current.profileId === profile.id && !current.saving
        ? recipe(current)
        : current,
    );
  }

  function save(): void {
    if (session === undefined || session.saving) {
      return;
    }
    updateSession((current) => ({ ...current, saving: true, error: undefined }));
    void updateCallouts(profile.mapId, profile.id, toCallouts(session.draft)).then((result) => {
      setState((current) => {
        if (current === undefined || current.profileId !== profile.id) {
          return current;
        }
        return result.ok ? undefined : { ...current, saving: false, error: result.error.message };
      });
    });
  }

  return {
    session,
    start: (): void => {
      setState({
        profileId: profile.id,
        draft: toDraft(profile.callouts),
        dialog: undefined,
        saving: false,
        error: undefined,
      });
    },
    cancel: (): void => {
      setState((current) =>
        current !== undefined && current.profileId === profile.id && !current.saving
          ? undefined
          : current,
      );
    },
    save,
    requestAdd: (position): void => {
      updateSession((current) => ({ ...current, dialog: { kind: 'add', position } }));
    },
    requestRename: (calloutId): void => {
      updateSession((current) => ({ ...current, dialog: { kind: 'rename', calloutId } }));
    },
    closeDialog: (): void => {
      updateSession((current) => ({ ...current, dialog: undefined }));
    },
    submitDialog: (name): void => {
      updateSession((current) => {
        if (current.dialog === undefined) {
          return current;
        }
        const draft =
          current.dialog.kind === 'add'
            ? addCallout(current.draft, name, current.dialog.position)
            : renameCallout(current.draft, current.dialog.calloutId, name);
        return { ...current, draft, dialog: undefined };
      });
    },
    move: (calloutId, position): void => {
      updateSession((current) => ({
        ...current,
        draft: moveCallout(current.draft, calloutId, position),
      }));
    },
    remove: (calloutId): void => {
      updateSession((current) => ({
        ...current,
        draft: deleteCallout(current.draft, calloutId),
      }));
    },
    isDialogNameTaken: (name): boolean => {
      if (session === undefined || session.dialog === undefined) {
        return false;
      }
      const excludeId = session.dialog.kind === 'rename' ? session.dialog.calloutId : undefined;
      return isNameTaken(session.draft, name, excludeId);
    },
  };
}
