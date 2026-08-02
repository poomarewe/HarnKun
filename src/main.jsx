import { lazy, StrictMode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import HeroTitle from './HeroTitle';
import { BitsButton, BitsSurface, ClickSpark } from './ReactBitsUI';
import SpecularButton from './SpecularButton';
import StaggeredMenu from './StaggeredMenu';
import './critical.css';

const Silk = lazy(() => import('./Silk'));
let appStylesPromise;

const loadAppStyles = () => {
  if (!appStylesPromise) appStylesPromise = import('./styles.css');
  return appStylesPromise;
};

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

function App() {
  const [silkReady, setSilkReady] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [hasActiveDraft, setHasActiveDraft] = useState(false);
  const [historyView, setHistoryView] = useState(null);
  const [historyRecords, setHistoryRecords] = useState([]);
  const [selectedHistory, setSelectedHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [step, setStep] = useState('friends');
  const [eventName, setEventName] = useState('');
  const [friendName, setFriendName] = useState('');
  const [friends, setFriends] = useState([]);
  const [billImageUrl, setBillImageUrl] = useState('');
  const [billItems, setBillItems] = useState([]);
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
  const billSwipeRef = useRef(null);
  const billListRef = useRef(null);
  const billEditorRef = useRef(null);

  const total = useMemo(
    () => billItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    [billItems],
  );

  useEffect(() => {
    let idleHandle;
    let fallbackTimer;
    let loadTimer;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const coarsePointer = window.matchMedia('(pointer: coarse)');

    // Phones and tablets use the lightweight CSS silk treatment. It preserves
    // the look without starting a continuous WebGL render loop on mobile CPUs.
    if (reducedMotion.matches || coarsePointer.matches || window.innerWidth <= 699) {
      return undefined;
    }

    const showSilk = () => setSilkReady(true);
    const scheduleSilk = () => {
      loadTimer = window.setTimeout(() => {
        if ('requestIdleCallback' in window) {
          idleHandle = window.requestIdleCallback(showSilk, { timeout: 800 });
        } else {
          fallbackTimer = window.setTimeout(showSilk, 150);
        }
      }, 250);
    };

    if (document.readyState === 'complete') scheduleSilk();
    else window.addEventListener('load', scheduleSilk, { once: true });

    return () => {
      window.removeEventListener('load', scheduleSilk);
      if (idleHandle !== undefined) window.cancelIdleCallback?.(idleHandle);
      window.clearTimeout(loadTimer);
      window.clearTimeout(fallbackTimer);
    };
  }, []);

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

  const resetBill = () => {
    if (billImageUrl) URL.revokeObjectURL(billImageUrl);
    setBillImageUrl('');
    setBillItems([]);
    setEditingBillIndex(null);
    setRawOcrText('');
    setOcrStatus('idle');
    setOcrProgress(0);
  };

  const openPanel = async () => {
    await loadAppStyles();
    setHistoryView(null);
    setSelectedHistory(null);
    setActiveHistoryId(null);

    if (!hasActiveDraft) {
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
    }

    setIsCreating(true);
  };

  const openHistory = async () => {
    await loadAppStyles();
    setIsCreating(false);
    setSelectedHistory(null);
    setHistoryView('list');
    setHistoryLoading(true);
    try {
      setHistoryRecords(await readHistoryRecords());
    } catch (historyError) {
      console.error('Could not read local history:', historyError);
      setHistoryRecords([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const closeHistory = () => {
    setHistoryView(null);
    setSelectedHistory(null);
  };

  const clearHistory = async () => {
    if (historyRecords.length === 0) return;
    if (!window.confirm('Clear all history stored on this device?')) return;

    setHistoryLoading(true);
    try {
      await clearHistoryRecords();
      setHistoryRecords([]);
      setSelectedHistory(null);
      setHistoryView('list');
    } catch (historyError) {
      console.error('Could not clear local history:', historyError);
      window.alert('Could not clear history. Please try again.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const closePanel = () => {
    if (!isSaving && ocrStatus !== 'scanning') setIsCreating(false);
  };

  const finishOperation = () => {
    setIsCreating(false);
    setHasActiveDraft(false);
  };

  const addFriend = (event) => {
    event.preventDefault();
    const name = friendName.trim();

    if (!name) return;
    if (friends.length >= 100) {
      setError('You can add up to 100 friends.');
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
        setError('No food rows were detected. Add them manually or try a clearer photo.');
      }
    } catch (scanError) {
      setOcrStatus('idle');
      const message = scanError instanceof Error ? scanError.message : String(scanError || 'Unknown scanning error');
      setError(`Could not scan this photo: ${message}`);
    } finally {
      window.clearInterval(progressTimer);
    }
  };

  const chooseBill = (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    scanBill(file);
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
      setError('Add at least one food item before splitting.');
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
        body: JSON.stringify({ eventName, friends, billItems, allocations, settlements: calculatedSettlements, rawOcrText }),
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
        total,
        createdAt: now,
        updatedAt: now,
      };

      try {
        await saveHistoryRecord(historyRecord);
        setActiveHistoryId(historyId);
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
      setError('Choose at least one person for this food.');
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
      setIsCreating(false);
    } else if (step === 'bill') {
      if (billImageUrl || ocrStatus === 'review' || billItems.length > 0) {
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

      // Wait for the web font before measuring. Safari otherwise occasionally
      // measures with its fallback font and draws with the loaded font.
      if (document.fonts?.ready) await document.fonts.ready;

      const width = 1080;
      const measuringCanvas = document.createElement('canvas');
      const measuringContext = measuringCanvas.getContext('2d');
      measuringContext.font = '600 27px "Noto Sans Thai", sans-serif';

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
      const height = Math.max(1200, 550 + foodSectionHeight + settlementSectionHeight);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');

      const fillRoundedRect = (x, y, rectWidth, rectHeight, radius, fillStyle) => {
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
      };

      // Avoid canvas textAlign="right": WebKit can position Thai/currency text
      // incorrectly in exported canvases. Measuring the X coordinate is stable
      // on iPhone, iPad, Android, and desktop browsers.
      const fillTextFromRight = (text, right, y, minLeft = 0) => {
        context.textAlign = 'left';
        const textWidth = context.measureText(text).width;
        context.fillText(text, Math.max(minLeft, right - textWidth), y);
      };

      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#18122B');
      gradient.addColorStop(0.55, '#393053');
      gradient.addColorStop(1, '#18122B');
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      const glow = context.createRadialGradient(900, 20, 0, 900, 20, 650);
      glow.addColorStop(0, 'rgba(99, 89, 133, 0.34)');
      glow.addColorStop(1, 'rgba(99, 89, 133, 0)');
      context.fillStyle = glow;
      context.fillRect(0, 0, width, 700);

      context.fillStyle = '#635985';
      context.font = '800 34px "Noto Sans Thai", sans-serif';
      context.fillText('หารกัน', 72, 82);
      context.fillStyle = '#ffffff';
      context.font = '800 64px "Noto Sans Thai", sans-serif';
      context.fillText(summaryEventName, 72, 162, 936);

      fillRoundedRect(72, 202, 936, 102, 25, 'rgba(99, 89, 133, 0.42)');
      context.fillStyle = 'rgba(255, 255, 255, 0.72)';
      context.font = '700 25px "Noto Sans Thai", sans-serif';
      context.fillText('ยอดรวมทั้งหมด', 104, 242);
      context.fillStyle = '#ffffff';
      context.font = '800 44px "Noto Sans Thai", sans-serif';
      fillTextFromRight(`฿${summaryTotal.toFixed(2)}`, 974, 270, 480);

      context.fillStyle = 'rgba(255, 255, 255, 0.72)';
      context.font = '800 25px "Noto Sans Thai", sans-serif';
      context.fillText(`รายการอาหาร · ${summaryBillItems.length} รายการ`, 74, 358);

      let currentY = 388;
      foodLayouts.forEach(({ item, payerLines, height: rowHeight }, index) => {
        fillRoundedRect(64, currentY, 952, rowHeight, 24, index % 2 === 0 ? '#393053' : '#443C68');

        fillRoundedRect(88, currentY + 24, 48, 48, 15, '#635985');
        context.fillStyle = '#ffffff';
        context.font = '800 24px "Noto Sans Thai", sans-serif';
        const numberText = String(index + 1);
        context.fillText(numberText, 112 - context.measureText(numberText).width / 2, currentY + 57);

        context.fillStyle = '#ffffff';
        context.font = '700 31px "Noto Sans Thai", sans-serif';
        context.fillText(`${item.name} ×${item.quantity}`, 158, currentY + 50, 560);
        context.fillStyle = '#ffffff';
        context.font = '800 32px "Noto Sans Thai", sans-serif';
        fillTextFromRight(`฿${Number(item.amount).toFixed(2)}`, 978, currentY + 51, 755);

        context.fillStyle = 'rgba(255, 255, 255, 0.7)';
        context.font = '600 26px "Noto Sans Thai", sans-serif';
        payerLines.forEach((line, lineIndex) => {
          context.fillText(line, 158, currentY + 88 + lineIndex * 34, 800);
        });
        currentY += rowHeight + 14;
      });

      currentY += 42;
      context.fillStyle = 'rgba(255, 255, 255, 0.72)';
      context.font = '800 25px "Noto Sans Thai", sans-serif';
      context.fillText(`ยอดที่ต้องจ่าย · ${summarySettlements.length} คน`, 74, currentY);
      currentY += 28;

      summarySettlements.forEach((settlement, index) => {
        const y = currentY + index * 94;
        fillRoundedRect(64, y, 952, 80, 22, index % 2 === 0 ? '#393053' : '#443C68');
        context.fillStyle = '#ffffff';
        context.font = '700 32px "Noto Sans Thai", sans-serif';
        context.fillText(settlement.name, 100, y + 52, 610);
        context.fillStyle = '#ffffff';
        context.font = '800 34px "Noto Sans Thai", sans-serif';
        fillTextFromRight(`฿${Number(settlement.amount).toFixed(2)}`, 978, y + 53, 750);
      });

      context.fillStyle = 'rgba(255, 255, 255, 0.56)';
      context.font = '700 23px "Noto Sans Thai", sans-serif';
      context.fillText('HARN KUN · แบ่งง่าย จ่ายชัด', 72, height - 64);

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

  return (
    <ClickSpark as="main" className="app">
      <div className="silk-background" aria-hidden="true">
        {silkReady && (
          <Suspense fallback={null}>
            <Silk color="#443C68" />
          </Suspense>
        )}
      </div>

      <section className="hero" aria-label="Harn Kun home">
        <span className="eyebrow">WELCOME TO</span>
        <HeroTitle text="Harn Kun" />
        <p>Make every bill effortless.</p>
        <SpecularButton
          className="hero-start-button"
          aria-label={hasActiveDraft ? 'Resume splitting the current bill' : 'Start splitting a bill'}
          aria-expanded={isCreating}
          onClick={openPanel}
        >
          {hasActiveDraft ? 'Resume splitting' : 'Start splitting'} <span aria-hidden="true">→</span>
        </SpecularButton>
      </section>

      <StaggeredMenu
        canClearHistory={historyRecords.length > 0 && !historyLoading}
        onClearHistory={clearHistory}
        onOpen={openHistory}
        onClose={closeHistory}
      >
        {historyView && (
          <div className="staggered-history-content">
            <div className="panel-heading history-panel-heading">
              <div>
                <div className="panel-meta"><span>ON THIS DEVICE</span></div>
                <h2>{historyView === 'detail' ? selectedHistory?.eventName : 'History'}</h2>
              </div>
            </div>

            {historyView === 'list' && (
              <div className="history-list">
                {historyLoading && <p className="history-message">Loading history…</p>}
                {!historyLoading && historyRecords.length === 0 && (
                  <BitsSurface className="history-empty">
                    <strong>No history yet</strong>
                    <p>Your completed bill splits will appear here automatically.</p>
                  </BitsSurface>
                )}
                {!historyLoading && historyRecords.map((record) => (
                  <BitsButton
                    type="button"
                    className="history-card"
                    key={record.id}
                    onClick={() => {
                      setSelectedHistory(record);
                      setHistoryView('detail');
                    }}
                  >
                    <span className="history-card-date">{new Date(record.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    <strong>{record.eventName}</strong>
                    <small>{record.friends.length} friends · {record.billItems.length} foods</small>
                    <b>฿{Number(record.total).toFixed(2)}</b>
                    <i aria-hidden="true">›</i>
                  </BitsButton>
                ))}
              </div>
            )}

            {historyView === 'detail' && selectedHistory && (
              <div className="history-detail">
                <BitsButton
                  type="button"
                  className="history-back-button"
                  aria-label="Back to all history"
                  onClick={() => setHistoryView('list')}
                >
                  ←
                </BitsButton>

                <BitsSurface className="history-detail-summary">
                  <div><span>TOTAL</span><strong>฿{Number(selectedHistory.total).toFixed(2)}</strong></div>
                  <small>{new Date(selectedHistory.updatedAt).toLocaleString()}</small>
                </BitsSurface>

                <h3>Food and sharing</h3>
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
              </div>
            )}
          </div>
        )}
      </StaggeredMenu>

      {isCreating && (
        <div className="overlay" role="presentation" onMouseDown={closePanel}>
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
                    {step === 'split' ? `FOOD ${splitIndex + 1} OF ${billItems.length}` : step === 'result' ? 'ALL DONE' : `STEP ${stepNumber} OF 2`}
                  </span>
                </div>
                {step === 'friends' && (
                  <div className="friends-title">
                    <h2>Add your friends to <strong>{eventName}</strong></h2>
                  </div>
                )}
                {step === 'bill' && <h2>Scan your bill</h2>}
                {step === 'split' && <h2>Who shared this?</h2>}
                {step === 'result' && <h2>Payment summary</h2>}
              </div>
              <BitsButton type="button" className="close-button" onClick={closePanel} aria-label="Close">×</BitsButton>
            </div>

            {step === 'friends' && (
              <div className="friends-step">
                <form className="friend-form" autoComplete="off" data-form-type="other" onSubmit={addFriend}>
                  <label htmlFor="friend-name">Friend's name</label>
                  <div className="friend-input-row">
                    <input ref={inputRef} id="friend-name" name="friend-name-entry" value={friendName} onChange={(event) => setFriendName(event.target.value)} type="text" placeholder="Type a name" autoComplete="off" data-form-type="other" data-lpignore="true" enterKeyHint="done" maxLength="60" disabled={friends.length >= 100} />
                    <BitsButton type="submit" className="add-button" disabled={!friendName.trim() || friends.length >= 100}>Add</BitsButton>
                  </div>
                </form>

                <div className="friends-heading"><span>Friends</span><strong>{friends.length} / 100</strong></div>
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
                <input ref={cameraInputRef} className="hidden-file-input" type="file" accept="image/*" capture="environment" onChange={chooseBill} />
                <input ref={uploadInputRef} className="hidden-file-input" type="file" accept="image/*" onChange={chooseBill} />

                {billImageUrl && (
                  <BitsSurface className="bill-preview">
                    <img src={billImageUrl} alt="Selected bill" />
                    <div><strong>{ocrStatus === 'scanning' ? 'Reading your bill…' : 'Bill photo'}</strong><span></span></div>
                    {ocrStatus !== 'scanning' && (
                      <BitsButton type="button" disabled={cooldownRemaining > 0} onClick={() => uploadInputRef.current?.click()}>
                        {cooldownRemaining > 0 ? `Wait ${cooldownRemaining}s` : 'Change'}
                      </BitsButton>
                    )}
                  </BitsSurface>
                )}

                {ocrStatus === 'scanning' ? (
                  <BitsSurface className="scan-progress" aria-live="polite">
                    <div><span style={{ width: `${Math.round(ocrProgress * 100)}%` }} /></div>
                    <p>กำลังอ่านใบเสร็จ… {Math.round(ocrProgress * 100)}%</p>
                  </BitsSurface>
                ) : (
                  <>
                    {!billImageUrl && ocrStatus === 'idle' && (
                      <div className="scan-start-options">
                        <BitsButton type="button" disabled={cooldownRemaining > 0} onClick={() => cameraInputRef.current?.click()}>
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
                          <span><strong>Manual add</strong><small>Enter food and prices yourself</small></span>
                          <b aria-hidden="true">›</b>
                        </BitsButton>
                      </div>
                    )}

                    {(ocrStatus === 'review' || billItems.length > 0) && (
                      <>
                        <div className={`bill-list-heading${editingBillIndex !== null ? ' is-editing' : ''}`}>
                          <span>Food detected</span>
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
                                      <input autoFocus aria-label={`Food ${index + 1}`} name={`food-name-${index}`} value={item.name} onChange={(event) => updateBillItem(index, 'name', event.target.value)} placeholder="Food name" autoComplete="off" data-form-type="other" data-lpignore="true" />
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
                                    <strong className="bill-item-name">{item.name || 'Unnamed food'}</strong>
                                    <span className="bill-item-quantity">{Number(item.quantity) || 1}</span>
                                    <strong className="bill-item-price">฿{(Number(item.amount) || 0).toFixed(2)}</strong>
                                    <BitsButton className="bill-edit-button" type="button" onClick={() => setEditingBillIndex(index)} aria-label={`Edit ${item.name || 'item'}`}>Edit</BitsButton>
                                  </BitsSurface>
                                )}
                              </div>
                            );
                          })}
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
                )}

                {error && <p className="form-error" role="alert">{error}</p>}
                {ocrStatus !== 'scanning' && (
                  <div className="bill-footer-actions">
                    {(ocrStatus === 'review' || billItems.length > 0) && (
                      <>
                        <BitsButton type="button" className="manual-item-button" onClick={addManualItem}>+ Add food manually</BitsButton>
                        <BitsSurface className="bill-total"><span>SUM</span><strong>฿{total.toFixed(2)}</strong></BitsSurface>
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
                  <span>FOOD</span>
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
                    {isSaving ? 'Calculating…' : splitIndex === billItems.length - 1 ? 'Calculate' : 'Next food'}
                  </BitsButton>
                </div>
              </div>
            )}

            {step === 'result' && (
              <div className="result-step">
                <BitsSurface className="result-event">
                  <span>EVENT</span>
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
    </ClickSpark>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
