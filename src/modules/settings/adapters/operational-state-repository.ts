import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type { Logger } from '../../../shared';
import type { OperationalState, OperationalStateUpdate } from '../core/operational-state-schema';
import {
  GSI_TOKEN_HEX_LENGTH,
  mergeOperationalState,
  parseOperationalState,
} from '../core/operational-state-schema';
import { operationalStateTable } from './schema';
import type { SettingsStoragePort } from './settings-repository';

export interface OperationalStateRepository {
  /**
   * Loads the operational state; the first access generates and persists the
   * GSI auth token (ADR-025 §3). A corrupt stored token is replaced by a
   * fresh one (logged by field name only — the value is banned from logs,
   * ADR-030); other invalid fields fall back to their defaults per field.
   */
  getOperationalState(): OperationalState;
  /**
   * Validates and persists a partial update, returning the full new state.
   * `undefined` fields keep their value; explicit `null` resets the port to
   * automatic / clears the bounds. An invalid value throws `TypeError` and
   * persists nothing. The token is managed internally and never updatable.
   */
  updateOperationalState(partial: OperationalStateUpdate): OperationalState;
}

const OPERATIONAL_STATE_ROW_ID = 1;

export function createOperationalStateRepository(
  storage: SettingsStoragePort,
  logger: Logger,
): OperationalStateRepository {
  return {
    getOperationalState(): OperationalState {
      // A transaction even for a read: the first access (or a corrupt token)
      // writes the generated token, and read-check-write must be atomic.
      return storage.withTransaction((transaction) => readOrRepair(transaction, logger));
    },
    updateOperationalState(partial: OperationalStateUpdate): OperationalState {
      return storage.withTransaction((transaction) => {
        const merged = mergeOperationalState(readOrRepair(transaction, logger), partial);
        const { fallbacks } = parseOperationalState({ ...merged });
        if (fallbacks.length > 0) {
          // The stored state is already validated and the token freshly
          // guaranteed, so any invalid field can only come from the partial.
          throw new TypeError(
            `invalid operational-state update for field(s): ${fallbacks.join(', ')}`,
          );
        }
        persist(transaction, merged);
        return merged;
      });
    },
  };
}

function generateGsiToken(): string {
  return randomBytes(GSI_TOKEN_HEX_LENGTH / 2).toString('hex');
}

/**
 * Reads the single row tolerantly and guarantees a valid token on the way
 * out: a missing row (first run) or an invalid stored token leads to a fresh
 * token being generated and persisted within the ambient transaction.
 */
function readOrRepair(database: BetterSQLite3Database, logger: Logger): OperationalState {
  const row = database
    .select()
    .from(operationalStateTable)
    .where(eq(operationalStateTable.id, OPERATIONAL_STATE_ROW_ID))
    .get();
  if (row === undefined) {
    // First run — nothing stored yet; not an anomaly, so no warning.
    const state: OperationalState = {
      gsiToken: generateGsiToken(),
      effectiveGsiPort: null,
      windowBounds: null,
      overlayBounds: null,
    };
    persist(database, state);
    return state;
  }
  // SQLite's dynamic typing means the row may hold anything despite the
  // column types — treat it as untrusted and re-validate (CLAUDE.md §5).
  const { state, fallbacks } = parseOperationalState(decodeStoredRow(row));
  for (const field of fallbacks) {
    // Field name only — the token value is on the ADR-030 ban list.
    logger.warn('invalid stored operational-state value replaced by its default', { field });
  }
  if (state.gsiToken === null) {
    const repaired: OperationalState = { ...state, gsiToken: generateGsiToken() };
    persist(database, repaired);
    return repaired;
  }
  return { ...state, gsiToken: state.gsiToken };
}

function persist(database: BetterSQLite3Database, state: OperationalState): void {
  database
    .insert(operationalStateTable)
    .values({ id: OPERATIONAL_STATE_ROW_ID, ...encodeStoredState(state) })
    .onConflictDoUpdate({
      target: operationalStateTable.id,
      set: encodeStoredState(state),
    })
    .run();
}

type StoredRow = typeof operationalStateTable.$inferSelect;

/**
 * Stored → domain representation: the five bounds columns collapse into one
 * `windowBounds` group. All-null means "not captured" (a valid `null`);
 * anything else is handed to the tolerant parse as one candidate object, so
 * a partially set or corrupt group falls back as a whole. `window_maximized`
 * decodes only the exact 0/1 literals — no silent coercion. The overlay
 * bounds are one JSON text column (OVL.2): only parseable JSON decodes;
 * anything else stays as-is so the tolerant parse falls back to `null` with
 * a warning instead of silently coercing.
 */
function decodeStoredRow(row: StoredRow): Record<string, unknown> {
  const { windowX, windowY, windowWidth, windowHeight, windowMaximized, ...rest } = row;
  const boundsColumns = [windowX, windowY, windowWidth, windowHeight, windowMaximized];
  const windowBounds = boundsColumns.every((value) => value === null)
    ? null
    : {
        x: windowX,
        y: windowY,
        width: windowWidth,
        height: windowHeight,
        maximized:
          windowMaximized === 0 || windowMaximized === 1 ? windowMaximized === 1 : windowMaximized,
      };
  const decoded: Record<string, unknown> = { ...rest, windowBounds };
  if (typeof decoded.overlayBounds === 'string') {
    try {
      decoded.overlayBounds = JSON.parse(decoded.overlayBounds);
    } catch {
      // Unparseable JSON stays a string — the schema rejects it, falling
      // back to null (defaults on the next overlay open) with a warning.
    }
  }
  return decoded;
}

function encodeStoredState(
  state: OperationalState,
): Omit<typeof operationalStateTable.$inferInsert, 'id'> {
  return {
    gsiToken: state.gsiToken,
    effectiveGsiPort: state.effectiveGsiPort,
    windowX: state.windowBounds?.x ?? null,
    windowY: state.windowBounds?.y ?? null,
    windowWidth: state.windowBounds?.width ?? null,
    windowHeight: state.windowBounds?.height ?? null,
    windowMaximized: state.windowBounds === null ? null : state.windowBounds.maximized ? 1 : 0,
    overlayBounds: state.overlayBounds === null ? null : JSON.stringify(state.overlayBounds),
  };
}
