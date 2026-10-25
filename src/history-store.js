const DATABASE = 'harn-kun-history';
const STORE = 'operations';

// Validate before rendering; keep rejected records in IndexedDB for recovery.
export function isHistoryRecord(record) {
  return Boolean(record && typeof record.id === 'string' && typeof record.eventName === 'string'
    && Number.isFinite(record.updatedAt) && Number.isFinite(record.createdAt)
    && Number.isFinite(record.total) && record.total >= 0
    && Array.isArray(record.friends) && record.friends.length >= 2 && record.friends.length <= 100
    && record.friends.every(name => typeof name === 'string' && name.trim())
    && new Set(record.friends.map(name => name.toLocaleLowerCase())).size === record.friends.length
    && Array.isArray(record.billItems) && record.billItems.every(item => item
      && typeof item.name === 'string' && Number.isFinite(Number(item.amount)) && Number(item.amount) >= 0
      && Number.isInteger(Number(item.quantity)) && Number(item.quantity) >= 1)
    && Array.isArray(record.allocations) && record.allocations.every(names => Array.isArray(names) && names.every(name => record.friends.includes(name)) && new Set(names).size === names.length)
    && Array.isArray(record.settlements) && record.settlements.every(entry => entry
      && typeof entry.name === 'string' && Number.isFinite(Number(entry.amount)) && Number(entry.amount) >= 0));
}
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('History is busy in another tab. Close it and retry.')); };
  });
}
function notify() {
  if (typeof BroadcastChannel === 'undefined') return;
  try { const channel = new BroadcastChannel(DATABASE); channel.postMessage('changed'); channel.close(); } catch { /* Focus refresh is the fallback. */ }
}
async function write(change) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error || new Error('History change was cancelled.'));
      transaction.onerror = () => reject(transaction.error);
      try { change(transaction.objectStore(STORE), reject); }
      catch (error) { transaction.abort(); reject(error); }
    });
  } finally { db.close(); }
  notify();
}
export function saveHistoryRecord(record, expectedUpdatedAt) {
  return write((store, reject) => {
    if (expectedUpdatedAt === undefined) { store.put(record); return; }
    const request = store.get(record.id);
    request.onsuccess = () => {
      if ((request.result?.updatedAt ?? null) !== expectedUpdatedAt) {
        store.transaction.abort();
        reject(new Error('This bill changed in another tab. Reopen the latest bill before saving edits.'));
        return;
      }
      try { store.put(record); } catch (error) { store.transaction.abort(); reject(error); }
    };
  });
}
export async function readHistoryRecords() {
  const db = await openDatabase();
  try {
    const all = await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).getAll();
      let records;
      request.onsuccess = () => { records = request.result; };
      transaction.oncomplete = () => resolve(records);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('History read was cancelled.'));
    });
    const records = all.filter(isHistoryRecord).sort((a, b) => b.updatedAt - a.updatedAt);
    return { records, invalidCount: all.length - records.length };
  } finally { db.close(); }
}
export const clearHistoryRecords = () => write(store => store.clear());
export const deleteHistoryRecord = id => write(store => store.delete(id));
export function subscribeHistoryChanges(callback) {
  let channel;
  try { channel = new BroadcastChannel(DATABASE); channel.onmessage = callback; } catch { /* Focus refresh still works. */ }
  window.addEventListener('focus', callback);
  const onVisible = () => { if (document.visibilityState === 'visible') callback(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => { channel?.close(); window.removeEventListener('focus', callback); document.removeEventListener('visibilitychange', onVisible); };
}
