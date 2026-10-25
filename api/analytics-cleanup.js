import { AnalyticsSetupError, cleanupAnalyticsData } from '../lib/analytics-db.js';

export default {
  async fetch(request) {
    if (request.method !== 'GET') {
      return Response.json({ message: 'Method not allowed.' }, { status: 405, headers: { Allow: 'GET' } });
    }
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
      return Response.json({ message: 'Authentication required.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    try {
      await cleanupAnalyticsData();
      return Response.json({ cleaned: true }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (!(error instanceof AnalyticsSetupError)) console.error('Analytics retention cleanup failed.');
      return Response.json({ message: 'Analytics cleanup is temporarily unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  },
};
