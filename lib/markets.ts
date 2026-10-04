/*
  MARKETS TAB — RETURN MATRIX

  The Markets tab is a one-screen "how is everything doing" board. This file does all of
  its arithmetic and none of its drawing, so it can be tested on its own against the real
  spreadsheet (the drawing lives in components/PortfolioBacktester.tsx).

  WHAT GOES IN: the Lookup tab decides. A table shows the rows placed in its SnapshotCategory
  (e.g. "Assets"), grouped into sections by SnapshotSubCategory (in the order the groups first
  appear in the sheet) and ordered inside each group by SnapshotSubCategoryOrder. One row can be
  placed in several categories — the three cells hold comma-separated lists paired by position
  ("Assets, Factor" / "Equities, World" / "4, 1") — see SnapshotPlacement in fetchData.ts.

  HOW A RETURN IS MEASURED: every period ends at the asset's latest monthly price (the live,
  month-to-date row, the same "now" the rest of the app uses) and starts at the month-end N
  months earlier. YTD starts at the last price of the previous December. The prices are
  adjusted close, so every figure is a TOTAL return. Long periods (3Y/5Y/10Y) are cumulative,
  not annualised, so every column means the same thing: "how much did it change in total".

  CURRENCY: the sheet stores each asset in its own currency plus xxxPLN exchange rates, so
  PLN is the hub — like changing money at one central desk. A dollar asset shown in euros is
  first turned into zloty at that month's USDPLN, then into euros at that month's EURPLN.
  Each month uses its OWN rate, so the FX move over the period is part of the return, exactly
  what a euro-based investor would have experienced.
*/

import type { AssetRow, AssetLookup } from './fetchData';

// 'Original' = no conversion: each asset's returns stay in its own currency (S&P 500 in USD,
// WIG20 in PLN...), i.e. what a local investor in that asset experienced.
export type MarketsCurrency = 'Original' | 'PLN' | 'USD' | 'EUR' | 'CHF' | 'SGD';
export type MarketsPeriod = 'YTD' | '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y' | '10Y';

// The period buttons, in the order the user asked for them.
export const MARKETS_PERIODS: MarketsPeriod[] = ['YTD', '1M', '3M', '6M', '1Y', '3Y', '5Y', '10Y'];

// How many months each fixed period looks back. YTD is not here: its length depends on the date.
const PERIOD_MONTHS: Record<Exclude<MarketsPeriod, 'YTD'>, number> = {
  '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '3Y': 36, '5Y': 60, '10Y': 120,
};

// The trend sparkline always shows 5 years: 60 monthly steps = 61 month-end points.
const SPARK_POINTS = 61;

export interface MarketRow {
  ticker: string;
  name: string;
  returns: Record<MarketsPeriod, number | null>; // percent; null = not enough history (shown as "–")
  spark: number[];          // last 5 years of prices in the SELECTED currency, oldest first
  price: number | null;     // latest price in the asset's OWN currency
  priceCurrency: string;    // e.g. "USD"
  priceUp: boolean | null;  // latest price >= previous month's (native); null if unknown
  priceDate: string;        // date of that latest price, so a stale row can be flagged
  // Current drawdown: how far the latest price sits below the highest month-end price ever
  // recorded (native currency, same rule as the Annual tab's "Curr DD"). Percent, <= 0.
  drawdown: number | null;
  isAtAth: boolean;         // within 0.01% of the all-time high, shown as "ATH"
  athPrice: number | null;
  athDate: string;
  // 10-month SMA trend signal, exactly as the Monthly tab computes it: the average of the last
  // 10 month-end prices INCLUDING the latest one (native currency). BUY if the latest price is
  // above that average, SELL otherwise; null if there aren't 10 months of prices yet.
  sma10: number | null;
  signal: 'BUY' | 'SELL' | null;
}

export interface MarketSection {
  name: string;
  rows: MarketRow[];
}

export interface ReturnMatrix {
  sections: MarketSection[];
  columns: MarketsPeriod[];                  // table column order, with YTD slotted in by date
  colourCaps: Record<MarketsPeriod, number>; // per-column scale for the red/green cell colour
  endDate: string;                           // the latest date in the price sheet
}

// "2026-10-31" -> a number that goes up by 1 each month, so "N months earlier" is subtraction.
const monthKey = (date: string): number => {
  const [y, m] = date.split('-').map(Number);
  return y * 12 + (m - 1);
};

/**
 * Where YTD sits among the columns. YTD in October covers about ten months, so it belongs
 * between 6M and 1Y; in February it covers about two, so between 1M and 3M. Rule: put it
 * right after the last fixed period that is no longer than the months elapsed this year.
 */
