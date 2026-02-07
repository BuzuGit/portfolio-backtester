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

import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Area, ReferenceDot } from 'recharts';
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

// Trend Following data point for charting
// Used to track Buy & Hold vs Trend Following performance over time
interface TrendFollowingPoint {
  date: string;              // Date of the data point
  price: number;             // Raw asset price
  buyHoldValue: number;      // Growth of $1 for Buy & Hold strategy
  trendFollowingValue: number;  // Growth of $1 for Trend Following strategy
  sma10: number | null;      // 10-month Simple Moving Average
  signal: 'BUY' | 'SELL' | null;  // Current signal (BUY = invested, SELL = cash)
}

// Drawdown data for both strategies
interface TrendDrawdownPoint {
  date: string;
  buyHoldDrawdown: number;        // Buy & Hold drawdown percentage
  trendFollowingDrawdown: number; // Trend Following drawdown percentage
}

// Signal change event (when we switch from BUY to SELL or vice versa)
interface SignalChange {
  date: string;
  newSignal: 'BUY' | 'SELL';
  price: number;         // Price at signal change
  value: number;         // Trend Following portfolio value at this point
}

// Statistics for Buy & Hold vs Trend Following comparison
interface TrendStats {
  finalAmount: number;       // Final value of $1 invested
  cagr: number;              // Compound Annual Growth Rate %
  totalReturn: number;       // Total return %
  stdDev: number;            // Annualized standard deviation %
  maxDrawdown: number;       // Maximum drawdown % (negative)
  currentDrawdown: number;   // Current drawdown % (negative or zero)
  sharpeRatio: number;       // (CAGR - risk-free rate) / StdDev
}

// Monthly returns for Trend Following analysis
// Tracks both Buy & Hold and Trend Following monthly/yearly returns
interface TrendMonthlyReturns {
  [year: string]: {
    buyHold: (number | null)[];         // 12 months of Buy & Hold returns
    trendFollowing: (number | null)[];  // 12 months of Trend Following returns
    buyHoldFY: number;                   // Full year Buy & Hold return
    trendFollowingFY: number;            // Full year Trend Following return
  };
}

// ============================================
// MAIN COMPONENT
// ============================================

// Available FX conversion options for foreign currency assets
// Empty string = no conversion (prices used as-is)
// e.g., "USDPLN" = multiply asset prices by USD/PLN exchange rate
const FX_OPTIONS = ['', 'USDPLN', 'SGDPLN', 'CHFPLN', 'EURPLN'];

// Risk-free rate options for Trend Following calculations (0% to 5%, 0.5% increments)
// Used to calculate Sharpe Ratio and cash returns when out of market
const RISK_FREE_RATE_OPTIONS = [
  { value: 0.00, label: '0.0%' },
  { value: 0.005, label: '0.5%' },
  { value: 0.01, label: '1.0%' },
  { value: 0.015, label: '1.5%' },
  { value: 0.02, label: '2.0%' },
  { value: 0.025, label: '2.5%' },
  { value: 0.03, label: '3.0%' },
  { value: 0.035, label: '3.5%' },
  { value: 0.04, label: '4.0%' },
  { value: 0.045, label: '4.5%' },
  { value: 0.05, label: '5.0%' },
];

