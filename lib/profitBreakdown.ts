/*
  PROFIT BREAKDOWN BY ASSET, FOR ONE CALENDAR YEAR

  The Portfolio tab's "Profit Breakdown by Asset" table: one year's portfolio profit split into
  each asset's held / bought / sold segments plus income, reconciled to the year's total through
  an "Other" line. Moved word for word from the main screen file; everything it reads from the
  app's data comes in as one bundle (BreakdownInputs). Tests in lib/profitBreakdown.test.mjs.
*/
// The ".ts" endings let Node run this file's tests directly
import { FLOW_PURCHASE, heldQty, unitFeeQty, type AssetLookup, type AssetRow, type ClosedPositionRow, type TransactionRow, type YearsRow } from './fetchData.ts';
import { getConversionRate } from './backtest.ts';
import { toYM } from './dates.ts';
import { getYearlyValueSeries as yearlyValueSeries } from './portfolioYears.ts';

/** One year's profit split by asset. */
export type YearlyProfitBreakdown = {
  assets: {
    ticker: string; name: string; nativeCurrency: string;
    totalNative: number; totalConverted: number; totalFx: number;
    retNative: number | null; retConverted: number | null;   // whole-asset % return (this year)
    startValue: number; endValue: number;                    // native position value at each boundary
    segments: {
      label: string;
      shares: number | null;      // null for the income line
      startPrice: number | null; startTag: string;
      endPrice: number | null;   endTag: string;
      startValue: number | null; endValue: number | null;    // native position value (endValue − startValue = profitNative)
      profitNative: number; profitConverted: number;
      fxEffect: number;                         // FX slice of the converted profit
      retNative: number | null;                 // % return in native currency
      retConverted: number | null;              // % return in selected currency
    }[];
  }[];
  other: number;
  total: number;
};

/** What the breakdown reads from the app's data. */
export interface BreakdownInputs {
  assetData: AssetRow[] | null;
  assetLookup: AssetLookup[];
  yearsData: YearsRow[];
  closedData: ClosedPositionRow[];
  transactionData: TransactionRow[];
  getOpenPurchases: (ticker: string) => TransactionRow[];   // the lots still held of an open position
  getOpenDividends: (ticker: string) => TransactionRow[];
  getAssetCurrency: (ticker: string) => string;
}

/**
 * ============================================================
 * PROFIT BREAKDOWN BY ASSET — for a single calendar year
 * ============================================================
 *
 * Goal: take one year's total portfolio profit (the bar in the chart above)
 * and show, for each asset, a transparent worksheet of HOW that profit was
 * made — quantity, the price it started the year at, the price it ended at,
 * and the resulting profit — so you can eyeball that
 *      shares × (end price − start price) ≈ profit.
 *
 * To make that arithmetic tie out, each asset is broken into clean SEGMENTS,
 * because a single asset can have several stories in one year:
 *   • "Held from start"          — shares owned on 1 Jan and still held at year-end
 *                                  (start = last-Dec price, end = this-Dec price)
 *   • "Held from start · sold"   — shares owned on 1 Jan but sold during the year
 *                                  (start = last-Dec price, end = your sell price)
 *   • "Bought in <year>"         — shares bought this year and still held
 *                                  (start = your buy price, end = this-Dec price)
 *   • "Bought & sold <year>"     — bought and sold within the year
 *                                  (start = buy price, end = sell price)
 *   • "Income (div/interest)"    — dividends/interest earned that year (no price)
 *
 * WHY THE SEGMENTS ARE EXACT: every SALE in the data is already paired with its
 * exact BUY in the "Closed" sheet (one row = one complete buy→sell lot), and
 * shares still held are buy-only rows in the "Data" sheet. So each lot slots
 * cleanly into exactly one segment with no guesswork about which shares sold.
 *
 * CURRENCY: prices are shown in each asset's NATIVE currency (SGD, USD, PLN…),
 * so "shares × price change" ties out in that currency (the "Profit (native)"
 * column). The final "Profit (<selected>)" column converts each boundary at the
 * exchange rate of its own month — so it also captures the currency gain/loss.
 * The gap between the two columns IS the FX effect (mirrors the Positions tab).
 *
 * SCALE GUARD: a few legacy lots were traded on a different price scale than
 * their price-history column (e.g. an old cash line). We detect this per lot —
 * if the price feed at the buy month disagrees with the actual price paid by
 * more than ~3× — and drop that lot into "Other" rather than show a distorted
 * mark-to-market.
 *
 * OTHER = (total year profit) − (sum of all itemised assets). It absorbs
 * unpriced assets, cash, fees, and the guarded lots, and guarantees the table
 * reconciles exactly to the bar in the chart above. Undated dividends from
 * already-sold lots are spread evenly across the months held (chosen setting).
 */
