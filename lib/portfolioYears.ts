/*
  THE PORTFOLIO'S YEARLY FIGURES, from the Years sheet, in any currency, and the bridge from a
  year's PLN profit to its profit in another currency. Tests in lib/portfolioYears.test.mjs.
*/
import type { YearsRow } from './fetchData';
// The ".ts" ending lets Node run this file's tests directly
import { yearsRowRate } from './yearsRates.ts';

/**
 * Per-year portfolio figures in `cur`, computed the VALUE-CONSISTENT way (shared by
 * both portfolio charts and the breakdown table's total, so they always agree):
 *   endValue     = year-end portfolio value        (endAmount ÷ period-END rate)
 *   startValue   = previous year-end value          (continuity)
 *   contributions= contributions ÷ AVERAGE rate     (a flow)
 *   profit       = (endValue − startValue) − contributions   ← the residual
 * Deriving profit as a residual (rather than PLN-profit ÷ average rate) is the only
 * self-consistent choice in a non-PLN currency, because portfolio VALUE converts at the
 * period-end rate — so growth (= contributions + profit) always equals the real change
 * in value. In PLN every rate is 1, so this reduces to the raw Years-sheet numbers.
 */
export const getYearlyValueSeries = (yearsData: YearsRow[], cur: string) => {
  const out: { year: string; endValue: number; startValue: number; contributions: number; profit: number }[] = [];
  let prevEndValue: number | null = null;
  for (const row of yearsData) {
    const er = yearsRowRate(row, cur, 'end'), ar = yearsRowRate(row, cur, 'avg');
    if (!er || !ar) { prevEndValue = null; continue; } // skip if FX missing for this currency
    const endValue = row.endAmount / er;
    const startValue = prevEndValue != null ? prevEndValue : row.startAmount / er; // 1st year: own start
    const contributions = row.contributions / ar;
    const profit = (endValue - startValue) - contributions;
    const year = row.date.includes('-') ? row.date.split('-')[0] : row.date;
    out.push({ year, endValue, startValue, contributions, profit });
    prevEndValue = endValue;
  }
  return out;
};

/**
 * FROM PLN PROFIT TO A YEAR'S PROFIT IN `cur` — the bridge under the Profit Breakdown table.
 *
 * The portfolio's figures are kept in PLN, so a year's profit in USD can look tiny next to the
 * PLN one. The gap is not a shrunken profit: the exchange rate moved the WHOLE portfolio's
 * value, not just the year's gain. In 2026 USD/PLN rose 13.7%, so the 1.28M USD held on 1 Jan
 * was worth 628k PLN more by the end without earning a dollar.
 *
 * Exactly, with S = start value, C = contributions (both PLN) and the xxxPLN rates s (start),
 * a (year average), e (end), using the same values and rates as getYearlyValueSeries:
 *   PLN profit = profit in cur × e  +  S/s × (e − s)  +  C/a × (e − a)
 * Every term divided by e gives the same bridge in `cur`. The very first year has no previous
 * close, and the series values its start at that year's END rate, so s = e there and the
 * revaluation of the starting holdings is 0 — anything else would stop the bridge adding up.
 *
 * All amounts are in PLN. Returns null for PLN itself or when a rate is missing.
 */
export const getProfitBridge = (yearsData: YearsRow[], year: number, cur: string) => {
  if (cur === 'PLN') return null;
  const yr = yearsData.find(r => r.date.startsWith(`${year}`));
  if (!yr) return null;
  const series = getYearlyValueSeries(yearsData, cur).find(s => s.year === `${year}`);
  if (!series) return null;
  const prevYr = yearsData.find(r => r.date.startsWith(`${year - 1}`));
  const e = yearsRowRate(yr, cur, 'end'), a = yearsRowRate(yr, cur, 'avg');
  // The series falls back to the year's own start (at the END rate) when last year can't be
  // converted, so the bridge does the same
  const prevE = prevYr ? yearsRowRate(prevYr, cur, 'end') : 0;
  const s = prevE || e;
  if (!e || !a) return null;
  const startPln = prevE && prevYr ? prevYr.endAmount : yr.startAmount;
  const profitHere = series.profit * e;                    // the profit in `cur`, in PLN
  const revalStart = (startPln / s) * (e - s);             // 1 Jan holdings at the new rate
  const revalContr = (yr.contributions / a) * (e - a);     // this year's contributions, likewise
  return {
    s, e, a,
    startHere: startPln / s,                               // the 1 Jan holdings, in `cur`
    profitHere, revalStart, revalContr,
    profitPln: profitHere + revalStart + revalContr,
  };
};
