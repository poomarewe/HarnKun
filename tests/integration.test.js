import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { parse } from 'dotenv';
import { readFileSync, readdirSync } from 'node:fs';

const origin = 'http://127.0.0.1:4176';
let server;
before(async () => {
  server = spawn(process.execPath, ['server.js'], { stdio: 'ignore', env: { ...process.env, PORT: '4176', NODE_ENV: 'production', DOTENV_CONFIG_PATH: 'qa-no-env', DATABASE_URL: '', TYPHOON_OCR_API_KEY: '', ADMIN_PASSWORD: '', ADMIN_SESSION_SECRET: '' } });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin)).ok) return; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Isolated integration server did not start.');
});
after(async () => { if (server) { const exited = once(server, 'exit'); server.kill(); await exited; } });
test('built routes, manifest, icons and metadata are served', async () => {
  for (const path of ['/', '/history', '/admin', '/visitor-heartbeat.js', '/manifest.webmanifest', '/icon.png', '/robots.txt', '/sitemap.xml']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path); await response.arrayBuffer();
  }
});
test('real HTTP API method, malformed JSON, disabled services and unknown endpoint errors', async () => {
  const cases = [
    ['/api/scan-bill', {}, 405],
    ['/api/scan-bill', { method: 'POST', body: new FormData() }, 503],
    ['/api/operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }, 400],
    ['/api/operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' }, 400],
    ['/api/admin-dashboard', {}, 503],
    ['/api/admin-login', { method: 'POST', headers: { Origin: 'https://bad.invalid' } }, 403],
    ['/api/admin-logout', { method: 'POST' }, 200],
    ['/api/missing', {}, 404],
  ];
  for (const [path, options, expected] of cases) {
    const response = await fetch(origin + path, options);
    assert.equal(response.status, expected, path); await response.json();
  }
});
test('analytics attempts visitor recording without consent and keeps admin endpoints protected', async () => {
  const response = await fetch(origin + '/api/analytics', { method: 'POST' });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
  const bill = await fetch(origin + '/api/analytics-bills', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ historyId: 'test' }),
  });
  assert.equal(bill.status, 409);
  const bills = await fetch(origin + '/api/admin-bills');
  assert.equal(bills.status, 503);
  const cleanup = await fetch(origin + '/api/analytics-cleanup');
  assert.equal(cleanup.status, 401);
});
test('private environment values are absent from browser bundles (values never printed)', () => {
  let variables = {};
  try { variables = parse(readFileSync('.env')); } catch { /* no local env */ }
  const assets = readdirSync('dist/assets').filter(name => /\.js$/.test(name)).map(name => readFileSync(`dist/assets/${name}`, 'utf8')).join('\n');
  const privateValues = Object.entries(variables).filter(([key, value]) => /KEY|PASSWORD|SECRET|DATABASE_URL/.test(key) && value.length > 12);
  assert.equal(privateValues.some(([, value]) => assets.includes(value)), false, 'Private configuration appears in a browser asset.');
});
