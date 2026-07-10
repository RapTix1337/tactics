import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { dismissSetupOfferIfOpen } from './dismiss-setup-offer';
import { launchBuiltApp } from './launch-built-app';

const FIXTURE_IMAGE = resolve(import.meta.dirname, '../fixtures/maps/radar-image.svg');
const LARGE_FIXTURE_IMAGE = resolve(import.meta.dirname, '../fixtures/maps/radar-image-large.svg');

// E14.1 / open question #13 (E22.2): proves the tactics-map:// protocol and
// the production CSP together deliver an uploaded image into a rendered
// <img> — the one interplay no unit or integration test can cover.
test('an uploaded map image renders over the tactics-map protocol', async () => {
  const { electronApp, close } = await launchBuiltApp();

  try {
    const window = await electronApp.firstWindow();
    // The app home is the maps overview since E22.4; the ipc-status selector
    // moved out of reach, but a rendered app root is startup barrier enough —
    // the bridge below comes from the preload script.
    await expect(window.getByTestId('app-root')).toBeVisible();

    // Playwright cannot drive native OS dialogs — stub the open dialog in
    // main; everything below it (validation, copy, protocol) stays real.
    await electronApp.evaluate(({ dialog }, imagePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [imagePath] });
    }, FIXTURE_IMAGE);

    // Upload through the real command path; the upload UI itself is E22.4.
    // A string expression: the page's `window` is shadowed by the Playwright
    // variable, and the bridge augmentation lives in the web TS program.
    const result = await window.evaluate(
      `window.tactics.invoke('maps.createProfile', {
        mapId: 'de_dust2',
        name: 'E2E upload',
        source: { kind: 'upload' },
      })`,
    );
    expect(result).toMatchObject({ ok: true, data: { status: 'created' } });

    await dismissSetupOfferIfOpen(window);

    // The direct invoke above bypasses the renderer's IPC layer, so the
    // catalog store is stale: the sidebar entry still carries the E22.4
    // no-image hint ("Dust 2 (no image)") and the overview card still shows
    // its upload button — the default substring matching hits exactly the
    // sidebar link.
    await window.getByRole('link', { name: 'Dust 2' }).click();

    const image = window.getByTestId('map-view-image');
    await expect(image).toBeVisible();
    // naturalWidth > 0 is the actual proof: the bytes arrived over
    // tactics-map:// and passed the CSP img-src policy.
    await expect.poll(() => image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);
  } finally {
    await close();
  }
});

// Regression (Session 64): the shell is capped at the viewport (h-svh), so a
// large map image scales down to fit instead of growing the page into a
// window scrollbar — at the fit scale the whole map is always visible (only
// zooming in may hide parts of it). jsdom has no layout, so this lives here.
test('a large map image fits the viewport without a window scrollbar', async () => {
  const { electronApp, close } = await launchBuiltApp();

  try {
    const window = await electronApp.firstWindow();
    await expect(window.getByTestId('app-root')).toBeVisible();

    await electronApp.evaluate(({ dialog }, imagePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [imagePath] });
    }, LARGE_FIXTURE_IMAGE);
    const result = await window.evaluate(
      `window.tactics.invoke('maps.createProfile', {
        mapId: 'de_dust2',
        name: 'E2E large upload',
        source: { kind: 'upload' },
      })`,
    );
    expect(result).toMatchObject({ ok: true, data: { status: 'created' } });

    await dismissSetupOfferIfOpen(window);

    await window.getByRole('link', { name: 'Dust 2' }).click();
    const image = window.getByTestId('map-view-image');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);

    // The page root must not scroll — the 4096x4096 image scales down to
    // the viewport instead of stretching the page. String expressions, as
    // above: the E2E TS program has no DOM lib and the page's `window` is
    // shadowed by the Playwright variable.
    const overflow = Number(
      await window.evaluate(
        'document.documentElement.scrollHeight - document.documentElement.clientHeight',
      ),
    );
    expect(overflow).toBe(0);
    // And the image itself stays fully inside the window.
    const box = await image.boundingBox();
    const viewportHeight = Number(await window.evaluate('window.innerHeight'));
    expect(box).not.toBeNull();
    if (box !== null) {
      expect(box.y + box.height).toBeLessThanOrEqual(viewportHeight);
    }
  } finally {
    await close();
  }
});

// Regression (Session 64): a height-constrained image re-centers without
// resizing when the window gains width — the callout layer must follow the
// image's new offset, not stay at the stale one (the layout hook observes
// the image's offset parent, not only the image).
test('callout labels stay anchored to the image when the window resizes', async () => {
  const { electronApp, close } = await launchBuiltApp();

  try {
    const window = await electronApp.firstWindow();
    await expect(window.getByTestId('app-root')).toBeVisible();

    await electronApp.evaluate(({ dialog }, imagePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [imagePath] });
    }, LARGE_FIXTURE_IMAGE);
    // The created profile is seeded with the bundled de_dust2 callout
    // layout — "T Spawn" sits at x=0.485, y=0.89 (data/maps/de_dust2).
    const result = await window.evaluate(
      `window.tactics.invoke('maps.createProfile', {
        mapId: 'de_dust2',
        name: 'E2E resize',
        source: { kind: 'upload' },
      })`,
    );
    expect(result).toMatchObject({ ok: true, data: { status: 'created' } });

    await dismissSetupOfferIfOpen(window);

    await window.getByRole('link', { name: 'Dust 2' }).click();
    const image = window.getByTestId('map-view-image');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);
    const label = window.getByText('T Spawn', { exact: true });
    await expect(label).toBeVisible();

    // The label counter-scales around its anchor, so its box center is the
    // anchor point — compare it to the callout's normalized position on the
    // image box (2px tolerance for rounding).
    const anchorOffset = async () => {
      const imageBox = await image.boundingBox();
      const labelBox = await label.boundingBox();
      if (imageBox === null || labelBox === null) {
        return Number.POSITIVE_INFINITY;
      }
      const anchorX = imageBox.x + 0.485 * imageBox.width;
      const anchorY = imageBox.y + 0.89 * imageBox.height;
      const centerX = labelBox.x + labelBox.width / 2;
      const centerY = labelBox.y + labelBox.height / 2;
      return Math.max(Math.abs(centerX - anchorX), Math.abs(centerY - anchorY));
    };
    expect(await anchorOffset()).toBeLessThanOrEqual(2);

    // Widen the window: the height-constrained image keeps its size but
    // re-centers further right; the label must follow.
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const [width = 0, height = 0] = win === undefined ? [] : win.getSize();
      if (win === undefined || width === 0 || height === 0) {
        throw new Error('expected one window with a measurable size');
      }
      win.setSize(width + 400, height);
    });
    await expect.poll(anchorOffset).toBeLessThanOrEqual(2);
  } finally {
    await close();
  }
});
