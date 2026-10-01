import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { SpeedInsights } from '@vercel/speed-insights/react';
import '@fontsource/mali/400.css';
import '@fontsource/mali/600.css';
import '@fontsource/mali/700.css';
import { BitsButton, BitsSurface } from './ReactBitsUI';
import StaggeredMenu from './StaggeredMenu';
import GuidedWorkflowView from './GuidedWorkflowView';
import DoodleField, { Doodle } from './DecorativeDoodles';
import AdminPanel from './AdminPanel';
import useVisitorAnalytics from './useVisitorAnalytics';
import './critical.css';
import './clay-home.css';
import './maggie-home.css';
import './doodles.css';

const APP_VERSION = __APP_VERSION__;
const APP_VERSION_TIME = __APP_VERSION_TIME__;
const PHONE_LAYOUT_QUERY = '(max-width: 699px), (pointer: coarse) and (max-height: 600px)';
let appStylesPromise;

const loadAppStyles = () => {
  if (!appStylesPromise) {
    appStylesPromise = import('./styles.css')
      .then(() => import('./clay.css'))
      .then(() => import('./maggie-workflow.css'));
  }
  return appStylesPromise;
};

const SHARE_HISTORY_URL = 'https://harn.fun/history';
const SHARE_QR_OPTIONS = {
  margin: 2,
  errorCorrectionLevel: 'M',
  color: { dark: '#0F172A', light: '#FFFFFF' },
};
const historyQrCache = new Map();

function NetworkStatusPill() {
  const startsOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  const [networkNotice, setNetworkNotice] = useState(startsOffline ? 'offline' : null);
  const wasOfflineRef = useRef(startsOffline);

  useEffect(() => {
    let hideTimer;

    const showOffline = () => {
      window.clearTimeout(hideTimer);
      wasOfflineRef.current = true;
      setNetworkNotice('offline');
    };

    const showOnline = () => {
      if (!wasOfflineRef.current) return;
      wasOfflineRef.current = false;
      setNetworkNotice('online');
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setNetworkNotice(null), 3200);
    };

    window.addEventListener('offline', showOffline);
    window.addEventListener('online', showOnline);
    return () => {
      window.clearTimeout(hideTimer);
      window.removeEventListener('offline', showOffline);
      window.removeEventListener('online', showOnline);
    };
  }, []);

  if (!networkNotice) return null;

  return createPortal(
    <div className={`network-status-pill is-${networkNotice}`} role="status" aria-live="polite">
      <span aria-hidden="true" />
      {networkNotice === 'offline' ? 'You’re offline' : 'Back online'}
    </div>,
    document.body,
  );
}

