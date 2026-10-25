import {
  AnalyticsSetupError,
  recordCompletedBill,
} from '../lib/analytics-db.js';
import { readVisitorId } from '../lib/visitor-cookie.js';

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export function sanitizeAnalyticsBill(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.historyId !== 'string' || !value.historyId.trim() || value.historyId.length > 128
    || !Number.isFinite(value.total) || value.total < 0 || value.total > 2_000_000_000_000
    || !Number.isSafeInteger(Math.round(value.total * 100))
    || !Number.isInteger(value.participantCount) || value.participantCount < 2 || value.participantCount > 100
    || !Array.isArray(value.participants) || value.participants.length !== value.participantCount
    || value.participants.some(person => !person || typeof person.name !== 'string' || !person.name.trim()
      || person.name.length > 80 || !Number.isFinite(person.share) || person.share < 0
      || person.share > 1_000_000_000 || !Number.isSafeInteger(Math.round(person.share * 100)))
    || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 1000
    || value.items.some(item => !item || typeof item.name !== 'string' || !item.name.trim()
      || item.name.length > 200 || !Number.isFinite(item.amount) || item.amount < 0
      || item.amount > 1_000_000_000 || !Number.isSafeInteger(Math.round(item.amount * 100)))) return null;
  return {
    historyId: value.historyId.trim(),
    totalSatang: Math.round(value.total * 100),
    participantCount: value.participantCount,
    participants: value.participants.map(person => ({ name: person.name.trim(), share: Math.round(person.share * 100) / 100 })),
    items: value.items.map(item => ({ name: item.name.trim(), amount: Math.round(item.amount * 100) / 100 })),
  };
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405, { Allow: 'POST' });
    const visitorId = readVisitorId(request);
    if (!visitorId) return json({ message: 'The visit could not be identified. Please try again.' }, 409);

    let value;
    try { value = await request.json(); } catch { return json({ message: 'A valid bill summary is required.' }, 400); }
    const bill = sanitizeAnalyticsBill(value);
    if (!bill) return json({ message: 'The bill summary is invalid.' }, 400);

    try {
      await recordCompletedBill(visitorId, bill);
      return json({ recorded: true }, 202);
    } catch (error) {
      if (!(error instanceof AnalyticsSetupError)) console.error('Analytics bill record failed.');
      return json({ message: 'Analytics is temporarily unavailable.' }, 503);
    }
  },
};
