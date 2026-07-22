import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const scanCooldowns = new Map();
const SCAN_COOLDOWN_MS = 30_000;
const billUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const isImage = file.mimetype.startsWith('image/');
    callback(isImage ? null : new Error('Only bill images are supported.'), isImage);
  },
});

const TYPHOON_OCR_PROMPT = `Read this Thai or English receipt. Return only purchased item rows as one clean HTML table with exactly these columns: item, quantity, total price. Keep item names exactly as printed. Exclude the shop header, address, dates, invoice numbers, subtotal, VAT, discounts, payment, cash, change, QR codes, and explanations.`;

app.use(express.json());

function enforceScanCooldown(request, response, next) {
  const clientId = request.ip;
  const previousScan = scanCooldowns.get(clientId) || 0;
  const remainingMs = SCAN_COOLDOWN_MS - (Date.now() - previousScan);

  if (remainingMs > 0) {
    const retryAfter = Math.ceil(remainingMs / 1000);
    response.set('Retry-After', String(retryAfter));
    return response.status(429).json({
      message: `Please wait ${retryAfter} seconds before scanning another bill.`,
      retryAfter,
    });
  }

  scanCooldowns.set(clientId, Date.now());
  next();
}

app.post('/api/scan-bill', enforceScanCooldown, billUpload.single('bill'), async (request, response) => {
  if (!request.file) {
    return response.status(400).json({ message: 'Please attach a bill photo.' });
  }

  const apiKey = process.env.TYPHOON_OCR_API_KEY;
  if (!apiKey) {
    return response.status(503).json({
      message: 'Typhoon OCR is not configured. Set TYPHOON_OCR_API_KEY and restart the server.',
    });
  }

  try {
    const optimizedImage = await sharp(request.file.buffer)
      .rotate()
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .sharpen()
      .jpeg({ quality: 82, chromaSubsampling: '4:4:4' })
      .toBuffer();
    const imageUrl = `data:image/jpeg;base64,${optimizedImage.toString('base64')}`;

    const typhoonResponse = await fetch('https://api.opentyphoon.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'typhoon-ocr',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: TYPHOON_OCR_PROMPT },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        }],
        max_tokens: 2048,
        repetition_penalty: 1.05,
        temperature: 0.1,
        top_p: 0.6,
      }),
      signal: AbortSignal.timeout(120000),
    });

    const responseText = await typhoonResponse.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(`Typhoon returned an invalid response (HTTP ${typhoonResponse.status}).`);
    }

    if (!typhoonResponse.ok) {
      throw new Error(result.error?.message || result.message || `Typhoon request failed with HTTP ${typhoonResponse.status}.`);
    }

    const extractedText = result.choices?.[0]?.message?.content;
    if (typeof extractedText !== 'string' || !extractedText.trim()) {
      throw new Error('Typhoon did not return any receipt text.');
    }

    response.json({ text: extractedText, tsv: '', engine: 'typhoon-ocr' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown OCR error');
    console.error('Typhoon OCR failed:', message);
    response.status(422).json({ message: `Could not read this image: ${message}` });
  }
});

app.post('/api/operations', (request, response) => {
  const { eventName, friends, billItems, allocations, settlements } = request.body;

  if (
    typeof eventName !== 'string' ||
    !eventName.trim() ||
    !Array.isArray(friends) ||
    friends.length < 2 ||
    friends.length > 100 ||
    !Array.isArray(billItems) ||
    billItems.length === 0
  ) {
    return response.status(400).json({ message: 'An event name, 2–100 friends, and bill items are required.' });
  }

  const cleanItems = billItems
    .map((item) => ({
      name: String(item.name || '').trim(),
      quantity: Math.max(1, Number(item.quantity) || 1),
      amount: Math.max(0, Number(item.amount) || 0),
    }))
    .filter((item) => item.name);

  if (cleanItems.length === 0) {
    return response.status(400).json({ message: 'At least one valid bill item is required.' });
  }

  const billTotal = cleanItems.reduce((sum, item) => sum + item.amount, 0);
  const cleanSettlements = Array.isArray(settlements)
    ? settlements.map((settlement) => ({
      name: String(settlement.name || '').trim(),
      amount: Math.max(0, Number(settlement.amount) || 0),
    })).filter((settlement) => settlement.name)
    : [];

  console.log('\n--- New Harn Kun operation ---');
  console.log(`Event: ${eventName.trim()}`);
  console.log(`Friends (${friends.length}): ${friends.join(', ')}`);
  console.log('Bill:');
  cleanItems.forEach((item, index) => {
    console.log(`  ${index + 1}. ${item.name} x${item.quantity} — ฿${item.amount.toFixed(2)}`);
    if (Array.isArray(allocations?.[index])) {
      console.log(`     Shared by: ${allocations[index].join(', ')}`);
    }
  });
  console.log(`SUM: ฿${billTotal.toFixed(2)}`);
  if (cleanSettlements.length > 0) {
    console.log('Each person pays:');
    cleanSettlements.forEach((settlement) => {
      console.log(`  ${settlement.name} — ฿${settlement.amount.toFixed(2)}`);
    });
  }
  console.log('------------------------------\n');

  response.status(201).json({ message: 'Operation received.', total: billTotal });
});

app.use((error, _request, response, next) => {
  if (!error) return next();
  const status = error instanceof multer.MulterError ? 400 : 415;
  response.status(status).json({ message: error.message || 'Could not upload this image.' });
});

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
