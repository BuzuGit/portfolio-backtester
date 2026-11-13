/*
  ASSET STATISTICS FOR THE ANNUAL / BEST TO WORST / MONTHLY PAGES

  Plain calculations on the monthly price table, moved out of the main screen file word for word.
  Each one that reads prices takes the table as its first input (named `assetData`, as it was).
*/
import type { AssetRow } from './fetchData';
// The ".ts" ending lets Node run this file's tests directly (lib/assetStats.test.mjs)
import { cagrPct, periodReturns, annualisedVolPct, drawdownsPct, maxDrawdownPct, longestUnderwater } from './stats.ts';

// Annual return data for a single asset in a specific year
// Used in the Assets Annual Returns table
export interface AssetYearReturn {
  return: number;          // The annual return as a percentage
  startDate: string;       // First trading date of the year
  startPrice: number;      // Price on the first trading date
  endDate: string;         // Last trading date of the year
  endPrice: number;        // Price on the last trading date
}

// All annual returns for all assets, organized by ticker then year
export interface AssetsAnnualReturns {
  [ticker: string]: {
    [year: number]: AssetYearReturn;
  };
}

/**
 * Gets all unique years that have data for any asset in the lookup table.
 * Returns years sorted from oldest to newest (e.g., 2016, 2017, ..., 2026)
 */
export const getYearsWithData = (annualReturns: AssetsAnnualReturns): number[] => {
  const yearsSet = new Set<number>();
  Object.values(annualReturns).forEach(assetYears => {
    Object.keys(assetYears).forEach(year => yearsSet.add(parseInt(year)));
  });
  return Array.from(yearsSet).sort((a, b) => a - b);  // Oldest to newest
};

/**
 * Gets the first and last available price data for a ticker.
 * Used to calculate Period and CAGR.
 */
export const getAssetPriceRange = (assetData: AssetRow[], ticker: string): {
  firstDate: string;
  firstPrice: number;
  lastDate: string;
  lastPrice: number;
  months: number;
} | null => {
  if (!assetData) return null;

  // Find first row with valid price for this ticker
  let firstRow = null;
  for (const row of assetData) {
    const price = Number(row[ticker]);
    if (price && price > 0) {
      firstRow = row;
      break;
    }
  }

  // Find last row with valid price for this ticker (search from end)
  let lastRow = null;
  for (let i = assetData.length - 1; i >= 0; i--) {
    const price = Number(assetData[i][ticker]);
    if (price && price > 0) {
      lastRow = assetData[i];
      break;
    }
  }

  if (!firstRow || !lastRow) return null;

  const firstDate = new Date(firstRow.date);
  const lastDate = new Date(lastRow.date);

  // Calculate months between dates
  const months = (lastDate.getFullYear() - firstDate.getFullYear()) * 12
               + (lastDate.getMonth() - firstDate.getMonth());

  return {
    firstDate: firstRow.date,
    firstPrice: Number(firstRow[ticker]),
    lastDate: lastRow.date,
    lastPrice: Number(lastRow[ticker]),
    months
  };
};

/**
 * Calculates CAGR (Compound Annual Growth Rate).
 * Formula: ((EndValue / StartValue) ^ (1/years)) - 1
 * Where years = months / 12
 */
export const calculateCAGR = (startPrice: number, endPrice: number, months: number): number => {
  if (startPrice <= 0 || months <= 0) return 0;
  // lib/stats: under 12 months this is the plain total return, not annualised
  return cagrPct(startPrice, endPrice, months / 12);
};

/**
 * Calculates volatility (annualized standard deviation) and max drawdown for a single asset.
 * Uses the same methodology as the Backtest Statistics section:
 * - Volatility = standard deviation of monthly returns * sqrt(12) * 100 (annualized)
 * - Max Drawdown = worst peak-to-trough decline in the price series
 * - Longest DD Duration = consecutive months underwater (below peak)
 *
 * @param ticker - Asset ticker symbol
 * @param startDate - Optional start date for filtered range (inclusive)
 * @param endDate - Optional end date for filtered range (inclusive)
 */
export const calculateAssetStats = (assetData: AssetRow[], ticker: string, startDate?: string, endDate?: string): {
  volatility: number;
  maxDrawdown: number;
  longestDDMonths: number;
} | null => {
  if (!assetData || assetData.length === 0) return null;

  // Get monthly prices for this ticker within the date range
  const prices: number[] = [];
  for (const row of assetData) {
    if (startDate && row.date < startDate) continue;
    if (endDate && row.date > endDate) continue;
    const price = Number(row[ticker]);
    if (price && price > 0) {
      prices.push(price);
    }
  }

  // Need at least 2 data points to calculate returns
  if (prices.length < 2) return null;

  // Volatility: annualised standard deviation of the monthly returns (lib/stats, as Backtest)
  const volatility = annualisedVolPct(periodReturns(prices), 12);

  // Max drawdown (worst peak-to-trough fall) and longest run of months below a previous peak
  const drawdowns = drawdownsPct(prices);
  return { volatility, maxDrawdown: maxDrawdownPct(drawdowns), longestDDMonths: longestUnderwater(drawdowns) };
};

/**
 * Calculates current drawdown for an asset (how far current price is from ATH).
 * Returns drawdown percentage (negative or zero) and details for tooltip.
 */
export const getAssetCurrentDrawdown = (assetData: AssetRow[], ticker: string): {
  drawdown: number;
  currentPrice: number;
  currentDate: string;
  athPrice: number;
  athDate: string;
  isAtATH: boolean;
} | null => {
  if (!assetData || assetData.length === 0) return null;

  // Find all valid prices for this ticker
  let maxPrice = 0;
  let maxDate = '';
  let currentPrice = 0;
  let currentDate = '';

  for (const row of assetData) {
    const price = Number(row[ticker]);
    if (price && price > 0) {
      // Track ATH
      if (price > maxPrice) {
        maxPrice = price;
        maxDate = row.date;
      }
      // Track current (last valid price)
      currentPrice = price;
      currentDate = row.date;
    }
  }

  if (maxPrice === 0 || currentPrice === 0) return null;

  const drawdown = ((currentPrice - maxPrice) / maxPrice) * 100;
  const isAtATH = Math.abs(drawdown) < 0.01;  // Consider ATH if within 0.01%

  return {
    drawdown,
    currentPrice,
    currentDate,
    athPrice: maxPrice,
    athDate: maxDate,
    isAtATH
  };
};
