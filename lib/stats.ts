/*
  SHARED RETURN & RISK MATHS

  Every tab that prints a CAGR, a volatility, a Sharpe ratio or a drawdown gets it from here, so the
  same word always means the same number. Before this file existed the formulas were copied by hand
  into about eight places, and the copies had drifted apart: some annualised a few months of data
  into a misleading "per year" figure, others didn't.

  The rules this file enforces:
  - Never annualise under a year. A 3% gain over two months is NOT "19% a year". When the period
    is shorter than a year, cagrPct() returns the plain total return instead.
  - Sharpe needs an annualised return, so under a year it is null (shown as a dash).
  - Sharpe assumes a 0% risk-free rate unless a caller passes one (only Trend Following does,
    because its cash rate is an input on that tab).

  Kept free of imports and of TypeScript-only features (no enums), so Node can run the tests in
  stats.test.mjs directly, with no build step.
*/

/** Milliseconds in an average year (365.25 days, so leap years even out). */
export const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Years between two ISO dates ("2020-01-31"), as a fraction. */
export const yearsBetween = (startIso: string, endIso: string): number =>
  (new Date(endIso).getTime() - new Date(startIso).getTime()) / MS_PER_YEAR;

/**
 * The shortest period we annualise: 360 days, not a strict 365.25.
 * Why the slack: a "1Y" window is usually 365 days (0.9993 years by the 365.25 yardstick), and
 * month-end prices can land on the last trading day, a few days short of the calendar month-end.
 * A strict ">= 1" would wrongly treat those genuine one-year periods as "under a year".
 */
export const MIN_ANNUALISE_YEARS = 360 / 365.25;

/** True when a period is long enough to be expressed "per year". */
export const isAnnualisable = (years: number): boolean => years >= MIN_ANNUALISE_YEARS;

/** Simple percentage change from start to end: 100 → 112 gives 12. */
export const totalReturnPct = (start: number, end: number): number => ((end - start) / start) * 100;

/**
 * Compound annual growth rate, in percent.
 * Formula: (end / start) ^ (1 / years) - 1.
 * Under a year it returns the plain total return instead (see the rules at the top).
 */
export const cagrPct = (start: number, end: number, years: number): number =>
  isAnnualisable(years) ? (Math.pow(end / start, 1 / years) - 1) * 100 : totalReturnPct(start, end);

/**
 * Period-to-period returns of a value series: [100, 110, 99] gives [0.10, -0.10].
 * A step that starts from zero or below is skipped: dividing by zero would poison every statistic
 * built on top (this only happens to a leveraged backtest that was wiped out).
 */
export const periodReturns = (values: number[]): number[] => {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0) out.push((values[i] - values[i - 1]) / values[i - 1]);
  }
  return out;
};

/**
 * Annualised volatility in percent: the standard deviation of the period returns, scaled up by the
 * square root of how many periods make a year (12 for monthly data, 252 for trading days).
 * Uses the population standard deviation (divide by n), as the app always has.
 */
export const annualisedVolPct = (returns: number[], periodsPerYear: number): number => {
  if (returns.length === 0) return 0;
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear) * 100;
};

/**
 * Sharpe ratio: how much return you got per unit of volatility.
 * Formula: (CAGR - risk-free rate) / volatility, all in percent.
 * - null under a year: the return isn't annualised, so dividing it by an annual volatility would
 *   mix two different time scales.
 * - 0 when there was no volatility at all (nothing to divide by).
 */
export const sharpeRatio = (cagr: number, vol: number, years: number, riskFreePct = 0): number | null => {
  if (!isAnnualisable(years)) return null;
  return vol > 0 ? (cagr - riskFreePct) / vol : 0;
};

/**
 * The drawdown at each point in percent (0 at a new high, negative below it), measured against the
 * highest value seen so far. [100, 120, 90, 130] gives [0, 0, -25, 0].
 */
export const drawdownsPct = (values: number[]): number[] => {
  let peak = -Infinity;
  return values.map(v => {
    if (v > peak) peak = v;
    return ((v - peak) / peak) * 100;
  });
};

/** The deepest drawdown in percent (0 or negative). */
export const maxDrawdownPct = (drawdowns: number[]): number => drawdowns.reduce((min, d) => (d < min ? d : min), 0);

/** The longest run of consecutive points below a previous high (an unfinished run counts too). */
export const longestUnderwater = (drawdowns: number[]): number => {
  let longest = 0;
  let current = 0;
  for (const d of drawdowns) {
    current = d < 0 ? current + 1 : 0;
    if (current > longest) longest = current;
  }
  return longest;
};
