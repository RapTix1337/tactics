import { fileURLToPath } from 'node:url';

import { app, BrowserWindow } from 'electron';

import { APP_NAME } from '../shared';

// Minimal toolchain proof (E1.1). App lifecycle, window sizing, and the full
// ADR-025 hardening land in E3.1 (src/app/lifecycle); Electron's secure
// defaults (contextIsolation on, sandbox on, nodeIntegration off) apply.
function createWindow(): void {
  const window = new BrowserWindow({
    width: 1024,
    height: 700,
    title: APP_NAME,
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
    },
  });

  window.once('ready-to-show', () => {
    console.log(`[${APP_NAME}] window ready`);
  });

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl !== undefined) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)));
  }
}

void app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
