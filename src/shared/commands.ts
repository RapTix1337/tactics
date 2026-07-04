import { z } from 'zod';

import { defineCommand } from './contract';

/**
 * `app.getSnapshot` (ADR-022): the renderer's state bootstrap. Skeleton —
 * the response object gains one slice per mirror store with its owning task
 * (settings E8.3, gameState E10.7, updates E18.1).
 */
export const appGetSnapshot = defineCommand('app.getSnapshot', z.void(), z.object({}));
