import { contextBridge } from 'electron';

import { APP_NAME } from '../../shared';

// Placeholder bridge proving the preload bundle loads (E1.1). The real typed
// IPC bridge — invoke/subscribe over the shared contract — lands in E5.x
// (ADR-022/032); no ad-hoc channels are added here.
contextBridge.exposeInMainWorld('tactics', {
  appName: APP_NAME,
});
