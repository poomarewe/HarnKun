import test from 'node:test';
import assert from 'node:assert/strict';
import { settlementsFor, plainOcr } from './helpers/source-functions.js';
import { createAdminSession, hasValidAdminSession, verifyAdminPassword, adminSessionCookie, isSameOriginRequest } from '../lib/admin-auth.js';
import { readVisitorId, visitorCookie } from '../lib/visitor-cookie.js';
import operations from '../api/operations.js';
import logout from '../api/admin-logout.js';
import { getBillTotals, isValidMoney, itemShare, toSatang } from '../src/money.js';
import { isHistoryRecord } from '../src/history-store.js';
import { BILL_DRAFT_STORAGE_KEY, clearBillDraft, readBillDraft, saveBillDraft } from '../src/draft-store.js';

process.env.ADMIN_PASSWORD = 'test-password-only';
process.env.ADMIN_SESSION_SECRET = 'synthetic-secret-for-local-tests-only-12345';
delete process.env.DATABASE_URL;

test('100 baht / 3 conserves satang with deterministic remainder', () => {
  const result = settlementsFor({ friends: ['A', 'B', 'C'], billItems: [{ amount: 100 }], allocations: [['A', 'B', 'C']], total: 100 });
  assert.deepEqual(result.map(x => x.amount), [33.34, 33.33, 33.33]);
});
test('unequal item subsets + VAT/discount and reserved object-key names', () => {
  const result = settlementsFor({ friends: ['__proto__', 'constructor', 'C'], billItems: [{ amount: 100 }, { amount: 20 }], allocations: [['__proto__', 'constructor'], ['C']], total: 118.4 });
  assert.equal(result.reduce((s, x) => s + Math.round(x.amount * 100), 0), 11840);
  assert.ok(result.every(x => Number.isFinite(x.amount) && x.amount >= 0));
});
test('complex shared items settle accurately after VAT and discount rounding', () => {
  const friends = ['Ana', 'Bo', 'Chai', 'Dee'];
  const billItems = [{ amount: 101 }, { amount: 25.05 }, { amount: 15 }];
  const allocations = [['Ana', 'Bo', 'Chai'], ['Bo', 'Dee'], ['Dee']];
  const totals = getBillTotals(billItems, true, 7, true, 10);
  assert.deepEqual(totals, { subtotal: 141.05, vatAmount: 9.87, appliedDiscount: 10, total: 140.92 });
  const settlements = settlementsFor({ friends, billItems, allocations, total: totals.total });
  assert.deepEqual(settlements, [
    { name: 'Ana', amount: 33.64 },
    { name: 'Bo', amount: 46.16 },
    { name: 'Chai', amount: 33.63 },
    { name: 'Dee', amount: 27.49 },
  ]);
  assert.equal(settlements.reduce((sum, entry) => sum + Math.round(entry.amount * 100), 0), 14092);
});
test('zero bill and full discount produce zero settlements', () => {
  for (const amount of [0, 100]) {
    const result = settlementsFor({ friends: ['A', 'B'], billItems: [{ amount }], allocations: [['A', 'B']], total: 0 });
    assert.deepEqual(result.map(x => x.amount), [0, 0]);
  }
});
test('1000 seeded randomized normal bills conserve target cents', () => {
  let seed = 17;
  const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
  for (let iteration = 0; iteration < 1000; iteration++) {
    const friends = Array.from({ length: 2 + next() % 19 }, (_, i) => `P${i}`);
    const billItems = Array.from({ length: 1 + next() % 30 }, () => ({ amount: (next() % 100000) / 100 }));
    const allocations = billItems.map(() => friends.slice(0, 1 + next() % friends.length));
    const subtotal = billItems.reduce((s, x) => s + x.amount, 0);
    const total = Math.max(0, subtotal * 1.07 - (next() % 1000) / 100);
    const result = settlementsFor({ friends, billItems, allocations, total });
    assert.equal(result.reduce((s, x) => s + Math.round(x.amount * 100), 0), Math.round(total * 100));
  }
});
test('100 people and 1000 items conserve cents', () => {
  const friends = Array.from({ length: 100 }, (_, i) => `P${i}`);
  const result = settlementsFor({ friends, billItems: Array.from({ length: 1000 }, () => ({ amount: 0.01 })), allocations: Array.from({ length: 1000 }, () => friends), total: 10 });
  assert.equal(result.reduce((s, x) => s + Math.round(x.amount * 100), 0), 1000);
});
test('plain OCR normalizes Thai digits and ignores receipt totals', () => {
  assert.deepEqual(plainOcr('๒ ข้าวผัด ๑๒๐.๕๐\nVAT 7.00\nTotal 127.50'), [{ name: 'ข้าวผัด', quantity: 2, amount: 120.5 }]);
  assert.deepEqual(plainOcr('random photograph with no prices'), []);
});
test('admin valid/tampered/expired session and password', () => {
  const token = createAdminSession();
  const request = tokenValue => new Request('https://test.invalid/api/admin-dashboard', { headers: { cookie: `harn_admin_session=${tokenValue}` } });
  assert.equal(hasValidAdminSession(request(token)), true);
  assert.equal(hasValidAdminSession(request(`${token}x`)), false);
  assert.equal(hasValidAdminSession(request('garbage')), false);
  assert.equal(verifyAdminPassword('test-password-only'), true);
  assert.equal(verifyAdminPassword('incorrect'), false);
  const realNow = Date.now;
  try { Date.now = () => realNow() + 13 * 3600000; assert.equal(hasValidAdminSession(request(token)), false); }
  finally { Date.now = realNow; }
});
test('cookies have HTTPS flags and visitor validation', () => {
  const request = new Request('https://test.invalid');
  for (const cookie of [adminSessionCookie(request, 'dummy'), visitorCookie(request, 'dummy')]) {
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/);
  }
  assert.equal(readVisitorId(new Request('https://test.invalid', { headers: { cookie: 'harn_analytics_visitor=bad' } })), null);
  const id = '90e48581-859c-4dd3-8327-2996b96cef68';
  assert.equal(readVisitorId(new Request('https://test.invalid', { headers: { cookie: `harn_analytics_visitor=${id}` } })), id);
});
test('logout validates method and cross-origin requests', async () => {
  assert.equal((await logout.fetch(new Request('https://test.invalid'))).status, 405);
  const request = new Request('https://test.invalid', { method: 'POST', headers: { origin: 'https://elsewhere.invalid' } });
  assert.equal(isSameOriginRequest(request), false);
  assert.equal((await logout.fetch(request)).status, 403);
  const response = await logout.fetch(new Request('https://test.invalid', { method: 'POST' }));
  assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});
