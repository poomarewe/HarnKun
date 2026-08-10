import {
  adminSessionCookie,
  createAdminSession,
  getClientAddress,
  isAdminConfigured,
  isSameOriginRequest,
  verifyAdminPassword,
} from '../lib/admin-auth.js';
import {
  AnalyticsSetupError,
  clearFailedLogins,
  getLoginBlock,
  recordFailedLogin,
} from '../lib/analytics-db.js';

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
    if (request.method !== 'POST') {
      return json({ message: 'Method not allowed.' }, 405, { Allow: 'POST' });
    }
    if (!isSameOriginRequest(request)) return json({ message: 'Invalid request origin.' }, 403);
    if (!isAdminConfigured()) {
      return json({ message: 'Admin login is not configured.' }, 503);
    }

    const clientAddress = getClientAddress(request);
    try {
      const blockedUntil = await getLoginBlock(clientAddress);
      if (blockedUntil) {
        const retryAfter = Math.max(1, Math.ceil((blockedUntil.getTime() - Date.now()) / 1000));
        return json(
          { message: 'Too many login attempts. Please try again later.' },
          429,
          { 'Retry-After': String(retryAfter) },
        );
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ message: 'A valid password is required.' }, 400);
      }
      const password = typeof body.password === 'string' ? body.password : '';
      if (!password || password.length > 256 || !verifyAdminPassword(password)) {
        await recordFailedLogin(clientAddress);
        return json({ message: 'Incorrect password.' }, 401);
      }

      await clearFailedLogins(clientAddress);
      return json(
        { authenticated: true },
        200,
        { 'Set-Cookie': adminSessionCookie(request, createAdminSession()) },
      );
    } catch (error) {
      if (!(error instanceof AnalyticsSetupError)) console.error('Admin login failed:', error);
      return json({ message: 'Admin service is temporarily unavailable.' }, 503);
    }
  },
};
