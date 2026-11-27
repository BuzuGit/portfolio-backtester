/*
  PROFIT BREAKDOWN BY ASSET, FOR ONE CALENDAR YEAR

  The Portfolio tab's "Profit Breakdown by Asset" table: one year's portfolio profit split into
  each asset's held / bought / sold segments plus income, reconciled to the year's total through
  an "Other" line. Moved word for word from the main screen file; everything it reads from the
  app's data comes in as one bundle (BreakdownInputs). Tests in lib/profitBreakdown.test.mjs.
*/
// The ".ts" endings let Node run this file's tests directly
import { FLOW_PURCHASE, heldQty, unitFeeQty, type AssetLookup, type AssetRow, type ClosedPositionRow, type DailyNavRow, type LedgerRow, type TransactionRow, type YearsRow } from './fetchData.ts';
import type { CashAccountBalance } from './cash.ts';
import { getConversionRate } from './backtest.ts';
import { toYM } from './dates.ts';
import { getYearlyValueSeries as yearlyValueSeries } from './portfolioYears.ts';
import { yearsRowRate } from './yearsRates.ts';

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
  // "Other" explained: the named pieces it is made of, in the selected currency. They always
  // add up to `other` (to within 0.5), because the last piece ("Unexplained") is whatever is
  // left; it is omitted when that rounds to nothing.
  otherParts: OtherPart[];
  total: number;
};

/** One named piece of the "Other" line. */
export interface OtherPart {
  label: string;    // e.g. "Cash (USD)"
  detail: string;   // what is inside it, e.g. the accounts or holdings
  amount: number;   // profit in the selected currency
  fx: number;       // the part of `amount` that came from exchange rates moving (0 if none)
}

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
  // Optional, used only to explain "Other" (without them it stays one "Unexplained" line):
  cashAccounts?: CashAccountBalance[];   // every cash account's statement (lib/cash.ts)
  ledgerRows?: LedgerRow[];              // ledger buys (incl. Inflow buys), sales, dividends, interest
  dailyData?: DailyNavRow[];             // the Daily sheet, for its net worth on each day
}

