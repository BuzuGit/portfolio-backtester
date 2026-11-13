/*
  TREND FOLLOWING (the 10-month moving-average rule) vs BUY & HOLD

  The calculations behind the Trend Following tab, moved out of the main screen file so they can
  be tested on their own. Nothing here reads the screen: the price rows, the window and the two
  settings on the tab (cash rate, commission) are passed in.
*/
import type { AssetRow } from './fetchData';
// The ".ts" endings let Node run this file's tests directly (lib/trend.test.mjs)
import { yearsBetween, cagrPct, periodReturns, annualisedVolPct, sharpeRatio, drawdownsPct, maxDrawdownPct } from './stats.ts';

// ----------------------------------------
// DATA SHAPES
// ----------------------------------------

/** One month on the charts: Buy & Hold vs Trend Following performance. */
export interface TrendFollowingPoint {
  date: string;              // Date of the data point
  price: number;             // Raw asset price
  buyHoldValue: number;      // Growth of $1 for Buy & Hold strategy
  trendFollowingValue: number;  // Growth of $1 for Trend Following strategy
  sma10: number | null;      // 10-month Simple Moving Average
  signal: 'BUY' | 'SELL' | null;  // Current signal (BUY = invested, SELL = cash)
}

/** Drawdown data for both strategies. */
export interface TrendDrawdownPoint {
  date: string;
  buyHoldDrawdown: number;        // Buy & Hold drawdown percentage
  trendFollowingDrawdown: number; // Trend Following drawdown percentage
}

/** Signal change event (when we switch from BUY to SELL or vice versa). */
export interface SignalChange {
  date: string;
  newSignal: 'BUY' | 'SELL';
  price: number;         // Price at signal change
  value: number;         // Trend Following portfolio value at this point
}

/** Statistics for the Buy & Hold vs Trend Following comparison. */
export interface TrendStats {
  finalAmount: number;       // Final value of $1 invested
  cagr: number;              // Compound Annual Growth Rate % (plain total return under a year)
  totalReturn: number;       // Total return %
  stdDev: number;            // Annualized standard deviation %
  maxDrawdown: number;       // Maximum drawdown % (negative)
  currentDrawdown: number;   // Current drawdown % (negative or zero)
  sharpeRatio: number | null; // (CAGR - risk-free rate) / StdDev; null under a year
}

/** Monthly and yearly returns of both strategies, by year. */
export interface TrendMonthlyReturns {
  [year: string]: {
    buyHold: (number | null)[];         // 12 months of Buy & Hold returns
    trendFollowing: (number | null)[];  // 12 months of Trend Following returns
    buyHoldFY: number;                   // Full year Buy & Hold return
    trendFollowingFY: number;            // Full year Trend Following return
  };
}

/** Everything the Trend Following tab shows for one asset. */
export interface TrendAnalysis {
  chartData: TrendFollowingPoint[];
  drawdownData: TrendDrawdownPoint[];
  buyHoldStats: TrendStats;
  trendFollowingStats: TrendStats;
  signalChanges: SignalChange[];
  successRate: { rate: number; successful: number; total: number } | null;
}

// ----------------------------------------
// THE ANALYSIS
// ----------------------------------------

/**
 * Buy & Hold vs 10-month SMA Trend Following for a single asset.
 *
 * STRATEGY RULES:
 * 1. Calculate 10-month Simple Moving Average at each month-end
 * 2. If price > SMA → BUY signal (stay invested in asset)
 * 3. If price < SMA → SELL signal (exit to cash, earn monthly risk-free rate)
 * 4. On each signal change, apply commission: value *= (1 - commission)
 * 5. Analysis starts at month 10 (need 10 months for first SMA)
 *
 * @param rows - the price table
 * @param ticker - Asset ticker to analyze
 * @param start, end - the window (inclusive)
 * @param riskFreeRate - Annual risk-free rate (e.g., 0.02 for 2%)
 * @param commission - Commission per trade (e.g., 0.002 for 0.2%)
 * @returns Chart data, drawdown data, statistics, and signal changes; null without enough data
 */