test('operations rejects wrong methods, malformed JSON, and missing input', async () => {
  assert.equal((await operations.fetch(new Request('https://test.invalid'))).status, 405);
  for (const body of ['{', '{}', 'null', JSON.stringify({ eventName: 'x', friends: ['A', 'B'], billItems: [null] }), JSON.stringify({ eventName: 'x', friends: ['A', 'B'], billItems: [{ name: 'Tea', quantity: 1, amount: 'Infinity' }] })]) {
    assert.equal((await operations.fetch(new Request('https://test.invalid', { method: 'POST', body }))).status, 400);
  }
});
test('fractional VAT is rounded once before display and allocation', () => {
  const totals = getBillTotals([{ amount: 2.5 }], true, 7, false, 0);
  assert.deepEqual(totals, { subtotal: 2.5, vatAmount: 0.18, appliedDiscount: 0, total: 2.68 });
  assert.equal(toSatang(1.005), 101);
  assert.equal(itemShare(100, 3, 0), 33.34);
  assert.equal(itemShare(100, 3, 1), 33.33);
  for (const input of ['', null, -1, Infinity, 'oops', 1e10]) assert.equal(isValidMoney(input), false);
});
test('maximum supported bill and full/excess discounts retain exact integer totals', () => {
  const items = Array.from({ length: 1000 }, () => ({ amount: 1_000_000_000 }));
  const totals = getBillTotals(items, true, 100, true, 1_000_000_000);
  assert.equal(totals.total, 1_999_000_000_000);
  const friends = Array.from({ length: 100 }, (_, index) => `P${index}`);
  const result = settlementsFor({ friends, billItems: items, allocations: items.map(() => friends), total: totals.total });
  assert.equal(result.reduce((sum, entry) => sum + Math.round(entry.amount * 100), 0), 199_900_000_000_000);
  for (const discount of [100, 101]) assert.equal(getBillTotals([{ amount: 100 }], false, 0, true, discount).total, 0);
});
test('malformed cookies do not throw or invalidate unrelated cookies', () => {
  const req = new Request('https://test.invalid', { headers: { cookie: `broken=%; harn_admin_session=${createAdminSession()}` } });
  assert.equal(hasValidAdminSession(req), true);
  assert.equal(readVisitorId(new Request('https://test.invalid', { headers: { cookie: 'harn_analytics_visitor=%' } })), null);
});
test('malformed history rows are rejected without altering their source', () => {
  const row = { id: 'bad', updatedAt: 1 };
  assert.equal(isHistoryRecord(row), false);
  assert.deepEqual(row, { id: 'bad', updatedAt: 1 });
});
test('unfinished bill drafts round-trip locally and malformed drafts fail safely', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const draft = {
    eventName: 'Late dinner', friends: ['A', 'B'], friendName: '',
    billItems: [{ name: 'Noodles', quantity: 1, amount: 100 }], allocations: [['A']],
    step: 'split', splitIndex: 0, settlements: [], vatEnabled: true, vatRate: 7,
    discountEnabled: false, discountAmount: 0, peopleNameConfirmed: true,
    manualComposerOpen: false, manualItemName: '', manualItemPrice: '', manualQuantity: '1',
    showManualQuantity: false, showBillExtras: true, activeHistoryId: null, activeHistoryUpdatedAt: null,
  };
  assert.equal(saveBillDraft(draft, storage), true);
  assert.equal(readBillDraft(storage).eventName, 'Late dinner');
  assert.deepEqual(readBillDraft(storage).allocations, [['A']]);
  assert.equal(readBillDraft(storage).step, 'split');
  storage.setItem(BILL_DRAFT_STORAGE_KEY, '{broken');
  assert.equal(readBillDraft(storage), null);
  assert.equal(clearBillDraft(storage), true);
  assert.equal(readBillDraft(storage), null);
});
test('operations accepts legacy valid payload without logging its contents', async () => {
  let logs = 0; const original = console.log;
  try {
    console.log = () => logs++;
    const response = await operations.fetch(new Request('https://test.invalid', { method: 'POST', body: JSON.stringify({ eventName: 'Synthetic', friends: ['A', 'B'], billItems: [{ name: 'Tea', amount: 10.5, quantity: 1 }] }) }));
    assert.equal(response.status, 201); assert.equal(logs, 0);
  } finally { console.log = original; }
});
