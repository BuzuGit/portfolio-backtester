/*
  CORRELATIONS

  How closely two series move together, from monthly returns. Used by the Backtest tab's
  correlation chart (two portfolios) and the Correlations tab's matrix (every pair of assets).
  Moved out of the main screen file so they can be tested on their own.
*/
import type { AssetRow } from './fetchData';
import type { ReturnPoint } from './backtest';
// The ".ts" ending lets Node run this file's tests directly (lib/correlation.test.mjs)
import { toYM, MONTH_ABBR } from './dates.ts';

/** A month's return for one series: "2024-02", its date, and the return as a decimal. */
export interface MonthReturn { ym: string; date: string; r: number }
/** Two series' returns for the same month. */
export interface PairedMonth { ym: string; date: string; a: number; b: number }

/**
 * One portfolio's monthly returns, oldest first, as plain decimals (0.031 = +3.1%).
 *
 * Deliberately NOT rounded. The returns bar chart rounds to one decimal place because
 * that is all a label can show, but rounding before a correlation throws away exactly
 * the small co-movements the statistic exists to measure.
 *
 * @param result - one backtested portfolio (its `returns` are month-end values)
 * @returns one entry per month that has a prior month to compare against
 */
export const getMonthlyReturnSeries = (result: { returns: ReturnPoint[] }): MonthReturn[] => {
  // Last value per calendar month, oldest first: the same normalisation the
  // periodic-returns chart does, so both are looking at identical months.
  const byMonth = new Map<string, { date: string; value: number }>();
  for (const p of result.returns) byMonth.set(toYM(new Date(p.date)), { date: p.date, value: p.value });
  const months = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const out: MonthReturn[] = [];
  for (let i = 1; i < months.length; i++) {
    const prev = months[i - 1][1].value;
    const curr = months[i][1].value;
    if (!(prev > 0)) continue;   // no sensible return out of a zero or negative base
    out.push({ ym: months[i][0], date: months[i][1].date, r: (curr - prev) / prev });
  }
  return out;
};

/**
 * Pearson correlation coefficient of two equal-length samples.
 *
 * In plain terms: it measures how reliably the two series move in the same direction,
 * on a scale from +1 (perfect lockstep) through 0 (no relationship) to -1 (perfect
 * mirror image). It says nothing about SIZE: a portfolio that moves 3x as hard as
 * another, but always on the same days, still correlates at +1.
 *
 * @returns the coefficient, or null when it is undefined rather than zero: too few
 *          months to mean anything, or one side being perfectly flat (a flat series
 *          has no variation to correlate, and the formula would divide by zero).
 */
export const pearsonCorrelation = (xs: number[], ys: number[]): number | null => {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) { sumX += xs[i]; sumY += ys[i]; }
  const meanX = sumX / n;
  const meanY = sumY / n;
  // Covariance on top, the two standard deviations on the bottom - all unscaled,
  // since the sample-size divisors cancel out of the ratio.
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (!(sxx > 0) || !(syy > 0)) return null;
  // Floating-point error can push a perfect correlation a hair past 1.0; clamp it
  // so the display never shows an impossible 1.01.
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
};

/**
 * The two portfolios' monthly returns lined up month by month.
 *
 * Joined BY MONTH rather than by position, so a portfolio that is missing a month
 * simply drops that month from the pair instead of silently shifting one series
 * against the other, which would produce a plausible-looking but meaningless number.
 */
export const getPairedMonthlyReturns = (
  resultA: { returns: ReturnPoint[] },
  resultB: { returns: ReturnPoint[] },
): PairedMonth[] => {
  const seriesA = getMonthlyReturnSeries(resultA);
  const byMonthB = new Map(getMonthlyReturnSeries(resultB).map(p => [p.ym, p.r]));
  const out: PairedMonth[] = [];
  for (const p of seriesA) {
    const b = byMonthB.get(p.ym);
    if (b === undefined) continue;
    out.push({ ym: p.ym, date: p.date, a: p.r, b });
  }
  return out;
};

/**
 * One point per month: the correlation of the two portfolios over the `windowMonths`
 * months ENDING that month. A rolling window, exactly like the rolling-CAGR bars,
 * except it is measuring co-movement rather than return.
 *
 * The window is stated in months rather than years because correlation regimes change
 * fast: a crisis can take two uncorrelated portfolios to +0.9 within a quarter.
 *
 * @param paired - output of getPairedMonthlyReturns, so the pairing is done once
 * @param windowMonths - look-back length; a window that runs off the front is skipped
 */