export function trendFollowingAnalysis(
  rows: AssetRow[],
  ticker: string,
  start: string,
  end: string,
  riskFreeRate: number,
  commission: number,
): TrendAnalysis | null {
  // Filter data to the selected date range first
  const filteredData = rows.filter(row => row.date >= start && row.date <= end);

  if (filteredData.length < 12) return null;  // Need at least 12 months

  // Group by month and get last price of each month
  const monthlyPrices: { date: string; price: number }[] = [];
  let currentMonth = -1;
  let currentYear = -1;
  let lastValidRow: { date: string; price: number } | null = null;

  for (const row of filteredData) {
    const price = Number(row[ticker]);
    if (!price || price <= 0) continue;

    const rowDate = new Date(row.date);
    const rowMonth = rowDate.getMonth();
    const rowYear = rowDate.getFullYear();

    // If we moved to a new month, save the last valid row from previous month
    if ((rowMonth !== currentMonth || rowYear !== currentYear) && lastValidRow) {
      monthlyPrices.push(lastValidRow);
    }

    currentMonth = rowMonth;
    currentYear = rowYear;
    lastValidRow = { date: row.date, price };
  }

  // Don't forget the last month
  if (lastValidRow) {
    monthlyPrices.push(lastValidRow);
  }

  if (monthlyPrices.length < 10) return null;  // Need at least 10 months for first SMA

  // Calculate 10-month SMA and build chart data
  const chartData: TrendFollowingPoint[] = [];
  const signalChanges: SignalChange[] = [];

  // Monthly risk-free rate for cash periods
  const monthlyRiskFreeRate = Math.pow(1 + riskFreeRate, 1 / 12) - 1;

  // Start with $1 for both strategies
  let buyHoldValue = 1;
  let trendFollowingValue = 1;
  let previousSignal: 'BUY' | 'SELL' | null = null;
  let isInvested = false;  // Track if TF strategy is currently invested

  // Track first price for normalization (so SMA can be shown on Growth of $1 chart)
  let firstPrice: number | null = null;

  // Process each month starting from month 10 (index 9) when we have 10 months of history
  // Index 9 means we have months 0-9 (10 months) to calculate the first SMA
  for (let i = 9; i < monthlyPrices.length; i++) {
    const currentData = monthlyPrices[i];
    const previousData = monthlyPrices[i - 1];

    // Calculate 10-month SMA (average of last 10 months INCLUDING current)
    let smaSum = 0;
    for (let j = i - 9; j <= i; j++) {
      smaSum += monthlyPrices[j].price;
    }
    const sma10 = smaSum / 10;

    // Store first price for normalization
    if (firstPrice === null) {
      firstPrice = currentData.price;
    }

    // Determine signal based on current price vs SMA
    const signal: 'BUY' | 'SELL' = currentData.price > sma10 ? 'BUY' : 'SELL';

    // Calculate monthly return
    const monthlyReturn = (currentData.price - previousData.price) / previousData.price;

    if (i === 9) {
      // FIRST DATA POINT: Both strategies start at exactly $1
      // We determine initial position but don't apply any returns or commission yet
      // Commission is only applied on subsequent signal changes (actual trades)
      isInvested = signal === 'BUY';
      previousSignal = signal;
      signalChanges.push({
        date: currentData.date,
        newSignal: signal,
        price: currentData.price,
        value: 1  // Both start at $1
      });
    } else {
      // SUBSEQUENT DATA POINTS: Apply returns based on position held during this month

      // Buy & Hold always earns asset return
      buyHoldValue = buyHoldValue * (1 + monthlyReturn);

      // Trend Following earns based on position
      if (isInvested) {
        // We were invested during this month, earn asset return
        trendFollowingValue = trendFollowingValue * (1 + monthlyReturn);
      } else {
        // We were in cash during this month, earn risk-free rate
        trendFollowingValue = trendFollowingValue * (1 + monthlyRiskFreeRate);
      }

      // Check for signal change (determines position for NEXT month)
      if (signal !== previousSignal) {
        // Apply commission for signal change
        trendFollowingValue = trendFollowingValue * (1 - commission);

        signalChanges.push({
          date: currentData.date,
          newSignal: signal,
          price: currentData.price,
          value: buyHoldValue  // Position on Buy & Hold line
        });

        // Update position for next month
        isInvested = signal === 'BUY';
        previousSignal = signal;
      }
    }

    // Normalized SMA (so it can be shown on same scale as Growth of $1)
    const normalizedSma10 = sma10 / firstPrice;

    chartData.push({
      date: currentData.date,
      price: currentData.price,
      buyHoldValue,
      trendFollowingValue,
      sma10: normalizedSma10,  // Store normalized SMA for charting
      signal
    });
  }

  if (chartData.length === 0) return null;

  return {
    chartData,
    drawdownData: calculateTrendDrawdowns(chartData),
    buyHoldStats: calculateTrendStats(chartData.map(d => d.buyHoldValue), chartData.map(d => d.date), riskFreeRate),
    trendFollowingStats: calculateTrendStats(chartData.map(d => d.trendFollowingValue), chartData.map(d => d.date), riskFreeRate),
    signalChanges,
    successRate: calculateSuccessRate(signalChanges),
  };
}

