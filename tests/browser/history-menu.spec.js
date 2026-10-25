import { test, expect } from '@playwright/test';

const record = {
  id: 'menu-speed-fixture', eventName: 'Menu speed dinner', friends: ['A', 'B'],
  billItems: [{ name: 'Pizza', quantity: 1, amount: 100 }], allocations: [['A', 'B']],
  settlements: [{ name: 'A', amount: 50 }, { name: 'B', amount: 50 }],
  subtotal: 100, vatEnabled: false, vatRate: 7, vatAmount: 0,
  discountEnabled: false, discountAmount: 0, total: 100,
  createdAt: 1700000000000, updatedAt: 1700000000000,
};
const drawerCss = /\/assets\/(styles|clay|maggie-workflow)-[^/]+\.css$/;

test.use({ reducedMotion: 'no-preference' });
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.pathname.startsWith('/_vercel/')) return route.fulfill({ contentType: 'application/javascript', body: '' });
    if (url.pathname === '/api/analytics') return route.fulfill({ json: { recorded: true } });
    return route.continue();
  });
});

async function seed(page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Split a bill/ })).toBeVisible();
  await page.evaluate(async record => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('harn-kun-history', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('operations', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('operations', 'readwrite');
      transaction.objectStore('operations').put(record);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, record);
  await page.reload();
  await expect(page.locator('.home-history-card')).toBeVisible();
}

async function stylesReady(page) {
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')]
    .filter(link => /\/assets\/(styles|clay|maggie-workflow)-/.test(link.href) && link.sheet).length)).toBe(3);
}

// Observe the actual class change and browser transitions, excluding click auto-wait
// and network time. Visibility alone would pass while the drawer is still moving.
async function measure(page, open, action) {
  await page.evaluate(open => {
    const menu = document.querySelector('.staggered-menu');
    const panel = menu.querySelector('.staggered-menu-panel');
    const layers = [...menu.querySelectorAll('.staggered-menu-layer, .staggered-menu-panel')];
    const backdrop = menu.querySelector('.staggered-menu-backdrop');
    const elements = [...layers, backdrop, menu.querySelector('.staggered-menu-toggle'), ...menu.querySelectorAll('.staggered-menu-toggle b')];
    window.__menuMeasurement = new Promise(resolve => {
      const observer = new MutationObserver(() => {
        if (menu.classList.contains('is-open') !== open) return;
        observer.disconnect();
        const start = performance.now();
        const scroll = { x: window.scrollX, y: window.scrollY, dashboard: document.querySelector('.home-dashboard').scrollTop };
        const milliseconds = value => parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000);
        const timings = elements.map(element => {
          const style = getComputedStyle(element);
          const durations = style.transitionDuration.split(',').map(milliseconds);
          const delays = style.transitionDelay.split(',').map(milliseconds);
          return durations.map((duration, index) => duration + delays[index % delays.length]);
        });
        const layerDelays = layers.map(layer => milliseconds(getComputedStyle(layer).transitionDelay));
        const backdropStyle = getComputedStyle(backdrop);
        const backdropTiming = {
          properties: backdropStyle.transitionProperty.split(',').map(value => value.trim()),
          durations: backdropStyle.transitionDuration.split(',').map(milliseconds),
          delays: backdropStyle.transitionDelay.split(',').map(milliseconds),
        };
        let focusMs = null;
        const onFocus = () => { focusMs = performance.now() - start; };
        panel.addEventListener('focus', onFocus);
        const tick = () => {
          const elapsed = performance.now() - start;
          const moving = elements.some(element => element.getAnimations().some(animation => animation.playState !== 'finished' && animation.playState !== 'idle'));
          if (moving && elapsed < 1500) { window.requestAnimationFrame(tick); return; }
          panel.removeEventListener('focus', onFocus);
          resolve({ elapsed, moving, timings, layerDelays, backdropTiming, focusMs,
            focused: document.activeElement === panel,
            scrollUnchanged: scroll.x === window.scrollX && scroll.y === window.scrollY && scroll.dashboard === document.querySelector('.home-dashboard').scrollTop,
          });
        };
        window.requestAnimationFrame(tick);
      });
      observer.observe(menu, { attributes: true, attributeFilter: ['class'] });
    });
  }, open);
  await action();
  return page.evaluate(() => window.__menuMeasurement);
}