// Commission options for Trend Following (0% to 0.5%, 0.05% increments)
// Applied on each signal change (buy or sell)
const COMMISSION_OPTIONS = [
  { value: 0.00, label: '0.00%' },
  { value: 0.0005, label: '0.05%' },
  { value: 0.001, label: '0.10%' },
  { value: 0.0015, label: '0.15%' },
  { value: 0.002, label: '0.20%' },
  { value: 0.0025, label: '0.25%' },
  { value: 0.003, label: '0.30%' },
  { value: 0.0035, label: '0.35%' },
  { value: 0.004, label: '0.40%' },
  { value: 0.0045, label: '0.45%' },
  { value: 0.005, label: '0.50%' },
];

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
  const [startingCapital, setStartingCapital] = useState(1000000);      // How much $ to start with
  const [rebalanceFreq, setRebalanceFreq] = useState('yearly');         // How often to rebalance
  const [withdrawalRate, setWithdrawalRate] = useState('4');             // Annual withdrawal rate %
  const [inflationRate, setInflationRate] = useState('2');               // Annual inflation rate % (compounds withdrawal upward each year)
  const [dateRange, setDateRange] = useState<DateRange>({ start: '', end: '' });  // Full data range
  const [selectedStartDate, setSelectedStartDate] = useState('');       // User-selected start
  const [selectedEndDate, setSelectedEndDate] = useState('');           // User-selected end

  // Results after running backtest
  const [backtestResults, setBacktestResults] = useState<BacktestResult[] | null>(null);

  // Which view is currently active: the backtest tool, assets annual returns table, or best-to-worst ranking
  // 'backtest' = show the portfolio configuration and backtest results
  // 'annualReturns' = show a table of yearly returns for all assets in the lookup table
  // 'bestToWorst' = show assets ranked by return for a selected year
  // 'monthlyPrices' = show monthly price heatmap with SMA signals
  // 'trendFollowing' = compare Buy & Hold vs 10-month SMA trend following strategy
  const [activeView, setActiveView] = useState<'backtest' | 'annualReturns' | 'bestToWorst' | 'monthlyPrices' | 'trendFollowing'>('backtest');

  // The year selected for the "Best To Worst" ranking view
  // Defaults to null, and will be set to the most recent year when data loads
  const [selectedRankingYear, setSelectedRankingYear] = useState<number | null>(null);

  // Sort column for Assets Annual Returns table
  // Can be a year number, 'Period', 'CAGR', 'CurrDD', '1Y', '2Y', '3Y', '4Y', '5Y', or null (default order)
  const [annualReturnsSortColumn, setAnnualReturnsSortColumn] = useState<string | number | null>(null);

  // Best To Worst view mode: 'year' for annual returns, or a number (1-5) for period returns
  // When null or 'year', the year dropdown is used. When 1-5, shows period returns.
  const [bestToWorstMode, setBestToWorstMode] = useState<'year' | 1 | 2 | 3 | 4 | 5>('year');

  // Trend Following tab state
  // Selected asset ticker for trend following analysis
  const [selectedTrendAsset, setSelectedTrendAsset] = useState<string>('');
  // Risk-free rate used when out of market (earning cash) and for Sharpe Ratio
  const [trendRiskFreeRate, setTrendRiskFreeRate] = useState(0.02);       // 2% default
  // Commission applied on each signal change (buy or sell)
  const [trendCommission, setTrendCommission] = useState(0.002);          // 0.2% default

  // Asset filtering state (shared across Annual Returns, Best To Worst, Monthly Prices tabs)
  // These filters let users narrow down which assets are displayed in the tables
  const [selectedAssetTickers, setSelectedAssetTickers] = useState<string[]>([]);
  const [selectedAssetClasses, setSelectedAssetClasses] = useState<string[]>([]);
  const [selectedCurrencies, setSelectedCurrencies] = useState<string[]>([]);
  // Tracks which filter dropdown is currently open (null = all closed)
  const [openFilterDropdown, setOpenFilterDropdown] = useState<'assets' | 'assetClass' | 'currency' | null>(null);

  // Which portfolio's withdrawal detail table to show (index into backtestResults)
  const [selectedDetailPortfolio, setSelectedDetailPortfolio] = useState(0);

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

      // Initialize filters to "all selected" when data loads
      // This ensures all assets are visible by default
      setSelectedAssetTickers(lookup.map(a => a.ticker));
      setSelectedAssetClasses(Array.from(new Set(lookup.map(a => a.assetClass).filter(Boolean))));
      setSelectedCurrencies(Array.from(new Set(lookup.map(a => a.currency).filter(Boolean))));

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
  // ASSET FILTERING FUNCTIONS
  // ----------------------------------------
  // These functions support the multi-select filters in Annual Returns, Best To Worst, and Monthly Prices tabs

  /**
   * Gets unique asset classes from the lookup table (sorted alphabetically).
   * Used to populate the Asset Class filter dropdown.
   */
  const getUniqueAssetClasses = (): string[] => {
    return Array.from(new Set(assetLookup.map(a => a.assetClass).filter(Boolean))).sort();
  };

  /**
   * Gets unique currencies from the lookup table (sorted alphabetically).
   * Used to populate the Currency filter dropdown.
   */
  const getUniqueCurrencies = (): string[] => {
    return Array.from(new Set(assetLookup.map(a => a.currency).filter(Boolean))).sort();
  };

  /**
   * Filters assetLookup based on selected assets, asset classes, and currencies.
   * Returns only assets that match ALL selected criteria (AND logic).
   * Empty asset class or currency fields are treated as matching any selection.
   */
  const getFilteredAssetLookup = (): typeof assetLookup => {
    return assetLookup.filter(asset =>
      selectedAssetTickers.includes(asset.ticker) &&
      (asset.assetClass === '' || selectedAssetClasses.includes(asset.assetClass)) &&
      (asset.currency === '' || selectedCurrencies.includes(asset.currency))
    );
  };

  /**
   * Selects or deselects all assets at once.
   * Called when user clicks "Select All" / "Deselect All" button.
   */
  const toggleAllAssets = (selectAll: boolean) => {
    setSelectedAssetTickers(selectAll ? assetLookup.map(a => a.ticker) : []);
  };

  /**
   * Selects or deselects all asset classes at once.
   */
  const toggleAllAssetClasses = (selectAll: boolean) => {
    setSelectedAssetClasses(selectAll ? getUniqueAssetClasses() : []);
  };

  /**
   * Selects or deselects all currencies at once.
   */
  const toggleAllCurrencies = (selectAll: boolean) => {
    setSelectedCurrencies(selectAll ? getUniqueCurrencies() : []);
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
   * Applies annual withdrawals to already-computed portfolio returns.
   * Simulates taking out a fixed % of the portfolio once per year.
   *
   * HOW IT WORKS:
   * - Starts with the same initial portfolio value
   * - Between withdrawals, the value grows/shrinks at the same rate as the original portfolio
   * - Every 12 months, we subtract the withdrawal percentage (e.g., 4% of current value)
   * - This lets you see: "Would my portfolio survive if I pulled out X% per year?"
   */
  const calculateWithdrawalReturns = (returns: ReturnPoint[], withdrawalPct: number, inflationPct: number = 0): { date: string; value: number }[] => {
    if (!returns || returns.length < 2) return [];

    const result: { date: string; value: number }[] = [];
    let withdrawalValue = returns[0].value;  // Start at same value as original portfolio
    result.push({ date: returns[0].date, value: withdrawalValue });

    let lastWithdrawalDate = new Date(returns[0].date);
    let yearNumber = 0;  // Tracks how many withdrawals have occurred (for inflation compounding)

    for (let i = 1; i < returns.length; i++) {
      // Scale the withdrawal-adjusted value by the same daily ratio as the original portfolio
      const dailyRatio = returns[i].value / returns[i - 1].value;
      withdrawalValue = withdrawalValue * dailyRatio;

      // Check if 12 months have passed since the last withdrawal
      const currentDate = new Date(returns[i].date);
      const monthsSinceLast =
        (currentDate.getFullYear() - lastWithdrawalDate.getFullYear()) * 12 +
        (currentDate.getMonth() - lastWithdrawalDate.getMonth());

      if (monthsSinceLast >= 12) {
        // Inflation-adjusted withdrawal: each year the effective rate compounds upward
        // e.g., 4% base with 2% inflation → year 1: 4.08%, year 2: 4.16%, etc.
        const effectiveRate = withdrawalPct * Math.pow(1 + inflationPct / 100, yearNumber);
        withdrawalValue = withdrawalValue * (1 - effectiveRate / 100);
        lastWithdrawalDate = currentDate;
        yearNumber++;
      }

      result.push({ date: returns[i].date, value: withdrawalValue });
    }

    return result;
  };

  /**
   * Builds a year-by-year breakdown of the withdrawal simulation.
   * This is the "show your work" version of calculateWithdrawalReturns —
   * it captures every number so you can verify the math in a table.
   *
   * Each row represents one year and shows:
   * - Starting value, growth, pre-withdrawal value, effective rate, withdrawal amount, and ending value
   */
  const getWithdrawalDetails = (returns: ReturnPoint[], withdrawalPct: number, inflationPct: number = 0) => {
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
    let lastWithdrawalDate = new Date(returns[0].date);
    let yearNumber = 0;
    let yearStartValue = portfolioValue;    // Value at the start of the current year
    let yearStartOriginal = returns[0].value;  // Original portfolio value at year start (for calculating return %)

    for (let i = 1; i < returns.length; i++) {
      // Scale by same daily ratio as original portfolio
      const dailyRatio = returns[i].value / returns[i - 1].value;
      portfolioValue = portfolioValue * dailyRatio;

      // Check if 12 months have passed since the last withdrawal
      const currentDate = new Date(returns[i].date);
      const monthsSinceLast =
        (currentDate.getFullYear() - lastWithdrawalDate.getFullYear()) * 12 +
        (currentDate.getMonth() - lastWithdrawalDate.getMonth());

      if (monthsSinceLast >= 12) {
        // Calculate return % for this year using the original portfolio's growth
        const originalValueNow = returns[i].value;
        const yearReturnPct = ((originalValueNow - yearStartOriginal) / yearStartOriginal) * 100;

        // Pre-withdrawal value (after growth, before taking money out)
        const preWithdrawalValue = portfolioValue;

        // Inflation-adjusted withdrawal rate (same formula as calculateWithdrawalReturns)
        const effectiveRate = withdrawalPct * Math.pow(1 + inflationPct / 100, yearNumber);

        // Dollar amount withdrawn
        const withdrawalAmount = portfolioValue * (effectiveRate / 100);

        // Apply withdrawal
        portfolioValue = portfolioValue * (1 - effectiveRate / 100);

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

  /**
   * Builds chart data for the Annual Returns bar chart.
   *
   * Creates an array where each element represents one year, with annual returns
   * for each portfolio. The structure is designed for Recharts grouped bar chart:
   *
   * Example output:
   * [
   *   { year: "2022", "Portfolio 1": 10.5, "Portfolio 2": -5.2 },
   *   { year: "2023", "Portfolio 1": 15.3, "Portfolio 2": 8.7 },
   *   ...
   * ]
   *
   * @param results - Array of backtest results containing portfolio returns
   * @returns Array of chart data points sorted by year (oldest to newest)
   */
  const getAnnualReturnsChartData = (
    results: BacktestResult[],
    startDate: string  // Used to filter out start year when start month is December
  ): Array<{ year: string; [portfolioName: string]: string | number }> => {
    if (!results || results.length === 0) return [];

    // Collect all years from all portfolios and their annual returns
    const yearData: { [year: string]: { [portfolioName: string]: number } } = {};

    results.forEach(result => {
      // Calculate monthly returns to get the FY (full year) returns
      const monthlyReturns = calculateMonthlyReturns(result.returns);

      // Extract each year's full-year return
      Object.keys(monthlyReturns).forEach(year => {
        if (!yearData[year]) {
          yearData[year] = {};
        }
        yearData[year][result.portfolio.name] = monthlyReturns[year].fy;
      });
    });

    // Determine if we should skip the start year (when start month is December)
    // When starting in December, that year only has one data point and shows 0% return
    const startDateObj = new Date(startDate);
    const startMonth = startDateObj.getMonth(); // 0-11, December = 11
    const startYear = startDateObj.getFullYear().toString();
    const skipStartYear = startMonth === 11; // December

    // Convert to array format for Recharts, sorted by year (oldest to newest)
    // Filter out start year if December (it would show 0% with only one data point)
    const chartData = Object.keys(yearData)
      .filter(year => !(skipStartYear && year === startYear))
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map(year => ({
        year,
        ...yearData[year]
      }));

    return chartData;
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
      signals: ('BUY' | 'SELL' | null)[];  // Signal at each of 13 months (for historical view)
    }>;
  } => {
    if (!assetData || assetData.length === 0) {
      return { months: [], assets: [] };
    }

    // Use selectedEndDate or the last date in data as reference
    const endDateStr = selectedEndDate || assetData[assetData.length - 1].date;
    const endDate = new Date(endDateStr);

    // Generate 22 months (9 extra for SMA lookback + 13 to display), oldest first
    // We need 22 months so we can calculate 10-month SMA for all 13 displayed months
    const allMonthDates: Date[] = [];
    for (let i = 21; i >= 0; i--) {
      const monthDate = new Date(endDate.getFullYear(), endDate.getMonth() - i, 1);
      allMonthDates.push(monthDate);
    }

    // Last 13 months for display (the months the user will see)
    const monthDates = allMonthDates.slice(-13);

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

    // Build asset data using filtered assets (respects user's filter selections)
    const filteredLookup = getFilteredAssetLookup();
    const assets = filteredLookup.map(asset => {
      // Fetch prices for all 22 months (needed for SMA calculation)
      const allPrices = allMonthDates.map(d =>
        getLastPriceOfMonth(asset.ticker, d.getFullYear(), d.getMonth())
      );

      // Last 13 prices for display
      const prices = allPrices.slice(-13);

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

      // Calculate signal at each of the 13 displayed months
      // Use allPrices (22 months) so we have lookback data for SMA at every displayed month
      const signals: ('BUY' | 'SELL' | null)[] = prices.map((price, displayIdx) => {
        if (price === null) return null;

        // Map display index (0-12) to allPrices index (9-21)
        // displayIdx 0 corresponds to allPrices index 9 (the 10th month in full history)
        const allPricesIdx = displayIdx + 9;

        // Get 10 prices ending at this month from allPrices
        const pricesForSMA = allPrices.slice(allPricesIdx - 9, allPricesIdx + 1)
          .filter((p): p is number => p !== null);
        if (pricesForSMA.length < 10) return null;

        const smaAtMonth = pricesForSMA.reduce((sum, p) => sum + p, 0) / 10;
        return price > smaAtMonth ? 'BUY' : 'SELL';
      });

      return {
        ticker: asset.ticker,
        name: asset.name,
        prices,
        sma10,
        signal,
        signals
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

  // ----------------------------------------
  // TREND FOLLOWING CALCULATION FUNCTIONS
  // ----------------------------------------

  /**
   * Calculates Buy & Hold vs 10-month SMA Trend Following analysis for a single asset.
   *
   * STRATEGY RULES:
   * 1. Calculate 10-month Simple Moving Average at each month-end
   * 2. If price > SMA → BUY signal (stay invested in asset)
   * 3. If price < SMA → SELL signal (exit to cash, earn monthly risk-free rate)
   * 4. On each signal change, apply commission: value *= (1 - commission)
   * 5. Analysis starts at month 11 (need 10 months for first SMA)
   *
   * @param ticker - Asset ticker to analyze
   * @param riskFreeRate - Annual risk-free rate (e.g., 0.02 for 2%)
   * @param commission - Commission per trade (e.g., 0.002 for 0.2%)
   * @returns Chart data, drawdown data, statistics, and signal changes
   */
  const calculateTrendFollowingAnalysis = (
    ticker: string,
    riskFreeRate: number,
    commission: number
  ): {
    chartData: TrendFollowingPoint[];
    drawdownData: TrendDrawdownPoint[];
    buyHoldStats: TrendStats;
    trendFollowingStats: TrendStats;
    signalChanges: SignalChange[];
    successRate: { rate: number; successful: number; total: number } | null;
  } | null => {
    if (!assetData || assetData.length === 0) return null;

    // Get monthly prices for this ticker within selected date range
    // Filter data to selected date range first
    const filteredData = assetData.filter(row =>
      row.date >= selectedDateRange.start && row.date <= selectedDateRange.end
    );

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

    // Track first price and SMA for normalization (so SMA can be shown on Growth of $1 chart)
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
        // Both buyHoldValue and trendFollowingValue stay at exactly $1 for first point
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

      // Calculate normalized SMA (so it can be shown on same scale as Growth of $1)
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

    // Calculate drawdowns
    const drawdownData = calculateTrendDrawdowns(chartData);

    // Calculate statistics for both strategies
    const buyHoldStats = calculateTrendStats(
      chartData.map(d => d.buyHoldValue),
      chartData.map(d => d.date),
      riskFreeRate
    );

    const trendFollowingStats = calculateTrendStats(
      chartData.map(d => d.trendFollowingValue),
      chartData.map(d => d.date),
      riskFreeRate
    );

    // Calculate success rate
    const successRate = calculateSuccessRate(signalChanges);

    return {
      chartData,
      drawdownData,
      buyHoldStats,
      trendFollowingStats,
      signalChanges,
      successRate
    };
  };

  /**
   * Calculates monthly and yearly returns for both Buy & Hold and Trend Following strategies.
   * Uses the chartData from calculateTrendFollowingAnalysis to compute returns.
   *
   * @param chartData - Array of TrendFollowingPoint data with monthly values
   * @param startDate - The start date of the analysis (to filter out December start years)
   * @returns TrendMonthlyReturns object organized by year
   */
  const calculateTrendMonthlyReturns = (
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
   * Builds chart data for the Trend Following Annual Returns bar chart.
   * Creates an array for Recharts grouped bar chart with Buy & Hold and Trend Following.
   *
   * @param monthlyReturns - TrendMonthlyReturns object with yearly FY returns
   * @returns Array of { year, "Buy & Hold": number, "Trend Following": number }
   */
  const getTrendAnnualReturnsChartData = (
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
   * Calculates drawdowns for both Buy & Hold and Trend Following strategies.
   * Drawdown = how far current value is below its peak (running maximum).
   *
   * @param chartData - Array of TrendFollowingPoint data
   * @returns Array of drawdown percentages for both strategies
   */
  const calculateTrendDrawdowns = (chartData: TrendFollowingPoint[]): TrendDrawdownPoint[] => {
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
   * Calculates statistics for a strategy's equity curve.
   *
   * @param equityCurve - Array of portfolio values over time
   * @param dates - Array of dates corresponding to equity values
   * @param riskFreeRate - Annual risk-free rate for Sharpe Ratio
   * @returns TrendStats object with all calculated metrics
   */
  const calculateTrendStats = (
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

    // Calculate years
    const startDate = new Date(dates[0]);
    const endDate = new Date(dates[dates.length - 1]);
    const years = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

    // CAGR
    const cagr = years > 0 ? (Math.pow(endValue / startValue, 1 / years) - 1) * 100 : 0;

    // Calculate monthly returns for standard deviation
    const monthlyReturns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      monthlyReturns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
    }

    // Standard deviation (annualized)
    const mean = monthlyReturns.reduce((sum, r) => sum + r, 0) / monthlyReturns.length;
    const variance = monthlyReturns.map(r => Math.pow(r - mean, 2)).reduce((sum, sq) => sum + sq, 0) / monthlyReturns.length;
    const stdDev = Math.sqrt(variance) * Math.sqrt(12) * 100;  // Annualized

    // Drawdowns
    let peak = 0;
    let maxDrawdown = 0;
    for (const value of equityCurve) {
      if (value > peak) {
        peak = value;
      }
      const drawdown = ((value - peak) / peak) * 100;
      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    // Current drawdown
    const currentDrawdown = ((endValue - peak) / peak) * 100;

    // Sharpe Ratio: (CAGR - risk-free rate) / StdDev
    const sharpeRatio = stdDev > 0 ? (cagr - riskFreeRate * 100) / stdDev : 0;

    return {
      finalAmount: endValue,
      cagr,
      totalReturn,
      stdDev,
      maxDrawdown,
      currentDrawdown,
      sharpeRatio
    };
  };

  /**
   * Calculates success rate for trend following signals.
   * Success = when we sell and then buy back cheaper (price dropped while we were out).
   *
   * A round-trip consists of:
   * - SELL signal at price X
   * - BUY signal at price Y
   * - Success if Y < X (we bought back cheaper than we sold)
   *
   * @param signalChanges - Array of signal change events
   * @returns Success rate percentage and counts
   */
  const calculateSuccessRate = (signalChanges: SignalChange[]): { rate: number; successful: number; total: number } | null => {
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
  // ASSET FILTER CONTROLS COMPONENT
  // ----------------------------------------
  // This is a reusable component that renders three compact collapsible filter dropdowns
  // (Assets, Asset Class, Currency) used in Annual Returns, Best To Worst, and Monthly Prices tabs

  const AssetFilterControls = () => {
    // Ref for click-outside detection
    const filterRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
          setOpenFilterDropdown(null);
        }
      };

      // Only add listener when a dropdown is open
      if (openFilterDropdown) {
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
      }
    }, [openFilterDropdown]);

    // Get the unique values for each dropdown
    const assetClasses = getUniqueAssetClasses();
    const currencies = getUniqueCurrencies();

    // Check if all items are selected (to show "Deselect All" vs "Select All")
    const allAssetsSelected = selectedAssetTickers.length === assetLookup.length;
    const allClassesSelected = selectedAssetClasses.length === assetClasses.length;
    const allCurrenciesSelected = selectedCurrencies.length === currencies.length;

    // Helper to get display text for the dropdown button
    const getSelectionText = (selected: number, total: number, label: string) => {
      if (selected === total) return `All ${label}`;
      if (selected === 0) return `No ${label}`;
      return `${selected} of ${total}`;
    };

    return (
      <div ref={filterRef} className="flex flex-wrap gap-2 mb-4">
        {/* Assets Dropdown */}
        <div className="relative">
          <button
            onClick={() => setOpenFilterDropdown(openFilterDropdown === 'assets' ? null : 'assets')}
            className={`px-3 py-1.5 text-sm border rounded-lg flex items-center gap-2 ${
              openFilterDropdown === 'assets' ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:bg-gray-50'
            }`}
          >
            <span className="font-medium">Assets:</span>
            <span className="text-gray-600">{getSelectionText(selectedAssetTickers.length, assetLookup.length, 'assets')}</span>
            <svg className={`w-4 h-4 transition-transform ${openFilterDropdown === 'assets' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openFilterDropdown === 'assets' && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-300 rounded-lg shadow-lg min-w-[280px]">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                <span className="text-sm font-medium text-gray-700">Select Assets</span>
                <button
                  onClick={() => toggleAllAssets(!allAssetsSelected)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {allAssetsSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto p-2">
                {assetLookup.map(asset => (
                  <label key={asset.ticker} className="flex items-center gap-2 py-1 px-2 text-sm cursor-pointer hover:bg-gray-100 rounded">
                    <input
                      type="checkbox"
                      checked={selectedAssetTickers.includes(asset.ticker)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedAssetTickers([...selectedAssetTickers, asset.ticker]);
                        } else {
                          setSelectedAssetTickers(selectedAssetTickers.filter(t => t !== asset.ticker));
                        }
                      }}
                    />
                    <span>{asset.ticker} - {asset.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Asset Class Dropdown */}
        <div className="relative">
          <button
            onClick={() => setOpenFilterDropdown(openFilterDropdown === 'assetClass' ? null : 'assetClass')}
            className={`px-3 py-1.5 text-sm border rounded-lg flex items-center gap-2 ${
              openFilterDropdown === 'assetClass' ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:bg-gray-50'
            }`}
          >
            <span className="font-medium">Class:</span>
            <span className="text-gray-600">{getSelectionText(selectedAssetClasses.length, assetClasses.length, 'classes')}</span>
            <svg className={`w-4 h-4 transition-transform ${openFilterDropdown === 'assetClass' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openFilterDropdown === 'assetClass' && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-300 rounded-lg shadow-lg min-w-[200px]">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                <span className="text-sm font-medium text-gray-700">Select Classes</span>
                <button
                  onClick={() => toggleAllAssetClasses(!allClassesSelected)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {allClassesSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto p-2">
                {assetClasses.map(assetClass => (
                  <label key={assetClass} className="flex items-center gap-2 py-1 px-2 text-sm cursor-pointer hover:bg-gray-100 rounded">
                    <input
                      type="checkbox"
                      checked={selectedAssetClasses.includes(assetClass)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedAssetClasses([...selectedAssetClasses, assetClass]);
                        } else {
                          setSelectedAssetClasses(selectedAssetClasses.filter(c => c !== assetClass));
                        }
                      }}
                    />
                    <span>{assetClass}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Currency Dropdown */}
        <div className="relative">
          <button
            onClick={() => setOpenFilterDropdown(openFilterDropdown === 'currency' ? null : 'currency')}
            className={`px-3 py-1.5 text-sm border rounded-lg flex items-center gap-2 ${
              openFilterDropdown === 'currency' ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:bg-gray-50'
            }`}
          >
            <span className="font-medium">Currency:</span>
            <span className="text-gray-600">{getSelectionText(selectedCurrencies.length, currencies.length, 'currencies')}</span>
            <svg className={`w-4 h-4 transition-transform ${openFilterDropdown === 'currency' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openFilterDropdown === 'currency' && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-300 rounded-lg shadow-lg min-w-[160px]">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                <span className="text-sm font-medium text-gray-700">Select Currencies</span>
                <button
                  onClick={() => toggleAllCurrencies(!allCurrenciesSelected)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {allCurrenciesSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto p-2">
                {currencies.map(currency => (
                  <label key={currency} className="flex items-center gap-2 py-1 px-2 text-sm cursor-pointer hover:bg-gray-100 rounded">
                    <input
                      type="checkbox"
                      checked={selectedCurrencies.includes(currency)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedCurrencies([...selectedCurrencies, currency]);
                        } else {
                          setSelectedCurrencies(selectedCurrencies.filter(c => c !== currency));
                        }
                      }}
                    />
                    <span>{currency}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
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
              <button
                onClick={() => setActiveView('trendFollowing')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  activeView === 'trendFollowing'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Trend Following
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

                  {/* Withdrawal Rate - annual % withdrawn from portfolio (e.g., for retirement spending) */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Withdrawal Rate (%)</label>
                    <select
                      value={withdrawalRate}
                      onChange={(e) => setWithdrawalRate(e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="2">2.0%</option>
                      <option value="2.5">2.5%</option>
                      <option value="3">3.0%</option>
                      <option value="3.5">3.5%</option>
                      <option value="4">4.0%</option>
                      <option value="4.5">4.5%</option>
                      <option value="5">5.0%</option>
                    </select>
                  </div>

                  {/* Inflation Rate - compounds the withdrawal upward each year to maintain purchasing power */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Inflation (%)</label>
                    <select
                      value={inflationRate}
                      onChange={(e) => setInflationRate(e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="0">0%</option>
                      <option value="1">1%</option>
                      <option value="2">2%</option>
                      <option value="3">3%</option>
                      <option value="4">4%</option>
                      <option value="5">5%</option>
                      <option value="6">6%</option>
                      <option value="7">7%</option>
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

              {/* Portfolio Value after Withdrawals Chart */}
              {/* Shows how the portfolio holds up when you withdraw a fixed % each year (e.g., in retirement) */}
              <div className="bg-white p-2 sm:p-4 rounded-lg shadow mb-4">
                <h3 className="text-md font-semibold text-gray-700 mb-2 text-center">
                  Portfolio Value after {parseFloat(withdrawalRate).toFixed(1)}% Withdrawals ({inflationRate}% Inflation)
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" type="category" allowDuplicatedCategory={false} tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} width={55} domain={['auto', 'auto']} />
                    <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
                    <Legend />
                    {backtestResults.map((result, idx) => {
                      const withdrawalData = calculateWithdrawalReturns(result.returns, parseFloat(withdrawalRate), parseFloat(inflationRate));
                      return (
                        <Line
                          key={idx}
                          data={withdrawalData}
                          type="monotone"
                          dataKey="value"
                          name={result.portfolio.name}
                          stroke={result.portfolio.color}
                          strokeWidth={2}
                          dot={false}
                        />
                      );
                    })}
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
                      <th className="text-right py-2 px-2">End $ Post W</th>
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
                        <td className="text-right py-2 px-2 font-semibold">${parseFloat(result.stats.endingValue).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                        <td className="text-right py-2 px-2 font-semibold">
                          {(() => {
                            // Calculate ending value after inflation-adjusted withdrawals
                            const wData = calculateWithdrawalReturns(result.returns, parseFloat(withdrawalRate), parseFloat(inflationRate));
                            const endVal = wData.length > 0 ? wData[wData.length - 1].value : 0;
                            return `$${endVal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Annual Returns Bar Chart */}
              {/* Shows grouped bars for each year, one bar per portfolio, colored to match line charts */}
              <div className="bg-white p-4 rounded-lg shadow mt-4">
                <h3 className="text-md font-semibold text-gray-700 mb-2">Annual Returns</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={getAnnualReturnsChartData(backtestResults, selectedDateRange.start)}
                    margin={{ top: 20, right: 5, left: 5, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="year" />
                    <YAxis hide domain={['auto', 'auto']} />
                    <Tooltip
                      formatter={(value: number) => [`${value.toFixed(1)}%`, '']}
                      labelFormatter={(label) => `Year: ${label}`}
                    />
                    <Legend />
                    {/* Create one Bar component for each portfolio */}
                    {backtestResults.map((result) => (
                      <Bar
                        key={result.portfolio.id}
                        dataKey={result.portfolio.name}
                        fill={result.portfolio.color}
                      >
                        {/* Labels for positive returns - positioned above bar */}
                        <LabelList
                          dataKey={result.portfolio.name}
                          position="top"
                          formatter={(value: number) => value >= 0 ? `${value.toFixed(1)}%` : ''}
                          style={{ fontSize: '11px', fill: '#666' }}
                        />
                        {/* Labels for negative returns - positioned below bar in red */}
                        <LabelList
                          dataKey={result.portfolio.name}
                          position="bottom"
                          formatter={(value: number) => value < 0 ? `${value.toFixed(1)}%` : ''}
                          style={{ fontSize: '11px', fill: '#ef4444' }}
                        />
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Monthly Returns Tables */}
              {backtestResults.map((result, idx) => {
                const monthlyReturns = calculateMonthlyReturns(result.returns);

                // Determine if we should skip the start year (when start month is December)
                // Same logic as the bar chart - December start years only have one data point
                const startDateObj = new Date(selectedDateRange.start);
                const startMonth = startDateObj.getMonth(); // 0-11, December = 11
                const startYear = startDateObj.getFullYear().toString();
                const skipStartYear = startMonth === 11; // December

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
                        {Object.keys(monthlyReturns)
                          .filter(year => !(skipStartYear && year === startYear))
                          .sort().reverse().map(year => (
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

              {/* Withdrawal Detail Table */}
              {/* Year-by-year breakdown of the withdrawal simulation so you can verify every number */}
              <div className="bg-white p-4 rounded-lg shadow overflow-x-auto mt-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-md font-semibold text-gray-700">Withdrawal Detail</h3>
                  {/* Dropdown to pick which portfolio's detail to show */}
                  <select
                    className="border rounded px-2 py-1 text-sm"
                    value={selectedDetailPortfolio}
                    onChange={(e) => setSelectedDetailPortfolio(parseInt(e.target.value))}
                  >
                    {backtestResults.map((result, idx) => (
                      <option key={idx} value={idx}>{result.portfolio.name}</option>
                    ))}
                  </select>
                </div>
                {(() => {
                  // Get the selected portfolio's withdrawal detail rows
                  const selectedResult = backtestResults[selectedDetailPortfolio] || backtestResults[0];
                  const details = getWithdrawalDetails(
                    selectedResult.returns,
                    parseFloat(withdrawalRate),
                    parseFloat(inflationRate)
                  );

                  if (details.length === 0) {
                    return <div className="text-center py-4 text-gray-500">Not enough data for withdrawal detail.</div>;
                  }

                  return (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b-2 border-gray-200">
                          <th className="text-right py-2 px-2">Year</th>
                          <th className="text-right py-2 px-2">Starting Value ($)</th>
                          <th className="text-right py-2 px-2">Return (%)</th>
                          <th className="text-right py-2 px-2">Pre-Withdrawal ($)</th>
                          <th className="text-right py-2 px-2">Eff. W Rate (%)</th>
                          <th className="text-right py-2 px-2">Withdrawal ($)</th>
                          <th className="text-right py-2 px-2">End Value ($)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.map((row) => (
                          <tr key={row.year} className="border-b border-gray-100">
                            <td className="text-right py-2 px-2">{row.year}</td>
                            <td className="text-right py-2 px-2">${row.startingValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                            <td className={`text-right py-2 px-2 ${row.returnPct >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                              {row.returnPct.toFixed(2)}%
                            </td>
                            <td className="text-right py-2 px-2">${row.preWithdrawalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                            <td className="text-right py-2 px-2">{row.effectiveRate.toFixed(2)}%</td>
                            <td className="text-right py-2 px-2 text-red-600">${row.withdrawalAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                            <td className="text-right py-2 px-2 font-semibold">${row.endValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Assets Annual Returns Section - Shown when in annualReturns view */}
          {/* This table shows yearly returns for ALL assets in the lookup table */}
          {isConnected && assetData && activeView === 'annualReturns' && (
            <div className="mt-2">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Assets Annual Returns</h2>

              {/* Filter controls for Assets, Asset Class, and Currency */}
              <AssetFilterControls />

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

                // Filter assets based on user selections, then sort by selected column
                const filteredAssets = getFilteredAssetLookup();
                const sortedAssetLookup = [...filteredAssets].sort((a, b) => {
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

                    {/* Show message if no assets match filters */}
                    {sortedAssetLookup.length === 0 && (
                      <div className="text-center py-4 text-gray-500">
                        No assets match the current filters. Try adjusting your selection.
                      </div>
                    )}

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

              {/* Filter controls for Assets, Asset Class, and Currency */}
              <AssetFilterControls />

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

                // Get sorted assets based on mode (year or period), then filter by user selections
                const isYearMode = bestToWorstMode === 'year';
                const filteredTickers = new Set(getFilteredAssetLookup().map(a => a.ticker));
                const sortedAssets = (isYearMode
                  ? getSortedAssetsByReturn(currentYear, annualReturns)
                  : getSortedAssetsByPeriodReturn(bestToWorstMode as number)
                ).filter(a => filteredTickers.has(a.ticker));

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

                    {/* Handle case when no assets have data for this year or filters exclude all */}
                    {sortedAssets.length === 0 && (
                      <div className="text-center py-4 text-gray-500">
                        No assets match the current filters. Try adjusting your selection.
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

              {/* Filter controls for Assets, Asset Class, and Currency */}
              <AssetFilterControls />

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
                                    className={`text-right py-0.5 px-1 font-mono ${
                                      asset.signals[colIdx] === 'SELL' ? 'font-bold' : ''
                                    }`}
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

                    {/* Legend explaining the color scale and signals */}
                    <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-600">
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
                      <div className="flex items-center gap-2">
                        <span className="font-bold">Bold price</span>
                        <span>= SELL signal that month</span>
                      </div>
                    </div>

                    {/* Show message if no assets match filters */}
                    {assets.length === 0 && (
                      <div className="text-center py-4 text-gray-500">
                        No assets match the current filters. Try adjusting your selection.
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Trend Following Section - Compares Buy & Hold vs 10-month SMA strategy */}
          {isConnected && assetData && activeView === 'trendFollowing' && (
            <div className="mt-2">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Trend Following</h2>

              {(() => {
                // Get available assets from lookup table
                const availableTickers = assetLookup.map(l => l.ticker);

                // Auto-select first asset if none selected
                if (!selectedTrendAsset && availableTickers.length > 0) {
                  setSelectedTrendAsset(availableTickers[0]);
                  return null;  // Re-render with selected asset
                }

                // Calculate trend following analysis
                const analysis = selectedTrendAsset
                  ? calculateTrendFollowingAnalysis(selectedTrendAsset, trendRiskFreeRate, trendCommission)
                  : null;

                // Get asset name for display
                const assetInfo = assetLookup.find(l => l.ticker === selectedTrendAsset);
                const assetName = assetInfo ? assetInfo.name : selectedTrendAsset;

                // Get current signal (last data point)
                const currentSignal = analysis?.chartData[analysis.chartData.length - 1]?.signal;

                // Count signals
                const buyCount = analysis?.signalChanges.filter(s => s.newSignal === 'BUY').length ?? 0;
                const sellCount = analysis?.signalChanges.filter(s => s.newSignal === 'SELL').length ?? 0;

                return (
                  <div className="bg-white p-4 rounded-lg shadow">
                    {/* Controls Row */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                      {/* Asset Selector */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Asset</label>
                        <select
                          value={selectedTrendAsset}
                          onChange={(e) => setSelectedTrendAsset(e.target.value)}
                          className="w-full px-2 py-2 border border-gray-300 rounded text-sm"
                        >
                          {assetLookup.map(asset => (
                            <option key={asset.ticker} value={asset.ticker}>
                              {asset.ticker} - {asset.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Start Date Selector */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                        <select
                          value={selectedDateRange.start}
                          onChange={(e) => setSelectedStartDate(e.target.value)}
                          className="w-full px-2 py-2 border border-gray-300 rounded text-sm"
                        >
                          {assetData.map(row => (
                            <option key={row.date} value={row.date}>{row.date}</option>
                          ))}
                        </select>
                      </div>

                      {/* End Date Selector */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                        <select
                          value={selectedDateRange.end}
                          onChange={(e) => setSelectedEndDate(e.target.value)}
                          className="w-full px-2 py-2 border border-gray-300 rounded text-sm"
                        >
                          {assetData.slice().reverse().filter(row => row.date >= selectedDateRange.start).map(row => (
                            <option key={row.date} value={row.date}>{row.date}</option>
                          ))}
                        </select>
                      </div>

                      {/* Risk-Free Rate Selector */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Risk-Free Rate</label>
                        <select
                          value={trendRiskFreeRate}
                          onChange={(e) => setTrendRiskFreeRate(parseFloat(e.target.value))}
                          className="w-full px-2 py-2 border border-gray-300 rounded text-sm"
                        >
                          {RISK_FREE_RATE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* Commission Selector */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Commission</label>
                        <select
                          value={trendCommission}
                          onChange={(e) => setTrendCommission(parseFloat(e.target.value))}
                          className="w-full px-2 py-2 border border-gray-300 rounded text-sm"
                        >
                          {COMMISSION_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {analysis ? (
                      <>
                        {/* Summary Card */}
                        <div className="bg-gray-50 rounded-lg p-4 mb-4">
                          <div className="flex flex-wrap items-center justify-between gap-4">
                            <div>
                              <h3 className="text-lg font-semibold text-gray-800">{assetName}</h3>
                              <p className="text-sm text-gray-600">
                                Signals: {buyCount} buy, {sellCount} sell
                                {analysis.successRate && (
                                  <span className="ml-3">
                                    Success rate: {analysis.successRate.rate.toFixed(0)}% ({analysis.successRate.successful} of {analysis.successRate.total})
                                  </span>
                                )}
                              </p>
                            </div>
                            <div className={`px-4 py-2 rounded-lg font-semibold ${
                              currentSignal === 'BUY'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {currentSignal === 'BUY' ? 'INVESTED' : 'OUT OF MARKET'}
                            </div>
                          </div>
                        </div>

                        {/* Legend */}
                        <div className="flex flex-wrap gap-4 text-xs text-gray-600 mb-4">
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 bg-blue-200 border border-blue-400 rounded"></div>
                            <span>Buy & Hold</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-1 bg-green-600 rounded"></div>
                            <span>Trend Following</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-0.5 bg-gray-400" style={{ borderTop: '2px dashed #9ca3af' }}></div>
                            <span>10m SMA</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                            <span>Buy Signal</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                            <span>Sell Signal</span>
                          </div>
                        </div>

                        {/* Growth of $1 Chart */}
                        <div className="bg-white rounded-lg mb-4">
                          <h4 className="text-md font-semibold text-gray-700 mb-2 text-center">Growth of $1</h4>
                          <ResponsiveContainer width="100%" height={350}>
                            <ComposedChart data={analysis.chartData} margin={{ top: 20, right: 5, left: -15, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis
                                dataKey="date"
                                tick={{ fontSize: 10 }}
                                tickFormatter={(date) => {
                                  const d = new Date(date);
                                  return `${d.toLocaleDateString('en-US', { month: 'short' })} ${d.getFullYear().toString().slice(-2)}`;
                                }}
                              />
                              <YAxis
                                tick={{ fontSize: 10 }}
                                domain={['auto', 'auto']}
                                tickFormatter={(value) => `$${value.toFixed(2)}`}
                              />
                              <Tooltip
                                formatter={(value: number, name: string) => {
                                  if (name === 'buyHoldValue') return [`$${value.toFixed(3)}`, 'Buy & Hold'];
                                  if (name === 'trendFollowingValue') return [`$${value.toFixed(3)}`, 'Trend Following'];
                                  if (name === 'sma10') return [`$${value.toFixed(2)}`, '10m SMA'];
                                  return [value, name];
                                }}
                                labelFormatter={(label) => {
                                  const d = new Date(label);
                                  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                                }}
                              />
                              {/* Buy & Hold Area */}
                              <Area
                                type="monotone"
                                dataKey="buyHoldValue"
                                fill="#93c5fd"
                                stroke="#3b82f6"
                                strokeWidth={1}
                                fillOpacity={0.6}
                                name="buyHoldValue"
                              />
                              {/* Trend Following Line */}
                              <Line
                                type="monotone"
                                dataKey="trendFollowingValue"
                                stroke="#16a34a"
                                strokeWidth={2}
                                dot={false}
                                name="trendFollowingValue"
                              />
                              {/* 10-month SMA Line (normalized to Growth of $1 scale) */}
                              <Line
                                type="monotone"
                                dataKey="sma10"
                                stroke="#9ca3af"
                                strokeWidth={1.5}
                                strokeDasharray="5 5"
                                dot={false}
                                name="sma10"
                              />
                              {/* Signal dots on Buy & Hold line */}
                              {analysis.signalChanges.map((signal, idx) => (
                                <ReferenceDot
                                  key={idx}
                                  x={signal.date}
                                  y={signal.value}
                                  r={6}
                                  fill={signal.newSignal === 'BUY' ? '#22c55e' : '#ef4444'}
                                  stroke="white"
                                  strokeWidth={2}
                                />
                              ))}
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>

                        {/* Drawdown Chart */}
                        <div className="bg-white rounded-lg mb-4">
                          <h4 className="text-md font-semibold text-gray-700 mb-2 text-center">Drawdown</h4>
                          <ResponsiveContainer width="100%" height={200}>
                            <ComposedChart data={analysis.drawdownData} margin={{ top: 10, right: 5, left: -15, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis
                                dataKey="date"
                                tick={{ fontSize: 10 }}
                                tickFormatter={(date) => {
                                  const d = new Date(date);
                                  return `${d.toLocaleDateString('en-US', { month: 'short' })} ${d.getFullYear().toString().slice(-2)}`;
                                }}
                              />
                              <YAxis
                                tick={{ fontSize: 10 }}
                                tickFormatter={(value) => `${value.toFixed(0)}%`}
                                domain={['auto', 0]}
                              />
                              <Tooltip
                                formatter={(value: number, name: string) => {
                                  if (name === 'buyHoldDrawdown') return [`${value.toFixed(2)}%`, 'Buy & Hold'];
                                  if (name === 'trendFollowingDrawdown') return [`${value.toFixed(2)}%`, 'Trend Following'];
                                  return [value, name];
                                }}
                                labelFormatter={(label) => {
                                  const d = new Date(label);
                                  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                                }}
                              />
                              {/* Buy & Hold Drawdown */}
                              <Area
                                type="monotone"
                                dataKey="buyHoldDrawdown"
                                fill="#fecaca"
                                stroke="#ef4444"
                                strokeWidth={1}
                                fillOpacity={0.4}
                                name="buyHoldDrawdown"
                              />
                              {/* Trend Following Drawdown */}
                              <Line
                                type="monotone"
                                dataKey="trendFollowingDrawdown"
                                stroke="#16a34a"
                                strokeWidth={2}
                                dot={false}
                                name="trendFollowingDrawdown"
                              />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>

                        {/* Statistics Table */}
                        <div className="bg-white rounded-lg mb-4 overflow-x-auto">
                          <h4 className="text-md font-semibold text-gray-700 mb-2">Statistics</h4>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b-2 border-gray-200">
                                <th className="text-left py-2 px-3 bg-gray-50">Metric</th>
                                <th className="text-right py-2 px-3 bg-blue-50">Buy & Hold</th>
                                <th className="text-right py-2 px-3 bg-green-50">Trend Following</th>
                              </tr>
                            </thead>
                            <tbody>
                              {/* Final Amount */}
                              <tr className="border-b border-gray-100">
                                <td className="py-2 px-3 font-medium text-gray-700">Final Amount</td>
                                <td className={`text-right py-2 px-3 ${
                                  analysis.buyHoldStats.finalAmount >= analysis.trendFollowingStats.finalAmount
                                    ? 'font-semibold text-blue-700' : 'text-gray-600'
                                }`}>
                                  ${analysis.buyHoldStats.finalAmount.toFixed(2)}
                                </td>
                                <td className={`text-right py-2 px-3 ${
                                  analysis.trendFollowingStats.finalAmount >= analysis.buyHoldStats.finalAmount
                                    ? 'font-semibold text-green-700' : 'text-gray-600'
                                }`}>
                                  ${analysis.trendFollowingStats.finalAmount.toFixed(2)}
                                </td>
                              </tr>
                              {/* CAGR */}
                              <tr className="border-b border-gray-100">
                                <td className="py-2 px-3 font-medium text-gray-700">CAGR</td>
                                <td className={`text-right py-2 px-3 ${
                                  analysis.buyHoldStats.cagr >= analysis.trendFollowingStats.cagr
                                    ? 'font-semibold text-blue-700' : 'text-gray-600'
                                }`}>
                                  {analysis.buyHoldStats.cagr.toFixed(2)}%
                                </td>
                                <td className={`text-right py-2 px-3 ${
                                  analysis.trendFollowingStats.cagr >= analysis.buyHoldStats.cagr
                                    ? 'font-semibold text-green-700' : 'text-gray-600'
                                }`}>
                                  {analysis.trendFollowingStats.cagr.toFixed(2)}%
                                </td>
                              </tr>
                              {/* Total Return */}
                              <tr className="border-b border-gray-100">
                                <td className="py-2 px-3 font-medium text-gray-700">Total Return</td>
                                <td className={`text-right py-2 px-3 ${
                                  analysis.buyHoldStats.totalReturn >= analysis.trendFollowingStats.totalReturn
                                    ? 'font-semibold text-blue-700' : 'text-gray-600'
                                }`}>
                                  {analysis.buyHoldStats.totalReturn.toFixed(2)}%
                                </td>
                                <td className={`text-right py-2 px-3 ${
                                  analysis.trendFollowingStats.totalReturn >= analysis.buyHoldStats.totalReturn
                                    ? 'font-semibold text-green-700' : 'text-gray-600'
                                }`}>
                                  {analysis.trendFollowingStats.totalReturn.toFixed(2)}%
                                </td>
                              </tr>
                              {/* Std Dev (lower is better) */}
                              <tr className="border-b border-gray-100">
                                <td className="py-2 px-3 font-medium text-gray-700">Std Dev (Ann.)</td>
                                <td className={`text-right py-2 px-3 ${
                                  analysis.buyHoldStats.stdDev <= analysis.trendFollowingStats.stdDev
                                    ? 'font-semibold text-blue-700' : 'text-gray-600'
                                }`}>
                                  {analysis.buyHoldStats.stdDev.toFixed(2)}%
                                </td>
                                <td className={`text-right py-2 px-3 ${
                                  analysis.trendFollowingStats.stdDev <= analysis.buyHoldStats.stdDev
                                    ? 'font-semibold text-green-700' : 'text-gray-600'
                                }`}>
                                  {analysis.trendFollowingStats.stdDev.toFixed(2)}%
                                </td>
                              </tr>
                              {/* Max Drawdown (higher/less negative is better) */}
                              <tr className="border-b border-gray-100">
                                <td className="py-2 px-3 font-medium text-gray-700">Max Drawdown</td>
                                <td className={`text-right py-2 px-3 ${
                                  analysis.buyHoldStats.maxDrawdown >= analysis.trendFollowingStats.maxDrawdown
                                    ? 'font-semibold text-blue-700' : 'text-gray-600'
                                }`}>
                                  {analysis.buyHoldStats.maxDrawdown.toFixed(2)}%
                                </td>
                                <td className={`text-right py-2 px-3 ${
                                  analysis.trendFollowingStats.maxDrawdown >= analysis.buyHoldStats.maxDrawdown
                                    ? 'font-semibold text-green-700' : 'text-gray-600'
                                }`}>
                                  {analysis.trendFollowingStats.maxDrawdown.toFixed(2)}%
                                </td>
                              </tr>
                              {/* Current Drawdown (higher/less negative is better) */}
                              <tr className="border-b border-gray-100">
                                <td className="py-2 px-3 font-medium text-gray-700">Current Drawdown</td>
                                <td className={`text-right py-2 px-3 ${
                                  analysis.buyHoldStats.currentDrawdown >= analysis.trendFollowingStats.currentDrawdown
                                    ? 'font-semibold text-blue-700' : 'text-gray-600'
                                }`}>
                                  {analysis.buyHoldStats.currentDrawdown.toFixed(2)}%
                                </td>
                                <td className={`text-right py-2 px-3 ${
                                  analysis.trendFollowingStats.currentDrawdown >= analysis.buyHoldStats.currentDrawdown
                                    ? 'font-semibold text-green-700' : 'text-gray-600'
                                }`}>
                                  {analysis.trendFollowingStats.currentDrawdown.toFixed(2)}%
                                </td>
                              </tr>
                              {/* Sharpe Ratio (higher is better) */}
                              <tr className="border-b border-gray-100">
                                <td className="py-2 px-3 font-medium text-gray-700">Sharpe Ratio</td>
                                <td className={`text-right py-2 px-3 ${
                                  analysis.buyHoldStats.sharpeRatio >= analysis.trendFollowingStats.sharpeRatio
                                    ? 'font-semibold text-blue-700' : 'text-gray-600'
                                }`}>
                                  {analysis.buyHoldStats.sharpeRatio.toFixed(2)}
                                </td>
                                <td className={`text-right py-2 px-3 ${
                                  analysis.trendFollowingStats.sharpeRatio >= analysis.buyHoldStats.sharpeRatio
                                    ? 'font-semibold text-green-700' : 'text-gray-600'
                                }`}>
                                  {analysis.trendFollowingStats.sharpeRatio.toFixed(2)}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        {/* Annual Returns Bar Chart */}
                        {(() => {
                          const trendMonthlyReturns = calculateTrendMonthlyReturns(analysis.chartData, selectedDateRange.start);
                          const chartData = getTrendAnnualReturnsChartData(trendMonthlyReturns);

                          if (chartData.length === 0) return null;

                          return (
                            <>
                              <div className="bg-white rounded-lg mb-4">
                                <h4 className="text-md font-semibold text-gray-700 mb-2">Annual Returns</h4>
                                <ResponsiveContainer width="100%" height={300}>
                                  <BarChart
                                    data={chartData}
                                    margin={{ top: 20, right: 5, left: 5, bottom: 5 }}
                                  >
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="year" />
                                    <YAxis hide domain={['auto', 'auto']} />
                                    <Tooltip
                                      formatter={(value: number) => [`${value.toFixed(1)}%`, '']}
                                      labelFormatter={(label) => `Year: ${label}`}
                                    />
                                    <Legend />
                                    {/* Buy & Hold bars - Blue */}
                                    <Bar dataKey="Buy & Hold" fill="#3b82f6">
                                      <LabelList
                                        dataKey="Buy & Hold"
                                        position="top"
                                        formatter={(value: number) => value >= 0 ? `${value.toFixed(1)}%` : ''}
                                        style={{ fontSize: '10px', fill: '#666' }}
                                      />
                                      <LabelList
                                        dataKey="Buy & Hold"
                                        position="bottom"
                                        formatter={(value: number) => value < 0 ? `${value.toFixed(1)}%` : ''}
                                        style={{ fontSize: '10px', fill: '#ef4444' }}
                                      />
                                    </Bar>
                                    {/* Trend Following bars - Green */}
                                    <Bar dataKey="Trend Following" fill="#16a34a">
                                      <LabelList
                                        dataKey="Trend Following"
                                        position="top"
                                        formatter={(value: number) => value >= 0 ? `${value.toFixed(1)}%` : ''}
                                        style={{ fontSize: '10px', fill: '#666' }}
                                      />
                                      <LabelList
                                        dataKey="Trend Following"
                                        position="bottom"
                                        formatter={(value: number) => value < 0 ? `${value.toFixed(1)}%` : ''}
                                        style={{ fontSize: '10px', fill: '#ef4444' }}
                                      />
                                    </Bar>
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>

                              {/* Monthly Returns Table - Buy & Hold */}
                              <div className="bg-white rounded-lg mb-4 overflow-x-auto">
                                <h4 className="text-md font-semibold text-blue-600 mb-2">Returns - Buy & Hold</h4>
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b-2 border-gray-200">
                                      <th className="text-left py-2 px-2 bg-blue-50 sticky left-0">Year</th>
                                      <th className="text-right py-2 px-2 bg-blue-50">Jan</th>
                                      <th className="text-right py-2 px-2 bg-blue-50">Feb</th>
                                      <th className="text-right py-2 px-2 bg-blue-50">Mar</th>
                                      <th className="text-right py-2 px-2 bg-blue-50">Apr</th>
                                      <th className="text-right py-2 px-2 bg-blue-50">May</th>
                                      <th className="text-right py-2 px-2 bg-blue-50">Jun</th>
                                      <th className="text-right py-2 px-2 bg-blue-50">Jul</th>
                                      <th className="text-right py-2 px-2 bg-blue-50">Aug</th>
                                      <th className="text-right py-2 px-2 bg-blue-50">Sep</th>
                                      <th className="text-right py-2 px-2 bg-blue-50">Oct</th>
                                      <th className="text-right py-2 px-2 bg-blue-50">Nov</th>
                                      <th className="text-right py-2 px-2 bg-blue-50">Dec</th>
                                      <th className="text-right py-2 px-2 bg-blue-100 font-semibold">FY</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {Object.keys(trendMonthlyReturns).sort().reverse().map(year => (
                                      <tr key={year} className="border-b border-gray-100">
                                        <td className="py-2 px-2 font-medium bg-blue-50 sticky left-0">{year}</td>
                                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(month => {
                                          const ret = trendMonthlyReturns[year].buyHold[month];
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
                                          trendMonthlyReturns[year].buyHoldFY >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                        }`}>
                                          {trendMonthlyReturns[year].buyHoldFY.toFixed(2)}%
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              {/* Monthly Returns Table - Trend Following */}
                              <div className="bg-white rounded-lg mb-4 overflow-x-auto">
                                <h4 className="text-md font-semibold text-green-600 mb-2">Returns - Trend Following</h4>
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b-2 border-gray-200">
                                      <th className="text-left py-2 px-2 bg-green-50 sticky left-0">Year</th>
                                      <th className="text-right py-2 px-2 bg-green-50">Jan</th>
                                      <th className="text-right py-2 px-2 bg-green-50">Feb</th>
                                      <th className="text-right py-2 px-2 bg-green-50">Mar</th>
                                      <th className="text-right py-2 px-2 bg-green-50">Apr</th>
                                      <th className="text-right py-2 px-2 bg-green-50">May</th>
                                      <th className="text-right py-2 px-2 bg-green-50">Jun</th>
                                      <th className="text-right py-2 px-2 bg-green-50">Jul</th>
                                      <th className="text-right py-2 px-2 bg-green-50">Aug</th>
                                      <th className="text-right py-2 px-2 bg-green-50">Sep</th>
                                      <th className="text-right py-2 px-2 bg-green-50">Oct</th>
                                      <th className="text-right py-2 px-2 bg-green-50">Nov</th>
                                      <th className="text-right py-2 px-2 bg-green-50">Dec</th>
                                      <th className="text-right py-2 px-2 bg-green-100 font-semibold">FY</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {Object.keys(trendMonthlyReturns).sort().reverse().map(year => (
                                      <tr key={year} className="border-b border-gray-100">
                                        <td className="py-2 px-2 font-medium bg-green-50 sticky left-0">{year}</td>
                                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(month => {
                                          const ret = trendMonthlyReturns[year].trendFollowing[month];
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
                                          trendMonthlyReturns[year].trendFollowingFY >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                        }`}>
                                          {trendMonthlyReturns[year].trendFollowingFY.toFixed(2)}%
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </>
                          );
                        })()}

                        {/* Strategy Explanation */}
                        <div className="text-sm text-gray-600 bg-gray-50 p-4 rounded-lg">
                          <p className="font-medium mb-2">Strategy Rules:</p>
                          <ul className="list-disc list-inside space-y-1">
                            <li>Calculate 10-month Simple Moving Average at each month-end</li>
                            <li>When price &gt; SMA: <span className="text-green-700 font-medium">BUY</span> (stay invested in asset)</li>
                            <li>When price &lt; SMA: <span className="text-red-700 font-medium">SELL</span> (exit to cash, earn {(trendRiskFreeRate * 100).toFixed(1)}% annual risk-free rate)</li>
                            <li>Commission of {(trendCommission * 100).toFixed(2)}% applied on each signal change</li>
                          </ul>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        {selectedTrendAsset
                          ? 'Not enough data for analysis. Need at least 12 months of price data.'
                          : 'Please select an asset to analyze.'}
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
