import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

// These tests call the Vercel handler directly. All provider HTTP calls are mocked.
const png = await sharp({ create: { width: 80, height: 120, channels: 3, background: 'white' } }).png().toBuffer();
let counter = 0;
function request(file = new File([png], 'receipt.png', { type: 'image/png' }), ip = `192.0.2.${++counter}`) {
  const form = new FormData();
  if (file !== null) form.append('bill', file);
  return new Request('https://test.invalid/api/scan-bill', { method: 'POST', headers: { 'x-forwarded-for': ip }, body: form });
}
async function fresh() { return (await import(`../api/scan-bill.js?test=${++counter}`)).default; }
test('OCR rejects method and absent configuration', async () => {
  delete process.env.TYPHOON_OCR_API_KEY;
  const handler = await fresh();
  assert.equal((await handler.fetch(new Request('https://test.invalid'))).status, 405);
  assert.equal((await handler.fetch(request())).status, 503);
});
test('OCR validates empty, MIME, large and malformed uploads', async () => {
  process.env.TYPHOON_OCR_API_KEY = 'synthetic-test-key';
  const handler = await fresh();
  for (const [file, expected] of [[null, 400], [new File([], 'empty.png', { type: 'image/png' }), 400], [new File(['x'], 'x.txt', { type: 'text/plain' }), 415], [new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }), 413]]) {
    assert.equal((await handler.fetch(request(file))).status, expected);
  }
  assert.equal((await handler.fetch(new Request('https://test.invalid', { method: 'POST', body: 'broken' }))).status, 400);
});
test('OCR mock success optimizes image, retains Thai and enforces 30s per-IP cooldown', async () => {
  const handler = await fresh();
  const realFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.opentyphoon.ai/v1/chat/completions');
      const body = JSON.parse(options.body);
      assert.match(body.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/);
      assert.ok(options.signal);
      return Response.json({ choices: [{ message: { content: '<table><tr><td>ข้าว</td><td>1</td><td>50.00</td></tr></table>' } }] });
    };
    const response = await handler.fetch(request(undefined, '192.0.2.200'));
    assert.equal(response.status, 200); assert.match((await response.json()).text, /ข้าว/);
    const repeated = await handler.fetch(request(undefined, '192.0.2.200'));
    assert.equal(repeated.status, 429); assert.equal(repeated.headers.get('retry-after'), '30');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = realFetch; }
});
test('OCR mock network, timeout, 429, non-JSON, and empty content errors return JSON', async () => {
  const realFetch = globalThis.fetch;
  try {
    const cases = [
      [async () => { throw new TypeError('Network failed'); }, 503],
      [async () => { throw new DOMException('Timed out', 'TimeoutError'); }, 504],
      [async () => Response.json({ error: { message: 'SENSITIVE_PROVIDER_DIAGNOSTIC' } }, { status: 429, headers: { 'Retry-After': '45' } }), 429],
      [async () => new Response('<html>gateway</html>', { status: 502 }), 503],
      [async () => new Response('broken JSON'), 502],
      [async () => Response.json({ choices: [] }), 422],
    ];
    for (const [mock, status] of cases) {
      globalThis.fetch = mock;
      const handler = await fresh();
      const response = await handler.fetch(request());
      assert.equal(response.status, status);
      const body = await response.json();
      assert.equal(typeof body.message, 'string');
      assert.ok(!body.message.includes('SENSITIVE_PROVIDER_DIAGNOSTIC'));
      if (status === 429) assert.equal(response.headers.get('retry-after'), '45');
    }
  } finally { globalThis.fetch = realFetch; }
});
test('corrupt image is rejected without contacting provider', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; throw new Error('Must not call'); };
    const handler = await fresh();
    assert.equal((await handler.fetch(request(new File(['not an image'], 'bad.png', { type: 'image/png' })))).status, 415);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = realFetch; }
});
test('concurrent same-IP scans reserve only one provider call', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return Response.json({ choices: [{ message: { content: 'Tea 1 10.00' } }] }); };
    const handler = await fresh();
    const results = await Promise.all([handler.fetch(request(undefined, '192.0.2.201')), handler.fetch(request(undefined, '192.0.2.201'))]);
    assert.deepEqual(results.map(x => x.status).sort(), [200, 429]);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = realFetch; }
});
test('three independent IPs and two instances demonstrate missing shared provider limit (mock only)', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return Response.json({ choices: [{ message: { content: 'Tea 1 10.00' } }] }); };
    const handler = await fresh(), anotherInstance = await fresh();
    const responses = await Promise.all([handler.fetch(request()), handler.fetch(request()), anotherInstance.fetch(request())]);
    assert.ok(responses.every(x => x.status === 200));
    assert.equal(calls, 3); // Diagnostic evidence, NOT proof of a global rate limit.
  } finally { globalThis.fetch = realFetch; }
});
test('large rotated and blurred image is resized and sent as JPEG using a mock provider', async () => {
  const rotated = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: 'white' } }).blur(2).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      const dataUrl = JSON.parse(options.body).messages[0].content[1].image_url.url;
      const metadata = await sharp(Buffer.from(dataUrl.split(',')[1], 'base64')).metadata();
      assert.equal(metadata.format, 'jpeg'); assert.equal(metadata.height, 1280); assert.ok(metadata.width < metadata.height);
      return Response.json({ choices: [{ message: { content: 'Tea 1 10.00' } }] });
    };
    const handler = await fresh();
    assert.equal((await handler.fetch(request(new File([rotated], 'rotated.jpg', { type: 'image/jpeg' })))).status, 200);
  } finally { globalThis.fetch = realFetch; }
});
