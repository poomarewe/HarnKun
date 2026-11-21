import { AnalyticsSetupError, parseDeviceDetails } from '../lib/analytics-db.js';
import { insertAdminMessage, listAdminMessages } from '../lib/admin-messages-db.js';
import { hasValidAdminSession, isAdminConfigured } from '../lib/admin-auth.js';
import { readVisitorId } from '../lib/visitor-cookie.js';

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive', ...headers },
  });
}

export function sanitizeAdminMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.message !== 'string') return null;
  const message = value.message.trim();
  if (!message || message.length > 1000) return null;
  let contact = null;
  if (value.contact !== undefined && value.contact !== null && value.contact !== '') {
    if (typeof value.contact !== 'string' || value.contact.trim().length > 120) return null;
    contact = value.contact.trim() || null;
  }
  return { message, contact };
}

export default {
  async fetch(request) {
    if (request.method === 'GET') {
      if (!isAdminConfigured()) return json({ message: 'Admin login is not configured.' }, 503);
      if (!hasValidAdminSession(request)) return json({ message: 'Authentication required.' }, 401);
      try {
        const messages = await listAdminMessages();
        return json({
          messages: messages.map(({ visitorId, ...entry }) => ({
            ...entry,
            visitorId: visitorId ? `Browser ${visitorId.slice(0, 8)}` : null,
          })),
        });
      } catch (error) {
        if (!(error instanceof AnalyticsSetupError)) console.error('Admin message list failed.');
        return json({ message: 'Messages are temporarily unavailable.' }, 503);
      }
    }

    if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });

    let value;
    try { value = await request.json(); } catch { return json({ message: 'A valid message is required.' }, 400); }
    const entry = sanitizeAdminMessage(value);
    if (!entry) return json({ message: 'Please write a message up to 1000 characters.' }, 400);

    try {
      const device = parseDeviceDetails(request.headers.get('user-agent'));
      await insertAdminMessage({ ...entry, visitorId: readVisitorId(request), ...device });
      return json({ sent: true }, 201);
    } catch (error) {
      if (!(error instanceof AnalyticsSetupError)) console.error('Admin message save failed.');
      return json({ message: 'Messages are temporarily unavailable. Please try again later.' }, 503);
    }
  },
};
