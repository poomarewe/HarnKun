import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import '@fontsource/mali/400.css';
import '@fontsource/mali/600.css';
import '@fontsource/mali/700.css';
import { BitsButton, BitsSurface } from './ReactBitsUI';
import StaggeredMenu from './StaggeredMenu';
import './critical.css';
import './clay-home.css';

const APP_VERSION = __APP_VERSION__;
const APP_VERSION_TIME = __APP_VERSION_TIME__;
let appStylesPromise;

const loadAppStyles = () => {
  if (!appStylesPromise) {
    appStylesPromise = import('./styles.css').then(() => import('./clay.css'));
  }
  return appStylesPromise;
};

const SHARE_HISTORY_URL = 'https://harn-kun.vercel.app/history';
const SHARE_QR_OPTIONS = {
  margin: 2,
  errorCorrectionLevel: 'M',
  color: { dark: '#0F172A', light: '#FFFFFF' },
};
const historyQrCache = new Map();

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

const THAI_DIGITS = { '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4', '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9' };
const SUMMARY_WORDS = /(?:ยอดรวม|รวมมูลค่า|รวมทั้งสิ้น|ยอดสุทธิ|สุทธิ|จำนวน\s*\d*\s*ชิ้น|subtotal|total|vat|ภาษี|service|ค่าบริการ|ส่วนลด|discount|เงินสด|เงินทอน|change|ชำระ)/i;
const META_WORDS = /(?:ใบเสร็จ|receipt|invoice|tax\s*id|เลขประจำตัว|โทร|tel|โต๊ะ|table|คิว|queue|วันที่|date|เวลา|time|พนักงาน|cashier|pos\s*#|สาขา|บริษัท|line\s*[:@]|powered)/i;

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
  const isSharedHistoryRoute = window.location.pathname === '/history';
  const [theme, setTheme] = useState(() => {
    try {
      return window.localStorage.getItem('harn-kun-theme') === 'dark' ? 'dark' : 'finance';
    } catch {
      return 'finance';
    }
  });
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
  const [homeHistorySwipe, setHomeHistorySwipe] = useState({ id: null, offset: 0, holding: false });
  const [removingHistoryId, setRemovingHistoryId] = useState(null);
  const [historyDeleteInputLocked, setHistoryDeleteInputLocked] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [step, setStep] = useState('friends');
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
  const billSwipeRef = useRef(null);
  const billListRef = useRef(null);
  const billEditorRef = useRef(null);
  const workflowCloseTimerRef = useRef(null);

  useEffect(() => {
    const themeBackground = theme === 'dark' ? '#272432' : '#ebe8f3';
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
    if (isCreating && step === 'friends') inputRef.current?.focus();
  }, [isCreating, step]);

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

    const scrollEditorToBottom = () => {
      const list = billListRef.current;
      if (!list || !billEditorRef.current) return;
      list.scrollTop = list.scrollHeight;
    };

    const frame = window.requestAnimationFrame(scrollEditorToBottom);
    const timers = [120, 320, 600].map((delay) => window.setTimeout(scrollEditorToBottom, delay));
    window.visualViewport?.addEventListener('resize', scrollEditorToBottom);
    return () => {
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
      window.visualViewport?.removeEventListener('resize', scrollEditorToBottom);
    };
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
    setStep('friends');
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
      swipe.holdTimer = window.setTimeout(() => completeHeldHistoryDelete(swipe), 1800);
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
    setFriends(friends.filter((_, index) => index !== indexToRemove));
    setError('');
  };

  const continueToBill = () => {
    if (friends.length < 2) return;
    document.activeElement?.blur();
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
    setEditingBillIndex((currentIndex) => {
      if (currentIndex === indexToRemove) return null;
      return currentIndex > indexToRemove ? currentIndex - 1 : currentIndex;
    });
  };

  const addManualItem = () => {
    setEditingBillIndex(billItems.length);
    setBillItems((currentItems) => [...currentItems, { name: '', quantity: 1, amount: 0 }]);
    setOcrStatus('review');
    setError('');
  };

  const beginBillSwipe = (event, index) => {
    if (event.pointerType === 'mouse' || editingBillIndex === index) return;
    billSwipeRef.current = {
      index,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      element: event.currentTarget,
      dragging: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveBillSwipe = (event) => {
    const swipe = billSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - swipe.startX;
    const deltaY = event.clientY - swipe.startY;
    if (!swipe.dragging && Math.abs(deltaX) < 8) return;
    if (!swipe.dragging && Math.abs(deltaY) > Math.abs(deltaX)) return;

    swipe.dragging = true;
    const offset = Math.max(-88, Math.min(88, deltaX));
    swipe.element.style.transform = `translate3d(${offset}px, 0, 0)`;
    swipe.element.classList.toggle('swiping-edit', offset > 0);
    swipe.element.classList.toggle('swiping-remove', offset < 0);
  };

  const finishBillSwipe = (event, shouldAct = true) => {
    const swipe = billSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - swipe.startX;
    if (swipe.element.hasPointerCapture?.(event.pointerId)) {
      swipe.element.releasePointerCapture(event.pointerId);
    }
    swipe.element.style.removeProperty('transform');
    swipe.element.classList.remove('swiping-edit', 'swiping-remove');
    billSwipeRef.current = null;

    if (!shouldAct || !swipe.dragging) return;
    if (deltaX <= -68) removeBillItem(swipe.index);
    if (deltaX >= 68) setEditingBillIndex(swipe.index);
  };

  const startSplitting = () => {
    const cleanItems = billItems.filter((item) => item.name.trim());
    if (cleanItems.length === 0) {
      setError('Add at least one bill item before splitting.');
      return;
    }

    setBillItems(cleanItems);
    setEditingBillIndex(null);
    setAllocations(cleanItems.map(() => []));
    setSplitIndex(0);
    setSettlements([]);
    setError('');
    document.activeElement?.blur();
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
        createdAt: now,
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
    setSplitIndex((index) => index + 1);
    setError('');
  };

  const goToPreviousFood = () => {
    if (splitIndex === 0) return;
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
        setStep('friends');
      }
    } else if (step === 'split') {
      if (splitIndex > 0) setSplitIndex((index) => index - 1);
      else setStep('bill');
    } else if (step === 'result') {
      setSplitIndex(Math.max(0, billItems.length - 1));
      setStep('split');
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
        backgroundStart: '#272432',
        backgroundMiddle: '#302C3E',
        backgroundEnd: '#1E1B29',
        glowStart: 'rgba(169, 155, 234, 0.24)',
        glowEnd: 'rgba(169, 155, 234, 0)',
        coralStart: 'rgba(255, 146, 141, 0.16)',
        primary: '#A99BEA',
        primaryText: '#272432',
        text: '#F6F2FB',
        subtext: '#B6AEC3',
        summary: '#373247',
        rowA: '#302C3E',
        rowB: '#373247',
        footer: '#B6AEC3',
        shadow: 'rgba(0, 0, 0, 0.34)',
      } : {
        backgroundStart: '#F0EDF6',
        backgroundMiddle: '#EBE8F3',
        backgroundEnd: '#DDD7E9',
        glowStart: 'rgba(132, 117, 214, 0.24)',
        glowEnd: 'rgba(132, 117, 214, 0)',
        coralStart: 'rgba(255, 130, 124, 0.16)',
        primary: '#8475D6',
        primaryText: '#FFFFFF',
        text: '#373348',
        subtext: '#777087',
        summary: '#F0EDF6',
        rowA: '#E9E5F1',
        rowB: '#E3DEED',
        footer: '#777087',
        shadow: 'rgba(76, 65, 101, 0.2)',
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
      coralGlow.addColorStop(1, 'rgba(255, 130, 124, 0)');
      context.fillStyle = coralGlow;
      context.fillRect(0, Math.max(0, height - 720), 760, 720);

      context.fillStyle = exportColors.primary;
      context.font = '700 34px "Mali", cursive';
      context.fillText('หารกัน', 72, 82);
      context.fillStyle = exportColors.text;
      context.font = '700 64px "Mali", cursive';
      context.fillText(summaryEventName, 72, 162, 936);

      const exportCardBorder = isDarkExport ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)';

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
      fillRoundedRect(82, qrTop + 15, 250, 250, 22, '#FFFFFF', 'rgba(15, 23, 42, 0.1)');
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
      context.fillText('harn-kun.vercel.app/history', 368, qrTop + 202, 596);
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

  const stepNumber = step === 'friends' ? 1 : 2;

  const toggleTheme = () => {
    const updateTheme = () => setTheme((current) => current === 'dark' ? 'finance' : 'dark');
    const useFullPageTransition = window.innerWidth >= 760
      && !window.matchMedia('(pointer: coarse)').matches
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (document.startViewTransition && useFullPageTransition) {
      document.startViewTransition(updateTheme);
    } else {
      updateTheme();
    }
  };

  if (isSharedHistoryRoute) {
    return (
      <main className="shared-receipt-page">
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
    <main className="app">
      <small className="app-version" title={`Git version from ${APP_VERSION_TIME}`}>{APP_VERSION}</small>
      <div className="silk-background" aria-hidden="true" />

      <section className="home-dashboard" aria-label="Harn Kun home">
        <button
          type="button"
          className="mobile-theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Use light mode' : 'Use dark mode'}
          aria-pressed={theme === 'dark'}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <header className="home-header">
          <div><h1>Harn Kun</h1></div>
          <p>Split any bill, share every expense clearly.</p>
        </header>

        <section className="home-history-panel" aria-label="Recent bills">
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

        <div className="home-history-list" aria-live="polite">
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
              <BitsButton
                type="button"
                className="home-create-button home-empty-create-button"
                aria-label={hasActiveDraft ? 'Resume splitting the current bill' : 'Create a new bill split'}
                aria-expanded={isCreating}
                onClick={openPanel}
              >
                <span aria-hidden="true">{hasActiveDraft ? '▶' : '+'}</span>
              </BitsButton>
              <strong>No bills yet</strong>
              <p>Create your first bill split and it will appear here.</p>
            </BitsSurface>
          )}
          {!historyLoading && sortedHistoryRecords.map((record) => (
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
                <span className="history-card-date">{new Date(record.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                <strong>{record.eventName}</strong>
                <small>{record.friends.length} people · {record.billItems.length} items</small>
                <b>฿{Number(record.total).toFixed(2)}</b>
                <i aria-hidden="true">›</i>
              </BitsButton>
            </div>
          ))}
        </div>
        </section>

        {historyDeleteInputLocked && (
          <div className="history-delete-input-shield" aria-hidden="true" />
        )}

        {(historyLoading || historyRecords.length > 0) && (
          <BitsButton
            type="button"
            className="home-create-button"
            aria-label={hasActiveDraft ? 'Resume splitting the current bill' : 'Create a new bill split'}
            aria-expanded={isCreating}
            onClick={openPanel}
          >
            <span aria-hidden="true">{hasActiveDraft ? '▶' : '+'}</span>
          </BitsButton>
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
        onClose={closeHistory}
      >
        {historyView && (
          <div className="staggered-history-content">
            <div className="panel-heading history-panel-heading">
              <div>
                <div className="panel-meta"><span>{selectedHistory?.isShared ? 'SHARED RECEIPT' : 'ON THIS DEVICE'}</span></div>
                <h2>{historyView === 'detail' ? selectedHistory?.eventName : 'History'}</h2>
              </div>
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

      {isCreating && (
        <div className={`overlay${isWorkflowClosing ? ' is-closing' : ''}`} role="presentation" onMouseDown={closePanel}>
          <BitsSurface as="section" className={`operation-panel step-${step}`} aria-label="New operation" onMouseDown={(event) => event.stopPropagation()}>
            <div className="panel-handle" />
            <div className="panel-heading">
              {step !== 'friends' && (
                <BitsButton
                  type="button"
                  className="small-back-button"
                  aria-label="Back"
                  disabled={isSaving || ocrStatus === 'scanning'}
                  onClick={goBack}
                >
                  ←
                </BitsButton>
              )}
              <div className="panel-heading-content">
                <div className="panel-meta">
                  <span>
                    {step === 'split' ? `ITEM ${splitIndex + 1} OF ${billItems.length}` : step === 'result' ? 'ALL DONE' : `STEP ${stepNumber} OF 2`}
                  </span>
                </div>
                {step === 'friends' && (
                  <div className="friends-title">
                    <h2>Add people to <strong>{eventName}</strong></h2>
                  </div>
                )}
                {step === 'bill' && <h2>Scan your bill</h2>}
                {step === 'split' && <h2>Who shared this item?</h2>}
                {step === 'result' && <h2>Payment summary</h2>}
              </div>
              <BitsButton type="button" className="close-button" onClick={closePanel} aria-label="Close">×</BitsButton>
            </div>

            {step === 'friends' && (
              <div className="friends-step">
                <form className="friend-form" autoComplete="off" data-form-type="other" onSubmit={addFriend}>
                  <label htmlFor="friend-name">Person's name</label>
                  <div className="friend-input-row">
                    <input ref={inputRef} id="friend-name" name="friend-name-entry" value={friendName} onChange={(event) => setFriendName(event.target.value)} type="text" placeholder="Type a name" autoComplete="off" data-form-type="other" data-lpignore="true" enterKeyHint="done" maxLength="60" disabled={friends.length >= 100} />
                    <BitsButton type="submit" className="add-button" disabled={!friendName.trim() || friends.length >= 100}>Add</BitsButton>
                  </div>
                </form>

                <div className="friends-heading"><span>People</span><strong>{friends.length} / 100</strong></div>
                <div className="friend-list" aria-live="polite">
                  {friends.length === 0 ? <p className="empty-list">Add at least 2 people to continue.</p> : friends.map((friend, index) => (
                    <BitsButton key={`${friend}-${index}`} type="button" className="friend-chip" onClick={() => removeFriend(index)}>
                      <span>{friend}</span><b aria-label={`Remove ${friend}`}>×</b>
                    </BitsButton>
                  ))}
                </div>

                {error && <p className="form-error" role="alert">{error}</p>}
                <BitsButton className="save-button apply-button" type="button" disabled={friends.length < 2} onClick={continueToBill}>
                  {friends.length < 2 ? `Add ${2 - friends.length} more` : 'Continue to bill'}
                </BitsButton>
              </div>
            )}

            {step === 'bill' && (
              <div className="bill-step">
                <input ref={cameraInputRef} className="hidden-file-input" type="file" accept="image/*" capture="environment" onChange={chooseCameraBill} />
                <input ref={uploadInputRef} className="hidden-file-input" type="file" accept="image/*" onChange={chooseBill} />

                {cameraFlow && (
                  <div className="mobile-camera-flow is-editor" role="dialog" aria-modal="true" aria-label="Crop bill photo">
                    <p className="camera-editor-copy"><strong>Adjust your photo</strong><span>Drag with one finger and pinch with two fingers until only the bill items are inside the box.</span></p>
                    <div
                      ref={cropWorkspaceRef}
                      className="camera-crop-workspace"
                      onPointerDown={beginCropDrag}
                      onPointerMove={moveCropDrag}
                      onPointerUp={endCropDrag}
                      onPointerCancel={endCropDrag}
                      onWheel={zoomCropWithWheel}
                    >
                      <BitsButton
                        type="button"
                        className="crop-aspect-toggle"
                        style={{ position: 'absolute', top: '12px', right: '12px', left: 'auto', insetInlineStart: 'auto', insetInlineEnd: '12px' }}
                        aria-label={`Switch crop frame to ${cropAspect === '16:9' ? '9 by 16 portrait' : '16 by 9 landscape'}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={toggleCropAspect}
                      >
                        <span>{cropAspect}</span>
                      </BitsButton>
                      {!cropBaseSize.width && <div className="camera-photo-skeleton" role="status" aria-label="Preparing photo"><span /></div>}
                      <img
                        ref={cropImageRef}
                        src={pendingCameraUrl}
                        alt="Bill to crop"
                        draggable="false"
                        onLoad={() => window.requestAnimationFrame(initializeCropEditor)}
                        style={{
                          width: `${cropBaseSize.width}px`,
                          height: `${cropBaseSize.height}px`,
                          transform: `translate(-50%, -50%) translate3d(${cropTransform.x}px, ${cropTransform.y}px, 0) rotate(${cropTransform.rotation}deg) scale(${cropTransform.zoom})`,
                        }}
                      />
                      <div ref={cropFrameRef} className={`camera-crop-frame${cropAspect === '9:16' ? ' is-portrait' : ''}`} aria-hidden="true" />
                    </div>
                    <div className="camera-confirm-actions">
                      <BitsButton type="button" disabled={isCropping} onClick={() => (cameraFlow === 'upload' ? uploadInputRef : cameraInputRef).current?.click()}>{cameraFlow === 'upload' ? 'Choose again' : 'Retake'}</BitsButton>
                      <BitsButton type="button" className="camera-confirm-button" disabled={!cropBaseSize.width || isCropping} onClick={confirmCameraBill}>{isCropping ? 'Preparing…' : 'Confirm'}</BitsButton>
                    </div>
                  </div>
                )}

                {!cameraFlow && billImageUrl && (
                  <BitsSurface className={`bill-preview${ocrStatus === 'scanning' ? ' is-scanning' : ''}`}>
                    <button type="button" className="bill-preview-image-button" onClick={() => setBillPhotoOpen(true)} aria-label="View bill photo full screen">
                      <img src={billImageUrl} alt="Selected bill" />
                    </button>
                    <div><strong>{ocrStatus === 'scanning' ? 'Reading your bill…' : 'Bill photo'}</strong><span></span></div>
                    {ocrStatus !== 'scanning' && (
                      <BitsButton type="button" disabled={cooldownRemaining > 0} onClick={() => uploadInputRef.current?.click()}>
                        {cooldownRemaining > 0 ? `Wait ${cooldownRemaining}s` : 'Change'}
                      </BitsButton>
                    )}
                  </BitsSurface>
                )}

                {!cameraFlow && (ocrStatus === 'scanning' ? (
                  <BitsSurface className="scan-progress" aria-live="polite">
                    <div><span style={{ width: `${Math.round(ocrProgress * 100)}%` }} /></div>
                    <p>กำลังอ่านใบเสร็จ… {Math.round(ocrProgress * 100)}%</p>
                    <div className="scan-result-skeleton" aria-hidden="true">
                      {[0, 1, 2].map((item) => (
                        <div key={item}><i /><span /><b /></div>
                      ))}
                    </div>
                  </BitsSurface>
                ) : (
                  <>
                    {!billImageUrl && ocrStatus === 'idle' && (
                      <div className="scan-start-options">
                        <BitsButton type="button" disabled={cooldownRemaining > 0} onClick={startCameraFlow}>
                          <span className="scan-option-icon" aria-hidden="true">●</span>
                          <span><strong>{cooldownRemaining > 0 ? `Wait ${cooldownRemaining}s` : 'Take picture'}</strong><small>Open your phone camera</small></span>
                          <b aria-hidden="true">›</b>
                        </BitsButton>
                        <BitsButton type="button" disabled={cooldownRemaining > 0} onClick={() => uploadInputRef.current?.click()}>
                          <span className="scan-option-icon upload-icon" aria-hidden="true">↑</span>
                          <span><strong>Upload photo</strong><small>Choose a bill from your device</small></span>
                          <b aria-hidden="true">›</b>
                        </BitsButton>
                        <BitsButton type="button" onClick={addManualItem}>
                          <span className="scan-option-icon manual-icon" aria-hidden="true">+</span>
                          <span><strong>Manual add</strong><small>Enter bill items and amounts yourself</small></span>
                          <b aria-hidden="true">›</b>
                        </BitsButton>
                      </div>
                    )}

                    {(ocrStatus === 'review' || billItems.length > 0) && (
                      <>
                        <div className={`bill-list-heading${editingBillIndex !== null ? ' is-editing' : ''}`}>
                          <span>Items detected</span>
                          <strong>{billItems.length} items</strong>
                          {editingBillIndex === null && <small className="bill-swipe-hint">Swipe right to edit · left to remove</small>}
                        </div>
                        {editingBillIndex === null && (
                          <div className="bill-column-headings" aria-hidden="true">
                            <span>Name</span><span>Quantity</span><span>Price</span><span />
                          </div>
                        )}
                        <div className="bill-list" ref={billListRef}>
                          {billItems.map((item, index) => {
                            const isEditing = editingBillIndex === index;
                            return (
                              <div className={`bill-item-shell${isEditing ? ' is-editing' : ''}`} key={`bill-item-${index}`}>
                                <div className="bill-swipe-underlay" aria-hidden="true">
                                  <span>Edit</span><span>Remove</span>
                                </div>
                                {isEditing ? (
                                  <BitsSurface className="bill-item bill-item-editor" ref={billEditorRef}>
                                    <label className="bill-field bill-field-name">
                                      <span>Name</span>
                                      <input autoFocus aria-label={`Item ${index + 1}`} name={`food-name-${index}`} value={item.name} onChange={(event) => updateBillItem(index, 'name', event.target.value)} placeholder="Item or expense" autoComplete="off" data-form-type="other" data-lpignore="true" />
                                    </label>
                                    <label className="bill-field bill-field-quantity">
                                      <span>Quantity</span>
                                      <input aria-label={`Quantity ${index + 1}`} name={`food-quantity-${index}`} type="number" min="1" inputMode="numeric" value={item.quantity} autoComplete="off" data-form-type="other" data-lpignore="true" onFocus={selectWholeValue} onClick={selectWholeValue} onChange={(event) => updateBillItem(index, 'quantity', event.target.value)} />
                                    </label>
                                    <label className="bill-field bill-field-amount">
                                      <span>Price</span>
                                      <input aria-label={`Amount ${index + 1}`} name={`food-price-${index}`} type="number" min="0" step="0.01" inputMode="decimal" value={item.amount} autoComplete="off" data-form-type="other" data-lpignore="true" onFocus={selectWholeValue} onClick={selectWholeValue} onChange={(event) => updateBillItem(index, 'amount', event.target.value)} />
                                    </label>
                                    <div className="bill-edit-actions">
                                      <BitsButton className="bill-delete-button" type="button" onClick={() => removeBillItem(index)}>Delete</BitsButton>
                                      <BitsButton className="bill-done-button" type="button" onClick={() => setEditingBillIndex(null)}>Done</BitsButton>
                                    </div>
                                  </BitsSurface>
                                ) : (
                                  <BitsSurface
                                    as="article"
                                    className="bill-item bill-item-compact"
                                    onPointerDown={(event) => beginBillSwipe(event, index)}
                                    onPointerMove={moveBillSwipe}
                                    onPointerUp={finishBillSwipe}
                                    onPointerCancel={(event) => finishBillSwipe(event, false)}
                                  >
                                    <strong className="bill-item-name">{item.name || 'Unnamed item'}</strong>
                                    <span className="bill-item-quantity">{Number(item.quantity) || 1}</span>
                                    <strong className="bill-item-price">฿{(Number(item.amount) || 0).toFixed(2)}</strong>
                                    <BitsButton className="bill-edit-button" type="button" onClick={() => setEditingBillIndex(index)} aria-label={`Edit ${item.name || 'item'}`}>Edit</BitsButton>
                                  </BitsSurface>
                                )}
                              </div>
                            );
                          })}
                          {editingBillIndex === null && (
                            <BitsButton type="button" className="manual-item-button bill-list-add-button" onClick={addManualItem}>+ Add item manually</BitsButton>
                          )}
                        </div>
                      </>
                    )}

                    {billImageUrl && ocrStatus === 'idle' && (
                      <div className="scan-actions">
                        <BitsButton type="button" className="upload-button" disabled={cooldownRemaining > 0} onClick={() => uploadInputRef.current?.click()}>
                          {cooldownRemaining > 0 ? `Try again in ${cooldownRemaining}s` : 'Try another photo'}
                        </BitsButton>
                      </div>
                    )}
                  </>
                ))}

                {!cameraFlow && error && <p className="form-error" role="alert">{error}</p>}
                {!cameraFlow && ocrStatus !== 'scanning' && (
                  <div className="bill-footer-actions">
                    {(ocrStatus === 'review' || billItems.length > 0) && (
                      <>
                        <BitsSurface className="bill-adjustments" aria-label="Bill adjustments">
                          <div
                            className={`bill-adjustment-row${vatEnabled ? ' is-enabled' : ''}`}
                            role="checkbox"
                            aria-checked={vatEnabled}
                            tabIndex="0"
                            onClick={() => setVatEnabled((enabled) => !enabled)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setVatEnabled((enabled) => !enabled);
                              }
                            }}
                          >
                            <div className="bill-adjustment-toggle">
                              <input type="checkbox" checked={vatEnabled} readOnly tabIndex="-1" aria-hidden="true" />
                              <span className="bill-adjustment-check" aria-hidden="true">✓</span>
                              <span><strong>VAT</strong><small>Add tax to the subtotal</small></span>
                            </div>
                            <label className="bill-adjustment-input" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => { event.stopPropagation(); if (!vatEnabled) setVatEnabled(true); }}>
                              <input aria-label="VAT percentage" type="number" min="0" max="100" step="0.01" inputMode="decimal" value={vatRate} disabled={!vatEnabled} onFocus={selectWholeValue} onClick={selectWholeValue} onChange={(event) => setVatRate(event.target.value)} />
                              <span>%</span>
                            </label>
                          </div>
                          <div
                            className={`bill-adjustment-row${discountEnabled ? ' is-enabled' : ''}`}
                            role="checkbox"
                            aria-checked={discountEnabled}
                            tabIndex="0"
                            onClick={() => setDiscountEnabled((enabled) => !enabled)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setDiscountEnabled((enabled) => !enabled);
                              }
                            }}
                          >
                            <div className="bill-adjustment-toggle">
                              <input type="checkbox" checked={discountEnabled} readOnly tabIndex="-1" aria-hidden="true" />
                              <span className="bill-adjustment-check" aria-hidden="true">✓</span>
                              <span><strong>Discount</strong><small>Subtract a fixed amount</small></span>
                            </div>
                            <label className="bill-adjustment-input" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => { event.stopPropagation(); if (!discountEnabled) setDiscountEnabled(true); }}>
                              <span>฿</span>
                              <input aria-label="Discount in baht" type="number" min="0" step="0.01" inputMode="decimal" value={discountAmount} disabled={!discountEnabled} onFocus={selectWholeValue} onClick={selectWholeValue} onChange={(event) => setDiscountAmount(event.target.value)} />
                            </label>
                          </div>
                        </BitsSurface>
                        <BitsSurface className="bill-total">
                          <span>TOTAL</span>
                          <div className="bill-total-breakdown">
                            <small>Subtotal ฿{subtotal.toFixed(2)}</small>
                            {vatEnabled && <small>VAT {Math.max(0, Number(vatRate) || 0)}% +฿{vatAmount.toFixed(2)}</small>}
                            {discountEnabled && <small>Discount −฿{appliedDiscount.toFixed(2)}</small>}
                          </div>
                          <strong>฿{total.toFixed(2)}</strong>
                        </BitsSurface>
                        <BitsButton className="save-button" type="button" disabled={!billItems.some((item) => item.name.trim())} onClick={startSplitting}>Confirm & split</BitsButton>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {step === 'split' && billItems[splitIndex] && (
              <div className="split-step">
                <BitsSurface className="split-food-card">
                  <span>ITEM</span>
                  <h3>{billItems[splitIndex].name}</h3>
                  <div>
                    <small>Quantity {billItems[splitIndex].quantity}</small>
                    <strong>฿{Number(billItems[splitIndex].amount).toFixed(2)}</strong>
                  </div>
                </BitsSurface>

                <div className="payer-heading">
                  <span>Who needs to pay?</span>
                  <div>
                    <strong>{(allocations[splitIndex] || []).length} selected</strong>
                    <BitsButton type="button" className="select-all-button" onClick={toggleAllFriendsForItem}>
                      {(allocations[splitIndex] || []).length === friends.length ? 'Clear all' : 'Select all'}
                    </BitsButton>
                  </div>
                </div>

                <div className="payer-list">
                  {friends.map((friend) => {
                    const isSelected = (allocations[splitIndex] || []).includes(friend);
                    return (
                      <BitsButton key={friend} type="button" className={`payer-option${isSelected ? ' selected' : ''}`} aria-pressed={isSelected} onClick={() => toggleFriendForItem(friend)}>
                        <span className="payer-check" aria-hidden="true">{isSelected ? '✓' : ''}</span>
                        <strong>{friend}</strong>
                        {isSelected && <small>฿{(Number(billItems[splitIndex].amount) / (allocations[splitIndex] || []).length).toFixed(2)}</small>}
                      </BitsButton>
                    );
                  })}
                </div>

                {error && <p className="form-error" role="alert">{error}</p>}
                <div className="split-navigation">
                  <BitsButton type="button" className="previous-button" disabled={splitIndex === 0 || isSaving} onClick={goToPreviousFood}>Previous</BitsButton>
                  <BitsButton type="button" className="next-button" disabled={(allocations[splitIndex] || []).length === 0 || isSaving} onClick={goToNextFood}>
                    {isSaving ? 'Calculating…' : splitIndex === billItems.length - 1 ? 'Calculate' : 'Next item'}
                  </BitsButton>
                </div>
              </div>
            )}

            {step === 'result' && (
              <div className="result-step">
                <BitsSurface className="result-event">
                  <span>BILL</span>
                  <strong>{eventName}</strong>
                  <small>Total ฿{total.toFixed(2)}</small>
                </BitsSurface>

                <div className="settlement-list">
                  {settlements.map((settlement, index) => (
                    <BitsSurface className="settlement-row" key={settlement.name}>
                      <span>{index + 1}</span>
                      <strong>{settlement.name}</strong>
                      <b>฿{settlement.amount.toFixed(2)}</b>
                    </BitsSurface>
                  ))}
                </div>

                {error && <p className="form-error" role="alert">{error}</p>}
                <BitsButton type="button" className="download-button" onClick={() => downloadSummary()}>Download as picture</BitsButton>
                <BitsButton type="button" className="done-button" onClick={finishOperation}>Done</BitsButton>
              </div>
            )}
          </BitsSurface>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
