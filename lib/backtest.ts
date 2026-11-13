/*
  THE BACKTEST ENGINE

  Everything the Backtest tab calculates, moved out of the main screen file so it can be tested on
  its own and reused (the Monthly tab's "vs market" rows run this same engine):

  - simulatePortfolio   month by month: shares held, prices in the portfolio's currency, weights,
                        rebalancing, financing costs on leveraged legs, and the liquidation guard
  - portfolioReturns    the value line and drawdown the charts draw, with optional inflation adjustment
  - calculateStatistics the Return / CAGR / Vol / Sharpe / drawdown row of the statistics table
  - calculateMonthlyReturns  the calendar table of monthly and full-year returns
  - calculateWithdrawalReturns / getWithdrawalDetails  the "4% rule" withdrawal simulation

  The screen used to hold two copies of the engine: one for the chart and a line-by-line mirror
  for the Rebalancing table, with comments asking whoever edited one to edit the other. Now both
  come from simulatePortfolio, so they cannot drift apart.

  Nothing here reads the screen's state. Whatever the engine needs (the window, how often to
  rebalance, the starting capital, each asset's currency) is passed in as BacktestSettings.
*/
import type { AssetRow } from './fetchData';
// The ".ts" ending lets Node run this file's tests directly (lib/backtest.test.mjs)
import { yearsBetween, cagrPct, periodReturns, annualisedVolPct, sharpeRatio, longestUnderwater } from './stats.ts';

// ----------------------------------------
// DATA SHAPES
// ----------------------------------------

/** One asset in a portfolio (e.g. "SPY at 60% weight"). */
export interface PortfolioAsset {
  asset: string;   // Asset name (e.g., "SPY", "BND")
  weight: number;  // Percentage weight (e.g., 60 for 60%). NEGATIVE = a short position
                   // (e.g., -100 means you sold 100% of capital worth of this asset short,
                   // which is how you finance leverage: 200% CSPX + -100% IB01).
  costPct?: number; // Optional annual carry adjustment for THIS leg, as a % of the leg's
                    // absolute notional. Signed: NEGATIVE = a cost you pay, POSITIVE = income
                    // you receive. Examples: -0.5 on a short leg = 50bps borrow spread on top
                    // of the shorted instrument's own return; -0.07 on a long ETF = its expense
                    // ratio. Leave blank/0 and nothing changes.
}

/** A complete portfolio configuration (one card on the Backtest tab). */
export interface Portfolio {
  id: number;                  // Unique identifier
  name: string;                // Display name (e.g., "60/40 Stock Bond")
  assets: PortfolioAsset[];    // List of assets and their weights
  color: string;               // Chart line color
  nameManuallyEdited: boolean; // Track if user changed the name
  inflationAdj: string;        // CPI ticker for inflation adjustment (e.g., "CPIMPL") or empty for nominal
  baseCurrency: string;        // Target currency for all values ('' = no conversion, 'PLN', 'USD', 'SGD')
  presetName?: string;         // Name of the preset (Portfolios sheet) last loaded into this card, if any
}

/** Date range for backtesting. */
export interface DateRange {
  start: string;  // Start date (e.g., "2010-01-01")
  end: string;    // End date (e.g., "2024-01-01")
}

/** Single data point in portfolio returns. */
export interface ReturnPoint {
  date: string;
  value: number;     // Portfolio value at this date
  drawdown: number;  // Current drawdown percentage
}

/** Statistics calculated for a portfolio (already formatted for the table). */
export interface PortfolioStats {
  name: string;
  totalReturn: string;
  cagr: string;
  volatility: string;
  sharpeRatio: string;
  maxDrawdown: string;
  longestDrawdown: string;
  currentDrawdown: string;
  endingValue: string;
}

/** Complete backtest result for one portfolio. */
export interface BacktestResult {
  portfolio: Portfolio;
  returns: ReturnPoint[];
  stats: PortfolioStats;
  wipedOutDate?: string | null;  // Date a leveraged portfolio hit zero equity, or null if it survived
}

/** Monthly returns organised by year. */
export interface MonthlyReturns {
  [year: string]: {
    monthly: (number | null)[];  // 12 months, null if no data
    fy: number;                   // Full year return
  };
}

