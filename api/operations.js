function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers });
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return json({ message: 'Method not allowed.' }, 405, { Allow: 'POST' });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ message: 'A valid JSON body is required.' }, 400);
    }

    const { eventName, friends, billItems, allocations, settlements } = body;
    if (
      typeof eventName !== 'string'
      || !eventName.trim()
      || !Array.isArray(friends)
      || friends.length < 2
      || friends.length > 100
      || !Array.isArray(billItems)
      || billItems.length === 0
    ) {
      return json({ message: 'An event name, 2–100 friends, and bill items are required.' }, 400);
    }

    const cleanItems = billItems
      .map((item) => ({
        name: String(item.name || '').trim(),
        quantity: Math.max(1, Number(item.quantity) || 1),
        amount: Math.max(0, Number(item.amount) || 0),
      }))
      .filter((item) => item.name);
    if (cleanItems.length === 0) {
      return json({ message: 'At least one valid bill item is required.' }, 400);
    }

    const total = cleanItems.reduce((sum, item) => sum + item.amount, 0);
    console.log('New Harn Kun operation:', {
      eventName: eventName.trim(),
      friends,
      billItems: cleanItems,
      allocations,
      settlements,
      total,
    });

    return json({ message: 'Operation received.', total }, 201);
  },
};
