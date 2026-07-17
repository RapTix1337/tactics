import { z } from 'zod';

/**
 * The GSI auth token is persisted as lowercase hex of 32 cryptographically
 * random bytes (ADR-025 §3); generation lives in the adapter — core stays
 * free of Node imports (ADR-019).
 */
export const GSI_TOKEN_HEX_LENGTH = 64;

const gsiTokenSchema = z.string().regex(new RegExp(`^[0-9a-f]{${GSI_TOKEN_HEX_LENGTH}}$`));

export function isValidGsiToken(value: unknown): value is string {
  return gsiTokenSchema.safeParse(value).success;
}

/** Last known main-window placement; `null` until first captured (E17.3). */
export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly maximized: boolean;
}

/**
 * The operational-state row as stored (ADR-029): the token is `null` only
 * when missing or invalid — the repository then generates a fresh one and
 * hands out {@link OperationalState}, where it is guaranteed.
 */
export interface StoredOperationalState {
  readonly gsiToken: string | null;
  /** Port the GSI server actually bound to; `null` = not started yet. */
  readonly effectiveGsiPort: number | null;
  readonly windowBounds: WindowBounds | null;
  /**
   * Last known overlay-window placement (OVL.2, ADR-058); `null` until first
   * captured. Same shape as `windowBounds`, but `maximized` is structurally
   * `false` — the overlay is never maximizable, so a stored `true` is
   * corruption and drops the whole group.
   */
  readonly overlayBounds: WindowBounds | null;
}

export interface OperationalState extends StoredOperationalState {
  readonly gsiToken: string;
}

/** The externally updatable slice — the token is managed internally only. */
export type OperationalStateUpdate = Partial<
  Pick<OperationalState, 'effectiveGsiPort' | 'windowBounds' | 'overlayBounds'>
>;

export type OperationalStateField = keyof StoredOperationalState;

export const OPERATIONAL_STATE_DEFAULTS: StoredOperationalState = {
  gsiToken: null,
  effectiveGsiPort: null,
  windowBounds: null,
  overlayBounds: null,
};

export const OPERATIONAL_STATE_FIELDS = [
  'gsiToken',
  'effectiveGsiPort',
  'windowBounds',
  'overlayBounds',
] as const satisfies readonly OperationalStateField[];

const fieldSchemas: { [K in OperationalStateField]: z.ZodType<StoredOperationalState[K]> } = {
  gsiToken: gsiTokenSchema,
  effectiveGsiPort: z.number().int().min(1).max(65535).nullable(),
  // All-or-nothing on purpose: partial bounds are meaningless, so one bad
  // member drops the whole group back to "not captured".
  windowBounds: z
    .strictObject({
      x: z.number().int(),
      y: z.number().int(),
      width: z.number().int().min(1),
      height: z.number().int().min(1),
      maximized: z.boolean(),
    })
    .nullable(),
  overlayBounds: z
    .strictObject({
      x: z.number().int(),
      y: z.number().int(),
      width: z.number().int().min(1),
      height: z.number().int().min(1),
      maximized: z.literal(false),
    })
    .nullable(),
};

export interface ParsedOperationalState {
  readonly state: StoredOperationalState;
  /** Fields whose raw value was invalid and fell back to their default. */
  readonly fallbacks: readonly OperationalStateField[];
}

/**
 * Tolerant per-field read (ADR-029, 03-technical-design.md §7.2): an invalid
 * value falls back to that field's default without touching the others.
 * Unknown keys in `raw` are ignored. A `gsiToken` fallback lands on `null`,
 * which the repository treats as "generate a new token".
 */
export function parseOperationalState(
  raw: Readonly<Record<string, unknown>>,
): ParsedOperationalState {
  const fallbacks: OperationalStateField[] = [];
  const state = { ...OPERATIONAL_STATE_DEFAULTS };
  for (const field of OPERATIONAL_STATE_FIELDS) {
    if (!applyField(state, field, raw[field])) {
      fallbacks.push(field);
    }
  }
  return { state, fallbacks };
}

function applyField<K extends OperationalStateField>(
  target: { -readonly [F in OperationalStateField]: StoredOperationalState[F] },
  field: K,
  value: unknown,
): boolean {
  const result = fieldSchemas[field].safeParse(value);
  if (!result.success) {
    return false;
  }
  target[field] = result.data;
  return true;
}

/**
 * Applies a partial update over the current state. Fields that are absent or
 * `undefined` keep their value; an explicit `null` is a real value (port back
 * to automatic, bounds cleared). The token is never part of an update.
 */
export function mergeOperationalState(
  current: OperationalState,
  partial: OperationalStateUpdate,
): OperationalState {
  return {
    gsiToken: current.gsiToken,
    effectiveGsiPort:
      partial.effectiveGsiPort === undefined ? current.effectiveGsiPort : partial.effectiveGsiPort,
    windowBounds: partial.windowBounds === undefined ? current.windowBounds : partial.windowBounds,
    overlayBounds:
      partial.overlayBounds === undefined ? current.overlayBounds : partial.overlayBounds,
  };
}