/*
  SRS VALUATION. The Daily sheet (and so the yearly totals) counts everything held in the
  SRS accounts at 73% of its market value: what would be left after the 27% tax and penalty
  of taking it out early. The ledger shows it in the SRS contributions: 35,700 goes in, of
  which 9,639 (27%) is booked as arriving from "Other" because net worth never counts it.
  The breakdown values holdings at 100%, so the SRS share of each piece is scaled to match.
  Anything bought with money from an account whose name contains "SRS" counts as SRS.
*/
export const SRS_VALUE_FACTOR = 0.73;
const isSrs = (account: string | undefined): boolean => !!account && /SRS/i.test(account);

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
    return { assets: [], other: 0, otherParts: [], total: 0 };
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

  // Lots the scale guard below keeps out of the asset rows although they were held all year.
  // The guard exists because their recorded purchase price is on a different scale from the
  // price column (the flat: bought at 375,000 gross, priced as net equity, 583,057 today), so
  // the purchase price can't be the start of a segment. A lot held all year doesn't need it:
  // the price column at the two year ends values it. "Other" lists them under their own name.
  const guardedHeld: { ticker: string; qty: number; start: number; end: number }[] = [];

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

    // Which price column to mark this asset with. A "TR" column (CFATR, CLRTR...) is a
    // TOTAL-RETURN series: its price change already contains the dividends. This table
    // also adds the dividends actually received as their own "Income" line, so marking
    // with the TR price counted them twice (29k PLN on CFATR + CLRTR in 2026). When the
    // plain-price twin exists at both year ends (CFATR -> CFA), mark with that instead,
    // so price change + cash dividends = the total return, each counted once.
    const plainCol = ticker.endsWith('TR') ? ticker.slice(0, -2) : '';
    const priceCol = plainCol
      && prevYearEndRow && Number(prevYearEndRow[plainCol]) > 0
      && thisYearEndRow && Number(thisYearEndRow[plainCol]) > 0
      ? plainCol : ticker;

    // Native prices + FX at the two year boundaries.
    const pPrev = prevYearEndRow ? Number(prevYearEndRow[priceCol]) || 0 : 0; // 31 Dec Y−1
    const pEnd = thisYearEndRow ? Number(thisYearEndRow[priceCol]) || 0 : 0;  // 31 Dec Y / latest
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
      if (!consistent(perShare, toYM(buyD))) {          // guarded → Other
        // Held all year, it is still valued by the feed at both ends; "Other" names it (below)
        if (buyYear < year) guardedHeld.push({ ticker, qty: heldQty(lot, yEndIso), start: pPrev * fxPrev, end: pEnd * fxEnd });
        continue;
      }
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
      if (!ok && buyYear < year && sellYear > year) {
        guardedHeld.push({ ticker, qty: c.sharesSold, start: pPrev * fxPrev, end: pEnd * fxEnd });
      }

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

  // ------------------------------------------------------------------
  // "OTHER", EXPLAINED — the named pieces the residual is made of
  // ------------------------------------------------------------------
  // Each piece is worked out the same way as an asset: what it was worth at the end, less
  // what it was worth at the start, less the money that moved in or out of it during the
  // year (each movement converted at its own month's rate, exactly as purchases are above,
  // so a transfer from cash into an itemised asset cancels out between the two).
  const parts: OtherPart[] = [];
  const yStartIso = `${year - 1}-12-31`, yEndIso = `${year}-12-31`;
  const rateAt = (row: AssetRow | null, native: string): number =>
    row ? getConversionRate(row, native, currency) : 1;
  const rateInMonth = (date: string, native: string): number =>
    rateAt(rowForYM(date.slice(0, 7)) || thisYearEndRow || prevYearEndRow, native);
  // Adds amounts into a group of parts keyed by label (one "Cash (USD)" line, not one per account)
  const groups = new Map<string, OtherPart & { names: Map<string, number> }>();
  const addTo = (label: string, name: string, amount: number, fx: number) => {
    let g = groups.get(label);
    if (!g) { g = { label, detail: '', amount: 0, fx: 0, names: new Map() }; groups.set(label, g); }
    g.amount += amount; g.fx += fx;
    g.names.set(name, (g.names.get(name) ?? 0) + amount);
  };

  // --- 1. Cash: exchange-rate gains on foreign cash, bank interest, fees ---
  // Bank interest and cash fees are the cash line's own profit. Everything else moving
  // through a cash account (deposits, purchases, sales, dividends, bond coupons) is money
  // passing to or from somewhere else, already counted there.
  for (const acct of inputs.cashAccounts ?? []) {
    const native = acct.currency;
    let b0 = 0, b1 = 0, flowsC = 0, ownN = 0, touched = false;
    for (const m of acct.movements) {
      if (m.date <= yStartIso) { b0 = m.balance; b1 = m.balance; continue; }
      if (m.date > yEndIso) break;
      touched = true;
      const signed = m.direction === 'in' ? m.amount : -m.amount;
      b1 += signed;
      const ownProfit = (m.flow === 'Interest' && (m.asset === 'Cash' || !m.asset))
        || ((m.flow === 'Fees' || m.flow === 'Commision') && (m.asset === 'Cash' || !m.asset));
      if (ownProfit) ownN += signed;
      else flowsC += signed * rateInMonth(m.date, native);
    }
    if (!touched && Math.abs(b0) < 0.5) continue;
    const k = isSrs(acct.account) ? SRS_VALUE_FACTOR : 1;
    const pnl = (b1 * rateAt(thisYearEndRow, native) - b0 * rateAt(prevYearEndRow, native) - flowsC) * k;
    // The FX slice: total less the interest/fees valued at the start-of-year rate
    const fx = pnl - ownN * rateAt(prevYearEndRow, native) * k;
    if (Math.abs(pnl) >= 0.5) addTo(`Cash (${native})`, acct.account, pnl, fx);
  }

  // --- 2. Holdings the table could not itemise (not in the Lookup tab or not priced) ---
  // With no market price they are valued at what was put in (less what came back out), which
  // is exact for bonds held at par (Singapore Savings Bonds) and leaves only a fund's own
  // price growth unaccounted for. Their coupons and dividends count here. As soon as a
  // holding gets a Lookup row and a price column it becomes an asset row of its own above,
  // and drops out of this line automatically (it is skipped once itemised).
  // Skipped: holdings with an asset row above, and holdings already valued from their price
  // column in part 3 (the flat, in a year with no rent row and so no asset row). Valuing
  // those again here at cost counted the flat's currency move twice in USD/SGD views.
  const itemised = new Set([...assets.map(a => a.ticker), ...guardedHeld.map(g => g.ticker)]);
  const byAsset = new Map<string, LedgerRow[]>();
  for (const r of inputs.ledgerRows ?? []) {
    if (!r.asset || r.asset === 'Cash') continue;
    const list = byAsset.get(r.asset);
    if (list) list.push(r); else byAsset.set(r.asset, [r]);
  }
  for (const [assetName, rows] of Array.from(byAsset.entries())) {
    if (rows.some(r => r.ticker && itemised.has(r.ticker))) continue;  // already its own row
    const native = rows[0].currency;
    // Some holdings were acquired through "Inflow" rows (the UBS employee share plan), which
    // are purchases in all but name — the same rule lib/positions.ts uses
    const isBuy = (r: LedgerRow) => r.flow === 'Purchase of Asset' || (r.flow === 'Inflow' && r.amount > 0);
    // Units and money put in up to a date; worth nothing once every unit has been sold
    const valueAt = (iso: string): number => {
      let qty = 0, maxQty = 0, net = 0;
      for (const r of rows) {
        if (r.date > iso) continue;
        if (isBuy(r)) { qty += r.qty; net += r.amount; }
        else if (r.flow === 'Proceeds from Sale') { qty -= r.qty; net -= r.amount; }
        maxQty = Math.max(maxQty, qty);
      }
      return qty > Math.max(1e-6, maxQty * 1e-3) ? Math.max(0, net) : 0;
    };
    let flowsN = 0, flowsC = 0, incN = 0, incC = 0;
    for (const r of rows) {
      if (r.date <= yStartIso || r.date > yEndIso) continue;
      const rate = rateInMonth(r.date, native);
      if (isBuy(r)) { flowsN += r.amount; flowsC += r.amount * rate; }
      else if (r.flow === 'Proceeds from Sale') { flowsN -= r.amount; flowsC -= r.amount * rate; }
      else if (r.flow === 'Dividend' || r.flow === 'Interest') { incN += r.amount; incC += r.amount * rate; }
    }
    const v0 = valueAt(yStartIso), v1 = valueAt(yEndIso);
    if (v0 === 0 && v1 === 0 && flowsN === 0 && incN === 0) continue;
    const k = rows.some(r => isBuy(r) && isSrs(r.from)) ? SRS_VALUE_FACTOR : 1;
    const pnl = (v1 * rateAt(thisYearEndRow, native) - v0 * rateAt(prevYearEndRow, native) - flowsC + incC) * k;
    const fx = pnl - (v1 - v0 - flowsN + incN) * rateAt(prevYearEndRow, native) * k;
    if (Math.abs(pnl) >= 0.5) addTo(`Holdings not in the price feed (${native})`, assetName, pnl, fx);
  }

  // --- 3. Lots held all year that the scale guard kept out of the asset rows ---
  for (const g of guardedHeld) {
    if (!(g.start > 0 && g.end > 0)) continue;   // no price at one of the ends: can't value it
    const name = assetLookup.find(a => a.ticker === g.ticker)?.name || g.ticker;
    const pnl = g.qty * (g.end - g.start);
    if (Math.abs(pnl) >= 0.5) addTo('Held all year (no usable buy price)', `${name} (${g.ticker})`, pnl, 0);
  }

  // --- 4. SRS haircut on the asset rows above ---
  // An asset row values SRS shares at 100%; net worth counts them at 73%. So 27% of an SRS
  // asset's profit never reached the year's total. An asset counts as SRS when every
  // purchase of it was paid from an SRS account.
  const srsTickers: string[] = [];
  let srsProfit = 0, srsFx = 0;
  for (const a of assets) {
    const buys = transactionData.filter(t => t.ticker === a.ticker && t.flow === FLOW_PURCHASE);
    if (buys.length > 0 && buys.every(t => isSrs(t.fundedFrom) || isSrs(t.account))) {
      srsTickers.push(a.ticker); srsProfit += a.totalConverted; srsFx += a.totalFx;
    }
  }
  if (Math.abs(srsProfit) >= 0.5) {
    const k = SRS_VALUE_FACTOR - 1;
    parts.push({ label: `SRS valued at ${Math.round(SRS_VALUE_FACTOR * 100)}%`, detail: srsTickers.join(', '), amount: srsProfit * k, fx: srsFx * k });
  }

  // --- 5. Years sheet vs Daily sheet ---
  // The total comes from the Years sheet; this table's assets are valued like the Daily
  // sheet. If the Years sheet's figure for either year end differs from the Daily sheet's
  // net worth on that day, the difference lands in the total as profit (or loss) that no
  // holding made. In 2026 the Years start was 20,313 PLN below the Daily 31 Dec 2025.
  const daily = inputs.dailyData ?? [];
  const nwOn = (iso: string): number => {
    // The Daily row for that day, or the closest one within a week before it
    let best: DailyNavRow | null = null;
    for (const d of daily) if (d.date <= iso && (d.nwPln ?? 0) > 0) best = d;
    if (!best) return 0;
    return (new Date(iso).getTime() - new Date(best.date).getTime()) / 86400000 <= 7 ? best.nwPln ?? 0 : 0;
  };
  const yrRow = yearsData.find(r => r.date.startsWith(`${year}`));
  const prevYrRow = yearsData.find(r => r.date.startsWith(`${year - 1}`));
  if (yrRow && prevYrRow && daily.length > 0) {
    const toCur = (row: YearsRow) => yearsRowRate(row, currency, 'end');
    const startDaily = nwOn(prevYrRow.date.includes('-') ? prevYrRow.date : `${year - 1}-12-31`);
    const endDaily = nwOn(yrRow.date.includes('-') ? yrRow.date : yEndIso);
    const rs = toCur(prevYrRow), re = toCur(yrRow);
    if (startDaily > 0 && endDaily > 0 && rs && re) {
      const startGap = startDaily - prevYrRow.endAmount;   // Daily above Years = profit overstated
      const endGap = yrRow.endAmount - endDaily;           // Years above Daily = profit overstated
      const amount = startGap / rs + endGap / re;
      if (Math.abs(amount) >= 0.5) {
        const f = (v: number) => Math.round(v).toLocaleString('en-US');
        const bits: string[] = [];
        if (Math.abs(startGap) >= 0.5) bits.push(`start ${f(prevYrRow.endAmount)} vs Daily ${f(startDaily)} PLN`);
        if (Math.abs(endGap) >= 0.5) bits.push(`end ${f(yrRow.endAmount)} vs Daily ${f(endDaily)} PLN`);
        parts.push({ label: 'Years sheet differs from Daily sheet', detail: bits.join('; '), amount, fx: 0 });
      }
    }
  }

  // Groups → parts, biggest first, each listing what is inside it (largest names first)
  const grouped = Array.from(groups.values()).map(g => ({
    label: g.label,
    detail: Array.from(g.names.entries()).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).map(([n]) => n).join(', '),
    amount: g.amount, fx: g.fx,
  }));
  const otherParts: OtherPart[] = [...grouped, ...parts].sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount));
  // Whatever the pieces don't explain: contributions converted at slightly different rates,
  // valuation differences between the Daily sheet and the price feed, a fund's own growth
  // while it has no price column. Always last, so the pieces add up to "Other" exactly.
  // Left out when it rounds to nothing, so a fully explained year shows no "Unexplained 0" line.
  const explained = otherParts.reduce((s, p) => s + p.amount, 0);
  if (Math.abs(other - explained) >= 0.5) {
    otherParts.push({ label: 'Unexplained', detail: 'timing, rounding, valuation differences', amount: other - explained, fx: 0 });
  }

  return { assets, other, otherParts, total };
};
