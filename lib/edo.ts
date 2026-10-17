/*
  EDO — Polish 10-year inflation-linked savings bonds ("obligacje skarbowe EDO")

  Everything the app knows about EDO comes from the sheet's "EDO" tab (gid=1035374877), which
  has two blocks side by side:
    - a SERIES LIST (one row per series): when it was sold, when it matures, its fixed
      first-year rate, its margin over CPI for years 2-10, whether it is still running, and
      its latest value;
    - a VALUE GRID: one row per month-end, one column per series, holding what 100 zl of that
      series was worth on that date (interest is capitalised, so the value only ever grows).
      The grid runs AHEAD of today: each coupon year's rate is fixed at its start, so the
      sheet already knows the values up to the end of every bond's current coupon year.

  A series is named after its MATURITY month: EDO0136 matures January 2036, so it was sold in
  January 2026.

  HOW "EDO" BECOMES AN ASSET (the chain)
  An EDO bond only lives ten years, so to compare it with an ETF over any window we need a
  rule for what an investor holds. The rule (agreed with the user, Oct 2026):
    1. A start date in this app is a month-end. Starting on month-end M means buying, at par
       (100), the series SOLD IN THE FOLLOWING MONTH. A 31 Dec 2025 start buys EDO0136 (sold
       Jan 2026) — so "YTD" is EDO0136, and "3Y" is the series bought three years ago.
    2. Hold it to maturity. A bond maturing on 1 Jan 2020 is worth its 31 Dec 2019 value; that
       cash buys the series sold in January 2020 (EDO0130) at par, and so on — chained.
  So EDO has no single price history: the path depends on the START date. A window that
  starts in 2015 holds a different bond, with a different rate, from a window that starts in
  2009 and is still rolling the same chain. Each window has to be priced from its own start.
  That is what edoChain() does.

  Everything here is PRE-TAX, like every other asset in the app (EDO_TAX_RATE is used only by
  the Markets > EDO page). The early-redemption fee is ignored.
*/

import type { AssetRow } from './fetchData';

// The ticker EDO goes by in the Lookup tab and in the price rows the rest of the app reads.
export const EDO_TICKER = 'EDO';
// The Markets tab page that shows the series list and charts (left panel, below Equities).
export const MARKETS_EDO = 'EDO';
// The price sheet's Polish CPI index (the Lookup's "Inflation PL"), which EDO's coupons follow.
export const EDO_CPI_TICKER = 'CPIMPL';
// Polish capital-gains tax ("podatek Belki"), charged on the interest when the bond is redeemed.
export const EDO_TAX_RATE = 0.19;

export interface EdoSeries {
  series: string;               // "EDO0136"
  sold: string;                 // "2026-01-01" — first day of the sale month
  matures: string;              // "2036-01-01"
  firstYearRate: number | null; // % for year 1, e.g. 5.6
  margin: number | null;        // % over CPI for years 2-10, e.g. 2.0
  status: string;               // "running" / "matured"
  value: number | null;         // latest value per 100 zl, as the sheet reports it
  valueAt: string;              // the month-end that value is for
  termsFrom: string;            // where the sheet took the terms from
}

export interface EdoData {
  series: EdoSeries[];                         // in sheet order (newest first)
  months: string[];                            // the value grid's month-ends, oldest first
  values: Map<string, Map<number, number>>;    // series -> (month key -> value per 100 zl)
  soldIn: Map<number, EdoSeries>;              // month key of the sale month -> that series
}

// A calendar month as one integer (year * 12 + month index), so "the next month" is just + 1.
// Taken from the text of the date, never through Date, so time zones cannot shift a month-end.
export const monthKeyOf = (date: string): number =>
  Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

// "5.60%" -> 5.6 ; blank -> null
const pct = (s: string | undefined): number | null => {
  const v = parseFloat(String(s ?? '').replace('%', '').replace(',', '.'));
  return isFinite(v) ? v : null;
};