export const getYearlyProfitBreakdown = (
  inputs: BreakdownInputs,
  year: number,
  currency: string,
): YearlyProfitBreakdown => {
  const { assetData, assetLookup, yearsData, closedData, transactionData, getOpenPurchases, getOpenDividends, getAssetCurrency } = inputs;
  const getYearlyValueSeries = (cur: string) => yearlyValueSeries(yearsData, cur);
  if (!assetData || assetData.length === 0 || yearsData.length === 0) {
    return { assets: [], other: 0, total: 0 };
  }

  // --- small local helpers (kept inside so the diff stays self-contained) ---

  // The monthly price row that best represents the END of calendar year `y`.
  // assetData is sorted oldest→newest, so the LAST row whose date starts with
  // "y-" is December of that year (or the latest available month for the
  // current, not-yet-finished year).
  const yearEndRow = (y: number): AssetRow | null => {
    let found: AssetRow | null = null;
    for (const row of assetData) {
      if (row.date.startsWith(`${y}-`)) found = row;
    }
    return found;
  };

  // The monthly price row for a given "YYYY-MM" month (used to grab the FX rate
  // in the month a buy/sell/dividend happened). Falls back to the most recent
  // earlier month if that exact month is missing.
  const rowForYM = (ym: string): AssetRow | null => {
    let carry: AssetRow | null = null;
    for (const row of assetData) {
      const rym = toYM(new Date(row.date));
      if (rym === ym) return row;
      if (rym < ym) carry = row;
    }
    return carry;
  };

  // Does the price feed contain any price for this ticker at all? If not, the
  // asset is "not in quotes" and everything about it flows into "Other".
  const isPriced = (ticker: string): boolean => {
    for (const row of assetData) {
      const p = Number(row[ticker]);
      if (p && p > 0) return true;
    }
    return false;
  };

  // List of "YYYY-MM" months between two dates, inclusive — used to spread the
  // lifetime dividends of a closed lot evenly across the months it was held.
  const monthsInclusive = (startDate: string, endDate: string): string[] => {
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) return [];
    const out: string[] = [];
    let y = s.getFullYear();
    let m = s.getMonth();
    const ey = e.getFullYear();
    const em = e.getMonth();
    while (y < ey || (y === ey && m <= em)) {
      out.push(`${y}-${String(m + 1).padStart(2, '0')}`);
      m++;
      if (m > 11) { m = 0; y++; }
    }
    return out;
  };

  // The native price of `ticker` in the monthly row for month `ym` (0 if none).
  const priceAtYM = (ticker: string, ym: string): number => {
    const row = rowForYM(ym);
    if (!row) return 0;
    const p = Number(row[ticker]);
    return p > 0 ? p : 0;
  };

  // Convert a native-currency cash amount to `currency` using the FX rate that
  // applied in month `ym` (falls back to year-end FX if the month is missing).
  const cashAt = (ym: string, native: string, amount: number): number => {
    const row = rowForYM(ym) || thisYearEndRow || prevYearEndRow;
    if (!row) return amount;
    return amount * getConversionRate(row, native, currency);
  };

  const prevYearEndRow = yearEndRow(year - 1); // ≈ 31 Dec of the previous year
  const thisYearEndRow = yearEndRow(year);     // end of this year (or latest month)
  const divConvRow = thisYearEndRow || prevYearEndRow; // FX used for spread dividends

  // Collect every ticker that had any purchase or closed-lot activity.
  const tickerSet = new Set<string>();
  for (const t of transactionData) if (t.flow === FLOW_PURCHASE && t.ticker) tickerSet.add(t.ticker);
  for (const c of closedData) if (c.ticker) tickerSet.add(c.ticker);

  const assets: {
    ticker: string; name: string; nativeCurrency: string;
    totalNative: number; totalConverted: number; totalFx: number;
    retNative: number | null; retConverted: number | null;
    startValue: number; endValue: number;
    segments: {
      label: string; shares: number | null;
      startPrice: number | null; startTag: string;
      endPrice: number | null; endTag: string;
      startValue: number | null; endValue: number | null;
      profitNative: number; profitConverted: number;
      fxEffect: number;
      retNative: number | null; retConverted: number | null;
    }[];
  }[] = [];

  for (const ticker of Array.from(tickerSet)) {
    if (!isPriced(ticker)) continue; // unpriced assets → left for "Other"

    const native = getAssetCurrency(ticker);
    // Only lots that are STILL HELD. Anything sold is accounted for by closedLots
    // below, which knows the sale year and drops the lot from years after it. Reading
    // raw purchase rows here instead would book a 2020 purchase of a holding sold in
    // 2025 as "held from start" of 2026 — an asset that contributed nothing that year.
    const openLots = getOpenPurchases(ticker);
    const closedLots = closedData.filter(c => c.ticker === ticker);
    // Income on the shares still held. Payments that belonged to sold shares travel
    // with their round trip and are spread over the holding period further down, so
    // taking every dividend row here would count them twice.
    const dividends = getOpenDividends(ticker);

    // Native prices + FX at the two year boundaries.
    const pPrev = prevYearEndRow ? Number(prevYearEndRow[ticker]) || 0 : 0; // 31 Dec Y−1
    const pEnd = thisYearEndRow ? Number(thisYearEndRow[ticker]) || 0 : 0;  // 31 Dec Y / latest
    const fxPrev = prevYearEndRow ? getConversionRate(prevYearEndRow, native, currency) : 1;
    const fxEnd = thisYearEndRow ? getConversionRate(thisYearEndRow, native, currency) : 1;

    // Scale guard: is a lot's traded per-share price consistent with the price
    // feed at its buy month? (Guards against legacy scale mismatches.)
    const consistent = (perShare: number, buyYM: string): boolean => {
      const p = priceAtYM(ticker, buyYM);
      if (!p || !perShare) return false;
      const r = p / perShare;
      return r >= 1 / 3 && r <= 3;
    };

    // Segment accumulators (all in native currency; *C = converted to `currency`).
    const A = { sh: 0 };                                          // held from start, still held
    const B = { sh: 0, procN: 0, procC: 0 };                      // held from start, sold in year
    const C = { sh: 0, costN: 0, costC: 0 };                      // bought in year, still held
    const D = { sh: 0, costN: 0, costC: 0, procN: 0, procC: 0 };  // bought & sold in year
    let incN = 0, incC = 0;                                       // income (dividends/interest)
    // Units that shares held from the start of the year gave up to fees paid in units
    // during it (Endowus). They were worth pPrev each on 1 Jan and are gone by 31 Dec,
    // so they cost the year exactly that. Shares BOUGHT this year need no such line:
    // their cost is already counted in full and only the survivors are valued at the end.
    const F = { sh: 0 };
    // Fee cut-offs: a fee taken by 31 Dec has happened in this year's picture
    const yStartIso = `${year - 1}-12-31`, yEndIso = `${year}-12-31`;

    // --- Open lots (still held, buy-only) ---
    for (const lot of openLots) {
      const buyD = new Date(lot.date);
      if (isNaN(buyD.getTime())) continue;
      const buyYear = buyD.getFullYear();
      if (buyYear > year) continue; // not bought yet
      const perShare = lot.qty > 0 ? lot.amount / lot.qty : 0;
      if (!consistent(perShare, toYM(buyD))) continue; // guarded → Other
      // Shares count as held on 31 Dec of this year: what was bought, less any units given
      // up to fees by then (equal to lot.qty for almost every lot)
      if (buyYear < year) {
        A.sh += heldQty(lot, yEndIso);
        F.sh += unitFeeQty(lot.unitFees, yEndIso) - unitFeeQty(lot.unitFees, yStartIso);
      } else {
        C.sh += heldQty(lot, yEndIso);
        C.costN += lot.amount;
        C.costC += lot.amount * getConversionRate(rowForYM(toYM(buyD)) || thisYearEndRow!, native, currency);
      }
    }

    // --- Closed lots (complete buy→sell records) ---
    for (const c of closedLots) {
      const buyD = new Date(c.invDate);
      const sellD = new Date(c.divDate);
      if (isNaN(buyD.getTime()) || isNaN(sellD.getTime())) continue;
      const buyYear = buyD.getFullYear();
      const sellYear = sellD.getFullYear();
      const perShare = c.sharesSold > 0 ? c.initialCost / c.sharesSold : 0;
      const ok = consistent(perShare, toYM(buyD));

      // Capital contribution to year Y (only if the lot was alive in Y and passes the guard).
      if (ok && !(sellYear < year || buyYear > year)) {
        // Units this lot still gave up to fees paid in units AFTER 31 Dec of this year: it
        // held them on that date, on top of what it finally sold (0 for almost every lot)
        const feeUnitsAfterYear = unitFeeQty(c.unitFees) - unitFeeQty(c.unitFees, yEndIso);
        // ...and the ones it gave up during this year, if it was held from the start
        if (buyYear < year) F.sh += unitFeeQty(c.unitFees, yEndIso) - unitFeeQty(c.unitFees, yStartIso);
        if (buyYear < year && sellYear > year) {
          A.sh += c.sharesSold + feeUnitsAfterYear;                 // held all year
        } else if (buyYear < year && sellYear === year) {
          B.sh += c.sharesSold;                                     // opening, sold this year
          B.procN += c.valueAfterFee;
          B.procC += c.valueAfterFee * getConversionRate(rowForYM(toYM(sellD)) || thisYearEndRow!, native, currency);
        } else if (buyYear === year && sellYear > year) {
          C.sh += c.sharesSold + feeUnitsAfterYear;                 // bought this year, still held
          C.costN += c.initialCost;
          C.costC += c.initialCost * getConversionRate(rowForYM(toYM(buyD)) || thisYearEndRow!, native, currency);
        } else if (buyYear === year && sellYear === year) {
          D.sh += c.sharesSold;                                     // bought & sold this year
          D.costN += c.initialCost;
          D.costC += c.initialCost * getConversionRate(rowForYM(toYM(buyD)) || thisYearEndRow!, native, currency);
          D.procN += c.valueAfterFee;
          D.procC += c.valueAfterFee * getConversionRate(rowForYM(toYM(sellD)) || thisYearEndRow!, native, currency);
        }
      }

      // Dividends/interest for this sold lot.
      // Preferred: the actual payments, on the dates they were actually paid — the
      // ledger records them, so year Y gets exactly what year Y received.
      // Fallback (legacy Exit tab, which only stored a lifetime total): spread that
      // total evenly across the months held and take year Y's share. That estimate
      // is why 2023 used to read 935 for ES3TR when the real figure was 1,064.
      if (c.incomeEvents) {
        for (const e of c.incomeEvents) {
          if (!e.date.startsWith(`${year}-`)) continue;
          incN += e.amount;
          incC += cashAt(e.date.slice(0, 7), native, e.amount);
        }
      } else if (c.cumDividend) {
        const months = monthsInclusive(c.invDate, c.divDate);
        if (months.length > 0) {
          const k = months.filter(ym => ym.startsWith(`${year}-`)).length;
          if (k > 0) {
            const divNativeY = (c.cumDividend * k) / months.length;
            incN += divNativeY;
            incC += divConvRow ? divNativeY * getConversionRate(divConvRow, native, currency) : divNativeY;
          }
        }
      }
    }

    // --- Dated dividends on current holdings (Data sheet) ---
    for (const d of dividends) {
      const dD = new Date(d.date);
      if (isNaN(dD.getTime()) || dD.getFullYear() !== year) continue;
      incN += d.amount;
      incC += cashAt(toYM(dD), native, d.amount);
    }

    // --- Build the segment rows from the accumulators ---
    // Helper: assemble one segment, deriving its % returns and its FX slice.
    //  • baseNative / baseConverted = the capital that was "at work" for this
    //    segment (start value for held shares, cash cost for bought shares).
    //  • % return = profit ÷ that base, in each currency.
    //  • fxEffect = the part of the converted profit due to the exchange rate
    //    moving (converted profit − the native profit valued at the entry rate).
    type Seg = typeof assets[number]['segments'][number];
    const mkSeg = (
      label: string, shares: number | null,
      startPrice: number | null, startTag: string,
      endPrice: number | null, endTag: string,
      startValue: number | null, endValue: number | null,
      profitNative: number, profitConverted: number,
      baseNative: number, baseConverted: number,
      fxStartRate: number, // rate to value native profit "locally" (no FX move)
    ): Seg => ({
      label, shares, startPrice, startTag, endPrice, endTag, startValue, endValue,
      profitNative, profitConverted,
      fxEffect: profitConverted - profitNative * fxStartRate,
      retNative: Math.abs(baseNative) > 1e-9 ? (profitNative / baseNative) * 100 : null,
      retConverted: Math.abs(baseConverted) > 1e-9 ? (profitConverted / baseConverted) * 100 : null,
    });

    const segments: Seg[] = [];
    let baseNativeTot = 0, baseConvTot = 0; // capital base for the whole-asset % return
    if (A.sh > 1e-9) {
      const bN = A.sh * pPrev, bC = A.sh * pPrev * fxPrev;
      baseNativeTot += bN; baseConvTot += bC;
      segments.push(mkSeg('Held from start', A.sh, pPrev, `Dec ${year - 1}`, pEnd, `Dec ${year}`,
        A.sh * pPrev, A.sh * pEnd,
        A.sh * (pEnd - pPrev), A.sh * (pEnd * fxEnd - pPrev * fxPrev), bN, bC, fxPrev));
    }
    if (B.sh > 1e-9) {
      const bN = B.sh * pPrev, bC = B.sh * pPrev * fxPrev;
      baseNativeTot += bN; baseConvTot += bC;
      segments.push(mkSeg('Held from start · sold', B.sh, pPrev, `Dec ${year - 1}`, B.procN / B.sh, 'sold',
        B.sh * pPrev, B.procN,
        B.procN - B.sh * pPrev, B.procC - B.sh * pPrev * fxPrev, bN, bC, fxPrev));
    }
    if (C.sh > 1e-9) {
      const bN = C.costN, bC = C.costC;
      baseNativeTot += bN; baseConvTot += bC;
      segments.push(mkSeg(`Bought in ${year}`, C.sh, C.costN / C.sh, 'buy', pEnd, `Dec ${year}`,
        C.costN, C.sh * pEnd,
        C.sh * pEnd - C.costN, C.sh * pEnd * fxEnd - C.costC, bN, bC, C.costN > 0 ? C.costC / C.costN : fxEnd));
    }
    if (D.sh > 1e-9) {
      const bN = D.costN, bC = D.costC;
      baseNativeTot += bN; baseConvTot += bC;
      segments.push(mkSeg(`Bought & sold ${year}`, D.sh, D.costN / D.sh, 'buy', D.procN / D.sh, 'sold',
        D.costN, D.procN,
        D.procN - D.costN, D.procC - D.costC, bN, bC, D.costN > 0 ? D.costC / D.costN : fxEnd));
    }
    if (F.sh > 1e-9) {
      // Fees paid in units by shares held since 1 Jan: worth pPrev each then, gone now.
      // Their start value counts in the capital base, like any other share held on 1 Jan.
      const bN = F.sh * pPrev, bC = F.sh * pPrev * fxPrev;
      baseNativeTot += bN; baseConvTot += bC;
      segments.push(mkSeg('Fees paid in units', F.sh, pPrev, `Dec ${year - 1}`, null, 'fee',
        F.sh * pPrev, 0,
        -bN, -bC, bN, bC, fxPrev));
    }
    if (Math.abs(incN) > 0.005 || Math.abs(incC) > 0.005) {
      // Income has no capital base of its own (it's a yield on the holding), so
      // leave its % and value blank; value it locally at the start-of-year rate for FX.
      segments.push(mkSeg('Income (div/interest)', null, null, '', null, '', null, null, incN, incC, 0, 0, fxPrev));
    }

    if (segments.length === 0) continue;

    const totalNative = segments.reduce((s, x) => s + x.profitNative, 0);
    const totalConverted = segments.reduce((s, x) => s + x.profitConverted, 0);
    const totalFx = segments.reduce((s, x) => s + x.fxEffect, 0);
    const startValue = segments.reduce((s, x) => s + (x.startValue ?? 0), 0);
    const endValue = segments.reduce((s, x) => s + (x.endValue ?? 0), 0);
    const name = assetLookup.find(a => a.ticker === ticker)?.name || ticker;
    assets.push({
      ticker, name, nativeCurrency: native,
      totalNative, totalConverted, totalFx,
      retNative: Math.abs(baseNativeTot) > 1e-9 ? (totalNative / baseNativeTot) * 100 : null,
      retConverted: Math.abs(baseConvTot) > 1e-9 ? (totalConverted / baseConvTot) * 100 : null,
      startValue, endValue,
      segments,
    });
  }

  // Biggest contributor first (losers sink to the bottom).
  assets.sort((a, b) => b.totalConverted - a.totalConverted);

  const sumConverted = assets.reduce((s, a) => s + a.totalConverted, 0);

  // Value-consistent total profit in the selected currency — taken straight from the
  // shared per-year series, so it's identical to the "Contributions and Profit by Year"
  // chart's bar for this year. (profit = end value − start value − contributions; in PLN
  // that's exactly the Years-sheet profit.) This replaces the old "PLN profit ÷ average
  // rate" total, which mixed conversion methods and made "Other" implausible in non-PLN.
  const total = getYearlyValueSeries(currency).find(s => s.year === `${year}`)?.profit ?? 0;

  // Everything not itemised (unpriced/guarded assets, cash, fees, timing) = the residual.
  const other = total - sumConverted;

  return { assets, other, total };
};
