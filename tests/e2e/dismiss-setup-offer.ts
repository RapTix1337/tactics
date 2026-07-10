import { expect, type Page } from '@playwright/test';

/**
 * Dismisses the first-start setup offer (E15.2) when it opened: whether it
 * does depends on this machine's CS2 state, not on the fresh user-data dir
 * alone — the offer is decided exactly once, on the first GSI status. Wait
 * for that status on the badge, then close the dialog only when the status
 * is the one that auto-opens it. The offer is renderer state, so a reload
 * can re-open it — call again after reloads.
 */
export async function dismissSetupOfferIfOpen(window: Page): Promise<void> {
  const gsiBadge = window.getByRole('status', { name: 'GSI connection status' });
  await expect(gsiBadge).not.toHaveText('');
  if ((await gsiBadge.innerText()).includes('Not set up')) {
    await window.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  }
}
