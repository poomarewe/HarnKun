import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import analyticsHandler from './api/analytics.js';
import adminLoginHandler from './api/admin-login.js';
import adminDashboardHandler from './api/admin-dashboard.js';
import adminLogoutHandler from './api/admin-logout.js';
import scanBillHandler from './api/scan-bill.js';
import operationsHandler from './api/operations.js';
import analyticsBillsHandler from './api/analytics-bills.js';
import analyticsRevokeHandler from './api/analytics-revoke.js';
import adminBillsHandler from './api/admin-bills.js';
import analyticsCleanupHandler from './api/analytics-cleanup.js';

const app = express();
app.set('trust proxy', 1);
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: '256kb' }));

function mountWebHandler(route, handler) {
  app.all(route, async (request, response, next) => {
    try {
      const headers = new Headers();
      Object.entries(request.headers).forEach(([name, value]) => {
        if (['connection', 'content-length', 'host', 'transfer-encoding'].includes(name)) return;
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value !== undefined) headers.set(name, value);
      });
      const protocol = request.get('x-forwarded-proto')?.split(',')[0]?.trim() || request.protocol;
      const url = `${protocol}://${request.get('host')}${request.originalUrl}`;
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      const webRequest = new Request(url, {
        method: request.method,
        headers,
        body: hasBody ? JSON.stringify(request.body || {}) : undefined,
      });
      const webResponse = await handler.fetch(webRequest);
      const setCookies = webResponse.headers.getSetCookie?.() || [];
      webResponse.headers.forEach((value, name) => {
        if (name !== 'set-cookie') response.setHeader(name, value);
      });
      if (setCookies.length) response.setHeader('Set-Cookie', setCookies);
      const body = Buffer.from(await webResponse.arrayBuffer());
      response.status(webResponse.status).send(body);
    } catch (error) {
      next(error);
    }
  });
}

mountWebHandler('/api/analytics', analyticsHandler);
mountWebHandler('/api/analytics-bills', analyticsBillsHandler);
mountWebHandler('/api/analytics-revoke', analyticsRevokeHandler);
mountWebHandler('/api/analytics-cleanup', analyticsCleanupHandler);
mountWebHandler('/api/admin-login', adminLoginHandler);
mountWebHandler('/api/admin-dashboard', adminDashboardHandler);
mountWebHandler('/api/admin-bills', adminBillsHandler);
mountWebHandler('/api/admin-logout', adminLogoutHandler);

// Share the production handlers so local QA exercises the same validation.
mountWebHandler('/api/operations', operationsHandler);
app.post('/api/scan-bill', async (request, response, next) => {
  try {
    const webRequest = new Request('http://localhost/api/scan-bill', {
      method: 'POST', headers: { ...request.headers, 'x-forwarded-for': request.ip },
      body: request, duplex: 'half',
    });
    const result = await scanBillHandler.fetch(webRequest);
    result.headers.forEach((value, name) => response.setHeader(name, value));
    response.status(result.status).send(Buffer.from(await result.arrayBuffer()));
  } catch (error) { next(error); }
});
app.all('/api/scan-bill', (_request, response) => response.status(405).set('Allow', 'POST').json({ message: 'Method not allowed.' }));

app.use((error, _request, response, next) => {
  if (!error) return next();
  const status = error.status === 413 ? 413 : 400;
  response.status(status).json({ message: 'Could not read this request. Check its format and size.' });
});
app.use('/api', (_request, response) => response.status(404).json({ message: 'API endpoint not found.' }));

if (isProduction) {
  app.use(express.static(path.join(rootDirectory, 'dist')));
  app.use((_request, response) => {
    response.sendFile('index.html', { root: path.join(rootDirectory, 'dist') });
  });
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });

  app.use(vite.middlewares);
}

app.listen(port, () => {
  console.log(`Harn Kun is running at http://localhost:${port}`);
  if (!process.env.TYPHOON_OCR_API_KEY) {
    console.warn('Typhoon OCR is disabled: TYPHOON_OCR_API_KEY is not set.');
  }
});
