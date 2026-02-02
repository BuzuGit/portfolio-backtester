'use client';
/*
  PORTFOLIO BACKTESTER COMPONENT

  This is the main component that does all the heavy lifting.
  It lets you:
  1. Load historical price data from a Google Sheet
  2. Create portfolios with different asset allocations
  3. Run backtests to see how those portfolios would have performed
  4. View charts and statistics

  'use client' at the top tells Next.js this component needs to run
  in the browser (not on the server) because it uses:
  - useState/useEffect (React hooks for interactivity)
  - Charts (need the browser's canvas)
  - User interactions
*/

import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { RefreshCw, Plus, Trash2 } from 'lucide-react';
import { fetchSheetData, AssetRow, AssetLookup } from '@/lib/fetchData';

// ============================================
// TYPE DEFINITIONS
// ============================================
// TypeScript interfaces describe the "shape" of our data.
// Think of them as blueprints that ensure we use data correctly.

// A single asset in a portfolio (e.g., "SPY at 60% weight")
interface PortfolioAsset {
  asset: string;   // Asset name (e.g., "SPY", "BND")
  weight: number;  // Percentage weight (e.g., 60 for 60%)
  fx: string;      // FX ticker (e.g., "USDPLN") or empty for no conversion
}

// A complete portfolio configuration
interface Portfolio {
  id: number;                  // Unique identifier
  name: string;                // Display name (e.g., "60/40 Stock Bond")
  assets: PortfolioAsset[];    // List of assets and their weights
  color: string;               // Chart line color
  nameManuallyEdited: boolean; // Track if user changed the name
}

// Date range for backtesting
interface DateRange {
  start: string;  // Start date (e.g., "2010-01-01")
  end: string;    // End date (e.g., "2024-01-01")
}

// Single data point in portfolio returns
interface ReturnPoint {
  date: string;
  value: number;     // Portfolio value at this date
  drawdown: number;  // Current drawdown percentage
}

// Statistics calculated for a portfolio
interface PortfolioStats {
  name: string;
  totalReturn: string;
  cagr: string;
  volatility: string;
  sharpeRatio: string;
  maxDrawdown: string;
  currentDrawdown: string;
  endingValue: string;
}

// Complete backtest result for one portfolio
interface BacktestResult {
  portfolio: Portfolio;
  returns: ReturnPoint[];
  stats: PortfolioStats;
}

// Monthly returns organized by year
interface MonthlyReturns {
  [year: string]: {
    monthly: (number | null)[];  // 12 months, null if no data
    fy: number;                   // Full year return
  };
}

// Annual return data for a single asset in a specific year
// Used in the Assets Annual Returns table
interface AssetYearReturn {
  return: number;          // The annual return as a percentage
  startDate: string;       // First trading date of the year
  startPrice: number;      // Price on the first trading date
  endDate: string;         // Last trading date of the year
  endPrice: number;        // Price on the last trading date
}

// All annual returns for all assets, organized by ticker then year
interface AssetsAnnualReturns {
  [ticker: string]: {
    [year: number]: AssetYearReturn;
  };
}

// ============================================
// MAIN COMPONENT
// ============================================

// Available FX conversion options for foreign currency assets
// Empty string = no conversion (prices used as-is)
// e.g., "USDPLN" = multiply asset prices by USD/PLN exchange rate
const FX_OPTIONS = ['', 'USDPLN', 'SGDPLN', 'CHFPLN', 'EURPLN'];

