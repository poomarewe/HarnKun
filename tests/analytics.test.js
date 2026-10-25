import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAnalyticsBill } from '../api/analytics-bills.js';
import { default as analytics } from '../api/analytics.js';
import { default as bills } from '../api/analytics-bills.js';
import { default as revoke } from '../api/analytics-revoke.js';
import { default as adminBills } from '../api/admin-bills.js';
import { default as cleanup } from '../api/analytics-cleanup.js';
import { decodeAdminBillsCursor, encodeAdminBillsCursor } from '../api/admin-bills.js';
import { createAdminSession } from '../lib/admin-auth.js';
import {
  createAnalyticsRepository,
  parseDeviceDetails,
} from '../lib/analytics-db.js';
import {
  clearVisitorCookies,
  readVisitorId,
  VISITOR_COOKIE_NAME,
  VISITOR_COOKIE_SECONDS,
  visitorCookie,
} from '../lib/visitor-cookie.js';

function fakeSql() {
  const statements = [];
  const sql = (strings, ...values) => {
    statements.push({ text: strings.join('?'), values });
    return Promise.resolve([]);
  };
  sql.statements = statements;
  sql.transaction = queries => Promise.all(queries);
  return sql;
}

const visitorId = '3f0d3e9a-9d2a-4dc1-9b32-57b5fc93f9b2';
const browserCookie = `${VISITOR_COOKIE_NAME}=${visitorId}`;

const request = (url, options = {}) => new Request(url, options);

test('bill analytics stores item and participant details with monetary amounts rounded to satang', () => {
  const result = sanitizeAnalyticsBill({
    historyId: 'history-1', total: 120.505, participantCount: 3,
    participants: [{ name: 'Alice', share: 50.125 }, { name: 'Bob', share: 40 }, { name: 'Mali', share: 30.38 }],
    items: [{ name: 'Pad Thai', amount: 100.125, quantity: 5 }],
    eventName: 'Private party', friends: ['Alice'], allocations: [['Alice']],
  });
  assert.deepEqual(result, {
    historyId: 'history-1', totalSatang: 12051, participantCount: 3,
    participants: [{ name: 'Alice', share: 50.13 }, { name: 'Bob', share: 40 }, { name: 'Mali', share: 30.38 }],
    items: [{ name: 'Pad Thai', amount: 100.13 }],
  });
  assert.equal('friends' in result, false);
  assert.equal('allocations' in result, false);
  assert.equal('eventName' in result, false);
});

test('bill analytics rejects invalid or oversized summaries and participant detail', () => {
  assert.equal(sanitizeAnalyticsBill(null), null);
  assert.equal(sanitizeAnalyticsBill({ historyId: 'x', total: 1, participantCount: 1, items: [{ name: 'x', amount: 1 }] }), null);
  const people = [{ name: 'A', share: 0 }, { name: 'B', share: 1 }];
  assert.equal(sanitizeAnalyticsBill({ historyId: 'x', total: 1, participantCount: 2, participants: people, items: [{ name: ' ', amount: 1 }] }), null);
  assert.equal(sanitizeAnalyticsBill({ historyId: 'x', total: 1, participantCount: 2, participants: people, items: [{ name: 'x', amount: Infinity }] }), null);
  assert.equal(sanitizeAnalyticsBill({ historyId: 'x', total: 1, participantCount: 2, participants: people.slice(0, 1), items: [{ name: 'x', amount: 1 }] }), null);
  assert.equal(sanitizeAnalyticsBill({ historyId: 'x', total: 1, participantCount: 2, participants: [{ name: ' ', share: 0 }, people[1]], items: [{ name: 'x', amount: 1 }] }), null);
});

