import { expect, type Page } from '@playwright/test';

/**
 * Dismisses the first-start setup offer (E15.2) when it opened: whether it
 * does depends on this machine's CS2 state, not on the fresh user-data dir
 * alone — the offer is decided exactly once, on the first GSI status. The
 * modal offer marks everything behind it aria-hidden, so the status badge is
 * unreachable by role exactly while the offer is open — waiting on the badge
 * alone deadlocks on machines without CS2 (every CI runner). Wait on
 * whichever appears first: the offer dialog (`not-set-up`) or a filled badge
 * (every other status). The offer is renderer state, so a reload can re-open
 * it — call again after reloads.
 *
 * Returns whether the offer was open (and is dismissed now).
 */
export async function dismissSetupOfferIfOpen(window: Page): Promise<boolean> {
  const offer = window.getByRole('dialog', { name: 'Set up Game State Integration' });
  const filledBadge = window
    .getByRole('status', { name: 'GSI connection status' })
    .filter({ hasText: /\S/ });
  await expect(offer.or(filledBadge).first()).toBeVisible();
  if (!(await offer.isVisible())) {
    return false;
  }
  await offer.getByRole('button', { name: 'Cancel' }).click();
  return true;
}
