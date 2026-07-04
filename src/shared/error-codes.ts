/**
 * The closed, contract-enumerated error-code list (ADR-032). Every command
 * failure crossing the IPC boundary carries exactly one of these codes —
 * never stack traces or internal system details (ADR-025). The list grows
 * additively with the tasks that throw new codes.
 */
export const ERROR_CODES = [
  /** Unexpected exception in main — logged there, surfaced only as this code. */
  'INTERNAL',
  /** Command request failed Zod validation at the IPC boundary. */
  'INVALID_REQUEST',
  /** CS2 installation not found by the detection chain (GSI-01). */
  'CS2_NOT_FOUND',
  /** The CS2 cfg directory exists but cannot be written (GSI setup). */
  'CFG_DIR_NOT_WRITABLE',
  /** No port in the GSI fallback chain 42730–42739 was free (ADR-031). */
  'PORT_UNAVAILABLE',
  /** A user-picked path failed CS2 structure validation (GSI-02). */
  'INVALID_PATH',
  /** A storage operation failed (ADR-023/029). */
  'DB_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
