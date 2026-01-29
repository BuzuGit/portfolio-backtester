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
import { fetchSheetData, AssetRow } from '@/lib/fetchData';

// ============================================
// TYPE DEFINITIONS
// ============================================
// TypeScript interfaces describe the "shape" of our data.
// Think of them as blueprints that ensure we use data correctly.

// A single asset in a portfolio (e.g., "SPY at 60% weight")
interface PortfolioAsset {
  asset: string;   // Asset name (e.g., "SPY", "BND")
  weight: number;  // Percentage weight (e.g., 60 for 60%)
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

// ============================================
// MAIN COMPONENT
// ============================================

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
      // Fetch and parse the CSV data
      const { data, assets } = await fetchSheetData();

      // Update all our state with the new data
      setAssetData(data);
      setAvailableAssets(assets);
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
   * Filters available assets to only those with data at the selected start date.
   * This prevents users from selecting assets that didn't exist yet.
   */
  const getAvailableAssetsForDateRange = (): string[] => {
    if (!assetData || !selectedDateRange.start) return availableAssets;

    // Find the index of our start date in the data
    const startIndex = assetData.findIndex(row => row.date === selectedDateRange.start);
    if (startIndex === -1) return availableAssets;

    // Filter to assets that have data at or near the start date
    return availableAssets.filter(asset => {
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
          weight: isFirstAsset ? 100 : 0
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
   * Updates a specific field of an asset in a portfolio
   */
  const updateAsset = (portfolioId: number, assetIndex: number, field: 'asset' | 'weight', value: string | number) => {
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
    const assetShares: { [asset: string]: number } = {};
    portfolio.assets.forEach(({ asset, weight }) => {
      const initialPrice = Number(filteredData[0][asset]);
      if (initialPrice && initialPrice > 0) {
        const initialAllocation = startingCapital * (weight / 100);
        assetShares[asset] = initialAllocation / initialPrice;
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
      let portfolioValue = 0;
      portfolio.assets.forEach(({ asset }) => {
        const currentPrice = Number(row[asset]);
        if (currentPrice && currentPrice > 0 && assetShares[asset]) {
          portfolioValue += assetShares[asset] * currentPrice;
        }
      });

      // Rebalance: adjust shares to restore target weights
      if (shouldRebalance && portfolioValue > 0) {
        portfolio.assets.forEach(({ asset, weight }) => {
          const currentPrice = Number(row[asset]);
          if (currentPrice && currentPrice > 0) {
            const targetAllocation = portfolioValue * (weight / 100);
            assetShares[asset] = targetAllocation / currentPrice;
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

          {/* Show the rest of the UI only when data is loaded */}
          {isConnected && assetData && (
            <>
              {/* Parameters Section */}
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <h2 className="text-lg font-semibold text-gray-700 mb-3">Parameters</h2>
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
                            <div key={idx} className="flex gap-1">
                              {/* Asset Selector */}
                              <select
                                value={asset.asset}
                                onChange={(e) => updateAsset(portfolio.id, idx, 'asset', e.target.value)}
                                className="flex-1 px-1 py-1 text-xs border border-gray-300 rounded"
                              >
                                <option value="">Select...</option>
                                {availableAssetsFiltered.map(a => (
                                  <option key={a} value={a}>{a}</option>
                                ))}
                              </select>
                              {/* Weight Input */}
                              <input
                                type="number"
                                value={asset.weight}
                                onChange={(e) => updateAsset(portfolio.id, idx, 'weight', parseFloat(e.target.value) || 0)}
                                placeholder="%"
                                className="w-14 px-1 py-1 text-xs border border-gray-300 rounded"
                              />
                              {/* Remove Asset */}
                              <button
                                onClick={() => removeAsset(portfolio.id, idx)}
                                className="text-red-500 hover:text-red-700"
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

          {/* Results Section - Only shown after running backtest */}
          {backtestResults && (
            <div className="mt-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Results</h2>

              {/* Portfolio Value Chart */}
              <div className="bg-white p-4 rounded-lg shadow mb-4">
                <h3 className="text-md font-semibold text-gray-700 mb-2 text-center">Portfolio Value</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" type="category" allowDuplicatedCategory={false} tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
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
              <div className="bg-white p-4 rounded-lg shadow mb-4">
                <h3 className="text-md font-semibold text-gray-700 mb-2 text-center">Drawdown</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" type="category" allowDuplicatedCategory={false} tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
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
                        {Object.keys(monthlyReturns).sort().map(year => (
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
        </div>
      </div>
    </div>
  );
};

export default PortfolioBacktester;