/**
 * One month of a simulated portfolio: per-asset prices, drifted weights, and whether rebalancing
 * happened. It is a row of the Rebalancing table, and the value line is built from it too.
 */
export interface RebalancingRow {
  date: string;
  assetPrices: { [asset: string]: number };    // FX-adjusted price per asset
  assetShares: { [asset: string]: number };    // Number of shares held per asset
  assetWeights: { [asset: string]: number };   // Actual weight % per asset (0-100)
  portfolioValue: number;
  momPct: number | null;                       // Month-over-month return %; null for first row
  isRebalanced: boolean;                       // True if rebalancing happened this month
  accruedCost: number;                         // Financing/carry accrued since the last rebalance
                                               // (negative = money owed). 0 when no leg has a cost.
  isWipedOut: boolean;                         // True once a leveraged portfolio has been liquidated
}

/** What the engine needs from the screen, passed in rather than read from it. */
export interface BacktestSettings {
  start: string;                              // first date of the window (inclusive)
  end: string;                                // last date of the window (inclusive)
  rebalanceFreq: string;                      // 'monthly' | 'quarterly' | 'yearly' | 'never'
  startingCapital: number;
  currencyOf: (ticker: string) => string;     // an asset's native currency ("CSPX" → "USD")
  // Optional: re-draws start-dependent columns (EDO bonds) from the window's own start. EDO's
  // price path depends on WHEN you buy it (see lib/edo.ts): a backtest starting in March 2015
  // buys the series on sale then, not a slice of a chain begun in 2009.
  prepareRows?: (rows: AssetRow[], tickers: string[], start: string) => AssetRow[];
}

// ----------------------------------------
// CURRENCY CONVERSION
// ----------------------------------------

/**
 * Maps a 3-letter currency code to the xxxPLN FX ticker in our data.
 * PLN is the "hub" currency: all FX data is in xxxPLN format, so to convert between any two
 * currencies we route through PLN.
 */
export const FX_TICKER_MAP: { [key: string]: string } = {
  USD: 'USDPLN', SGD: 'SGDPLN', EUR: 'EURPLN', CHF: 'CHFPLN', PLN: ''
};

/**
 * Gets the FX rate for a given FX ticker at a specific data row.
 * Returns 1 if no FX ticker is specified or if the rate is not available.
 */
export const getFxRate = (row: AssetRow, fxTicker: string): number => {
  if (!fxTicker) return 1;  // No FX conversion needed
  const rate = Number(row[fxTicker]);
  return (rate && rate > 0) ? rate : 1;  // Default to 1 if rate not available
};

/**
 * Converts a value from one currency to another using PLN as the hub.
 * All our FX data is in xxxPLN format (e.g., USDPLN = 4.0 means 1 USD = 4 PLN).
 *
 * To convert from Currency A to Currency B:
 *   Step 1: value_PLN = value_A × A_PLN_rate (e.g., $100 × 4.0 = 400 PLN)
 *   Step 2: value_B = value_PLN / B_PLN_rate (e.g., 400 PLN / 3.0 = 133 SGD)
 *
 * If toCurrency is empty (no conversion selected), returns 1 (no conversion).
 */
export const getConversionRate = (row: AssetRow, fromCurrency: string, toCurrency: string): number => {
  // No conversion if target is empty or same as source
  if (!toCurrency || fromCurrency === toCurrency) return 1;

  // Step 1: rate from source currency to PLN (1 if already PLN)
  const fromTicker = FX_TICKER_MAP[fromCurrency] || '';
  const fromToPLN = fromCurrency === 'PLN' ? 1 : getFxRate(row, fromTicker);

  // Step 2: rate from PLN to target currency (divide by target's xxxPLN rate)
  const toTicker = FX_TICKER_MAP[toCurrency] || '';
  const toPLN = toCurrency === 'PLN' ? 1 : getFxRate(row, toTicker);

  // Guard against division by zero (missing FX data)
  if (toPLN === 0) return fromToPLN;

  return fromToPLN / toPLN;
};

/**
 * Formats a number of months as "Xy Zm".
 * Examples: 15 months -> "1y 3m", 24 months -> "2y", 8 months -> "8m"
 */
export const formatPeriod = (months: number): string => {
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;

  if (years === 0) {
    return `${remainingMonths}m`;
  } else if (remainingMonths === 0) {
    return `${years}y`;
  } else {
    return `${years}y ${remainingMonths}m`;
  }
};