test('visitor cookies are scoped, short-lived and safely parsed', () => {
  const req = request('https://example.test/', { headers: { cookie: browserCookie } });
  assert.equal(readVisitorId(req), visitorId);
  assert.equal(VISITOR_COOKIE_SECONDS, 30 * 24 * 60 * 60);
  assert.match(visitorCookie(req, visitorId), /HttpOnly; SameSite=Lax; Secure/);
  assert.equal(readVisitorId(request('https://example.test/', { headers: { cookie: `${VISITOR_COOKIE_NAME}=bad` } })), null);
  assert.equal(clearVisitorCookies(req).length, 2);
});

test('device parsing stores only broad device and browser categories', () => {
  assert.deepEqual(parseDeviceDetails('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1'), { deviceType: 'mobile', browser: 'Safari' });
  assert.deepEqual(parseDeviceDetails('Mozilla/5.0 (Linux; Android 13; Tablet) Chrome/120.0.0.0 Safari/537.36'), { deviceType: 'tablet', browser: 'Chrome' });
  assert.deepEqual(parseDeviceDetails('unknown'), { deviceType: 'desktop', browser: 'Other' });
});

test('analytics SQL migrates old visit counts anonymously and drops legacy browser IDs', async () => {
  const sql = fakeSql();
  const repository = createAnalyticsRepository(() => sql);
  await repository.ensureAnalyticsSchema();
  const migration = sql.statements.find(statement => statement.text.includes('harn_daily_visitors'));
  assert.ok(migration);
  assert.match(migration.text, /COUNT\(\*\)::bigint/);
  assert.match(migration.text, /DROP TABLE IF EXISTS harn_daily_visitors/);
  assert.match(migration.text, /DROP TABLE IF EXISTS harn_visitors/);
  assert.doesNotMatch(migration.text, /DROP TABLE.*harn_analytics_daily/);
  const billSchema = sql.statements.find(statement => statement.text.includes('CREATE TABLE IF NOT EXISTS harn_analytics_bills'));
  assert.match(billSchema.text, /REFERENCES harn_analytics_visitors\(visitor_id\) ON DELETE CASCADE/);
  assert.match(billSchema.text, /participants JSONB NOT NULL/);
  assert.ok(sql.statements.some(statement => /DROP COLUMN IF EXISTS spend_satang/.test(statement.text)));
});

test('30-day cleanup deletes browser-linked records only and preserves daily aggregates', async () => {
  const sql = fakeSql();
  const repository = createAnalyticsRepository(() => sql);
  await repository.cleanupAnalyticsData();
  const deletes = sql.statements.filter(statement => statement.text.includes('DELETE FROM'));
  assert.equal(deletes.length, 3);
  assert.ok(deletes.some(({ text }) => text.includes('harn_analytics_bills') && text.includes("INTERVAL '1 day')")));
  assert.ok(deletes.some(({ text }) => text.includes('harn_analytics_visitor_days')));
  assert.ok(deletes.some(({ text }) => text.includes('harn_analytics_visitors')));
  assert.ok(deletes.every(({ text }) => !text.includes('harn_analytics_daily')));
});

test('automatic bill upserts retain participant names and shares under the local history ID', async () => {
  const sql = fakeSql();
  const repository = createAnalyticsRepository(() => sql);
  await repository.recordCompletedBill(visitorId, {
    historyId: 'local-1', totalSatang: 12000, participantCount: 2,
    participants: [{ name: 'A', share: 60 }, { name: 'B', share: 60 }],
    items: [{ name: 'Rice', amount: 120 }],
  });
  const upsert = sql.statements.at(-1).text;
  assert.match(upsert, /ON CONFLICT \(visitor_id, history_id\) DO UPDATE/);
  assert.match(upsert, /participants/);
  assert.doesNotMatch(upsert, /friends|allocations|user.?agent|ip_address/i);
});

test('revoking consent deletes the browser profile so linked details cascade away', async () => {
  const sql = fakeSql();
  const repository = createAnalyticsRepository(() => sql);
  await repository.revokeVisitorAnalytics(visitorId);
  const deletion = sql.statements.at(-1);
  assert.match(deletion.text, /DELETE FROM harn_analytics_visitors WHERE visitor_id = \?::uuid/);
  assert.equal(deletion.values[0], visitorId);
  assert.doesNotMatch(deletion.text, /harn_analytics_daily/);
});

