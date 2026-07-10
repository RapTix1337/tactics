import { z } from 'zod';

/**
 * The gameState slice as it crosses the IPC boundary (03-technical-design.md
 * §5.4, 04-data-flow.md §2): GSI connection status plus the current map —
 * resolved by `app` via the maps registry before the event is published; the
 * renderer never resolves. Contract-owned like `settings.ts`: the gsi
 * module's state machine builds on the same status list (E10.3/E10.7).
 */
export const GSI_STATUSES = [
  'not-set-up',
  'waiting',
  'connected',
  'stale',
  'repair-needed',
] as const;

/** The 05-gsi.md §6.1 state machine's statuses (ADR-024/031). */
export type GsiConnectionStatus = (typeof GSI_STATUSES)[number];

/**
 * The current map, per contract §5.4: a resolved mapId, the informative
 * unsupported state carrying the raw GSI name (MVP-09 — the only raw GSI
 * value that crosses IPC), or none (menus, stale, not set up).
 */
export const gameStateMapSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('resolved'), mapId: z.string().min(1) }),
  z.object({ kind: z.literal('unsupported'), rawName: z.string().min(1) }),
  z.object({ kind: z.literal('none') }),
]);

export type GameStateMap = z.infer<typeof gameStateMapSchema>;

/** The full gameState slice: event payload and snapshot slice (ADR-022). */
export const gameStateSchema = z.object({
  status: z.enum(GSI_STATUSES),
  map: gameStateMapSchema,
});

export type GameState = z.infer<typeof gameStateSchema>;