// ----------------------------------------
// THE ENGINE
// ----------------------------------------

/**
 * Simulates holding a portfolio through the window, one data row (month) at a time.
 *
 * HOW BACKTESTING WORKS:
 * 1. Start with initial capital, divided according to target weights
 * 2. Each period, calculate how much each position is worth
 * 3. At rebalance dates, sell/buy to restore target weights
 * 4. Track the total value over time
 *
 * Each row records the state BEFORE that month's rebalance, so the Rebalancing table shows how
 * far the weights drifted. Returns [] when the window holds fewer than two rows.
 * Weights are NOT checked here: portfolioReturns() does that.
 */
export function simulatePortfolio(portfolio: Portfolio, data: AssetRow[], s: BacktestSettings): RebalancingRow[] {
  if (!portfolio.assets.length || !data.length) return [];
  return simulateWindow(portfolio, windowRows(portfolio, data, s), s);
}

/** The rows of the window: start-dependent columns (EDO) re-drawn from its start, then trimmed. */
const windowRows = (portfolio: Portfolio, data: AssetRow[], s: BacktestSettings): AssetRow[] => {
  const prepared = s.prepareRows ? s.prepareRows(data, portfolio.assets.map(a => a.asset), s.start) : data;
  return prepared.filter(row => row.date >= s.start && row.date <= s.end);
};

