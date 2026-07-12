import { expect, test } from '@playwright/test';

import { dismissSetupOfferIfOpen } from './dismiss-setup-offer';
import { launchBuiltApp } from './launch-built-app';

// Regression tests for the settings-page layout report (2026-07-12):
// Radix form controls inside a <form> render a hidden absolutely-positioned
// native <input>; with a non-positioned scroll container its containing
// block is the (relative) sidebar inset, so it escaped the scroller and
// stretched the document — a window scrollbar over invisible "empty space",
// and a second scrollbar for the settings content. jsdom computes no
// layout, so this lives at the E2E level.

async function openSettings(
  electronApp: Awaited<ReturnType<typeof launchBuiltApp>>['electronApp'],
): Promise<Awaited<ReturnType<typeof electronApp.firstWindow>>> {
  const window = await electronApp.firstWindow();
  await expect(window.getByTestId('app-root')).toBeVisible();
  await dismissSetupOfferIfOpen(window);
  await window.getByRole('link', { name: 'Settings' }).click();
  await expect(window.getByRole('heading', { name: 'Settings' })).toBeVisible();
  return window;
}

test('the settings page never stretches the document — one scrollbar, no empty space', async () => {
  const { electronApp, close } = await launchBuiltApp();

  try {
    const window = await openSettings(electronApp);

    // The app shell is capped at the viewport (h-svh); nothing on the
    // settings page may leak scrollable overflow onto the document.
    const heights = await window.locator('html').evaluate((root) => ({
      client: root.clientHeight,
      scroll: root.scrollHeight,
    }));
    expect(heights.scroll).toBeLessThanOrEqual(heights.client + 1);

    // The page's own scroll container reaches its end: the Updates section
    // (the last one) is fully visible after scrolling down.
    const updates = window.getByRole('heading', { name: 'Updates' });
    await updates.scrollIntoViewIfNeeded();
    await expect(window.getByRole('button', { name: 'Check for updates' })).toBeInViewport();
  } finally {
    await close();
  }
});

test('the scoreboard preview renders at the live card column width', async () => {
  const { electronApp, close } = await launchBuiltApp();

  try {
    const window = await openSettings(electronApp);

    // Same component, same width: the live frame gives the card column a
    // 240px basis (ScoreboardFrame basis-60) — a preview at any other width
    // wraps the stat tiles differently than the live view (spec AC 9).
    const card = window.getByRole('region', { name: 'My performance' });
    await card.scrollIntoViewIfNeeded();
    const width = await card.evaluate((element) => element.getBoundingClientRect().width);
    expect(width).toBe(240);
  } finally {
    await close();
  }
});

test('money values stay inside their stat tile', async () => {
  const { electronApp, close } = await launchBuiltApp();

  try {
    const window = await openSettings(electronApp);

    // The default layout puts Money into a shared row; the `$1,234`-format
    // value must never cross the tile border (2026-07-12 report).
    const card = window.getByRole('region', { name: 'My performance' });
    await card.scrollIntoViewIfNeeded();
    const moneyTile = card
      .locator('div')
      .filter({ has: window.getByText('Money', { exact: true }) })
      .last();
    const overflow = await moneyTile.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    await close();
  }
});
