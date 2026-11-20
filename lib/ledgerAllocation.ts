/*
  WHAT WAS HELD AT EACH MONTH-END (from the Transactions ledger)

  The Positions tab answers "what do I hold today?". This file answers the same question for
  every month-end in the past, so the tab can draw how the mix changed.

  It needs nothing new from the sheet. lib/positions.ts has already replayed the ledger into lots:
    - lots still OPEN were held from the day they were bought until today;
    - lots SOLD (round trips) were held from their buy date until their sale date.
  So the units held on any date are just the lots alive on that date, added up. Each is valued at
  that month's price from the price sheet, the same prices the Positions tab uses.

  Cash comes from lib/cash.ts's bank statements: an account's balance on a date is the running
  balance after its last movement on or before that date.

  Everything is converted to PLN at the month's own exchange rate. Shares of the whole don't depend
  on that choice; the chart converts PLN to another currency only for the amounts it prints.
*/

import type { AssetLookup, AssetRow, UnitFee } from './fetchData';
import { unitFeeQty } from './fetchData.ts';
import type { PositionsModel } from './positions';
import type { CashAccountBalance } from './cash';

// Units given up to fees AFTER `date` (they were still held on `date`): all of them, less those
// taken on or before it. Built on fetchData's unitFeeQty so the rule lives in one place.
const feesAfter = (fees: UnitFee[] | undefined, date: string): number =>
  unitFeeQty(fees) - unitFeeQty(fees, date);

/**
 * One holding at one month-end. `estimated` = the price sheet has never had a price for it up to
 * that month, so it was valued from its own trades instead (see ESTIMATES below). A month that
 * merely skips a price uses the last one before it, as the Positions tab does for today.
 * `valuePln` is null only when its currency has no exchange rate in the price sheet at all.
 */
export interface MonthHolding { ticker: string; currency: string; qty: number; valuePln: number | null; estimated: boolean }
/** One cash account (in one currency) at one month-end. `valuePln` null = no exchange rate for that currency. */
export interface MonthCash { account: string; currency: string; balance: number; valuePln: number | null }
export interface LedgerMonth {
  date: string;
  pln: Record<string, number>;   // PLN per unit of each currency that month (PLN = 1)
  holdings: MonthHolding[];
  cash: MonthCash[];
}

// The exchange-rate column for each currency in the price sheet (xxxPLN = zloty per unit)
const FX_COL: Record<string, string> = { USD: 'USDPLN', SGD: 'SGDPLN', EUR: 'EURPLN', CHF: 'CHFPLN' };

/**
 * Holdings and cash at every month-end row of the price sheet, from the month of the first
 * purchase onwards.
 *
 * @param model  the ledger replay (open lots + round trips), already limited to Lookup tickers
 * @param cash   EVERY cash account's statement, including accounts closed since: money that sat
 *               in a bank closed in 2019 was still cash in 2018
 * @param lookup the Lookup tab, for each ticker's pricing currency
 * @param rows   the price sheet, one row per month-end, oldest first
 */
