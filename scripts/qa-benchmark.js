import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

// Bounded localhost-only measurement. Never accepts a remote target.
const origin = 'http://127.0.0.1:4175';
const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: '4175', NODE_ENV: 'production', DOTENV_CONFIG_PATH: 'qa-no-env', DATABASE_URL: '', TYPHOON_OCR_API_KEY: '', ADMIN_PASSWORD: '', ADMIN_SESSION_SECRET: '' },
  stdio: 'ignore',
});
const results = { target: origin, note: 'Local Express static HTML only. Not Vercel, database or OCR capacity evidence.' };
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(origin)).ok; if (ready) break; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!ready) throw new Error('Local benchmark server did not start.');
  const latencies = []; let passed = 0; const statuses = {};
  const started = performance.now();
  await Promise.all(Array.from({ length: 500 }, (_, index) => new Promise(resolve => {
    setTimeout(async () => {
      const before = performance.now();
      try {
        const response = await fetch(origin);
        await response.arrayBuffer();
        statuses[response.status] = (statuses[response.status] || 0) + 1;
        if (response.ok) passed++;
        latencies.push(performance.now() - before);
      } finally { resolve(); }
    }, index * 10);
  })));
  const durationMs = performance.now() - started;
  latencies.sort((a, b) => a - b);
  results.staticLoad = { scheduledRps: 100, requests: 500, successful: passed, statuses, durationMs, achievedRps: passed / durationMs * 1000, medianMs: latencies[Math.floor(latencies.length / 2)], p95Ms: latencies[Math.floor(latencies.length * .95)] };
  const assets = await readdir('dist/assets');
  results.bundles = await Promise.all(assets.filter(name => /\.(js|css)$/.test(name)).map(async name => {
    const data = await readFile(`dist/assets/${name}`);
    return { name, bytes: data.length, gzipBytes: gzipSync(data).length };
  }));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
      if (url.pathname.startsWith('/_vercel/')) return route.fulfill({ contentType: 'application/javascript', body: '' });
      return route.continue();
    });
    await page.addInitScript(() => {
      window.qaMetrics = { lcp: 0, cls: 0 };
      new PerformanceObserver(list => { for (const entry of list.getEntries()) window.qaMetrics.lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.qaMetrics.cls += entry.value; }).observe({ type: 'layout-shift', buffered: true });
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 93_750 });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.waitForTimeout(4500); // Allow the existing 3.9s intro to finish.
    results.mobileLab = await page.evaluate(() => ({ ...window.qaMetrics, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime, resources: performance.getEntriesByType('resource').length, transferredBytes: performance.getEntriesByType('resource').reduce((sum, entry) => sum + entry.transferSize, 0), navigationMs: performance.getEntriesByType('navigation')[0]?.duration }));
    results.mobileLab.conditions = 'One cold Chromium run, 390x844, 4x CPU, 150ms latency, 1.6Mbps download; local uncompressed Express static serving. No field CWV/INP claim.';
    await context.close();
  } finally { await browser.close(); }
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/performance.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { const exited = once(server, 'exit'); server.kill(); await exited.catch(() => {}); }
