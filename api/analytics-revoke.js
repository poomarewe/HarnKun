import { AnalyticsSetupError, revokeVisitorAnalytics } from '../lib/analytics-db.js';
import { isSameOriginRequest } from '../lib/admin-auth.js';
import { clearVisitorCookies, readVisitorId } from '../lib/visitor-cookie.js';

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return Response.json({ message: 'Method not allowed.' }, { status: 405, headers: { Allow: 'POST' } });
    }
    if (!isSameOriginRequest(request)) {
      return Response.json({ message: 'Invalid request origin.' }, { status: 403 });
    }

    const headers = new Headers({ 'Cache-Control': 'no-store' });
    const visitorId = readVisitorId(request);
    if (!visitorId) {
      clearVisitorCookies(request).forEach(cookie => headers.append('Set-Cookie', cookie));
      return new Response(null, { status: 204, headers });
    }

    try {
      await revokeVisitorAnalytics(visitorId);
      clearVisitorCookies(request).forEach(cookie => headers.append('Set-Cookie', cookie));
      return new Response(null, { status: 204, headers });
    } catch (error) {
      if (!(error instanceof AnalyticsSetupError)) console.error('Analytics consent revocation failed.');
      return Response.json(
        { message: 'Analytics was stopped, but saved details could not be cleared yet.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  },
};
