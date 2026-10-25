import { readAnalyticsConsent } from './analytics-consent.js';

let heartbeatInFlight;

export function sendVisitorHeartbeat() {
  if (readAnalyticsConsent() !== 'accepted') return Promise.resolve(false);
  if (!heartbeatInFlight) {
    heartbeatInFlight = fetch('/api/analytics', {
      method: 'POST', credentials: 'same-origin', keepalive: true,
    }).then(response => response.ok).catch(() => false)
      .finally(() => { heartbeatInFlight = undefined; });
  }
  return heartbeatInFlight;
}

export async function sendCompletedBillAnalytics(record) {
  if (readAnalyticsConsent() !== 'accepted') return false;
  const ready = await sendVisitorHeartbeat();
  if (!ready || readAnalyticsConsent() !== 'accepted') return false;

  try {
    const response = await fetch('/api/analytics-bills', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        historyId: record.id,
        total: record.total,
        participantCount: record.friends.length,
        items: record.billItems.map(item => ({ name: item.name, amount: item.amount })),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
