// All new bill amounts use integer satang; ties round up. Quantity is informational.
export const MAX_BAHT = 1_000_000_000;
export function isValidMoney(value) {
  return value !== '' && value !== null && Number.isFinite(Number(value))
    && Number(value) >= 0 && Number(value) <= MAX_BAHT;
}
export function toSatang(value) {
  return Math.round((Number(value) + Number.EPSILON * Math.max(1, Number(value))) * 100);
}
export function getBillTotals(items, vatEnabled, vatRate, discountEnabled, discountAmount) {
  const subtotalCents = items.reduce((sum, item) => sum + toSatang(item.amount), 0);
  const vatCents = vatEnabled ? Number((BigInt(subtotalCents) * BigInt(toSatang(vatRate)) + 5000n) / 10000n) : 0;
  const discountCents = discountEnabled ? toSatang(discountAmount) : 0;
  return { subtotal: subtotalCents / 100, vatAmount: vatCents / 100, appliedDiscount: discountCents / 100, total: Math.max(0, subtotalCents + vatCents - discountCents) / 100 };
}
export function itemShare(amount, count, index) {
  if (!count) return 0;
  const cents = toSatang(amount);
  return (Math.floor(cents / count) + (index < cents % count ? 1 : 0)) / 100;
}
