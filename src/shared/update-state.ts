import { z } from 'zod';

/**
 * The update state as it crosses the IPC boundary (03-technical-design.md
 * §5.4, REL-02): the `updates` module's full mirror slice — snapshot slice,
 * `evt:update.changed` payload, and the `useUpdateStore` content.
 */
export const UPDATE_STATUSES = [
  'idle',
  'checking',
  'available',
  'downloading',
  'ready',
  'error',
] as const;

export type UpdateStatus = (typeof UPDATE_STATUSES)[number];

/**
 * Named failure classes (§4.7: "failures named, never fatal"): the two the
 * design calls out explicitly plus the rest. The raw error text stays in the
 * main-process log — the state carries only the class.
 */
export const UPDATE_ERROR_KINDS = ['offline', 'rate-limited', 'unknown'] as const;

export type UpdateErrorKind = (typeof UPDATE_ERROR_KINDS)[number];

export interface UpdateState {
  readonly status: UpdateStatus;
  /** Version of the found update; `null` until a check found one. */
  readonly version: string | null;
  /** Failure class; non-`null` only in the `error` status. */
  readonly errorKind: UpdateErrorKind | null;
}

export const updateStateSchema = z.object({
  status: z.enum(UPDATE_STATUSES),
  version: z.string().nullable(),
  errorKind: z.enum(UPDATE_ERROR_KINDS).nullable(),
});