/** The month-by-month simulation over rows already cut to the window (see simulatePortfolio). */
function simulateWindow(portfolio: Portfolio, filteredData: AssetRow[], s: BacktestSettings): RebalancingRow[] {
  if (filteredData.length < 2) return [];

  // An asset's price on a row, converted into the portfolio's base currency (cross-rate via PLN)
  const priceIn = (row: AssetRow, asset: string): number =>
    Number(row[asset]) * getConversionRate(row, s.currencyOf(asset), portfolio.baseCurrency);

  // Initial shares for each asset: how many units the starting capital buys at its target weight
  const assetShares: { [asset: string]: number } = {};
  portfolio.assets.forEach(({ asset, weight }) => {
    const adjustedPrice = priceIn(filteredData[0], asset);
    if (adjustedPrice && adjustedPrice > 0) {
      assetShares[asset] = (s.startingCapital * (weight / 100)) / adjustedPrice;
    } else {
      assetShares[asset] = 0;
    }
  });

  const rows: RebalancingRow[] = [];
  let lastRebalanceDate = new Date(filteredData[0].date);
  let prevValue: number | null = null;
  // Running financing/carry tab since the last rebalance. Negative = money we owe.
  // Think of it as the unpaid interest sitting on your margin account: it grows every month
  // and gets settled (reset to zero) whenever we re-strike the positions at a rebalance.
  let accruedCost = 0;
  // Once a leveraged portfolio's equity hits zero the broker liquidates you: there's no coming back.
  let isWipedOut = false;

  for (let i = 0; i < filteredData.length; i++) {
    const row = filteredData[i];
    const currentDate = new Date(row.date);

    // Is a rebalance due? 'never' deliberately matches none of these, so the day-one share counts
    // are held to the end, the weights drift freely, and the financing tab is never settled.
    let shouldRebalance = false;
    if (i > 0) {
      const monthsSince =
        (currentDate.getFullYear() - lastRebalanceDate.getFullYear()) * 12 +
        (currentDate.getMonth() - lastRebalanceDate.getMonth());
      if (s.rebalanceFreq === 'monthly' && monthsSince >= 1) shouldRebalance = true;
      else if (s.rebalanceFreq === 'quarterly' && monthsSince >= 3) shouldRebalance = true;
      else if (s.rebalanceFreq === 'yearly' && monthsSince >= 12) shouldRebalance = true;
    }

    // --- Accrue financing / carry for the period that just elapsed ---
    // Charged on each leg's ABSOLUTE notional measured at the START of the period (i.e. last
    // month's prices, since that's what we actually held through it), pro-rated by real calendar
    // days. Abs notional is the right base for both directions: a -100% short of 1,000,000 costs
    // you the spread on 1,000,000, and a 200% long of 2,000,000 pays its expense ratio on 2,000,000.
    if (i > 0 && !isWipedOut) {
      const prevRow = filteredData[i - 1];
      const days = (currentDate.getTime() - new Date(prevRow.date).getTime()) / 86400000;
      if (days > 0) {
        portfolio.assets.forEach(({ asset, costPct }) => {
          if (!costPct || !assetShares[asset]) return;
          const prevPrice = priceIn(prevRow, asset);
          if (!prevPrice || prevPrice <= 0) return;
          accruedCost += Math.abs(assetShares[asset] * prevPrice) * (costPct / 100) * (days / 365);
        });
      }
    }

    // Current value: shares × price in the base currency. Short legs carry NEGATIVE shares, so
    // they subtract here, which is exactly what a short does to your account: if the shorted
    // asset rises, you lose.
    const assetPrices: { [asset: string]: number } = {};
    let portfolioValue = 0;
    portfolio.assets.forEach(({ asset }) => {
      const adjustedPrice = priceIn(row, asset);
      assetPrices[asset] = adjustedPrice;
      if (adjustedPrice > 0 && assetShares[asset]) {
        portfolioValue += assetShares[asset] * adjustedPrice;
      }
    });

    // Deduct the unpaid financing tab (accruedCost is negative when it's a cost)
    portfolioValue += accruedCost;

    // --- Liquidation guard ---
    // Unlike an unlevered portfolio, a leveraged one CAN lose more than everything. A real broker
    // closes you out at zero equity rather than letting the account run negative and "recover",
    // so once we hit zero we freeze there: positions closed, tab wiped, value stays at 0.
    if (isWipedOut || portfolioValue <= 0) {
      isWipedOut = true;
      portfolioValue = 0;
      accruedCost = 0;
      portfolio.assets.forEach(({ asset }) => { assetShares[asset] = 0; });
    }

    // Actual (drifted) weights. Short legs come out negative here (e.g. -100%) because their
    // shares are negative: that's correct, and is how you read the leverage at a glance.
    const assetWeights: { [asset: string]: number } = {};
    portfolio.assets.forEach(({ asset }) => {
      if (portfolioValue > 0 && assetShares[asset] && assetPrices[asset] > 0) {
        assetWeights[asset] = (assetShares[asset] * assetPrices[asset] / portfolioValue) * 100;
      } else {
        assetWeights[asset] = 0;
      }
    });

    // Month-over-month return %
    const momPct = prevValue !== null && prevValue > 0
      ? ((portfolioValue - prevValue) / prevValue) * 100
      : null;

    // Snapshot current shares (copied, so the rebalance below doesn't change them)
    const sharesSnapshot: { [asset: string]: number } = {};
    portfolio.assets.forEach(({ asset }) => {
      sharesSnapshot[asset] = assetShares[asset] || 0;
    });

    rows.push({
      date: row.date,
      assetPrices,
      assetShares: sharesSnapshot,
      assetWeights,
      portfolioValue,
      momPct,
      isRebalanced: shouldRebalance,
      accruedCost,
      isWipedOut,
    });

    // Rebalance AFTER recording the row, on the NOMINAL value (real shares, not
    // inflation-adjusted ones). The positions are re-struck against the NET value, which already
    // has the financing tab deducted, so the tab is settled: the next period starts from zero.
    if (shouldRebalance && portfolioValue > 0) {
      portfolio.assets.forEach(({ asset, weight }) => {
        const adjustedPrice = assetPrices[asset];
        if (adjustedPrice && adjustedPrice > 0) {
          assetShares[asset] = (portfolioValue * (weight / 100)) / adjustedPrice;
        }
      });
      lastRebalanceDate = currentDate;
      accruedCost = 0;
    }

    prevValue = portfolioValue;
  }

  return rows;
}

/**
 * The portfolio's value line and drawdown, as the charts and statistics use them.
 * Returns null when the weights don't add up to 100% or the window holds fewer than two rows.
 *
 * With an inflation adjustment (portfolio.inflationAdj, e.g. "CPIMPL"), each value is divided by
 * the CPI index relative to the start: if CPI went from 100 to 120 (+20%), a $1M portfolio is
 * really worth $1M / 1.20 = $833K in start-date purchasing power.
 */
