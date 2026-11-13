/*
  FX RATES ON THE YEARS SHEET

  The Portfolio tab converts its yearly values and flows with the xxxPLN rates stored on each
  Years-sheet row. Moved word for word from the one big PortfolioBacktester.tsx.
*/
import type { YearsRow } from './fetchData';

// Which zloty pair to show under the "Contributions and Profit by Year" chart for each
// setting of the currency selector. It is simply "the selected currency's own xxxPLN
// pair" — except PLN, which has no pair of its own (PLNPLN is always 1.00), so the
// dollar is used there as the reference currency instead.
export const FX_ROW_BASE: { [key: string]: string } = {
  PLN: 'USD', USD: 'USD', EUR: 'EUR', CHF: 'CHF', SGD: 'SGD'
};

/**
 * The xxxPLN FX rate for `currency` stored on a Years-sheet row.
 * `which` picks the period-END snapshot (right for portfolio VALUES) or the
 * yearly AVERAGE (right for FLOWS like contributions). Returns 1 for PLN (the
 * base currency) and 0 if the rate is missing (callers guard on that).
 * Extracted so the charts and the breakdown table all convert the same way.
 */
export const yearsRowRate = (row: YearsRow, currency: string, which: 'end' | 'avg'): number => {
  if (currency === 'PLN') return 1;
  const map: { [k: string]: number } = which === 'end'
    ? { USD: row.endUsdPln, EUR: row.endEurPln, CHF: row.endChfPln, SGD: row.endSgdPln }
    : { USD: row.avgUsdPln, EUR: row.avgEurPln, CHF: row.avgChfPln, SGD: row.avgSgdPln };
  return map[currency] || 0;
};

/**
 * The OPENING xxxPLN rate for `currency` on a Years-sheet row (the "xxx Start
 * Period" columns). Only needed for the very first year in the data — every later
 * year uses the previous year's closing rate, so that one year's move isn't
 * measured against a different kind of snapshot.
 * Same contract as yearsRowRate above: 1 for PLN, 0 if the rate is missing.
 */
export const yearsRowStartRate = (row: YearsRow, currency: string): number => {
  if (currency === 'PLN') return 1;
  const map: { [k: string]: number } = {
    USD: row.startUsdPln, EUR: row.startEurPln, CHF: row.startChfPln, SGD: row.startSgdPln
  };
  return map[currency] || 0;
};
