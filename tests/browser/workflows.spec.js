import { test, expect, chromium } from '@playwright/test';
import sharp from 'sharp';
import { gzipSync, strToU8 } from 'fflate';
import AxeBuilder from '@axe-core/playwright';

const receipt = await sharp({ create: { width: 800, height: 1200, channels: 3, background: 'white' } }).png().toBuffer();
const ocrTable = '<table><tr><th>item</th><th>quantity</th><th>total price</th></tr><tr><td>ข้าวผัด</td><td>2</td><td>120.50</td></tr></table>';
export const record = {
  id: 'qa-fixture', eventName: 'QA dinner', friends: ['A', 'B', 'C'],
  billItems: [{ name: 'Pizza', quantity: 1, amount: 100 }], allocations: [['A', 'B', 'C']],
  settlements: [{ name: 'A', amount: 33.34 }, { name: 'B', amount: 33.33 }, { name: 'C', amount: 33.33 }],
  subtotal: 100, vatEnabled: false, vatRate: 7, vatAmount: 0,
  discountEnabled: false, discountAmount: 0, total: 100, createdAt: 1700000000000, updatedAt: 1700000000000,
};
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.pathname.startsWith('/_vercel/')) return route.fulfill({ contentType: 'application/javascript', body: '' });
    if (url.pathname === '/api/analytics') return route.fulfill({ status: 200, headers: { 'Set-Cookie': 'harn_analytics_visitor=3f0d3e9a-9d2a-4dc1-9b32-57b5fc93f9b2; Path=/; SameSite=Lax' }, json: { recorded: true } });
    if (url.pathname === '/api/analytics-bills') return route.fulfill({ status: 202, json: { recorded: true } });
    if (url.pathname === '/api/analytics-revoke') return route.fulfill({ status: 204 });
    if (url.pathname === '/api/admin-bills') return route.fulfill({ json: { bills: [], nextCursor: null } });
    if (url.pathname === '/api/operations') return route.fulfill({ status: 201, json: { message: 'Operation received.' } });
    return route.continue();
  });
});
async function home(page, { consent = 'reject' } = {}) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Split a bill/ })).toBeVisible();
  if (consent && await page.getByRole('button', { name: 'Reject analytics', exact: true }).count()) {
    await page.getByRole('button', { name: 'Reject analytics', exact: true }).click();
  }
}
async function people(page, names = ['A', 'B']) {
  await home(page);
  await page.getByRole('button', { name: /^Split a bill/ }).click();
  await page.getByLabel('Bill name', { exact: true }).fill('QA dinner');
  await page.getByRole('button', { name: 'Next: add people' }).click();
  for (const name of names) {
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Add person', exact: true }).click();
  }
}
async function bill(page, names) {
  await people(page, names);
  await page.getByRole('button', { name: 'Continue to bill' }).click();
}
async function addItem(page, name = 'Pizza', price = '100') {
  if (await page.getByRole('button', { name: /Type it in/ }).count()) await page.getByRole('button', { name: /Type it in/ }).click();
  if (!(await page.getByLabel('Item name', { exact: true }).count())) await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByLabel('Item name', { exact: true }).fill(name);
  await page.getByLabel('Total price', { exact: true }).fill(price);
  await page.getByRole('button', { name: 'Add item', exact: true }).last().click();
}
async function finish(page) {
  await page.getByRole('button', { name: 'Continue to sharing' }).click();
  if (await page.getByRole('button', { name: 'Select all', exact: true }).count()) await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('button', { name: 'See the split' }).click();
  await expect(page.getByText('Each person owes', { exact: true })).toBeVisible();
}
async function seed(page, records = [record]) {
  await home(page);
  await page.evaluate(async records => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('harn-kun-history', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('operations', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('operations', 'readwrite');
      records.forEach(record => tx.objectStore('operations').put(record));
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, records);
  await page.reload();
}
async function crop(page, file = { name: 'receipt.png', mimeType: 'image/png', buffer: receipt }) {
  await page.locator('input[type=file]').nth(1).setInputFiles(file);
  await expect(page.getByRole('button', { name: 'Confirm photo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Confirm photo' }).click();
}
async function noOverflow(page) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth, dialog: document.querySelector('.guided-flow') ? { client: document.querySelector('.guided-flow').clientWidth, scroll: document.querySelector('.guided-flow').scrollWidth } : null }));
  expect(sizes.html).toBeLessThanOrEqual(sizes.width + 1);
  expect(sizes.body).toBeLessThanOrEqual(sizes.width + 1);
  if (sizes.dialog) expect(sizes.dialog.scroll).toBeLessThanOrEqual(sizes.dialog.client + 1);
}