/**
 * Reads the EDO tab. Takes the rows already split by fetchData's quote-aware CSV parser.
 * Returns null if the tab doesn't look like the EDO tab (so a broken sheet can't break the app).
 */
export function parseEdoSheet(rows: string[][]): EdoData | null {
  if (rows.length < 2) return null;
  const header = rows[0].map(h => h.trim());
  const col = (name: string) => header.indexOf(name);
  const cSeries = col('series'), cPeriod = col('period');
  if (cSeries < 0 || cPeriod < 0) return null;
  const cSold = col('sold'), cMat = col('matures'), cRate = col('first_year_rate');
  const cMargin = col('margin_over_cpi'), cStatus = col('status'), cValue = col('value');
  const cValueAt = col('value_at'), cTerms = col('terms_from');

  // Block 1: the series list (rows whose "series" cell is filled in).
  const series: EdoSeries[] = [];
  for (const r of rows.slice(1)) {
    const name = (r[cSeries] ?? '').trim();
    if (!/^EDO\d{4}$/.test(name)) continue;
    series.push({
      series: name,
      sold: (r[cSold] ?? '').trim(),
      matures: (r[cMat] ?? '').trim(),
      firstYearRate: pct(r[cRate]),
      margin: pct(r[cMargin]),
      status: (r[cStatus] ?? '').trim(),
      value: pct(r[cValue]),
      valueAt: (r[cValueAt] ?? '').trim(),
      termsFrom: (r[cTerms] ?? '').trim(),
    });
  }

  // Block 2: the value grid. Its columns are the EDOxxxx headers to the right of "period".
  const gridCols: { name: string; idx: number }[] = [];
  header.forEach((h, idx) => { if (idx > cPeriod && /^EDO\d{4}$/.test(h)) gridCols.push({ name: h, idx }); });
  const values = new Map<string, Map<number, number>>();
  gridCols.forEach(c => values.set(c.name, new Map()));
  const months: string[] = [];
  for (const r of rows.slice(1)) {
    const d = (r[cPeriod] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    months.push(d);
    const key = monthKeyOf(d);
    for (const c of gridCols) {
      const v = parseFloat((r[c.idx] ?? '').replace(/,/g, ''));
      if (isFinite(v) && v > 0) values.get(c.name)!.set(key, v);
    }
  }
  months.sort();

  const soldIn = new Map<number, EdoSeries>();
  series.forEach(s => { if (/^\d{4}-\d{2}/.test(s.sold)) soldIn.set(monthKeyOf(s.sold), s); });

  if (!series.length || !months.length) return null;
  return { series, months, values, soldIn };
}

// Today's date as YYYY-MM-DD (the price sheet's current-month row is dated at the month-END,
// which is still in the future — see edoChain).
export const todayIso = (): string => new Date().toISOString().slice(0, 10);

// Days between two YYYY-MM-DD dates (UTC, so daylight-saving can't add or lose an hour).
export const daysBetween = (a: string, b: string): number =>
  (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;

// The last day of the month with this month key, as YYYY-MM-DD ("2026-09-30").
export const monthEndIso = (key: number): string =>
  new Date(Date.UTC(Math.floor(key / 12), (key % 12) + 1, 0)).toISOString().slice(0, 10);

// A month-end still in the future (the price sheet dates the current month at its month-END) is
// valued TODAY: between last month-end's value and this month-end's, by days elapsed. Within a
// coupon year EDO interest accrues evenly, so this is the value today, not the projected one.
const prorateToToday = (prevValue: number, value: number, monthEnd: string, today: string): number => {
  const prevEnd = monthEndIso(monthKeyOf(monthEnd) - 1);
  const frac = Math.min(1, Math.max(0, daysBetween(prevEnd, today) / daysBetween(prevEnd, monthEnd)));
  return prevValue + (value - prevValue) * frac;
};

/**
 * The value, at each of `dates`, of 100 zl put into EDO at month-end `startDate` and rolled at
 * every maturity (rules in the header). `dates` must be ascending month-ends. Entries before the
 * start are null; the start itself is exactly 100. All null if the start buys a series the sheet
 * doesn't have (e.g. the start is the current month and next month's series isn't on sale yet).
 *
 * Three details:
 *   - A date AFTER `today` (the price sheet dates the current month at its month-end) is
 *     prorated between last month-end and this month-end by days elapsed. Within a coupon year
 *     EDO interest accrues evenly, so this is the value today, not the projected month-end.
 *   - If the grid has no value yet for the bond being held (the sheet hasn't been updated past a
 *     coupon reset), its last known value is carried forward flat rather than dropping to zero.
 *   - If the series to roll into isn't in the sheet yet, the cash waits (flat) until it is.
 */
export function edoChain(edo: EdoData, startDate: string, dates: string[], today: string = todayIso()): (number | null)[] {
  const out: (number | null)[] = dates.map(() => null);
  if (!dates.length) return out;
  const startKey = monthKeyOf(startDate);
  const first = edo.soldIn.get(startKey + 1);
  if (!first) return out;

  // Walk month by month from the start to the last date asked for, keeping the chain's level
  // at every month-end (level = units held x that series' value).
  const lastKey = monthKeyOf(dates[dates.length - 1]);
  const levelAt = new Map<number, number>();
  levelAt.set(startKey, 100);
  let held: EdoSeries | null = first;
  let units = 1;          // 100 zl at par = 1 "unit" of 100
  let cash: number | null = null; // set while waiting for a series to roll into
  let lastLevel = 100;
  for (let key = startKey + 1; key <= lastKey; key++) {
    // Roll every bond that has matured by this month: it is worth its value at the month-end
    // before its maturity date, and that cash buys the series sold in the maturity month.
    while (held && monthKeyOf(held.matures) <= key) {
      const matKey = monthKeyOf(held.matures);
      const grid = edo.values.get(held.series);
      const redeemed = units * (grid?.get(matKey - 1) ?? lastLevel / units);
      const next = edo.soldIn.get(matKey);
      if (next) { held = next; units = redeemed / 100; cash = null; }
      else { held = null; cash = redeemed; }
    }
    if (!held && cash !== null) {
      // Waiting for the next series: try again to buy one sold this month.
      const next = edo.soldIn.get(key);
      if (next && edo.values.get(next.series)?.has(key)) { held = next; units = cash / 100; cash = null; }
    }
    let level: number;
    if (held) {
      const v = edo.values.get(held.series)?.get(key);
      level = v !== undefined ? units * v : lastLevel; // no value yet -> carry flat
    } else {
      level = cash ?? lastLevel;
    }
    levelAt.set(key, level);
    lastLevel = level;
  }

  dates.forEach((d, i) => {
    const key = monthKeyOf(d);
    if (key < startKey) return;
    const level = levelAt.get(key);
    if (level === undefined) return;
    if (d > today && key > startKey) {
      // Current month: prorate between last month-end and this (future) month-end.
      out[i] = prorateToToday(levelAt.get(key - 1) ?? level, level, d, today);
    } else {
      out[i] = level;
    }
  });
  return out;
}

/** Return (%) of a fresh EDO purchase at month-end `startDate`, valued at `endDate`. */
export function edoWindowReturn(edo: EdoData, startDate: string, endDate: string, today?: string): number | null {
  const [v] = edoChain(edo, startDate, [endDate], today);
  return v === null ? null : v - 100;
}

/**
 * The EDO chain's value at each of `rows` (same order), bought at the first row on or after
 * `startDate` (default: the first row that can buy a series). null before that row. Returns null
 * if no row can anchor a chain. This is the cheap form: just the numbers, no copied rows — what
 * a window calculation needs when it only has to re-price one column.
 */
export function edoChainOnRows(rows: AssetRow[], edo: EdoData, startDate?: string, today?: string): (number | null)[] | null {
  if (!rows.length) return null;
  const dates = rows.map(r => String(r.date));
  const anchor = startDate
    ? dates.find(d => d >= startDate)
    : dates.find(d => edo.soldIn.has(monthKeyOf(d) + 1));
  return anchor ? edoChain(edo, anchor, dates, today) : null;
}

/**
 * Puts EDO into the price rows as an ordinary column, anchored at `startDate` (default: the
 * first row that can buy a series). Rows before the anchor get no EDO value. Returns new row
 * objects; the input rows are not touched.
 *
 * The data load calls this once with the default anchor, so EDO appears in every tab like any
 * other asset — and for any window that starts at the first row it is already the right chain.
 * Window calculations that start later re-anchor it at their own start (see the header).
 */
export function withEdoColumn(rows: AssetRow[], edo: EdoData, startDate?: string, today?: string): AssetRow[] {
  const levels = edoChainOnRows(rows, edo, startDate, today);
  if (!levels) return rows;
  return rows.map((r, i) => {
    const copy: AssetRow = { ...r };
    delete copy[EDO_TICKER];
    if (levels[i] !== null) copy[EDO_TICKER] = levels[i] as number;
    return copy;
  });
}

/**
 * Adds one price column per named SERIES (e.g. "EDO0734") — the bond itself, not the chain — so a
 * real holding of that series can be valued and charted like any other asset. The price of one
 * bond (100 zl nominal) is the sheet's value per 100 zl, at each month-end from its first month
 * to the month before it matures. Same rules as edoChain: a month-end still in the future is
 * prorated to today, and a month the sheet hasn't filled in yet (not updated past a coupon reset)
 * carries the last known value forward flat — so a held bond never silently loses its price, and
 * it agrees with the chained EDO. Only series the sheet has are added; rows are copied, not touched.
 *
 * The data load passes every Lookup ticker that is an EDO series name, so adding a row such as
 * "EDO0734" to the Lookup tab is what makes that bond appear in Positions and Holdings.
 */
export function withEdoSeriesColumns(rows: AssetRow[], edo: EdoData, seriesNames: string[], today: string = todayIso()): AssetRow[] {
  const meta = new Map(edo.series.map(s => [s.series, s]));
  const wanted = seriesNames.filter(s => edo.values.has(s) && meta.has(s));
  if (!wanted.length) return rows;
  // Value per bond at a month-end: from the sheet; carried forward flat inside the bond's life
  // (first sheet month .. the month before maturity); 100 (par) before its first month-end.
  const valueAt = (s: string, key: number): number | null => {
    const grid = edo.values.get(s)!;
    const firstKey = monthKeyOf(meta.get(s)!.sold);
    const lastKey = monthKeyOf(meta.get(s)!.matures) - 1;
    if (key < firstKey) return key === firstKey - 1 ? 100 : null;
    if (key > lastKey) return null;
    for (let k = key; k >= firstKey; k--) {
      const v = grid.get(k);
      if (v !== undefined) return v;
    }
    return 100;
  };
  return rows.map(r => {
    const d = String(r.date);
    const key = monthKeyOf(d);
    const copy: AssetRow = { ...r };
    wanted.forEach(s => {
      if (key < monthKeyOf(meta.get(s)!.sold)) return; // not sold yet
      const v = valueAt(s, key);
      if (v === null) return;
      copy[s] = d > today ? prorateToToday(valueAt(s, key - 1) ?? 100, v, d, today) : v;
    });
    return copy;
  });
}

/** After-tax value per 100 zl: 19% is due on the gain above 100 (nothing on a loss). */
export const edoAfterTax = (value: number): number =>
  value > 100 ? 100 + (value - 100) * (1 - EDO_TAX_RATE) : value;
