import { z } from 'zod';

import { defineCommand } from './contract';
import { settingsSchema, settingsUpdateSchema } from './settings';

/**
 * `app.getSnapshot` (ADR-022): the renderer's state bootstrap. The response
 * object gains one slice per mirror store with its owning task (settings
 * E8.3, gameState E10.7, updates E18.1).
 */
export const appGetSnapshot = defineCommand(
  'app.getSnapshot',
  z.void(),
  z.object({ settings: settingsSchema }),
);

/**
 * `settings.update` (03-technical-design.md §5.3, 01-requirements.md §9):
 * partial in, validated and persisted in main, full new state back. The same
 * full slice is published as `evt:settings.changed` — the response exists
 * for the caller's error handling, stores are fed by the event (ADR-033).
 */
export const settingsUpdate = defineCommand(
  'settings.update',
  settingsUpdateSchema,
  settingsSchema,
);

/**
 * `app.reportRendererError` (03-technical-design.md §5.3/§8.3, PRV-04): the
 * renderer's only error escalation path — the global handlers (E6.2) and
 * the React error boundary (E13.3) report through it; main logs the report
 * under the `renderer` scope. `route` is optional until the router lands
 * (E13.3). The length caps bound a single log line; the renderer truncates
 * before sending, these are the boundary guard.
 */
export const appReportRendererError = defineCommand(
  'app.reportRendererError',
  z.object({
    message: z.string().max(2_000),
    stack: z.string().max(16_000).optional(),
    route: z.string().max(500).optional(),
  }),
  z.void(),
);

/**
 * `logs.openDirectory` (03-technical-design.md §5.3, PRV-04): opens the log
 * folder in the file manager so users can inspect the files they would
 * attach to a bug report.
 */
export const logsOpenDirectory = defineCommand('logs.openDirectory', z.void(), z.void());

/**
 * `logs.export` (03-technical-design.md §5.3, PRV-04): main opens a native
 * save dialog and writes current + archived logs as one text file. Cancel
 * is a regular outcome, not an error — hence the status union.
 */
export const logsExport = defineCommand(
  'logs.export',
  z.void(),
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('saved'), filePath: z.string() }),
    z.object({ status: z.literal('canceled') }),
  ]),
);

/**
 * The contract's command definitions, keyed by name — the map the typed
 * bridge surface (bridge.ts) and the zod-free name list (contract-names.ts)
 * are checked against. Every new command adds one line here.
 */
export interface ContractCommandDefinitions {
  'app.getSnapshot': typeof appGetSnapshot;
  'app.reportRendererError': typeof appReportRendererError;
  'logs.openDirectory': typeof logsOpenDirectory;
  'logs.export': typeof logsExport;
  'settings.update': typeof settingsUpdate;
}
