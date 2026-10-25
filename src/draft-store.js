import { isValidMoney } from './money.js';

export const BILL_DRAFT_STORAGE_KEY = 'harn-kun-active-draft-v1';

const DRAFT_STEPS = new Set(['friends', 'bill', 'split', 'result']);

function getBrowserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function sanitizeBillDraft(value) {
  if (!value || typeof value !== 'object' || value.version !== 1
    || !Array.isArray(value.friends) || value.friends.length > 100
    || !Array.isArray(value.billItems) || value.billItems.length > 1000
    || !Array.isArray(value.allocations)) return null;

  const friends = value.friends.filter((name) => typeof name === 'string' && name.trim() && name.length <= 60);
  const billItems = value.billItems.filter((item) => item && typeof item === 'object'
    && typeof item.name === 'string' && item.name.trim() && item.name.length <= 200
    && Number.isSafeInteger(Number(item.quantity)) && Number(item.quantity) >= 1
    && isValidMoney(item.amount))
    .map((item) => ({ name: item.name, quantity: Number(item.quantity), amount: Number(item.amount) }));
  const allocations = billItems.map((_, index) => (
    Array.isArray(value.allocations[index])
      ? [...new Set(value.allocations[index].filter((name) => friends.includes(name))) ]
      : []
  ));
  const step = DRAFT_STEPS.has(value.step) ? value.step : 'friends';
  const splitIndex = Number.isInteger(value.splitIndex) ? value.splitIndex : 0;
  const settlements = Array.isArray(value.settlements)
    ? value.settlements.filter((settlement) => settlement && typeof settlement.name === 'string'
      && friends.includes(settlement.name) && isValidMoney(settlement.amount))
      .map((settlement) => ({ name: settlement.name, amount: Number(settlement.amount) }))
    : [];

  return {
    version: 1,
    eventName: typeof value.eventName === 'string' ? value.eventName.slice(0, 80) : '',
    friendName: typeof value.friendName === 'string' ? value.friendName.slice(0, 60) : '',
    friends,
    billItems,
    allocations,
    vatEnabled: Boolean(value.vatEnabled),
    vatRate: isValidMoney(value.vatRate) && Number(value.vatRate) <= 100 ? Number(value.vatRate) : 7,
    discountEnabled: Boolean(value.discountEnabled),
    discountAmount: isValidMoney(value.discountAmount) ? Number(value.discountAmount) : 0,
    step,
    splitIndex: Math.min(Math.max(0, splitIndex), Math.max(0, billItems.length - 1)),
    settlements,
    peopleNameConfirmed: Boolean(value.peopleNameConfirmed),
    manualComposerOpen: Boolean(value.manualComposerOpen),
    manualItemName: typeof value.manualItemName === 'string' ? value.manualItemName.slice(0, 200) : '',
    manualItemPrice: typeof value.manualItemPrice === 'string' ? value.manualItemPrice.slice(0, 32) : '',
    manualQuantity: typeof value.manualQuantity === 'string' ? value.manualQuantity.slice(0, 32) : '1',
    showManualQuantity: Boolean(value.showManualQuantity),
    showBillExtras: Boolean(value.showBillExtras),
    activeHistoryId: typeof value.activeHistoryId === 'string' ? value.activeHistoryId.slice(0, 128) : null,
    activeHistoryUpdatedAt: Number.isFinite(value.activeHistoryUpdatedAt) ? value.activeHistoryUpdatedAt : null,
  };
}

export function readBillDraft(storage = getBrowserStorage()) {
  if (!storage) return null;
  try {
    const serialized = storage.getItem(BILL_DRAFT_STORAGE_KEY);
    return serialized ? sanitizeBillDraft(JSON.parse(serialized)) : null;
  } catch {
    return null;
  }
}

export function saveBillDraft(value, storage = getBrowserStorage()) {
  if (!storage) return false;
  const draft = sanitizeBillDraft({ ...value, version: 1 });
  if (!draft) return false;
  try {
    storage.setItem(BILL_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearBillDraft(storage = getBrowserStorage()) {
  if (!storage) return false;
  try {
    storage.removeItem(BILL_DRAFT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
