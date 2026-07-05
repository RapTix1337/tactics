import { contextBridge, ipcRenderer } from 'electron';

import type { ContractCommandDefinitions } from '../../shared/commands';
import { COMMAND_NAMES, EVENT_DOMAINS } from '../../shared/contract-names';
import type { ContractEventDefinitions } from '../../shared/events';
import { createBridge } from './bridge';

// The single door between renderer and main (ADR-022/025): exactly the two
// contract-typed functions, nothing else. Imports are subpath + type-only on
// purpose — the shared barrel would inline zod into the sandboxed preload
// bundle (E5.1 watch item); the schemas stay main-only.
contextBridge.exposeInMainWorld(
  'tactics',
  createBridge<ContractCommandDefinitions, ContractEventDefinitions>(
    ipcRenderer,
    COMMAND_NAMES,
    EVENT_DOMAINS,
  ),
);
