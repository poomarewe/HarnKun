import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

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

function App() {
  const [isCreating, setIsCreating] = useState(false);
  const [historyView, setHistoryView] = useState(null);
  const [historyRecords, setHistoryRecords] = useState([]);
  const [selectedHistory, setSelectedHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [step, setStep] = useState('event');
  const [eventName, setEventName] = useState('');
  const [friendName, setFriendName] = useState('');
  const [friends, setFriends] = useState([]);
  const [billImageUrl, setBillImageUrl] = useState('');
  const [billItems, setBillItems] = useState([]);
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

  const total = useMemo(
    () => billItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    [billItems],
  );

  useEffect(() => {
    const viewport = window.visualViewport;
    let largestHeight = viewport?.height ?? window.innerHeight;

    const syncViewport = () => {
      const visibleHeight = viewport?.height ?? window.innerHeight;
      largestHeight = Math.max(largestHeight, visibleHeight);
      const inputIsFocused = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
      const keyboardIsOpen = inputIsFocused && visibleHeight < largestHeight - 120;

      document.documentElement.style.setProperty('--visible-height', `${Math.round(visibleHeight)}px`);
      document.body.classList.toggle('keyboard-open', keyboardIsOpen);
    };

    syncViewport();
    viewport?.addEventListener('resize', syncViewport);
    viewport?.addEventListener('scroll', syncViewport);
    window.addEventListener('resize', syncViewport);
    document.addEventListener('focusin', syncViewport);
    document.addEventListener('focusout', syncViewport);

    return () => {
      viewport?.removeEventListener('resize', syncViewport);
      viewport?.removeEventListener('scroll', syncViewport);
      window.removeEventListener('resize', syncViewport);
      document.removeEventListener('focusin', syncViewport);
      document.removeEventListener('focusout', syncViewport);
      document.body.classList.remove('keyboard-open');
    };
  }, []);

  useEffect(() => {
    if (isCreating && (step === 'event' || step === 'friends')) inputRef.current?.focus();
  }, [isCreating, step]);

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
    setRawOcrText('');
    setOcrStatus('idle');
    setOcrProgress(0);
  };

  const openPanel = () => {
    setHistoryView(null);
    setSelectedHistory(null);
    setActiveHistoryId(null);
    setStep('event');
    setEventName('');
    setFriendName('');
    setFriends([]);
    setAllocations([]);
    setSplitIndex(0);
    setSettlements([]);
    resetBill();
    setError('');
    setIsCreating(true);
  };

  const openHistory = async () => {
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

  const closePanel = () => {
    if (!isSaving && ocrStatus !== 'scanning') setIsCreating(false);
  };

  const continueToFriends = (event) => {
    event.preventDefault();
    if (!eventName.trim()) return;
    setEventName(eventName.trim());
    setStep('friends');
    setError('');
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
  };

  const addManualItem = () => {
    setBillItems((currentItems) => [...currentItems, { name: '', quantity: 1, amount: 0 }]);
    setOcrStatus('review');
    setError('');
  };

  const startSplitting = () => {
    const cleanItems = billItems.filter((item) => item.name.trim());
    if (cleanItems.length === 0) {
      setError('Add at least one food item before splitting.');
      return;
    }

    setBillItems(cleanItems);
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
      setStep('event');
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

  const downloadSummary = async () => {
    await document.fonts?.ready;
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
        if (measuringContext.measureText(candidate).width > 850 && currentLine !== prefix) {
          lines.push(currentLine);
          currentLine = friend;
        } else {
          currentLine = candidate;
        }
      });
      lines.push(currentLine);
      return lines;
    };

    const foodLayouts = billItems.map((item, index) => {
      const payerLines = makePayerLines(allocations[index] || []);
      return { item, payerLines, height: 102 + payerLines.length * 34 };
    });
    const foodSectionHeight = foodLayouts.reduce((sum, layout) => sum + layout.height + 14, 0);
    const height = Math.max(1200, 470 + foodSectionHeight + settlements.length * 92 + 230);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#fbf9ff');
    gradient.addColorStop(1, '#eee7f8');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.fillStyle = '#6b35aa';
    context.font = '800 42px "Noto Sans Thai", sans-serif';
    context.fillText('หารกัน', 90, 100);
    context.fillStyle = '#241832';
    context.font = '800 68px "Noto Sans Thai", sans-serif';
    context.fillText(eventName, 90, 190, 900);
    context.fillStyle = '#8b7d96';
    context.font = '800 27px "Noto Sans Thai", sans-serif';
    context.fillText('รายการอาหาร', 90, 275);

    let currentY = 310;
    foodLayouts.forEach(({ item, payerLines, height: rowHeight }, index) => {
      context.fillStyle = index % 2 === 0 ? '#ffffff' : '#f7f2fb';
      context.beginPath();
      context.roundRect(70, currentY, 940, rowHeight, 22);
      context.fill();

      context.fillStyle = '#30223d';
      context.font = '700 32px "Noto Sans Thai", sans-serif';
      context.fillText(`${index + 1}. ${item.name} ×${item.quantity}`, 105, currentY + 48, 680);
      context.fillStyle = '#6c35a7';
      context.font = '800 33px "Noto Sans Thai", sans-serif';
      context.textAlign = 'right';
      context.fillText(`฿${Number(item.amount).toFixed(2)}`, 965, currentY + 48);
      context.textAlign = 'left';

      context.fillStyle = '#806f8d';
      context.font = '600 27px "Noto Sans Thai", sans-serif';
      payerLines.forEach((line, lineIndex) => {
        context.fillText(line, 105, currentY + 88 + lineIndex * 34, 850);
      });
      currentY += rowHeight + 14;
    });

    currentY += 46;
    context.fillStyle = '#8b7d96';
    context.font = '800 27px "Noto Sans Thai", sans-serif';
    context.fillText('ยอดที่ต้องจ่าย', 90, currentY);
    currentY += 38;

    settlements.forEach((settlement, index) => {
      const y = currentY + index * 92;
      context.fillStyle = index % 2 === 0 ? '#ffffff' : '#f7f2fb';
      context.beginPath();
      context.roundRect(70, y, 940, 78, 22);
      context.fill();
      context.fillStyle = '#30223d';
      context.font = '700 34px "Noto Sans Thai", sans-serif';
      context.fillText(settlement.name, 105, y + 52, 600);
      context.fillStyle = '#6c35a7';
      context.font = '800 36px "Noto Sans Thai", sans-serif';
      context.textAlign = 'right';
      context.fillText(`฿${settlement.amount.toFixed(2)}`, 965, y + 52);
      context.textAlign = 'left';
    });

    context.fillStyle = '#897a94';
    context.font = '600 26px "Noto Sans Thai", sans-serif';
    context.fillText(`รวมทั้งสิ้น ฿${total.toFixed(2)}`, 90, height - 80);

    const link = document.createElement('a');
    link.download = `${eventName.replace(/[^A-Za-z0-9\u0E00-\u0E7F]+/g, '-') || 'harn-kun'}-summary.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const stepNumber = step === 'event' ? 1 : step === 'friends' ? 2 : 3;

  return (
    <main className="app">
      <div className="glow glow-one" />
      <div className="glow glow-two" />

      <section className="hero" aria-label="Harn Kun home">
        <span className="eyebrow">WELCOME TO</span>
        <h1 className="animated-title" aria-label="หาร กัน">
          <span className="title-face" aria-hidden="true">หาร กัน</span>
        </h1>
        <p>Make every bill effortless.</p>
      </section>

      <button className="create-button" type="button" aria-label="Create a new operation" aria-expanded={isCreating} onClick={openPanel}>
        <span aria-hidden="true">+</span>
      </button>

      <button className="history-button" type="button" aria-label="View operation history" aria-expanded={Boolean(historyView)} onClick={openHistory}>
        History
      </button>

      {historyView && (
        <div className="overlay history-overlay" role="presentation" onMouseDown={closeHistory}>
          <section className="history-panel" aria-label="Operation history" onMouseDown={(event) => event.stopPropagation()}>
            <div className="panel-handle" />
            <div className="panel-heading history-panel-heading">
              <div>
                <div className="panel-meta"><span>ON THIS DEVICE</span></div>
                <h2>{historyView === 'detail' ? selectedHistory?.eventName : 'History'}</h2>
              </div>
              <button type="button" className="close-button" onClick={closeHistory} aria-label="Close history">×</button>
            </div>

            {historyView === 'list' && (
              <div className="history-list">
                {historyLoading && <p className="history-message">Loading history…</p>}
                {!historyLoading && historyRecords.length === 0 && (
                  <div className="history-empty">
                    <strong>No history yet</strong>
                    <p>Your completed bill splits will appear here automatically.</p>
                  </div>
                )}
                {!historyLoading && historyRecords.map((record) => (
                  <button
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
                  </button>
                ))}
              </div>
            )}

            {historyView === 'detail' && selectedHistory && (
              <div className="history-detail">
                <button type="button" className="history-back-button" onClick={() => setHistoryView('list')}>← All history</button>

                <div className="history-detail-summary">
                  <div><span>TOTAL</span><strong>฿{Number(selectedHistory.total).toFixed(2)}</strong></div>
                  <small>{new Date(selectedHistory.updatedAt).toLocaleString()}</small>
                </div>

                <h3>Food and sharing</h3>
                <div className="history-food-list">
                  {selectedHistory.billItems.map((item, index) => (
                    <article className="history-food-row" key={`${item.name}-${index}`}>
                      <div><strong>{item.name}</strong><span>×{item.quantity} · split between {(selectedHistory.allocations[index] || []).length}</span></div>
                      <b>฿{Number(item.amount).toFixed(2)}</b>
                      <p>{(selectedHistory.allocations[index] || []).join(', ') || 'No one selected'}</p>
                    </article>
                  ))}
                </div>

                <h3>Who pays</h3>
                <div className="history-payment-list">
                  {selectedHistory.settlements.map((settlement) => (
                    <div className="history-payment-row" key={settlement.name}>
                      <strong>{settlement.name}</strong><b>฿{Number(settlement.amount).toFixed(2)}</b>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {isCreating && (
        <div className="overlay" role="presentation" onMouseDown={closePanel}>
          <section className={`operation-panel step-${step}`} aria-label="New operation" onMouseDown={(event) => event.stopPropagation()}>
            <div className="panel-handle" />
            <div className="panel-heading">
              <div>
                <div className="panel-meta">
                  <span>
                    {step === 'split' ? `FOOD ${splitIndex + 1} OF ${billItems.length}` : step === 'result' ? 'ALL DONE' : `STEP ${stepNumber} OF 3`}
                  </span>
                  {step !== 'event' && <button type="button" className="small-back-button" disabled={isSaving || ocrStatus === 'scanning'} onClick={goBack}>← Back</button>}
                </div>
                {step === 'event' && <h2>Name your event</h2>}
                {step === 'friends' && (
                  <div className="friends-title">
                    <h2>Add your friends to <strong>{eventName}</strong></h2>
                  </div>
                )}
                {step === 'bill' && <h2>Scan your Thai bill</h2>}
                {step === 'split' && <h2>Who shared this?</h2>}
                {step === 'result' && <h2>Payment summary</h2>}
              </div>
              <button type="button" className="close-button" onClick={closePanel} aria-label="Close">×</button>
            </div>

            {step === 'event' && (
              <form onSubmit={continueToFriends}>
                <label htmlFor="event-name">Event name</label>
                <input ref={inputRef} id="event-name" value={eventName} onChange={(event) => setEventName(event.target.value)} type="text" placeholder="e.g. Beach trip" autoComplete="off" enterKeyHint="next" maxLength="80" required />
                <button className="save-button" type="submit">OK, add friends</button>
              </form>
            )}

            {step === 'friends' && (
              <div className="friends-step">
                <form className="friend-form" onSubmit={addFriend}>
                  <label htmlFor="friend-name">Friend's name</label>
                  <div className="friend-input-row">
                    <input ref={inputRef} id="friend-name" value={friendName} onChange={(event) => setFriendName(event.target.value)} type="text" placeholder="Type a name" autoComplete="off" enterKeyHint="done" maxLength="60" disabled={friends.length >= 100} />
                    <button type="submit" className="add-button" disabled={!friendName.trim() || friends.length >= 100}>Add</button>
                  </div>
                </form>

                <div className="friends-heading"><span>Friends</span><strong>{friends.length} / 100</strong></div>
                <div className="friend-list" aria-live="polite">
                  {friends.length === 0 ? <p className="empty-list">Add at least 2 people to continue.</p> : friends.map((friend, index) => (
                    <button key={`${friend}-${index}`} type="button" className="friend-chip" onClick={() => removeFriend(index)}>
                      <span>{friend}</span><b aria-label={`Remove ${friend}`}>×</b>
                    </button>
                  ))}
                </div>

                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="save-button apply-button" type="button" disabled={friends.length < 2} onClick={continueToBill}>
                  {friends.length < 2 ? `Add ${2 - friends.length} more` : 'Continue to bill'}
                </button>
              </div>
            )}

            {step === 'bill' && (
              <div className="bill-step">
                <input ref={cameraInputRef} className="hidden-file-input" type="file" accept="image/*" capture="environment" onChange={chooseBill} />
                <input ref={uploadInputRef} className="hidden-file-input" type="file" accept="image/*" onChange={chooseBill} />

                {billImageUrl && (
                  <div className="bill-preview">
                    <img src={billImageUrl} alt="Selected bill" />
                    <div><strong>{ocrStatus === 'scanning' ? 'Reading your bill…' : 'Bill photo'}</strong><span>Thai + English OCR</span></div>
                    {ocrStatus !== 'scanning' && (
                      <button type="button" disabled={cooldownRemaining > 0} onClick={() => uploadInputRef.current?.click()}>
                        {cooldownRemaining > 0 ? `Wait ${cooldownRemaining}s` : 'Change'}
                      </button>
                    )}
                  </div>
                )}

                {ocrStatus === 'scanning' ? (
                  <div className="scan-progress" aria-live="polite">
                    <div><span style={{ width: `${Math.round(ocrProgress * 100)}%` }} /></div>
                    <p>กำลังอ่านใบเสร็จ… {Math.round(ocrProgress * 100)}%</p>
                  </div>
                ) : (
                  <>
                    {!billImageUrl && ocrStatus === 'idle' && (
                      <div className="scan-start-options">
                        <button type="button" disabled={cooldownRemaining > 0} onClick={() => cameraInputRef.current?.click()}>
                          <span className="scan-option-icon" aria-hidden="true">●</span>
                          <span><strong>{cooldownRemaining > 0 ? `Wait ${cooldownRemaining}s` : 'Take picture'}</strong><small>Open your phone camera</small></span>
                          <b aria-hidden="true">›</b>
                        </button>
                        <button type="button" disabled={cooldownRemaining > 0} onClick={() => uploadInputRef.current?.click()}>
                          <span className="scan-option-icon upload-icon" aria-hidden="true">↑</span>
                          <span><strong>Upload photo</strong><small>Choose a bill from your device</small></span>
                          <b aria-hidden="true">›</b>
                        </button>
                        <button type="button" onClick={addManualItem}>
                          <span className="scan-option-icon manual-icon" aria-hidden="true">+</span>
                          <span><strong>Manual add</strong><small>Enter food and prices yourself</small></span>
                          <b aria-hidden="true">›</b>
                        </button>
                      </div>
                    )}

                    {(ocrStatus === 'review' || billItems.length > 0) && (
                      <>
                        <div className="bill-list-heading"><span>Food detected</span><strong>{billItems.length} items</strong></div>
                        <div className="bill-list">
                          {billItems.map((item, index) => (
                            <div className="bill-item" key={`bill-item-${index}`}>
                              <input aria-label={`Food ${index + 1}`} value={item.name} onChange={(event) => updateBillItem(index, 'name', event.target.value)} placeholder="ชื่ออาหาร" />
                              <input aria-label={`Quantity ${index + 1}`} type="number" min="1" inputMode="numeric" value={item.quantity} onFocus={selectWholeValue} onClick={selectWholeValue} onChange={(event) => updateBillItem(index, 'quantity', event.target.value)} />
                              <input aria-label={`Amount ${index + 1}`} type="number" min="0" step="0.01" inputMode="decimal" value={item.amount} onFocus={selectWholeValue} onClick={selectWholeValue} onChange={(event) => updateBillItem(index, 'amount', event.target.value)} />
                              <button type="button" onClick={() => removeBillItem(index)} aria-label={`Remove ${item.name || 'item'}`}>×</button>
                            </div>
                          ))}
                        </div>
                        <button type="button" className="manual-item-button" onClick={addManualItem}>+ Add food manually</button>
                        <div className="bill-total"><span>SUM</span><strong>฿{total.toFixed(2)}</strong></div>
                      </>
                    )}

                    {billImageUrl && ocrStatus === 'idle' && (
                      <div className="scan-actions">
                        <button type="button" className="upload-button" disabled={cooldownRemaining > 0} onClick={() => uploadInputRef.current?.click()}>
                          {cooldownRemaining > 0 ? `Try again in ${cooldownRemaining}s` : 'Try another photo'}
                        </button>
                      </div>
                    )}
                  </>
                )}

                {error && <p className="form-error" role="alert">{error}</p>}
                {ocrStatus !== 'scanning' && (
                  <div className="bill-footer-actions">
                    {(ocrStatus === 'review' || billItems.length > 0) && <button className="save-button" type="button" disabled={!billItems.some((item) => item.name.trim())} onClick={startSplitting}>Confirm & split</button>}
                  </div>
                )}
              </div>
            )}

            {step === 'split' && billItems[splitIndex] && (
              <div className="split-step">
                <div className="split-food-card">
                  <span>FOOD</span>
                  <h3>{billItems[splitIndex].name}</h3>
                  <div>
                    <small>Quantity {billItems[splitIndex].quantity}</small>
                    <strong>฿{Number(billItems[splitIndex].amount).toFixed(2)}</strong>
                  </div>
                </div>

                <div className="payer-heading">
                  <span>Who needs to pay?</span>
                  <div>
                    <strong>{(allocations[splitIndex] || []).length} selected</strong>
                    <button type="button" className="select-all-button" onClick={toggleAllFriendsForItem}>
                      {(allocations[splitIndex] || []).length === friends.length ? 'Clear all' : 'Select all'}
                    </button>
                  </div>
                </div>

                <div className="payer-list">
                  {friends.map((friend) => {
                    const isSelected = (allocations[splitIndex] || []).includes(friend);
                    return (
                      <button key={friend} type="button" className={`payer-option${isSelected ? ' selected' : ''}`} aria-pressed={isSelected} onClick={() => toggleFriendForItem(friend)}>
                        <span className="payer-check" aria-hidden="true">{isSelected ? '✓' : ''}</span>
                        <strong>{friend}</strong>
                        {isSelected && <small>฿{(Number(billItems[splitIndex].amount) / (allocations[splitIndex] || []).length).toFixed(2)}</small>}
                      </button>
                    );
                  })}
                </div>

                {error && <p className="form-error" role="alert">{error}</p>}
                <div className="split-navigation">
                  <button type="button" className="previous-button" disabled={splitIndex === 0 || isSaving} onClick={goToPreviousFood}>Previous</button>
                  <button type="button" className="next-button" disabled={(allocations[splitIndex] || []).length === 0 || isSaving} onClick={goToNextFood}>
                    {isSaving ? 'Calculating…' : splitIndex === billItems.length - 1 ? 'Calculate' : 'Next food'}
                  </button>
                </div>
              </div>
            )}

            {step === 'result' && (
              <div className="result-step">
                <div className="result-event">
                  <span>EVENT</span>
                  <strong>{eventName}</strong>
                  <small>Total ฿{total.toFixed(2)}</small>
                </div>

                <div className="settlement-list">
                  {settlements.map((settlement, index) => (
                    <div className="settlement-row" key={settlement.name}>
                      <span>{index + 1}</span>
                      <strong>{settlement.name}</strong>
                      <b>฿{settlement.amount.toFixed(2)}</b>
                    </div>
                  ))}
                </div>

                <button type="button" className="download-button" onClick={downloadSummary}>Download as picture</button>
                <button type="button" className="done-button" onClick={() => setIsCreating(false)}>Done</button>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