for (const [width, height] of [[320, 568], [375, 667], [390, 844], [1440, 900]]) {
  test(`${width}px history opens and closes within the fast stagger timeline`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (drawerCss.test(new URL(request.url()).pathname)) requests.push(request.url()); });
    await seed(page);
    await stylesReady(page);
    expect(requests).toHaveLength(3); // warmed before the first tap
    const card = page.locator('.home-history-card');
    await card.scrollIntoViewIfNeeded();
    const opening = await measure(page, true, () => card.click());
    expect(opening.layerDelays).toEqual([0, 20, 40]);
    expect(opening.backdropTiming).toEqual({ properties: ['opacity', 'visibility'], durations: [160, 0], delays: [0] });
    expect(Math.max(...opening.timings.flat())).toBeLessThanOrEqual(200.01);
    expect(opening.elapsed).toBeGreaterThanOrEqual(160);
    expect(opening.elapsed).toBeLessThanOrEqual(300); // <=100ms for browser frame scheduling
    expect(opening.moving).toBe(false);
    expect(opening.focused).toBe(true);
    expect(opening.focusMs).toBeLessThanOrEqual(80);
    expect(opening.scrollUnchanged).toBe(true);
    if (width < 700) {
      const toggle = await page.locator('.staggered-menu-toggle').boundingBox();
      expect(toggle.y).toBeCloseTo(16, 0);
      expect(width - toggle.x - toggle.width).toBeCloseTo(16, 0);
      expect(toggle.width).toBe(46);
    }
    const closing = await measure(page, false, () => page.keyboard.press('Escape'));
    expect(closing.layerDelays).toEqual([40, 20, 0]);
    expect(closing.backdropTiming).toEqual({ properties: ['opacity', 'visibility'], durations: [160, 0], delays: [0, 200] });
    expect(Math.max(...closing.timings.flat())).toBeLessThanOrEqual(200.01);
    expect(closing.elapsed).toBeLessThanOrEqual(300);
    expect(closing.moving).toBe(false);
    await expect(page.locator('.staggered-menu-backdrop')).toBeHidden();
    await expect(page.locator('.staggered-menu-panel')).toHaveAttribute('inert', '');

    await card.focus();
    const reopening = await measure(page, true, () => card.press('Enter'));
    expect(reopening.elapsed).toBeLessThanOrEqual(300);
    expect(reopening.focused).toBe(true);
    expect(requests).toHaveLength(3); // no duplicate loading on focus or reopening
    await page.screenshot({ path: testInfo.outputPath(`history-${width}.png`) });

    // Deliberately bypass locator stability waits to exercise interrupted transitions.
    await page.evaluate(async () => {
      const toggle = document.querySelector('.staggered-menu-toggle');
      const card = document.querySelector('.home-history-card');
      for (let i = 0; i < 3; i++) {
        toggle.click();
        await new Promise(resolve => setTimeout(resolve, 25));
        card.click();
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    });
    await expect(page.locator('.staggered-menu')).toHaveClass(/is-open/);
    await expect(page.locator('.staggered-menu-panel')).toBeFocused();
    await expect(page.getByRole('heading', { name: record.eventName, exact: true })).toBeVisible();
    await page.locator('.staggered-menu-toggle').click();
    await expect(page.locator('.staggered-menu-panel')).toHaveAttribute('aria-hidden', 'true');
    expect(errors).toEqual([]);
    await testInfo.attach('menu-timing', { body: JSON.stringify({ opening, closing, reopening }, null, 2), contentType: 'application/json' });
  });
}

test('reduced motion opens immediately with prompt focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seed(page);
  await stylesReady(page);
  const opening = await measure(page, true, () => page.locator('.home-history-card').click());
  expect(Math.max(...opening.timings.flat())).toBeLessThanOrEqual(0.01);
  expect(opening.elapsed).toBeLessThanOrEqual(80);
  expect(opening.focused).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.staggered-menu')).not.toHaveClass(/is-open/);
});

test('cold style downloads are shared and kept separate from animation time', async ({ page }, testInfo) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const requests = [];
  await page.route(drawerCss, async route => {
    requests.push(route.request().url());
    await gate;
    await route.continue();
  });
  await seed(page);
  await expect.poll(() => requests.length).toBe(3);
  await page.locator('.home-history-card').click();
  await expect(page.locator('.staggered-menu')).not.toHaveClass(/is-open/);
  expect(requests).toHaveLength(3);
  const started = Date.now();
  const opening = await measure(page, true, () => release());
  expect(opening.elapsed).toBeLessThanOrEqual(300);
  expect(opening.layerDelays).toEqual([0, 20, 40]);
  await testInfo.attach('cold-style-timing', { body: JSON.stringify({ afterDownloadReleaseMs: Date.now() - started, animationMs: opening.elapsed }), contentType: 'application/json' });
});

test('failed warmup and explicit load recover on the next tap without losing history', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let fail = true;
  let failures = 0;
  await page.route(drawerCss, route => {
    if (fail) { failures++; return route.abort('failed'); }
    return route.continue();
  });
  await seed(page);
  await expect.poll(() => failures).toBeGreaterThanOrEqual(3);
  await page.locator('.home-history-card').click();
  await expect(page.getByRole('alert')).toHaveText('Bill details could not load. Tap the bill to try again.');
  await expect(page.locator('.staggered-menu')).not.toHaveClass(/is-open/);
  await expect(page.locator('.home-history-card')).toHaveCount(1);
  fail = false;
  await page.locator('.home-history-card').click();
  await expect(page.getByRole('heading', { name: record.eventName, exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await stylesReady(page);
  expect(errors).toEqual([]);
});

test('normal-motion history retains backdrop closing, QR sharing, export and editing', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page);
  await stylesReady(page);
  await measure(page, true, () => page.locator('.home-history-card').click());
  await measure(page, false, () => page.locator('.staggered-menu-backdrop').click({ position: { x: 10, y: 10 } }));
  await measure(page, true, () => page.locator('.home-history-card').click());
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download as picture', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Menu-speed-dinner-summary.png');
  await download.saveAs(testInfo.outputPath('history-export.png'));
  await page.getByRole('button', { name: 'Enlarge this bill QR code' }).click();
  await expect(page.getByRole('dialog', { name: 'Bill QR code' })).toBeVisible();
  const shareUrl = new URL(await page.getByRole('link', { name: 'Open bill detail' }).getAttribute('href'));
  await page.getByRole('button', { name: 'Close QR code' }).click();
  await page.getByRole('button', { name: 'Edit this bill' }).click();
  await expect(page.getByRole('dialog', { name: 'People step' })).toContainText(record.eventName);
  await expect(page.locator('.staggered-menu')).not.toHaveClass(/is-open/);
  await page.getByRole('button', { name: 'Continue to bill' }).click();
  await expect(page.getByRole('dialog', { name: 'Bill step' })).toContainText('Pizza');
  await page.goto(`/history${shareUrl.search}`);
  await expect(page.getByRole('heading', { name: record.eventName, exact: true })).toBeVisible();
});
