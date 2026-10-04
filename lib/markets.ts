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

// The trend sparkline keeps up to 10 years: 120 monthly steps = 121 month-end points. The table
// shows the last 1, 3, 5 or 10 years of it, depending on the chosen trend window.
const SPARK_POINTS = 121;

/**
 * How one value in the table was built from the sheet, so a tooltip can show the working:
 *   asset converted to EUR:  833.80 USD × 3.8958 (USDPLN) ÷ 4.3884 (EURPLN) = 740.21
 *   FX cross rate USD/EUR:   USDPLN 3.8958 ÷ 4.3884 (EURPLN) = 0.8877
 * `first` is the starting number (a price, or a rate for FX rows), `ops` the FX steps applied.
 */
export interface ValueWorking {
  first: number;
  firstLabel: string;   // unit after a price ("USD"), or the rate's name before an FX value ("USDPLN")
  ops: { op: '×' | '÷'; value: number; label: string }[];
  result: number;
  resultUnit: string;   // currency the result is in
}

export interface PeriodWorking {
  startDate: string;
  start: ValueWorking;
  endDate: string;
  end: ValueWorking;
}

// What a row measures, which decides how its numbers are built and shown:
//   asset — a price; returns are % changes, convertible between currencies
//   fx    — an exchange rate shown as BASE/OTHER
//   rate  — an interest rate or bond yield in %; "returns" are CHANGES in basis points
//   cpi   — a consumer price index; returns are cumulative inflation in %, Value is YoY inflation
export type MarketRowKind = 'asset' | 'fx' | 'rate' | 'cpi';

