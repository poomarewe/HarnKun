import { hasValidAdminSession, isAdminConfigured } from '../lib/admin-auth.js';
import { AnalyticsSetupError, getAnalyticsDashboard } from '../lib/analytics-db.js';

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      ...headers,
    },
  });
}

export default {
  async fetch(request) {
    if (request.method !== 'GET') {
      return json({ message: 'Method not allowed.' }, 405, { Allow: 'GET' });
    }
    if (!isAdminConfigured()) return json({ message: 'Admin login is not configured.' }, 503);
    if (!hasValidAdminSession(request)) return json({ message: 'Authentication required.' }, 401);

    try {
      return json(await getAnalyticsDashboard());
    } catch (error) {
      if (!(error instanceof AnalyticsSetupError)) console.error('Admin dashboard failed:', error);
      return json({ message: 'Analytics is temporarily unavailable.' }, 503);
    }
  },
};
