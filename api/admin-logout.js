import {
  clearAdminSessionCookie,
  isSameOriginRequest,
} from '../lib/admin-auth.js';

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
    return json(
      { authenticated: false },
      200,
      { 'Set-Cookie': clearAdminSessionCookie(request) },
    );
  },
};
