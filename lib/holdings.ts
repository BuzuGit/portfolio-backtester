/*
  HOLDINGS — the Markets tab's "what do I own today?" page.

  Everything here is built from numbers the app already has, so this page and the
  Positions tab's Open Positions table always agree:
   - the open positions replayed from the Transactions ledger (lib/positions.ts), i.e.
     only the shares STILL HELD, plus the dividends/interest those shares earned;
   - the cash balances (lib/cash.ts);
   - month-end prices and FX rates from the price sheet.

  Every money figure is converted into ONE display currency, the same way the Positions
  tab's converted columns do it:
   - what you paid (and each dividend) at the FX rate of the month it happened,
   - what it is worth today at today's FX rate.
  So the FX effect is inside the return, as it would be for an investor who counts in
  that currency. Exchange rates are all quoted against PLN in the sheet (USDPLN,
  SGDPLN...), so PLN is the hub: native -> PLN -> display currency.

  This file only does arithmetic. How it looks is in components/PortfolioBacktester.tsx.
*/

import type { AssetRow, AssetLookup } from './fetchData';
import type { OpenPosition } from './positions';
import type { CashAccountBalance } from './cash';

/** The left-panel name of the page, listed under Markets after "Country". */
export const MARKETS_HOLDINGS = 'Holdings';

/** Currencies offered by the page's currency buttons. USD is the default. */
export const HOLDINGS_CURRENCIES = ['USD', 'PLN', 'EUR', 'CHF', 'SGD'] as const;
export type HoldingsCurrency = typeof HOLDINGS_CURRENCIES[number];

/** A dated amount of money, for XIRR: negative = paid in, positive = got back. */
export interface CashFlow { date: Date; amount: number }

/**
 * How far a holding sits below its own best month-end, as an AMOUNT.
 *
 * Measured per share so that buying more never counts as a "gain": the peak is the
 * highest month-end value of ONE share (in the display currency) since the first buy,
 * and the drop is (today's value of a share − that peak) × the shares held today.
 */
export interface HoldingDrawdown {
  amount: number;          // <= 0; 0 = at its peak today
  peakPerShare: number;    // best month-end value of one share, display currency
  peakDate: string;        // when that was
  nowPerShare: number;     // today's value of one share, display currency
  sinceDate: string;       // first buy, i.e. where the search for the peak starts
}

export interface HoldingRow {
  kind: 'asset' | 'cash';
  key: string;             // asset: ticker · cash: "account|currency" (the Positions tab's own key)
  ticker: string;          // '' for cash
  name: string;
  section: string;         // asset class this row is grouped under
  nativeCurrency: string;
  // Latest price in the asset's OWN currency, as on the other Markets pages. null for cash.
  price: number | null;
  priceUp: boolean | null; // latest price >= the previous month's; null if unknown
  priceDate: string;       // which month that price is from, so a stale one can be flagged
  firstBuyDate: string;    // '' for cash
  yearsHeld: number | null;
  qty: number;             // shares held · for cash: the balance in its own currency
  invested: number;        // display currency (cash: equal to value — a dollar cost a dollar)
  value: number;           // display currency, today
  income: number;          // dividends + interest the shares still held have earned
  ret: number;             // value + income − invested
  retPct: number | null;   // ret ÷ invested; null for cash
  xirr: number | null;     // money-weighted return a year, in the display currency
  dd: HoldingDrawdown | null;
  weight: number;          // % of everything held, cash included
  flows: CashFlow[];       // the dated money in/out behind xirr (section totals reuse them)
}

export interface HoldingsSection {
  name: string;
  rows: HoldingRow[];
  invested: number;
  value: number;
  ret: number;
  retPct: number | null;
  xirr: number | null;
  weight: number;
}

export interface HoldingsModel {
  currency: string;
  endDate: string;         // the latest row of the price sheet
  sections: HoldingsSection[];
  totals: {
    invested: number;      // cash included, so Return % is diluted by idle cash (deliberately)
    value: number;
    ret: number;
    retPct: number | null;
    xirr: number | null;   // across the investments only — cash has no dated flows
    cash: number;
    cashPct: number | null;
    holdings: number;      // number of asset rows
  };
}