export function portfolioReturns(portfolio: Portfolio, data: AssetRow[], s: BacktestSettings): ReturnPoint[] | null {
  if (!portfolio.assets.length || !data.length) return null;
  const totalWeight = portfolio.assets.reduce((sum, a) => sum + (a.weight || 0), 0);
  if (Math.abs(totalWeight - 100) > 0.01) return null;  // Weights must sum to 100%

  const filteredData = windowRows(portfolio, data, s);
  const rows = simulateWindow(portfolio, filteredData, s);
  if (rows.length < 2) return null;

  // CPI at the start date (normalises the index to 1.0). rows[i] is filteredData[i]'s month.
  const cpiTicker = portfolio.inflationAdj;
  let baseCpi = 1;
  if (cpiTicker) {
    const startCpi = Number(filteredData[0][cpiTicker]);
    if (startCpi && startCpi > 0) baseCpi = startCpi;
  }

  let runningMax = s.startingCapital;  // highest value so far (for drawdown)
  return rows.map((r, i) => {
    let value = r.portfolioValue;
    if (cpiTicker) {
      const currentCpi = Number(filteredData[i][cpiTicker]);
      if (currentCpi && currentCpi > 0) value = r.portfolioValue / (currentCpi / baseCpi);
    }
    if (value > runningMax) runningMax = value;
    // How far below the peak are we?
    const drawdown = ((value - runningMax) / runningMax) * 100;
    return { date: r.date, value, drawdown };
  });
}

// ----------------------------------------
// STATISTICS AND TABLES
// ----------------------------------------

/**
 * The statistics row for a portfolio's returns (formatted strings, ready for the table).
 *
 * - Total Return: overall gain/loss as a percentage
 * - CAGR: compound annual growth rate (lib/stats: the plain total return under a year)
 * - Volatility: how much returns bounce around (higher = riskier)
 * - Sharpe Ratio: return per unit of risk, assuming 0% risk-free; a dash under a year
 * - Max Drawdown: worst peak-to-trough decline
 */
export const calculateStatistics = (returns: ReturnPoint[] | null, portfolio: Pick<Portfolio, 'name'>): PortfolioStats | null => {
  if (!returns || returns.length < 2) return null;

  const startValue = returns[0].value;
  const endValue = returns[returns.length - 1].value;

  // Total return percentage
  const totalReturn = ((endValue - startValue) / startValue) * 100;

  // Time period in years
  const years = yearsBetween(returns[0].date, returns[returns.length - 1].date);

  // CAGR: Compound Annual Growth Rate (lib/stats). Under a year it is the plain total return.
  const cagr = cagrPct(startValue, endValue, years);

  // Volatility: standard deviation of the monthly returns, annualised (× √12).
  // periodReturns skips months that start from zero, which only happens to a wiped-out
  // leveraged portfolio: dividing by zero would poison every statistic below.
  const volatility = annualisedVolPct(periodReturns(returns.map(r => r.value)), 12);

  // Maximum drawdown: worst peak-to-trough decline
  const drawdowns = returns.map(r => r.drawdown);
  const maxDrawdown = Math.min(...drawdowns);

  // Longest drawdown duration: how many months the portfolio stayed underwater (below its all-time high)
  const longestDDMonths = longestUnderwater(drawdowns);

  // Current drawdown
  const currentDrawdown = returns[returns.length - 1].drawdown;

  // Sharpe Ratio: CAGR ÷ volatility, assuming a 0% risk-free rate. null (a dash) under a year.
  const sharpe = sharpeRatio(cagr, volatility, years);

  return {
    name: portfolio.name,
    totalReturn: totalReturn.toFixed(2),
    cagr: cagr.toFixed(2),
    volatility: volatility.toFixed(2),
    sharpeRatio: sharpe === null ? '—' : sharpe.toFixed(2),
    maxDrawdown: maxDrawdown.toFixed(2),
    longestDrawdown: formatPeriod(longestDDMonths),
    currentDrawdown: currentDrawdown.toFixed(2),
    endingValue: endValue.toFixed(2)
  };
};

/**
 * Monthly returns organised by year, for the calendar-style returns table.
 */
