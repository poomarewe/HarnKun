import sharp from 'sharp';

const scanCooldowns = new Map();
const SCAN_COOLDOWN_MS = 30_000;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const TYPHOON_OCR_PROMPT = `Read this Thai or English receipt. Return only purchased item rows as one clean HTML table with exactly these columns: item, quantity, total price. Keep item names exactly as printed. Exclude the shop header, address, dates, invoice numbers, subtotal, VAT, discounts, payment, cash, change, QR codes, and explanations.`;

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function cooldownResponse(clientId) {
  const remainingMs = SCAN_COOLDOWN_MS - (Date.now() - (scanCooldowns.get(clientId) || 0));
  if (remainingMs <= 0) return null;
  const retryAfter = Math.ceil(remainingMs / 1000);
  return json({ message: `Please wait ${retryAfter} seconds before scanning another bill.`, retryAfter }, 429, { 'Retry-After': String(retryAfter) });
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
    const cooldown = cooldownResponse(clientId);
    if (cooldown) return cooldown;

    const apiKey = process.env.TYPHOON_OCR_API_KEY;
    if (!apiKey) {
      return json({ message: 'Typhoon OCR is not configured on Vercel.' }, 503);
    }

    let bill;
    if (Number(request.headers.get('content-length')) > MAX_UPLOAD_BYTES + 64 * 1024) {
      return json({ message: 'The upload is too large. Use a photo smaller than 4 MB.' }, 413);
    }
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

    // Form parsing yields; recheck before reserving to stop concurrent same-IP scans.
    const pendingCooldown = cooldownResponse(clientId);
    if (pendingCooldown) return pendingCooldown;
    for (const [id, started] of scanCooldowns) {
      if (Date.now() - started >= SCAN_COOLDOWN_MS) scanCooldowns.delete(id);
    }
    if (scanCooldowns.size >= 10_000) return json({ message: 'The scan service is busy. Please try again shortly.' }, 429, { 'Retry-After': '30' });
    scanCooldowns.set(clientId, Date.now());

    let providerStarted = false;
    try {
      const inputBuffer = Buffer.from(await bill.arrayBuffer());
      const image = sharp(inputBuffer, { limitInputPixels: 40_000_000 });
      const metadata = await image.metadata();
      if (!['jpeg', 'png', 'webp', 'gif', 'tiff', 'heif'].includes(metadata.format)) {
        return json({ message: 'Use a JPEG, PNG, WebP, GIF, TIFF or supported HEIF receipt photo.' }, 415);
      }
      const optimizedImage = await image
        .rotate()
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .sharpen()
        .jpeg({ quality: 80, chromaSubsampling: '4:4:4' })
        .toBuffer();
      const imageUrl = `data:image/jpeg;base64,${optimizedImage.toString('base64')}`;

      providerStarted = true;
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

      if (!typhoonResponse.ok) {
        if (typhoonResponse.status === 429) {
          const retryAfter = Math.min(300, Math.max(30, Number(typhoonResponse.headers.get('retry-after')) || 30));
          return json({ message: 'The scan service is busy. Please wait before trying again, or type the items.', retryAfter }, 429, { 'Retry-After': String(retryAfter) });
        }
        return json({ message: 'The scan service is temporarily unavailable. Please try again or type the items.' }, 503);
      }
      const responseText = await typhoonResponse.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch {
        return json({ message: 'The scan service returned an unreadable response. Please try again or type the items.' }, 502);
      }

      const extractedText = result?.choices?.[0]?.message?.content;
      if (typeof extractedText !== 'string' || !extractedText.trim()) {
        return json({ message: 'No receipt text was found. Try a clearer photo or type the items.' }, 422);
      }

      return json({ text: extractedText, tsv: '', engine: 'typhoon-ocr' });
    } catch (error) {
      if (!providerStarted) return json({ message: 'This image could not be opened. Choose a supported photo or type the items.' }, 415);
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        return json({ message: 'The scan took too long. Please try again or type the items.' }, 504);
      }
      return json({ message: 'Could not reach the scan service. Check your connection or type the items.' }, 503);
    }
  },
};