// ----------------------------------------
// TABLES, DRAWDOWNS, STATISTICS
// ----------------------------------------

/**
 * Monthly and yearly returns for both strategies, from the analysis's chartData.
 *
 * @param chartData - Array of TrendFollowingPoint data with monthly values
 * @param startDate - The start date of the analysis (to filter out December start years)
 * @returns TrendMonthlyReturns object organized by year
 */
export const calculateTrendMonthlyReturns = (
  chartData: TrendFollowingPoint[],
  startDate: string
): TrendMonthlyReturns => {
  if (!chartData || chartData.length === 0) return {};

  // Group data points by year and month, tracking end-of-month values
  const monthlyData: {
    [year: number]: {
      buyHold: ({ endValue: number } | null)[];
      trendFollowing: ({ endValue: number } | null)[];
      buyHoldYearStart: number | null;
      buyHoldYearEnd: number | null;
      trendFollowingYearStart: number | null;
      trendFollowingYearEnd: number | null;
    };
  } = {};

  chartData.forEach(point => {
    const date = new Date(point.date);
    const year = date.getFullYear();
    const month = date.getMonth();

    if (!monthlyData[year]) {
      monthlyData[year] = {
        buyHold: Array(12).fill(null),
        trendFollowing: Array(12).fill(null),
        buyHoldYearStart: null,
        buyHoldYearEnd: null,
        trendFollowingYearStart: null,
        trendFollowingYearEnd: null
      };
    }

    // Track end-of-month values (last value of each month)
    monthlyData[year].buyHold[month] = { endValue: point.buyHoldValue };
    monthlyData[year].trendFollowing[month] = { endValue: point.trendFollowingValue };

    // Track year start and end values
    if (monthlyData[year].buyHoldYearStart === null) {
      monthlyData[year].buyHoldYearStart = point.buyHoldValue;
      monthlyData[year].trendFollowingYearStart = point.trendFollowingValue;
    }
    monthlyData[year].buyHoldYearEnd = point.buyHoldValue;
    monthlyData[year].trendFollowingYearEnd = point.trendFollowingValue;
  });

  // Calculate monthly returns
  const years = Object.keys(monthlyData).sort();
  const result: TrendMonthlyReturns = {};

  // Check if we should skip start year (December start)
  const startDateObj = new Date(startDate);
  const startMonth = startDateObj.getMonth();
  const startYear = startDateObj.getFullYear().toString();
  const skipStartYear = startMonth === 11; // December

  years.forEach((yearStr, yearIdx) => {
    // Skip December start year
    if (skipStartYear && yearStr === startYear) return;

    const year = parseInt(yearStr);
    const yearData = monthlyData[year];
    const buyHoldMonthly: (number | null)[] = Array(12).fill(null);
    const trendFollowingMonthly: (number | null)[] = Array(12).fill(null);

    // Get previous year's end values for calculating first month's return
    let prevBuyHoldEnd = yearIdx > 0 ? monthlyData[parseInt(years[yearIdx - 1])].buyHoldYearEnd : null;
    let prevTrendFollowingEnd = yearIdx > 0 ? monthlyData[parseInt(years[yearIdx - 1])].trendFollowingYearEnd : null;

    for (let month = 0; month < 12; month++) {
      // Buy & Hold monthly return
      if (yearData.buyHold[month]) {
        const endValue = yearData.buyHold[month]!.endValue;
        let startValue = prevBuyHoldEnd;

        // Look for previous month's end value within same year
        if (month > 0) {
          for (let m = month - 1; m >= 0; m--) {
            if (yearData.buyHold[m]) {
              startValue = yearData.buyHold[m]!.endValue;
              break;
            }
          }
        }

        if (startValue && startValue > 0) {
          buyHoldMonthly[month] = ((endValue - startValue) / startValue) * 100;
        }
        prevBuyHoldEnd = endValue;
      }

      // Trend Following monthly return
      if (yearData.trendFollowing[month]) {
        const endValue = yearData.trendFollowing[month]!.endValue;
        let startValue = prevTrendFollowingEnd;

        // Look for previous month's end value within same year
        if (month > 0) {
          for (let m = month - 1; m >= 0; m--) {
            if (yearData.trendFollowing[m]) {
              startValue = yearData.trendFollowing[m]!.endValue;
              break;
            }
          }
        }

        if (startValue && startValue > 0) {
          trendFollowingMonthly[month] = ((endValue - startValue) / startValue) * 100;
        }
        prevTrendFollowingEnd = endValue;
      }
    }

    // Calculate full-year returns
    const fyBuyHoldStart = yearIdx > 0
      ? monthlyData[parseInt(years[yearIdx - 1])].buyHoldYearEnd
      : yearData.buyHoldYearStart;
    const fyTrendFollowingStart = yearIdx > 0
      ? monthlyData[parseInt(years[yearIdx - 1])].trendFollowingYearEnd
      : yearData.trendFollowingYearStart;

    let buyHoldFY = 0;
    let trendFollowingFY = 0;

    if (fyBuyHoldStart && fyBuyHoldStart > 0 && yearData.buyHoldYearEnd) {
      buyHoldFY = ((yearData.buyHoldYearEnd - fyBuyHoldStart) / fyBuyHoldStart) * 100;
    }
    if (fyTrendFollowingStart && fyTrendFollowingStart > 0 && yearData.trendFollowingYearEnd) {
      trendFollowingFY = ((yearData.trendFollowingYearEnd - fyTrendFollowingStart) / fyTrendFollowingStart) * 100;
    }

    result[yearStr] = {
      buyHold: buyHoldMonthly,
      trendFollowing: trendFollowingMonthly,
      buyHoldFY,
      trendFollowingFY
    };
  });

  return result;
};

