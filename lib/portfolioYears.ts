/*
  THE PORTFOLIO'S YEARLY FIGURES, from the Years sheet, in any currency.
  Moved word for word from the main screen file (the sheet is now passed in); tests in
  lib/portfolioYears.test.mjs.
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