export const calculateMonthlyReturns = (returns: ReturnPoint[]): MonthlyReturns => {
  if (!returns || returns.length === 0) return {};

  // First, group data points by year and month
  const monthlyData: {
    [year: number]: {
      monthly: ({ endValue: number; startValue: number | null } | null)[];
      yearStart: number | null;
      yearEnd: number | null;
    };
  } = {};

  returns.forEach(point => {
    const date = new Date(point.date);
    const year = date.getFullYear();
    const month = date.getMonth();

    if (!monthlyData[year]) {
      monthlyData[year] = { monthly: Array(12).fill(null), yearStart: null, yearEnd: null };
    }

    // Track the last value of each month
    if (!monthlyData[year].monthly[month]) {
      monthlyData[year].monthly[month] = { endValue: point.value, startValue: null };
    }
    monthlyData[year].monthly[month]!.endValue = point.value;

    // Track year start and end values
    if (!monthlyData[year].yearStart) {
      monthlyData[year].yearStart = point.value;
    }
    monthlyData[year].yearEnd = point.value;
  });

  // Now calculate the actual monthly returns
  const years = Object.keys(monthlyData).sort();
  const result: MonthlyReturns = {};

  years.forEach((yearStr, yearIdx) => {
    const year = parseInt(yearStr);
    const yearData = monthlyData[year];
    const monthlyReturns: (number | null)[] = Array(12).fill(null);

    let prevMonthEnd = yearIdx > 0 ? monthlyData[parseInt(years[yearIdx - 1])].yearEnd : null;

    for (let month = 0; month < 12; month++) {
      if (yearData.monthly[month]) {
        const endValue = yearData.monthly[month]!.endValue;

        // Find start value (previous month's end or use value from previous year)
        let startValue = prevMonthEnd;
        if (month > 0) {
          // Look for previous month's end value
          for (let m = month - 1; m >= 0; m--) {
            if (yearData.monthly[m]) {
              startValue = yearData.monthly[m]!.endValue;
              break;
            }
          }
        }

        if (startValue && startValue > 0) {
          monthlyReturns[month] = ((endValue - startValue) / startValue) * 100;
        }

        prevMonthEnd = endValue;
      }
    }

    // Calculate full-year return
    let fyReturn = 0;
    const fyStartValue = yearIdx > 0 ? monthlyData[parseInt(years[yearIdx - 1])].yearEnd : yearData.yearStart;
    if (fyStartValue && fyStartValue > 0 && yearData.yearEnd) {
      fyReturn = ((yearData.yearEnd - fyStartValue) / fyStartValue) * 100;
    }

    result[yearStr] = {
      monthly: monthlyReturns,
      fy: fyReturn
    };
  });

  return result;
};

// ----------------------------------------
// WITHDRAWALS ("4% rule")
// ----------------------------------------

/**
 * Applies annual withdrawals to already-computed portfolio returns.
 * Uses the "4% rule" (Trinity Study) fixed-dollar withdrawal strategy:
 *
 * - Year 1: Withdraw a fixed % of the INITIAL portfolio value (e.g., 4% of $1M = $40,000)
 * - Year 2+: Take last year's dollar withdrawal and increase it by inflation only
 * - The withdrawal dollar amount is independent of current portfolio value
 * - This lets you see: "Would my portfolio survive if I pulled out $X/year (adjusted for inflation)?"
 */
export const calculateWithdrawalReturns = (returns: ReturnPoint[], withdrawalPct: number, inflationPct: number = 0): { date: string; value: number }[] => {
  if (!returns || returns.length < 2) return [];

  const result: { date: string; value: number }[] = [];
  let withdrawalValue = returns[0].value;  // Start at same value as original portfolio
  result.push({ date: returns[0].date, value: withdrawalValue });

  // Fixed dollar amount for year 1 (e.g., 4% of $1M = $40,000)
  const baseWithdrawal = returns[0].value * (withdrawalPct / 100);

  let lastWithdrawalDate = new Date(returns[0].date);
  let yearNumber = 0;  // Tracks how many withdrawals have occurred (for inflation compounding)

  for (let i = 1; i < returns.length; i++) {
    // Scale the withdrawal-adjusted value by the same ratio as the original portfolio.
    // Guard: a wiped-out leveraged portfolio sits at zero, and 0/0 would be NaN; treat it as
    // "no growth" so the withdrawal simulation just drains to zero instead of showing NaN.
    const dailyRatio = returns[i - 1].value > 0 ? returns[i].value / returns[i - 1].value : 1;
    withdrawalValue = withdrawalValue * dailyRatio;

    // Check if 12 months have passed since the last withdrawal
    const currentDate = new Date(returns[i].date);
    const monthsSinceLast =
      (currentDate.getFullYear() - lastWithdrawalDate.getFullYear()) * 12 +
      (currentDate.getMonth() - lastWithdrawalDate.getMonth());

    if (monthsSinceLast >= 12) {
      // Fixed-dollar withdrawal adjusted for inflation each year
      // e.g., $40,000 base × (1.05)^yearNumber for 5% inflation
      const withdrawalAmount = baseWithdrawal * Math.pow(1 + inflationPct / 100, yearNumber);
      withdrawalValue = withdrawalValue - withdrawalAmount;
      lastWithdrawalDate = currentDate;
      yearNumber++;
    }

    result.push({ date: returns[i].date, value: withdrawalValue });
  }

  return result;
};