async function encodeSharedReceipt(record) {
  const friendIndexes = new Map(record.friends.map((friend, index) => [friend, index]));
  const compactReceipt = {
    v: 1,
    n: record.eventName,
    f: record.friends,
    i: record.billItems.map((item, index) => [
      item.name,
      Number(item.quantity) || 1,
      Number(item.amount) || 0,
      (record.allocations[index] || []).map((friend) => friendIndexes.get(friend)).filter(Number.isInteger),
    ]),
    s: record.friends.map((friend) => Number(record.settlements.find((entry) => entry.name === friend)?.amount) || 0),
    a: [record.vatEnabled ? Number(record.vatRate) || 0 : 0, record.discountEnabled ? Number(record.discountAmount) || 0 : 0],
    d: Number(record.updatedAt) || Date.now(),
  };
  const { gzipSync, strToU8 } = await import('fflate');
  const bytes = gzipSync(strToU8(JSON.stringify(compactReceipt)), { level: 9 });
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return `z${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
}

async function decodeSharedReceipt(value) {
  const isCompressed = value.startsWith('z');
  const encodedValue = isCompressed ? value.slice(1) : value;
  const padded = encodedValue.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - encodedValue.length % 4) % 4);
  const binary = atob(padded);
  let bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (isCompressed) {
    const { gunzipSync } = await import('fflate');
    bytes = gunzipSync(bytes);
  }
  const compact = JSON.parse(new TextDecoder().decode(bytes));
  if (compact.v !== 1 || typeof compact.n !== 'string' || !Array.isArray(compact.f) || !Array.isArray(compact.i)) {
    throw new Error('Unsupported shared receipt.');
  }
  const friends = compact.f.map(String).slice(0, 100);
  const billItems = compact.i.map(([name, quantity, amount]) => ({
    name: String(name || ''),
    quantity: Math.max(1, Number(quantity) || 1),
    amount: Math.max(0, Number(amount) || 0),
  })).filter((item) => item.name);
  const allocations = compact.i.map((item) => Array.isArray(item[3])
    ? item[3].map((index) => friends[index]).filter(Boolean)
    : []);
  const settlements = friends.map((name, index) => ({ name, amount: Math.max(0, Number(compact.s?.[index]) || 0) }));
  const subtotal = billItems.reduce((sum, item) => sum + item.amount, 0);
  const vatRate = Math.max(0, Number(compact.a?.[0]) || 0);
  const discountAmount = Math.max(0, Number(compact.a?.[1]) || 0);
  const vatAmount = subtotal * vatRate / 100;
  return {
    id: `shared-${value.slice(0, 18)}`,
    eventName: compact.n,
    friends,
    billItems,
    allocations,
    settlements,
    subtotal,
    vatEnabled: vatRate > 0,
    vatRate,
    vatAmount,
    discountEnabled: discountAmount > 0,
    discountAmount,
    total: Math.max(0, subtotal + vatAmount - discountAmount),
    createdAt: Number(compact.d) || Date.now(),
    updatedAt: Number(compact.d) || Date.now(),
    isShared: true,
  };
}

function BillShareQr({ record }) {
  const cacheKey = `${record.id || record.eventName}-${record.updatedAt}-${record.total}`;
  const [qrShare, setQrShare] = useState(() => historyQrCache.get(cacheKey) || null);
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = historyQrCache.get(cacheKey);
    if (cached) {
      setQrShare(cached);
      return () => { cancelled = true; };
    }

    setQrShare(null);
    const generateQr = async () => {
      try {
        const shareUrl = `${SHARE_HISTORY_URL}?r=${await encodeSharedReceipt(record)}`;
        const { default: QRCode } = await import('qrcode');
        const imageUrl = await QRCode.toDataURL(shareUrl, {
          ...SHARE_QR_OPTIONS,
          width: 512,
        });
        const generatedShare = { shareUrl, imageUrl };
        historyQrCache.set(cacheKey, generatedShare);
        if (!cancelled) setQrShare(generatedShare);
      } catch (qrError) {
        console.error('Could not generate bill QR code:', qrError);
      }
    };
    generateQr();

    return () => { cancelled = true; };
  }, [cacheKey, record]);

  useEffect(() => {
    if (!qrOpen) return undefined;
    document.documentElement.classList.add('qr-preview-open');
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setQrOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.documentElement.classList.remove('qr-preview-open');
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [qrOpen]);

  return (
    <section className="history-share-qr" aria-label="Share this bill">
      <strong>Scan to see full detail</strong>
      {qrShare ? (
        <button type="button" className="history-share-qr-button" onClick={() => setQrOpen(true)} aria-label="Enlarge this bill QR code">
          <img src={qrShare.imageUrl} alt="QR code for this bill's read-only details" />
        </button>
      ) : (
        <div className="history-share-qr-loading" role="status" aria-label="Generating QR code" />
      )}
      {qrOpen && qrShare && createPortal(
        <div className="history-qr-modal-backdrop" role="presentation" onPointerDown={() => setQrOpen(false)}>
          <section className="history-qr-modal" role="dialog" aria-modal="true" aria-label="Bill QR code" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" className="history-qr-modal-close" onClick={() => setQrOpen(false)} aria-label="Close QR code">×</button>
            <strong>Scan to see full detail</strong>
            <a className="history-qr-modal-link" href={qrShare.shareUrl} target="_blank" rel="noreferrer" aria-label="Open the real read-only bill link">
              <img src={qrShare.imageUrl} alt="Large QR code for this bill's read-only details" />
            </a>
            <a className="history-qr-open-link" href={qrShare.shareUrl} target="_blank" rel="noreferrer">Open bill detail ↗</a>
          </section>
        </div>,
        document.body,
      )}
    </section>
  );
}

const createAutomaticEventName = () => {
  const dateTime = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
  return `Bill · ${dateTime}`;
};

const RANDOM_HISTORY_EVENTS = ['Team lunch', 'Friday dinner', 'Coffee run', 'Weekend brunch', 'Game night'];
const RANDOM_HISTORY_FRIENDS = ['Aom', 'Beam', 'Fern', 'Gun', 'May', 'Mint', 'New', 'Palm'];
const RANDOM_HISTORY_ITEMS = [
  ['Pad Thai', 80, 140],
  ['Fried rice', 70, 130],
  ['Green curry', 110, 180],
  ['Som tam', 70, 120],
  ['Grilled chicken', 120, 220],
  ['Milk tea', 45, 85],
  ['Iced coffee', 55, 95],
  ['Mango sticky rice', 90, 150],
];

const randomInteger = (minimum, maximum) => Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
const shuffled = (values) => [...values].sort(() => Math.random() - 0.5);

function createRandomHistoryRecord() {
  const friends = shuffled(RANDOM_HISTORY_FRIENDS).slice(0, randomInteger(2, 5));
  const billItems = shuffled(RANDOM_HISTORY_ITEMS).slice(0, randomInteger(2, 6)).map(([name, minimum, maximum]) => ({
    name,
    quantity: 1,
    amount: randomInteger(minimum, maximum),
  }));
  const allocations = billItems.map(() => shuffled(friends).slice(0, randomInteger(1, friends.length)));
  const subtotal = billItems.reduce((sum, item) => sum + item.amount, 0);
  const vatEnabled = Math.random() < 0.4;
  const vatRate = vatEnabled ? 7 : 0;
  const vatAmount = Math.round(subtotal * vatRate) / 100;
  const discountEnabled = Math.random() < 0.3;
  const discountAmount = discountEnabled ? randomInteger(1, Math.max(1, Math.min(100, Math.floor(subtotal * 0.12)))) : 0;
  const total = Math.max(0, Math.round((subtotal + vatAmount - discountAmount) * 100) / 100);
  const centsByFriend = Object.fromEntries(friends.map((friend) => [friend, 0]));

  billItems.forEach((item, itemIndex) => {
    const selectedFriends = allocations[itemIndex];
    const itemCents = Math.round(item.amount * 100);
    const baseShare = Math.floor(itemCents / selectedFriends.length);
    const remainder = itemCents % selectedFriends.length;
    selectedFriends.forEach((friend, friendIndex) => {
      centsByFriend[friend] += baseShare + (friendIndex < remainder ? 1 : 0);
    });
  });

  const assignedCents = Object.values(centsByFriend).reduce((sum, amount) => sum + amount, 0);
  const targetCents = Math.round(total * 100);
  const proportional = friends.map((friend) => ({
    friend,
    exact: assignedCents > 0 ? centsByFriend[friend] * targetCents / assignedCents : 0,
  }));
  const settlementCents = Object.fromEntries(proportional.map(({ friend, exact }) => [friend, Math.floor(exact)]));
  const distributedCents = Object.values(settlementCents).reduce((sum, amount) => sum + amount, 0);
  proportional
    .sort((left, right) => (right.exact - Math.floor(right.exact)) - (left.exact - Math.floor(left.exact)))
    .slice(0, targetCents - distributedCents)
    .forEach(({ friend }) => { settlementCents[friend] += 1; });

  const now = Date.now();
  return {
    id: globalThis.crypto?.randomUUID?.() || `random-${now}-${Math.random().toString(36).slice(2)}`,
    eventName: RANDOM_HISTORY_EVENTS[randomInteger(0, RANDOM_HISTORY_EVENTS.length - 1)],
    friends,
    billItems,
    allocations,
    settlements: friends.map((name) => ({ name, amount: settlementCents[name] / 100 })),
    subtotal,
    vatEnabled,
    vatRate,
    vatAmount,
    discountEnabled,
    discountAmount,
    total,
    createdAt: now,
    updatedAt: now,
  };
}

const THAI_DIGITS = { '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4', '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9' };
const SUMMARY_WORDS = /(?:ยอดรวม|รวมมูลค่า|รวมทั้งสิ้น|ยอดสุทธิ|สุทธิ|จำนวน\s*\d*\s*ชิ้น|subtotal|total|vat|ภาษี|service|ค่าบริการ|ส่วนลด|discount|เงินสด|เงินทอน|change|ชำระ)/i;
const META_WORDS = /(?:ใบเสร็จ|receipt|invoice|tax\s*id|เลขประจำตัว|โทร|tel|โต๊ะ|table|คิว|queue|วันที่|date|เวลา|time|พนักงาน|cashier|pos\s*#|สาขา|บริษัท|line\s*[:@]|powered)/i;

const HISTORY_CATEGORIES = [
  { key: 'rent', label: 'Rent & home', keywords: ['rent', 'apartment', 'condo', 'housing', 'mortgage', 'landlord', 'ค่าเช่า', 'ห้อง', 'บ้าน', 'คอนโด'] },
  { key: 'travel', label: 'Travel', keywords: ['travel', 'trip', 'taxi', 'grab', 'bolt', 'train', 'bus', 'flight', 'airline', 'hotel', 'fuel', 'petrol', 'toll', 'parking', 'airport', 'เดินทาง', 'รถ', 'แท็กซี่', 'น้ำมัน', 'ทางด่วน', 'โรงแรม', 'ตั๋ว'] },
  { key: 'utilities', label: 'Utilities', keywords: ['electric', 'electricity', 'water bill', 'internet', 'wifi', 'phone bill', 'utility', 'mobile plan', 'ค่าไฟ', 'ค่าน้ำ', 'อินเทอร์เน็ต', 'โทรศัพท์'] },
  { key: 'health', label: 'Health', keywords: ['hospital', 'clinic', 'medicine', 'pharmacy', 'doctor', 'dentist', 'health', 'gym', 'โรงพยาบาล', 'คลินิก', 'ร้านยา', 'หมอ', 'ทันตแพทย์', 'ฟิตเนส'] },
  { key: 'entertainment', label: 'Entertainment', keywords: ['movie', 'cinema', 'game', 'concert', 'karaoke', 'netflix', 'spotify', 'party', 'หนัง', 'เกม', 'คอนเสิร์ต', 'คาราโอเกะ', 'ปาร์ตี้'] },
  { key: 'shopping', label: 'Shopping', keywords: ['shopping', 'mall', 'clothes', 'grocery', 'supermarket', 'shoes', 'electronics', 'lazada', 'shopee', 'ช็อป', 'เสื้อ', 'รองเท้า', 'ซื้อของ', 'ห้าง'] },
  { key: 'food', label: 'Food & drink', keywords: ['food', 'lunch', 'dinner', 'breakfast', 'brunch', 'cafe', 'coffee', 'tea', 'restaurant', 'pizza', 'burger', 'chicken', 'curry', 'rice', 'noodle', 'pad thai', 'som tam', 'meal', 'dessert', 'cake', 'อาหาร', 'ข้าว', 'กาแฟ', 'ชา', 'ขนม', 'ร้านอาหาร', 'ส้มตำ', 'ก๋วยเตี๋ยว'] },
];

function matchesHistoryKeyword(searchableText, keyword) {
  if (!/^[a-z0-9 ]+$/i.test(keyword)) return searchableText.includes(keyword);
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`\\b${escapedKeyword}\\b`, 'i').test(searchableText);
}

function getHistoryCategory(record) {
  const searchableText = [record.eventName, ...(record.billItems || []).map((item) => item.name)].join(' ').toLocaleLowerCase();
  return HISTORY_CATEGORIES.find((category) => category.keywords.some((keyword) => matchesHistoryKeyword(searchableText, keyword)))
    || { key: 'general', label: 'General expense' };
}

function HistoryCategoryIcon({ record }) {
  const category = getHistoryCategory(record);
  let icon;

  switch (category.key) {
    case 'food':
      icon = <><path d="M7 3v7m-3-7v4a3 3 0 0 0 6 0V3M7 10v11M17 3c-2 3-2 7 0 9m0-9v18" /></>;
      break;
    case 'rent':
      icon = <><path d="m3 11 9-8 9 8" /><path d="M5 10v11h14V10M9 21v-7h6v7" /></>;
      break;
    case 'travel':
      icon = <><path d="M22 2 9.5 14.5M22 2l-7 20-4-8-8-4Z" /></>;
      break;
    case 'shopping':
      icon = <><path d="M5 8h14l-1 13H6L5 8Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></>;
      break;
    case 'utilities':
      icon = <><path d="m13 2-7 12h6l-1 8 7-12h-6l1-8Z" /></>;
      break;
    case 'entertainment':
      icon = <><path d="M4 5h16v14H4z" /><path d="m10 9 5 3-5 3Z" /></>;
      break;
    case 'health':
      icon = <><path d="M12 21S4 16.5 4 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 16.5 12 21 12 21Z" /><path d="M9 12h6m-3-3v6" /></>;
      break;
    default:
      icon = <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6m-6 4h6" /></>;
  }

  return (
    <span className={`history-card-category is-${category.key}`} title={category.label} aria-label={category.label}>
      <svg viewBox="0 0 24 24" aria-hidden="true">{icon}</svg>
    </span>
  );
}

function getHistoryDayStart(timestamp) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatHistoryDayLabel(dayStart) {
  const today = getHistoryDayStart(Date.now());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayStart === today) return 'Today';
  if (dayStart === yesterday.getTime()) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(dayStart);
}

function normalizeThaiDigits(value) {
  return value.replace(/[๐-๙]/g, (digit) => THAI_DIGITS[digit]);
}

function cleanOcrLine(value) {
  let line = normalizeThaiDigits(value).replace(/[|_]+/g, ' ').replace(/\s+/g, ' ').trim();
  let previous;
  do {
    previous = line;
    line = line.replace(/([\u0E00-\u0E7F])\s+(?=[\u0E00-\u0E7F])/g, '$1');
  } while (line !== previous);
  return line;
}

function parseMoney(value) {
  const cleaned = normalizeThaiDigits(value).replace(/[฿บาท,N\s]/gi, '').replace(',', '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : null;
}

function extractTrailingQuantity(itemName, currentQuantity = 1) {
  if (currentQuantity !== 1) return { name: itemName, quantity: currentQuantity };
  const match = itemName.match(/^(.*\S)\s+(?:[xX×]\s*)?(\d{1,3})$/);
  if (!match) return { name: itemName, quantity: currentQuantity };

  const quantity = Number(match[2]);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    return { name: itemName, quantity: currentQuantity };
  }
  return { name: match[1].trim(), quantity };
}

function selectWholeValue(event) {
  const input = event.currentTarget;
  input.select();
  window.requestAnimationFrame(() => input.select());
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not compress this photo.'))),
      'image/jpeg',
      quality,
    );
  });
}

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not create the summary picture.'))),
      'image/png',
    );
  });
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function downloadBlob(blob, fileName) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();

  // WebKit needs the object URL to remain alive until the download has started.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

async function prepareBillUpload(file) {
  const targetBytes = 3.8 * 1024 * 1024;
  if (file.size <= targetBytes) return file;

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let blob = await canvasToJpeg(canvas, 0.8);
  if (blob.size > targetBytes) blob = await canvasToJpeg(canvas, 0.62);
  if (blob.size > targetBytes) throw new Error('This photo is still too large after compression.');

  return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'bill'}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

function parseThaiBillText(ocrText) {
  return ocrText
    .split(/\r?\n/)
    .map(cleanOcrLine)
    .filter(Boolean)
    .reduce((items, line) => {
      if (SUMMARY_WORDS.test(line) || META_WORDS.test(line)) return items;
      const tokens = line.split(' ');
      const moneyTokens = tokens
        .map((token, index) => ({ index, amount: parseMoney(token), hasDecimal: /[.,]\d{1,2}/.test(token) }))
        .filter((token) => token.amount !== null);
      const amountToken = [...moneyTokens].reverse().find((token) => token.hasDecimal)
        || (moneyTokens.length > 1 ? moneyTokens[moneyTokens.length - 1] : null);
      if (!amountToken || amountToken.amount > 1000000) return items;

      const firstTokenAmount = parseMoney(tokens[0]);
      const hasLeadingQuantity = firstTokenAmount !== null && firstTokenAmount >= 1 && firstTokenAmount <= 100;
      let quantity = hasLeadingQuantity ? firstTokenAmount : 1;
      const nameStart = hasLeadingQuantity ? 1 : 0;
      let name = cleanOcrLine(tokens.slice(nameStart, amountToken.index).join(' ')).replace(/[.·:=-]+$/g, '').trim();
      ({ name, quantity } = extractTrailingQuantity(name, quantity));
      if (name.length < 2 || !/[A-Za-z\u0E00-\u0E7F]/.test(name)) return items;

      items.push({ name, quantity, amount: amountToken.amount });
      return items;
    }, []);
}

function parseThaiBillTsv(tsv) {
  if (!tsv) return [];
  const lines = new Map();

  tsv.split(/\r?\n/).slice(1).forEach((row) => {
    const columns = row.split('\t');
    if (columns.length < 12 || columns[0] !== '5' || !columns[11].trim()) return;
    const key = `${columns[1]}-${columns[2]}-${columns[3]}-${columns[4]}`;
    const word = { left: Number(columns[6]) || 0, text: columns[11].trim() };
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(word);
  });

  return [...lines.values()].reduce((items, words) => {
    const orderedWords = words.sort((a, b) => a.left - b.left);
    const fullLine = cleanOcrLine(orderedWords.map((word) => word.text).join(' '));
    if (SUMMARY_WORDS.test(fullLine) || META_WORDS.test(fullLine)) return items;

    const numericWords = orderedWords
      .map((word, index) => ({ ...word, index, amount: parseMoney(word.text), hasDecimal: /[.,]\d{1,2}/.test(word.text) }))
      .filter((word) => word.amount !== null);
    const amountWord = [...numericWords].reverse().find((word) => word.hasDecimal);
    if (!amountWord || amountWord.amount > 1000000) return items;

    const firstWordAmount = parseMoney(orderedWords[0]?.text || '');
    const hasQuantity = firstWordAmount !== null && firstWordAmount >= 1 && firstWordAmount <= 100 && orderedWords[0].left < amountWord.left;
    let quantity = hasQuantity ? firstWordAmount : 1;
    const nameStart = hasQuantity ? 1 : 0;
    let name = cleanOcrLine(orderedWords.slice(nameStart, amountWord.index).map((word) => word.text).join(' '))
      .replace(/[.·:=-]+$/g, '')
      .trim();
    ({ name, quantity } = extractTrailingQuantity(name, quantity));

    if (name.length < 2 || !/[A-Za-z\u0E00-\u0E7F]/.test(name)) return items;
    items.push({ name, quantity, amount: amountWord.amount });
    return items;
  }, []);
}

function parseTyphoonTables(ocrText) {
  if (!ocrText.includes('<table')) return [];
  const documentNode = new DOMParser().parseFromString(ocrText, 'text/html');

  return [...documentNode.querySelectorAll('tr')].reduce((items, row) => {
    const cells = [...row.querySelectorAll('th, td')].map((cell) => cleanOcrLine(cell.textContent || ''));
    const fullLine = cells.join(' ');
    if (cells.length < 2 || SUMMARY_WORDS.test(fullLine) || META_WORDS.test(fullLine)) return items;

    const numericCells = cells
      .map((cell, index) => ({ index, amount: parseMoney(cell), hasDecimal: /[.,]\d{1,2}/.test(cell) }))
      .filter((cell) => cell.amount !== null);
    const amountCell = [...numericCells].reverse().find((cell) => cell.hasDecimal)
      || numericCells[numericCells.length - 1]
      || null;
    if (!amountCell || amountCell.amount > 1000000) return items;

    const firstCellAmount = parseMoney(cells[0]);
    const hasQuantity = firstCellAmount !== null && firstCellAmount >= 1 && firstCellAmount <= 100;
    let quantity = hasQuantity ? firstCellAmount : 1;
    const nameStart = hasQuantity ? 1 : 0;
    let name = cleanOcrLine(cells.slice(nameStart, amountCell.index).join(' '));
    ({ name, quantity } = extractTrailingQuantity(name, quantity));
    if (name.length < 2 || !/[A-Za-z\u0E00-\u0E7F]/.test(name)) return items;

    items.push({ name, quantity, amount: amountCell.amount });
    return items;
  }, []);
}

function parseThaiBill(ocrText, tsv) {
  const positionalItems = parseThaiBillTsv(tsv);
  if (positionalItems.length > 0) return positionalItems;
  const tableItems = parseTyphoonTables(ocrText);
  return tableItems.length > 0 ? tableItems : parseThaiBillText(ocrText);
}

const HISTORY_DATABASE = 'harn-kun-history';
const HISTORY_STORE = 'operations';

function openHistoryDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HISTORY_DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(HISTORY_STORE)) {
        database.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveHistoryRecord(record) {
  const database = await openHistoryDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(HISTORY_STORE, 'readwrite');
    transaction.objectStore(HISTORY_STORE).put(record);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

async function readHistoryRecords() {
  const database = await openHistoryDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(HISTORY_STORE, 'readonly');
    const request = transaction.objectStore(HISTORY_STORE).getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.updatedAt - a.updatedAt));
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

async function clearHistoryRecords() {
  const database = await openHistoryDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(HISTORY_STORE, 'readwrite');
    transaction.objectStore(HISTORY_STORE).clear();
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

async function deleteHistoryRecord(recordId) {
  const database = await openHistoryDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(HISTORY_STORE, 'readwrite');
    transaction.objectStore(HISTORY_STORE).delete(recordId);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

function App() {
  useVisitorAnalytics();
  const isSharedHistoryRoute = window.location.pathname === '/history';
  const [showIntro, setShowIntro] = useState(() => {
    if (typeof window === 'undefined' || isSharedHistoryRoute) return false;
    return true;
  });
  const theme = 'finance';
  const [isCreating, setIsCreating] = useState(false);
  const [isWorkflowClosing, setIsWorkflowClosing] = useState(false);
  const [hasActiveDraft, setHasActiveDraft] = useState(false);
  const [historyView, setHistoryView] = useState(null);
  const [historyRecords, setHistoryRecords] = useState([]);
  const [selectedHistory, setSelectedHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySort, setHistorySort] = useState('newest');
  const [sortDrawerOpen, setSortDrawerOpen] = useState(false);
  const [clearHistoryConfirmOpen, setClearHistoryConfirmOpen] = useState(false);
  const [menuOpenRequest, setMenuOpenRequest] = useState(0);
  const [menuCloseRequest, setMenuCloseRequest] = useState(0);
  const [homeHistorySwipe, setHomeHistorySwipe] = useState({ id: null, offset: 0, holding: false });
  const [removingHistoryId, setRemovingHistoryId] = useState(null);
  const [historyDeleteInputLocked, setHistoryDeleteInputLocked] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [step, setStep] = useState('friends');
  const [peopleNameConfirmed, setPeopleNameConfirmed] = useState(false);
  const [manualComposerOpen, setManualComposerOpen] = useState(false);
  const [manualItemName, setManualItemName] = useState('');
  const [manualItemPrice, setManualItemPrice] = useState('');
  const [manualQuantity, setManualQuantity] = useState('1');
  const [showManualQuantity, setShowManualQuantity] = useState(false);
  const [showBillExtras, setShowBillExtras] = useState(false);
  const [workflowDirection, setWorkflowDirection] = useState('forward');
  const [eventName, setEventName] = useState('');
  const [friendName, setFriendName] = useState('');
  const [friends, setFriends] = useState([]);
  const [billImageUrl, setBillImageUrl] = useState('');
  const [billPhotoOpen, setBillPhotoOpen] = useState(false);
  const [cameraFlow, setCameraFlow] = useState(null);
  const [pendingCameraUrl, setPendingCameraUrl] = useState('');
  const [cropBaseSize, setCropBaseSize] = useState({ width: 0, height: 0 });
  const [cropTransform, setCropTransform] = useState({ x: 0, y: 0, zoom: 1, rotation: 0 });
  const [cropAspect, setCropAspect] = useState('16:9');
  const [isCropping, setIsCropping] = useState(false);
  const [billItems, setBillItems] = useState([]);
  const [vatEnabled, setVatEnabled] = useState(false);
  const [vatRate, setVatRate] = useState(7);
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [editingBillIndex, setEditingBillIndex] = useState(null);
  const [ocrStatus, setOcrStatus] = useState('idle');
  const [ocrProgress, setOcrProgress] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [rawOcrText, setRawOcrText] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [allocations, setAllocations] = useState([]);
  const [splitIndex, setSplitIndex] = useState(0);
  const [settlements, setSettlements] = useState([]);
  const inputRef = useRef(null);
  const manualNameRef = useRef(null);
  const cameraInputRef = useRef(null);
  const uploadInputRef = useRef(null);
  const cropWorkspaceRef = useRef(null);
  const cropFrameRef = useRef(null);
  const cropImageRef = useRef(null);
  const cropPointersRef = useRef(new Map());
  const cropGestureRef = useRef(null);
  const homeHistorySwipeRef = useRef(null);
  const homeHistoryClickGuardRef = useRef(null);
  const sortDrawerRef = useRef(null);
  const homeCreateButtonRef = useRef(null);
  const billListRef = useRef(null);
  const billEditorRef = useRef(null);
  const workflowCloseTimerRef = useRef(null);
  const pageInteractionBlockersRef = useRef(null);
  pageInteractionBlockersRef.current = { isCreating, billPhotoOpen, clearHistoryConfirmOpen, historyView };

  useEffect(() => {
    if (!showIntro) return undefined;
    const finishIntro = window.setTimeout(() => setShowIntro(false), 3900);
    return () => window.clearTimeout(finishIntro);
  }, [showIntro]);

  useEffect(() => {
    const themeBackground = '#ffffff';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.style.backgroundColor = themeBackground;
    document.body.style.backgroundColor = themeBackground;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeBackground);
    try {
      window.localStorage.setItem('harn-kun-theme', theme);
    } catch {
      // The theme still works when storage is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    if (isSharedHistoryRoute) return undefined;
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, [isSharedHistoryRoute]);

  useEffect(() => {
    if (isSharedHistoryRoute) return undefined;
    let pageState = 'hero';
    let transitionTimer;
    let recentTopHoldTimer;

    const recentPage = document.querySelector('.home-history-panel');
    const appRoot = document.querySelector('.app.maggie-app');
    if (!recentPage || !appRoot) return undefined;

    const recentList = recentPage.querySelector('.home-history-list');
    const hasRecentBills = () => Boolean(recentList?.querySelector('.home-history-card'));
    const getRecentPageTop = () => recentPage.getBoundingClientRect().top + window.scrollY;
    const setRecentPageMode = (nextMode) => {
      if (appRoot.classList.contains('is-recent-page') === nextMode) return;
      const button = homeCreateButtonRef.current;
      const startRect = button?.getBoundingClientRect();
      appRoot.classList.toggle('is-recent-page', nextMode);
      if (!button || !startRect || typeof button.animate !== 'function') return;

      window.requestAnimationFrame(() => {
        const endRect = button.getBoundingClientRect();
        const deltaY = startRect.top - endRect.top;
        const startTransform = nextMode
          ? `translate(-50%, ${deltaY}px)`
          : `translateY(${deltaY}px)`;
        button.animate([
          { transform: startTransform, width: `${startRect.width}px`, height: `${startRect.height}px` },
          { transform: nextMode ? 'translateX(-50%)' : 'none', width: `${endRect.width}px`, height: `${endRect.height}px` },
        ], {
          duration: 520,
          easing: 'cubic-bezier(.2, .75, .25, 1)',
        });
      });
    };
    const scheduleRecentTopReady = () => {
      window.clearTimeout(recentTopHoldTimer);
      recentTopHoldTimer = window.setTimeout(() => {
        if (pageState === 'recent-top-hold') pageState = 'recent-top-ready';
      }, 500);
    };
    const holdAtRecentTop = () => {
      pageState = 'recent-top-hold';
      window.clearTimeout(transitionTimer);
      if (document.scrollingElement) document.scrollingElement.scrollTop = getRecentPageTop();
      scheduleRecentTopReady();
    };
    const enterRecentPage = () => {
      pageState = 'entering-recent';
      setRecentPageMode(true);
      window.scrollTo({ top: getRecentPageTop(), behavior: 'smooth' });
      transitionTimer = window.setTimeout(() => {
        if (pageState === 'entering-recent') pageState = 'recent-list';
      }, 850);
    };
    const leaveRecentPage = () => {
      window.clearTimeout(recentTopHoldTimer);
      pageState = 'leaving-recent';
      setRecentPageMode(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      transitionTimer = window.setTimeout(() => {
        if (pageState === 'leaving-recent') pageState = 'hero';
      }, 850);
    };
    const syncRecentPageMode = () => {
      if (window.matchMedia(PHONE_LAYOUT_QUERY).matches) return;
      if (pageState === 'entering-recent' || pageState === 'leaving-recent' || pageState === 'recent-top-hold') return;
      const recentPageTop = getRecentPageTop();
      if ((pageState === 'recent-list' || pageState === 'recent-top-ready') && window.scrollY < recentPageTop - 4) {
        if (recentList && recentList.scrollTop > 1) {
          if (document.scrollingElement) document.scrollingElement.scrollTop = recentPageTop;
          return;
        }
        holdAtRecentTop();
        return;
      }
      if (pageState === 'recent-top-ready' && window.scrollY > recentPageTop + 4) {
        pageState = 'recent-list';
      }
      if (pageState === 'hero' && window.scrollY >= recentPageTop - 4) {
        pageState = 'recent-list';
        setRecentPageMode(true);
      }
    };

    const handleViewportResize = () => {
      if (window.matchMedia(PHONE_LAYOUT_QUERY).matches) {
        window.clearTimeout(recentTopHoldTimer);
        pageState = 'hero';
        appRoot.classList.remove('is-recent-page');
        window.scrollTo(0, 0);
        return;
      }
      if (pageState === 'entering-recent') {
        window.clearTimeout(transitionTimer);
        pageState = 'recent-list';
      } else if (pageState === 'leaving-recent') {
        window.clearTimeout(transitionTimer);
        pageState = 'hero';
      }
      const targetTop = pageState === 'hero' ? 0 : getRecentPageTop();
      if (Math.abs(window.scrollY - targetTop) > 2) {
        if (document.scrollingElement) document.scrollingElement.scrollTop = targetTop;
      }
    };

    pageState = window.scrollY >= getRecentPageTop() - 4 ? 'recent-list' : 'hero';
    appRoot.classList.toggle('is-recent-page', pageState === 'recent-list');

    const handlePageWheel = (event) => {
      const blockers = pageInteractionBlockersRef.current;
      if (window.matchMedia(PHONE_LAYOUT_QUERY).matches || blockers.isCreating || blockers.billPhotoOpen || blockers.clearHistoryConfirmOpen || blockers.historyView) return;
      if (event.ctrlKey || Math.abs(event.deltaY) < 4) return;
      if (event.target.closest?.('.staggered-menu-panel, .overlay, .home-confirm-backdrop, .bill-photo-modal-backdrop, .history-qr-modal-backdrop')) return;
      if (pageState === 'entering-recent' || pageState === 'leaving-recent') {
        event.preventDefault();
        return;
      }

      const recentPageTop = getRecentPageTop();
      const currentScroll = window.scrollY;
      const movingDown = event.deltaY > 0;
      const insideRecentList = hasRecentBills() && event.target.closest?.('.home-history-list');

      if (!movingDown && !insideRecentList && (pageState === 'recent-list' || pageState === 'recent-top-hold' || pageState === 'recent-top-ready')) {
        event.preventDefault();
        leaveRecentPage();
        return;
      }

      if (pageState === 'recent-top-hold') {
        if (!movingDown) {
          event.preventDefault();
          scheduleRecentTopReady();
        } else {
          window.clearTimeout(recentTopHoldTimer);
          pageState = 'recent-list';
        }
        return;
      }

      if (pageState === 'recent-top-ready') {
        if (movingDown) {
          pageState = 'recent-list';
          return;
        }
        if (recentList && recentList.scrollTop > 1) {
          pageState = 'recent-list';
          return;
        }
        if (currentScroll <= recentPageTop + 48) {
          event.preventDefault();
          leaveRecentPage();
        }
        return;
      }

      if (pageState === 'recent-list' && !hasRecentBills() && movingDown && event.target.closest?.('.home-history-panel')) {
        event.preventDefault();
        return;
      }

      if (pageState === 'hero' && movingDown && currentScroll < recentPageTop - 1) {
        event.preventDefault();
        enterRecentPage();
        return;
      }

      if (pageState === 'recent-list' && !movingDown && (!recentList || recentList.scrollTop <= 1) && currentScroll <= recentPageTop + 48) {
        event.preventDefault();
        holdAtRecentTop();
      }
    };

    window.addEventListener('wheel', handlePageWheel, { passive: false });
    window.addEventListener('scroll', syncRecentPageMode, { passive: true });
    window.addEventListener('resize', handleViewportResize, { passive: true });
    return () => {
      window.clearTimeout(transitionTimer);
      window.clearTimeout(recentTopHoldTimer);
      window.removeEventListener('wheel', handlePageWheel);
      window.removeEventListener('scroll', syncRecentPageMode);
      window.removeEventListener('resize', handleViewportResize);
      appRoot.classList.remove('is-recent-page');
    };
  }, [isSharedHistoryRoute]);

  useEffect(() => {
    if (isSharedHistoryRoute) return undefined;

    const dashboard = document.querySelector('.home-dashboard');
    const recentPage = dashboard?.querySelector('.home-history-panel');
    const appRoot = document.querySelector('.app.maggie-app');
    if (!dashboard || !recentPage || !appRoot) return undefined;

    const phoneLayout = window.matchMedia(PHONE_LAYOUT_QUERY);
    const syncPhonePage = () => {
      if (!phoneLayout.matches) return;
      const recentTop = recentPage.getBoundingClientRect().top
        - dashboard.getBoundingClientRect().top + dashboard.scrollTop;
      appRoot.classList.toggle('is-recent-page', dashboard.scrollTop >= recentTop * 0.5);
    };
    const handleLayoutChange = () => {
      dashboard.scrollTop = 0;
      if (phoneLayout.matches) {
        window.scrollTo(0, 0);
        appRoot.classList.remove('is-recent-page');
      }
    };

    dashboard.addEventListener('scroll', syncPhonePage, { passive: true });
    phoneLayout.addEventListener('change', handleLayoutChange);
    if (phoneLayout.matches) syncPhonePage();
    return () => {
      dashboard.removeEventListener('scroll', syncPhonePage);
      phoneLayout.removeEventListener('change', handleLayoutChange);
    };
  }, [isSharedHistoryRoute]);

  useEffect(() => {
    if (!billPhotoOpen) return undefined;
    document.documentElement.classList.add('media-preview-open');
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setBillPhotoOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.documentElement.classList.remove('media-preview-open');
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [billPhotoOpen]);

  const subtotal = useMemo(
    () => billItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    [billItems],
  );
  const vatAmount = vatEnabled ? subtotal * Math.max(0, Number(vatRate) || 0) / 100 : 0;
  const appliedDiscount = discountEnabled ? Math.max(0, Number(discountAmount) || 0) : 0;
  const total = Math.max(0, subtotal + vatAmount - appliedDiscount);

  const sortedHistoryRecords = useMemo(() => {
    const records = [...historyRecords];
    if (historySort === 'oldest') return records.sort((a, b) => a.updatedAt - b.updatedAt);
    if (historySort === 'highest') return records.sort((a, b) => Number(b.total) - Number(a.total));
    if (historySort === 'lowest') return records.sort((a, b) => Number(a.total) - Number(b.total));
    return records.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [historyRecords, historySort]);

  const groupedHistoryRecords = useMemo(() => {
    if (historySort !== 'newest') return [{ dayStart: null, records: sortedHistoryRecords }];
    const groupsByDay = new Map();
    sortedHistoryRecords.forEach((record) => {
      const dayStart = getHistoryDayStart(record.updatedAt);
      if (!groupsByDay.has(dayStart)) groupsByDay.set(dayStart, { dayStart, records: [] });
      groupsByDay.get(dayStart).records.push(record);
    });
    return [...groupsByDay.values()].sort((left, right) => right.dayStart - left.dayStart);
  }, [sortedHistoryRecords, historySort]);

  useEffect(() => () => {
    window.clearTimeout(homeHistorySwipeRef.current?.holdTimer);
    window.clearTimeout(workflowCloseTimerRef.current);
  }, []);

  useEffect(() => {
    if (!sortDrawerOpen) return undefined;
    const closeOnOutsidePress = (event) => {
      if (!sortDrawerRef.current?.contains(event.target)) setSortDrawerOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setSortDrawerOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [sortDrawerOpen]);

  useEffect(() => {
    if (!clearHistoryConfirmOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !historyLoading) setClearHistoryConfirmOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [clearHistoryConfirmOpen, historyLoading]);

  useEffect(() => {
    const viewport = window.visualViewport;
    let largestHeight = viewport?.height ?? window.innerHeight;
    let focusTimer;

    const syncViewport = () => {
      const visibleHeight = viewport?.height ?? window.innerHeight;
      largestHeight = Math.max(largestHeight, visibleHeight);
      const activeElement = document.activeElement;
      const inputIsFocused = ['INPUT', 'TEXTAREA'].includes(activeElement?.tagName)
        || activeElement?.isContentEditable;
      // Pinch zoom also makes visualViewport.height smaller. Do not mistake that
      // for the software keyboard or the UI will jump while the user zooms.
      const keyboardIsOpen = inputIsFocused
        && (viewport?.scale ?? 1) < 1.1
        && visibleHeight < largestHeight - 120;

      document.documentElement.style.setProperty('--visible-height', `${Math.round(visibleHeight)}px`);
      document.documentElement.style.setProperty(
        '--visible-offset-top',
        `${Math.max(0, Math.round(viewport?.offsetTop ?? 0))}px`,
      );
      document.body.classList.toggle('keyboard-open', keyboardIsOpen);

      if (keyboardIsOpen && activeElement instanceof HTMLElement) {
        window.requestAnimationFrame(() => {
          const rect = activeElement.getBoundingClientRect();
          const visibleTop = viewport?.offsetTop ?? 0;
          const visibleBottom = visibleTop + visibleHeight;
          if (rect.top < visibleTop + 12 || rect.bottom > visibleBottom - 12) {
            activeElement.scrollIntoView({ block: 'center', inline: 'nearest' });
          }
        });
      }
    };

    const syncAfterFocusChange = () => {
      window.clearTimeout(focusTimer);
      syncViewport();
      // Mobile browsers animate the keyboard after focusin/focusout, so measure
      // once more after that animation has had time to update visualViewport.
      focusTimer = window.setTimeout(syncViewport, 250);
    };

    const resetViewportBaseline = () => {
      largestHeight = viewport?.height ?? window.innerHeight;
      syncViewport();
    };

    syncViewport();
    viewport?.addEventListener('resize', syncViewport);
    viewport?.addEventListener('scroll', syncViewport);
    window.addEventListener('resize', syncViewport);
    window.addEventListener('orientationchange', resetViewportBaseline);
    document.addEventListener('focusin', syncAfterFocusChange);
    document.addEventListener('focusout', syncAfterFocusChange);

    return () => {
      window.clearTimeout(focusTimer);
      viewport?.removeEventListener('resize', syncViewport);
      viewport?.removeEventListener('scroll', syncViewport);
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('orientationchange', resetViewportBaseline);
      document.removeEventListener('focusin', syncAfterFocusChange);
      document.removeEventListener('focusout', syncAfterFocusChange);
      document.body.classList.remove('keyboard-open');
    };
  }, []);

  useEffect(() => {
    const preventGestureZoom = (event) => event.preventDefault();
    const preventMultiTouchZoom = (event) => {
      if (event.touches?.length > 1) event.preventDefault();
    };
    const preventWheelZoom = (event) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    const preventKeyboardZoom = (event) => {
      if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '0'].includes(event.key)) {
        event.preventDefault();
      }
    };

    document.addEventListener('gesturestart', preventGestureZoom, { passive: false });
    document.addEventListener('gesturechange', preventGestureZoom, { passive: false });
    document.addEventListener('gestureend', preventGestureZoom, { passive: false });
    document.addEventListener('touchmove', preventMultiTouchZoom, { passive: false });
    document.addEventListener('wheel', preventWheelZoom, { passive: false });
    document.addEventListener('keydown', preventKeyboardZoom);

    return () => {
      document.removeEventListener('gesturestart', preventGestureZoom);
      document.removeEventListener('gesturechange', preventGestureZoom);
      document.removeEventListener('gestureend', preventGestureZoom);
      document.removeEventListener('touchmove', preventMultiTouchZoom);
      document.removeEventListener('wheel', preventWheelZoom);
      document.removeEventListener('keydown', preventKeyboardZoom);
    };
  }, []);

  useEffect(() => {
    if (isCreating && step === 'friends' && peopleNameConfirmed) inputRef.current?.focus();
  }, [isCreating, step, peopleNameConfirmed]);

  useEffect(() => {
    let active = true;
    setHistoryLoading(true);
    readHistoryRecords()
      .then((records) => {
        if (active) setHistoryRecords(records);
      })
      .catch((historyError) => console.error('Could not load recent bills:', historyError))
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (editingBillIndex === null) return undefined;
    const frame = window.requestAnimationFrame(() => {
      billEditorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingBillIndex]);

  useEffect(() => {
    if (cooldownRemaining <= 0) return undefined;
    const countdown = window.setInterval(() => {
      setCooldownRemaining((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(countdown);
  }, [cooldownRemaining]);

  useEffect(() => () => {
    if (billImageUrl) URL.revokeObjectURL(billImageUrl);
  }, [billImageUrl]);

  useEffect(() => () => {
    if (pendingCameraUrl) URL.revokeObjectURL(pendingCameraUrl);
  }, [pendingCameraUrl]);

  const closeCameraFlow = () => {
    setCameraFlow(null);
    setPendingCameraUrl('');
    setCropBaseSize({ width: 0, height: 0 });
    setCropTransform({ x: 0, y: 0, zoom: 1, rotation: 0 });
    setCropAspect('16:9');
    setIsCropping(false);
  };

  const resetBill = () => {
    if (billImageUrl) URL.revokeObjectURL(billImageUrl);
    if (pendingCameraUrl) URL.revokeObjectURL(pendingCameraUrl);
    setBillImageUrl('');
    setBillPhotoOpen(false);
    setCameraFlow(null);
    setPendingCameraUrl('');
    setCropBaseSize({ width: 0, height: 0 });
    setCropTransform({ x: 0, y: 0, zoom: 1, rotation: 0 });
    setCropAspect('16:9');
    setBillItems([]);
    setAllocations([]);
    setVatEnabled(false);
    setVatRate(7);
    setDiscountEnabled(false);
    setDiscountAmount(0);
    setEditingBillIndex(null);
    setRawOcrText('');
    setOcrStatus('idle');
    setOcrProgress(0);
  };

  const openPanel = async () => {
    window.clearTimeout(workflowCloseTimerRef.current);
    setIsWorkflowClosing(false);
    setSortDrawerOpen(false);
    setHistoryView(null);
    setSelectedHistory(null);

    // A draft already loaded the workflow styles. Reopen it immediately and
    // preserve its current step, inputs, scan review, and history metadata.
    if (hasActiveDraft) {
      setIsCreating(true);
      return;
    }

    await loadAppStyles();
    setActiveHistoryId(null);
    setWorkflowDirection('forward');
    setStep('friends');
    setPeopleNameConfirmed(false);
    setManualComposerOpen(false);
    setManualItemName('');
    setManualItemPrice('');
    setManualQuantity('1');
    setShowManualQuantity(false);
    setShowBillExtras(false);
    setEventName(createAutomaticEventName());
    setFriendName('');
    setFriends([]);
    setAllocations([]);
    setSplitIndex(0);
    setSettlements([]);
    resetBill();
    setError('');
    setHasActiveDraft(true);
    setIsCreating(true);
  };

  const closeHistory = () => {
    setHistoryView(null);
    setSelectedHistory(null);
  };

  const clearHistory = async () => {
    if (historyRecords.length === 0) return;
    setClearHistoryConfirmOpen(true);
  };

  const handleBrandHistoryClick = async () => {
    const randomRecord = createRandomHistoryRecord();
    try {
      await saveHistoryRecord(randomRecord);
      setHistoryRecords((records) => [randomRecord, ...records]);
      setHistorySort('newest');
    } catch (historyError) {
      console.error('Could not add random history record:', historyError);
    }
  };

  const confirmClearHistory = async () => {
    setHistoryLoading(true);
    try {
      await clearHistoryRecords();
      setHistoryRecords([]);
      setSelectedHistory(null);
      setHistoryView('list');
      setClearHistoryConfirmOpen(false);
    } catch (historyError) {
      console.error('Could not clear local history:', historyError);
      window.alert('Could not clear history. Please try again.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const closePanel = () => {
    if (!isSaving && ocrStatus !== 'scanning' && !isWorkflowClosing) {
      if (cameraFlow) closeCameraFlow();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setIsCreating(false);
        return;
      }
      setIsWorkflowClosing(true);
      window.clearTimeout(workflowCloseTimerRef.current);
      workflowCloseTimerRef.current = window.setTimeout(() => {
        setIsCreating(false);
        setIsWorkflowClosing(false);
      }, 280);
    }
  };

  const openHomeHistoryRecord = async (record) => {
    if (homeHistoryClickGuardRef.current === record.id) {
      homeHistoryClickGuardRef.current = null;
      return;
    }
    setSortDrawerOpen(false);
    await loadAppStyles();
    setSelectedHistory(record);
    setHistoryView('detail');
    setMenuOpenRequest((request) => request + 1);
  };

  const editHistoryRecord = async (record) => {
    if (record.isShared) return;

    await loadAppStyles();
    window.clearTimeout(workflowCloseTimerRef.current);
    setIsWorkflowClosing(false);
    setWorkflowDirection('forward');
    setSortDrawerOpen(false);
    setActiveHistoryId(record.id);
    setEventName(record.eventName);
    setFriendName('');
    setFriends([...record.friends]);
    setStep('friends');
    setPeopleNameConfirmed(true);
    setManualComposerOpen(false);
    setManualItemName('');
    setManualItemPrice('');
    setManualQuantity('1');
    setShowManualQuantity(false);
    setShowBillExtras(Boolean(record.vatEnabled || record.discountEnabled));
    resetBill();
    setBillItems(record.billItems.map((item) => ({ ...item })));
    setVatEnabled(Boolean(record.vatEnabled));
    setVatRate(Number(record.vatRate) || 7);
    setDiscountEnabled(Boolean(record.discountEnabled));
    setDiscountAmount(Number(record.discountAmount) || 0);
    setEditingBillIndex(null);
    setRawOcrText('');
    setOcrStatus(record.billItems.length > 0 ? 'review' : 'idle');
    setOcrProgress(0);
    setAllocations(record.billItems.map((_, index) => [...(record.allocations[index] || [])]));
    setSplitIndex(0);
    setSettlements(record.settlements.map((settlement) => ({ ...settlement })));
    setError('');
    setHasActiveDraft(true);
    setIsCreating(true);
    setHistoryView(null);
    setSelectedHistory(null);
    setMenuCloseRequest((request) => request + 1);
  };

  useEffect(() => {
    if (!isSharedHistoryRoute) return;
    loadAppStyles();
    const sharedValue = new URLSearchParams(window.location.search).get('r');
    if (!sharedValue) {
      setError('This shared bill link is missing its bill details.');
      return;
    }

    const openSharedReceipt = async () => {
      try {
        const sharedReceipt = await decodeSharedReceipt(sharedValue);
        await loadAppStyles();
        setIsCreating(false);
        setSelectedHistory(sharedReceipt);
        setHistoryView('detail');
      } catch (sharedReceiptError) {
        console.error('Could not open shared receipt:', sharedReceiptError);
        setError('This shared receipt link is invalid or incomplete.');
      }
    };
    openSharedReceipt();
  }, []);

  const beginHomeHistorySwipe = (event, record) => {
    window.clearTimeout(homeHistorySwipeRef.current?.holdTimer);
    event.currentTarget.setPointerCapture(event.pointerId);
    homeHistorySwipeRef.current = {
      id: record.id,
      record,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offset: 0,
      moved: false,
      holding: false,
      holdTimer: null,
    };
    setHomeHistorySwipe({ id: record.id, offset: 0, holding: false });
  };

  const completeHeldHistoryDelete = (swipe) => {
    if (homeHistorySwipeRef.current !== swipe || !swipe.holding || swipe.offset > -78) return;
    homeHistoryClickGuardRef.current = swipe.id;
    window.setTimeout(() => {
      if (homeHistoryClickGuardRef.current === swipe.id) homeHistoryClickGuardRef.current = null;
    }, 1000);
    homeHistorySwipeRef.current = null;
    setHistoryDeleteInputLocked(true);

    let fallbackTimer;
    const unlockAfterRelease = () => {
      window.removeEventListener('pointerup', unlockAfterRelease, true);
      window.removeEventListener('pointercancel', unlockAfterRelease, true);
      window.clearTimeout(fallbackTimer);
      window.setTimeout(() => setHistoryDeleteInputLocked(false), 80);
    };
    window.addEventListener('pointerup', unlockAfterRelease, { capture: true, once: true });
    window.addEventListener('pointercancel', unlockAfterRelease, { capture: true, once: true });
    fallbackTimer = window.setTimeout(unlockAfterRelease, 30000);
    deleteHeldHistoryRecord(swipe.record);
  };

  const deleteHeldHistoryRecord = async (record) => {
    try {
      setRemovingHistoryId(record.id);
      await new Promise((resolve) => window.setTimeout(resolve, 340));
      await deleteHistoryRecord(record.id);
      setHistoryRecords((records) => records.filter((item) => item.id !== record.id));
      if (selectedHistory?.id === record.id) {
        setSelectedHistory(null);
        setHistoryView(null);
      }
    } catch (deleteError) {
      console.error('Could not delete history record:', deleteError);
      window.alert('Could not delete this bill. Please try again.');
    } finally {
      setRemovingHistoryId(null);
      setHomeHistorySwipe({ id: null, offset: 0, holding: false });
    }
  };

  const moveHomeHistorySwipe = (event) => {
    const swipe = homeHistorySwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - swipe.startX;
    const deltaY = event.clientY - swipe.startY;
    if (!swipe.moved && Math.abs(deltaY) > Math.abs(deltaX)) return;
    if (Math.abs(deltaX) > 8) swipe.moved = true;
    swipe.offset = Math.max(-112, Math.min(0, deltaX));
    if (swipe.offset <= -78 && !swipe.holding) {
      swipe.holding = true;
      swipe.holdTimer = window.setTimeout(() => completeHeldHistoryDelete(swipe), 800);
    } else if (swipe.offset > -78 && swipe.holding) {
      window.clearTimeout(swipe.holdTimer);
      swipe.holding = false;
      swipe.holdTimer = null;
    }
    setHomeHistorySwipe({ id: swipe.id, offset: swipe.offset, holding: swipe.holding });
  };

  const finishHomeHistorySwipe = (event, record) => {
    const swipe = homeHistorySwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    window.clearTimeout(swipe.holdTimer);
    homeHistorySwipeRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (swipe.moved) {
      homeHistoryClickGuardRef.current = record.id;
      window.setTimeout(() => {
        if (homeHistoryClickGuardRef.current === record.id) homeHistoryClickGuardRef.current = null;
      }, 500);
    }

    setHomeHistorySwipe({ id: null, offset: 0, holding: false });
  };

  const cancelHomeHistorySwipe = (event) => {
    const swipe = homeHistorySwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    window.clearTimeout(swipe.holdTimer);
    homeHistorySwipeRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setHomeHistorySwipe({ id: null, offset: 0, holding: false });
  };

  const finishOperation = () => {
    setHasActiveDraft(false);
    closePanel();
  };

  const addFriend = (event) => {
    event.preventDefault();
    const name = friendName.trim();

    if (!name) return;
    if (friends.length >= 100) {
      setError('You can add up to 100 people.');
      return;
    }
    if (friends.some((friend) => friend.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError(`${name} is already in the list.`);
      return;
    }

    setFriends([...friends, name]);
    setFriendName('');
    setError('');
    inputRef.current?.focus();
  };

  const removeFriend = (indexToRemove) => {
    const nextFriends = friends.filter((_, index) => index !== indexToRemove);
    setFriends(nextFriends);
    setAllocations((current) => current.map((names) => names.filter((name) => nextFriends.includes(name))));
    setError('');
  };

  const continueToBill = () => {
    if (!eventName.trim()) {
      setError('Add a name for this bill before continuing.');
      return;
    }
    if (friends.length < 2) return;
    document.activeElement?.blur();
    setWorkflowDirection('forward');
    setStep('bill');
    setError('');
  };

  const scanBill = async (file) => {
    if (!file) return;
    if (cooldownRemaining > 0) {
      setError(`Please wait ${cooldownRemaining} seconds before scanning another bill.`);
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('Please choose a photo of the bill.');
      return;
    }

    let uploadFile;
    try {
      uploadFile = await prepareBillUpload(file);
    } catch (compressionError) {
      setError(compressionError instanceof Error ? compressionError.message : 'Could not prepare this photo.');
      return;
    }

    if (billImageUrl) URL.revokeObjectURL(billImageUrl);
    setBillImageUrl(URL.createObjectURL(uploadFile));
    setBillItems([]);
    setAllocations([]);
    setEditingBillIndex(null);
    setRawOcrText('');
    setOcrStatus('scanning');
    setOcrProgress(0.08);
    setCooldownRemaining(30);
    setError('');

    const progressTimer = window.setInterval(() => {
      setOcrProgress((progress) => Math.min(0.9, progress + 0.035));
    }, 450);

    try {
      const formData = new FormData();
      formData.append('bill', uploadFile);
      const response = await fetch('/api/scan-bill', {
        method: 'POST',
        body: formData,
      });
      const responseText = await response.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch {
        throw new Error(`The scan service returned HTTP ${response.status} instead of JSON. Check the Vercel Function deployment.`);
      }
      if (!response.ok) {
        if (response.status === 429 && result.retryAfter) setCooldownRemaining(result.retryAfter);
        throw new Error(result.message || `Scan failed with HTTP ${response.status}.`);
      }

      const text = result.text || '';
      const detectedItems = parseThaiBill(text, result.tsv);

      setOcrProgress(1);
      setRawOcrText(text);
      setBillItems(detectedItems);
      setEditingBillIndex(null);
      setOcrStatus('review');
      if (detectedItems.length === 0) {
        setError('No bill items were detected. Add them manually or try a clearer photo.');
      }
    } catch (scanError) {
      setOcrStatus('idle');
      const message = scanError instanceof Error ? scanError.message : String(scanError || 'Unknown scanning error');
      setError(`Could not scan this photo: ${message}`);
    } finally {
      window.clearInterval(progressTimer);
    }
  };

  const openBillCropEditor = (file, source) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image of the bill.');
      return;
    }

    if (pendingCameraUrl) URL.revokeObjectURL(pendingCameraUrl);
    setPendingCameraUrl(URL.createObjectURL(file));
    setCropBaseSize({ width: 0, height: 0 });
    setCropTransform({ x: 0, y: 0, zoom: 1, rotation: 0 });
    setCropAspect('16:9');
    setCameraFlow(source);
    setError('');
  };

  const chooseBill = (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    openBillCropEditor(file, 'upload');
  };

  const startCameraFlow = () => {
    setError('');
    cameraInputRef.current?.click();
  };

  const chooseCameraBill = (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    openBillCropEditor(file, 'camera');
  };

  const initializeCropEditor = () => {
    const image = cropImageRef.current;
    const frame = cropFrameRef.current;
    const workspace = cropWorkspaceRef.current;
    if (!image || !frame || !workspace || !image.naturalWidth || !image.naturalHeight) return;
    const workspaceRect = workspace.getBoundingClientRect();
    const scale = Math.max(workspaceRect.width / image.naturalWidth, workspaceRect.height / image.naturalHeight);
    setCropBaseSize({ width: image.naturalWidth * scale, height: image.naturalHeight * scale });
    setCropTransform({ x: 0, y: 0, zoom: 1, rotation: 0 });
  };

  const clampCropTransform = (nextTransform) => {
    const frame = cropFrameRef.current;
    if (!frame || !cropBaseSize.width || !cropBaseSize.height) return nextTransform;
    const quarterTurn = Math.abs(nextTransform.rotation % 180) === 90;
    const transformedWidth = (quarterTurn ? cropBaseSize.height : cropBaseSize.width) * nextTransform.zoom;
    const transformedHeight = (quarterTurn ? cropBaseSize.width : cropBaseSize.height) * nextTransform.zoom;
    const frameRect = frame.getBoundingClientRect();
    const minimumZoom = Math.max(
      0.1,
      frameRect.width / (quarterTurn ? cropBaseSize.height : cropBaseSize.width),
      frameRect.height / (quarterTurn ? cropBaseSize.width : cropBaseSize.height),
    );
    const zoom = Math.max(minimumZoom, Math.min(4, nextTransform.zoom));
    const widthAtZoom = transformedWidth * (zoom / nextTransform.zoom);
    const heightAtZoom = transformedHeight * (zoom / nextTransform.zoom);
    const maxX = Math.max(0, (widthAtZoom - frameRect.width) / 2);
    const maxY = Math.max(0, (heightAtZoom - frameRect.height) / 2);
    return {
      ...nextTransform,
      zoom,
      x: Math.max(-maxX, Math.min(maxX, nextTransform.x)),
      y: Math.max(-maxY, Math.min(maxY, nextTransform.y)),
    };
  };

  const beginCropDrag = (event) => {
    if (!cropBaseSize.width) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointers = cropPointersRef.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      cropGestureRef.current = {
        mode: 'drag',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        imageX: cropTransform.x,
        imageY: cropTransform.y,
      };
    } else if (pointers.size === 2) {
      const [first, second] = [...pointers.values()];
      cropGestureRef.current = {
        mode: 'pinch',
        startDistance: Math.hypot(second.x - first.x, second.y - first.y),
        startMidX: (first.x + second.x) / 2,
        startMidY: (first.y + second.y) / 2,
        imageX: cropTransform.x,
        imageY: cropTransform.y,
        zoom: cropTransform.zoom,
      };
    }
  };

  const moveCropDrag = (event) => {
    const pointers = cropPointersRef.current;
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = cropGestureRef.current;
    if (!gesture) return;

    if (gesture.mode === 'drag' && gesture.pointerId === event.pointerId) {
      setCropTransform((current) => clampCropTransform({
        ...current,
        x: gesture.imageX + event.clientX - gesture.startX,
        y: gesture.imageY + event.clientY - gesture.startY,
      }));
    } else if (gesture.mode === 'pinch' && pointers.size >= 2) {
      const [first, second] = [...pointers.values()];
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const midX = (first.x + second.x) / 2;
      const midY = (first.y + second.y) / 2;
      setCropTransform((current) => clampCropTransform({
        ...current,
        zoom: gesture.zoom * (distance / Math.max(1, gesture.startDistance)),
        x: gesture.imageX + midX - gesture.startMidX,
        y: gesture.imageY + midY - gesture.startMidY,
      }));
    }
  };

  const zoomCropWithWheel = (event) => {
    if (!cropBaseSize.width || !cropWorkspaceRef.current) return;
    event.preventDefault();
    const workspaceRect = cropWorkspaceRef.current.getBoundingClientRect();
    const pointerX = event.clientX - (workspaceRect.left + workspaceRect.width / 2);
    const pointerY = event.clientY - (workspaceRect.top + workspaceRect.height / 2);

    setCropTransform((current) => {
      const nextZoom = Math.max(0.25, Math.min(4, current.zoom * Math.exp(-event.deltaY * 0.0015)));
      const zoomRatio = nextZoom / current.zoom;
      return clampCropTransform({
        ...current,
        zoom: nextZoom,
        x: pointerX - (pointerX - current.x) * zoomRatio,
        y: pointerY - (pointerY - current.y) * zoomRatio,
      });
    });
  };

  const toggleCropAspect = () => {
    setCropAspect((current) => current === '16:9' ? '9:16' : '16:9');
    window.requestAnimationFrame(() => {
      setCropTransform((current) => clampCropTransform(current));
    });
  };

  const endCropDrag = (event) => {
    const pointers = cropPointersRef.current;
    pointers.delete(event.pointerId);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (pointers.size === 1) {
      const [pointerId, point] = [...pointers.entries()][0];
      cropGestureRef.current = {
        mode: 'drag',
        pointerId,
        startX: point.x,
        startY: point.y,
        imageX: cropTransform.x,
        imageY: cropTransform.y,
      };
    } else {
      cropGestureRef.current = null;
    }
  };

  const confirmCameraBill = async () => {
    const image = cropImageRef.current;
    const workspace = cropWorkspaceRef.current;
    const frame = cropFrameRef.current;
    if (!image || !workspace || !frame || !cropBaseSize.width || isCropping) return;

    setIsCropping(true);
    try {
      const workspaceRect = workspace.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      const exportScale = Math.min(4, Math.max(2, 1600 / frameRect.width));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(frameRect.width * exportScale);
      canvas.height = Math.round(frameRect.height * exportScale);
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.scale(exportScale, exportScale);
      context.translate(
        workspaceRect.width / 2 - (frameRect.left - workspaceRect.left) + cropTransform.x,
        workspaceRect.height / 2 - (frameRect.top - workspaceRect.top) + cropTransform.y,
      );
      context.rotate((cropTransform.rotation * Math.PI) / 180);
      context.scale(cropTransform.zoom, cropTransform.zoom);
      context.drawImage(
        image,
        -cropBaseSize.width / 2,
        -cropBaseSize.height / 2,
        cropBaseSize.width,
        cropBaseSize.height,
      );
      const blob = await canvasToJpeg(canvas, 0.92);
      const croppedFile = new File([blob], `bill-crop-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
      closeCameraFlow();
      scanBill(croppedFile);
    } catch {
      setError('Could not crop this photo. Please try again.');
      setIsCropping(false);
    }
  };

  const updateBillItem = (index, field, value) => {
    setBillItems((currentItems) => currentItems.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
  };

  const removeBillItem = (indexToRemove) => {
    setBillItems((currentItems) => currentItems.filter((_, index) => index !== indexToRemove));
    setAllocations((current) => current.filter((_, index) => index !== indexToRemove));
    setEditingBillIndex((currentIndex) => {
      if (currentIndex === indexToRemove) return null;
      return currentIndex > indexToRemove ? currentIndex - 1 : currentIndex;
    });
  };

  const addManualItemFromComposer = (event) => {
    event.preventDefault();
    const name = manualItemName.trim();
    const amount = Number(manualItemPrice);
    const quantity = Number(manualQuantity);
    if (!name || manualItemPrice === '' || !Number.isFinite(amount) || amount < 0) {
      setError('Add an item name and a valid price.');
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      setError('Quantity must be at least 1.');
      return;
    }
    setBillItems((currentItems) => [...currentItems, { name, quantity, amount: Number(amount.toFixed(2)) }]);
    setAllocations((current) => [...current, []]);
    setOcrStatus('review');
    setManualItemName('');
    setManualItemPrice('');
    setManualQuantity('1');
    setShowManualQuantity(false);
    setError('');
    window.requestAnimationFrame(() => manualNameRef.current?.focus());
  };

  const startSplitting = () => {
    const cleanItemEntries = billItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.name.trim());
    const cleanItems = cleanItemEntries.map(({ item }) => item);
    if (cleanItems.length === 0) {
      setError('Add at least one bill item before splitting.');
      return;
    }

    setBillItems(cleanItems);
    setEditingBillIndex(null);
    setAllocations(cleanItemEntries.map(({ index }) => (
      activeHistoryId ? [...(allocations[index] || [])] : []
    )));
    setSplitIndex(0);
    setSettlements([]);
    setError('');
    document.activeElement?.blur();
    setWorkflowDirection('forward');
    setStep('split');
  };

  const toggleFriendForItem = (friend) => {
    setAllocations((current) => current.map((selectedFriends, index) => {
      if (index !== splitIndex) return selectedFriends;
      return selectedFriends.includes(friend)
        ? selectedFriends.filter((selectedFriend) => selectedFriend !== friend)
        : [...selectedFriends, friend];
    }));
    setError('');
  };

  const toggleAllFriendsForItem = () => {
    setAllocations((current) => current.map((selectedFriends, index) => {
      if (index !== splitIndex) return selectedFriends;
      return selectedFriends.length === friends.length ? [] : [...friends];
    }));
    setError('');
  };

  const calculateSettlements = () => {
    const centsByFriend = Object.fromEntries(friends.map((friend) => [friend, 0]));

    billItems.forEach((item, itemIndex) => {
      const selectedFriends = allocations[itemIndex] || [];
      if (selectedFriends.length === 0) return;
      const itemCents = Math.round((Number(item.amount) || 0) * 100);
      const baseShare = Math.floor(itemCents / selectedFriends.length);
      const remainder = itemCents % selectedFriends.length;

      selectedFriends.forEach((friend, friendIndex) => {
        centsByFriend[friend] += baseShare + (friendIndex < remainder ? 1 : 0);
      });
    });

    const assignedCents = Object.values(centsByFriend).reduce((sum, amount) => sum + amount, 0);
    const targetCents = Math.round(total * 100);

    if (assignedCents > 0 && targetCents !== assignedCents) {
      const proportional = friends.map((friend) => ({
        friend,
        exact: centsByFriend[friend] * targetCents / assignedCents,
      }));
      let distributedCents = 0;
      proportional.forEach((entry) => {
        centsByFriend[entry.friend] = Math.floor(entry.exact);
        distributedCents += centsByFriend[entry.friend];
      });
      proportional
        .sort((left, right) => (right.exact - Math.floor(right.exact)) - (left.exact - Math.floor(left.exact)))
        .slice(0, targetCents - distributedCents)
        .forEach((entry) => { centsByFriend[entry.friend] += 1; });
    }

    return friends.map((friend) => ({ name: friend, amount: centsByFriend[friend] / 100 }));
  };

  const finishSplitting = async () => {
    if ((allocations[splitIndex] || []).length === 0 || isSaving) return;
    const calculatedSettlements = calculateSettlements();

    setIsSaving(true);
    setError('');

    try {
      const response = await fetch('/api/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventName, friends, billItems, allocations, settlements: calculatedSettlements, rawOcrText, subtotal, vatEnabled, vatRate, vatAmount, discountEnabled, discountAmount: appliedDiscount, total }),
      });

      if (!response.ok) throw new Error('Could not create the operation.');
      const historyId = activeHistoryId || crypto.randomUUID?.() || `operation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const now = Date.now();
      const historyRecord = {
        id: historyId,
        eventName,
        friends: [...friends],
        billItems: billItems.map((item) => ({ ...item, quantity: Number(item.quantity) || 1, amount: Number(item.amount) || 0 })),
        allocations: allocations.map((names) => [...names]),
        settlements: calculatedSettlements.map((settlement) => ({ ...settlement })),
        subtotal,
        vatEnabled,
        vatRate: Math.max(0, Number(vatRate) || 0),
        vatAmount,
        discountEnabled,
        discountAmount: appliedDiscount,
        total,
        createdAt: historyRecords.find((record) => record.id === historyId)?.createdAt || now,
        updatedAt: now,
      };

      try {
        await saveHistoryRecord(historyRecord);
        setActiveHistoryId(historyId);
        setHistoryRecords((records) => [historyRecord, ...records.filter((record) => record.id !== historyId)]);
      } catch (historyError) {
        console.error('Could not save local history:', historyError);
      }
      setSettlements(calculatedSettlements);
      // The completed operation is already stored in History. Keep its summary
      // visible, but make the next Start action open a clean draft immediately.
      setHasActiveDraft(false);
      setWorkflowDirection('forward');
      setStep('result');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSaving(false);
    }
  };

  const goToNextFood = () => {
    if ((allocations[splitIndex] || []).length === 0) {
      setError('Choose at least one person for this item.');
      return;
    }
    if (splitIndex === billItems.length - 1) {
      finishSplitting();
      return;
    }
    setWorkflowDirection('forward');
    setSplitIndex((index) => index + 1);
    setError('');
  };

  const goToPreviousFood = () => {
    if (splitIndex === 0) return;
    setWorkflowDirection('backward');
    setSplitIndex((index) => index - 1);
    setError('');
  };

  const goBack = () => {
    if (isSaving || ocrStatus === 'scanning') return;
    setError('');

    if (step === 'friends') {
      closePanel();
    } else if (step === 'bill') {
      if (cameraFlow) {
        closeCameraFlow();
      } else if (billImageUrl || ocrStatus === 'review' || billItems.length > 0) {
        resetBill();
      } else {
        setWorkflowDirection('backward');
        setStep('friends');
      }
    } else if (step === 'split') {
      setWorkflowDirection('backward');
      if (splitIndex > 0) setSplitIndex((index) => index - 1);
      else setStep('bill');
    } else if (step === 'result') {
      setSplitIndex(Math.max(0, billItems.length - 1));
      setWorkflowDirection('backward');
      setStep('split');
    }
  };

  const guidedGoBack = () => {
    if (isSaving || ocrStatus === 'scanning') return;
    setError('');
    if (step === 'friends') {
      if (peopleNameConfirmed) setPeopleNameConfirmed(false);
      else closePanel();
    } else if (step === 'bill') {
      if (cameraFlow) closeCameraFlow();
      else {
        setWorkflowDirection('backward');
        setPeopleNameConfirmed(true);
        setStep('friends');
      }
    } else {
      goBack();
    }
  };

  const downloadSummary = async (savedRecord = null) => {
    setError('');

    try {
      const summaryEventName = savedRecord?.eventName ?? eventName;
      const summaryBillItems = savedRecord?.billItems ?? billItems;
      const summaryAllocations = savedRecord?.allocations ?? allocations;
      const summarySettlements = savedRecord?.settlements ?? settlements;
      const summaryTotal = Number(savedRecord?.total ?? total);
      const storedShareRecord = savedRecord || historyRecords.find((record) => record.id === activeHistoryId);
      const shareRecord = storedShareRecord || {
        eventName: summaryEventName,
        friends: savedRecord?.friends ?? friends,
        billItems: summaryBillItems,
        allocations: summaryAllocations,
        settlements: summarySettlements,
        vatEnabled: savedRecord?.vatEnabled ?? vatEnabled,
        vatRate: savedRecord?.vatRate ?? vatRate,
        discountEnabled: savedRecord?.discountEnabled ?? discountEnabled,
        discountAmount: savedRecord?.discountAmount ?? appliedDiscount,
        updatedAt: savedRecord?.updatedAt ?? Date.now(),
      };
      const shareUrl = `${SHARE_HISTORY_URL}?r=${await encodeSharedReceipt(shareRecord)}`;

      // Wait for the web font before measuring. Safari otherwise occasionally
      // measures with its fallback font and draws with the loaded font.
      if (document.fonts?.ready) await document.fonts.ready;

      const width = 1080;
      const measuringCanvas = document.createElement('canvas');
      const measuringContext = measuringCanvas.getContext('2d');
      measuringContext.font = '600 27px "Mali", cursive';

      const makePayerLines = (selectedFriends) => {
        const prefix = `หาร ${selectedFriends.length} คน: `;
        const lines = [];
        let currentLine = prefix;

        selectedFriends.forEach((friend) => {
          const candidate = currentLine === prefix ? `${currentLine}${friend}` : `${currentLine}, ${friend}`;
          if (measuringContext.measureText(candidate).width > 790 && currentLine !== prefix) {
            lines.push(currentLine);
            currentLine = friend;
          } else {
            currentLine = candidate;
          }
        });
        lines.push(currentLine);
        return lines;
      };

      const foodLayouts = summaryBillItems.map((item, index) => {
        const payerLines = makePayerLines(summaryAllocations[index] || []);
        return { item, payerLines, height: 112 + Math.max(0, payerLines.length - 1) * 34 };
      });
      const foodSectionHeight = foodLayouts.reduce((sum, layout) => sum + layout.height + 14, 0);
      const settlementSectionHeight = summarySettlements.length * 94;
      const qrTop = 508 + foodSectionHeight + settlementSectionHeight;
      const height = Math.max(1050, qrTop + 360);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      const isDarkExport = theme === 'dark';
      const exportColors = isDarkExport ? {
        backgroundStart: '#212A27',
        backgroundMiddle: '#2A3530',
        backgroundEnd: '#18211E',
        glowStart: 'rgba(138, 199, 156, 0.23)',
        glowEnd: 'rgba(138, 199, 156, 0)',
        coralStart: 'rgba(255, 128, 107, 0.16)',
        primary: '#8AC79C',
        primaryText: '#212A27',
        text: '#FFF8E9',
        subtext: '#C3CBBF',
        summary: '#303A34',
        rowA: '#2A3530',
        rowB: '#303A34',
        footer: '#C3CBBF',
        shadow: 'rgba(0, 0, 0, 0.34)',
      } : {
        backgroundStart: '#FFFDF4',
        backgroundMiddle: '#FFF8E9',
        backgroundEnd: '#FFEFD0',
        glowStart: 'rgba(255, 216, 77, 0.3)',
        glowEnd: 'rgba(255, 216, 77, 0)',
        coralStart: 'rgba(244, 95, 75, 0.15)',
        primary: '#F45F4B',
        primaryText: '#FFFFFF',
        text: '#252C28',
        subtext: '#68756C',
        summary: '#FFF0CC',
        rowA: '#FFFEFA',
        rowB: '#FFF4DC',
        footer: '#68756C',
        shadow: 'rgba(57, 47, 28, 0.18)',
      };

      const fillRoundedRect = (x, y, rectWidth, rectHeight, radius, fillStyle, strokeStyle = null) => {
        context.fillStyle = fillStyle;
        context.beginPath();
        if (typeof context.roundRect === 'function') {
          context.roundRect(x, y, rectWidth, rectHeight, radius);
        } else {
          context.moveTo(x + radius, y);
          context.arcTo(x + rectWidth, y, x + rectWidth, y + rectHeight, radius);
          context.arcTo(x + rectWidth, y + rectHeight, x, y + rectHeight, radius);
          context.arcTo(x, y + rectHeight, x, y, radius);
          context.arcTo(x, y, x + rectWidth, y, radius);
          context.closePath();
        }
        context.fill();
        if (strokeStyle) {
          context.strokeStyle = strokeStyle;
          context.lineWidth = 1;
          context.stroke();
        }
      };

      // Avoid canvas textAlign="right": WebKit can position Thai/currency text
      // incorrectly in exported canvases. Measuring the X coordinate is stable
      // on iPhone, iPad, Android, and desktop browsers.
      const fillTextFromRight = (text, right, y, minLeft = 0) => {
        context.textAlign = 'left';
        const textWidth = context.measureText(text).width;
        context.fillText(text, Math.max(minLeft, right - textWidth), y);
      };

      const fillRaisedRoundedRect = (x, y, rectWidth, rectHeight, radius, fillStyle, strokeStyle = null) => {
        context.save();
        context.shadowColor = exportColors.shadow;
        context.shadowBlur = 14;
        context.shadowOffsetY = 7;
        fillRoundedRect(x, y, rectWidth, rectHeight, radius, fillStyle, strokeStyle);
        context.restore();
      };

      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, exportColors.backgroundStart);
      gradient.addColorStop(0.55, exportColors.backgroundMiddle);
      gradient.addColorStop(1, exportColors.backgroundEnd);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      const glow = context.createRadialGradient(900, 20, 0, 900, 20, 650);
      glow.addColorStop(0, exportColors.glowStart);
      glow.addColorStop(1, exportColors.glowEnd);
      context.fillStyle = glow;
      context.fillRect(0, 0, width, 700);

      const coralGlow = context.createRadialGradient(80, height - 40, 0, 80, height - 40, 620);
      coralGlow.addColorStop(0, exportColors.coralStart);
      coralGlow.addColorStop(1, 'rgba(244, 95, 75, 0)');
      context.fillStyle = coralGlow;
      context.fillRect(0, Math.max(0, height - 720), 760, 720);

      context.fillStyle = exportColors.primary;
      context.font = '700 34px "Mali", cursive';
      context.fillText('หารกัน', 72, 82);
      context.fillStyle = exportColors.text;
      context.font = '700 64px "Mali", cursive';
      context.fillText(summaryEventName, 72, 162, 936);

      const exportCardBorder = isDarkExport ? 'rgba(255, 255, 255, 0.09)' : 'rgba(37, 44, 40, 0.09)';

      fillRaisedRoundedRect(72, 202, 936, 102, 25, exportColors.summary, exportCardBorder);
      context.fillStyle = exportColors.subtext;
      context.font = '700 25px "Mali", cursive';
      context.fillText('ยอดรวมทั้งหมด', 104, 242);
      context.fillStyle = exportColors.text;
      context.font = '700 44px "Mali", cursive';
      fillTextFromRight(`฿${summaryTotal.toFixed(2)}`, 974, 270, 480);

      context.fillStyle = exportColors.subtext;
      context.font = '700 25px "Mali", cursive';
      context.fillText(`รายการค่าใช้จ่าย · ${summaryBillItems.length} รายการ`, 74, 358);

      let currentY = 388;
      foodLayouts.forEach(({ item, payerLines, height: rowHeight }, index) => {
        fillRaisedRoundedRect(64, currentY, 952, rowHeight, 24, index % 2 === 0 ? exportColors.rowA : exportColors.rowB, exportCardBorder);

        fillRoundedRect(88, currentY + 24, 48, 48, 15, exportColors.primary);
        context.fillStyle = exportColors.primaryText;
        context.font = '700 24px "Mali", cursive';
        const numberText = String(index + 1);
        context.fillText(numberText, 112 - context.measureText(numberText).width / 2, currentY + 57);

        context.fillStyle = exportColors.text;
        context.font = '700 31px "Mali", cursive';
        context.fillText(`${item.name} ×${item.quantity}`, 158, currentY + 50, 560);
        context.fillStyle = exportColors.text;
        context.font = '700 32px "Mali", cursive';
        fillTextFromRight(`฿${Number(item.amount).toFixed(2)}`, 978, currentY + 51, 755);

        context.fillStyle = exportColors.subtext;
        context.font = '600 26px "Mali", cursive';
        payerLines.forEach((line, lineIndex) => {
          context.fillText(line, 158, currentY + 88 + lineIndex * 34, 800);
        });
        currentY += rowHeight + 14;
      });

      currentY += 42;
      context.fillStyle = exportColors.subtext;
      context.font = '700 25px "Mali", cursive';
      context.fillText(`ยอดที่ต้องจ่าย · ${summarySettlements.length} คน`, 74, currentY);
      currentY += 28;

      summarySettlements.forEach((settlement, index) => {
        const y = currentY + index * 94;
        fillRaisedRoundedRect(64, y, 952, 80, 22, index % 2 === 0 ? exportColors.rowA : exportColors.rowB, exportCardBorder);
        context.fillStyle = exportColors.text;
        context.font = '700 32px "Mali", cursive';
        context.fillText(settlement.name, 100, y + 52, 610);
        context.fillStyle = exportColors.text;
        context.font = '700 34px "Mali", cursive';
        fillTextFromRight(`฿${Number(settlement.amount).toFixed(2)}`, 978, y + 53, 750);
      });

      const { default: QRCode } = await import('qrcode');
      const qrCanvas = document.createElement('canvas');
      await QRCode.toCanvas(qrCanvas, shareUrl, {
        ...SHARE_QR_OPTIONS,
        width: 218,
      });
      fillRaisedRoundedRect(64, qrTop, 952, 280, 28, exportColors.rowA, exportCardBorder);
      fillRoundedRect(82, qrTop + 15, 250, 250, 22, '#FFFFFF', 'rgba(37, 44, 40, 0.1)');
      context.drawImage(qrCanvas, 98, qrTop + 31, 218, 218);

      context.fillStyle = exportColors.primary;
      context.font = '700 27px "Mali", cursive';
      context.fillText('SCAN TO SEE BILL DETAILS', 368, qrTop + 68, 596);
      context.fillStyle = exportColors.text;
      context.font = '700 29px "Mali", cursive';
      context.fillText('Open the full item and payment', 368, qrTop + 116, 596);
      context.fillText('breakdown on any phone', 368, qrTop + 153, 596);
      context.fillStyle = exportColors.subtext;
      context.font = '600 23px "Mali", cursive';
      context.fillText('Harn.fun/history', 368, qrTop + 202, 596);
      context.fillText('Anyone with this QR can view this bill.', 368, qrTop + 240, 596);

      context.fillStyle = exportColors.footer;
      context.font = '700 23px "Mali", cursive';
      context.fillText('HARN KUN · แบ่งง่าย จ่ายชัด', 72, height - 42);

      const safeEventName = summaryEventName.replace(/[^A-Za-z0-9\u0E00-\u0E7F]+/g, '-') || 'harn-kun';
      const fileName = `${safeEventName}-summary.png`;
      const blob = await canvasToPng(canvas);

      if (isIosDevice() && typeof navigator.share === 'function') {
        const file = new File([blob], fileName, { type: 'image/png' });
        let canShareFile = true;

        if (typeof navigator.canShare === 'function') {
          try {
            canShareFile = navigator.canShare({ files: [file] });
          } catch {
            canShareFile = false;
          }
        }

        if (canShareFile) {
          try {
            await navigator.share({ files: [file] });
            return;
          } catch (shareError) {
            if (shareError?.name === 'AbortError') return;
            console.warn('Could not open the iOS share sheet:', shareError);
          }
        }
      }

      downloadBlob(blob, fileName);
    } catch (downloadError) {
      console.error('Could not export summary picture:', downloadError);
      setError(downloadError instanceof Error ? downloadError.message : 'Could not download the summary picture.');
    }
  };

  if (isSharedHistoryRoute) {
    return (
      <main className="shared-receipt-page maggie-shared-screen">
        <DoodleField variant="shared" className="shared-receipt-doodles" />
        <NetworkStatusPill />
        <small className="app-version" title={`Git version from ${APP_VERSION_TIME}`}>{APP_VERSION}</small>
        <section className="shared-receipt-shell" aria-label="Shared bill details">
          <header className="shared-receipt-header">
            <a href="/" className="shared-receipt-brand" aria-label="Go to Harn Kun home">Harn Kun</a>
            <span>READ ONLY</span>
          </header>

          {!selectedHistory?.isShared && !error && (
            <div className="shared-receipt-loading" role="status" aria-label="Loading shared bill">
              <i /><i /><i /><i />
            </div>
          )}

          {!selectedHistory?.isShared && error && (
            <div className="shared-receipt-error" role="alert">
              <span>INVALID LINK</span>
              <h1>Could not open this bill</h1>
              <p>{error}</p>
              <a href="/">Go to Harn Kun</a>
            </div>
          )}

          {selectedHistory?.isShared && (
            <article className="shared-receipt-detail">
              <div className="shared-receipt-title">
                <div>
                  <span>SHARED BILL</span>
                  <h1>{selectedHistory.eventName}</h1>
                  <p>{new Date(selectedHistory.updatedAt).toLocaleString()}</p>
                </div>
                <div className="shared-receipt-total">
                  <span>TOTAL</span>
                  <strong>฿{Number(selectedHistory.total).toFixed(2)}</strong>
                  {(selectedHistory.vatEnabled || selectedHistory.discountEnabled) && (
                    <div className="shared-receipt-adjustments">
                      <small>Subtotal <b>฿{Number(selectedHistory.subtotal).toFixed(2)}</b></small>
                      {selectedHistory.vatEnabled && <small>VAT {Number(selectedHistory.vatRate)}% <b>+฿{Number(selectedHistory.vatAmount).toFixed(2)}</b></small>}
                      {selectedHistory.discountEnabled && <small>Discount <b>−฿{Number(selectedHistory.discountAmount).toFixed(2)}</b></small>}
                    </div>
                  )}
                </div>
              </div>

              <div className="shared-receipt-stats" aria-label="Bill summary">
                <div><strong>{selectedHistory.friends.length}</strong><span>People sharing this bill</span></div>
                <div><strong>{selectedHistory.billItems.length}</strong><span>Bill items</span></div>
                <div><strong>{selectedHistory.allocations.reduce((sum, names) => sum + names.length, 0)}</strong><span>Item assignments</span></div>
              </div>

              <section className="shared-receipt-section">
                <div className="shared-receipt-section-heading"><span>PEOPLE ON THIS BILL</span><b>{selectedHistory.friends.length}</b></div>
                <div className="shared-receipt-people">
                  {selectedHistory.friends.map((friend, index) => (
                    <div className="shared-receipt-person" key={friend}>
                      <span>{index + 1}</span>
                      <strong>{friend}</strong>
                      <small>{selectedHistory.allocations.filter((names) => names.includes(friend)).length} shared items</small>
                    </div>
                  ))}
                </div>
              </section>

              <section className="shared-receipt-section">
                <div className="shared-receipt-section-heading"><span>ITEMS & SHARING</span><b>{selectedHistory.billItems.length}</b></div>
                <div className="shared-receipt-items">
                  {selectedHistory.billItems.map((item, index) => {
                    const sharedWith = selectedHistory.allocations[index] || [];
                    const amountPerPerson = sharedWith.length > 0 ? Number(item.amount) / sharedWith.length : 0;
                    return (
                      <article className="shared-receipt-item" key={`${item.name}-${index}`}>
                        <header>
                          <span className="shared-receipt-number">{index + 1}</span>
                          <div>
                            <strong>{item.name}</strong>
                            <small>Quantity {item.quantity}</small>
                          </div>
                          <div className="shared-receipt-item-amount"><small>ITEM TOTAL</small><b>฿{Number(item.amount).toFixed(2)}</b></div>
                        </header>
                        <div className="shared-receipt-item-sharing">
                          <span>SHARED WITH {sharedWith.length} {sharedWith.length === 1 ? 'PERSON' : 'PEOPLE'}</span>
                          {sharedWith.length > 0 ? (
                            <div>
                              {sharedWith.map((friend) => (
                                <span key={friend}><strong>{friend}</strong><small>฿{amountPerPerson.toFixed(2)}</small></span>
                              ))}
                            </div>
                          ) : <p>No people selected for this item.</p>}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className="shared-receipt-section">
                <div className="shared-receipt-section-heading"><span>PAYMENT BREAKDOWN</span><b>{selectedHistory.settlements.length}</b></div>
                <div className="shared-receipt-payments">
                  {selectedHistory.settlements.map((settlement, index) => (
                    <article className="shared-receipt-payment" key={`${settlement.name}-${index}`}>
                      <span>{index + 1}</span>
                      <div><strong>{settlement.name}</strong><small>Total amount to pay</small></div>
                      <div><b>฿{Number(settlement.amount).toFixed(2)}</b><small>{Number(selectedHistory.total) > 0 ? `${(Number(settlement.amount) / Number(selectedHistory.total) * 100).toFixed(1)}% of bill` : '0% of bill'}</small></div>
                    </article>
                  ))}
                </div>
              </section>

              <footer className="shared-receipt-footer">
                <span>This bill is shared as read-only.</span>
                <a href="/">Create a bill with Harn Kun</a>
              </footer>
            </article>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="app maggie-app">
      <NetworkStatusPill />
      <small className="app-version" title={`Git version from ${APP_VERSION_TIME}`}>{APP_VERSION}</small>
      <div className="silk-background" aria-hidden="true" />

      {showIntro && (
        <div className="desktop-first-visit" aria-hidden="true">
          <div className="intro-center-word">
            <span className="intro-letter intro-letter-h">H</span>
            <span className="intro-letter intro-letter-a" aria-hidden="true">
              <svg className="intro-a-mascot" viewBox="0 0 100 100" aria-hidden="true">
                <path className="intro-a-shape" fillRule="evenodd" d="M0 95V25C0 11.2 11.2 0 25 0h50c13.8 0 25 11.2 25 25v70H0Zm44 0V58a6 6 0 0 1 12 0v37H44Z" />
                <g transform="translate(0 -5)">
                  <circle className="intro-a-face" cx="36" cy="30" r="6" />
                  <circle className="intro-a-face" cx="64" cy="30" r="6" />
                  <path className="intro-a-face" d="M42 38h16c-.5 5-3.7 7.5-8 7.5s-7.5-2.5-8-7.5Z" />
                </g>
              </svg>
            </span>
            <span className="intro-letter intro-letter-r">R</span>
            <span className="intro-letter intro-letter-n">N</span>
          </div>
        </div>
      )}
      <section className="home-dashboard" aria-label="Harn Kun home">
        <section className="home-landing-page" aria-label="Welcome to Harn Kun">
        <DoodleField variant="hero" className="home-hero-doodles" />
        <header className="home-header">
          <div className="home-brand-row">
            <svg className="home-brand-mark" viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="17" />
              <path d="M10 13h16M10 18h12M10 23h8" />
              <path className="home-brand-leaf" d="M25 3c1-3 3-4 6-3-1 3-3 4-6 3Z" />
            </svg>
            <h1 onClick={handleBrandHistoryClick}>Harn Kun</h1>
          </div>
          <p>Split any bill, share every expense clearly.</p>
          <div className="home-hero">
            <div className="home-hero-copy">
              <span>LESS MATH. MORE MEMORIES.</span>
              <h2><span className="mobile-hero-title">Good times.<br /><em>Fair shares.</em></span><span className="desktop-hero-title">GOOD TIMES.<br />FAIR SHARES.</span></h2>
              <p>Split the bill with your people, minus the awkward math.</p>
              <div className="home-scroll-cue" aria-hidden="true">
                <span>Scroll Down</span>
                <svg viewBox="0 0 20 20"><path d="M10 3v12m-5-5 5 5 5-5" /></svg>
              </div>
            </div>
            <svg className="home-hero-art" viewBox="0 0 112 132" aria-hidden="true">
              <path className="hero-sun" d="M28 6c10 0 18 8 18 18S38 42 28 42 10 34 10 24 18 6 28 6Z" />
              <g className="hero-receipt" transform="rotate(8 69 72)">
                <path d="M42 35h58v78l-6-3-6 4-7-4-6 4-7-4-6 4-7-4-7 4-8-4V35Z" />
                <path className="receipt-line" d="M52 51h25m-25 10h38m-38 11h31m-31 11h38m-38 11h21" />
                <path className="receipt-total" d="M52 104h38" />
              </g>
              <path className="hero-spark" d="m99 19 2.5 5.5L107 27l-5.5 2.5L99 35l-2.5-5.5L91 27l5.5-2.5L99 19Z" />
              <path className="hero-leaf" d="M29 47c8-2 13 1 14 8-7 2-12-1-14-8Z" />
            </svg>
          </div>
        </header>
        </section>

        <BitsButton
          ref={homeCreateButtonRef}
          type="button"
          className="home-create-button home-create-featured home-create-primary"
          aria-label={hasActiveDraft ? 'Resume splitting the current bill' : 'Create a new bill split'}
          aria-expanded={isCreating}
          onClick={openPanel}
        >
          <span aria-hidden="true">{hasActiveDraft ? '▶' : '+'}</span>
          <strong>{hasActiveDraft ? 'Continue your bill' : 'Split a bill'}</strong>
          <small>Add friends, scan, and split in a few taps</small>
          <b aria-hidden="true">›</b>
        </BitsButton>


        <section className="home-history-panel" aria-label="Recent bills">
          <DoodleField variant="history" className="home-history-doodles" />
                <div className="home-recent-heading">
          <div><span>ON THIS DEVICE</span><h2>Recent bills</h2></div>
          <div className="home-history-actions">
            <b>{historyRecords.length}</b>
            <div className="home-history-sort-control" ref={sortDrawerRef}>
              <BitsButton type="button" className="home-history-sort" aria-label="Sort recent bills" aria-haspopup="listbox" aria-expanded={sortDrawerOpen} onClick={() => setSortDrawerOpen((open) => !open)}>
                <span>{{ newest: 'Newest', oldest: 'Oldest', highest: 'High total', lowest: 'Low total' }[historySort]}</span>
              </BitsButton>
              <div className={`home-sort-drawer${sortDrawerOpen ? ' is-open' : ''}`} role="listbox" aria-label="Sort recent bills">
                {[
                  ['newest', 'Newest'],
                  ['oldest', 'Oldest'],
                  ['highest', 'Highest total'],
                  ['lowest', 'Lowest total'],
                ].filter(([value]) => value !== historySort).map(([value, label]) => (
                  <BitsButton
                    type="button"
                    role="option"
                    aria-selected="false"
                    tabIndex={sortDrawerOpen ? 0 : -1}
                    key={value}
                    onClick={() => {
                      setHistorySort(value);
                      setSortDrawerOpen(false);
                    }}
                  >
                    <span>{label}</span>
                  </BitsButton>
                ))}
              </div>
            </div>
            <BitsButton type="button" className="home-clear-history" disabled={historyLoading || historyRecords.length === 0} onClick={clearHistory} aria-label="Clear history">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" />
              </svg>
            </BitsButton>
          </div>
        </div>

        <div className={`home-history-list${!historyLoading && historyRecords.length === 0 ? ' is-empty' : ''}`} aria-live="polite">
          {historyLoading && (
            <div className="home-history-skeleton" role="status" aria-label="Loading recent bills">
              {[0, 1, 2].map((item) => (
                <div className="home-history-skeleton-card" aria-hidden="true" key={item}>
                  <span className="skeleton-line skeleton-line-date" />
                  <span className="skeleton-line skeleton-line-title" />
                  <span className="skeleton-line skeleton-line-meta" />
                  <span className="skeleton-line skeleton-line-total" />
                </div>
              ))}
            </div>
          )}
          {!historyLoading && historyRecords.length === 0 && (
            <BitsSurface className="home-history-empty">
              <Doodle kind="plate" className="home-empty-art" />
              <div className="home-history-empty-copy">
                <span>READY WHEN YOU ARE</span>
                <strong>No bills yet</strong>
                <p>Create your first bill split and it will appear here.</p>
              </div>
              <BitsButton type="button" className="home-empty-create-button" onClick={openPanel}>Create your first bill <span aria-hidden="true">→</span></BitsButton>
            </BitsSurface>
          )}
          {!historyLoading && groupedHistoryRecords.map((group) => (
            <section className="home-history-day-group" key={group.dayStart ?? 'all-history'}>
              {group.dayStart !== null && (
                <div className="home-history-day-heading">
                  <span>{formatHistoryDayLabel(group.dayStart)}</span>
                  <b>{group.records.length}</b>
                </div>
              )}
              {group.records.map((record) => (
                <div className={`home-history-card-shell${removingHistoryId === record.id ? ' is-removing' : ''}${homeHistorySwipe.id === record.id ? ' is-swiping' : ''}`} key={record.id}>
              <div
                className={`home-history-delete-underlay${homeHistorySwipe.id === record.id && homeHistorySwipe.offset < -4 ? ' is-visible' : ''}${homeHistorySwipe.id === record.id && homeHistorySwipe.holding ? ' is-holding' : ''}`}
                style={{
                  '--delete-swipe-progress': homeHistorySwipe.id === record.id ? Math.min(1, Math.abs(homeHistorySwipe.offset) / 112) : 0,
                  '--delete-swipe-opacity': homeHistorySwipe.id === record.id ? 0.2 + Math.min(1, Math.abs(homeHistorySwipe.offset) / 112) * 0.8 : 0,
                  '--delete-swipe-saturation': homeHistorySwipe.id === record.id ? 0.5 + Math.min(1, Math.abs(homeHistorySwipe.offset) / 112) * 1.35 : 0.5,
                  '--delete-swipe-brightness': homeHistorySwipe.id === record.id ? 0.62 + Math.min(1, Math.abs(homeHistorySwipe.offset) / 112) * 0.48 : 0.62,
                }}
                aria-hidden="true"
              >
                <div className="home-history-delete-indicator">
                  <svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" /><circle className="delete-progress-ring" cx="22" cy="22" r="19" /></svg>
                  <span>
                    <svg className="delete-trash-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" />
                    </svg>
                  </span>
                </div>
              </div>
              <BitsButton
                type="button"
                className={`history-card home-history-card${homeHistorySwipe.id === record.id ? ' is-swiping' : ''}`}
                style={{ transform: `translate3d(${homeHistorySwipe.id === record.id ? homeHistorySwipe.offset : 0}px, 0, 0)` }}
                onPointerDown={(event) => beginHomeHistorySwipe(event, record)}
                onPointerMove={moveHomeHistorySwipe}
                onPointerUp={(event) => finishHomeHistorySwipe(event, record)}
                onPointerCancel={cancelHomeHistorySwipe}
                onClick={() => openHomeHistoryRecord(record)}
              >
                <HistoryCategoryIcon record={record} />
                <span className="history-card-date">
                  {historySort === 'newest'
                    ? new Date(record.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                    : new Date(record.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <strong>{record.eventName}</strong>
                <span className="history-card-people" aria-hidden="true">
                  {record.friends.slice(0, 3).map((friend, index) => {
                    const initials = friend.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
                    return <span key={`${friend}-${index}`} title={friend}>{initials || '?'}</span>;
                  })}
                  {record.friends.length > 3 && <span className="history-card-people-more">+{record.friends.length - 3}</span>}
                </span>
                <small>{record.friends.length} people · {record.billItems.length} items</small>
                <b>฿{Number(record.total).toFixed(2)}</b>
                <i aria-hidden="true">›</i>
              </BitsButton>
                </div>
              ))}
            </section>
          ))}
        </div>
        <footer className="home-history-footer" aria-label="Harn Kun footer">
          <div className="home-history-footer-brand">
            <svg className="home-history-footer-mark" viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="17" />
              <path d="M10 13h16M10 18h12M10 23h8" />
            </svg>
            <div>
              <strong>Harn Kun</strong>
              <span>Good times, shared fairly.</span>
            </div>
          </div>
          <small>© {new Date().getFullYear()} Harn Kun</small>
        </footer>
        </section>

        {historyDeleteInputLocked && (
          <div className="history-delete-input-shield" aria-hidden="true" />
        )}

        {clearHistoryConfirmOpen && (
          <div className="home-confirm-backdrop" role="presentation" onPointerDown={() => { if (!historyLoading) setClearHistoryConfirmOpen(false); }}>
            <BitsSurface className="home-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-history-title" aria-describedby="clear-history-description" onPointerDown={(event) => event.stopPropagation()}>
              <div className="home-confirm-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" /></svg>
              </div>
              <span>DELETE HISTORY</span>
              <h2 id="clear-history-title">Remove all bills?</h2>
              <p id="clear-history-description">This will permanently remove all {historyRecords.length} bills stored on this device.</p>
              <div className="home-confirm-actions">
                <BitsButton type="button" disabled={historyLoading} onClick={() => setClearHistoryConfirmOpen(false)}>Cancel</BitsButton>
                <BitsButton type="button" className="home-confirm-delete" disabled={historyLoading} onClick={confirmClearHistory}>{historyLoading ? 'Removing…' : 'Remove all bills'}</BitsButton>
              </div>
            </BitsSurface>
          </div>
        )}
      </section>

      <StaggeredMenu
        openRequest={menuOpenRequest}
        closeRequest={menuCloseRequest}
        onClose={closeHistory}
      >
        {historyView && (
          <div className="staggered-history-content">
            <DoodleField variant="drawer" className="history-doodles" />
            <div className="panel-heading history-panel-heading">
              <div>
                <div className="panel-meta"><span>{selectedHistory?.isShared ? 'SHARED RECEIPT' : 'ON THIS DEVICE'}</span></div>
                <h2>{historyView === 'detail' ? selectedHistory?.eventName : 'History'}</h2>
              </div>
              {historyView === 'detail' && selectedHistory && !selectedHistory.isShared && (
                <BitsButton type="button" className="history-edit-icon-button" onClick={() => editHistoryRecord(selectedHistory)} aria-label="Edit this bill" title="Edit this bill">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.2 5.8 4 4M4 20l4.3-.9L19 8.4a2.1 2.1 0 0 0-3-3L5.3 16.1 4 20Z" /></svg>
                </BitsButton>
              )}
            </div>

            {historyView === 'detail' && selectedHistory && (
              <div className="history-detail">
                <BitsSurface className="history-detail-summary">
                  <div><span>TOTAL</span><strong>฿{Number(selectedHistory.total).toFixed(2)}</strong></div>
                  <small>{new Date(selectedHistory.updatedAt).toLocaleString()}</small>
                </BitsSurface>

                <h3>Items and sharing</h3>
                <div className="history-food-list">
                  {selectedHistory.billItems.map((item, index) => (
                    <BitsSurface as="article" className="history-food-row" key={`${item.name}-${index}`}>
                      <div><strong>{item.name}</strong><span>×{item.quantity} · split between {(selectedHistory.allocations[index] || []).length}</span></div>
                      <b>฿{Number(item.amount).toFixed(2)}</b>
                      <p>{(selectedHistory.allocations[index] || []).join(', ') || 'No one selected'}</p>
                    </BitsSurface>
                  ))}
                </div>

                <h3>Who pays</h3>
                <div className="history-payment-list">
                  {selectedHistory.settlements.map((settlement) => (
                    <BitsSurface className="history-payment-row" key={settlement.name}>
                      <strong>{settlement.name}</strong><b>฿{Number(settlement.amount).toFixed(2)}</b>
                    </BitsSurface>
                  ))}
                </div>
                {error && <p className="form-error" role="alert">{error}</p>}
                <BitsButton type="button" className="download-button history-download-button" onClick={() => downloadSummary(selectedHistory)}>
                  Download as picture
                </BitsButton>
                {!selectedHistory.isShared && <BillShareQr record={selectedHistory} />}
              </div>
            )}
          </div>
        )}
      </StaggeredMenu>

      {billPhotoOpen && billImageUrl && createPortal(
        <div className="bill-photo-modal-backdrop" role="presentation" onPointerDown={() => setBillPhotoOpen(false)}>
          <section className="bill-photo-modal" role="dialog" aria-modal="true" aria-label="Bill photo preview" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" className="bill-photo-modal-close" onClick={() => setBillPhotoOpen(false)} aria-label="Close bill photo">×</button>
            <strong>Bill photo</strong>
            <div><img src={billImageUrl} alt="Large preview of the selected bill" /></div>
          </section>
        </div>,
        document.body,
      )}

      {isCreating && <GuidedWorkflowView flow={{
        BitsButton, BitsSurface, isWorkflowClosing, workflowDirection, step, splitIndex,
        eventName, friendName, friends, error, billItems, billImageUrl, ocrStatus,
        ocrProgress, cooldownRemaining, cameraFlow, pendingCameraUrl, cropAspect,
        cropBaseSize, cropTransform, isCropping, editingBillIndex, vatEnabled, vatRate,
        discountEnabled, discountAmount, subtotal, vatAmount, appliedDiscount, total,
        allocations, isSaving, settlements, peopleNameConfirmed, manualComposerOpen,
        manualItemName, manualItemPrice, manualQuantity, showManualQuantity, showBillExtras,
        inputRef, manualNameRef, cameraInputRef, uploadInputRef, cropWorkspaceRef,
        cropFrameRef, cropImageRef, billListRef, billEditorRef,
        closePanel, closeCameraFlow, guidedGoBack, setEventName, setFriendName, addFriend, removeFriend,
        setPeopleNameConfirmed, continueToBill, startCameraFlow, chooseCameraBill,
        chooseBill, beginCropDrag, moveCropDrag, endCropDrag, zoomCropWithWheel,
        toggleCropAspect, initializeCropEditor, confirmCameraBill, setBillPhotoOpen,
        setManualComposerOpen, setManualItemName, setManualItemPrice, setManualQuantity,
        setShowManualQuantity, setShowBillExtras, addManualItemFromComposer,
        setEditingBillIndex, updateBillItem, removeBillItem, setVatEnabled, setVatRate,
        setDiscountEnabled, setDiscountAmount, startSplitting, toggleFriendForItem,
        toggleAllFriendsForItem, goToPreviousFood, goToNextFood, downloadSummary,
        finishOperation, selectWholeValue,
      }} />}
    </main>
  );
}

const RootView = window.location.pathname === '/admin' ? AdminPanel : App;
const sanitizeSpeedInsight = (event) => ({
  ...event,
  url: event.url.split(/[?#]/, 1)[0],
  route: window.location.pathname,
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootView />
    <SpeedInsights route={window.location.pathname} beforeSend={sanitizeSpeedInsight} />
  </StrictMode>,
);
