import { test, expect } from '@playwright/test';
import sharp from 'sharp';

test.use({ isMobile: true, hasTouch: true });
const phones = [
  { width: 320, height: 568, keyboard: 260 },
  { width: 375, height: 667, keyboard: 340 },
  { width: 390, height: 844, keyboard: 430 },
];
const photo = await sharp({ create: { width: 800, height: 1200, channels: 3, background: 'white' } }).png().toBuffer();

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname === '/api/analytics') return route.fulfill({ json: {} });
    if (url.pathname.startsWith('/_vercel/')) return route.fulfill({ contentType: 'application/javascript', body: '' });
    if (url.pathname === '/api/scan-bill') return route.fulfill({ json: { text: '<table><tr><td>ข้าวผัด</td><td>1</td><td>100.00</td></tr></table>' } });
    return route.continue();
  });
});

async function visualKeyboard(page) {
  // Safari-style: only visualViewport shrinks/pans; layout viewport stays full size.
  await page.addInitScript(() => {
    let height, top = 0, scale = 1;
    const viewport = new window.EventTarget();
    Object.defineProperties(viewport, {
      height: { get: () => height ?? window.innerHeight }, width: { get: () => window.innerWidth },
      offsetTop: { get: () => top }, offsetLeft: { get: () => 0 }, scale: { get: () => scale },
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    window.qaPhoneViewport = (nextHeight, nextTop = 0, nextScale = 1) => {
      height = nextHeight; top = nextTop; scale = nextScale;
      viewport.dispatchEvent(new window.Event('resize'));
      viewport.dispatchEvent(new window.Event('scroll'));
    };
  });
}
async function keyboard(page, phone, mode, open, top = 0) {
  if (mode === 'visual') await page.evaluate(({ height, top }) => window.qaPhoneViewport(height, top), { height: open ? phone.keyboard : phone.height, top });
  else await page.setViewportSize({ width: phone.width, height: open ? phone.keyboard : phone.height });
  if (open) await expect(page.locator('body')).toHaveClass(/keyboard-open/);
  else await expect(page.locator('body')).not.toHaveClass(/keyboard-open/);
}
async function inReach(page, locator, insideBody = false) {
  await expect(locator).toBeVisible();
  await expect(async () => {
    const geometry = await locator.evaluate((element, insideBody) => {
      const rect = element.getBoundingClientRect();
      const viewport = window.visualViewport;
      const body = element.closest('.guided-body')?.getBoundingClientRect();
      const top = Math.max(viewport?.offsetTop || 0, insideBody ? body?.top || 0 : 0);
      const bottom = Math.min((viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight), insideBody ? body?.bottom || Infinity : Infinity);
      const center = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { top: rect.top, bottom: rect.bottom, visibleTop: top, visibleBottom: bottom, width: rect.width, covered: !center || !(element === center || element.contains(center)) };
    }, insideBody);
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.visibleTop - 1);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.visibleBottom + 1);
    expect(geometry.width).toBeGreaterThan(40);
    expect(geometry.covered).toBe(false);
  }).toPass({ timeout: 2500 });
}
async function start(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^Split a bill/ }).tap();
  await expect(page.getByLabel('Bill name', { exact: true })).toBeVisible();
}
async function addPeople(page) {
  await page.getByLabel('Bill name', { exact: true }).fill('Phone dinner');
  await page.getByLabel('Bill name', { exact: true }).press('Enter');
  for (const name of ['A', 'B', 'C']) {
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Name', { exact: true }).press('Enter');
  }
  await page.getByRole('button', { name: 'Continue to bill' }).tap();
}

