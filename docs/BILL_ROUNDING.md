# Bill calculation rules

These rules apply to newly calculated or edited bills. Existing saved bills are
not automatically recalculated or rewritten.

1. Currency is Thai baht, with 100 satang per baht. Item prices are **line totals**;
   quantity is descriptive and does not multiply the line total.
2. Each accepted line total is rounded to integer satang, with half a satang rounded
   up. New items and edited totals must be non-negative and no more than
   ฿1,000,000,000 per line. A new calculation supports up to 1,000 items and 2–100 people.
3. Subtotal is the sum of these integer line totals. VAT is calculated on the
   subtotal **before discount**, preserving the existing tax/discount order.
   VAT percentage is represented to two decimal places for calculation; the resulting
   tax is rounded once to satang, half up. Discount is a non-negative baht amount,
   also rounded to satang. Final total cannot be below zero.
4. Each item is divided evenly among its selected people. Divide the integer
   satang total by their count; give any remaining satang to the first selected
   people. Example: ฿100 among A, B, C becomes ฿33.34, ฿33.33, ฿33.33.
5. If VAT/discount changes the total, adjust each person's accumulated item share
   proportionally to the final total. Floor each exact integer ratio, then distribute
   leftover satang by descending fractional remainder. Ties follow the bill's people
   order. The final allocations sum exactly to the final integer-satang total.
6. A zero total allocates zero to everyone. Item assignment still requires at least
   one person. Weighted splits or person-specific discount/tax rules are not supported.

Example: ฿2.50 plus 7% VAT is ฿2.68 (฿0.18 rounded VAT). Summary, new history entries
and final participant allocations use the same ฿2.68 total.

Older history can retain the original application's rounding discrepancy until
someone reviews and resaves that bill. Version-1 shared links store items and
adjustments rather than an explicit total, so opening them reconstructs the total
using these rules. Sharing is a read-only representation, not a payment verification.