const PortfolioBacktester = () => {
  // ----------------------------------------
  // STATE VARIABLES
  // ----------------------------------------
  // State = data that can change over time. When state changes, React re-renders the UI.

  // Data loading states
  const [isConnected, setIsConnected] = useState(false);      // Do we have data loaded?
  const [isLoading, setIsLoading] = useState(true);           // Are we currently loading?
  const [loadingMessage, setLoadingMessage] = useState('');   // Status message to show user

  // The actual data
  const [assetData, setAssetData] = useState<AssetRow[] | null>(null);  // Historical price data
  const [availableAssets, setAvailableAssets] = useState<string[]>([]); // List of asset names
  const [assetLookup, setAssetLookup] = useState<AssetLookup[]>([]);    // Lookup table (ticker -> name)

  // Portfolio configurations - start with one empty portfolio
  const [portfolios, setPortfolios] = useState<Portfolio[]>([
    { id: 1, name: 'Portfolio 1', assets: [], color: '#3b82f6', nameManuallyEdited: false }
  ]);

  // Backtest parameters
  const [startingCapital, setStartingCapital] = useState(10000);        // How much $ to start with
  const [rebalanceFreq, setRebalanceFreq] = useState('yearly');         // How often to rebalance
  const [dateRange, setDateRange] = useState<DateRange>({ start: '', end: '' });  // Full data range
  const [selectedStartDate, setSelectedStartDate] = useState('');       // User-selected start
  const [selectedEndDate, setSelectedEndDate] = useState('');           // User-selected end

  // Results after running backtest
  const [backtestResults, setBacktestResults] = useState<BacktestResult[] | null>(null);

  // Which view is currently active: the backtest tool, assets annual returns table, or best-to-worst ranking
  // 'backtest' = show the portfolio configuration and backtest results
  // 'annualReturns' = show a table of yearly returns for all assets in the lookup table
  // 'bestToWorst' = show assets ranked by return for a selected year
  const [activeView, setActiveView] = useState<'backtest' | 'annualReturns' | 'bestToWorst' | 'monthlyPrices'>('backtest');

  // The year selected for the "Best To Worst" ranking view
  // Defaults to null, and will be set to the most recent year when data loads
  const [selectedRankingYear, setSelectedRankingYear] = useState<number | null>(null);

  // Sort column for Assets Annual Returns table
  // Can be a year number, 'Period', 'CAGR', 'CurrDD', '1Y', '2Y', '3Y', '4Y', '5Y', or null (default order)
  const [annualReturnsSortColumn, setAnnualReturnsSortColumn] = useState<string | number | null>(null);

  // Best To Worst view mode: 'year' for annual returns, or a number (1-5) for period returns
  // When null or 'year', the year dropdown is used. When 1-5, shows period returns.
  const [bestToWorstMode, setBestToWorstMode] = useState<'year' | 1 | 2 | 3 | 4 | 5>('year');

  // ----------------------------------------
  // AUTO-LOAD DATA ON MOUNT
  // ----------------------------------------
  // useEffect runs code when the component first appears ("mounts")
  // The empty array [] means "run once when component loads"
  useEffect(() => {
    loadDataFromSheet();
  }, []);

  // ----------------------------------------
  // DATA LOADING FUNCTIONS
  // ----------------------------------------

  /**
   * Fetches fresh data from the Google Sheet.
   * Called automatically on page load and when user clicks "Refresh Data"
   */
  const loadDataFromSheet = async () => {
    setIsLoading(true);
    setLoadingMessage('Fetching data from Google Sheets...');

    try {
      // Fetch and parse the CSV data from both sheets
      const { data, assets, lookup } = await fetchSheetData();

      // Update all our state with the new data
      setAssetData(data);
      setAvailableAssets(assets);
      setAssetLookup(lookup);
      setIsConnected(true);

      // Set the date range based on the data
      if (data.length > 0) {
        setDateRange({
          start: data[0].date,
          end: data[data.length - 1].date
        });
      }

      setLoadingMessage(`Loaded ${assets.length} assets, ${data.length} data points`);
    } catch (error) {
      console.error('Failed to load data:', error);
      setLoadingMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsConnected(false);
    }

    setIsLoading(false);
  };

  // ----------------------------------------
  // COMPUTED VALUES
  // ----------------------------------------

  // The actual date range to use (user selection or full range)
  const selectedDateRange = {
    start: selectedStartDate || dateRange.start,
    end: selectedEndDate || dateRange.end
  };

  /**
   * Filters available assets to only those that:
   * 1. Are in the lookup table (user-defined list of allowed assets)
   * 2. Have data at the selected start date
   * This prevents users from selecting assets that aren't in the lookup or didn't exist yet.
   */
  const getAvailableAssetsForDateRange = (): string[] => {
    // First, get the list of tickers from the lookup table
    const lookupTickers = assetLookup.map(l => l.ticker);

    // If no lookup table, fall back to all assets (backwards compatibility)
    const baseAssets = lookupTickers.length > 0
      ? availableAssets.filter(asset => lookupTickers.includes(asset))
      : availableAssets;

    if (!assetData || !selectedDateRange.start) return baseAssets;

    // Find the index of our start date in the data
    const startIndex = assetData.findIndex(row => row.date === selectedDateRange.start);
    if (startIndex === -1) return baseAssets;

    // Filter to assets that have data at or near the start date
    return baseAssets.filter(asset => {
      const hasDataAtStart = assetData[startIndex][asset] && Number(assetData[startIndex][asset]) > 0;
      if (hasDataAtStart) return true;

      // Also check a few rows before (in case data starts slightly earlier)
      for (let i = Math.max(0, startIndex - 5); i < startIndex; i++) {
        if (assetData[i][asset] && Number(assetData[i][asset]) > 0) return true;
      }
      return false;
    });
  };

  const availableAssetsFiltered = getAvailableAssetsForDateRange();

  /**
   * Gets the friendly display name for a ticker from the lookup table.
   * Returns "TICKER - Asset Name" format, or just the ticker if not found.
   */
  const getAssetDisplayName = (ticker: string): string => {
    const lookup = assetLookup.find(l => l.ticker === ticker);
    return lookup ? `${ticker} - ${lookup.name}` : ticker;
  };

  // ----------------------------------------
  // PORTFOLIO MANAGEMENT FUNCTIONS
  // ----------------------------------------

  /**
   * Generates a portfolio name from its assets.
   * e.g., [SPY 60%, BND 40%] -> "SPY60-BND40"
   */
  const generatePortfolioName = (assets: PortfolioAsset[]): string => {
    const validAssets = assets.filter(a => a.asset && a.weight > 0);
    if (validAssets.length === 0) return 'Portfolio';
    return validAssets.map(a => `${a.asset}${Math.round(a.weight)}`).join('-');
  };

  /**
   * Handles when user manually types a portfolio name
   */
  const handlePortfolioNameChange = (id: number, name: string) => {
    setPortfolios(portfolios.map(p =>
      p.id === id ? { ...p, name, nameManuallyEdited: true } : p
    ));
  };

  /**
   * Adds a new empty portfolio
   */
  const addPortfolio = () => {
    // Cycle through these colors for different portfolios
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    const newId = Math.max(...portfolios.map(p => p.id), 0) + 1;

    setPortfolios([...portfolios, {
      id: newId,
      name: `Portfolio ${newId}`,
      assets: [],
      color: colors[portfolios.length % colors.length],
      nameManuallyEdited: false
    }]);
  };

  /**
   * Removes a portfolio by ID
   */
  const removePortfolio = (id: number) => {
    setPortfolios(portfolios.filter(p => p.id !== id));
  };

  /**
   * Adds a new asset slot to a portfolio
   */
  const addAssetToPortfolio = (portfolioId: number) => {
    const firstAvailableAsset = availableAssetsFiltered[0] || '';

    setPortfolios(portfolios.map(p => {
      if (p.id === portfolioId) {
        // First asset starts at 100%, subsequent assets start at 0%
        const isFirstAsset = p.assets.length === 0;
        const newAssets = [...p.assets, {
          asset: firstAvailableAsset,
          weight: isFirstAsset ? 100 : 0,
          fx: ''  // Default: no FX conversion
        }];
        const newName = p.nameManuallyEdited ? p.name : generatePortfolioName(newAssets);
        return { ...p, assets: newAssets, name: newName };
      }
      return p;
    }));
  };

  /**
   * Auto-adjusts the first asset's weight to make total = 100%
   * This is a convenience feature - when you change other assets,
   * the first asset automatically adjusts to balance things out.
   */
  const autoAdjustFirstAsset = (assets: PortfolioAsset[]): PortfolioAsset[] => {
    if (assets.length < 2) return assets;

    // Sum up weights of all assets except the first one
    const otherAssetsWeight = assets.slice(1).reduce((sum, a) => sum + (a.weight || 0), 0);
    const firstAssetWeight = Math.max(0, 100 - otherAssetsWeight);

    const newAssets = [...assets];
    newAssets[0] = { ...newAssets[0], weight: firstAssetWeight };
    return newAssets;
  };

  /**
   * Gets the FX rate for a given FX ticker at a specific data row.
   * Returns 1 if no FX ticker is specified or if the rate is not available.
   */
  const getFxRate = (row: AssetRow, fxTicker: string): number => {
    if (!fxTicker) return 1;  // No FX conversion needed
    const rate = Number(row[fxTicker]);
    return (rate && rate > 0) ? rate : 1;  // Default to 1 if rate not available
  };

  /**
   * Sets the start date based on a preset period (YTD, 1Y, 3Y, 5Y).
   * Keeps the end date unchanged and calculates the new start date.
   * Finds the closest available date in the data if exact date doesn't exist.
   */
  const setDatePreset = (preset: 'YTD' | '1Y' | '2Y' | '3Y' | '4Y' | '5Y') => {
    if (!assetData || assetData.length === 0) return;

    const endDate = new Date(selectedDateRange.end);
    let targetStartDate: Date;

    if (preset === 'YTD') {
      // Year to date: Jan 1 of the current year based on end date
      targetStartDate = new Date(endDate.getFullYear(), 0, 1);
    } else {
      // 1Y, 2Y, 3Y, 4Y, 5Y: subtract years from end date
      const years = parseInt(preset);  // "1Y" -> 1, "2Y" -> 2, etc.
      targetStartDate = new Date(endDate);
      targetStartDate.setFullYear(endDate.getFullYear() - years);
    }

    // Find the closest available date in assetData (on or after target)
    const targetDateStr = targetStartDate.toISOString().split('T')[0];

    // Find first date >= target date
    const closestDate = assetData.find(row => row.date >= targetDateStr);

    if (closestDate) {
      setSelectedStartDate(closestDate.date);
    } else {
      // If no date found after target, use the first available date
      setSelectedStartDate(assetData[0].date);
    }
  };

  /**
   * Updates a specific field of an asset in a portfolio
   */
  const updateAsset = (portfolioId: number, assetIndex: number, field: 'asset' | 'weight' | 'fx', value: string | number) => {
    setPortfolios(portfolios.map(p => {
      if (p.id === portfolioId) {
        let newAssets = [...p.assets];
        newAssets[assetIndex] = { ...newAssets[assetIndex], [field]: value };

        // Auto-adjust first asset if we changed weight of another asset
        if (field === 'weight' && assetIndex > 0) {
          newAssets = autoAdjustFirstAsset(newAssets);
        }

        const newName = p.nameManuallyEdited ? p.name : generatePortfolioName(newAssets);
        return { ...p, assets: newAssets, name: newName };
      }
      return p;
    }));
  };

  /**
   * Removes an asset from a portfolio
   */
  const removeAsset = (portfolioId: number, assetIndex: number) => {
    setPortfolios(portfolios.map(p => {
      if (p.id === portfolioId) {
        let newAssets = p.assets.filter((_, i) => i !== assetIndex);

        // If we removed an asset other than first, auto-adjust first asset
        if (assetIndex > 0 && newAssets.length > 0) {
          newAssets = autoAdjustFirstAsset(newAssets);
        }

        const newName = p.nameManuallyEdited ? p.name : generatePortfolioName(newAssets);
        return { ...p, assets: newAssets, name: newName };
      }
      return p;
    }));
  };

  /**
   * Calculates the total weight of all assets in a portfolio
   * Should equal 100% for a valid portfolio
   */
  const getTotalWeight = (portfolio: Portfolio): number => {
    return portfolio.assets.reduce((sum, a) => sum + (a.weight || 0), 0);
  };

  // ----------------------------------------
  // BACKTEST CALCULATION FUNCTIONS
  // ----------------------------------------

  /**
   * Calculates portfolio value over time using actual rebalancing.
   *
   * HOW BACKTESTING WORKS:
   * 1. Start with initial capital, divided according to target weights
   * 2. Each period, calculate how much each position is worth
   * 3. At rebalance dates, sell/buy to restore target weights
   * 4. Track the total value and drawdown over time
   */
  const calculatePortfolioReturns = (portfolio: Portfolio, data: AssetRow[]): ReturnPoint[] | null => {
    // Validation
    if (!portfolio.assets.length || !data.length) return null;

    const totalWeight = portfolio.assets.reduce((sum, a) => sum + (a.weight || 0), 0);
    if (Math.abs(totalWeight - 100) > 0.01) return null;  // Weights must sum to 100%

    // Filter data to selected date range
    const filteredData = data.filter(row =>
      row.date >= selectedDateRange.start && row.date <= selectedDateRange.end
    );
    if (filteredData.length < 2) return null;

    // Target weights as decimals (e.g., 60% -> 0.6)
    const targetWeights: { [asset: string]: number } = {};
    portfolio.assets.forEach(({ asset, weight }) => {
      targetWeights[asset] = weight / 100;
    });

    // Calculate initial shares for each asset
    // Shares = how many units of each asset we own
    // When FX is selected, we convert the asset price to PLN using the FX rate
    const assetShares: { [asset: string]: number } = {};
    portfolio.assets.forEach(({ asset, weight, fx }) => {
      const initialPrice = Number(filteredData[0][asset]);
      const fxRate = getFxRate(filteredData[0], fx);  // Get FX rate (1 if no FX)
      const adjustedPrice = initialPrice * fxRate;    // Convert to PLN
      if (adjustedPrice && adjustedPrice > 0) {
        const initialAllocation = startingCapital * (weight / 100);
        assetShares[asset] = initialAllocation / adjustedPrice;
      } else {
        assetShares[asset] = 0;
      }
    });

    const returns: ReturnPoint[] = [];
    let runningMax = startingCapital;  // Track highest value (for drawdown)
    let lastRebalanceDate = new Date(filteredData[0].date);

    // Process each date in the data
    for (let i = 0; i < filteredData.length; i++) {
      const row = filteredData[i];
      const currentDate = new Date(row.date);

      // Check if we need to rebalance based on frequency
      let shouldRebalance = false;
      if (i > 0) {
        const monthsSinceRebalance =
          (currentDate.getFullYear() - lastRebalanceDate.getFullYear()) * 12 +
          (currentDate.getMonth() - lastRebalanceDate.getMonth());

        if (rebalanceFreq === 'monthly' && monthsSinceRebalance >= 1) {
          shouldRebalance = true;
        } else if (rebalanceFreq === 'quarterly' && monthsSinceRebalance >= 3) {
          shouldRebalance = true;
        } else if (rebalanceFreq === 'yearly' && monthsSinceRebalance >= 12) {
          shouldRebalance = true;
        }
      }

      // Calculate current portfolio value
      // Each asset's value = shares × price × FX rate (if applicable)
      let portfolioValue = 0;
      portfolio.assets.forEach(({ asset, fx }) => {
        const currentPrice = Number(row[asset]);
        const fxRate = getFxRate(row, fx);  // Get FX rate for this date
        const adjustedPrice = currentPrice * fxRate;  // Convert to PLN
        if (adjustedPrice && adjustedPrice > 0 && assetShares[asset]) {
          portfolioValue += assetShares[asset] * adjustedPrice;
        }
      });

      // Rebalance: adjust shares to restore target weights
      if (shouldRebalance && portfolioValue > 0) {
        portfolio.assets.forEach(({ asset, weight, fx }) => {
          const currentPrice = Number(row[asset]);
          const fxRate = getFxRate(row, fx);  // Get FX rate for rebalancing
          const adjustedPrice = currentPrice * fxRate;  // Convert to PLN
          if (adjustedPrice && adjustedPrice > 0) {
            const targetAllocation = portfolioValue * (weight / 100);
            assetShares[asset] = targetAllocation / adjustedPrice;
          }
        });
        lastRebalanceDate = currentDate;
      }

      // Track running maximum for drawdown calculation
      if (portfolioValue > runningMax) {
        runningMax = portfolioValue;
      }

      // Calculate drawdown: how far below the peak are we?
      const drawdown = ((portfolioValue - runningMax) / runningMax) * 100;

      returns.push({
        date: row.date,
        value: portfolioValue,
        drawdown
      });
    }

    return returns;
  };

  /**
   * Calculates statistics for a portfolio's returns.
   *
   * KEY METRICS EXPLAINED:
   * - Total Return: Overall gain/loss as a percentage
   * - CAGR: Compound Annual Growth Rate - smoothed yearly return
   * - Volatility: How much returns bounce around (higher = riskier)
   * - Sharpe Ratio: Return per unit of risk (higher = better)
   * - Max Drawdown: Worst peak-to-trough decline
   */
  const calculateStatistics = (returns: ReturnPoint[] | null, portfolio: Portfolio): PortfolioStats | null => {
    if (!returns || returns.length < 2) return null;

    const startValue = returns[0].value;
    const endValue = returns[returns.length - 1].value;

    // Total return percentage
    const totalReturn = ((endValue - startValue) / startValue) * 100;

    // Calculate time period in years
    const startDate = new Date(returns[0].date);
    const endDate = new Date(returns[returns.length - 1].date);
    const years = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

    // CAGR: Compound Annual Growth Rate
    // Formula: (EndValue/StartValue)^(1/years) - 1
    const cagr = years > 0 ? (Math.pow(endValue / startValue, 1 / years) - 1) * 100 : 0;

    // Calculate periodic returns for volatility
    const periodicReturns: number[] = [];
    for (let i = 1; i < returns.length; i++) {
      periodicReturns.push((returns[i].value - returns[i - 1].value) / returns[i - 1].value);
    }

    // Volatility: standard deviation of returns, annualized
    const mean = periodicReturns.reduce((sum, r) => sum + r, 0) / periodicReturns.length;
    const variance = periodicReturns.map(r => Math.pow(r - mean, 2)).reduce((sum, sq) => sum + sq, 0) / periodicReturns.length;
    const volatility = Math.sqrt(variance) * Math.sqrt(12) * 100;  // Annualized (assuming monthly data)

    // Maximum drawdown: worst peak-to-trough decline
    const maxDrawdown = Math.min(...returns.map(r => r.drawdown));

    // Current drawdown
    const currentDrawdown = returns[returns.length - 1].drawdown;

    // Sharpe Ratio: risk-adjusted return (simplified, assuming 0% risk-free rate)
    const sharpeRatio = volatility > 0 ? cagr / volatility : 0;

    return {
      name: portfolio.name,
      totalReturn: totalReturn.toFixed(2),
      cagr: cagr.toFixed(2),
      volatility: volatility.toFixed(2),
      sharpeRatio: sharpeRatio.toFixed(2),
      maxDrawdown: maxDrawdown.toFixed(2),
      currentDrawdown: currentDrawdown.toFixed(2),
      endingValue: endValue.toFixed(2)
    };
  };

  /**
   * Calculates monthly returns organized by year.
   * This is used to build the monthly returns table.
   */
  const calculateMonthlyReturns = (returns: ReturnPoint[]): MonthlyReturns => {
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
  // ASSETS ANNUAL RETURNS FUNCTIONS
  // ----------------------------------------

  /**
   * Calculates annual returns for ALL assets in the lookup table.
   *
   * For each asset and each year:
   * - Start price = last available price from the PRIOR year (e.g., Dec 31 of previous year)
   * - End price = last available price in THAT year (e.g., Dec 31 of current year)
   * - Calculate: ((endPrice / startPrice) - 1) * 100 = annual return %
   *
   * Example: 2023 return = Dec 31 2023 price vs Dec 31 2022 price
   * For current year (e.g., 2026): latest available price vs Dec 31 2025
   *
   * This measures true calendar-year performance from year-end to year-end.
   */
  const calculateAssetsAnnualReturns = (): AssetsAnnualReturns => {
    const result: AssetsAnnualReturns = {};

    // Only calculate for assets in the lookup table
    if (!assetData || assetLookup.length === 0) return result;

    // Get all tickers from the lookup table
    const tickers = assetLookup.map(l => l.ticker);

    // Get the range of years in the data
    const allDates = assetData.map(row => new Date(row.date));
    const minYear = Math.min(...allDates.map(d => d.getFullYear()));
    const maxYear = Math.max(...allDates.map(d => d.getFullYear()));

    // Helper function: get the last available price for a ticker in a given year
    const getLastPriceInYear = (ticker: string, year: number): { date: string; price: number } | null => {
      // Filter to data points in this year with valid prices for this ticker
      const yearData = assetData.filter(row => {
        const rowYear = new Date(row.date).getFullYear();
        const price = Number(row[ticker]);
        return rowYear === year && price && price > 0;
      });

      if (yearData.length === 0) return null;

      // Get the last data point of the year
      const lastRow = yearData[yearData.length - 1];
      return {
        date: lastRow.date,
        price: Number(lastRow[ticker])
      };
    };

    // For each ticker, calculate annual returns for each year
    tickers.forEach(ticker => {
      result[ticker] = {};

      for (let year = minYear; year <= maxYear; year++) {
        // Get end of current year price
        const endYearData = getLastPriceInYear(ticker, year);
        if (!endYearData) continue;  // No data for this year

        // Get end of prior year price (this is our starting point)
        const priorYearData = getLastPriceInYear(ticker, year - 1);
        if (!priorYearData) continue;  // No prior year data = can't calculate return

        // Calculate annual return: ((endPrice / startPrice) - 1) * 100
        const annualReturn = ((endYearData.price / priorYearData.price) - 1) * 100;

        result[ticker][year] = {
          return: annualReturn,
          startDate: priorYearData.date,    // Last day of prior year
          startPrice: priorYearData.price,
          endDate: endYearData.date,         // Last day of current year
          endPrice: endYearData.price
        };
      }
    });

    return result;
  };

  /**
   * Generates tooltip text for a specific asset/year cell.
   * Shows the calculation details so users understand how the return was computed.
   *
   * Example output: "2023: $100.00 (Dec 30, 2022) → $110.00 (Dec 29, 2023) = +10.00%"
   */
  const getReturnTooltip = (ticker: string, year: number, annualReturns: AssetsAnnualReturns): string => {
    const data = annualReturns[ticker]?.[year];
    if (!data) return 'No data available';

    // Format dates to show month, day, and year (e.g., "Dec 30, 2022")
    const formatDate = (dateStr: string): string => {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    // Format the return with a + or - sign
    const returnSign = data.return >= 0 ? '+' : '';
    const returnStr = `${returnSign}${data.return.toFixed(2)}%`;

    return `${year}: $${data.startPrice.toFixed(2)} (${formatDate(data.startDate)}) → $${data.endPrice.toFixed(2)} (${formatDate(data.endDate)}) = ${returnStr}`;
  };

  /**
   * Gets all unique years that have data for any asset in the lookup table.
   * Returns years sorted from oldest to newest (e.g., 2016, 2017, ..., 2026)
   */
  const getYearsWithData = (annualReturns: AssetsAnnualReturns): number[] => {
    const yearsSet = new Set<number>();
    Object.values(annualReturns).forEach(assetYears => {
      Object.keys(assetYears).forEach(year => yearsSet.add(parseInt(year)));
    });
    return Array.from(yearsSet).sort((a, b) => a - b);  // Oldest to newest
  };

  /**
   * Gets assets sorted by their return for a specific year, from highest to lowest.
   * Used for the "Best To Worst" ranking view.
   *
   * Returns an array of objects with ticker, name, return, currency, and PLN return
   * for each asset that has data for the specified year.
   *
   * PLN Return Calculation:
   * - For PLN assets (no FX conversion needed): returnInPLN = return
   * - For foreign currency assets: (1 + assetReturn) × (1 + fxReturn) - 1
   */
  const getSortedAssetsByReturn = (year: number, annualReturns: AssetsAnnualReturns): Array<{
    ticker: string;
    name: string;
    return: number;
    currency: string;
    fxTicker: string;
    fxReturn: number | null;  // null if no FX data or PLN asset
    returnInPLN: number;
  }> => {
    const assetsWithReturns: Array<{
      ticker: string;
      name: string;
      return: number;
      currency: string;
      fxTicker: string;
      fxReturn: number | null;
      returnInPLN: number;
    }> = [];

    // Loop through all assets in the lookup table
    assetLookup.forEach(asset => {
      const data = annualReturns[asset.ticker]?.[year];
      if (data) {
        const assetReturn = data.return;  // Already in percentage (e.g., 10 for 10%)
        const fxTicker = asset.fx;
        const currency = asset.currency;

        // Calculate PLN return
        let returnInPLN = assetReturn;
        let fxReturn: number | null = null;

        // If there's an FX ticker, get the FX return and convert
        if (fxTicker) {
          const fxData = annualReturns[fxTicker]?.[year];
          if (fxData) {
            fxReturn = fxData.return;  // FX return in percentage
            // Convert percentages to decimals, multiply, convert back
            // (1 + 10%) × (1 + 5%) - 1 = (1.10 × 1.05) - 1 = 0.155 = 15.5%
            returnInPLN = ((1 + assetReturn / 100) * (1 + fxReturn / 100) - 1) * 100;
          }
        }

        assetsWithReturns.push({
          ticker: asset.ticker,
          name: asset.name,
          return: assetReturn,
          currency,
          fxTicker,
          fxReturn,
          returnInPLN
        });
      }
    });

    // Sort by return, highest to lowest
    return assetsWithReturns.sort((a, b) => b.return - a.return);
  };

  /**
   * Gets the first and last available price data for a ticker.
   * Used to calculate Period and CAGR.
   */
  const getAssetPriceRange = (ticker: string): {
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
   * Formats a number of months as "Xy Zm" format.
   * Examples: 15 months -> "1y 3m", 24 months -> "2y", 8 months -> "8m"
   */
  const formatPeriod = (months: number): string => {
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

  /**
   * Calculates CAGR (Compound Annual Growth Rate).
   * Formula: ((EndValue / StartValue) ^ (1/years)) - 1
   * Where years = months / 12
   */
  const calculateCAGR = (startPrice: number, endPrice: number, months: number): number => {
    if (startPrice <= 0 || months <= 0) return 0;
    const years = months / 12;
    return (Math.pow(endPrice / startPrice, 1 / years) - 1) * 100;
  };

  /**
   * Calculates total return for a ticker over a specific number of years.
   * Returns: current price vs price X years ago.
   * Used for the 1Y, 2Y, 3Y, 4Y, 5Y columns in Assets Annual Returns.
   */
  const getPeriodReturn = (ticker: string, years: number): {
    return: number;
    startDate: string;
    startPrice: number;
    endDate: string;
    endPrice: number;
  } | null => {
    if (!assetData || assetData.length === 0) return null;

    // Find the latest price for this ticker
    let endRow = null;
    for (let i = assetData.length - 1; i >= 0; i--) {
      const price = Number(assetData[i][ticker]);
      if (price && price > 0) {
        endRow = assetData[i];
        break;
      }
    }
    if (!endRow) return null;

    const endDate = new Date(endRow.date);
    const endPrice = Number(endRow[ticker]);

    // Calculate target start date (X years ago)
    const targetStartDate = new Date(endDate);
    targetStartDate.setFullYear(endDate.getFullYear() - years);
    const targetDateStr = targetStartDate.toISOString().split('T')[0];

    // Find the closest date on or after target date with valid price
    let startRow = null;
    for (const row of assetData) {
      if (row.date >= targetDateStr) {
        const price = Number(row[ticker]);
        if (price && price > 0) {
          startRow = row;
          break;
        }
      }
    }
    if (!startRow) return null;

    const startPrice = Number(startRow[ticker]);
    const totalReturn = ((endPrice / startPrice) - 1) * 100;

    return {
      return: totalReturn,
      startDate: startRow.date,
      startPrice,
      endDate: endRow.date,
      endPrice
    };
  };

  /**
   * Generates tooltip text for period return columns (1Y, 2Y, etc.)
   */
  const getPeriodReturnTooltip = (data: { startDate: string; startPrice: number; endDate: string; endPrice: number; return: number }): string => {
    const formatDate = (dateStr: string): string => {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };
    const returnSign = data.return >= 0 ? '+' : '';
    return `${formatDate(data.startDate)} ($${data.startPrice.toFixed(2)}) → ${formatDate(data.endDate)} ($${data.endPrice.toFixed(2)}) = ${returnSign}${data.return.toFixed(2)}%`;
  };

  /**
   * Gets assets sorted by their period return (1Y, 2Y, etc.), from highest to lowest.
   * Used for the "Best To Worst" view when a period button is selected.
   * Includes PLN return calculated using the same period's FX return.
   */
  const getSortedAssetsByPeriodReturn = (years: number): Array<{
    ticker: string;
    name: string;
    return: number;
    currency: string;
    fxTicker: string;
    fxReturn: number | null;
    returnInPLN: number;
    startDate: string;
    endDate: string;
    startPrice: number;
    endPrice: number;
  }> => {
    const assetsWithReturns: Array<{
      ticker: string;
      name: string;
      return: number;
      currency: string;
      fxTicker: string;
      fxReturn: number | null;
      returnInPLN: number;
      startDate: string;
      endDate: string;
      startPrice: number;
      endPrice: number;
    }> = [];

    // Loop through all assets in the lookup table
    assetLookup.forEach(asset => {
      const periodData = getPeriodReturn(asset.ticker, years);
      if (periodData) {
        const assetReturn = periodData.return;
        const fxTicker = asset.fx;
        const currency = asset.currency;

        // Calculate PLN return using same period FX return
        let returnInPLN = assetReturn;
        let fxReturn: number | null = null;

        if (fxTicker) {
          const fxPeriodData = getPeriodReturn(fxTicker, years);
          if (fxPeriodData) {
            fxReturn = fxPeriodData.return;
            // (1 + assetReturn) × (1 + fxReturn) - 1
            returnInPLN = ((1 + assetReturn / 100) * (1 + fxReturn / 100) - 1) * 100;
          }
        }

        assetsWithReturns.push({
          ticker: asset.ticker,
          name: asset.name,
          return: assetReturn,
          currency,
          fxTicker,
          fxReturn,
          returnInPLN,
          startDate: periodData.startDate,
          endDate: periodData.endDate,
          startPrice: periodData.startPrice,
          endPrice: periodData.endPrice
        });
      }
    });

    // Sort by return, highest to lowest
    return assetsWithReturns.sort((a, b) => b.return - a.return);
  };

  /**
   * Calculates current drawdown for an asset (how far current price is from ATH).
   * Returns drawdown percentage (negative or zero) and details for tooltip.
   */
  const getAssetCurrentDrawdown = (ticker: string): {
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

  /**
   * Gets the last price of each month for each asset over the past 13 months.
   * Used for the "Monthly Prices" tab.
   *
   * Returns:
   * - months: Array of 13 month labels (e.g., "Jan 2025", "Feb 2025", ...)
   * - assets: Array of asset data, each with ticker, name, and prices for each month
   * - Also calculates 10-month SMA and BUY/SELL signal
   */
  const getMonthlyPricesData = (): {
    months: string[];
    assets: Array<{
      ticker: string;
      name: string;
      prices: (number | null)[];  // 13 prices, null if no data
      sma10: number | null;       // 10-month SMA (average of last 10 months including current)
      signal: 'BUY' | 'SELL' | null;  // BUY if price > SMA, SELL if price < SMA
    }>;
  } => {
    if (!assetData || assetData.length === 0) {
      return { months: [], assets: [] };
    }

    // Use selectedEndDate or the last date in data as reference
    const endDateStr = selectedEndDate || assetData[assetData.length - 1].date;
    const endDate = new Date(endDateStr);

    // Generate 13 months (current month + 12 previous), oldest first
    const monthDates: Date[] = [];
    for (let i = 12; i >= 0; i--) {
      const monthDate = new Date(endDate.getFullYear(), endDate.getMonth() - i, 1);
      monthDates.push(monthDate);
    }

    // Format month labels in MMMYY format (e.g., "Jan25")
    const months = monthDates.map(d => {
      const monthName = d.toLocaleDateString('en-US', { month: 'short' });
      const yearShort = d.getFullYear().toString().slice(-2);
      return `${monthName}${yearShort}`;
    });

    // For each month, find the last trading day's price for each asset
    const getLastPriceOfMonth = (ticker: string, year: number, month: number): number | null => {
      // Find all rows in this month
      const monthRows = assetData.filter(row => {
        const rowDate = new Date(row.date);
        return rowDate.getFullYear() === year && rowDate.getMonth() === month;
      });

      // Get the last row with valid price
      for (let i = monthRows.length - 1; i >= 0; i--) {
        const price = Number(monthRows[i][ticker]);
        if (price && price > 0) {
          return price;
        }
      }
      return null;
    };

    // Build asset data
    const assets = assetLookup.map(asset => {
      const prices = monthDates.map(d =>
        getLastPriceOfMonth(asset.ticker, d.getFullYear(), d.getMonth())
      );

      // Calculate 10-month SMA (last 10 months including current)
      // Need at least 10 valid prices
      const last10Prices = prices.slice(-10).filter((p): p is number => p !== null);
      const sma10 = last10Prices.length >= 10
        ? last10Prices.reduce((sum, p) => sum + p, 0) / 10
        : null;

      // Current price is the last one
      const currentPrice = prices[prices.length - 1];

      // Signal: BUY if current > SMA, SELL if current < SMA
      let signal: 'BUY' | 'SELL' | null = null;
      if (currentPrice !== null && sma10 !== null) {
        signal = currentPrice > sma10 ? 'BUY' : 'SELL';
      }

      return {
        ticker: asset.ticker,
        name: asset.name,
        prices,
        sma10,
        signal
      };
    });

    return { months, assets };
  };

  /**
   * Generates a heatmap color based on value position in a min-max range.
   * Uses HSL color space: Hue 0 (red) = lowest, 60 (yellow) = middle, 120 (green) = highest
   *
   * @param value - The value to color
   * @param min - Minimum value in the range
   * @param max - Maximum value in the range
   * @returns HSL color string (e.g., "hsl(60, 80%, 85%)")
   */
  const getHeatmapColor = (value: number, min: number, max: number): string => {
    // Handle edge case where all values are the same
    if (min === max) {
      return 'hsl(60, 80%, 85%)';  // Neutral yellow
    }

    // Calculate position in range (0 = min, 1 = max)
    const position = (value - min) / (max - min);

    // Map position to hue: 0 (red) -> 60 (yellow) -> 120 (green)
    const hue = position * 120;

    // Return HSL color with fixed saturation and lightness for readability
    return `hsl(${hue}, 80%, 85%)`;
  };

  /**
   * Formats a price based on its magnitude for compact display.
   * - < 1: 3 decimal places (e.g., 0.123)
   * - 1-99: 2 decimal places (e.g., 12.34)
   * - 100-999: 1 decimal place (e.g., 123.4)
   * - >= 1000: 0 decimal places (e.g., 1234)
   */
  const formatPrice = (price: number): string => {
    if (price < 1) {
      return price.toFixed(3);
    } else if (price < 100) {
      return price.toFixed(2);
    } else if (price < 1000) {
      return price.toFixed(1);
    } else {
      return price.toFixed(0);
    }
  };

  /**
   * Runs the backtest for all configured portfolios
   */
  const runBacktest = () => {
    if (!assetData) {
      alert('Please wait for data to load');
      return;
    }

    // Calculate returns for each portfolio
    const results = portfolios.map(portfolio => {
      const returns = calculatePortfolioReturns(portfolio, assetData);
      const stats = calculateStatistics(returns, portfolio);
      return { portfolio, returns: returns!, stats: stats! };
    }).filter(r => r.returns !== null);  // Filter out invalid portfolios

    if (results.length === 0) {
      alert('No valid portfolios. Make sure weights sum to 100%');
      return;
    }

    setBacktestResults(results);
  };

  // ----------------------------------------
  // RENDER THE UI
  // ----------------------------------------

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-4 mb-4">

          {/* Header */}
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Portfolio Backtester</h1>

          {/* Data Status Section */}
          <div className="mb-6 p-4 bg-blue-50 rounded-lg">
            <h2 className="text-lg font-semibold text-gray-700 mb-3">Data</h2>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Refresh Data Button */}
              <button
                onClick={loadDataFromSheet}
                disabled={isLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold flex items-center gap-2 disabled:opacity-50"
              >
                <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
                {isLoading ? 'Loading...' : 'Refresh Data'}
              </button>
            </div>

            {/* Status Message */}
            <div className={`mt-3 text-sm ${
              loadingMessage.includes('Loaded') ? 'text-green-600' :
              loadingMessage.includes('Error') ? 'text-red-600' :
              'text-gray-600'
            }`}>
              {loadingMessage || 'Ready'}
            </div>
          </div>

          {/* View Toggle Buttons - Only show when data is loaded */}
          {/* These act like tabs: click one to switch between the three views */}
          {isConnected && assetData && (
            <div className="mb-6 flex gap-2 flex-wrap">
              <button
                onClick={() => setActiveView('backtest')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  activeView === 'backtest'
                    ? 'bg-indigo-600 text-white'           // Active: highlighted
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'  // Inactive: muted
                }`}
              >
                Portfolio Backtest
              </button>
              <button
                onClick={() => setActiveView('annualReturns')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  activeView === 'annualReturns'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Assets Annual Returns
              </button>
              <button
                onClick={() => setActiveView('bestToWorst')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  activeView === 'bestToWorst'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Best To Worst
              </button>
              <button
                onClick={() => setActiveView('monthlyPrices')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  activeView === 'monthlyPrices'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Monthly Prices
              </button>
            </div>
          )}

          {/* Show the rest of the UI only when data is loaded */}
          {isConnected && assetData && activeView === 'backtest' && (
            <>
              {/* Parameters Section */}
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-lg font-semibold text-gray-700">Parameters</h2>
                  {/* Quick date range presets */}
                  <div className="flex gap-1">
                    {(['YTD', '1Y', '2Y', '3Y', '4Y', '5Y'] as const).map(preset => (
                      <button
                        key={preset}
                        onClick={() => setDatePreset(preset)}
                        className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-100 font-medium"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {/* Start Date */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                    <select
                      value={selectedDateRange.start}
                      onChange={(e) => setSelectedStartDate(e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      {assetData.map(row => (
                        <option key={row.date} value={row.date}>{row.date}</option>
                      ))}
                    </select>
                  </div>

                  {/* End Date */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                    <select
                      value={selectedDateRange.end}
                      onChange={(e) => setSelectedEndDate(e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      {assetData.slice().reverse().filter(row => row.date >= selectedDateRange.start).map(row => (
                        <option key={row.date} value={row.date}>{row.date}</option>
                      ))}
                    </select>
                  </div>

                  {/* Starting Capital */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Starting Capital ($)</label>
                    <input
                      type="number"
                      value={startingCapital}
                      onChange={(e) => setStartingCapital(parseFloat(e.target.value))}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </div>

                  {/* Rebalance Frequency */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Rebalance</label>
                    <select
                      value={rebalanceFreq}
                      onChange={(e) => setRebalanceFreq(e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Portfolios Section */}
              <div className="mb-6">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-lg font-semibold text-gray-700">Portfolios</h2>
                  <button
                    onClick={addPortfolio}
                    className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1 text-sm"
                  >
                    <Plus className="w-4 h-4" />Add
                  </button>
                </div>

                {/* Portfolio Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {portfolios.map(portfolio => {
                    const totalWeight = getTotalWeight(portfolio);
                    const isValid = Math.abs(totalWeight - 100) < 0.01;

                    return (
                      <div key={portfolio.id} className="border-2 border-gray-200 rounded-lg p-3">
                        {/* Portfolio Name & Delete */}
                        <div className="flex justify-between items-center mb-2">
                          <input
                            type="text"
                            value={portfolio.name}
                            onChange={(e) => handlePortfolioNameChange(portfolio.id, e.target.value)}
                            className="font-semibold text-gray-800 bg-transparent border-b border-gray-300 focus:border-blue-500 outline-none flex-1 text-sm"
                          />
                          {portfolios.length > 1 && (
                            <button
                              onClick={() => removePortfolio(portfolio.id)}
                              className="text-red-500 hover:text-red-700 ml-2"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>

                        {/* Asset List */}
                        <div className="space-y-2 mb-2">
                          {portfolio.assets.map((asset, idx) => (
                            <div key={idx} className="flex gap-1 items-center">
                              {/* Asset Selector - min-w-0 allows shrinking, flex-1 fills remaining space */}
                              <select
                                value={asset.asset}
                                onChange={(e) => updateAsset(portfolio.id, idx, 'asset', e.target.value)}
                                className="flex-1 min-w-0 px-1 py-1 text-xs border border-gray-300 rounded"
                              >
                                <option value="">Select...</option>
                                {availableAssetsFiltered.map(a => (
                                  <option key={a} value={a}>{getAssetDisplayName(a)}</option>
                                ))}
                              </select>
                              {/* FX Selector - converts asset prices to PLN */}
                              <select
                                value={asset.fx}
                                onChange={(e) => updateAsset(portfolio.id, idx, 'fx', e.target.value)}
                                className="w-14 px-1 py-1 text-xs border border-gray-300 rounded shrink-0"
                                title="Currency conversion to PLN"
                              >
                                <option value="">-</option>
                                <option value="USDPLN">USD</option>
                                <option value="SGDPLN">SGD</option>
                                <option value="CHFPLN">CHF</option>
                                <option value="EURPLN">EUR</option>
                              </select>
                              {/* Weight Input */}
                              <input
                                type="number"
                                value={asset.weight}
                                onChange={(e) => updateAsset(portfolio.id, idx, 'weight', parseFloat(e.target.value) || 0)}
                                placeholder="%"
                                className="w-12 px-1 py-1 text-xs border border-gray-300 rounded shrink-0"
                              />
                              {/* Remove Asset */}
                              <button
                                onClick={() => removeAsset(portfolio.id, idx)}
                                className="text-red-500 hover:text-red-700 shrink-0"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Add Asset Button */}
                        <button
                          onClick={() => addAssetToPortfolio(portfolio.id)}
                          className="w-full py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                        >
                          + Add Asset
                        </button>

                        {/* Weight Validation */}
                        <div className={`mt-2 text-xs font-medium ${isValid ? 'text-green-600' : 'text-red-600'}`}>
                          Total: {totalWeight.toFixed(0)}% {isValid ? '✓' : '(need 100%)'}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Run Backtest Button */}
                <button
                  onClick={runBacktest}
                  className="mt-4 w-full py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700"
                >
                  Run Backtest
                </button>
              </div>
            </>
          )}

          {/* Results Section - Only shown after running backtest AND when in backtest view */}
          {backtestResults && activeView === 'backtest' && (
            <div className="mt-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Results</h2>

              {/* Portfolio Value Chart */}
              <div className="bg-white p-2 sm:p-4 rounded-lg shadow mb-4">
                <h3 className="text-md font-semibold text-gray-700 mb-2 text-center">Portfolio Value</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" type="category" allowDuplicatedCategory={false} tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} width={55} domain={['auto', 'auto']} />
                    <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
                    <Legend />
                    {backtestResults.map((result, idx) => (
                      <Line
                        key={idx}
                        data={result.returns}
                        type="monotone"
                        dataKey="value"
                        name={result.portfolio.name}
                        stroke={result.portfolio.color}
                        strokeWidth={2}
                        dot={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Drawdown Chart */}
              <div className="bg-white p-2 sm:p-4 rounded-lg shadow mb-4">
                <h3 className="text-md font-semibold text-gray-700 mb-2 text-center">Drawdown</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" type="category" allowDuplicatedCategory={false} tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} width={55} />
                    <Tooltip formatter={(value: number) => `${value.toFixed(2)}%`} />
                    <Legend />
                    {backtestResults.map((result, idx) => (
                      <Line
                        key={idx}
                        data={result.returns}
                        type="monotone"
                        dataKey="drawdown"
                        name={result.portfolio.name}
                        stroke={result.portfolio.color}
                        strokeWidth={2}
                        dot={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Statistics Table */}
              <div className="bg-white p-4 rounded-lg shadow overflow-x-auto">
                <h3 className="text-md font-semibold text-gray-700 mb-2">Statistics</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b-2 border-gray-200">
                      <th className="text-left py-2 px-2">Portfolio</th>
                      <th className="text-right py-2 px-2">Return</th>
                      <th className="text-right py-2 px-2">CAGR</th>
                      <th className="text-right py-2 px-2">Vol</th>
                      <th className="text-right py-2 px-2">Sharpe</th>
                      <th className="text-right py-2 px-2">Max DD</th>
                      <th className="text-right py-2 px-2">Curr DD</th>
                      <th className="text-right py-2 px-2">End $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backtestResults.map((result, idx) => (
                      <tr key={idx} className="border-b border-gray-100">
                        <td className="py-2 px-2 font-medium" style={{ color: result.portfolio.color }}>
                          {result.stats.name}
                        </td>
                        <td className="text-right py-2 px-2">{result.stats.totalReturn}%</td>
                        <td className="text-right py-2 px-2">{result.stats.cagr}%</td>
                        <td className="text-right py-2 px-2">{result.stats.volatility}%</td>
                        <td className="text-right py-2 px-2">{result.stats.sharpeRatio}</td>
                        <td className="text-right py-2 px-2 text-red-600">{result.stats.maxDrawdown}%</td>
                        <td className="text-right py-2 px-2 text-orange-600">{result.stats.currentDrawdown}%</td>
                        <td className="text-right py-2 px-2 font-semibold">${result.stats.endingValue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Monthly Returns Tables */}
              {backtestResults.map((result, idx) => {
                const monthlyReturns = calculateMonthlyReturns(result.returns);

                return (
                  <div key={idx} className="bg-white p-4 rounded-lg shadow overflow-x-auto mt-4">
                    <h3 className="text-md font-semibold mb-2" style={{ color: result.portfolio.color }}>
                      Returns - {result.portfolio.name}
                    </h3>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b-2 border-gray-200">
                          <th className="text-left py-2 px-2 bg-gray-50 sticky left-0">Year</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Jan</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Feb</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Mar</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Apr</th>
                          <th className="text-right py-2 px-2 bg-gray-50">May</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Jun</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Jul</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Aug</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Sep</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Oct</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Nov</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Dec</th>
                          <th className="text-right py-2 px-2 bg-gray-100 font-semibold">FY</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(monthlyReturns).sort().reverse().map(year => (
                          <tr key={year} className="border-b border-gray-100">
                            <td className="py-2 px-2 font-medium bg-gray-50 sticky left-0">{year}</td>
                            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(month => {
                              const ret = monthlyReturns[year].monthly[month];
                              if (ret === null) {
                                return <td key={month} className="text-right py-2 px-2 text-gray-300">-</td>;
                              }
                              const bgColor = ret >= 0 ? 'bg-green-50' : 'bg-red-50';
                              const textColor = ret >= 0 ? 'text-green-700' : 'text-red-700';
                              return (
                                <td key={month} className={`text-right py-2 px-2 ${bgColor} ${textColor}`}>
                                  {ret.toFixed(2)}%
                                </td>
                              );
                            })}
                            <td className={`text-right py-2 px-2 font-semibold ${
                              monthlyReturns[year].fy >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {monthlyReturns[year].fy.toFixed(2)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}

          {/* Assets Annual Returns Section - Shown when in annualReturns view */}
          {/* This table shows yearly returns for ALL assets in the lookup table */}
          {isConnected && assetData && activeView === 'annualReturns' && (
            <div className="mt-2">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Assets Annual Returns</h2>

              {(() => {
                // Calculate annual returns for all assets
                const annualReturns = calculateAssetsAnnualReturns();
                const years = getYearsWithData(annualReturns);

                // If no lookup table or no data, show a message
                if (assetLookup.length === 0) {
                  return (
                    <div className="bg-yellow-50 p-4 rounded-lg text-yellow-800">
                      No assets in lookup table. Please add assets to your lookup sheet.
                    </div>
                  );
                }

                // Helper to get sort value for an asset based on column
                const getSortValue = (ticker: string, column: string | number | null): number => {
                  if (column === null) return 0;

                  // Year columns (numeric)
                  if (typeof column === 'number') {
                    const data = annualReturns[ticker]?.[column];
                    return data ? data.return : -Infinity;
                  }

                  // Period column
                  if (column === 'Period') {
                    const priceRange = getAssetPriceRange(ticker);
                    return priceRange ? priceRange.months : -Infinity;
                  }

                  // CAGR column
                  if (column === 'CAGR') {
                    const priceRange = getAssetPriceRange(ticker);
                    if (!priceRange) return -Infinity;
                    return calculateCAGR(priceRange.firstPrice, priceRange.lastPrice, priceRange.months);
                  }

                  // Current DD column (higher = better, so ATH = 0 is best)
                  if (column === 'CurrDD') {
                    const ddData = getAssetCurrentDrawdown(ticker);
                    return ddData ? ddData.drawdown : -Infinity;
                  }

                  // Period return columns (1Y, 2Y, etc.)
                  const periodMatch = column.toString().match(/^(\d)Y$/);
                  if (periodMatch) {
                    const years = parseInt(periodMatch[1]);
                    const periodData = getPeriodReturn(ticker, years);
                    return periodData ? periodData.return : -Infinity;
                  }

                  return 0;
                };

                // Sort assets based on selected column (highest to lowest)
                const sortedAssetLookup = [...assetLookup].sort((a, b) => {
                  if (annualReturnsSortColumn === null) return 0;
                  const aVal = getSortValue(a.ticker, annualReturnsSortColumn);
                  const bVal = getSortValue(b.ticker, annualReturnsSortColumn);
                  return bVal - aVal;  // Descending order (best first)
                });

                // Helper for sortable header styling
                const getSortableHeaderClass = (column: string | number, baseClass: string) => {
                  const isSelected = annualReturnsSortColumn === column;
                  return `${baseClass} cursor-pointer hover:bg-blue-100 select-none ${isSelected ? 'bg-blue-200 font-bold' : ''}`;
                };

                return (
                  <div className="bg-white p-4 rounded-lg shadow overflow-auto max-h-[70vh]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 z-20">
                        <tr className="border-b-2 border-gray-200">
                          {/* Asset Name column - sticky both top and left */}
                          <th className="text-left py-2 px-2 bg-gray-100 sticky left-0 z-30 min-w-[150px]">
                            Asset
                          </th>
                          {/* Ticker column */}
                          <th className="text-left py-2 px-2 bg-gray-100">Ticker</th>
                          {/* Year columns - oldest to newest, clickable for sorting */}
                          {years.map(year => (
                            <th
                              key={year}
                              className={getSortableHeaderClass(year, 'text-right py-2 px-2 bg-gray-100 min-w-[60px]')}
                              onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === year ? null : year)}
                            >
                              {year}
                            </th>
                          ))}
                          {/* Period column - shows data history length */}
                          <th
                            className={getSortableHeaderClass('Period', 'text-right py-2 px-2 bg-gray-200 min-w-[60px]')}
                            onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === 'Period' ? null : 'Period')}
                          >
                            Period
                          </th>
                          {/* CAGR column - compound annual growth rate */}
                          <th
                            className={getSortableHeaderClass('CAGR', 'text-right py-2 px-2 bg-gray-200 min-w-[60px]')}
                            onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === 'CAGR' ? null : 'CAGR')}
                          >
                            CAGR
                          </th>
                          {/* Current Drawdown column - distance from ATH */}
                          <th
                            className={getSortableHeaderClass('CurrDD', 'text-right py-2 px-2 bg-gray-200 min-w-[55px]')}
                            onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === 'CurrDD' ? null : 'CurrDD')}
                          >
                            Curr DD
                          </th>
                          {/* Empty separator column */}
                          <th className="py-2 px-1 bg-gray-100 w-2"></th>
                          {/* Period return columns (1Y-5Y) */}
                          {['1Y', '2Y', '3Y', '4Y', '5Y'].map(period => (
                            <th
                              key={period}
                              className={getSortableHeaderClass(period, 'text-right py-2 px-2 bg-gray-100 min-w-[50px]')}
                              onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === period ? null : period)}
                            >
                              {period}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {/* One row per asset in the lookup table, sorted by selected column */}
                        {sortedAssetLookup.map((asset, idx) => (
                          <tr key={asset.ticker} className={`border-b border-gray-100 ${idx % 2 === 0 ? '' : 'bg-gray-25'}`}>
                            {/* Asset name - sticky left column */}
                            <td className="py-2 px-2 font-medium bg-gray-50 sticky left-0 z-10">
                              {asset.name}
                            </td>
                            {/* Ticker symbol */}
                            <td className="py-2 px-2 text-gray-600">{asset.ticker}</td>
                            {/* Annual return for each year */}
                            {years.map(year => {
                              const data = annualReturns[asset.ticker]?.[year];

                              // No data for this year = empty cell
                              if (!data) {
                                return (
                                  <td key={year} className="text-right py-2 px-2 text-gray-300">
                                    -
                                  </td>
                                );
                              }

                              // Color based on positive/negative return
                              const bgColor = data.return >= 0 ? 'bg-green-50' : 'bg-red-50';
                              const textColor = data.return >= 0 ? 'text-green-700' : 'text-red-700';

                              return (
                                <td
                                  key={year}
                                  className={`text-right py-2 px-2 ${bgColor} ${textColor} cursor-help`}
                                  title={getReturnTooltip(asset.ticker, year, annualReturns)}
                                >
                                  {data.return.toFixed(1)}%
                                </td>
                              );
                            })}
                            {/* Period and CAGR columns */}
                            {(() => {
                              const priceRange = getAssetPriceRange(asset.ticker);
                              if (!priceRange) {
                                return (
                                  <>
                                    <td className="text-right py-2 px-2 text-gray-300">-</td>
                                    <td className="text-right py-2 px-2 text-gray-300">-</td>
                                  </>
                                );
                              }

                              const cagr = calculateCAGR(priceRange.firstPrice, priceRange.lastPrice, priceRange.months);
                              const cagrColor = cagr >= 0 ? 'text-green-700' : 'text-red-700';
                              const cagrBg = cagr >= 0 ? 'bg-green-100' : 'bg-red-100';

                              // Tooltip for CAGR showing the calculation details
                              const cagrTooltip = `${priceRange.firstDate} ($${priceRange.firstPrice.toFixed(2)}) → ${priceRange.lastDate} ($${priceRange.lastPrice.toFixed(2)})`;

                              return (
                                <>
                                  <td className="text-right py-2 px-2 bg-gray-50 text-gray-600">
                                    {formatPeriod(priceRange.months)}
                                  </td>
                                  <td
                                    className={`text-right py-2 px-2 ${cagrBg} ${cagrColor} font-semibold cursor-help`}
                                    title={cagrTooltip}
                                  >
                                    {cagr.toFixed(1)}%
                                  </td>
                                </>
                              );
                            })()}
                            {/* Current Drawdown column */}
                            {(() => {
                              const ddData = getAssetCurrentDrawdown(asset.ticker);
                              if (!ddData) {
                                return <td className="text-right py-2 px-2 text-gray-300">-</td>;
                              }

                              const formatDate = (dateStr: string): string => {
                                const date = new Date(dateStr);
                                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                              };

                              const tooltip = ddData.isAtATH
                                ? `At All-Time High: $${ddData.currentPrice.toFixed(2)} (${formatDate(ddData.currentDate)})`
                                : `Current: $${ddData.currentPrice.toFixed(2)} (${formatDate(ddData.currentDate)}) vs ATH: $${ddData.athPrice.toFixed(2)} (${formatDate(ddData.athDate)}) = ${ddData.drawdown.toFixed(1)}%`;

                              if (ddData.isAtATH) {
                                return (
                                  <td
                                    className="text-right py-2 px-2 bg-green-100 text-green-700 font-semibold cursor-help"
                                    title={tooltip}
                                  >
                                    ATH
                                  </td>
                                );
                              }

                              return (
                                <td
                                  className="text-right py-2 px-2 bg-orange-50 text-orange-700 cursor-help"
                                  title={tooltip}
                                >
                                  {ddData.drawdown.toFixed(1)}%
                                </td>
                              );
                            })()}
                            {/* Empty separator column */}
                            <td className="py-2 px-1 bg-gray-50"></td>
                            {/* Period return columns (1Y-5Y) */}
                            {[1, 2, 3, 4, 5].map(years => {
                              const periodData = getPeriodReturn(asset.ticker, years);

                              if (!periodData) {
                                return (
                                  <td key={years} className="text-right py-2 px-2 text-gray-300">
                                    -
                                  </td>
                                );
                              }

                              const bgColor = periodData.return >= 0 ? 'bg-green-50' : 'bg-red-50';
                              const textColor = periodData.return >= 0 ? 'text-green-700' : 'text-red-700';

                              return (
                                <td
                                  key={years}
                                  className={`text-right py-2 px-2 ${bgColor} ${textColor} cursor-help`}
                                  title={getPeriodReturnTooltip(periodData)}
                                >
                                  {periodData.return.toFixed(1)}%
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Legend/explanation */}
                    <div className="mt-4 text-xs text-gray-500">
                      <p>Hover over any cell to see calculation details (start price, end price, dates).</p>
                      <p className="mt-1">
                        <span className="inline-block w-3 h-3 bg-green-50 border border-green-200 mr-1"></span>
                        Positive return
                        <span className="inline-block w-3 h-3 bg-red-50 border border-red-200 ml-3 mr-1"></span>
                        Negative return
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Best To Worst Section - Shows assets ranked by return for a selected year */}
          {isConnected && assetData && activeView === 'bestToWorst' && (
            <div className="mt-2">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Best To Worst</h2>

              {(() => {
                // Calculate annual returns for all assets
                const annualReturns = calculateAssetsAnnualReturns();
                const years = getYearsWithData(annualReturns);

                // If no lookup table or no data, show a message
                if (assetLookup.length === 0 || years.length === 0) {
                  return (
                    <div className="bg-yellow-50 p-4 rounded-lg text-yellow-800">
                      No assets in lookup table or no annual return data available.
                    </div>
                  );
                }

                // Default to most recent year if not yet set
                const currentYear = selectedRankingYear ?? years[years.length - 1];

                // Get sorted assets based on mode (year or period)
                const isYearMode = bestToWorstMode === 'year';
                const sortedAssets = isYearMode
                  ? getSortedAssetsByReturn(currentYear, annualReturns)
                  : getSortedAssetsByPeriodReturn(bestToWorstMode as number);

                // Column header text
                const returnColumnHeader = isYearMode
                  ? `${currentYear} Return`
                  : `${bestToWorstMode}Y Return`;

                return (
                  <div className="bg-white p-4 rounded-lg shadow">
                    {/* Year Dropdown and Period Buttons */}
                    <div className="mb-4 flex flex-wrap items-end gap-4">
                      {/* Year Dropdown */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Select Year</label>
                        <select
                          value={currentYear}
                          onChange={(e) => {
                            setSelectedRankingYear(parseInt(e.target.value));
                            setBestToWorstMode('year');  // Switch to year mode when selecting a year
                          }}
                          className={`px-3 py-2 border rounded-lg text-sm ${isYearMode ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}
                        >
                          {/* Most recent year first */}
                          {years.slice().reverse().map(year => (
                            <option key={year} value={year}>{year}</option>
                          ))}
                        </select>
                      </div>
                      {/* Period Buttons */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Or select period</label>
                        <div className="flex gap-1">
                          {([1, 2, 3, 4, 5] as const).map(period => (
                            <button
                              key={period}
                              onClick={() => setBestToWorstMode(period)}
                              className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                                bestToWorstMode === period
                                  ? 'bg-blue-500 text-white border-blue-500'
                                  : 'bg-white border-gray-300 hover:bg-gray-100'
                              }`}
                            >
                              {period}Y
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Ranked Table - Shows Bar Chart, Return, Asset, Ticker, Currency, Return in PLN */}
                    {(() => {
                      // Calculate max positive and max negative returns separately for proper scaling
                      // This ensures the best positive return fills the right side completely
                      // and the worst negative return fills the left side completely
                      const positiveReturns = sortedAssets.filter(a => a.return > 0).map(a => a.return);
                      const negativeReturns = sortedAssets.filter(a => a.return < 0).map(a => Math.abs(a.return));
                      const maxPositive = positiveReturns.length > 0 ? Math.max(...positiveReturns) : 1;
                      const maxNegative = negativeReturns.length > 0 ? Math.max(...negativeReturns) : 1;

                      return (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <th className="py-1 px-1 bg-gray-50 w-24"></th>
                              <th className="text-right py-1 px-2 bg-gray-50 w-16">{returnColumnHeader}</th>
                              <th className="text-left py-1 px-2 bg-gray-50">Asset</th>
                              <th className="text-left py-1 px-2 bg-gray-50 w-16">Ticker</th>
                              <th className="text-center py-1 px-2 bg-gray-50 w-12">Ccy</th>
                              <th className="text-right py-1 px-2 bg-gray-100 w-20">PLN Return</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedAssets.map((asset, idx) => {
                              // Color based on positive/negative return
                              const textColor = asset.return >= 0 ? 'text-green-700' : 'text-red-700';
                              const plnTextColor = asset.returnInPLN >= 0 ? 'text-green-700' : 'text-red-700';

                              // Build tooltip for Return column
                              // For year mode, use annual return tooltip; for period mode, use period return tooltip
                              let returnTooltip = '';
                              if (isYearMode) {
                                returnTooltip = getReturnTooltip(asset.ticker, currentYear, annualReturns);
                              } else {
                                // Period mode - asset has startDate, endDate, startPrice, endPrice
                                // Type assertion through unknown for period mode assets
                                const periodAsset = asset as unknown as { startDate: string; startPrice: number; endDate: string; endPrice: number; return: number };
                                returnTooltip = getPeriodReturnTooltip({
                                  startDate: periodAsset.startDate,
                                  startPrice: periodAsset.startPrice,
                                  endDate: periodAsset.endDate,
                                  endPrice: periodAsset.endPrice,
                                  return: periodAsset.return
                                });
                              }

                              // Build tooltip for PLN Return column
                              // Show formula: "(1 + 10.0%) × (1 + 5.2% USDPLN) - 1 = 15.7%"
                              let plnReturnTooltip = '';
                              if (asset.fxReturn !== null && asset.fxTicker) {
                                const assetReturnSign = asset.return >= 0 ? '+' : '';
                                const fxReturnSign = asset.fxReturn >= 0 ? '+' : '';
                                const plnReturnSign = asset.returnInPLN >= 0 ? '+' : '';
                                plnReturnTooltip = `(1 ${assetReturnSign} ${asset.return.toFixed(1)}%) × (1 ${fxReturnSign} ${asset.fxReturn.toFixed(1)}% ${asset.fxTicker}) - 1 = ${plnReturnSign}${asset.returnInPLN.toFixed(1)}%`;
                              } else if (asset.currency === 'PLN') {
                                plnReturnTooltip = 'PLN asset - no currency conversion needed';
                              } else {
                                plnReturnTooltip = 'No FX data available for conversion';
                              }

                              // Calculate bar width as percentage (0-50% of cell, since bars go left or right from center)
                              // Scale positive returns against max positive, negative against max negative
                              const isPositive = asset.return >= 0;
                              const barWidth = isPositive
                                ? (asset.return / maxPositive) * 50
                                : (Math.abs(asset.return) / maxNegative) * 50;

                              return (
                                <tr key={asset.ticker} className={`border-b border-gray-50 ${idx % 2 === 0 ? '' : 'bg-gray-25'}`}>
                                  {/* Bar Chart Column */}
                                  <td className="py-1 px-1">
                                    <div className="relative h-4 w-full bg-gray-100 rounded overflow-hidden">
                                      {/* Center line */}
                                      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-300"></div>
                                      {/* Bar - positioned from center */}
                                      <div
                                        className={`absolute top-0.5 bottom-0.5 ${isPositive ? 'bg-green-500' : 'bg-red-500'}`}
                                        style={{
                                          width: `${barWidth}%`,
                                          left: isPositive ? '50%' : `${50 - barWidth}%`,
                                        }}
                                      ></div>
                                    </div>
                                  </td>
                                  <td
                                    className={`text-right py-1 px-2 font-medium ${textColor} cursor-help`}
                                    title={returnTooltip}
                                  >
                                    {asset.return.toFixed(1)}%
                                  </td>
                                  <td className="text-left py-1 px-2 text-gray-700">
                                    {asset.name}
                                  </td>
                                  <td className="text-left py-1 px-2 text-gray-500">
                                    {asset.ticker}
                                  </td>
                                  <td className="text-center py-1 px-2 text-gray-500">
                                    {asset.currency}
                                  </td>
                                  <td
                                    className={`text-right py-1 px-2 font-medium bg-gray-50 ${plnTextColor} cursor-help`}
                                    title={plnReturnTooltip}
                                  >
                                    {asset.returnInPLN.toFixed(1)}%
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      );
                    })()}

                    {/* Handle case when no assets have data for this year */}
                    {sortedAssets.length === 0 && (
                      <div className="text-center py-4 text-gray-500">
                        No asset data available for {currentYear}.
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Monthly Prices Section - Shows 13 months of raw prices with heatmap and signals */}
          {isConnected && assetData && activeView === 'monthlyPrices' && (
            <div className="mt-2">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Monthly Prices</h2>

              {(() => {
                const { months, assets } = getMonthlyPricesData();

                // If no lookup table or no data, show a message
                if (assetLookup.length === 0 || months.length === 0) {
                  return (
                    <div className="bg-yellow-50 p-4 rounded-lg text-yellow-800">
                      No assets in lookup table or no monthly price data available.
                    </div>
                  );
                }

                return (
                  <div className="bg-white p-4 rounded-lg shadow">
                    {/* Legend explaining the color scale and signals */}
                    <div className="mb-4 flex flex-wrap gap-4 text-xs text-gray-600">
                      <div className="flex items-center gap-2">
                        <span>Price heatmap (per row):</span>
                        <div className="flex items-center">
                          <div className="w-6 h-4 rounded-l" style={{ backgroundColor: 'hsl(0, 80%, 85%)' }}></div>
                          <div className="w-6 h-4" style={{ backgroundColor: 'hsl(60, 80%, 85%)' }}></div>
                          <div className="w-6 h-4 rounded-r" style={{ backgroundColor: 'hsl(120, 80%, 85%)' }}></div>
                        </div>
                        <span>Low → High</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span>Signal:</span>
                        <span className="px-2 py-0.5 rounded bg-green-100 text-green-700 font-medium">BUY</span>
                        <span>= Price &gt; 10m SMA</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 font-medium">SELL</span>
                        <span>= Price &lt; 10m SMA</span>
                      </div>
                    </div>

                    {/* Scrollable table container */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-gray-200">
                            {/* Asset Name - sticky left column */}
                            <th className="sticky left-0 z-10 text-left py-1 px-1 bg-gray-50 min-w-[160px] border-r border-gray-200">
                              Asset
                            </th>
                            {/* Month columns - oldest to newest (left to right) */}
                            {months.map((month, idx) => (
                              <th key={idx} className="text-right py-1 px-1 bg-gray-50 whitespace-nowrap">
                                {month}
                              </th>
                            ))}
                            {/* 10m SMA column */}
                            <th className="text-right py-1 px-1 bg-gray-100 whitespace-nowrap border-l border-gray-200">
                              10mSMA
                            </th>
                            {/* Signal column */}
                            <th className="text-center py-1 px-1 bg-gray-100">
                              Signal
                            </th>
                            {/* Ticker column */}
                            <th className="text-left py-1 px-1 bg-gray-100 border-l border-gray-200">
                              Ticker
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {assets.map((asset, rowIdx) => {
                            // Calculate min and max for this row's heatmap (only valid prices)
                            const validPrices = asset.prices.filter((p): p is number => p !== null);
                            const minPrice = validPrices.length > 0 ? Math.min(...validPrices) : 0;
                            const maxPrice = validPrices.length > 0 ? Math.max(...validPrices) : 0;

                            return (
                              <tr key={asset.ticker} className={`border-b border-gray-50 ${rowIdx % 2 === 0 ? '' : 'bg-gray-25'}`}>
                                {/* Asset Name - sticky left column */}
                                <td className="sticky left-0 z-10 text-left py-0.5 px-1 bg-white border-r border-gray-200 font-medium text-gray-700">
                                  {asset.name}
                                </td>
                                {/* Price cells with heatmap coloring */}
                                {asset.prices.map((price, colIdx) => (
                                  <td
                                    key={colIdx}
                                    className="text-right py-0.5 px-1 font-mono"
                                    style={{
                                      backgroundColor: price !== null ? getHeatmapColor(price, minPrice, maxPrice) : undefined,
                                      color: price !== null ? '#374151' : '#9ca3af'
                                    }}
                                  >
                                    {price !== null ? formatPrice(price) : '-'}
                                  </td>
                                ))}
                                {/* 10m SMA column */}
                                <td className="text-right py-0.5 px-1 bg-gray-50 font-mono border-l border-gray-200">
                                  {asset.sma10 !== null ? formatPrice(asset.sma10) : '-'}
                                </td>
                                {/* Signal column */}
                                <td className={`text-center py-0.5 px-1 font-medium ${
                                  asset.signal === 'BUY' ? 'bg-green-100 text-green-700' :
                                  asset.signal === 'SELL' ? 'bg-red-100 text-red-700' :
                                  'text-gray-400'
                                }`}>
                                  {asset.signal ?? '-'}
                                </td>
                                {/* Ticker column */}
                                <td className="text-left py-0.5 px-1 bg-gray-50 text-gray-500 border-l border-gray-200">
                                  {asset.ticker}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Show message if no assets */}
                    {assets.length === 0 && (
                      <div className="text-center py-4 text-gray-500">
                        No assets available.
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PortfolioBacktester;