/**
 * Chart data for the Trend Following Annual Returns bar chart:
 * [{ year, "Buy & Hold": number, "Trend Following": number }], oldest first.
 */
export const getTrendAnnualReturnsChartData = (
  monthlyReturns: TrendMonthlyReturns
): Array<{ year: string; 'Buy & Hold': number; 'Trend Following': number }> => {
  return Object.keys(monthlyReturns)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map(year => ({
      year,
      'Buy & Hold': monthlyReturns[year].buyHoldFY,
      'Trend Following': monthlyReturns[year].trendFollowingFY
    }));
};

/**
 * Drawdowns for both strategies: how far each value is below its own peak so far, in %.
 */
export const calculateTrendDrawdowns = (chartData: TrendFollowingPoint[]): TrendDrawdownPoint[] => {
  let buyHoldPeak = 0;
  let trendFollowingPeak = 0;

  return chartData.map(point => {
    // Update peaks
    if (point.buyHoldValue > buyHoldPeak) {
      buyHoldPeak = point.buyHoldValue;
    }
    if (point.trendFollowingValue > trendFollowingPeak) {
      trendFollowingPeak = point.trendFollowingValue;
    }

    // Calculate drawdowns as negative percentages
    const buyHoldDrawdown = ((point.buyHoldValue - buyHoldPeak) / buyHoldPeak) * 100;
    const trendFollowingDrawdown = ((point.trendFollowingValue - trendFollowingPeak) / trendFollowingPeak) * 100;

    return {
      date: point.date,
      buyHoldDrawdown,
      trendFollowingDrawdown
    };
  });
};