test('analytics stays off until accepted; accepting records only a saved bill summary', async ({ page }) => {
  const analyticsRequests = [];
  page.on('request', request => {
    if (/\/api\/(analytics|analytics-bills)(\?|$)/.test(request.url())) analyticsRequests.push(request);
  });
  await home(page, { consent: null });
  await expect(page.getByRole('region', { name: 'Choose optional analytics' })).toBeVisible();
  expect(analyticsRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'Accept analytics' }).click();
  await bill(page);
  await addItem(page, 'Pad Thai', '120.50');
  const billRequest = page.waitForRequest(request => request.url().endsWith('/api/analytics-bills'));
  await finish(page);
  const sent = JSON.parse((await billRequest).postData());
  expect(Object.keys(sent).sort()).toEqual(['historyId', 'items', 'participantCount', 'total']);
  expect(sent).toMatchObject({ participantCount: 2, total: 120.5, items: [{ name: 'Pad Thai', amount: 120.5 }] });
  expect(sent.historyId).toBeTruthy();
  expect(JSON.stringify(sent)).not.toMatch(/Alice|Bob|friends|allocations|device|user.?agent/i);
  await expect(page.getByRole('button', { name: 'Cookie settings' })).toBeVisible();
});

test('rejecting analytics keeps local bill splitting and history working without tracking', async ({ page }) => {
  const tracked = [];
  page.on('request', request => {
    if (/\/api\/(analytics|analytics-bills)(\?|$)/.test(request.url())) tracked.push(request.url());
  });
  await home(page, { consent: null });
  await page.getByRole('button', { name: 'Reject analytics' }).click();
  await bill(page);
  await addItem(page, 'Noodles', '80');
  await finish(page);
  await expect(page.getByText('Each person owes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.home-history-card')).toHaveCount(1);
  expect(tracked).toEqual([]);
  await page.getByRole('button', { name: 'Cookie settings' }).click();
  await expect(page.getByRole('button', { name: 'Accept analytics' })).toBeVisible();
});

test('accepting analytics never backfills bills already in local history', async ({ page }) => {
  const billRequests = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/analytics-bills')) billRequests.push(request);
  });
  await home(page, { consent: null });
  await page.evaluate(async existingRecord => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('harn-kun-history', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('operations', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('operations', 'readwrite');
      tx.objectStore('operations').put(existingRecord);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, record);
  await page.reload();
  await expect(page.locator('.home-history-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Accept analytics' }).click();
  await page.waitForTimeout(250);
  expect(billRequests).toHaveLength(0);
  await expect(page.locator('.home-history-card')).toHaveCount(1);
});

test('Thai static page shows Thai consent and waits for acceptance before visit tracking', async ({ page }) => {
  const tracked = [];
  page.on('request', request => { if (request.url().endsWith('/api/analytics')) tracked.push(request.url()); });
  await page.goto('/th/');
  await expect(page.getByRole('region', { name: 'คุณเลือกการวิเคราะห์ข้อมูลได้' })).toBeVisible();
  expect(tracked).toEqual([]);
  await page.getByRole('button', { name: 'ยอมรับการวิเคราะห์' }).click();
  await expect.poll(() => tracked.length).toBeGreaterThan(0);
});