export interface MarketRow {
  ticker: string;
  name: string;             // for FX rows, the pair as shown, e.g. "USD/EUR"
  kind: MarketRowKind;
  isFx: boolean;            // FX row: price/DD/signal are on the shown exchange rate
  returns: Record<MarketsPeriod, number | null>; // percent (bp for 'rate' rows); null = not enough history ("–")
  working: Record<MarketsPeriod, PeriodWorking | null>; // the prices/rates/dates behind each return
  spark: number[];          // last 10 years of prices in the SELECTED currency, oldest first (months with no price skipped)
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
  colourCapsBp: Record<MarketsPeriod, number>; // the same for 'rate' rows, whose cells are in bp
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

// An FX row: the Lookup's asset class says "Currencies" and the ticker is a six-letter pair
// like USDPLN (base USD, quoted in PLN). SGDUSD-style pairs work too.
const isFxPair = (a: AssetLookup): boolean =>
  (a.assetClass || '').toLowerCase() === 'currencies' && /^[A-Z]{6}$/.test(a.ticker);

/**
 * Exchange rates are quoted to 4 decimals (USD/PLN 3.8958, USD/EUR 0.8877), or 2 once the
 * rate is in the hundreds (USD/JPY 158.20). This is deliberately NOT formatPrice: that ladder
 * is for share prices and would print 3.8958 as "3.90", hiding the moves that matter in FX.
 */
export const formatFxRate = (v: number): string => v.toFixed(Math.abs(v) >= 100 ? 2 : 4);

// A Macro row (the Lookup's asset class says "Macro"): rates, yields and inflation. These are
// not prices, so they never go through currency conversion. A ticker starting "CPI" is a
// consumer price INDEX; everything else in Macro is a rate quoted in percent.
const isMacroRow = (a: AssetLookup): boolean => (a.assetClass || '').toLowerCase() === 'macro';
const isCpiRow = (a: AssetLookup): boolean => /^CPI/i.test(a.ticker);

/**
 * Builds one Macro row. Two kinds:
 *
 * RATE (reference rates, 10Y yields): the period columns are the CHANGE in basis points
 * (US 10Y from 4.44% to 5.29% over 1Y = +85 bp). A % change of a rate would be meaningless —
 * 0.25% -> 4.00% reads as "+1,500%" — and would break on a 0% or negative rate. Value is
 * the latest rate; ATH is the highest rate ever recorded.
 *
 * CPI (inflation): the sheet holds a price INDEX (PL = 179.57), so the period columns are
 * cumulative inflation over the period (1Y = year-on-year). Value and ATH use YoY inflation,
 * because the index level itself means nothing and its "high" is almost always today.
 * CPI is published with a lag and the sheet repeats the last print into later months, so
 * every CPI figure is anchored at the LAST MONTH THE INDEX ACTUALLY CHANGED — otherwise the
 * repeated months would turn 1Y inflation into a 10-month figure. (A genuinely flat print
 * in the latest month would be read as a repeat and dated one month earlier; rare.)
 */
const buildMacroRow = (
  a: AssetLookup,
  rows: AssetRow[],
  indexByMonth: Map<number, number>,
): MarketRow => {
  const cpi = isCpiRow(a);
  // Rates can be 0 or negative (Swiss rates were for years), so presence is the test, not > 0.
  const level = (r: AssetRow): number | null => {
    const raw = r[a.ticker];
    if (raw === undefined || raw === '') return null;
    const v = Number(raw);
    return isFinite(v) ? v : null;
  };

  let endIdx = rows.length - 1;
  while (endIdx >= 0 && level(rows[endIdx]) === null) endIdx--;
  if (cpi) while (endIdx > 0 && level(rows[endIdx - 1]) === level(rows[endIdx])) endIdx--;

  // Year-on-year inflation at row i, from the index 12 months earlier.
  const yoyAt = (i: number): number | null => {
    const prevIdx = indexByMonth.get(monthKey(String(rows[i].date)) - 12);
    const now = level(rows[i]);
    const then = prevIdx === undefined ? null : level(rows[prevIdx]);
    return now !== null && then !== null && then > 0 ? (now / then - 1) * 100 : null;
  };
  // The number shown as Value and used for ATH / trend: YoY for CPI, the rate itself otherwise.
  const shown = (i: number): number | null => (cpi ? yoyAt(i) : level(rows[i]));

  const returns = {} as Record<MarketsPeriod, number | null>;
  const working = {} as Record<MarketsPeriod, PeriodWorking | null>;
  MARKETS_PERIODS.forEach(p => { returns[p] = null; working[p] = null; });
  const unitLabel = cpi ? 'CPI' : '%';
  const w = (v: number): ValueWorking => ({ first: v, firstLabel: unitLabel, ops: [], result: v, resultUnit: unitLabel });

  let spark: number[] = [];
  let value: number | null = null;
  let valueUp: boolean | null = null;
  let valueDate = '';
  let ath: number | null = null;
  let athDate = '';

  if (endIdx >= 0) {
    const endRow = rows[endIdx];
    const endKey = monthKey(String(endRow.date));
    const e = level(endRow) as number;
    MARKETS_PERIODS.forEach(p => {
      const startKey = p === 'YTD' ? (Math.floor(endKey / 12) - 1) * 12 + 11 : endKey - PERIOD_MONTHS[p];
      const startIdx = indexByMonth.get(startKey);
      if (startIdx === undefined) return;
      const s = level(rows[startIdx]);
      if (s === null) return;
      if (cpi) {
        if (!(s > 0)) return;
        returns[p] = (e / s - 1) * 100;          // cumulative inflation, %
      } else {
        returns[p] = (e - s) * 100;              // change in basis points
      }
      working[p] = { startDate: String(rows[startIdx].date), start: w(s), endDate: String(endRow.date), end: w(e) };
    });

    // Trend (up to 10 years) of the shown number (the rate, or YoY inflation).
    for (let i = Math.max(0, endIdx - SPARK_POINTS + 1); i <= endIdx; i++) {
      const v = shown(i);
      if (v !== null) spark.push(v);
    }

    value = shown(endIdx);
    valueDate = String(endRow.date);
    const prev = endIdx > 0 ? shown(endIdx - 1) : null;
    // STRICTLY rose: for Macro "up" is the warning colour, and an unchanged rate isn't news.
    valueUp = value !== null && prev !== null ? value > prev : null;

    for (let i = 0; i <= endIdx; i++) {
      const v = shown(i);
      if (v !== null && (ath === null || v > ath)) { ath = v; athDate = String(rows[i].date); }
    }
  }

  return {
    ticker: a.ticker, name: a.name, kind: cpi ? 'cpi' : 'rate', isFx: false, returns, working, spark,
    price: value, priceCurrency: '%', priceUp: valueUp, priceDate: valueDate,
    drawdown: null, isAtAth: value !== null && ath !== null && value >= ath, athPrice: ath, athDate,
    sma10: null, signal: null,
  };
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
  const shownFx = new Set<string>(); // currencies already given an FX row in this table
  lookup.forEach((a, sheetIndex) => {
    const placement = (a.snapshots || []).find(s => s.category.toLowerCase() === wanted);
    if (!placement) return;

    // Files the finished row under its subcategory. No order number = after the numbered
    // rows; ties keep the sheet's own order.
    const addRow = (row: MarketRow) => {
      const section = placement.subcategory || 'Other';
      if (!sectionsMap.has(section)) sectionsMap.set(section, []);
      sectionsMap.get(section)!.push({ row, order: placement.order ?? Infinity, sheetIndex });
    };

    // Rates and inflation have their own rules (see buildMacroRow) and ignore the currency.
    if (isMacroRow(a)) { addRow(buildMacroRow(a, rows, indexByMonth)); return; }

    const nativeCcy = a.currency || 'PLN';

    // Two ways to read a value off a month's row:
    //   conv — what the RETURNS, bars and trend line are measured on;
    //   nat  — what Price, Curr DD and Signal are measured on.
    // For an ordinary asset that is the converted price and the native price respectively.
    const positive = (r: AssetRow, col: string): number | null => { const v = Number(r[col]); return v > 0 ? v : null; };
    let conv = (r: AssetRow) => convertedPrice(r, a.ticker, nativeCcy, currency);
    let nat = (r: AssetRow) => positive(r, a.ticker);
    // The same value as conv(), but showing its working (for the return-cell tooltips).
    const rateOf = (r: AssetRow, c: string) => Number(r[`${c}PLN`]);
    let explain = (r: AssetRow): ValueWorking | null => {
      const p = positive(r, a.ticker), v = conv(r);
      if (p === null || v === null) return null;
      const ops: ValueWorking['ops'] = [];
      if (currency !== 'Original' && nativeCcy !== currency) {
        if (nativeCcy !== 'PLN') ops.push({ op: '×', value: rateOf(r, nativeCcy), label: `${nativeCcy}PLN` });
        if (currency !== 'PLN') ops.push({ op: '÷', value: rateOf(r, currency), label: `${currency}PLN` });
      }
      return { first: p, firstLabel: nativeCcy, ops, result: v, resultUnit: currency === 'Original' ? nativeCcy : currency };
    };
    let name = a.name;
    let priceCurrency = nativeCcy;
    const isFx = isFxPair(a);

    // FX rows are different: a cross rate has no "own currency" to convert, so both readers
    // become the rate itself, shown picture-style as BASE/OTHER (units of OTHER per 1 BASE,
    // so + = the base currency strengthened). In a base currency, each of the sheet's pairs
    // stands for its non-base currency — USDPLN stands for USD, unless USD IS the base, in
    // which case it stands for PLN. That way the four sheet rows always show the four
    // currencies other than the base, with cross rates rebuilt through the PLN hub
    // (USD/EUR = USDPLN / EURPLN). 'Original' shows the sheet's pairs exactly as written.
    if (isFx) {
      const pairBase = a.ticker.slice(0, 3), pairQuote = a.ticker.slice(3);
      let base: string, other: string;
      if (currency === 'Original') {
        base = pairBase; other = pairQuote;
        conv = nat = r => positive(r, a.ticker);
        explain = r => {
          const v = positive(r, a.ticker);
          return v === null ? null : { first: v, firstLabel: a.ticker, ops: [], result: v, resultUnit: pairQuote };
        };
      } else {
        base = currency;
        other = pairBase !== currency ? pairBase : pairQuote;
        if (other === base || shownFx.has(other)) return; // nothing to show, or already shown
        shownFx.add(other);
        const toPln = (r: AssetRow, c: string) => (c === 'PLN' ? 1 : positive(r, `${c}PLN`));
        conv = nat = r => {
          const b = toPln(r, base), o = toPln(r, other);
          return b !== null && o !== null ? b / o : null;
        };
        // e.g. USD/EUR = USDPLN ÷ EURPLN;  USD/PLN = USDPLN;  PLN/USD = 1 ÷ USDPLN
        explain = r => {
          const b = toPln(r, base), o = toPln(r, other);
          if (b === null || o === null) return null;
          return {
            first: b, firstLabel: base === 'PLN' ? '' : `${base}PLN`,
            ops: other === 'PLN' ? [] : [{ op: '÷', value: o, label: `${other}PLN` }],
            result: b / o, resultUnit: other,
          };
        };
      }
      name = `${base}/${other}`;
      priceCurrency = other;
    }

    // The asset's latest month with a price. Normally the live month; if the sheet hasn't
    // filled this asset in yet, its own last price is used and priceDate says which month.
    let endIdx = rows.length - 1;
    while (endIdx >= 0 && nat(rows[endIdx]) === null) endIdx--;

    const returns = {} as Record<MarketsPeriod, number | null>;
    const working = {} as Record<MarketsPeriod, PeriodWorking | null>;
    MARKETS_PERIODS.forEach(p => { returns[p] = null; working[p] = null; });
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
      const endValue = conv(endRow);
      const endWorking = explain(endRow);

      MARKETS_PERIODS.forEach(p => {
        // YTD starts at last December; everything else N months before the end.
        const startKey = p === 'YTD'
          ? (Math.floor(endKey / 12) - 1) * 12 + 11
          : endKey - PERIOD_MONTHS[p];
        const startIdx = indexByMonth.get(startKey);
        if (startIdx === undefined || endValue === null) return;
        const startValue = conv(rows[startIdx]);
        if (startValue === null) return;
        returns[p] = (endValue / startValue - 1) * 100;
        const startWorking = explain(rows[startIdx]);
        if (startWorking && endWorking) {
          working[p] = { startDate: String(rows[startIdx].date), start: startWorking, endDate: String(endRow.date), end: endWorking };
        }
      });

      // Trend line (up to 10 years) in the selected currency. Months with no price are simply skipped.
      spark = rows.slice(Math.max(0, endIdx - SPARK_POINTS + 1), endIdx + 1)
        .map(conv)
        .filter((v): v is number => v !== null);

      // Price column: native currency (the shown rate, for FX), coloured by the move since
      // the previous month-end.
      price = nat(endRow) as number; // endIdx was chosen as a row where nat() has a value
      priceDate = String(endRow.date);
      const prev = endIdx > 0 ? nat(rows[endIdx - 1]) : null;
      priceUp = prev !== null ? price >= prev : null;

      // All-time high over the whole history up to the latest price (native currency).
      for (let i = 0; i <= endIdx; i++) {
        const p = nat(rows[i]);
        if (p !== null && (athPrice === null || p > athPrice)) { athPrice = p; athDate = String(rows[i].date); }
      }
      if (athPrice !== null) {
        drawdown = (price / athPrice - 1) * 100;
        isAtAth = Math.abs(drawdown) < 0.01;
      }

      // 10-month SMA: needs a price in each of the last 10 months, like the Monthly tab.
      const last10 = rows.slice(Math.max(0, endIdx - 9), endIdx + 1)
        .map(nat).filter((p): p is number => p !== null);
      if (last10.length === 10) {
        sma10 = last10.reduce((s, p) => s + p, 0) / 10;
        signal = price > sma10 ? 'BUY' : 'SELL';
      }
    }

    addRow({
      ticker: a.ticker, name, kind: isFx ? 'fx' : 'asset', isFx, returns, working, spark, price, priceCurrency, priceUp, priceDate,
      drawdown, isAtAth, athPrice, athDate, sma10, signal,
    });
  });