/**
 * Statistics for one strategy's equity curve.
 *
 * @param equityCurve - Array of portfolio values over time
 * @param dates - Array of dates corresponding to equity values
 * @param riskFreeRate - Annual risk-free rate for Sharpe Ratio (0.02 = 2%)
 */
export const calculateTrendStats = (
  equityCurve: number[],
  dates: string[],
  riskFreeRate: number
): TrendStats => {
  if (equityCurve.length < 2) {
    return {
      finalAmount: 1,
      cagr: 0,
      totalReturn: 0,
      stdDev: 0,
      maxDrawdown: 0,
      currentDrawdown: 0,
      sharpeRatio: 0
    };
  }

  const startValue = equityCurve[0];
  const endValue = equityCurve[equityCurve.length - 1];

  // Total return
  const totalReturn = ((endValue - startValue) / startValue) * 100;

  // Years covered
  const years = yearsBetween(dates[0], dates[dates.length - 1]);

  // CAGR (lib/stats): under a year it is the plain total return
  const cagr = cagrPct(startValue, endValue, years);

  // Standard deviation of the monthly returns, annualised (× √12)
  const stdDev = annualisedVolPct(periodReturns(equityCurve), 12);

  // Drawdowns
  const drawdowns = drawdownsPct(equityCurve);
  const maxDrawdown = maxDrawdownPct(drawdowns);

  // Current drawdown
  const currentDrawdown = drawdowns[drawdowns.length - 1];

  // Sharpe Ratio: (CAGR - risk-free rate) / StdDev. This is the only Sharpe in the app that
  // subtracts a risk-free rate: the cash rate the strategy earns is an input on this tab.
  // null (a dash) under a year.
  const sharpe = sharpeRatio(cagr, stdDev, years, riskFreeRate * 100);

  return {
    finalAmount: endValue,
    cagr,
    totalReturn,
    stdDev,
    maxDrawdown,
    currentDrawdown,
    sharpeRatio: sharpe
  };
};

/**
 * Success rate of the trend signals.
 * A round-trip is a SELL at price X followed by a BUY at price Y; it succeeded if Y < X
 * (we bought back cheaper than we sold).
 */
export const calculateSuccessRate = (signalChanges: SignalChange[]): { rate: number; successful: number; total: number } | null => {
  if (signalChanges.length < 2) return null;

  let successful = 0;
  let total = 0;
  let lastSellPrice: number | null = null;

  for (const change of signalChanges) {
    if (change.newSignal === 'SELL') {
      lastSellPrice = change.price;
    } else if (change.newSignal === 'BUY' && lastSellPrice !== null) {
      // Completed round-trip
      total++;
      if (change.price < lastSellPrice) {
        // Bought back cheaper - success!
        successful++;
      }
      lastSellPrice = null;
    }
  }

  if (total === 0) return null;

  return {
    rate: (successful / total) * 100,
    successful,
    total
  };
};