export const getRollingCorrelationData = (
  paired: PairedMonth[],
  windowMonths: number,
): { label: string; range: string; corr: number }[] => {
  const out: { label: string; range: string; corr: number }[] = [];
  if (paired.length < windowMonths) return out;
  const fmtMonth = (d: Date) => `${MONTH_ABBR[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  for (let end = windowMonths - 1; end < paired.length; end++) {
    const slice = paired.slice(end - windowMonths + 1, end + 1);
    const corr = pearsonCorrelation(slice.map(p => p.a), slice.map(p => p.b));
    if (corr === null) continue;
    out.push({
      // Labelled by the month the window ENDED, which is the usual convention: this
      // is the correlation "as of" that month, looking back.
      label: fmtMonth(new Date(paired[end].date)),
      range: `${fmtMonth(new Date(slice[0].date))} to ${fmtMonth(new Date(paired[end].date))}`,
      corr: parseFloat(corr.toFixed(3)),
    });
  }
  return out;
};

/**
 * The NxN correlation matrix of the given assets, from monthly returns.
 *
 * HOW IT WORKS:
 * 1. Slices the price rows to the last N years (12 rows a year, plus one for the first return)
 * 2. For each asset, monthly returns: (price this month / price last month) - 1
 * 3. For each pair, the Pearson correlation over the months where BOTH have a return:
 *    r = Σ((x - x̄)(y - ȳ)) / √(Σ(x - x̄)² × Σ(y - ȳ)²)
 *
 * Each pair uses pearsonCorrelation() above, with the matrix's own conventions: a perfectly flat
 * side shows 0 (not blank), and fewer than 3 shared months gives NaN, as the matrix always has. Each pair is worked out once
 * and mirrored: correlation is symmetric, and the arithmetic gives the identical number either way.
 *
 * @param rows - the price table
 * @param tickers - the assets to include, in display order
 * @param periodYears - Number of years of data to use (e.g., 3 = last 3 years)
 */
export const correlationMatrix = (rows: AssetRow[], tickers: string[], periodYears: number): { tickers: string[]; matrix: number[][] } => {
  if (rows.length < 2 || tickers.length === 0) return { tickers: rows.length < 2 ? [] : tickers, matrix: [] };

  // Slice data to the last N years (each year = 12 monthly data points)
  const monthsNeeded = periodYears * 12;
  const dataSlice = rows.slice(-monthsNeeded - 1); // Need one extra row to calculate first return

  // Monthly returns for each asset; NaN marks a month without two valid prices
  const returns: { [ticker: string]: number[] } = {};
  for (const ticker of tickers) {
    const monthlyReturns: number[] = [];
    for (let i = 1; i < dataSlice.length; i++) {
      const currentPrice = Number(dataSlice[i][ticker]);
      const previousPrice = Number(dataSlice[i - 1][ticker]);
      if (currentPrice > 0 && previousPrice > 0) {
        monthlyReturns.push((currentPrice / previousPrice) - 1);
      } else {
        monthlyReturns.push(NaN);
      }
    }
    returns[ticker] = monthlyReturns;
  }

  // Correlation of one pair, over the months where BOTH assets have valid data. The arithmetic is
  // pearsonCorrelation above; only the matrix's two conventions are added here:
  //   fewer than 3 shared months -> NaN (shown as a dash), a perfectly flat side -> 0.
  const pairCorrelation = (xReturns: number[], yReturns: number[]): number => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let k = 0; k < Math.min(xReturns.length, yReturns.length); k++) {
      if (!isNaN(xReturns[k]) && !isNaN(yReturns[k])) {
        xs.push(xReturns[k]);
        ys.push(yReturns[k]);
      }
    }
    if (xs.length < 3) return NaN;
    return pearsonCorrelation(xs, ys) ?? 0;
  };

  // Build the NxN matrix: 1 on the diagonal (an asset always moves with itself), each pair once
  const matrix: number[][] = tickers.map(() => new Array<number>(tickers.length));
  for (let i = 0; i < tickers.length; i++) {
    matrix[i][i] = 1.0;
    for (let j = i + 1; j < tickers.length; j++) {
      matrix[i][j] = matrix[j][i] = pairCorrelation(returns[tickers[i]], returns[tickers[j]]);
    }
  }

  return { tickers, matrix };
};