for (const phone of phones) for (const mode of ['layout', 'visual']) {
  test(`${phone.width}px ${mode} keyboard: every bill step keeps current action in reach`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    if (mode === 'visual') await visualKeyboard(page);
    await start(page);
    await keyboard(page, phone, mode, true);
    await inReach(page, page.getByLabel('Bill name', { exact: true }), true);
    await inReach(page, page.getByRole('button', { name: 'Next: add people' }));
    await page.getByLabel('Bill name', { exact: true }).fill('Phone dinner');
    await page.getByLabel('Bill name', { exact: true }).press('Enter');
    for (const name of ['A', 'B', 'C']) {
      await inReach(page, page.getByLabel('Name', { exact: true }), true);
      await inReach(page, page.getByRole('button', { name: 'Add person', exact: true }), true);
      await page.getByLabel('Name', { exact: true }).fill(name);
      await page.getByLabel('Name', { exact: true }).press('Enter');
    }
    await inReach(page, page.getByRole('button', { name: 'Continue to bill' }));
    await page.screenshot({ path: testInfo.outputPath('people-keyboard.png') });
    await page.getByRole('button', { name: 'Continue to bill' }).tap();
    await keyboard(page, phone, mode, false);
    for (const name of ['Take a photo', 'Upload a receipt', 'Type it in']) await inReach(page, page.getByRole('button', { name: new RegExp(name) }), true);
    await page.getByRole('button', { name: /Type it in/ }).tap();
    await keyboard(page, phone, mode, true);
    await inReach(page, page.getByLabel('Item name', { exact: true }), true);
    await page.getByLabel('Item name', { exact: true }).fill('Pizza');
    await page.getByLabel('Item name', { exact: true }).press('Enter');
    await expect(page.getByLabel('Total price')).toBeFocused();
    await inReach(page, page.getByLabel('Total price'), true);
    await page.getByLabel('Total price').fill('10.01');
    await inReach(page, page.getByRole('button', { name: 'Add item', exact: true }).last());
    await inReach(page, page.getByRole('button', { name: 'Add quantity', exact: true }));
    await page.screenshot({ path: testInfo.outputPath('item-keyboard.png') });
    await page.getByRole('button', { name: 'Add quantity', exact: true }).tap();
    await expect(page.getByLabel('Quantity', { exact: true })).toBeFocused();
    await inReach(page, page.getByLabel('Quantity', { exact: true }), true);
    await inReach(page, page.getByRole('button', { name: 'Add item', exact: true }).last());
    await page.getByLabel('Quantity', { exact: true }).fill('2');
    await page.getByLabel('Quantity', { exact: true }).press('Enter');
    await expect(page.locator('.guided-footer-total')).toContainText('1 item');
    await page.getByLabel('Item name', { exact: true }).fill('Tea');
    await page.getByLabel('Item name', { exact: true }).press('Enter');
    await page.getByLabel('Total price').fill('5.99');
    await inReach(page, page.getByRole('button', { name: 'Add item', exact: true }).last());
    await page.getByRole('button', { name: 'Add item', exact: true }).last().tap();
    await inReach(page, page.getByRole('button', { name: 'Continue to sharing' }));
    await inReach(page, page.getByRole('button', { name: 'Hide keyboard' }));
    await page.getByRole('button', { name: 'Hide keyboard' }).tap();
    // Blur must not expand/reposition the action while the keyboard animates closed.
    await expect(page.locator('body')).toHaveClass(/keyboard-open/);
    await keyboard(page, phone, mode, false);
    await inReach(page, page.getByRole('button', { name: 'Edit Pizza', exact: true }), true);
    await page.getByRole('button', { name: 'Edit Pizza', exact: true }).tap();
    await keyboard(page, phone, mode, true, mode === 'visual' ? 24 : 0);
    await inReach(page, page.locator('.guided-item-editor').getByLabel('Item name', { exact: true }), true);
    await page.locator('.guided-item-editor').getByLabel('Item name', { exact: true }).press('Enter');
    await page.getByLabel('Line total').fill('12.01');
    await page.getByLabel('Line total').press('Enter');
    await expect(page.getByLabel('Quantity', { exact: true })).toBeFocused();
    await inReach(page, page.getByRole('button', { name: 'Done', exact: true }));
    await page.getByLabel('Quantity', { exact: true }).press('Enter');
    await keyboard(page, phone, mode, false);
    await inReach(page, page.getByRole('button', { name: 'Bill options', exact: true }), true);
    await page.getByRole('button', { name: 'Bill options', exact: true }).tap();
    await page.getByLabel('Add VAT', { exact: true }).check();
    await page.getByLabel('VAT percentage').focus();
    await keyboard(page, phone, mode, true);
    await inReach(page, page.getByLabel('VAT percentage'), true);
    await inReach(page, page.getByRole('button', { name: 'Continue to sharing' }));
    await page.getByLabel('VAT percentage').fill('7');
    await page.getByLabel('VAT percentage').press('Enter');
    await keyboard(page, phone, mode, false);
    await page.getByLabel('Add discount', { exact: true }).check();
    await page.getByLabel('Discount in baht').focus();
    await keyboard(page, phone, mode, true);
    await inReach(page, page.getByLabel('Discount in baht'), true);
    await page.getByLabel('Discount in baht').fill('1');
    await inReach(page, page.getByRole('button', { name: 'Continue to sharing' }));
    await page.screenshot({ path: testInfo.outputPath('options-keyboard.png') });
    await page.getByRole('button', { name: 'Continue to sharing' }).tap();
    await keyboard(page, phone, mode, false);
    await inReach(page, page.getByRole('button', { name: 'Select all', exact: true }), true);
    for (const option of await page.locator('.guided-split-option').all()) await inReach(page, option, true);
    await page.getByRole('button', { name: 'Select all', exact: true }).tap();
    await inReach(page, page.getByRole('button', { name: 'Next item', exact: true }));
    await page.screenshot({ path: testInfo.outputPath('sharing.png') });
    await page.getByRole('button', { name: 'Next item', exact: true }).tap();
    await page.getByRole('button', { name: 'Select all', exact: true }).tap();
    await page.getByRole('button', { name: 'See the split' }).tap();
    await expect(page.getByText('Each person owes', { exact: true })).toBeVisible();
    for (const row of await page.locator('.guided-result-list .guided-list-row').all()) await inReach(page, row, true);
    await inReach(page, page.getByRole('button', { name: 'Download picture' }));
    await inReach(page, page.getByRole('button', { name: 'Done', exact: true }));
    await page.screenshot({ path: testInfo.outputPath('summary.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

for (const phone of phones) {
  test(`${phone.width}px receipt crop and scan review actions fit the phone`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await start(page); await addPeople(page);
    await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: photo });
    await expect(page.getByRole('button', { name: 'Confirm photo' })).toBeEnabled();
    for (const name of ['Back to bill', 'Choose again', 'Confirm photo']) await inReach(page, page.getByRole('button', { name: new RegExp(name) }));
    await page.screenshot({ path: testInfo.outputPath('crop.png') });
    await page.getByRole('button', { name: 'Confirm photo' }).tap();
    await expect(page.getByText('ข้าวผัด', { exact: true })).toBeVisible();
    await inReach(page, page.getByRole('button', { name: 'Continue to sharing' }));
    await inReach(page, page.getByRole('button', { name: 'Edit ข้าวผัด' }), true);
  });
}

test('many people and phone rotation keep entry and next action reachable', async ({ page }) => {
  const phone = phones[1];
  await page.setViewportSize(phone); await visualKeyboard(page); await start(page);
  await page.getByLabel('Bill name', { exact: true }).press('Enter');
  for (let index = 0; index < 20; index++) {
    await page.getByLabel('Name', { exact: true }).fill(`Friend ${index}`);
    await page.getByLabel('Name', { exact: true }).press('Enter');
  }
  await keyboard(page, phone, 'visual', true);
  await inReach(page, page.getByLabel('Name', { exact: true }), true);
  await inReach(page, page.getByRole('button', { name: 'Continue to bill' }));
  await keyboard(page, phone, 'visual', false);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => window.qaPhoneViewport(390));
  await inReach(page, page.getByRole('button', { name: 'Continue to bill' }));
  await page.getByRole('button', { name: 'Continue to bill' }).tap();
  await inReach(page, page.getByRole('button', { name: /Type it in/ }), true);
});
test('duplicate-name recovery stays visible above a small phone keyboard', async ({ page }) => {
  const phone = phones[0];
  await page.setViewportSize({ width: phone.width, height: phone.height });
  await visualKeyboard(page); await start(page);
  await page.getByLabel('Bill name', { exact: true }).press('Enter');
  await keyboard(page, phone, 'visual', true);
  for (const name of ['A', 'B', 'A']) {
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Name', { exact: true }).press('Enter');
  }
  await expect(page.getByRole('alert')).toContainText('already in the list');
  await inReach(page, page.getByRole('alert'));
  await inReach(page, page.getByLabel('Name', { exact: true }), true);
  await inReach(page, page.getByRole('button', { name: 'Continue to bill' }));
  await page.getByLabel('Name', { exact: true }).fill('C');
  await page.getByLabel('Name', { exact: true }).press('Enter');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