// Sections run from safest to riskiest, the same order as the Positions tab.
const SECTION_ORDER = ['Cash', 'Fixed Income', 'Metals & Crypto', 'Alternatives', 'Equities'];
// Gold and crypto carry the class "Other" in the sheet; the Positions tab's "Group M&C"
// toggle calls them Metals & Crypto, and so does this page.
const sectionOf = (assetClass: string): string =>
  !assetClass || assetClass === 'Other' || assetClass === 'Crypto' ? 'Metals & Crypto' : assetClass;

const MS_PER_YEAR = 365.25 * 86400000;

export const buildHoldings = (args: {
  open: OpenPosition[];
  lookup: AssetLookup[];
  data: AssetRow[];
  cash: CashAccountBalance[];
  currency: string;
  fxTickerMap: Record<string, string>;     // currency -> its xxxPLN column ("USD" -> "USDPLN")
  xirr: (flows: CashFlow[]) => number | null;
  now?: Date;
}): HoldingsModel | null => {
  const { open, lookup, data, cash, currency, fxTickerMap, xirr } = args;
  const now = args.now ?? new Date();
  if (data.length === 0) return null;
  const last = data[data.length - 1];

  // How many PLN one unit of `ccy` was worth on that row (1 for PLN, and 1 if the rate is
  // missing — the same fallback the Positions tab uses).
  const toPLN = (ccy: string, row: AssetRow): number => {
    if (ccy === 'PLN') return 1;
    const r = Number(row[fxTickerMap[ccy] || '']);
    return r > 0 ? r : 1;
  };
  const conv = (ccy: string, row: AssetRow): number =>
    (ccy === currency ? 1 : toPLN(ccy, row) / toPLN(currency, row));
  // A dated transaction uses its own month's rate: the first month-end on or after it
  // (a 15 Jan purchase takes the 31 Jan rate), exactly as the Positions tab does.
  const convAt = (ccy: string, date: string): number =>
    conv(ccy, data.find(r => String(r.date) >= date) ?? last);
  const convNow = (ccy: string) => conv(ccy, last);
  const priceOn = (ticker: string, row: AssetRow): number => {
    const p = Number(row[ticker]);
    return p > 0 ? p : 0;
  };

  const rows: HoldingRow[] = [];

  // ---- Investments: only tickers in the lookup table, like the Positions tab ----
  for (const pos of open) {
    const info = lookup.find(a => a.ticker === pos.ticker);
    if (!info) continue;
    const ccy = info.currency || 'PLN';

    // Latest price: the last month that has one. Usually the live month; if the sheet hasn't
    // filled it in yet, an older one, and priceDate says which.
    let endIdx = data.length - 1;
    while (endIdx >= 0 && priceOn(pos.ticker, data[endIdx]) === 0) endIdx--;
    const price = endIdx >= 0 ? priceOn(pos.ticker, data[endIdx]) : 0;
    const prev = endIdx > 0 ? priceOn(pos.ticker, data[endIdx - 1]) : 0;

    const qty = pos.lots.reduce((s, l) => s + l.qty, 0);
    const invested = pos.lots.reduce((s, l) => s + l.cost * convAt(ccy, l.date), 0);
    const income = pos.incomeEvents.reduce((s, e) => s + e.amount * convAt(ccy, e.date), 0);
    const nowPerShare = price * convNow(ccy);
    const value = nowPerShare * qty;
    const ret = value + income - invested;

    const flows: CashFlow[] = [
      ...pos.lots.map(l => ({ date: new Date(l.date), amount: -l.cost * convAt(ccy, l.date) })),
      ...pos.incomeEvents.map(e => ({ date: new Date(e.date), amount: e.amount * convAt(ccy, e.date) })),
      { date: now, amount: value },
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    // Drawdown from the holding's own peak: every month-end from the month of the first buy.
    let dd: HoldingDrawdown | null = null;
    const firstBuyDate = pos.lots.length > 0 ? pos.lots[0].date : pos.firstBuyDate;
    if (price > 0 && firstBuyDate) {
      let peakPerShare = nowPerShare, peakDate = endIdx >= 0 ? String(data[endIdx].date) : '';
      for (const row of data) {
        if (String(row.date).slice(0, 7) < firstBuyDate.slice(0, 7)) continue;
        const p = priceOn(pos.ticker, row);
        if (p === 0) continue;
        const v = p * conv(ccy, row);
        if (v > peakPerShare) { peakPerShare = v; peakDate = String(row.date); }
      }
      dd = { amount: (nowPerShare - peakPerShare) * qty, peakPerShare, peakDate, nowPerShare, sinceDate: firstBuyDate };
    }

    rows.push({
      kind: 'asset', key: pos.ticker, ticker: pos.ticker, name: info.name || pos.asset,
      section: sectionOf(info.assetClass), nativeCurrency: ccy,
      price: price > 0 ? price : null,
      priceUp: price > 0 && prev > 0 ? price >= prev : null,
      priceDate: endIdx >= 0 ? String(data[endIdx].date) : '',
      firstBuyDate,
      yearsHeld: firstBuyDate ? (now.getTime() - new Date(firstBuyDate).getTime()) / MS_PER_YEAR : null,
      qty, invested, value, income, ret,
      retPct: invested > 0 ? (ret / invested) * 100 : null,
      xirr: xirr(flows),
      dd, weight: 0, flows,
    });
  }

  // ---- Cash: one row per account and currency, at today's rate ----
  for (const c of cash) {
    const value = c.balance * convNow(c.currency);
    rows.push({
      kind: 'cash', key: `${c.account}|${c.currency}`, ticker: '', name: `${c.account} · ${c.currency}`,
      section: 'Cash', nativeCurrency: c.currency,
      price: null, priceUp: null, priceDate: '', firstBuyDate: '', yearsHeld: null,
      qty: c.balance, invested: value, value, income: 0, ret: 0, retPct: null, xirr: null,
      dd: null, weight: 0, flows: [],
    });
  }

  // ---- Weights, sections, totals ----
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  rows.forEach(r => { r.weight = totalValue !== 0 ? (r.value / totalValue) * 100 : 0; });

  // XIRR of several holdings together: all their flows on one timeline.
  const pooledXirr = (rs: HoldingRow[]): number | null => {
    const flows = rs.flatMap(r => r.flows).sort((a, b) => a.date.getTime() - b.date.getTime());
    return flows.length >= 2 ? xirr(flows) : null;
  };
  const rank = (name: string) => {
    const i = SECTION_ORDER.indexOf(name);
    return i === -1 ? SECTION_ORDER.length : i;
  };
  const names = Array.from(new Set(rows.map(r => r.section)))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const sections: HoldingsSection[] = names.map(name => {
    // Largest first inside each section.
    const rs = rows.filter(r => r.section === name).sort((a, b) => b.value - a.value);
    const invested = rs.reduce((s, r) => s + r.invested, 0);
    const ret = rs.reduce((s, r) => s + r.ret, 0);
    const isCash = rs.every(r => r.kind === 'cash');
    return {
      name, rows: rs, invested,
      value: rs.reduce((s, r) => s + r.value, 0),
      ret,
      retPct: !isCash && invested > 0 ? (ret / invested) * 100 : null,
      xirr: isCash ? null : pooledXirr(rs),
      weight: rs.reduce((s, r) => s + r.weight, 0),
    };
  });

  const invested = rows.reduce((s, r) => s + r.invested, 0);
  const ret = rows.reduce((s, r) => s + r.ret, 0);
  const cashValue = rows.filter(r => r.kind === 'cash').reduce((s, r) => s + r.value, 0);
  return {
    currency,
    endDate: String(last.date),
    sections,
    totals: {
      invested, value: totalValue, ret,
      retPct: invested > 0 ? (ret / invested) * 100 : null,
      xirr: pooledXirr(rows.filter(r => r.kind === 'asset')),
      cash: cashValue,
      cashPct: totalValue !== 0 ? (cashValue / totalValue) * 100 : null,
      holdings: rows.filter(r => r.kind === 'asset').length,
    },
  };
};
