import sharp from 'sharp';

const scanCooldowns = new Map();
const SCAN_COOLDOWN_MS = 30_000;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const TYPHOON_OCR_PROMPT = `Read this Thai or English receipt. Return only purchased item rows as one clean HTML table with exactly these columns: item, quantity, total price. Keep item names exactly as printed. Exclude the shop header, address, dates, invoice numbers, subtotal, VAT, discounts, payment, cash, change, QR codes, and explanations.`;

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers });
}

function getClientId(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'anonymous';
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return json({ message: 'Method not allowed.' }, 405, { Allow: 'POST' });
    }

    const clientId = getClientId(request);
    const previousScan = scanCooldowns.get(clientId) || 0;
    const remainingMs = SCAN_COOLDOWN_MS - (Date.now() - previousScan);
    if (remainingMs > 0) {
      const retryAfter = Math.ceil(remainingMs / 1000);
      return json(
        { message: `Please wait ${retryAfter} seconds before scanning another bill.`, retryAfter },
        429,
        { 'Retry-After': String(retryAfter) },
      );
    }

    const apiKey = process.env.TYPHOON_OCR_API_KEY;
    if (!apiKey) {
      return json({ message: 'Typhoon OCR is not configured on Vercel.' }, 503);
    }

    let bill;
    try {
      const formData = await request.formData();
      bill = formData.get('bill');
    } catch {
      return json({ message: 'Could not read the uploaded photo.' }, 400);
    }

    if (!(bill instanceof File) || bill.size === 0) {
      return json({ message: 'Please attach a bill photo.' }, 400);
    }
    if (!bill.type.startsWith('image/')) {
      return json({ message: 'Only bill images are supported.' }, 415);
    }
    if (bill.size > MAX_UPLOAD_BYTES) {
      return json({ message: 'The photo is too large. Please use an image smaller than 4 MB.' }, 413);
    }

    scanCooldowns.set(clientId, Date.now());

    try {
      const inputBuffer = Buffer.from(await bill.arrayBuffer());
      const optimizedImage = await sharp(inputBuffer)
        .rotate()
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .sharpen()
        .jpeg({ quality: 80, chromaSubsampling: '4:4:4' })
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
          max_tokens: 1024,
          repetition_penalty: 1.05,
          temperature: 0.1,
          top_p: 0.6,
        }),
        signal: AbortSignal.timeout(55_000),
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

      return json({ text: extractedText, tsv: '', engine: 'typhoon-ocr' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Unknown OCR error');
      console.error('Typhoon OCR failed:', message);
      return json({ message: `Could not read this image: ${message}` }, 422);
    }
  },
};
