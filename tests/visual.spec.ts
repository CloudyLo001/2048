import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

type CanvasSample = {
  ok: boolean;
  reason: string;
  variance?: number;
  colorBuckets?: number;
};

async function sampleCanvas(page: import('@playwright/test').Page): Promise<CanvasSample> {
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  if (!box || box.width < 32 || box.height < 32) {
    return { ok: false, reason: 'canvas-too-small' };
  }

  const buffer = await canvas.screenshot();
  const png = PNG.sync.read(buffer);
  let min = 255;
  let max = 0;
  let alphaPixels = 0;
  const buckets = new Set<string>();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 4096));

  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const offset = pixel * 4;
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    const a = png.data[offset + 3];
    min = Math.min(min, r, g, b);
    max = Math.max(max, r, g, b);
    if (a > 0) alphaPixels += 1;
    buckets.add(`${r >> 4},${g >> 4},${b >> 4},${a >> 6}`);
  }

  const variance = max - min;
  return {
    ok: alphaPixels > 256 && (variance > 8 || buckets.size > 3),
    reason: 'sampled',
    variance,
    colorBuckets: buckets.size,
  };
}

test('loads the stone blocks and accepts a move', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('#game-canvas')).toBeVisible();
  await page.waitForFunction(() => window.__ROCK2048__?.ready === true, undefined, { timeout: 25_000 });
  await page.waitForFunction(() => (window.__ROCK2048__?.frame ?? 0) > 10);

  const sample = await sampleCanvas(page);
  expect(sample, JSON.stringify(sample)).toMatchObject({ ok: true });
  expect(await page.evaluate(() => window.__ROCK2048__?.tiles ?? 0)).toBe(2);

  // Keep pressing directions until the board changes; two random tiles can block one axis.
  for (const key of ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(350);
    if ((await page.evaluate(() => window.__ROCK2048__?.tiles ?? 0)) >= 3) break;
  }
  expect(await page.evaluate(() => window.__ROCK2048__?.tiles ?? 0)).toBeGreaterThanOrEqual(3);

  // Press the next direction while the spawn animation is still running: a stale tween must
  // not drag a block off its cell (the "not everything moved" bug).
  for (const key of ['ArrowDown', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(160);
  }
  await page.waitForFunction(() => window.__ROCK2048__?.animating === false && window.__ROCK2048__?.busy === false);
  const settled = await page.evaluate(() => ({
    misplaced: window.__ROCK2048__?.misplaced ?? -1,
    tiles: window.__ROCK2048__?.tiles ?? -1,
    boardTiles: window.__ROCK2048__?.boardTiles ?? -2,
  }));
  expect(settled.misplaced, 'every block sits on its board cell').toBe(0);
  expect(settled.tiles, 'scene tile count matches the rules').toBe(settled.boardTiles);

  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach(`${testInfo.project.name}-game`, {
    body: screenshot,
    contentType: 'image/png',
  });

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
