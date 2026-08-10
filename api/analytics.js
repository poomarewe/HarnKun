import { randomUUID } from 'node:crypto';
import { AnalyticsSetupError, recordVisitorHeartbeat } from '../lib/analytics-db.js';
import { readVisitorId, visitorCookie } from '../lib/visitor-cookie.js';

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return json({ message: 'Method not allowed.' }, 405, { Allow: 'POST' });
    }

    const existingVisitorId = readVisitorId(request);
    const visitorId = existingVisitorId || randomUUID();
    try {
      await recordVisitorHeartbeat(visitorId);
      const headers = existingVisitorId ? {} : { 'Set-Cookie': visitorCookie(request, visitorId) };
      return json({ recorded: true }, 200, headers);
    } catch (error) {
      const message = error instanceof AnalyticsSetupError
        ? error.message
        : 'Analytics is temporarily unavailable.';
      if (!(error instanceof AnalyticsSetupError)) console.error('Analytics heartbeat failed:', error);
      return json({ message }, 503);
    }
  },
};