export const orderedColumns = (endDate: string): MarketsPeriod[] => {
  const monthsElapsed = Number(endDate.split('-')[1]) || 12;
  const fixed = MARKETS_PERIODS.filter(p => p !== 'YTD') as Exclude<MarketsPeriod, 'YTD'>[];
  let insertAt = 0;
  fixed.forEach((p, i) => { if (PERIOD_MONTHS[p] <= monthsElapsed) insertAt = i + 1; });
  return [...fixed.slice(0, insertAt), 'YTD', ...fixed.slice(insertAt)];
};

/**
 * One asset's price on one row, converted into `target` currency.
 * Returns null — never a made-up 1.0 rate — when the price or an FX rate is missing, so a
 * gap shows up as "–" instead of as a silently wrong number. (The app's older getFxRate
 * falls back to 1, which would price a dollar asset as if it were in zloty.)
 */
const convertedPrice = (row: AssetRow, ticker: string, nativeCcy: string, target: MarketsCurrency): number | null => {
  const price = Number(row[ticker]);
  if (!(price > 0)) return null;
  if (target === 'Original' || nativeCcy === target) return price; // no FX involved at all
  const toPln = (ccy: string): number | null => {
    if (ccy === 'PLN') return 1;
    const rate = Number(row[`${ccy}PLN`]);
    return rate > 0 ? rate : null;
  };
  const nativeRate = toPln(nativeCcy);
  const targetRate = toPln(target);
  if (nativeRate === null || targetRate === null) return null;
  return price * nativeRate / targetRate;
};

/** The 85th percentile of |x| — the picture's colour rule, so one outlier can't wash out the rest. */
const colourCap = (values: number[]): number => {
  const abs = values.map(Math.abs).sort((a, b) => a - b);
  if (!abs.length) return 1;
  const cap = abs[Math.max(0, Math.ceil(abs.length * 0.85) - 1)];
  return cap > 0 ? cap : 1;
};