for (const width of [320, 375, 390, 768, 1440]) {
  test(`${width}px full manual workflow, screenshot, persistence and QR`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await bill(page, ['A', 'B', 'C']);
    await addItem(page, 'Pizza', '100');
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`bill-${width}.png`) });
    await finish(page);
    await expect(page.locator('.guided-result-list')).toContainText('33.34');
    await expect(page.locator('.guided-result-list')).toContainText('33.33');
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`summary-${width}.png`) });
    if (width === 390) {
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download picture' }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('QA-dinner-summary.png');
      await download.saveAs(testInfo.outputPath('summary-export.png'));
    }
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Summary step' })).toHaveCount(0);
    await page.reload();
    await page.locator('.home-history-card').click();
    await expect(page.getByRole('button', { name: 'Edit this bill' })).toBeVisible();
    await page.getByRole('button', { name: 'Enlarge this bill QR code' }).click();
    await expect(page.getByRole('dialog', { name: 'Bill QR code' })).toBeVisible();
    const href = await page.getByRole('link', { name: 'Open bill detail' }).getAttribute('href');
    const url = new URL(href);
    await page.goto(`/history${url.search}`);
    await expect(page.getByRole('heading', { name: 'QA dinner' })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`shared-${width}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}
test('people validation, duplicate names, one-person boundary and remove', async ({ page }) => {
  await people(page, ['A']);
  await expect(page.getByRole('button', { name: 'Add 1 more' })).toBeDisabled();
  await page.getByLabel('Name', { exact: true }).fill('a');
  await page.getByRole('button', { name: 'Add person', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('already in the list');
  await page.getByLabel('Name', { exact: true }).fill('B');
  await page.getByRole('button', { name: 'Add person', exact: true }).click();
  await page.getByRole('button', { name: 'Remove A', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add 1 more' })).toBeDisabled();
  await page.getByLabel('Name', { exact: true }).fill(' ');
  await expect(page.getByRole('button', { name: 'Add person', exact: true })).toBeDisabled();
});
test('100 person limit via UI', async ({ page }) => {
  test.setTimeout(90_000);
  await people(page, Array.from({ length: 100 }, (_, i) => `P${i}`));
  await expect(page.getByLabel('Name', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Continue to bill' })).toBeEnabled();
});
test('unfinished draft resumes after closing and refreshing', async ({ page }) => {
  await people(page);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByLabel('Bill name', { exact: true }).fill('  ');
  await expect(page.getByRole('button', { name: 'Next: add people' })).toBeDisabled();
  await page.getByLabel('Bill name', { exact: true }).fill('Draft name');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /^Continue your bill/ }).click();
  await expect(page.getByLabel('Bill name', { exact: true })).toHaveValue('Draft name');
  await page.reload();
  await page.getByRole('button', { name: /^Continue your bill/ }).click();
  await expect(page.getByLabel('Bill name', { exact: true })).toHaveValue('Draft name');
});
test('F5 restores a split in progress and its selected people', async ({ page }) => {
  await bill(page, ['A', 'B', 'C']);
  await addItem(page, 'Noodles', '100');
  await page.getByRole('button', { name: 'Continue to sharing' }).click();
  await page.getByRole('button', { name: /^A/ }).click();
  await expect(page.getByRole('button', { name: /^A/ })).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await page.getByRole('button', { name: /^Continue your bill/ }).click();
  await expect(page.getByText('Who had this?', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^A/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'B', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'See the split' }).click();
  await expect(page.getByText('Each person owes', { exact: true })).toBeVisible();
});
test('manual zero, duplicate, quantity, edit, delete and VAT/discount workflow', async ({ page }) => {
  await bill(page);
  await addItem(page, 'Pizza', '100');
  await addItem(page, 'Pizza', '0');
  await page.getByRole('button', { name: 'Edit Pizza', exact: true }).first().click();
  await page.getByLabel('Line total').fill('100.50');
  await page.getByLabel('Quantity', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Pizza', exact: true }).last().click();
  await page.getByRole('button', { name: 'Bill options', exact: true }).click();
  await page.getByLabel('Add VAT', { exact: true }).check();
  await page.getByLabel('Add discount', { exact: true }).check();
  await page.getByLabel('Discount in baht').fill('7.035');
  await finish(page);
  await expect(page.locator('.guided-result-list')).toContainText('50.25');
});
test('subset assignment, previous item, select and clear all; no bill upload to logging endpoint', async ({ page }) => {
  let operationCalls = 0;
  page.on('request', request => { if (request.url().includes('/api/operations')) operationCalls++; });
  await bill(page, ['A', 'B', 'C']);
  await addItem(page, 'Pizza', '100'); await addItem(page, 'Drink', '20');
  await page.getByRole('button', { name: 'Continue to sharing' }).click();
  await expect(page.getByRole('button', { name: 'Next item' })).toBeDisabled();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await page.locator('.guided-split-option').filter({ hasText: 'A' }).click();
  await page.getByRole('button', { name: 'Next item' }).click();
  await page.getByRole('button', { name: 'Previous item' }).click();
  await expect(page.locator('.guided-split-option').first()).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Next item' }).click();
  await page.locator('.guided-split-option').filter({ hasText: 'B' }).click();
  await page.getByRole('button', { name: 'See the split' }).click();
  await expect(page.locator('.guided-result-list')).toContainText('100.00');
  await expect(page.locator('.guided-result-list')).toContainText('20.00');
  expect(operationCalls).toBe(0);
});
test('history old-schema fixture, sort, edit same ID, cancel and confirm clear', async ({ page }) => {
  await seed(page, [record, { ...record, id: 'second', eventName: 'Cheaper', total: 20, updatedAt: 1700000010000 }]);
  await page.getByRole('button', { name: 'Sort recent bills', exact: true }).click();
  await page.getByRole('option', { name: 'Lowest total' }).click();
  await expect(page.locator('.home-history-card').first()).toContainText('Cheaper');
  await page.locator('.home-history-card').filter({ hasText: 'QA dinner' }).click();
  await page.getByRole('button', { name: 'Edit this bill' }).click();
  await page.getByRole('button', { name: 'Continue to bill' }).click();
  await finish(page);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.home-history-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear history', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.home-history-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear history', exact: true }).click();
  await page.getByRole('button', { name: 'Remove all bills', exact: true }).click();
  await page.reload();
  await expect(page.locator('.home-history-card')).toHaveCount(0);
});
test('legacy and compressed shared links render text safely; invalid links recover with back/forward', async ({ page }) => {
  const compact = { v: 1, n: '<img src=x onerror=window.qaXss=1>', f: ['A', 'B'], i: [['ข้าว', 1, 20, [0, 1]]], s: [10, 10], a: [0, 0], d: 1700000000000 };
  for (const compressed of [false, true]) {
    const bytes = compressed ? gzipSync(strToU8(JSON.stringify(compact))) : Buffer.from(JSON.stringify(compact));
    const value = `${compressed ? 'z' : ''}${Buffer.from(bytes).toString('base64url')}`;
    await page.goto(`/history?r=${value}`);
    await expect(page.getByRole('heading', { name: compact.n })).toBeVisible();
    expect(await page.evaluate(() => window.qaXss)).toBeUndefined();
    await expect(page.getByText('ข้าว', { exact: true })).toBeVisible();
  }
  await page.goto('/history?r=broken');
  await expect(page.getByRole('alert')).toContainText('invalid or incomplete');
  await page.goto('/history');
  await expect(page.getByRole('alert')).toContainText('missing');
  await page.goBack(); await page.goForward();
  await expect(page.getByRole('alert')).toContainText('missing');
});
test('mock Thai OCR, crop aspect, receipt preview, cooldown and manual fallback', async ({ page }) => {
  await page.route('**/api/scan-bill', route => route.fulfill({ json: { text: ocrTable, tsv: '' } }));
  await bill(page);
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'thai.png', mimeType: 'image/png', buffer: receipt });
  await page.getByRole('button', { name: 'Switch crop frame to 9 by 16 portrait' }).click();
  await page.getByRole('button', { name: 'Confirm photo' }).click();
  await expect(page.getByText('ข้าวผัด', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^\d+s$/ })).toBeDisabled();
  await page.getByRole('button', { name: 'View receipt photo' }).click();
  await expect(page.getByRole('dialog', { name: 'Bill photo preview' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Bill photo preview' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await addItem(page, 'Tea', '10');
  await expect(page.getByText('Tea', { exact: true })).toBeVisible();
});
for (const failure of ['empty', '429', '500', 'network', 'timeout']) {
  test(`mock OCR ${failure} permits manual recovery`, async ({ page }) => {
    await page.route('**/api/scan-bill', route => {
      if (failure === 'network' || failure === 'timeout') return route.abort(failure === 'timeout' ? 'timedout' : 'failed');
      return route.fulfill({ status: failure === 'empty' ? 200 : Number(failure), json: failure === 'empty' ? { text: 'not a receipt' } : { message: 'Scan unavailable', retryAfter: 30 } });
    });
    await bill(page); await crop(page);
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: /Type it in/ }).click();
    await addItem(page, 'Manual fallback', '10');
    await finish(page);
    await expect(page.getByText('Each person owes', { exact: true })).toBeVisible();
  });
}
test('storage disabled does not crash home and browsers are isolated', async ({ page, browser }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'QuotaExceededError'); }; });
  await seed(page);
  await expect(page.locator('.home-history-card')).toHaveCount(1);
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await other.route('**/api/analytics', route => route.fulfill({ json: {} }));
  await other.goto('http://127.0.0.1:4174');
  await expect(other.locator('.home-history-card')).toHaveCount(0);
  await otherContext.close();
});
test('mock admin login, dashboard, refresh, session expiry and logout', async ({ page }) => {
  let signedIn = false, calls = 0;
  await page.route('**/api/admin-dashboard', route => { calls++; return route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? { onlineNow: 2, visitorsToday: 3, visitDays: 4, completedBills: 5, totalSpend: 100, onlineWindowMinutes: 2, history: [{ day: '2026-10-25', visitors: 3, bills: 2, spend: 100 }] } : { message: 'Authentication required.' } }); });
  await page.route('**/api/admin-login', route => { signedIn = true; return route.fulfill({ json: { authenticated: true } }); });
  await page.route('**/api/admin-logout', route => { signedIn = false; return route.fulfill({ json: {} }); });
  await page.route('**/api/admin-bills**', route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    return route.fulfill({ json: cursor
      ? { bills: [{ historyId: 'local-2', updatedAt: '2026-10-24T01:00:00.000Z', total: 44, participantCount: 2, items: [{ name: 'Iced tea', amount: 44 }], deviceType: 'desktop', browser: 'Chrome', visitorId: 'Browser zyx98765' }], nextCursor: null }
      : { bills: [{ historyId: 'local-1', updatedAt: '2026-10-25T01:00:00.000Z', total: 120.5, participantCount: 3, items: [{ name: 'Pad Thai', amount: 120.5 }], deviceType: 'mobile', browser: 'Safari', visitorId: 'Browser abc12345' }], nextCursor: 'next-page' } });
  });
  await page.goto('/admin');
  await page.getByLabel('Admin password').fill('dummy');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Usage dashboard' })).toBeVisible();
  const savedBill = page.locator('.admin-bill-row');
  await expect(savedBill).toContainText('Pad Thai');
  await expect(savedBill).toContainText('mobile · Safari');
  await page.getByRole('button', { name: 'Load more bills' }).click();
  await expect(page.locator('.admin-bill-row')).toHaveCount(2);
  await expect(page.locator('.admin-bill-row').nth(1)).toContainText('Iced tea');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  expect(calls).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Admin sign in' })).toBeVisible();
});

// Confirmed audit findings, repaired after explicit user approval.
test('regression: displayed VAT total agrees with final settlement sum', async ({ page }) => {
  await bill(page); await addItem(page, 'Small item', '2.50');
  await page.getByRole('button', { name: 'Bill options', exact: true }).click();
  await page.getByLabel('Add VAT', { exact: true }).check();
  await finish(page);
  const displayed = Number((await page.locator('.guided-summary .guided-total strong').innerText()).replace('฿', ''));
  const paid = await page.locator('.guided-result-list b').allTextContents();
  expect(paid.reduce((sum, value) => sum + Math.round(Number(value.replace('฿', '')) * 100), 0)).toBe(Math.round(displayed * 100));
});
test('regression: failed replacement OCR retains previous bill items', async ({ page }) => {
  await page.clock.install();
  let scans = 0;
  await page.route('**/api/scan-bill', route => { scans++; return route.fulfill({ status: scans === 1 ? 200 : 503, json: scans === 1 ? { text: ocrTable } : { message: 'Unavailable' } }); });
  await bill(page); await crop(page);
  await expect(page.getByText('ข้าวผัด', { exact: true })).toBeVisible();
  await page.clock.runFor(31_000);
  await crop(page);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('ข้าวผัด', { exact: true })).toBeVisible({ timeout: 1500 });
});
test('regression: history save failure is visible to user and retry recovers', async ({ page }) => {
  await bill(page); await addItem(page);
  await page.evaluate(() => { window.qaOriginalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = () => { throw new DOMException('Full', 'QuotaExceededError'); }; });
  await finish(page);
  await expect(page.getByRole('alert')).toContainText(/save|storage/i, { timeout: 1500 });
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.qaOriginalPut; });
  await page.getByRole('button', { name: 'Retry saving' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.home-history-card')).toHaveCount(1);
});
test('regression: corrupt stored record does not blank app', async ({ page }) => {
  await seed(page, [{ id: 'corrupt', updatedAt: 1700000000000 }]);
  await expect(page.getByRole('button', { name: /^Split a bill/ })).toBeVisible({ timeout: 1500 });
  await expect(page.getByRole('alert')).toContainText('Their data has been kept');
});
test('regression: another tab updates existing history without refresh', async ({ page, context }) => {
  await seed(page);
  const other = await context.newPage();
  await other.route('**/api/analytics', route => route.fulfill({ json: {} }));
  await bill(other); await addItem(other); await finish(other);
  await page.bringToFront();
  await expect(page.locator('.home-history-card')).toHaveCount(2, { timeout: 1500 });
});
test('regression: edited negative price is blocked before sharing', async ({ page }) => {
  await bill(page); await addItem(page);
  await page.getByRole('button', { name: 'Edit Pizza', exact: true }).click();
  await page.getByLabel('Line total').fill('-100');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to sharing' }).click();
  await expect(page.getByRole('dialog', { name: 'Bill step' })).toBeVisible({ timeout: 1500 });
});
test('regression: invalid image decode leaves crop dialog with recovery message', async ({ page }) => {
  await bill(page);
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('alert')).toContainText(/photo|image/i, { timeout: 1500 });
});
test('regression: keyboard zoom is not cancelled', async ({ page }) => {
  await home(page);
  const prevented = await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(page.locator('meta[name=viewport]')).not.toHaveAttribute('content', /user-scalable=no|maximum-scale=1/);
});
test('stale edits cannot overwrite a newer save in another tab', async ({ page, context }) => {
  await seed(page);
  await page.locator('.home-history-card').click();
  await page.getByRole('button', { name: 'Edit this bill' }).click();
  await page.getByRole('button', { name: 'Continue to bill' }).click();
  const other = await context.newPage();
  await other.route('**/api/analytics', route => route.fulfill({ json: {} }));
  await other.goto('/');
  await other.locator('.home-history-card').click();
  await other.getByRole('button', { name: 'Edit this bill' }).click();
  await other.getByRole('button', { name: 'Continue to bill' }).click();
  await finish(other);
  await finish(page);
  await expect(page.getByRole('alert')).toContainText('changed in another tab');
});
test('shared gzip size and invalid structured payloads fail safely', async ({ page }) => {
  const oversized = gzipSync(strToU8('x'.repeat(300_000)));
  for (const value of [`z${Buffer.from(oversized).toString('base64url')}`, Buffer.from(JSON.stringify({ v: 1, n: 'Bad', f: ['A', 'B'], i: [null] })).toString('base64url')]) {
    await page.goto(`/history?r=${value}`);
    await expect(page.getByRole('alert')).toContainText('invalid or incomplete');
  }
});
test('modal traps keyboard focus, closes on Escape; axe detects no serious/critical violations', async ({ page }, testInfo) => {
  await bill(page); await addItem(page);
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.querySelector('.guided-flow').contains(document.activeElement))).toBe(true);
  }
  const analysis = await new AxeBuilder({ page }).analyze();
  await testInfo.attach('accessibility.json', { body: JSON.stringify(analysis.violations, null, 2), contentType: 'application/json' });
  expect(analysis.violations.filter(issue => ['serious', 'critical'].includes(issue.impact)).map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) }))).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Bill step' })).toHaveCount(0);
});
test('admin failed logout stays visible and reports active session', async ({ page }) => {
  await page.route('**/api/admin-dashboard', route => route.fulfill({ json: { onlineNow: 0, visitorsToday: 0, visitDays: 0, completedBills: 0, totalSpend: 0, onlineWindowMinutes: 2, history: [] } }));
  await page.route('**/api/admin-logout', route => route.abort());
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Usage dashboard' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('session may still be active');
});
test('offline manual completion and online status recovery', async ({ page, context }) => {
  await bill(page); await addItem(page);
  await context.setOffline(true);
  await expect(page.getByRole('status')).toContainText('offline');
  await finish(page);
  await context.setOffline(false);
  await expect(page.getByRole('status')).toContainText('Back online');
});
test('isolated browser close/reopen retains completed bills; clearing fixture storage recovers', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium');
  const profile = testInfo.outputPath('isolated-browser-profile');
  const options = { headless: true, reducedMotion: 'reduce', ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}) };
  let context = await chromium.launchPersistentContext(profile, options);
  try {
    const page = context.pages()[0];
    await page.route('**/api/analytics', route => route.fulfill({ json: {} }));
    await page.goto('http://127.0.0.1:4174');
    await page.evaluate(async record => {
      const db = await new Promise(resolve => { const req = indexedDB.open('harn-kun-history', 1); req.onsuccess = () => resolve(req.result); });
      await new Promise(resolve => { const tx = db.transaction('operations', 'readwrite'); tx.objectStore('operations').put(record); tx.oncomplete = resolve; });
      db.close();
    }, record);
    await context.close();
    context = await chromium.launchPersistentContext(profile, options);
    const reopened = context.pages()[0];
    await reopened.route('**/api/analytics', route => route.fulfill({ json: {} }));
    await reopened.goto('http://127.0.0.1:4174');
    await expect(reopened.locator('.home-history-card')).toHaveCount(1);
    await reopened.evaluate(() => new Promise((resolve, reject) => { const req = indexedDB.deleteDatabase('harn-kun-history'); req.onsuccess = resolve; req.onerror = () => reject(req.error); }));
    await reopened.reload();
    await expect(reopened.locator('.home-history-card')).toHaveCount(0);
  } finally { await context.close(); }
});
test('home, shared receipt and admin login accessibility scan', async ({ page }, testInfo) => {
  const compact = { v: 1, n: 'Accessibility fixture', f: ['A', 'B'], i: [['Tea', 1, 20, [0, 1]]], s: [10, 10], a: [0, 0], d: 1700000000000 };
  await page.route('**/api/admin-dashboard', route => route.fulfill({ status: 401, json: { message: 'Authentication required.' } }));
  for (const [name, path] of [['home', '/'], ['shared', `/history?r=${Buffer.from(JSON.stringify(compact)).toString('base64url')}`], ['admin', '/admin']]) {
    await page.goto(path);
    if (name === 'shared') await expect(page.getByRole('heading', { name: compact.n })).toBeVisible();
    if (name === 'admin') await expect(page.getByLabel('Admin password')).toBeVisible();
    const analysis = await new AxeBuilder({ page }).analyze();
    await testInfo.attach(`${name}-accessibility.json`, { body: JSON.stringify(analysis.violations, null, 2), contentType: 'application/json' });
    expect(analysis.violations.filter(issue => ['serious', 'critical'].includes(issue.impact)).map(issue => ({ page: name, id: issue.id, nodes: issue.nodes.map(node => node.target) }))).toEqual([]);
  }
});
test('history four sort modes and swipe-and-hold deletion cancel/complete', async ({ page }) => {
  await seed(page, [record, { ...record, id: 'second', eventName: 'New low', total: 20, updatedAt: record.updatedAt + 1000 }]);
  for (const [sort, expected] of [['Oldest', 'QA dinner'], ['Highest total', 'QA dinner'], ['Lowest total', 'New low'], ['Newest', 'New low']]) {
    await page.getByRole('button', { name: 'Sort recent bills', exact: true }).click();
    await page.getByRole('option', { name: sort, exact: true }).click();
    await expect(page.locator('.home-history-card').first()).toContainText(expected);
  }
  const card = page.locator('.home-history-card').first();
  await card.scrollIntoViewIfNeeded();
  const rect = await card.boundingBox();
  await page.mouse.move(rect.x + rect.width - 20, rect.y + rect.height / 2);
  await page.mouse.down(); await page.mouse.move(rect.x + rect.width - 120, rect.y + rect.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.home-history-card')).toHaveCount(2);
  await page.mouse.move(rect.x + rect.width - 20, rect.y + rect.height / 2);
  await page.mouse.down(); await page.mouse.move(rect.x + rect.width - 120, rect.y + rect.height / 2, { steps: 10 });
  await page.waitForTimeout(1250);
  await page.mouse.up();
  await expect(page.locator('.home-history-card')).toHaveCount(1);
  await page.reload(); await expect(page.locator('.home-history-card')).toHaveCount(1);
});
