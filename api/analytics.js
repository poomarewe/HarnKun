import { randomUUID } from 'node:crypto';
import { AnalyticsSetupError, parseDeviceDetails, recordVisitorHeartbeat } from '../lib/analytics-db.js';
import {
  clearVisitorCookies,
  hasAnalyticsConsent,
  readVisitorId,
  visitorCookie,
} from '../lib/visitor-cookie.js';

function json(data, status = 200, headers = {}) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'no-store');
  return Response.json(data, {
    status,
    headers: responseHeaders,
  });
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return json({ message: 'Method not allowed.' }, 405, { Allow: 'POST' });
    }
    if (!hasAnalyticsConsent(request)) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

    const existingVisitorId = readVisitorId(request);
    const visitorId = existingVisitorId || randomUUID();
    try {
      const device = parseDeviceDetails(request.headers.get('user-agent'));
      await recordVisitorHeartbeat(visitorId, device);
      const headers = new Headers();
      if (!existingVisitorId) {
        headers.append('Set-Cookie', visitorCookie(request, visitorId));
        clearVisitorCookies(request).slice(1).forEach(cookie => headers.append('Set-Cookie', cookie));
      }
      return json({ recorded: true }, 200, headers);
    } catch (error) {
      if (!(error instanceof AnalyticsSetupError)) console.error('Analytics heartbeat failed.');
      return json({ message: 'Analytics is temporarily unavailable.' }, 503);
    }
  },
};