/** Builds the whole Return matrix for one display currency. */
export const buildReturnMatrix = (
  data: AssetRow[] | null,
  lookup: AssetLookup[],
  currency: MarketsCurrency,
  category = 'Assets', // which SnapshotCategory this table shows
): ReturnMatrix | null => {
  if (!data || data.length === 0) return null;

  // Rows sorted by date, plus a month -> row index so "N months earlier" is a lookup, not a search.
  const rows = [...data].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const indexByMonth = new Map<number, number>();
  rows.forEach((r, i) => indexByMonth.set(monthKey(String(r.date)), i));
  const endDate = String(rows[rows.length - 1].date);

  // Only rows placed in this category. A row can sit in several categories (e.g. IWDA in both
  // "Assets" and "Factor"), each with its own subcategory and order — pick THIS category's one.
  const wanted = category.toLowerCase();
  const sectionsMap = new Map<string, { row: MarketRow; order: number; sheetIndex: number }[]>();
  lookup.forEach((a, sheetIndex) => {
    const placement = (a.snapshots || []).find(s => s.category.toLowerCase() === wanted);
    if (!placement) return;
    const nativeCcy = a.currency || 'PLN';

    // The asset's latest month with a price. Normally the live month; if the sheet hasn't
    // filled this asset in yet, its own last price is used and priceDate says which month.
    let endIdx = rows.length - 1;
    while (endIdx >= 0 && !(Number(rows[endIdx][a.ticker]) > 0)) endIdx--;

    const returns = {} as Record<MarketsPeriod, number | null>;
    MARKETS_PERIODS.forEach(p => { returns[p] = null; });
    let spark: number[] = [];
    let price: number | null = null;
    let priceUp: boolean | null = null;
    let priceDate = '';
    let drawdown: number | null = null;
    let isAtAth = false;
    let athPrice: number | null = null;
    let athDate = '';
    let sma10: number | null = null;
    let signal: 'BUY' | 'SELL' | null = null;

    if (endIdx >= 0) {
      const endRow = rows[endIdx];
      const endKey = monthKey(String(endRow.date));
      const endValue = convertedPrice(endRow, a.ticker, nativeCcy, currency);

      MARKETS_PERIODS.forEach(p => {
        // YTD starts at last December; everything else N months before the end.
        const startKey = p === 'YTD'
          ? (Math.floor(endKey / 12) - 1) * 12 + 11
          : endKey - PERIOD_MONTHS[p];
        const startIdx = indexByMonth.get(startKey);
        if (startIdx === undefined || endValue === null) return;
        const startValue = convertedPrice(rows[startIdx], a.ticker, nativeCcy, currency);
        if (startValue === null) return;
        returns[p] = (endValue / startValue - 1) * 100;
      });

      // 5-year trend line in the selected currency. Months with no price are simply skipped.
      spark = rows.slice(Math.max(0, endIdx - SPARK_POINTS + 1), endIdx + 1)
        .map(r => convertedPrice(r, a.ticker, nativeCcy, currency))
        .filter((v): v is number => v !== null);

      // Price column: native currency, coloured by the move since the previous month-end.
      price = Number(endRow[a.ticker]);
      priceDate = String(endRow.date);
      const prev = endIdx > 0 ? Number(rows[endIdx - 1][a.ticker]) : NaN;
      priceUp = prev > 0 ? price >= prev : null;

      // All-time high over the whole history up to the latest price (native currency).
      for (let i = 0; i <= endIdx; i++) {
        const p = Number(rows[i][a.ticker]);
        if (p > 0 && (athPrice === null || p > athPrice)) { athPrice = p; athDate = String(rows[i].date); }
      }
      if (athPrice !== null) {
        drawdown = (price / athPrice - 1) * 100;
        isAtAth = Math.abs(drawdown) < 0.01;
      }

      // 10-month SMA: needs a price in each of the last 10 months, like the Monthly tab.
      const last10 = rows.slice(Math.max(0, endIdx - 9), endIdx + 1)
        .map(r => Number(r[a.ticker])).filter(p => p > 0);
      if (last10.length === 10) {
        sma10 = last10.reduce((s, p) => s + p, 0) / 10;
        signal = price > sma10 ? 'BUY' : 'SELL';
      }
    }

    const section = placement.subcategory || 'Other';
    if (!sectionsMap.has(section)) sectionsMap.set(section, []);
    sectionsMap.get(section)!.push({
      row: {
        ticker: a.ticker, name: a.name, returns, spark, price, priceCurrency: nativeCcy, priceUp, priceDate,
        drawdown, isAtAth, athPrice, athDate, sma10, signal,
      },
      // No order number = after the numbered rows; ties keep the sheet's own order.
      order: placement.order ?? Infinity,
      sheetIndex,
    });
  });

  // Map keeps insertion order, so sections come out in the order they first appear in the sheet.
  const sections: MarketSection[] = Array.from(sectionsMap.entries()).map(([name, items]) => ({
    name,
    rows: items.sort((x, y) => (x.order - y.order) || (x.sheetIndex - y.sheetIndex)).map(i => i.row),
  }));

  // Each column gets its own colour scale (the picture's rule): +2% is vivid in 1M but pale in 10Y.
  const allRows = sections.flatMap(s => s.rows);
  const colourCaps = {} as Record<MarketsPeriod, number>;
  MARKETS_PERIODS.forEach(p => {
    colourCaps[p] = colourCap(allRows.map(r => r.returns[p]).filter((v): v is number => v !== null));
  });

  return { sections, columns: orderedColumns(endDate), colourCaps, endDate };
};

/**
 * Every SnapshotCategory used in the Lookup tab ("Assets", "Factor", ...), in the order each
 * first appears in the sheet — these become the Category buttons, so a new category added in
 * the sheet gets its own button without any code change. Spelling/case follows the first use.
 */
export const snapshotCategories = (lookup: AssetLookup[]): string[] => {
  const seen = new Map<string, string>(); // lower-case key -> first spelling seen
  lookup.forEach(a => (a.snapshots || []).forEach(s => {
    const key = s.category.toLowerCase();
    if (!seen.has(key)) seen.set(key, s.category);
  }));
  return Array.from(seen.values());
};

export interface MatrixSummary {
  leader: { name: string; value: number } | null;
  laggard: { name: string; value: number } | null;
  dispersion: number | null; // best minus worst, in percentage points
  positive: number;          // how many assets are above zero
  total: number;             // how many assets have a figure for this period
}

/** The four tiles above the table, for one period. */
export const summariseMatrix = (matrix: ReturnMatrix, period: MarketsPeriod): MatrixSummary => {
  const vals = matrix.sections.flatMap(s => s.rows)
    .filter(r => r.returns[period] !== null)
    .map(r => ({ name: r.name, value: r.returns[period] as number }));
  if (!vals.length) return { leader: null, laggard: null, dispersion: null, positive: 0, total: 0 };
  const sorted = [...vals].sort((a, b) => b.value - a.value);
  const leader = sorted[0];
  const laggard = sorted[sorted.length - 1];
  return {
    leader, laggard,
    dispersion: leader.value - laggard.value,
    positive: vals.filter(v => v.value > 0).length,
    total: vals.length,
  };
};