test('admin bill pagination uses a validated opaque cursor and bounded page query', async () => {
  const cursorRow = {
    updatedAt: '2026-10-25T01:02:03.000Z', visitorId, historyId: 'local-1',
  };
  const cursor = encodeAdminBillsCursor(cursorRow);
  assert.deepEqual(decodeAdminBillsCursor(cursor), cursorRow);
  assert.equal(decodeAdminBillsCursor('not a cursor'), undefined);
  const badUuid = Buffer.from(JSON.stringify([cursorRow.updatedAt, '------------------------------------', 'local-1'])).toString('base64url');
  assert.equal(decodeAdminBillsCursor(badUuid), undefined);

  const sql = fakeSql();
  const repository = createAnalyticsRepository(() => sql);
  await repository.getAnalyticsBills(cursorRow);
  const query = sql.statements.at(-1);
  assert.match(query.text, /\(b\.updated_at, b\.visitor_id, b\.history_id\) </);
  assert.match(query.text, /LIMIT 51/);
  assert.ok(query.values.includes(cursorRow.updatedAt));
  assert.ok(query.values.includes(cursorRow.visitorId));
  assert.ok(query.values.includes(cursorRow.historyId));
});

test('visit analytics attempts recording without a consent cookie', async () => {
  const response = await analytics.fetch(request('https://example.test/api/analytics', { method: 'POST' }));
  assert.equal(response.status, 503); // The test has no database configured; the request reached storage setup.
  assert.equal(response.headers.get('set-cookie'), null);
});

test('bill API does not require consent but requires a tracked browser ID', async () => {
  const response = await bills.fetch(request('https://example.test/api/analytics-bills', {
    method: 'POST', body: JSON.stringify({ secret: 'must not be stored' }),
  }));
  assert.equal(response.status, 409);

  const validBill = {
    historyId: 'local-2', total: 2, participantCount: 2,
    participants: [{ name: 'A', share: 1 }, { name: 'B', share: 1 }],
    items: [{ name: 'Tea', amount: 2 }],
  };
  const withoutConsent = await bills.fetch(request('https://example.test/api/analytics-bills', {
    method: 'POST', headers: { cookie: `${VISITOR_COOKIE_NAME}=${visitorId}` }, body: JSON.stringify(validBill),
  }));
  assert.equal(withoutConsent.status, 503); // It passed validation and reached unconfigured storage.
});

test('revocation checks origin and expires both visitor cookie names', async () => {
  const denied = await revoke.fetch(request('https://example.test/api/analytics-revoke', {
    method: 'POST', headers: { origin: 'https://attacker.test' },
  }));
  assert.equal(denied.status, 403);
  const response = await revoke.fetch(request('https://example.test/api/analytics-revoke', { method: 'POST' }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.ok(response.headers.getSetCookie().every(cookie => /Max-Age=0/.test(cookie)));
});

test('admin bills and scheduled cleanup reject unauthenticated requests', async () => {
  const adminResponse = await adminBills.fetch(request('https://example.test/api/admin-bills'));
  assert.equal(adminResponse.status, 503); // Admin credentials are unset in the test process.
  const cleanupResponse = await cleanup.fetch(request('https://example.test/api/analytics-cleanup'));
  assert.equal(cleanupResponse.status, 401);
});

test('admin bills rejects malformed cursors after authentication without querying Neon', async () => {
  const previousPassword = process.env.ADMIN_PASSWORD;
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_PASSWORD = 'qa-admin-password';
  process.env.ADMIN_SESSION_SECRET = 'a'.repeat(40);
  try {
    const token = createAdminSession();
    const response = await adminBills.fetch(request('https://example.test/api/admin-bills?cursor=invalid!', {
      headers: { cookie: `harn_admin_session=${encodeURIComponent(token)}` },
    }));
    assert.equal(response.status, 400);
  } finally {
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = previousSecret;
  }
});
