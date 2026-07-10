import { expect, test } from '@playwright/test';

import { dismissSetupOfferIfOpen } from './dismiss-setup-offer';
import { launchBuiltApp } from './launch-built-app';

// E17.1 acceptance evidence for the parts a real app can show headlessly:
// with close-to-tray enabled (the default), closing the window keeps main
// alive, and reopening recreates the window with a working snapshot
// bootstrap. The reopen path is driven via `second-instance` — the same
// handler the tray's Show item uses (openMainWindow) — because Playwright
// cannot click the OS tray. Quit-when-disabled is unit-tested
// (tray.test.ts) on the decision the `window-all-closed` handler applies.

test('close hides to tray and a reopen restores a working window', async () => {
  const { electronApp, close } = await launchBuiltApp();

  try {
    const window = await electronApp.firstWindow();
    await expect(window.getByTestId('app-root')).toBeVisible();

    // Close the only window the way the titlebar X does (BrowserWindow
    // close → closed → window-all-closed). With closeToTray on (default)
    // the app must keep running with zero windows — main state lives on
    // (ADR-020/022).
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await expect
      .poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(0);

    // Reopen through the second-instance path (shared with the tray menu).
    // waitForEvent captures the new window; firstWindow() would hand back
    // the closed one.
    const [reopened] = await Promise.all([
      electronApp.waitForEvent('window'),
      electronApp.evaluate(({ app }) => {
        app.emit('second-instance');
      }),
    ]);
    await expect(reopened.getByTestId('app-root')).toBeVisible();

    // The recreated renderer re-ran the snapshot bootstrap (E5.4): the GSI
    // status badge only renders text once the snapshot arrived. The recreated
    // renderer also re-decides the first-start offer, which would aria-hide
    // the badge — settle it first.
    await dismissSetupOfferIfOpen(reopened);
    const gsiBadge = reopened.getByRole('status', { name: 'GSI connection status' });
    await expect(gsiBadge).not.toHaveText('');
  } finally {
    // electronApp.close() quits despite close-to-tray — the same
    // programmatic quit path the tray menu's Quit item takes.
    await close();
  }
});
