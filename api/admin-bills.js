import { getAnalyticsBills, AnalyticsSetupError } from '../lib/analytics-db.js';
import { hasValidAdminSession, isAdminConfigured } from '../lib/admin-auth.js';

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function decodeAdminBillsCursor(value) {
  if (!value) return null;
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const [updatedAt, visitorId, historyId] = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt))
      || typeof visitorId !== 'string' || !UUID_PATTERN.test(visitorId)
      || typeof historyId !== 'string' || !historyId || historyId.length > 128) return undefined;
    return { updatedAt, visitorId, historyId };
  } catch {
    return undefined;
  }
}

export function encodeAdminBillsCursor(row) {
  return Buffer.from(JSON.stringify([
    new Date(row.updatedAt).toISOString(), row.visitorId, row.historyId,
  ])).toString('base64url');
}

export default {
  async fetch(request) {
    if (request.method !== 'GET') return json({ message: 'Method not allowed.' }, 405);
    if (!isAdminConfigured()) return json({ message: 'Admin login is not configured.' }, 503);
    if (!hasValidAdminSession(request)) return json({ message: 'Authentication required.' }, 401);
    const cursor = decodeAdminBillsCursor(new URL(request.url).searchParams.get('cursor'));
    if (cursor === undefined) return json({ message: 'Invalid page cursor.' }, 400);

    try {
      const rows = await getAnalyticsBills(cursor);
      const hasMore = rows.length > 50;
      const items = rows.slice(0, 50).map(({ visitorId, ...bill }) => ({
        ...bill,
        visitorId: `Browser ${visitorId.slice(0, 8)}`,
      }));
      return json({ bills: items, nextCursor: hasMore ? encodeAdminBillsCursor(rows[49]) : null });
    } catch (error) {
      if (!(error instanceof AnalyticsSetupError)) console.error('Admin bill list failed.');
      return json({ message: 'Analytics is temporarily unavailable.' }, 503);
    }
  },
};