  // Map keeps insertion order, so sections come out in the order they first appear in the sheet.
  const sections: MarketSection[] = Array.from(sectionsMap.entries()).map(([name, items]) => ({
    name,
    rows: items.sort((x, y) => (x.order - y.order) || (x.sheetIndex - y.sheetIndex)).map(i => i.row),
  }));

  // Each column gets its own colour scale (the picture's rule): +2% is vivid in 1M but pale in 10Y.
  // Rate rows (bp) get a scale of their own: +85 bp and +3.2% inflation can't share one.
  const allRows = sections.flatMap(s => s.rows);
  const colourCaps = {} as Record<MarketsPeriod, number>;
  const colourCapsBp = {} as Record<MarketsPeriod, number>;
  const capFor = (rs: MarketRow[], p: MarketsPeriod) =>
    colourCap(rs.map(r => r.returns[p]).filter((v): v is number => v !== null));
  MARKETS_PERIODS.forEach(p => {
    colourCaps[p] = capFor(allRows.filter(r => r.kind !== 'rate'), p);
    colourCapsBp[p] = capFor(allRows.filter(r => r.kind === 'rate'), p);
  });

  return { sections, columns: orderedColumns(endDate), colourCaps, colourCapsBp, endDate };
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
  // Trend tile: how many rows are on a 10-month-SMA BUY signal, out of the rows that have a
  // signal at all (needs 10 months of prices). Today's signal, so it ignores the period.
  buy: number;
  signalTotal: number;
}

/** The tiles above the table, for one period. */
export const summariseMatrix = (matrix: ReturnMatrix, period: MarketsPeriod): MatrixSummary => {
  const rows = matrix.sections.flatMap(s => s.rows);
  const withSignal = rows.filter(r => r.signal !== null);
  const buy = withSignal.filter(r => r.signal === 'BUY').length;
  const signalTotal = withSignal.length;
  const vals = rows
    .filter(r => r.returns[period] !== null)
    .map(r => ({ name: r.name, value: r.returns[period] as number }));
  if (!vals.length) return { leader: null, laggard: null, dispersion: null, positive: 0, total: 0, buy, signalTotal };
  const sorted = [...vals].sort((a, b) => b.value - a.value);
  const leader = sorted[0];
  const laggard = sorted[sorted.length - 1];
  return {
    leader, laggard,
    dispersion: leader.value - laggard.value,
    positive: vals.filter(v => v.value > 0).length,
    total: vals.length,
    buy, signalTotal,
  };
};
