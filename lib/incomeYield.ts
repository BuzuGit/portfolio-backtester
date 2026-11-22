/*
  DIVIDEND YIELD OF EACH PAYMENT — for the Positions tab's Income chart.

  For every dividend of a holding with a price, two yields (in %):

    market yield  = the payment ÷ what those shares were worth at the PREVIOUS month-end
                    (shares x price). The user's own definition: "amount paid by quantity /
                    value of that asset prior month".
    yield on cost = the payment ÷ what those shares cost you (average cost per share at the time
                    x shares), i.e. what your invested money earned.

  A chart bar adds up the yields of the payments inside it, so a quarterly payer's four payments
  make its yearly yield. Nothing is ever annualised (the app's rule: no annualising under a year),
  so a part-year (the year so far, or the year you bought in) shows just what it paid.

  Shares: the dividend row's own quantity when it holds a real share count; otherwise (a row
  whose quantity just repeats the amount, e.g. rent booked as qty = amount at price 1) the shares
  held according to the ledger's purchases and sales up to that day.
  Cost: average cost per share, from purchases (their Amount already includes commission) and
  sales (which take shares out at the average cost, leaving the average unchanged).

  PRICES: the market yield needs the plain price of the time, not a dividend-ADJUSTED one (a
  "TR" column scales history down as dividends are reinvested, so old yields would read high).
  The caller (components/IncomeChart.tsx) passes the sheet's unadjusted column — the same ticker
  without "TR" — whenever it exists. Yield on cost uses only ledger figures.

  Every amount is turned into the asset's own currency first (via the `toAssetCcy` converter),
  so a USD dividend on an SGD-priced holding still compares like with like.
*/
import type { LedgerRow } from './fetchData.ts';

export interface PaymentYield {
  ticker: string;
  date: string;              // YYYY-MM-DD of the payment
  marketPct: number | null;  // null when there is no price before the payment
  onCostPct: number | null;  // null when no cost is known (e.g. shares came in without a purchase)
}

/**
 * @param rows        the ledger rows of the holdings (purchases, sales and dividends; any order)
 * @param priceBefore the asset's price at the last month-end BEFORE the given month, in its own
 *                    currency (null if none)
 * @param toAssetCcy  converts an amount in `ccy` during month `ym` into the asset's own currency
 *                    (null if no rate)
 */
export function paymentYields(
  rows: LedgerRow[],
  priceBefore: (ticker: string, ym: string) => number | null,
  toAssetCcy: (ticker: string, amount: number, ccy: string, ym: string) => number | null,
): PaymentYield[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const held: Record<string, { shares: number; cost: number }> = {};
  const out: PaymentYield[] = [];
  for (const r of sorted) {
    const t = r.ticker;
    if (!t || t === '-') continue;
    const ym = r.date.slice(0, 7);
    const pos = (held[t] ??= { shares: 0, cost: 0 });
    const amount = toAssetCcy(t, r.amount, r.currency, ym);
    if (r.flow === 'Purchase of Asset') {
      if (amount === null || !(r.qty > 0)) continue;
      pos.shares += r.qty;
      pos.cost += amount;
    } else if (r.flow === 'Proceeds from Sale') {
      if (!(r.qty > 0)) continue;
      const avg = pos.shares > 0 ? pos.cost / pos.shares : 0;
      const sold = Math.min(r.qty, pos.shares);
      pos.shares -= sold;
      pos.cost -= avg * sold;
      if (pos.shares < 1e-9) { pos.shares = 0; pos.cost = 0; }
    } else if (r.flow === 'Dividend') {
      if (amount === null || !(amount > 0)) continue;
      // A real share count, or a placeholder (qty = amount at price 1)? Then use the ledger's
      const rowShares = r.qty > 0 && !(Math.abs(r.qty - r.amount) < 1e-6 && Math.abs(r.price - 1) < 1e-9) ? r.qty : 0;
      const shares = rowShares || pos.shares;
      if (!(shares > 0)) continue;
      const price = priceBefore(t, ym);
      const avgCost = pos.shares > 0 ? pos.cost / pos.shares : 0;
      out.push({
        ticker: t,
        date: r.date,
        marketPct: price && price > 0 ? (amount / (shares * price)) * 100 : null,
        onCostPct: avgCost > 0 ? (amount / (shares * avgCost)) * 100 : null,
      });
    }
  }
  return out;
}
