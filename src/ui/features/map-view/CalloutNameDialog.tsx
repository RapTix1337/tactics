import type { JSX } from 'react';
import { useId, useState } from 'react';

import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

export interface CalloutNameDialogProps {
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
  /** The current name on rename; empty for a new callout. */
  readonly initialName: string;
  /** Duplicate check against the draft — a taken name blocks the submit. */
  readonly isNameTaken: (name: string) => boolean;
  readonly onSubmit: (name: string) => void;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * The callout name prompt of the editor (E22.6, MVP-13), shared by add and
 * rename. Mounted per open (the parent conditions on the editor's dialog
 * state), so the field starts fresh each time. Submitting only mutates the
 * local draft — validation mirrors `calloutSchema` (trimmed non-empty, ≤200)
 * plus the set's name uniqueness, so a save never fails on the name.
 */
export function CalloutNameDialog({
  title,
  description,
  submitLabel,
  initialName,
  isNameTaken,
  onSubmit,
  onOpenChange,
}: CalloutNameDialogProps): JSX.Element {
  const nameId = useId();
  const [name, setName] = useState(initialName);
  const trimmedName = name.trim();
  const taken = trimmedName !== '' && isNameTaken(trimmedName);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(trimmedName);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={nameId}>Callout name</Label>
            <Input
              id={nameId}
              value={name}
              maxLength={200}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>
          {taken && (
            <p role="alert" className="text-sm text-destructive">
              A callout named “{trimmedName}” already exists in this profile.
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={trimmedName === '' || taken}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
