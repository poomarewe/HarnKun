let heartbeatInFlight;

export function sendVisitorHeartbeat() {
  if (!heartbeatInFlight) {
    heartbeatInFlight = fetch('/api/analytics', {
      method: 'POST', credentials: 'same-origin', keepalive: true,
    }).then(response => response.ok).catch(() => false)
      .finally(() => { heartbeatInFlight = undefined; });
  }
  return heartbeatInFlight;
}

export async function sendCompletedBillAnalytics(record) {
  const ready = await sendVisitorHeartbeat();
  if (!ready) return false;

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
        participants: record.settlements.map(person => ({ name: person.name, share: person.amount })),
        items: record.billItems.map(item => ({ name: item.name, amount: item.amount })),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