export function ledgerMonthEnds(model: PositionsModel, cash: CashAccountBalance[], lookup: AssetLookup[], rows: AssetRow[]): LedgerMonth[] {
  // Every stretch of time a number of units of a ticker was held: [from, until) — until '' = still
  // held. Each also carries what one unit cost, and (if sold) what one unit fetched, for ESTIMATES.
  interface Span { ticker: string; from: string; until: string; qty: number; unitFees: UnitFee[]; buyUnit: number; sellUnit: number }
  const spans: Span[] = [];
  for (const p of model.open) {
    for (const lot of p.lots) {
      const bought = lot.qty + feesAfter(lot.unitFees, '');
      spans.push({ ticker: p.ticker, from: lot.date, until: '', qty: lot.qty, unitFees: lot.unitFees,
        buyUnit: bought > 0 ? lot.cost / bought : 0, sellUnit: 0 });
    }
  }
  for (const rt of model.roundTrips) {
    const bought = rt.qty + feesAfter(rt.unitFees, '');
    spans.push({ ticker: rt.ticker, from: rt.buyDate, until: rt.sellDate, qty: rt.qty, unitFees: rt.unitFees,
      buyUnit: bought > 0 ? rt.cost / bought : 0, sellUnit: rt.qty > 0 ? rt.proceeds / rt.qty : 0 });
  }

  // ESTIMATES — a month with no price for something held. It happens: the ledger books the EDO
  // bond bought in Jul 2019 (redeemed Jul 2024, 100 -> 139.20) under EDO0734, whose prices only
  // start in Jul 2024. Valuing it at cost would understate it by up to 39%. Instead a SOLD lot grows
  // smoothly (at a steady compound rate) from its buy price to its sale price: exact at both ends,
  // and the right shape for a bond. A lot still held, with no price at all, stays at cost.
  const estimatedUnit = (s: Span, date: string): number => {
    if (!s.until || !(s.buyUnit > 0) || !(s.sellUnit > 0)) return s.buyUnit;
    const t0 = Date.parse(s.from), t1 = Date.parse(s.until), t = Date.parse(date);
    const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 1;
    return s.buyUnit * (s.sellUnit / s.buyUnit) ** f;
  };
  if (spans.length === 0) return [];
  const firstBuy = spans.reduce((m, s) => (s.from < m ? s.from : m), spans[0].from);
  const currencyOf = new Map(lookup.map(a => [a.ticker, a.currency || 'PLN']));

  // The latest price seen for each ticker held at some point, and the latest rate for each
  // currency. A blank cell then means "unchanged since the last one", not "worth nothing" — the
  // same rule the Positions tab uses for today's value (getCurrentPrice walks back to the last price).
  const heldTickers = new Set(spans.map(s => s.ticker));
  const lastPrice = new Map<string, number>();
  const lastRate: Record<string, number> = { PLN: 1 };

  const out: LedgerMonth[] = [];
  for (const row of rows) {
    const date = String(row.date);
    // Remember this row's prices and rates first, even for rows before the first purchase: a
    // later blank cell falls back on them
    for (const t of Array.from(heldTickers)) {
      const p = Number(row[t]);
      if (p > 0) lastPrice.set(t, p);
    }
    for (const [ccy, col] of Object.entries(FX_COL)) {
      const r = Number(row[col]);
      if (r > 0) lastRate[ccy] = r;
    }
    // Start with the month of the first purchase (its month-end row is the first on/after it)
    if (date.slice(0, 7) < firstBuy.slice(0, 7)) continue;

    const pln: Record<string, number> = { ...lastRate };
    const toPln = (amount: number, ccy: string): number | null => (pln[ccy] ? amount * pln[ccy] : null);

    // Units of each ticker held on this date, and what they'd be worth by ESTIMATES (used only if
    // the month has no price)
    const qty = new Map<string, number>();
    const estimate = new Map<string, number>();
    for (const s of spans) {
      if (s.from > date || (s.until && s.until <= date)) continue;
      // An open lot's qty is what it holds TODAY; add back units it gave to fees since this date.
      // A sold lot's qty is what was left to sell; same correction for fees taken before the sale.
      const q = s.qty + feesAfter(s.unitFees, date);
      qty.set(s.ticker, (qty.get(s.ticker) ?? 0) + q);
      estimate.set(s.ticker, (estimate.get(s.ticker) ?? 0) + q * estimatedUnit(s, date));
    }
    const holdings: MonthHolding[] = [];
    for (const [ticker, q] of Array.from(qty)) {
      if (Math.abs(q) < 1e-9) continue;
      const currency = currencyOf.get(ticker) ?? 'PLN';
      const price = lastPrice.get(ticker) ?? 0;   // this month's, or the last one before it
      const native = price > 0 ? q * price : (estimate.get(ticker) ?? 0);
      holdings.push({ ticker, currency, qty: q, valuePln: toPln(native, currency), estimated: !(price > 0) });
    }

    // Each account's balance after its last movement on or before this date
    const cashOut: MonthCash[] = [];
    for (const acct of cash) {
      let balance = 0, seen = false;
      for (const m of acct.movements) {
        if (m.date > date) break;          // movements are sorted oldest first
        balance = m.balance; seen = true;
      }
      if (!seen || Math.abs(balance) < 0.5) continue;
      cashOut.push({ account: acct.account, currency: acct.currency, balance, valuePln: toPln(balance, acct.currency) });
    }

    out.push({ date, pln, holdings, cash: cashOut });
  }
  return out;
}