/**
 * Year-by-year breakdown of the withdrawal simulation, matching calculateWithdrawalReturns exactly.
 *
 * Each row is one year: starting value, growth, pre-withdrawal value, effective rate, withdrawal
 * amount and ending value. "Effective rate" is informational: what % of the current value the
 * fixed withdrawal represents.
 */
export const getWithdrawalDetails = (returns: ReturnPoint[], withdrawalPct: number, inflationPct: number = 0) => {
  if (!returns || returns.length < 2) return [];

  const details: {
    year: number;
    startingValue: number;
    returnPct: number;
    preWithdrawalValue: number;
    effectiveRate: number;
    withdrawalAmount: number;
    endValue: number;
  }[] = [];

  let portfolioValue = returns[0].value;  // Start at same value as original portfolio
  // Fixed dollar amount for year 1 (e.g., 4% of $1M = $40,000)
  const baseWithdrawal = returns[0].value * (withdrawalPct / 100);

  let lastWithdrawalDate = new Date(returns[0].date);
  let yearNumber = 0;
  let yearStartValue = portfolioValue;    // Value at the start of the current year
  let yearStartOriginal = returns[0].value;  // Original portfolio value at year start (for calculating return %)

  for (let i = 1; i < returns.length; i++) {
    // Scale by same ratio as original portfolio (same zero guard as calculateWithdrawalReturns)
    const dailyRatio = returns[i - 1].value > 0 ? returns[i].value / returns[i - 1].value : 1;
    portfolioValue = portfolioValue * dailyRatio;

    // Check if 12 months have passed since the last withdrawal
    const currentDate = new Date(returns[i].date);
    const monthsSinceLast =
      (currentDate.getFullYear() - lastWithdrawalDate.getFullYear()) * 12 +
      (currentDate.getMonth() - lastWithdrawalDate.getMonth());

    if (monthsSinceLast >= 12) {
      // Calculate return % for this year using the original portfolio's growth
      const originalValueNow = returns[i].value;
      const yearReturnPct = yearStartOriginal > 0
        ? ((originalValueNow - yearStartOriginal) / yearStartOriginal) * 100
        : 0;  // guard: wiped-out portfolio has a zero base, which would divide to NaN

      // Pre-withdrawal value (after growth, before taking money out)
      const preWithdrawalValue = portfolioValue;

      // Fixed-dollar withdrawal adjusted for inflation (same formula as calculateWithdrawalReturns)
      const withdrawalAmount = baseWithdrawal * Math.pow(1 + inflationPct / 100, yearNumber);

      // Effective rate is informational: what % of current portfolio this withdrawal represents
      const effectiveRate = preWithdrawalValue > 0 ? (withdrawalAmount / preWithdrawalValue) * 100 : 0;

      // Apply withdrawal (subtract fixed dollar amount, not a percentage)
      portfolioValue = portfolioValue - withdrawalAmount;

      details.push({
        year: yearNumber + 1,
        startingValue: yearStartValue,
        returnPct: yearReturnPct,
        preWithdrawalValue,
        effectiveRate,
        withdrawalAmount,
        endValue: portfolioValue,
      });

      lastWithdrawalDate = currentDate;
      yearNumber++;
      yearStartValue = portfolioValue;       // Next year starts where this one ended
      yearStartOriginal = originalValueNow;  // Track original portfolio from this point
    }
  }

  return details;
};
