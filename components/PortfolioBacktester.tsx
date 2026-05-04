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

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LineChart, Line, BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Area, ReferenceDot, ReferenceLine, AreaChart, Customized, ScatterChart, Scatter } from 'recharts';
import { RefreshCw, Plus, Trash2 } from 'lucide-react';
import { fetchSheetData, AssetRow, AssetLookup, YearsRow, ClosedPositionRow, TransactionRow, FLOW_PURCHASE, FLOW_SALE, FLOW_DIVIDEND } from '@/lib/fetchData';

// ============================================
// UTILITY FUNCTIONS
// ============================================

/** Convert a Date to "YYYY-MM" string (e.g. 2024-02). Used everywhere to compare
 *  transaction dates against monthly price data rows. */
const toYM = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Month abbreviations for X-axis date labels. */
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * Derive the list of "open" tickers from transaction data.
 * A ticker is open if it has at least one purchase but NO sale entries.
 * Pure function — takes the raw transactions array and returns ticker strings.
 */
const computeOpenTickers = (txns: TransactionRow[]): string[] => {
  const purchaseTickers = new Set(
    txns.filter(t => t.flow === FLOW_PURCHASE).map(t => t.ticker)
  );
  const soldTickers = new Set(
    txns.filter(t => t.flow === FLOW_SALE).map(t => t.ticker)
  );
  return Array.from(purchaseTickers).filter(ticker => !soldTickers.has(ticker));
};

/**
 * Compute the zero-crossing fraction for a PnL gradient.
 * Returns how far down from the chart's top the y=0 line sits (0 = top, 1 = bottom).
 * Used by both Open and Closed position PnL charts to set the green/red gradient split.
 */
const computePnlZeroFraction = (data: { pnl: number }[]): number => {
  if (data.length === 0) return 0.5;
  const maxPnl = data.reduce((max, d) => d.pnl > max ? d.pnl : max, 0);
  const minPnl = data.reduce((min, d) => d.pnl < min ? d.pnl : min, 0);
  const range = maxPnl - minPnl;
  return range > 0 ? maxPnl / range : 0.5;
};

/**
 * Merge comparison data into chart data using a Map for O(N+M) performance.
 * For each base chart point, attaches compPrice from the comparison data if dates match.
 * Also appends any comparison points that fall outside the base date range.
 */
const mergeComparisonData = <T extends { date: string }>(
  chartData: T[],
  comparisonData: { date: string; normalizedPrice: number }[]
): (T & { compPrice?: number })[] => {
  // Build a Map from date → normalizedPrice for O(1) lookups
  const compMap = new Map(comparisonData.map(c => [c.date, c.normalizedPrice]));
  // Attach compPrice to each base chart point
  const merged = chartData.map(d => ({
    ...d,
    compPrice: compMap.get(d.date),
  }));
  // Add comparison-only points (dates not in the base chart)
  const baseDates = new Set(chartData.map(d => d.date));
  comparisonData.forEach(c => {
    if (!baseDates.has(c.date)) {
      merged.push({ date: c.date, price: undefined as unknown as number, compPrice: c.normalizedPrice } as any);
    }
  });
  merged.sort((a, b) => a.date.localeCompare(b.date));
  return merged;
};

/** Custom two-line X-axis tick: month abbreviation on top, full year below.
 *  e.g.  Jan
 *        2025
 *  Recharts passes { x, y, payload } to custom tick components. */
const DateAxisTick = ({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => {
  const d = new Date(payload.value);
  if (isNaN(d.getTime())) {
    return <text x={x} y={y} textAnchor="middle" fontSize={9} fill="#6B7280">{payload.value}</text>;
  }
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={9} fill="#6B7280">
      <tspan x={x} dy="0.5em">{MONTH_ABBR[d.getMonth()]}</tspan>
      <tspan x={x} dy="1.2em">{d.getFullYear()}</tspan>
    </text>
  );
};

// ============================================
// TYPE DEFINITIONS
// ============================================
// TypeScript interfaces describe the "shape" of our data.
// Think of them as blueprints that ensure we use data correctly.

/** Props injected by Recharts into <Customized> components.
 *  We only type the fields we actually use (yAxisMap, offset, width, height). */
type RechartsCustomizedProps = {
  yAxisMap?: Record<string, { scale: (v: number) => number }>;
  offset?: { top: number; bottom: number; left: number; right: number };
  width?: number;
  height?: number;
};

/** Definition for a single right-edge bubble (colored label at chart's right edge). */
interface BubbleDef {
  value: number;   // numeric value (used for Y positioning via yAxis.scale)
  color: string;   // background color of the bubble rectangle
  label: string;   // formatted text to display inside the bubble
}

// Shared constants for all right-edge bubbles across charts
const BUBBLE_W = 62;   // width of the bubble rectangle in pixels
const BUBBLE_H = 20;   // height of the bubble rectangle
const BUBBLE_GAP = 2;  // minimum pixel gap between adjacent bubbles
const BUBBLE_RX = 4;   // border-radius of rounded corners

/** Renders a group of colored value bubbles at the right edge of a Recharts chart.
 *  Used by Price History, Invested Capital, and PnL charts. Handles:
 *  - Positioning each bubble at its correct Y value via the chart's yAxis.scale
 *  - Sorting bubbles top-to-bottom (highest value at top)
 *  - Preventing overlap by pushing bubbles apart
 *  - Clamping bubbles to stay within the chart's visible area
 *  - Skipping bubbles whose Y position is NaN (value outside axis domain) */
function renderEdgeBubbles(
  props: RechartsCustomizedProps,
  defs: BubbleDef[],
): JSX.Element | null {
  const { yAxisMap, offset: offsetData, width: chartWidth, height: chartHeight } = props;
  if (!yAxisMap || !offsetData || !chartWidth) return null;
  const yAxis = Object.values(yAxisMap)[0];
  if (!yAxis?.scale) return null;

  // Position bubbles just to the right of the plot area
  const bubbleX = chartWidth - offsetData.right + 4;

  // Build positioned bubbles, filtering out any NaN positions
  const bubbles = defs
    .map(d => ({ ...d, yRaw: yAxis.scale(d.value) }))
    .filter(b => !isNaN(b.yRaw));
  if (bubbles.length === 0) return null;

  // Sort: highest value at top (smallest yRaw = top of screen)
  bubbles.sort((a, b) => a.yRaw - b.yRaw);

  // Prevent overlap: walk top-to-bottom, push any bubble that's too close downward
  const minDist = BUBBLE_H + BUBBLE_GAP;
  for (let i = 1; i < bubbles.length; i++) {
    if (bubbles[i].yRaw - bubbles[i - 1].yRaw < minDist) {
      bubbles[i].yRaw = bubbles[i - 1].yRaw + minDist;
    }
  }

  // Clamp bubbles to stay within the chart's visible plot area
  if (chartHeight) {
    const yMin = offsetData.top + BUBBLE_H / 2;
    const yMax = chartHeight - offsetData.bottom - BUBBLE_H / 2;
    for (const b of bubbles) {
      b.yRaw = Math.max(yMin, Math.min(yMax, b.yRaw));
    }
  }

  // Reverse pass: if bottom-clamping pulled a pushed bubble back up causing
  // overlap again, push upper bubbles upward to restore the gap
  for (let i = bubbles.length - 2; i >= 0; i--) {
    if (bubbles[i + 1].yRaw - bubbles[i].yRaw < minDist) {
      bubbles[i].yRaw = bubbles[i + 1].yRaw - minDist;
    }
  }

  return (
    <g>
      {bubbles.map((b, i) => (
        <g key={i}>
          <rect
            x={bubbleX} y={b.yRaw - BUBBLE_H / 2}
            width={BUBBLE_W} height={BUBBLE_H}
            rx={BUBBLE_RX} ry={BUBBLE_RX} fill={b.color}
          />
          <text
            x={bubbleX + BUBBLE_W / 2} y={b.yRaw}
            textAnchor="middle" dominantBaseline="central"
            fill="#ffffff" fontSize={11} fontWeight={600}
          >
            {b.label}
          </text>
        </g>
      ))}
    </g>
  );
}

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
  inflationAdj: string;        // CPI ticker for inflation adjustment (e.g., "CPIMPL") or empty for nominal
  baseCurrency: string;        // Target currency for all values ('' = no conversion, 'PLN', 'USD', 'SGD')
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
  longestDrawdown: string;
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

// A single row in the Rebalancing Table — captures the month-by-month
// portfolio state including per-asset prices, drifted weights, and whether
// rebalancing occurred that month.
interface RebalancingRow {
  date: string;
  assetPrices: { [asset: string]: number };    // FX-adjusted price per asset
  assetShares: { [asset: string]: number };    // Number of shares held per asset
  assetWeights: { [asset: string]: number };   // Actual weight % per asset (0-100)
  portfolioValue: number;
  momPct: number | null;                       // Month-over-month return %; null for first row
  isRebalanced: boolean;                       // True if rebalancing happened this month
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

// Maps 3-letter currency code to the xxxPLN FX ticker in our data
// PLN is the "hub" currency — all FX data is in xxxPLN format
// To convert between any two currencies, we route through PLN
const FX_TICKER_MAP: { [key: string]: string } = {
  USD: 'USDPLN', SGD: 'SGDPLN', EUR: 'EURPLN', CHF: 'CHFPLN', PLN: ''
};

// Currency symbols for display formatting
const CURRENCY_SYMBOLS: { [key: string]: string } = {
  PLN: 'zl', USD: '$', SGD: 'S$', EUR: '€', CHF: 'CHF', '': '$'
};

// Portfolio base currency options
// Empty = no conversion (assets stay in their native currencies)
const CURRENCY_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '-' },
  { value: 'PLN', label: 'PLN' },
  { value: 'USD', label: 'USD' },
  { value: 'SGD', label: 'SGD' },
];

// Available CPI tickers for inflation adjustment
// When selected, portfolio values are divided by the CPI index (normalized to start date)
// to show "real" purchasing power instead of nominal values
const CPI_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '-' },          // No inflation adjustment (nominal values)
  { value: 'CPIMPL', label: 'PL' },   // Polish CPI
  { value: 'CPIMUS', label: 'US' },   // US CPI
  { value: 'CPIMSG', label: 'SG' },   // Singapore CPI
];

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
    { id: 1, name: 'Portfolio 1', assets: [], color: '#000000', nameManuallyEdited: false, inflationAdj: '', baseCurrency: '' }
  ]);

  // Backtest parameters
  const [startingCapital, setStartingCapital] = useState(1000000);      // How much $ to start with
  const [rebalanceFreq, setRebalanceFreq] = useState('yearly');         // How often to rebalance
  const [withdrawalRate, setWithdrawalRate] = useState('4');             // Annual withdrawal rate %
  const [inflationRate, setInflationRate] = useState('0');               // Annual inflation rate % (compounds withdrawal upward each year)
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
  const [activeView, setActiveView] = useState<'backtest' | 'annualReturns' | 'bestToWorst' | 'monthlyPrices' | 'graphs' | 'trendFollowing' | 'correlationMatrix' | 'portfolio' | 'positions'>('backtest');

  // The year selected for the "Best To Worst" ranking view
  // Defaults to null, and will be set to the most recent year when data loads
  const [selectedRankingYear, setSelectedRankingYear] = useState<number | null>(null);

  // Sort column for Assets Annual Returns table
  // Can be a year number, 'Period', 'CAGR', 'CurrDD', '1Y', '2Y', '3Y', '4Y', '5Y', or null (default order)
  const [annualReturnsSortColumn, setAnnualReturnsSortColumn] = useState<string | number | null>(null);
  // Toggle between showing annual returns (%) or end-of-year prices in the Annual tab
  const [annualViewMode, setAnnualViewMode] = useState<'returns' | 'prices'>('returns');

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

  // Correlation Matrix tab state
  // How many years of data to use when calculating correlations (default 3 years)
  const [correlationPeriod, setCorrelationPeriod] = useState(3);

  // Portfolio tab state
  // Annual portfolio summary data from the "Years" sheet in Google Sheets
  const [yearsData, setYearsData] = useState<YearsRow[]>([]);
  // Which currency to display monetary values in (Charts 1 & 2)
  const [portfolioCurrency, setPortfolioCurrency] = useState<'PLN' | 'USD' | 'EUR' | 'CHF' | 'SGD'>('PLN');
  // Which currencies are shown in Charts 3 & 4 (Returns/Growth by Year)
  // All three selected by default; user can toggle individual currencies on/off
  const [selectedReturnCurrencies, setSelectedReturnCurrencies] = useState<string[]>(['PLN', 'USD', 'SGD']);
  // Whether the currency filter dropdown for Charts 3 & 4 is open
  const [returnCurrencyDropdownOpen, setReturnCurrencyDropdownOpen] = useState(false);

  // Asset filtering state (shared across Annual Returns, Best To Worst, Monthly Prices tabs)
  // These filters let users narrow down which assets are displayed in the tables
  const [selectedAssetTickers, setSelectedAssetTickers] = useState<string[]>([]);
  const [selectedAssetClasses, setSelectedAssetClasses] = useState<string[]>([]);
  const [selectedCurrencies, setSelectedCurrencies] = useState<string[]>([]);
  const [selectedAssetSubcategories, setSelectedAssetSubcategories] = useState<string[]>([]);
  // Tracks which filter dropdown is currently open (null = all closed)
  const [openFilterDropdown, setOpenFilterDropdown] = useState<'assets' | 'assetClass' | 'currency' | 'assetSubcategory' | null>(null);
  // Years to display in the Annual Returns tab (null = all years shown, [] = none selected)
  const [selectedYears, setSelectedYears] = useState<number[] | null>(null);
  // Separate dropdown state for the Years filter (lives outside AssetFilterControls)
  const [yearsDropdownOpen, setYearsDropdownOpen] = useState(false);
  // Ref for click-outside detection on the Years dropdown
  const yearsDropdownRef = useRef<HTMLDivElement>(null);

  // Which portfolio's withdrawal detail table to show (index into backtestResults)
  const [selectedDetailPortfolio, setSelectedDetailPortfolio] = useState(0);
  // Which portfolio's rebalancing table to show (index into backtestResults)
  const [selectedRebalancingPortfolio, setSelectedRebalancingPortfolio] = useState(0);

  // ---- Closed Positions tab state ----
  // Raw transaction data from the "Closed" sheet in Google Sheets
  const [closedData, setClosedData] = useState<ClosedPositionRow[]>([]);
  // Filter state for the Closed tab (all assets selected by default after data loads)
  const [closedSelectedTickers, setClosedSelectedTickers] = useState<string[]>([]);
  const [closedOpenFilterDropdown, setClosedOpenFilterDropdown] = useState<'assets' | null>(null);
  // Which asset the user drilled into (empty string = showing summary list)
  const [closedSelectedTicker, setClosedSelectedTicker] = useState<string>('');
  // "Invested Into" comparison: which other asset to compare against
  const [closedInvestedInto, setClosedInvestedInto] = useState<string>('');
  // "Invested From": which sale date to use as the normalization starting point
  const [closedInvestedFrom, setClosedInvestedFrom] = useState<string>('');
  // Chart toggle: start the chart from the first buy date instead of first available price
  const [closedSinceInvested, setClosedSinceInvested] = useState(false);
  // Chart toggle: end the chart at the last sale date instead of latest available price
  const [closedUntilSold, setClosedUntilSold] = useState(false);
  // "Graph Ends": optional end date for the price chart (from last sale to last available month)
  const [closedGraphEnds, setClosedGraphEnds] = useState<string>('');
  // "Graph Starts": optional start date for the price chart (from first available data to first buy)
  const [closedGraphStarts, setClosedGraphStarts] = useState<string>('');
  // Toggle: show/hide the average buy price line on the price chart (default: on)
  const [closedShowAvgBuy, setClosedShowAvgBuy] = useState(true);
  // Toggle: show/hide the average sell price line on the price chart (default: on)
  const [closedShowAvgSell, setClosedShowAvgSell] = useState(true);
  // Set of transaction indices that are currently included (checked) in stats/chart.
  // null means "all included" (default) — avoids rebuilding a Set every time you switch assets.
  const [closedIncludedTxns, setClosedIncludedTxns] = useState<Set<number> | null>(null);
  // Ref for the "select all" checkbox so we can set the indeterminate DOM property
  const closedSelectAllRef = useRef<HTMLInputElement>(null);
  // Ref for click-outside detection on the Closed tab filter dropdowns
  const closedFilterRef = useRef<HTMLDivElement>(null);

  // ---- Positions currency conversion ----
  // Currency to convert all position values into (PLN default, '' = no conversion)
  const [positionsCurrency, setPositionsCurrency] = useState<string>('PLN');

  // ---- Open Positions state ----
  // Raw transaction data from the "Data" sheet (purchases, dividends, sales for all assets)
  const [transactionData, setTransactionData] = useState<TransactionRow[]>([]);
  // Which open-position asset the user drilled into (empty string = showing summary list)
  const [openSelectedTicker, setOpenSelectedTicker] = useState<string>('');
  // Set of purchase transaction indices that are currently included (checked).
  // null = all included (default). Dividends are always included in calculations.
  const [openIncludedTxns, setOpenIncludedTxns] = useState<Set<number> | null>(null);
  // Chart toggle: start the chart from the first buy date
  const [openSinceInvested, setOpenSinceInvested] = useState(false);
  // Toggle: show/hide the avg buy price line (dividend-adjusted) on the price chart
  const [openShowAvgBuy, setOpenShowAvgBuy] = useState(true);
  // "Invested Into" comparison: which other asset to compare against
  const [openInvestedInto, setOpenInvestedInto] = useState<string>('');
  // "Invested From": which buy date to use as the normalization starting point
  const [openInvestedFrom, setOpenInvestedFrom] = useState<string>('');
  // Chart date range controls for open position price chart
  const [openGraphStarts, setOpenGraphStarts] = useState<string>('');
  const [openGraphEnds, setOpenGraphEnds] = useState<string>('');
  // Ref for the "select all" checkbox in open position detail view
  const openSelectAllRef = useRef<HTMLInputElement>(null);

  // ---- Monthly Prices chart state ----
  // Which asset's row is currently selected for chart display (empty = no chart)
  const [monthlySelectedTicker, setMonthlySelectedTicker] = useState<string>('');
  // How many years of data to show in the monthly charts (default: show everything)
  const [monthlyChartPeriod, setMonthlyChartPeriod] = useState<'1Y' | '2Y' | '3Y' | '4Y' | '5Y' | '6Y' | 'max'>('max');
  // Which return period to show in the periodic returns bar chart (Monthly/Quarterly/Annual)
  const [returnsChartPeriod, setReturnsChartPeriod] = useState<'monthly' | 'quarterly' | 'annual'>('quarterly');
  // Period selector for the Graphs tab (separate from Monthly Prices so they don't interfere)
  const [graphsPeriod, setGraphsPeriod] = useState<'1Y' | '2Y' | '3Y' | '4Y' | '5Y' | 'max'>('2Y');
  // End date for the Graphs tab ('' = most recent month in data)
  const [graphsEndDate, setGraphsEndDate] = useState('');
  // Toggle for showing 10-month SMA overlay on all Graphs tab charts
  const [graphsShowSMA, setGraphsShowSMA] = useState(false);
  // Monthly Prices tab: toggle between price view and monthly return (%) view
  const [monthlyViewMode, setMonthlyViewMode] = useState<'prices' | 'returns'>('prices');
  // Monthly Prices tab: end date filter ('' = latest month in data)
  const [monthlyEndDate, setMonthlyEndDate] = useState('');
  // Monthly Prices tab: which column is currently sorted (null = default lookup-table order)
  // Values: 'name', 'month-0'..'month-12', 'sma10', 'signal', 'ticker', 'ret12m', 'dd12m'
  const [monthlySortColumn, setMonthlySortColumn] = useState<string | null>(null);

  // Close Years dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (yearsDropdownRef.current && !yearsDropdownRef.current.contains(event.target as Node)) {
        setYearsDropdownOpen(false);
      }
    };
    if (yearsDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [yearsDropdownOpen]);

  // Close Closed tab filter dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (closedFilterRef.current && !closedFilterRef.current.contains(event.target as Node)) {
        setClosedOpenFilterDropdown(null);
      }
    };
    if (closedOpenFilterDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [closedOpenFilterDropdown]);

  // Manage the "indeterminate" state of the select-all checkbox in the Closed tab.
  // HTML checkbox has three visual states: checked, unchecked, and indeterminate (dash icon).
  // React can't set indeterminate via props — it's a DOM property, so we use a ref.
  useEffect(() => {
    if (closedSelectAllRef.current && closedSelectedTicker) {
      const total = getClosedTransactions(closedSelectedTicker).length;
      const included = closedIncludedTxns === null ? total : closedIncludedTxns.size;
      closedSelectAllRef.current.indeterminate = included > 0 && included < total;
    }
  }, [closedIncludedTxns, closedSelectedTicker]);

  // Same indeterminate checkbox management for the Open positions detail view
  useEffect(() => {
    if (openSelectAllRef.current && openSelectedTicker) {
      const total = getOpenPurchases(openSelectedTicker).length;
      const included = openIncludedTxns === null ? total : openIncludedTxns.size;
      openSelectAllRef.current.indeterminate = included > 0 && included < total;
    }
  }, [openIncludedTxns, openSelectedTicker]);

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
      // Fetch and parse the CSV data from all sheets
      const { data, assets, lookup, yearsData: fetchedYearsData, closedData: fetchedClosedData, transactionData: fetchedTransactionData } = await fetchSheetData();

      // Update all our state with the new data
      setAssetData(data);
      setAvailableAssets(assets);
      setAssetLookup(lookup);
      setYearsData(fetchedYearsData);
      setClosedData(fetchedClosedData);
      setTransactionData(fetchedTransactionData);
      // Auto-select all position tickers (both open and closed) by default
      const closedTickers = new Set(fetchedClosedData.map((row: ClosedPositionRow) => row.ticker));
      // Open tickers: have purchases in transaction data but NO "Proceeds from Sale" entries
      const openTickers = new Set(computeOpenTickers(fetchedTransactionData));
      const allPositionTickers = new Set([...Array.from(closedTickers), ...Array.from(openTickers)]);
      setClosedSelectedTickers(lookup.filter(a => allPositionTickers.has(a.ticker)).map(a => a.ticker));
      setIsConnected(true);

      // Initialize filters to "all selected" when data loads
      // This ensures all assets are visible by default
      setSelectedAssetTickers(lookup.map(a => a.ticker));
      setSelectedAssetClasses(Array.from(new Set(lookup.map(a => a.assetClass).filter(Boolean))));
      setSelectedCurrencies(Array.from(new Set(lookup.map(a => a.currency).filter(Boolean))));
      setSelectedAssetSubcategories(Array.from(new Set(lookup.map(a => a.assetSubcategory).filter(Boolean))));

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
  /**
   * Returns ALL assets from the lookup table, regardless of date range.
   * Assets are no longer filtered by date — instead, the start date auto-adjusts
   * to the shortest history among selected portfolio assets.
   */
  const getAvailableAssetsForDateRange = (): string[] => {
    const lookupTickers = assetLookup.map(l => l.ticker);
    // Use lookup table order (not availableAssets order) so dropdown matches the sheet
    return lookupTickers.length > 0
      ? lookupTickers.filter(ticker => availableAssets.includes(ticker))
      : availableAssets;
  };

  const availableAssetsFiltered = getAvailableAssetsForDateRange();

  /**
   * Finds the first date where an asset has valid (non-zero) price data.
   * Used to determine the earliest possible start date for a portfolio containing this asset.
   */
  const getAssetFirstAvailableDate = (ticker: string): string | null => {
    if (!assetData || !ticker) return null;
    // assetData is sorted chronologically, so the first match is the earliest date
    for (const row of assetData) {
      if (row[ticker] && Number(row[ticker]) > 0) return row.date;
    }
    return null;
  };

  /**
   * Looks at ALL assets selected across ALL portfolios and finds the one with
   * the shortest history (latest first-available date). Returns the limiting
   * asset's name and its first date, so we can auto-set the start date and
   * show which asset is the bottleneck.
   */
  const getLimitingAsset = (): { date: string; assetName: string } | null => {
    if (!assetData || assetData.length === 0) return null;

    let latestFirstDate = '';
    let limitingTicker = '';

    // Check every asset in every portfolio
    for (const portfolio of portfolios) {
      for (const pa of portfolio.assets) {
        if (!pa.asset) continue;
        const firstDate = getAssetFirstAvailableDate(pa.asset);
        if (firstDate && firstDate > latestFirstDate) {
          latestFirstDate = firstDate;
          limitingTicker = pa.asset;
        }
      }
    }

    if (!limitingTicker) return null;

    const assetInfo = assetLookup.find(a => a.ticker === limitingTicker);
    return { date: latestFirstDate, assetName: assetInfo?.name || limitingTicker };
  };

  /**
   * Auto-adjusts the start date to match the shortest history among all
   * selected portfolio assets. Called whenever assets are added/changed/removed.
   */
  const autoAdjustStartDate = (updatedPortfolios: Portfolio[]) => {
    if (!assetData || assetData.length === 0) return;

    let latestFirstDate = '';

    for (const portfolio of updatedPortfolios) {
      for (const pa of portfolio.assets) {
        if (!pa.asset) continue;
        const firstDate = getAssetFirstAvailableDate(pa.asset);
        if (firstDate && firstDate > latestFirstDate) {
          latestFirstDate = firstDate;
        }
      }
    }

    // If we found a limiting date, update the start date
    if (latestFirstDate) {
      setSelectedStartDate(latestFirstDate);
    }
  };

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
   * Gets unique asset subcategories from the lookup table (sorted alphabetically).
   * Used to populate the Subcategory filter dropdown.
   */
  const getUniqueAssetSubcategories = (): string[] => {
    return Array.from(new Set(assetLookup.map(a => a.assetSubcategory).filter(Boolean))).sort();
  };

  /**
   * Filters assetLookup based on selected assets, asset classes, currencies, and subcategories.
   * Returns only assets that match ALL selected criteria (AND logic).
   * Empty asset class, currency, or subcategory fields are treated as matching any selection.
   */
  const getFilteredAssetLookup = (): typeof assetLookup => {
    return assetLookup.filter(asset =>
      selectedAssetTickers.includes(asset.ticker) &&
      (asset.assetClass === '' || selectedAssetClasses.includes(asset.assetClass)) &&
      (asset.currency === '' || selectedCurrencies.includes(asset.currency)) &&
      (asset.assetSubcategory === '' || selectedAssetSubcategories.includes(asset.assetSubcategory))
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

  /**
   * Selects or deselects all asset subcategories at once.
   */
  const toggleAllAssetSubcategories = (selectAll: boolean) => {
    setSelectedAssetSubcategories(selectAll ? getUniqueAssetSubcategories() : []);
  };

  // ----------------------------------------
  // CLOSED POSITIONS TAB HELPER FUNCTIONS
  // ----------------------------------------
  // These support the Closed tab: filtering, transactions, XIRR, chart data, and dashboard stats

  /**
   * Returns assets that exist in BOTH the lookup table AND the closed positions data.
   * This ensures the Closed tab only shows assets we have full info for.
   */
  const getClosedTabLookup = (): AssetLookup[] => {
    const closedTickers = new Set(closedData.map(row => row.ticker));
    return assetLookup.filter(asset => closedTickers.has(asset.ticker));
  };

  /**
   * Applies the Closed tab's asset filter.
   * Returns only the assets that are selected in the Assets dropdown.
   */
  const getClosedFilteredLookup = (): AssetLookup[] => {
    return getClosedTabLookup().filter(asset =>
      closedSelectedTickers.includes(asset.ticker)
    );
  };

  /** Select/deselect all position assets (both open and closed). */
  const toggleAllPositionAssets = (selectAll: boolean) => {
    setClosedSelectedTickers(selectAll ? getPositionsTabLookup().map(a => a.ticker) : []);
  };

  /** Returns all closed position rows for a specific ticker. */
  const getClosedTransactions = (ticker: string): ClosedPositionRow[] => {
    return closedData.filter(row => row.ticker === ticker);
  };

  /**
   * Returns only the INCLUDED (checked) closed transactions for a ticker.
   * When closedIncludedTxns is null, all transactions are included (default).
   * When it's a Set, only transactions at those indices are returned.
   * Used by stats and chart functions so they only reflect checked rows.
   */
  const getFilteredClosedTransactions = (ticker: string): ClosedPositionRow[] => {
    const all = getClosedTransactions(ticker);
    if (closedIncludedTxns === null) return all;
    return all.filter((_, idx) => closedIncludedTxns.has(idx));
  };

  /**
   * XIRR (Extended Internal Rate of Return) — same concept as Excel's XIRR formula.
   *
   * Think of it like this: if you made multiple investments and withdrawals at different
   * dates, XIRR tells you the single annual interest rate that would produce the same result.
   *
   * Uses Newton-Raphson iteration (a mathematical technique to find where a function equals zero).
   * Cash flows: negative = money going out (buying), positive = money coming back (selling).
   *
   * @returns Annual rate as a percentage, or null if calculation fails
   */
  const calculateXIRR = (cashFlows: { date: Date; amount: number }[]): number | null => {
    if (cashFlows.length < 2) return null;

    const d0 = cashFlows[0].date.getTime();
    const MS_PER_YEAR = 365.25 * 86400000; // milliseconds in a year

    // NPV (Net Present Value) at a given rate
    // If NPV = 0, we found the correct rate (that's what XIRR solves for)
    const npv = (rate: number): number => {
      return cashFlows.reduce((sum, cf) => {
        const years = (cf.date.getTime() - d0) / MS_PER_YEAR;
        return sum + cf.amount / Math.pow(1 + rate, years);
      }, 0);
    };

    // Derivative of NPV (needed for Newton-Raphson to know which direction to adjust)
    const dnpv = (rate: number): number => {
      return cashFlows.reduce((sum, cf) => {
        const years = (cf.date.getTime() - d0) / MS_PER_YEAR;
        return sum - years * cf.amount / Math.pow(1 + rate, years + 1);
      }, 0);
    };

    // Newton-Raphson: start with a guess and iteratively improve
    let rate = 0.1; // Initial guess: 10% annual return
    for (let i = 0; i < 100; i++) {
      const f = npv(rate);
      const df = dnpv(rate);
      if (Math.abs(df) < 1e-10) return null; // derivative too small, can't converge
      const newRate = rate - f / df;
      if (isNaN(newRate) || !isFinite(newRate)) return null; // guard against NaN/Infinity
      if (Math.abs(newRate - rate) < 1e-7) return newRate * 100; // converged!
      rate = newRate;
      // Safety: if rate goes crazy, bail out
      if (rate < -0.99 || rate > 100) return null;
    }
    return rate * 100; // return best guess as percentage
  };

  /**
   * Computes all dashboard statistics for a given closed ticker.
   * Returns aggregate metrics across ALL transactions for that asset.
   */
  const getClosedDashboardStats = (ticker: string) => {
    const transactions = getFilteredClosedTransactions(ticker);
    if (transactions.length === 0) return null;

    // 1. Total Holding Time: from earliest buy to latest sale
    const buyDates = transactions.map(t => new Date(t.invDate)).sort((a, b) => a.getTime() - b.getTime());
    const saleDates = transactions.map(t => new Date(t.divDate)).sort((a, b) => a.getTime() - b.getTime());
    const firstBuy = buyDates[0];
    const lastSale = saleDates[saleDates.length - 1];
    const holdingDays = Math.round((lastSale.getTime() - firstBuy.getTime()) / 86400000);
    const holdingYears = holdingDays / 365.25;

    // 2. Total PnL (sum all costs vs sum all final values)
    const totalCost = transactions.reduce((sum, t) => sum + t.initialCost, 0);
    const totalFinalValue = transactions.reduce((sum, t) => sum + t.finalNetValue, 0);
    const totalPnL = totalFinalValue - totalCost;
    const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

    // 3. XIRR (annualized return across all buy/sell transactions)
    const cashFlows = transactions.flatMap(t => [
      { date: new Date(t.invDate), amount: -t.initialCost },   // money out (buying)
      { date: new Date(t.divDate), amount: t.finalNetValue }   // money back (selling + dividends)
    ]).sort((a, b) => a.date.getTime() - b.date.getTime());
    const xirr = calculateXIRR(cashFlows);

    // 4. "If Not Sold" — what the shares would be worth today at current market price
    const totalShares = transactions.reduce((sum, t) => sum + t.sharesSold, 0);
    const currentPrice = getCurrentPrice(ticker);
    const ifNotSold = currentPrice * totalShares;

    // 5. Current Price vs Sold Price (weighted average sell price)
    const weightedSellPrice = totalShares > 0
      ? transactions.reduce((sum, t) => sum + t.sellPrice * t.sharesSold, 0) / totalShares
      : 0;
    const priceVsSoldPct = weightedSellPrice > 0
      ? ((currentPrice - weightedSellPrice) / weightedSellPrice) * 100
      : 0;

    return {
      holdingDays, holdingYears, totalCost, totalFinalValue,
      totalPnL, totalPnLPct, xirr, ifNotSold,
      currentPrice, weightedSellPrice, priceVsSoldPct, totalShares,
      firstBuy, lastSale,
    };
  };

  /**
   * Builds chart data for the performance line chart in the Closed tab.
   * Uses monthly price data for the selected ticker and identifies buy/sell months.
   *
   * Returns:
   * - chartData: array of {date, price} for the LineChart
   * - buyDots: array of {date, price} for green buy markers
   * - sellDots: array of {date, price} for red sell markers
   */
  const getClosedChartData = (ticker: string) => {
    if (!assetData) return { chartData: [] as { date: string; price: number; avgBuyPrice?: number; avgSellPrice?: number }[], buyDots: [] as { date: string; price: number }[], sellDots: [] as { date: string; price: number }[] };

    const transactions = getFilteredClosedTransactions(ticker);

    // Collect buy and sell months in YYYY-MM format for matching against monthly price data
    const buyMonths = new Set(transactions.map(t => toYM(new Date(t.invDate))));
    const sellMonths = new Set(transactions.map(t => toYM(new Date(t.divDate))));

    // Determine date boundaries for "Since Invested" and "Until Sold" toggles
    const sortedBuyDates = transactions.map(t => t.invDate).sort();
    const sortedSaleDates = transactions.map(t => t.divDate).sort();
    const firstBuyDate = sortedBuyDates[0] || '';
    const lastSaleDate = sortedSaleDates[sortedSaleDates.length - 1] || '';

    // Convert to YYYY-MM for comparison with price data
    const firstBuyYM = firstBuyDate ? toYM(new Date(firstBuyDate)) : '';
    const lastSaleYM = lastSaleDate ? toYM(new Date(lastSaleDate)) : '';

    // ---- Build the FIFO average buy price line ----
    // This tracks the weighted average cost basis of shares still held over time.
    // When shares are bought, they go into a FIFO queue (first in, first out).
    // When shares are sold, the oldest lots are removed first, and the average
    // recalculates based on whatever lots remain.
    //
    // Events are: buys (invDate) and sells (divDate), sorted chronologically.
    // Between events, the average stays flat (horizontal line).

    type CostEvent = { date: string; ym: string; type: 'buy' | 'sell'; shares: number; price: number };
    const costEvents: CostEvent[] = [];
    for (const t of transactions) {
      const buyD = new Date(t.invDate);
      const sellD = new Date(t.divDate);
      // Use initialCost / shares as the per-share cost (includes buy commission).
      // If commission data is missing, initialCost = buyPrice × shares, so this still works.
      const costPerShare = t.sharesSold > 0 ? t.initialCost / t.sharesSold : t.buyPrice;
      costEvents.push({
        date: t.invDate,
        ym: toYM(buyD),
        type: 'buy',
        shares: t.sharesSold,
        price: costPerShare,
      });
      costEvents.push({
        date: t.divDate,
        ym: toYM(sellD),
        type: 'sell',
        shares: t.sharesSold,
        price: 0, // sell price doesn't affect cost basis
      });
    }
    // Sort chronologically; if same date, process buys before sells
    costEvents.sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'buy' ? -1 : 1));

    // FIFO queue: each lot is {shares, price}
    const fifoLots: { shares: number; price: number }[] = [];
    // Map of YYYY-MM → average buy price (only for months where we hold shares)
    const avgPriceByMonth = new Map<string, number>();

    for (const evt of costEvents) {
      if (evt.type === 'buy') {
        // Add a new lot to the back of the queue
        fifoLots.push({ shares: evt.shares, price: evt.price });
      } else {
        // Sell: remove shares from the FRONT of the queue (FIFO)
        let toSell = evt.shares;
        while (toSell > 0 && fifoLots.length > 0) {
          if (fifoLots[0].shares <= toSell) {
            toSell -= fifoLots[0].shares;
            fifoLots.shift(); // entire lot consumed
          } else {
            fifoLots[0].shares -= toSell;
            toSell = 0;
          }
        }
      }

      // After this event, compute the weighted average of remaining lots.
      // Use epsilon comparison to avoid floating-point dust (e.g. 1.77e-15 instead of 0)
      // that can accumulate from repeated subtraction of fractional share counts.
      const totalShares = fifoLots.reduce((s, lot) => s + lot.shares, 0);
      if (totalShares > 1e-9) {
        const weightedSum = fifoLots.reduce((s, lot) => s + lot.shares * lot.price, 0);
        avgPriceByMonth.set(evt.ym, weightedSum / totalShares);
      }
      // If totalShares is 0 (all sold), we stop — don't set a value for this month
    }

    // If all shares were sold in the final month, remove that month's avg price entry.
    // Without this, intermediate partial sells within the same month (e.g. selling 9 out of
    // 10 positions) would change the avg to reflect only the last remaining lot's price,
    // causing a misleading jump in the line right before it ends. By deleting the entry,
    // the chart carries forward the pre-sale avg price unchanged into the sale month.
    const finalRemainingShares = fifoLots.reduce((s, lot) => s + lot.shares, 0);
    if (finalRemainingShares < 1e-9 && lastSaleYM) {
      avgPriceByMonth.delete(lastSaleYM);
    }

    // ---- Build the cumulative average sell price line ----
    // Tracks the running weighted-average sale price across all sales to date.
    // Unlike the buy price (which uses FIFO lots), this is a simple running average:
    // cumulative proceeds / cumulative shares sold, updated after each sale event.
    const avgSellPriceByMonth = new Map<string, number>();
    {
      // Collect sell events sorted by date
      const sellEvents = transactions
        .map(t => ({
          ym: toYM(new Date(t.divDate)),
          date: t.divDate,
          shares: t.sharesSold,
          price: t.sellPrice, // raw sell price per share (matches "Sell Price" column)
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      let cumShares = 0;
      let cumProceeds = 0;
      for (const evt of sellEvents) {
        cumShares += evt.shares;
        cumProceeds += evt.shares * evt.price;
        if (cumShares > 1e-9) {
          avgSellPriceByMonth.set(evt.ym, cumProceeds / cumShares);
        }
      }
    }

    // First sale month (for showing the avg sell price line from this point onward).
    // Reuses sortedSaleDates (already computed above) instead of re-sorting.
    const firstSaleYM = sortedSaleDates.length > 0 ? toYM(new Date(sortedSaleDates[0])) : '';

    // Now build chart data, carrying the avg prices forward through months
    const chartData: { date: string; price: number; avgBuyPrice?: number; avgSellPrice?: number }[] = [];
    const buyDots: { date: string; price: number }[] = [];
    const sellDots: { date: string; price: number }[] = [];

    let currentAvgPrice: number | undefined = undefined;
    let currentAvgSellPrice: number | undefined = undefined;

    // Pre-compute filter boundaries once (instead of inside the loop)
    const graphStartsYM = closedGraphStarts ? toYM(new Date(closedGraphStarts)) : '';
    const graphEndsYM = closedGraphEnds ? toYM(new Date(closedGraphEnds)) : '';

    for (const row of assetData) {
      const price = Number(row[ticker]);
      if (!price || price <= 0) continue;

      // Extract YYYY-MM from the price data date
      const rowDate = new Date(row.date);
      if (isNaN(rowDate.getTime())) continue; // skip invalid dates
      const rowYM = toYM(rowDate);

      // Apply toggle filters (compare at month level)
      if (closedSinceInvested && firstBuyYM && rowYM < firstBuyYM) continue;
      if (closedUntilSold && lastSaleYM && rowYM > lastSaleYM) continue;
      // "Graph Starts" dropdown: if a specific start date is selected, cut off before it
      if (graphStartsYM && rowYM < graphStartsYM) continue;
      // "Graph Ends" dropdown: if a specific end date is selected, cut off after it
      if (graphEndsYM && rowYM > graphEndsYM) continue;

      // Update avg buy price if there's a buy/sell event this month
      if (avgPriceByMonth.has(rowYM)) {
        currentAvgPrice = avgPriceByMonth.get(rowYM);
      }
      // Update avg sell price if there's a sale event this month
      if (avgSellPriceByMonth.has(rowYM)) {
        currentAvgSellPrice = avgSellPriceByMonth.get(rowYM);
      }

      // Only show avg buy price line between first buy and last sale
      const showAvgBuy = currentAvgPrice !== undefined && rowYM >= (firstBuyYM || '') && rowYM <= (lastSaleYM || '');
      // Show avg sell price line from first sale onward (continues to end of chart)
      const showAvgSell = currentAvgSellPrice !== undefined && rowYM >= (firstSaleYM || '');

      chartData.push({
        date: row.date,
        price,
        avgBuyPrice: showAvgBuy ? currentAvgPrice : undefined,
        avgSellPrice: showAvgSell ? currentAvgSellPrice : undefined,
      });

      // Mark buy/sell months with dots
      if (buyMonths.has(rowYM)) buyDots.push({ date: row.date, price });
      if (sellMonths.has(rowYM)) sellDots.push({ date: row.date, price });
    }

    return { chartData, buyDots, sellDots };
  };

  /**
   * Builds data for the "Invested Capital" charts in the Closed tab detail view.
   *
   * Tracks how the invested capital and its market value changed over time using FIFO
   * lot accounting. For each month between first buy and last sale, computes:
   *   - investedCapital: total cost basis of shares currently held (goes up on buys, down on sales)
   *   - marketValue: shares currently held × current market price (fluctuates with the market)
   *   - pnl: marketValue - investedCapital (positive = profit, negative = loss)
   */
  const getClosedCapitalChartData = (ticker: string): { date: string; investedCapital: number; marketValue: number; pnl: number; shares: number }[] => {
    if (!assetData) return [];

    const transactions = getFilteredClosedTransactions(ticker);
    if (transactions.length === 0) return [];

    // Collect all buy and sell events from the checked transactions
    type CapitalEvent = { date: string; ym: string; type: 'buy' | 'sell'; shares: number; price: number };
    const events: CapitalEvent[] = [];
    for (const t of transactions) {
      const buyD = new Date(t.invDate);
      const sellD = new Date(t.divDate);
      const costPerShare = t.sharesSold > 0 ? t.initialCost / t.sharesSold : t.buyPrice;
      events.push({
        date: t.invDate,
        ym: toYM(buyD),
        type: 'buy',
        shares: t.sharesSold,
        price: costPerShare,
      });
      events.push({
        date: t.divDate,
        ym: toYM(sellD),
        type: 'sell',
        shares: t.sharesSold,
        price: 0,
      });
    }
    // Sort: chronological, buys before sells on same date
    events.sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'buy' ? -1 : 1));

    // FIFO lot queue — same pattern as avg buy price, but we also track total cost basis
    const lots: { shares: number; price: number }[] = [];
    // Map of YYYY-MM → {invested: total cost basis, shares: total shares held}
    const capitalByMonth = new Map<string, { invested: number; shares: number }>();

    // Determine first buy and last sale months for bounding the chart (computed early
    // so we can capture the pre-sale state during FIFO processing)
    const sortedBuyDates = transactions.map(t => t.invDate).sort();
    const sortedSaleDates = transactions.map(t => t.divDate).sort();
    const firstBuyYM = toYM(new Date(sortedBuyDates[0]));
    const lastSaleYM = toYM(new Date(sortedSaleDates[sortedSaleDates.length - 1]));

    // Track the cost basis just before the final sale(s) so the chart can end at the
    // actual sale values instead of dropping to zero
    let preFinalSaleInvested = 0;
    let capturedPreSaleState = false;

    for (const evt of events) {
      // Before the first sell in the final sale month, snapshot the current lots —
      // this is how much capital was at risk right before liquidation
      if (!capturedPreSaleState && evt.type === 'sell' && evt.ym === lastSaleYM) {
        preFinalSaleInvested = lots.reduce((s, lot) => s + lot.shares * lot.price, 0);
        capturedPreSaleState = true;
      }

      if (evt.type === 'buy') {
        lots.push({ shares: evt.shares, price: evt.price });
      } else {
        // FIFO: remove oldest lots first
        let toSell = evt.shares;
        while (toSell > 0 && lots.length > 0) {
          if (lots[0].shares <= toSell) {
            toSell -= lots[0].shares;
            lots.shift();
          } else {
            lots[0].shares -= toSell;
            toSell = 0;
          }
        }
      }

      // After this event, record the state of remaining lots
      const totalShares = lots.reduce((s, lot) => s + lot.shares, 0);
      const totalInvested = lots.reduce((s, lot) => s + lot.shares * lot.price, 0);
      capitalByMonth.set(evt.ym, { invested: totalInvested, shares: totalShares });
    }

    // Actual sale proceeds for the final month — sum of finalNetValue (includes fees/divs)
    // so the chart's final data point matches the summary line's "sold for" figure
    const finalSaleProceeds = transactions
      .filter(t => {
        const d = new Date(t.divDate);
        return toYM(d) === lastSaleYM;
      })
      .reduce((sum, t) => sum + t.finalNetValue, 0);

    // Iterate through monthly price data, carrying forward the capital state
    const result: { date: string; investedCapital: number; marketValue: number; pnl: number; shares: number }[] = [];
    let currentInvested = 0;
    let currentShares = 0;

    for (const row of assetData) {
      const price = Number(row[ticker]);
      if (!price || price <= 0) continue;

      const rowDate = new Date(row.date);
      if (isNaN(rowDate.getTime())) continue;
      const rowYM = toYM(rowDate);

      // Only show data between first buy and last sale
      if (rowYM < firstBuyYM || rowYM > lastSaleYM) continue;

      // Update capital state if there's an event this month
      if (capitalByMonth.has(rowYM)) {
        const state = capitalByMonth.get(rowYM)!;
        currentInvested = state.invested;
        currentShares = state.shares;
      }

      // Skip months where we don't hold anything yet (before first buy event is processed).
      // Use epsilon for floating-point dust from fractional share arithmetic.
      if (currentShares < 1e-9 && currentInvested < 1e-9 && result.length === 0) continue;

      const marketValue = currentShares * price;
      result.push({
        date: row.date,
        investedCapital: Math.round(currentInvested),
        marketValue: Math.round(marketValue),
        pnl: Math.round(marketValue - currentInvested),
        shares: currentShares,
      });
    }

    // After the final sale, investedCapital and marketValue both drop to 0 (no shares held).
    // Replace trailing zeros with the actual sale outcome so the chart ends at the real
    // sale proceeds — matching the summary line's "invested → sold for → profit" figures.
    // Pop the zero entries first, then append one final point with the true sale values.
    while (result.length > 0 && Math.abs(result[result.length - 1].investedCapital) < 1 && Math.abs(result[result.length - 1].marketValue) < 1) {
      result.pop();
    }
    // Append the sale month's actual outcome: cost basis before selling vs real sale proceeds
    if (preFinalSaleInvested > 0 || finalSaleProceeds > 0) {
      const lastSaleDate = sortedSaleDates[sortedSaleDates.length - 1];
      result.push({
        date: lastSaleDate,
        investedCapital: Math.round(preFinalSaleInvested),
        marketValue: Math.round(finalSaleProceeds),
        pnl: Math.round(finalSaleProceeds - preFinalSaleInvested),
        shares: 0, // all shares sold at this point
      });
    }

    return result;
  };

  /**
   * Builds normalized comparison data for the "Invested Into" overlay.
   *
   * How it works: If you sold Gold in Jan 2021 and bought Silver, this function
   * scales Silver's price so that it starts at the same value as Gold on that date.
   * This lets you visually compare "what if I had kept Gold" vs "how Silver did since then".
   *
   * @param baseTicker - The ticker of the asset you sold
   * @param compTicker - The ticker of the asset you invested into
   * @param fromDateStr - The sale date to normalize from (YYYY-MM-DD)
   * @returns Array of {date, normalizedPrice} for the comparison line
   */
  const getNormalizedComparisonData = (baseTicker: string, compTicker: string, fromDateStr: string) => {
    if (!assetData || !fromDateStr) return [];

    // Find both asset prices at the normalization date (match by month)
    const fromDate = new Date(fromDateStr);
    if (isNaN(fromDate.getTime())) return []; // invalid date guard
    const fromYM = toYM(fromDate);

    let basePriceAtDate = 0;
    let compPriceAtDate = 0;

    for (const row of assetData) {
      const rowDate = new Date(row.date);
      if (isNaN(rowDate.getTime())) continue; // skip invalid dates
      const rowYM = toYM(rowDate);
      if (rowYM === fromYM) {
        const bp = Number(row[baseTicker]);
        const cp = Number(row[compTicker]);
        if (bp > 0) basePriceAtDate = bp;
        if (cp > 0) compPriceAtDate = cp;
      }
    }

    if (compPriceAtDate === 0 || basePriceAtDate === 0) return [];

    // Scale the comparison asset so its value at the sale date equals the base asset's value
    const scaleFactor = basePriceAtDate / compPriceAtDate;

    const result: { date: string; normalizedPrice: number }[] = [];
    for (const row of assetData) {
      const rowDate = new Date(row.date);
      if (isNaN(rowDate.getTime())) continue; // skip invalid dates
      const rowYM = toYM(rowDate);
      if (rowYM < fromYM) continue; // Only show from the sale date onward
      const cp = Number(row[compTicker]);
      if (!cp || cp <= 0) continue;
      result.push({ date: row.date, normalizedPrice: cp * scaleFactor });
    }

    return result;
  };

  // ----------------------------------------
  // OPEN POSITIONS TAB HELPER FUNCTIONS
  // ----------------------------------------
  // These support the Open Positions section: identifying open tickers,
  // computing stats, building chart data — all from raw transaction data.

  /**
   * Returns tickers that are "open" — they have purchases in the transaction data
   * but NO "Proceeds from Sale" entries (i.e., no shares have been sold).
   */
  const getOpenTickers = (): string[] => computeOpenTickers(transactionData);

  /**
   * Returns assets that exist in BOTH the lookup table AND either closed or open positions.
   * Used by the shared "Positions" tab filter dropdown.
   */
  const getPositionsTabLookup = (): AssetLookup[] => {
    const closedTickers = new Set(closedData.map(row => row.ticker));
    const openTickers = new Set(getOpenTickers());
    return assetLookup.filter(asset => closedTickers.has(asset.ticker) || openTickers.has(asset.ticker));
  };

  /** Returns all purchase transaction rows for an open ticker, sorted by date. */
  const getOpenPurchases = (ticker: string): TransactionRow[] => {
    return transactionData
      .filter(t => t.ticker === ticker && t.flow === FLOW_PURCHASE)
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  /** Returns all dividend transaction rows for a ticker, sorted by date. */
  const getOpenDividends = (ticker: string): TransactionRow[] => {
    return transactionData
      .filter(t => t.ticker === ticker && t.flow === FLOW_DIVIDEND)
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  /**
   * Returns only the INCLUDED (checked) purchase transactions for an open ticker.
   * When openIncludedTxns is null, all purchases are included (default).
   */
  const getFilteredOpenPurchases = (ticker: string): TransactionRow[] => {
    const all = getOpenPurchases(ticker);
    if (openIncludedTxns === null) return all;
    return all.filter((_, idx) => openIncludedTxns.has(idx));
  };

  /**
   * Walks backwards through price data to find the most recent price for a ticker.
   * Reusable helper extracted from getClosedDashboardStats logic.
   */
  const getCurrentPrice = (ticker: string): number => {
    if (!assetData || assetData.length === 0) return 0;
    for (let i = assetData.length - 1; i >= 0; i--) {
      const p = Number(assetData[i][ticker]);
      if (p && p > 0) return p;
    }
    return 0;
  };

  /**
   * Computes all dashboard statistics for a given open position ticker.
   * Includes dividend-adjusted avg buy price, XIRR with dividends, and current valuation.
   */
  const getOpenDashboardStats = (ticker: string) => {
    const purchases = getFilteredOpenPurchases(ticker);
    const dividends = getOpenDividends(ticker);
    if (purchases.length === 0) return null;

    // Total shares = sum of all purchase quantities
    const totalShares = purchases.reduce((sum, t) => sum + t.qty, 0);
    // Total invested = sum of all purchase amounts (total cost including commission)
    const totalInvested = purchases.reduce((sum, t) => sum + t.amount, 0);
    // Total dividends received
    const totalDividends = dividends.reduce((sum, t) => sum + t.amount, 0);
    // Total buy commission
    const totalBuyComm = purchases.reduce((sum, t) => sum + t.commAbs, 0);

    // Current market valuation
    const currentPrice = getCurrentPrice(ticker);
    const currentValue = currentPrice * totalShares;

    // PnL = Current Value + Total Dividends - Total Invested (unrealized)
    const totalPnL = currentValue + totalDividends - totalInvested;
    const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

    // Time held from first buy to today
    const firstBuyDate = purchases[0].date;
    const holdingDays = Math.round((Date.now() - new Date(firstBuyDate).getTime()) / 86400000);
    const holdingYears = holdingDays / 365.25;

    // Dividend-adjusted average buy price: (Total Invested - Total Dividends) / Total Shares
    // If you bought for 100 and got 10 in dividends, your effective cost was 90
    const adjAvgBuyPrice = totalShares > 0 ? (totalInvested - totalDividends) / totalShares : 0;
    // Raw weighted average buy price (without dividend adjustment)
    const rawAvgBuyPrice = totalShares > 0 ? totalInvested / totalShares : 0;

    // XIRR: purchases (negative), dividends (positive), current valuation (positive, today)
    const cashFlows: { date: Date; amount: number }[] = [
      ...purchases.map(t => ({ date: new Date(t.date), amount: -t.amount })),
      ...dividends.map(t => ({ date: new Date(t.date), amount: t.amount })),
      { date: new Date(), amount: currentValue },
    ].sort((a, b) => a.date.getTime() - b.date.getTime());
    const xirr = calculateXIRR(cashFlows);

    return {
      totalShares, totalInvested, totalDividends, totalBuyComm,
      currentPrice, currentValue, totalPnL, totalPnLPct,
      holdingDays, holdingYears, adjAvgBuyPrice, rawAvgBuyPrice,
      xirr, firstBuyDate,
    };
  };

  /**
   * Builds chart data for the price history chart in the open position detail view.
   * Similar to getClosedChartData but:
   * - No sell events (position is open)
   * - Avg buy line is dividend-adjusted: (cumulative cost - cumulative dividends) / shares held
   * - Chart extends to the latest available data month (no "Until Sold" cutoff)
   */
  const getOpenChartData = (ticker: string) => {
    if (!assetData) return { chartData: [] as { date: string; price: number; avgBuyPrice?: number }[], buyDots: [] as { date: string; price: number }[] };

    const purchases = getFilteredOpenPurchases(ticker);
    const dividends = getOpenDividends(ticker);

    // Collect buy months for green dot markers
    const buyMonths = new Set(purchases.map(t => toYM(new Date(t.date))));
    const sortedBuyDates = purchases.map(t => t.date).sort();
    const firstBuyYM = sortedBuyDates[0] ? toYM(new Date(sortedBuyDates[0])) : '';

    // Build events: purchases increase cost+shares, dividends reduce effective cost
    type OpenCostEvent = { date: string; ym: string; type: 'buy' | 'div'; shares: number; amount: number };
    const costEvents: OpenCostEvent[] = [
      ...purchases.map(t => ({ date: t.date, ym: toYM(new Date(t.date)), type: 'buy' as const, shares: t.qty, amount: t.amount })),
      ...dividends.map(t => ({ date: t.date, ym: toYM(new Date(t.date)), type: 'div' as const, shares: 0, amount: t.amount })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    // Track cumulative cost, dividends, and shares to compute dividend-adjusted avg buy
    let cumCost = 0;
    let cumDividends = 0;
    let cumShares = 0;
    const adjAvgByMonth = new Map<string, number>();

    for (const evt of costEvents) {
      if (evt.type === 'buy') {
        cumCost += evt.amount;
        cumShares += evt.shares;
      } else {
        // Dividends reduce the effective cost basis
        cumDividends += evt.amount;
      }
      if (cumShares > 1e-9) {
        adjAvgByMonth.set(evt.ym, (cumCost - cumDividends) / cumShares);
      }
    }

    // Build chart data, carrying the avg price forward through months
    const chartData: { date: string; price: number; avgBuyPrice?: number }[] = [];
    const buyDots: { date: string; price: number }[] = [];
    let currentAvg: number | undefined = undefined;

    const graphStartsYM = openGraphStarts ? toYM(new Date(openGraphStarts)) : '';
    const graphEndsYM = openGraphEnds ? toYM(new Date(openGraphEnds)) : '';

    for (const row of assetData) {
      const price = Number(row[ticker]);
      if (!price || price <= 0) continue;
      const rowDate = new Date(row.date);
      if (isNaN(rowDate.getTime())) continue;
      const rowYM = toYM(rowDate);

      // Apply toggle filters
      if (openSinceInvested && firstBuyYM && rowYM < firstBuyYM) continue;
      if (graphStartsYM && rowYM < graphStartsYM) continue;
      if (graphEndsYM && rowYM > graphEndsYM) continue;

      // Update avg buy price if there's an event this month
      if (adjAvgByMonth.has(rowYM)) {
        currentAvg = adjAvgByMonth.get(rowYM);
      }

      // Only show avg buy price line from first buy onward
      const showAvg = currentAvg !== undefined && rowYM >= firstBuyYM;

      chartData.push({
        date: row.date,
        price,
        avgBuyPrice: showAvg ? currentAvg : undefined,
      });

      // Mark buy months with green dots
      if (buyMonths.has(rowYM)) buyDots.push({ date: row.date, price });
    }

    return { chartData, buyDots };
  };

  /**
   * Builds data for the Invested Capital and PnL charts for open positions.
   * Same concept as getClosedCapitalChartData but:
   * - Only buy events (no sell events)
   * - Extends to the latest available data month (no sale endpoint)
   */
  const getOpenCapitalChartData = (ticker: string): { date: string; investedCapital: number; marketValue: number; pnl: number; shares: number }[] => {
    if (!assetData) return [];

    const purchases = getFilteredOpenPurchases(ticker);
    if (purchases.length === 0) return [];
    const dividends = getOpenDividends(ticker);

    // Build buy events sorted by date
    const buyEvents = purchases.map(t => ({
      date: t.date,
      ym: toYM(new Date(t.date)),
      shares: t.qty,
      cost: t.amount,
    })).sort((a, b) => a.date.localeCompare(b.date));

    // Build dividend events by month (cumulative)
    const divEvents = dividends.map(t => ({
      ym: toYM(new Date(t.date)),
      amount: t.amount,
    }));

    const firstBuyYM = toYM(new Date(buyEvents[0].date));

    // Track cumulative capital state at each event month
    let cumShares = 0;
    let cumInvested = 0;
    const capitalByMonth = new Map<string, { invested: number; shares: number }>();

    for (const evt of buyEvents) {
      cumShares += evt.shares;
      cumInvested += evt.cost;
      capitalByMonth.set(evt.ym, { invested: cumInvested, shares: cumShares });
    }

    // Track cumulative dividends by month
    let cumDividends = 0;
    const dividendsByMonth = new Map<string, number>();
    for (const evt of divEvents) {
      cumDividends += evt.amount;
      dividendsByMonth.set(evt.ym, cumDividends);
    }

    // Walk through monthly price data, carrying forward capital state
    const result: { date: string; investedCapital: number; marketValue: number; pnl: number; shares: number }[] = [];
    let currentInvested = 0;
    let currentShares = 0;
    let currentDividends = 0;

    for (const row of assetData) {
      const price = Number(row[ticker]);
      if (!price || price <= 0) continue;
      const rowDate = new Date(row.date);
      if (isNaN(rowDate.getTime())) continue;
      const rowYM = toYM(rowDate);

      // Only show data from first buy onward
      if (rowYM < firstBuyYM) continue;

      // Update capital state if there's a buy event this month
      if (capitalByMonth.has(rowYM)) {
        const state = capitalByMonth.get(rowYM)!;
        currentInvested = state.invested;
        currentShares = state.shares;
      }

      // Update cumulative dividends if there's a dividend this month
      if (dividendsByMonth.has(rowYM)) {
        currentDividends = dividendsByMonth.get(rowYM)!;
      }

      // Skip months before first buy event is processed
      if (currentShares < 1e-9 && result.length === 0) continue;

      const marketValue = currentShares * price;
      // Market value + cumulative dividends = total value of position
      const totalValue = marketValue + currentDividends;
      result.push({
        date: row.date,
        investedCapital: Math.round(currentInvested),
        marketValue: Math.round(totalValue),
        pnl: Math.round(totalValue - currentInvested),
        shares: currentShares,
      });
    }

    return result;
  };

  // ----------------------------------------
  // PORTFOLIO MANAGEMENT FUNCTIONS
  // ----------------------------------------

  /**
   * Generates a portfolio name from its assets.
   * e.g., [SPY 60%, BND 40%] -> "SPY60-BND40"
   */
  const generatePortfolioName = (assets: PortfolioAsset[], inflationAdj?: string, baseCurrency?: string): string => {
    const validAssets = assets.filter(a => a.asset && a.weight > 0);
    if (validAssets.length === 0) return 'Portfolio';
    const baseName = validAssets.map(a => `${a.asset}${Math.round(a.weight)}`).join('-');
    // Build suffixes: currency (if set) and inflation adjustment (if set)
    const suffixes: string[] = [];
    if (baseCurrency) suffixes.push(baseCurrency);
    if (inflationAdj) {
      const cpiLabel = CPI_OPTIONS.find(o => o.value === inflationAdj)?.label || 'CPI';
      suffixes.push(`Real ${cpiLabel}`);
    }
    if (suffixes.length > 0) return `${baseName} (${suffixes.join(', ')})`;
    return baseName;
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
    const colors = ['#000000', '#F5A623', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899'];
    const newId = Math.max(...portfolios.map(p => p.id), 0) + 1;

    setPortfolios([...portfolios, {
      id: newId,
      name: `Portfolio ${newId}`,
      assets: [],
      color: colors[portfolios.length % colors.length],
      nameManuallyEdited: false,
      inflationAdj: '',  // Default: no inflation adjustment (nominal values)
      baseCurrency: ''   // Default: no currency conversion (assets stay in native currencies)
    }]);
  };

  /**
   * Removes a portfolio by ID
   */
  const removePortfolio = (id: number) => {
    const updatedPortfolios = portfolios.filter(p => p.id !== id);
    setPortfolios(updatedPortfolios);
    autoAdjustStartDate(updatedPortfolios);
  };

  /**
   * Adds a new asset slot to a portfolio
   */
  const addAssetToPortfolio = (portfolioId: number) => {
    const firstAvailableAsset = availableAssetsFiltered[0] || '';

    const updatedPortfolios = portfolios.map(p => {
      if (p.id === portfolioId) {
        // First asset starts at 100%, subsequent assets start at 0%
        const isFirstAsset = p.assets.length === 0;
        const newAssets = [...p.assets, {
          asset: firstAvailableAsset,
          weight: isFirstAsset ? 100 : 0,
        }];
        const newName = p.nameManuallyEdited ? p.name : generatePortfolioName(newAssets, p.inflationAdj, p.baseCurrency);
        return { ...p, assets: newAssets, name: newName };
      }
      return p;
    });
    setPortfolios(updatedPortfolios);
    autoAdjustStartDate(updatedPortfolios);
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
   * Looks up an asset's native currency from the lookup table.
   * e.g., "CSPX" → "USD", "WIG20" → "PLN", "ES3" → "SGD"
   */
  const getAssetCurrency = (assetTicker: string): string => {
    const entry = assetLookup.find(a => a.ticker === assetTicker);
    return entry?.currency || 'PLN';  // Default to PLN if not found
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
  const getConversionRate = (row: AssetRow, fromCurrency: string, toCurrency: string): number => {
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
   * Sets the start date based on a preset period (YTD, 1Y, 3Y, 5Y).
   * Keeps the end date unchanged and calculates the new start date.
   * Finds the closest available date in the data if exact date doesn't exist.
   */
  const setDatePreset = (preset: 'YTD' | '1Y' | '2Y' | '3Y' | '4Y' | '5Y' | '6Y' | '7Y' | '8Y' | '9Y' | '10Y' | 'Max') => {
    if (!assetData || assetData.length === 0) return;

    if (preset === 'Max') {
      // Use the limiting asset's first date (shortest history), or the first date in the dataset
      const limiting = getLimitingAsset();
      setSelectedStartDate(limiting ? limiting.date : assetData[0].date);
      return;
    }

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
    let targetDateStr = targetStartDate.toISOString().split('T')[0];

    // Enforce: can't go earlier than the limiting asset's first available date
    const limiting = getLimitingAsset();
    if (limiting && targetDateStr < limiting.date) {
      targetDateStr = limiting.date;
    }

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
  const updateAsset = (portfolioId: number, assetIndex: number, field: 'asset' | 'weight', value: string | number) => {
    const updatedPortfolios = portfolios.map(p => {
      if (p.id === portfolioId) {
        let newAssets = [...p.assets];
        newAssets[assetIndex] = { ...newAssets[assetIndex], [field]: value };

        // Auto-adjust first asset if we changed weight of another asset
        if (field === 'weight' && assetIndex > 0) {
          newAssets = autoAdjustFirstAsset(newAssets);
        }

        const newName = p.nameManuallyEdited ? p.name : generatePortfolioName(newAssets, p.inflationAdj, p.baseCurrency);
        return { ...p, assets: newAssets, name: newName };
      }
      return p;
    });
    setPortfolios(updatedPortfolios);
    // Auto-adjust start date when an asset ticker is changed (not when weight changes)
    if (field === 'asset') {
      autoAdjustStartDate(updatedPortfolios);
    }
  };

  /**
   * Removes an asset from a portfolio
   */
  const removeAsset = (portfolioId: number, assetIndex: number) => {
    const updatedPortfolios = portfolios.map(p => {
      if (p.id === portfolioId) {
        let newAssets = p.assets.filter((_, i) => i !== assetIndex);

        // If we removed an asset other than first, auto-adjust first asset
        if (assetIndex > 0 && newAssets.length > 0) {
          newAssets = autoAdjustFirstAsset(newAssets);
        }

        const newName = p.nameManuallyEdited ? p.name : generatePortfolioName(newAssets, p.inflationAdj, p.baseCurrency);
        return { ...p, assets: newAssets, name: newName };
      }
      return p;
    });
    setPortfolios(updatedPortfolios);
    autoAdjustStartDate(updatedPortfolios);
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

    // --- CPI Inflation Adjustment Setup ---
    // When inflationAdj is set (e.g., "CPIMPL"), we divide portfolio values by the
    // CPI index normalized to the start date. This converts nominal values to "real"
    // (purchasing-power-adjusted) values.
    // Example: if CPI went from 100 to 120 (+20% inflation), a $1M portfolio is really
    // worth $1M / 1.20 = $833K in today's purchasing power.
    const cpiTicker = portfolio.inflationAdj;
    let baseCpi = 1;  // CPI at start date (used to normalize the index to 1.0)
    if (cpiTicker) {
      const startCpi = Number(filteredData[0][cpiTicker]);
      if (startCpi && startCpi > 0) {
        baseCpi = startCpi;
      }
    }

    // Target weights as decimals (e.g., 60% -> 0.6)
    const targetWeights: { [asset: string]: number } = {};
    portfolio.assets.forEach(({ asset, weight }) => {
      targetWeights[asset] = weight / 100;
    });

    // Calculate initial shares for each asset
    // Shares = how many units of each asset we own
    // Each asset's price is converted to the portfolio's base currency using cross-rate via PLN
    const assetShares: { [asset: string]: number } = {};
    portfolio.assets.forEach(({ asset, weight }) => {
      const initialPrice = Number(filteredData[0][asset]);
      const assetCcy = getAssetCurrency(asset);
      const convRate = getConversionRate(filteredData[0], assetCcy, portfolio.baseCurrency);
      const adjustedPrice = initialPrice * convRate;  // Convert to base currency
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

      // Calculate current portfolio value (nominal — before inflation adjustment)
      // Each asset's value = shares × price, converted to base currency
      let nominalValue = 0;
      portfolio.assets.forEach(({ asset }) => {
        const currentPrice = Number(row[asset]);
        const assetCcy = getAssetCurrency(asset);
        const convRate = getConversionRate(row, assetCcy, portfolio.baseCurrency);
        const adjustedPrice = currentPrice * convRate;  // Convert to base currency
        if (adjustedPrice && adjustedPrice > 0 && assetShares[asset]) {
          nominalValue += assetShares[asset] * adjustedPrice;
        }
      });

      // Rebalance uses NOMINAL value (we rebalance real shares, not inflation-adjusted ones)
      if (shouldRebalance && nominalValue > 0) {
        portfolio.assets.forEach(({ asset, weight }) => {
          const currentPrice = Number(row[asset]);
          const assetCcy = getAssetCurrency(asset);
          const convRate = getConversionRate(row, assetCcy, portfolio.baseCurrency);
          const adjustedPrice = currentPrice * convRate;  // Convert to base currency
          if (adjustedPrice && adjustedPrice > 0) {
            const targetAllocation = nominalValue * (weight / 100);
            assetShares[asset] = targetAllocation / adjustedPrice;
          }
        });
        lastRebalanceDate = currentDate;
      }

      // Apply CPI inflation adjustment if selected
      // Divides nominal value by the CPI ratio (current CPI / start CPI)
      // so the output shows purchasing power in "start-date dollars/PLN"
      let portfolioValue = nominalValue;
      if (cpiTicker) {
        const currentCpi = Number(row[cpiTicker]);
        if (currentCpi && currentCpi > 0) {
          portfolioValue = nominalValue / (currentCpi / baseCpi);
        }
      }

      // Track running maximum for drawdown calculation (uses adjusted value)
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
   * Uses the "4% rule" (Trinity Study) fixed-dollar withdrawal strategy:
   *
   * HOW IT WORKS:
   * - Year 1: Withdraw a fixed % of the INITIAL portfolio value (e.g., 4% of $1M = $40,000)
   * - Year 2+: Take last year's dollar withdrawal and increase it by inflation only
   * - The withdrawal dollar amount is independent of current portfolio value
   * - This lets you see: "Would my portfolio survive if I pulled out $X/year (adjusted for inflation)?"
   */
  const calculateWithdrawalReturns = (returns: ReturnPoint[], withdrawalPct: number, inflationPct: number = 0): { date: string; value: number }[] => {
    if (!returns || returns.length < 2) return [];

    const result: { date: string; value: number }[] = [];
    let withdrawalValue = returns[0].value;  // Start at same value as original portfolio
    result.push({ date: returns[0].date, value: withdrawalValue });

    // Fixed dollar amount for year 1 (e.g., 4% of $1M = $40,000)
    const baseWithdrawal = returns[0].value * (withdrawalPct / 100);

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
   * Builds a year-by-year breakdown of the withdrawal simulation.
   * Uses the "4% rule" (Trinity Study) fixed-dollar withdrawal strategy,
   * matching the logic in calculateWithdrawalReturns exactly.
   *
   * Each row represents one year and shows:
   * - Starting value, growth, pre-withdrawal value, effective rate, withdrawal amount, and ending value
   * - "Effective rate" is now informational: it shows what % of current value the fixed withdrawal represents
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
    // Fixed dollar amount for year 1 (e.g., 4% of $1M = $40,000)
    const baseWithdrawal = returns[0].value * (withdrawalPct / 100);

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

  /**
   * Builds the month-by-month rebalancing detail for a portfolio.
   * Mirrors calculatePortfolioReturns() but also captures per-asset
   * FX-adjusted prices and drifted weights so we can display them in a table.
   */
  const getRebalancingDetails = (result: BacktestResult): RebalancingRow[] => {
    if (!assetData || assetData.length === 0) return [];
    const portfolio = result.portfolio;
    if (!portfolio.assets.length) return [];

    // Filter data to the selected date range (same as calculatePortfolioReturns)
    const filteredData = assetData.filter(row =>
      row.date >= selectedDateRange.start && row.date <= selectedDateRange.end
    );
    if (filteredData.length < 2) return [];

    // Initial share allocation — identical logic to calculatePortfolioReturns
    const assetShares: { [asset: string]: number } = {};
    portfolio.assets.forEach(({ asset, weight }) => {
      const initialPrice = Number(filteredData[0][asset]);
      const assetCcy = getAssetCurrency(asset);
      const convRate = getConversionRate(filteredData[0], assetCcy, portfolio.baseCurrency);
      const adjustedPrice = initialPrice * convRate;
      if (adjustedPrice && adjustedPrice > 0) {
        assetShares[asset] = (startingCapital * (weight / 100)) / adjustedPrice;
      } else {
        assetShares[asset] = 0;
      }
    });

    const rows: RebalancingRow[] = [];
    let lastRebalanceDate = new Date(filteredData[0].date);
    let prevValue: number | null = null;

    for (let i = 0; i < filteredData.length; i++) {
      const row = filteredData[i];
      const currentDate = new Date(row.date);

      // Determine whether to rebalance (same month-counting logic)
      let shouldRebalance = false;
      if (i > 0) {
        const monthsSince =
          (currentDate.getFullYear() - lastRebalanceDate.getFullYear()) * 12 +
          (currentDate.getMonth() - lastRebalanceDate.getMonth());
        if (rebalanceFreq === 'monthly' && monthsSince >= 1) shouldRebalance = true;
        else if (rebalanceFreq === 'quarterly' && monthsSince >= 3) shouldRebalance = true;
        else if (rebalanceFreq === 'yearly' && monthsSince >= 12) shouldRebalance = true;
      }

      // Compute currency-adjusted prices and total portfolio value
      const assetPrices: { [asset: string]: number } = {};
      let portfolioValue = 0;
      portfolio.assets.forEach(({ asset }) => {
        const price = Number(row[asset]);
        const assetCcy = getAssetCurrency(asset);
        const convRate = getConversionRate(row, assetCcy, portfolio.baseCurrency);
        const adjustedPrice = price * convRate;
        assetPrices[asset] = adjustedPrice;
        if (adjustedPrice > 0 && assetShares[asset]) {
          portfolioValue += assetShares[asset] * adjustedPrice;
        }
      });

      // Compute actual (drifted) weights
      const assetWeights: { [asset: string]: number } = {};
      portfolio.assets.forEach(({ asset }) => {
        if (portfolioValue > 0 && assetShares[asset] && assetPrices[asset] > 0) {
          assetWeights[asset] = (assetShares[asset] * assetPrices[asset] / portfolioValue) * 100;
        } else {
          assetWeights[asset] = 0;
        }
      });

      // MoM return %
      const momPct = prevValue !== null && prevValue > 0
        ? ((portfolioValue - prevValue) / prevValue) * 100
        : null;

      // Snapshot current shares (copy values so rebalancing below doesn't mutate them)
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
      });

      // Rebalance shares AFTER recording the row (so weights show pre-rebalance drift)
      if (shouldRebalance && portfolioValue > 0) {
        portfolio.assets.forEach(({ asset, weight }) => {
          const adjustedPrice = assetPrices[asset];
          if (adjustedPrice && adjustedPrice > 0) {
            assetShares[asset] = (portfolioValue * (weight / 100)) / adjustedPrice;
          }
        });
        lastRebalanceDate = currentDate;
      }

      prevValue = portfolioValue;
    }

    return rows;
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

    // Longest drawdown duration: how many months the portfolio stayed underwater (below its all-time high)
    let longestDDMonths = 0;
    let currentDDMonths = 0;
    for (let i = 0; i < returns.length; i++) {
      if (returns[i].drawdown < 0) {
        // Portfolio is underwater — count this month
        currentDDMonths++;
      } else {
        // Portfolio recovered to a new high — check if this streak was the longest
        if (currentDDMonths > longestDDMonths) {
          longestDDMonths = currentDDMonths;
        }
        currentDDMonths = 0;
      }
    }
    // Check if we ended while still underwater (the final streak might be the longest)
    if (currentDDMonths > longestDDMonths) {
      longestDDMonths = currentDDMonths;
    }

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
      longestDrawdown: formatPeriod(longestDDMonths),
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

  // Memoized annual returns — only recalculated when assetData or assetLookup changes,
  // NOT when toggling between Returns/Prices view or changing other UI state
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoizedAnnualReturns = useMemo(() => calculateAssetsAnnualReturns(), [assetData, assetLookup]);

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
  const calculateAssetStats = (ticker: string, startDate?: string, endDate?: string): {
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

    // Calculate monthly returns: (currentPrice - previousPrice) / previousPrice
    const monthlyReturns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      monthlyReturns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    // Volatility: annualized standard deviation of monthly returns
    // Same formula as Backtest Statistics: sqrt(variance) * sqrt(12) * 100
    const mean = monthlyReturns.reduce((sum, r) => sum + r, 0) / monthlyReturns.length;
    const variance = monthlyReturns.map(r => Math.pow(r - mean, 2)).reduce((sum, sq) => sum + sq, 0) / monthlyReturns.length;
    const volatility = Math.sqrt(variance) * Math.sqrt(12) * 100;

    // Maximum drawdown and longest drawdown duration in a single pass
    // MaxDD: worst peak-to-trough decline (same as Backtest Statistics)
    // Longest DD: consecutive months underwater below peak (same as Backtest Statistics)
    let peak = prices[0];
    let maxDrawdown = 0;
    let longestDDMonths = 0;
    let currentDDMonths = 0;
    for (const price of prices) {
      if (price >= peak) {
        // At or above peak - update peak and check if this DD streak was longest
        peak = price;
        if (currentDDMonths > longestDDMonths) longestDDMonths = currentDDMonths;
        currentDDMonths = 0;
      } else {
        // Below peak - track drawdown depth and count months underwater
        const drawdown = ((price - peak) / peak) * 100;
        if (drawdown < maxDrawdown) maxDrawdown = drawdown;
        currentDDMonths++;
      }
    }
    // Check if we ended while still underwater
    if (currentDDMonths > longestDDMonths) longestDDMonths = currentDDMonths;
    return { volatility, maxDrawdown, longestDDMonths };
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
      returns: (number | null)[]; // 13 monthly returns (%), null if can't compute
      sma10: number | null;       // 10-month SMA (average of last 10 months including current)
      signal: 'BUY' | 'SELL' | null;  // BUY if price > SMA, SELL if price < SMA
      signals: ('BUY' | 'SELL' | null)[];  // Signal at each of 13 months (for historical view)
      dd12m: number | null;       // 12-month drawdown: how far current price is below the 12-month high (%)
      ret12m: number | null;      // 12-month return: % change from first to last of the 13 displayed months
    }>;
  } => {
    if (!assetData || assetData.length === 0) {
      return { months: [], assets: [] };
    }

    // Use monthlyEndDate (tab-specific), then selectedEndDate (global), then last date in data
    const endDateStr = monthlyEndDate || selectedEndDate || assetData[assetData.length - 1].date;
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

      // Calculate monthly returns (%) for each of 13 displayed months
      // Return = (currentMonthPrice - previousMonthPrice) / previousMonthPrice * 100
      // Uses allPrices so even the first displayed month can have a return (using month -1 from allPrices)
      const returns: (number | null)[] = prices.map((price, displayIdx) => {
        if (price === null) return null;
        // allPrices index for this display month
        const allIdx = displayIdx + 9;
        // Previous month's price from allPrices
        const prevPrice = allPrices[allIdx - 1];
        if (prevPrice === null || prevPrice === 0) return null;
        return ((price - prevPrice) / prevPrice) * 100;
      });

      // 12-month drawdown: how far the current price sits below the highest price
      // across the displayed 13 months (current + 12 prior). Always <= 0 when below max.
      let dd12m: number | null = null;
      if (currentPrice !== null) {
        const validDisplayPrices = prices.filter((p): p is number => p !== null);
        if (validDisplayPrices.length > 0) {
          const max12m = Math.max(...validDisplayPrices);
          dd12m = max12m > 0 ? ((currentPrice - max12m) / max12m) * 100 : 0;
        }
      }

      // 12-month return: % change from first displayed month to last displayed month
      // prices[0] = 12 months ago, prices[12] = current month
      let ret12m: number | null = null;
      const firstPrice = prices[0];
      if (currentPrice !== null && firstPrice !== null && firstPrice > 0) {
        ret12m = ((currentPrice - firstPrice) / firstPrice) * 100;
      }

      return {
        ticker: asset.ticker,
        name: asset.name,
        prices,
        returns,
        sma10,
        signal,
        signals,
        dd12m,
        ret12m
      };
    });

    return { months, assets };
  };

  /**
   * Builds chart-ready data for the Monthly Prices interactive charts.
   * Given a ticker and a period (1Y–6Y or max), produces:
   *  - priceData: monthly prices + 10-month SMA
   *  - drawdownData: how far below the all-time-high at each month
   *  - Notable points (max price, min price, max drawdown) in the visible window
   *
   * SMA and ATH are computed over the FULL history so they remain correct even when
   * the visible window is shortened (e.g. 1Y still gets SMA from 10 months before).
   */
  const getMonthlyChartData = (
    ticker: string,
    period: '1Y' | '2Y' | '3Y' | '4Y' | '5Y' | '6Y' | 'max',
    cutoffDate?: string  // Optional: if provided, treat this as the last month (for Graphs tab "End Date" filter)
  ) => {
    if (!assetData || assetData.length === 0) return null;

    // 1. Extract monthly prices: group by YYYY-MM, take the last valid price per month
    const monthlyMap = new Map<string, { date: string; price: number }>();
    for (const row of assetData) {
      const p = Number(row[ticker]);
      if (!p || p <= 0) continue;
      const d = new Date(row.date);
      if (isNaN(d.getTime())) continue;
      const ym = toYM(d);
      // Overwrite with the latest row for this month (data is chronological)
      monthlyMap.set(ym, { date: row.date, price: p });
    }
    // Sort by date to get a chronological array
    const allMonths = Array.from(monthlyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    if (allMonths.length === 0) return null;

    // 2. Compute 10-month SMA and drawdown for every month (using full history)
    let ath = 0; // all-time-high running tracker
    const fullData: { date: string; price: number; sma10: number | null; drawdown: number; smaDistance: number | null }[] = [];
    for (let i = 0; i < allMonths.length; i++) {
      const { date, price } = allMonths[i];

      // 10M SMA: average of current + 9 prior months (need at least 10 data points)
      let sma10: number | null = null;
      if (i >= 9) {
        let sum = 0;
        for (let j = i - 9; j <= i; j++) sum += allMonths[j].price;
        sma10 = sum / 10;
      }

      // Drawdown from ATH: track running maximum, compute % below it
      if (price > ath) ath = price;
      const drawdown = ath > 0 ? ((price - ath) / ath) * 100 : 0;

      // SMA distance: how far (in %) the price sits above or below the 10M SMA
      const smaDistance = sma10 !== null ? ((price - sma10) / sma10) * 100 : null;

      fullData.push({ date, price, sma10, drawdown, smaDistance });
    }

    // 3. Apply period filter — slice the last N months for the visible window
    //    If endDate is provided, first truncate to end at that date, then take last N months
    const periodMonths: Record<string, number> = {
      '1Y': 12, '2Y': 24, '3Y': 36, '4Y': 48, '5Y': 60, '6Y': 72
    };
    // When cutoffDate is set, find the last entry on or before that date
    let effectiveData = fullData;
    if (cutoffDate) {
      const endIdx = fullData.findLastIndex(d => d.date <= cutoffDate);
      if (endIdx >= 0) {
        effectiveData = fullData.slice(0, endIdx + 1);
      }
    }
    const n = period === 'max' ? effectiveData.length : Math.min(periodMonths[period] || effectiveData.length, effectiveData.length);
    const visibleData = effectiveData.slice(effectiveData.length - n);
    if (visibleData.length === 0) return null;

    // 4. Separate into price, drawdown, and SMA-distance arrays for the three charts
    const priceData = visibleData.map(d => ({ date: d.date, price: d.price, sma10: d.sma10 }));
    const drawdownData = visibleData.map(d => ({ date: d.date, drawdown: d.drawdown }));

    // SMA distance chart data: only months where SMA exists
    const smaDistData = visibleData
      .filter(d => d.smaDistance !== null)
      .map(d => ({
        date: d.date,
        smaDist: d.smaDistance!,                    // distance from SMA in %
      }));

    // 5. Find notable points within the visible window
    let maxPricePoint: { date: string; price: number } | null = null;
    let minPricePoint: { date: string; price: number } | null = null;
    let maxDrawdownPoint: { date: string; drawdown: number } | null = null;
    for (const d of visibleData) {
      if (!maxPricePoint || d.price > maxPricePoint.price) maxPricePoint = { date: d.date, price: d.price };
      if (!minPricePoint || d.price < minPricePoint.price) minPricePoint = { date: d.date, price: d.price };
      if (!maxDrawdownPoint || d.drawdown < maxDrawdownPoint.drawdown) maxDrawdownPoint = { date: d.date, drawdown: d.drawdown };
    }

    // Notable points for SMA distance: furthest above SMA (green dot) and furthest below (red dot)
    let maxSmaDistPoint: { date: string; smaDist: number } | null = null;
    let minSmaDistPoint: { date: string; smaDist: number } | null = null;
    for (const d of smaDistData) {
      if (!maxSmaDistPoint || d.smaDist > maxSmaDistPoint.smaDist) maxSmaDistPoint = { date: d.date, smaDist: d.smaDist };
      if (!minSmaDistPoint || d.smaDist < minSmaDistPoint.smaDist) minSmaDistPoint = { date: d.date, smaDist: d.smaDist };
    }

    // 6. Compute total return and CAGR for the visible window
    //    Total Return = ((endPrice - startPrice) / startPrice) * 100
    //    CAGR = ((endPrice / startPrice) ^ (1 / years) - 1) * 100
    const startPrice = visibleData[0].price;
    const endPrice = visibleData[visibleData.length - 1].price;
    const totalReturn = ((endPrice - startPrice) / startPrice) * 100;

    // Years between first and last data point (using actual dates for accuracy)
    const startDate = new Date(visibleData[0].date);
    const endDate = new Date(visibleData[visibleData.length - 1].date);
    const years = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    // CAGR only makes sense over a period > 0 years; for very short spans just show total return
    const cagr = years >= 1
      ? (Math.pow(endPrice / startPrice, 1 / years) - 1) * 100
      : null;

    return { priceData, drawdownData, smaDistData, maxPricePoint, minPricePoint, maxDrawdownPoint, maxSmaDistPoint, minSmaDistPoint, totalReturn, cagr };
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
   * Price heatmap: dark red (lowest) → white (mid) → dark green (highest).
   * Used for all price tables (Monthly prices, Annual prices, detail view prices).
   * Text always stays dark — only the background color changes.
   */
  const getPriceHeatmap = (value: number, min: number, max: number): string => {
    if (min === max) return '#ffffff';
    const pos = (value - min) / (max - min); // 0 = min, 1 = max

    let r: number, g: number, b: number;
    if (pos < 0.5) {
      // Bottom half: soft muted red → white
      const t = pos / 0.5;
      r = Math.round(205 + t * (255 - 205)); // 205 → 255
      g = Math.round(130 + t * (255 - 130)); // 130 → 255
      b = Math.round(130 + t * (255 - 130)); // 130 → 255
    } else {
      // Top half: white → soft muted green
      const t = (pos - 0.5) / 0.5;
      r = Math.round(255 - t * (255 - 120)); // 255 → 120
      g = Math.round(255 - t * (255 - 190)); // 255 → 190
      b = Math.round(255 - t * (255 - 120)); // 255 → 120
    }

    return `rgb(${r}, ${g}, ${b})`;
  };

  /**
   * Maps a correlation value (-1 to +1) to a color:
   * +1 (perfect positive correlation) → Red (assets move together, less diversification)
   *  0 (no correlation) → Yellow (assets are independent)
   * -1 (perfect negative correlation) → Green (assets move opposite, great diversification)
   *
   * Uses the same HSL approach as getHeatmapColor but with a fixed range of -1 to +1.
   */
  const getCorrelationColor = (value: number): string => {
    // Formula: hue = (1 - value) * 60
    // When value = +1: hue = 0 (red)
    // When value =  0: hue = 60 (yellow)
    // When value = -1: hue = 120 (green)
    const hue = (1 - value) * 60;
    return `hsl(${hue}, 80%, 85%)`;
  };

  /**
   * Calculates the NxN correlation matrix for all filtered assets using monthly returns.
   *
   * HOW IT WORKS:
   * 1. Gets the list of filtered assets (respecting the asset/class/currency filters)
   * 2. Slices the price data to the last N years (based on correlationPeriod)
   * 3. For each asset, calculates monthly returns: (price this month / price last month) - 1
   * 4. For each pair of assets, computes the Pearson correlation coefficient:
   *    r = Σ((x - x̄)(y - ȳ)) / √(Σ(x - x̄)² × Σ(y - ȳ)²)
   *    This tells us how closely two assets move together (-1 to +1)
   *
   * @param periodYears - Number of years of data to use (e.g., 3 = last 3 years)
   * @returns Object with tickers array and NxN matrix of correlation values
   */
  const calculateCorrelationMatrix = (periodYears: number): { tickers: string[], matrix: number[][] } => {
    if (!assetData || assetData.length < 2) return { tickers: [], matrix: [] };

    // Get the filtered list of assets based on user's filter selections
    const filteredAssets = getFilteredAssetLookup();
    const tickers = filteredAssets.map(a => a.ticker);

    if (tickers.length === 0) return { tickers: [], matrix: [] };

    // Slice data to the last N years (each year = 12 monthly data points)
    const monthsNeeded = periodYears * 12;
    const dataSlice = assetData.slice(-monthsNeeded - 1); // Need one extra row to calculate first return

    // Calculate monthly returns for each asset
    // Monthly return = (price this month / price last month) - 1
    const returns: { [ticker: string]: number[] } = {};

    for (const ticker of tickers) {
      const monthlyReturns: number[] = [];
      for (let i = 1; i < dataSlice.length; i++) {
        const currentPrice = Number(dataSlice[i][ticker]);
        const previousPrice = Number(dataSlice[i - 1][ticker]);
        // Only include if both prices are valid (non-zero, non-NaN)
        if (currentPrice > 0 && previousPrice > 0) {
          monthlyReturns.push((currentPrice / previousPrice) - 1);
        } else {
          // Use NaN as a placeholder for missing data
          monthlyReturns.push(NaN);
        }
      }
      returns[ticker] = monthlyReturns;
    }

    // Build the NxN correlation matrix
    const matrix: number[][] = [];

    for (let i = 0; i < tickers.length; i++) {
      const row: number[] = [];
      for (let j = 0; j < tickers.length; j++) {
        if (i === j) {
          // An asset is always perfectly correlated with itself
          row.push(1.0);
        } else {
          // Calculate Pearson correlation between assets i and j
          const xReturns = returns[tickers[i]];
          const yReturns = returns[tickers[j]];

          // Only use months where BOTH assets have valid data
          const pairs: { x: number; y: number }[] = [];
          for (let k = 0; k < Math.min(xReturns.length, yReturns.length); k++) {
            if (!isNaN(xReturns[k]) && !isNaN(yReturns[k])) {
              pairs.push({ x: xReturns[k], y: yReturns[k] });
            }
          }

          // Need at least 3 data points for a meaningful correlation
          if (pairs.length < 3) {
            row.push(NaN);
            continue;
          }

          // Calculate means
          const xMean = pairs.reduce((sum, p) => sum + p.x, 0) / pairs.length;
          const yMean = pairs.reduce((sum, p) => sum + p.y, 0) / pairs.length;

          // Calculate Pearson correlation: r = Σ((x-x̄)(y-ȳ)) / √(Σ(x-x̄)² × Σ(y-ȳ)²)
          let numerator = 0;   // Σ((x - x̄)(y - ȳ))
          let denomX = 0;      // Σ(x - x̄)²
          let denomY = 0;      // Σ(y - ȳ)²

          for (const pair of pairs) {
            const dx = pair.x - xMean;
            const dy = pair.y - yMean;
            numerator += dx * dy;
            denomX += dx * dx;
            denomY += dy * dy;
          }

          const denominator = Math.sqrt(denomX * denomY);
          // Avoid division by zero (happens if one asset has zero variance)
          const correlation = denominator === 0 ? 0 : numerator / denominator;
          row.push(correlation);
        }
      }
      matrix.push(row);
    }

    return { tickers, matrix };
  };

  // ============================================
  // PORTFOLIO TAB HELPER FUNCTIONS
  // ============================================

  // Use the module-level CURRENCY_SYMBOLS constant for display (e.g., "3.96M zl" or "$1.2M")

  /**
   * Converts a YearsRow's monetary values from PLN to the selected currency.
   *
   * PLN is the base currency — values are stored as-is.
   * For other currencies, we divide:
   *   - Flow amounts (contributions, profit) by the average FX rate for that year
   *   - Cumulative/snapshot amounts (contr cumulative, profit cumulative, growth) by the end-of-period rate
   *
   * Returns null if the required FX rate is 0 or missing (row will be skipped).
   */
  const convertYearsRow = (row: YearsRow, currency: string): {
    contributions: number; profit: number;
    contrCumulative: number; profitCumulative: number; endAmount: number;
  } | null => {
    // PLN = base currency, no conversion needed
    if (currency === 'PLN') {
      return {
        contributions: row.contributions,
        profit: row.profit,
        contrCumulative: row.contrCumulative,
        profitCumulative: row.profitCumulative,
        endAmount: row.endAmount,
      };
    }

    // Look up the right FX rates for this currency
    const rateMap: { [key: string]: { avg: number; end: number } } = {
      USD: { avg: row.avgUsdPln, end: row.endUsdPln },
      EUR: { avg: row.avgEurPln, end: row.endEurPln },
      CHF: { avg: row.avgChfPln, end: row.endChfPln },
      SGD: { avg: row.avgSgdPln, end: row.endSgdPln },
    };

    const rates = rateMap[currency];
    if (!rates || !rates.avg || !rates.end) return null; // Skip row if FX rate is missing/zero

    return {
      contributions: row.contributions / rates.avg,
      profit: row.profit / rates.avg,
      contrCumulative: row.contrCumulative / rates.end,
      profitCumulative: row.profitCumulative / rates.end,
      endAmount: row.endAmount / rates.end,
    };
  };

  /**
   * Chart 1 data: Portfolio Value by Year (stacked bar)
   * Bottom segment = Contributions Cumulative, Top segment = Profit Cumulative
   * Values are shown in millions for readability
   */
  const getPortfolioValueChartData = () => {
    return yearsData
      .map(row => {
        const converted = convertYearsRow(row, portfolioCurrency);
        if (!converted) return null;
        // Extract just the year (e.g., "2016-12-31" → "2016")
        const year = row.date.includes('-') ? row.date.split('-')[0] : row.date;
        return {
          year,
          contrCumulative: converted.contrCumulative / 1_000_000,
          profitCumulative: converted.profitCumulative / 1_000_000,
          total: converted.endAmount / 1_000_000,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
  };

  /**
   * Chart 2 data: Contributions and Profit by Year (stacked bar + growth label)
   * Bottom segment = Contributions, Top segment = Profit
   * Growth = Contributions + Profit (total for that year), shown as a label above the bar
   */
  const getContributionsProfitChartData = () => {
    return yearsData
      .map(row => {
        const converted = convertYearsRow(row, portfolioCurrency);
        if (!converted) return null;
        const year = row.date.includes('-') ? row.date.split('-')[0] : row.date;
        // Split profit into positive (stacked above contributions) and negative (below zero)
        // so negative years like 2022 show the loss bar dropping below the x-axis
        return {
          year,
          contributions: converted.contributions,
          profitPositive: converted.profit >= 0 ? converted.profit : 0,
          profitNegative: converted.profit < 0 ? converted.profit : 0,
          profit: converted.profit, // keep raw value for labels
          growthTotal: converted.contributions + converted.profit,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
  };

  /**
   * Chart 3 data: Returns by Year (grouped bars)
   * Shows Return PLN, Return USD, and Return SGD side by side
   * Not affected by currency dropdown — these are pre-calculated in the spreadsheet
   */
  const getReturnsChartData = () => {
    return yearsData.map(row => ({
      year: row.date.includes('-') ? row.date.split('-')[0] : row.date,
      'Return PLN': row.returnPln,
      'Return USD': row.returnUsd,
      'Return SGD': row.returnSgd,
    }));
  };

  /**
   * Chart 4 data: Growth by Year (grouped bars)
   * Calculates year-over-year % change in portfolio value for PLN, USD, and SGD.
   * Each row is self-contained: uses its own startAmount and start-of-period FX rates
   * so no previous-row lookup is needed. This includes the first year (2016).
   * NOT affected by the currency dropdown — always shows all 3 currencies.
   */
  const getGrowthByYearChartData = () => {
    const result: { year: string; 'Growth PLN': number; 'Growth USD': number; 'Growth SGD': number }[] = [];

    for (const row of yearsData) {
      // Skip if startAmount is 0 (can't compute % change from zero)
      if (!row.startAmount) continue;

      // PLN growth: % change from start to end of year
      const growthPln = ((row.endAmount - row.startAmount) / row.startAmount) * 100;

      // USD growth: convert start and end amounts to USD, then compute % change
      if (!row.startUsdPln || !row.endUsdPln) continue;
      const startUsd = row.startAmount / row.startUsdPln;
      const endUsd = row.endAmount / row.endUsdPln;
      const growthUsd = ((endUsd - startUsd) / startUsd) * 100;

      // SGD growth: convert start and end amounts to SGD, then compute % change
      if (!row.startSgdPln || !row.endSgdPln) continue;
      const startSgd = row.startAmount / row.startSgdPln;
      const endSgd = row.endAmount / row.endSgdPln;
      const growthSgd = ((endSgd - startSgd) / startSgd) * 100;

      const year = row.date.includes('-') ? row.date.split('-')[0] : row.date;
      result.push({
        year,
        'Growth PLN': parseFloat(growthPln.toFixed(1)),
        'Growth USD': parseFloat(growthUsd.toFixed(1)),
        'Growth SGD': parseFloat(growthSgd.toFixed(1)),
      });
    }

    return result;
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
  // BACKTEST X-AXIS CONFIGURATION
  // ----------------------------------------
  // Dynamically adjusts X-axis ticks and label format based on the selected period length:
  //   > 9 years  → one tick per year,  label = "YYYY"
  //   3–9 years  → two ticks per year, label = "YYYY" + "MMM" (two lines)
  //   1–3 years  → four ticks per year, label = "YYYY" + "MMM" (two lines)
  //   ≤ 1 year   → every month,        label = "MmmYY"

  const backtestXAxisConfig = useMemo(() => {
    if (!backtestResults || backtestResults.length === 0) return { ticks: undefined as string[] | undefined, periodYears: 0 };

    // Grab dates from the first portfolio's returns (all portfolios share the same date range)
    const dates = backtestResults[0].returns.map(r => r.date);
    if (dates.length < 2) return { ticks: undefined as string[] | undefined, periodYears: 0 };

    const startDate = new Date(dates[0]);
    const endDate = new Date(dates[dates.length - 1]);
    const periodYears = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

    // Pick which dates to show as tick marks
    const tickDates: string[] = [];

    if (periodYears > 9) {
      // One tick per year — pick the first available date in each calendar year
      const seenYears = new Set<number>();
      for (const d of dates) {
        const year = new Date(d).getUTCFullYear();
        if (!seenYears.has(year)) {
          seenYears.add(year);
          tickDates.push(d);
        }
      }
    } else if (periodYears > 3) {
      // Two ticks per year — first available date in each half-year (Jan–Jun, Jul–Dec)
      const seen = new Set<string>();
      for (const d of dates) {
        const dt = new Date(d);
        const half = dt.getUTCMonth() < 6 ? 'H1' : 'H2';
        const key = `${dt.getUTCFullYear()}-${half}`;
        if (!seen.has(key)) {
          seen.add(key);
          tickDates.push(d);
        }
      }
    } else if (periodYears > 1) {
      // Four ticks per year — first available date in each quarter
      const seen = new Set<string>();
      for (const d of dates) {
        const dt = new Date(d);
        const quarter = Math.floor(dt.getUTCMonth() / 3);
        const key = `${dt.getUTCFullYear()}-Q${quarter}`;
        if (!seen.has(key)) {
          seen.add(key);
          tickDates.push(d);
        }
      }
    } else {
      // Every month
      const seen = new Set<string>();
      for (const d of dates) {
        const dt = new Date(d);
        const key = `${dt.getUTCFullYear()}-${dt.getUTCMonth()}`;
        if (!seen.has(key)) {
          seen.add(key);
          tickDates.push(d);
        }
      }
    }

    return { ticks: tickDates, periodYears };
  }, [backtestResults]);

  // Custom tick renderer for the three backtest line charts.
  // Format changes based on the period length computed above.
  const BacktestDateTick = useMemo(() => {
    const py = backtestXAxisConfig.periodYears;
    return ({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => {
      const d = new Date(payload.value);
      if (isNaN(d.getTime())) {
        return <text x={x} y={y} textAnchor="middle" fontSize={9} fill="#6B7280">{payload.value}</text>;
      }
      if (py > 9) {
        // Long period — just the four-digit year
        return (
          <text x={x} y={y} textAnchor="middle" fontSize={9} fill="#6B7280">
            <tspan x={x} dy="0.8em">{d.getUTCFullYear()}</tspan>
          </text>
        );
      }
      if (py <= 1) {
        // Short period — compact "Jan26" format
        const yy = String(d.getUTCFullYear()).slice(-2);
        return (
          <text x={x} y={y} textAnchor="middle" fontSize={9} fill="#6B7280">
            <tspan x={x} dy="0.8em">{MONTH_ABBR[d.getUTCMonth()]}{yy}</tspan>
          </text>
        );
      }
      // Medium period (1–9 years) — year on top, month abbreviation below
      return (
        <text x={x} y={y} textAnchor="middle" fontSize={9} fill="#6B7280">
          <tspan x={x} dy="0.5em">{d.getUTCFullYear()}</tspan>
          <tspan x={x} dy="1.2em">{MONTH_ABBR[d.getUTCMonth()]}</tspan>
        </text>
      );
    };
  }, [backtestXAxisConfig.periodYears]);

  // ----------------------------------------
  // ASSET FILTER CONTROLS COMPONENT
  // ----------------------------------------
  // This is a reusable component that renders three compact collapsible filter dropdowns
  // (Assets, Asset Class, Currency) used in Annual Returns, Best To Worst, and Monthly Prices tabs

  const AssetFilterControls = ({ children }: { children?: React.ReactNode }) => {
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
    const assetSubcategories = getUniqueAssetSubcategories();

    // Check if all items are selected (to show "Deselect All" vs "Select All")
    const allAssetsSelected = selectedAssetTickers.length === assetLookup.length;
    const allClassesSelected = selectedAssetClasses.length === assetClasses.length;
    const allCurrenciesSelected = selectedCurrencies.length === currencies.length;
    const allSubcategoriesSelected = selectedAssetSubcategories.length === assetSubcategories.length;

    // Helper to get display text for the dropdown button
    const getSelectionText = (selected: number, total: number, label: string) => {
      if (selected === total) return 'All';
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
        {/* Asset Subcategory Dropdown */}
        {assetSubcategories.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setOpenFilterDropdown(openFilterDropdown === 'assetSubcategory' ? null : 'assetSubcategory')}
              className={`px-3 py-1.5 text-sm border rounded-lg flex items-center gap-2 ${
                openFilterDropdown === 'assetSubcategory' ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:bg-gray-50'
              }`}
            >
              <span className="font-medium">Subcategory:</span>
              <span className="text-gray-600">{getSelectionText(selectedAssetSubcategories.length, assetSubcategories.length, 'subcategories')}</span>
              <svg className={`w-4 h-4 transition-transform ${openFilterDropdown === 'assetSubcategory' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {openFilterDropdown === 'assetSubcategory' && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-300 rounded-lg shadow-lg min-w-[220px]">
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                  <span className="text-sm font-medium text-gray-700">Select Subcategories</span>
                  <button
                    onClick={() => toggleAllAssetSubcategories(!allSubcategoriesSelected)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {allSubcategoriesSelected ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto p-2">
                  {assetSubcategories.map(subcategory => (
                    <label key={subcategory} className="flex items-center gap-2 py-1 px-2 text-sm cursor-pointer hover:bg-gray-100 rounded">
                      <input
                        type="checkbox"
                        checked={selectedAssetSubcategories.includes(subcategory)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedAssetSubcategories([...selectedAssetSubcategories, subcategory]);
                          } else {
                            setSelectedAssetSubcategories(selectedAssetSubcategories.filter(s => s !== subcategory));
                          }
                        }}
                      />
                      <span>{subcategory}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Extra controls passed in as children (e.g., Years filter) — rendered after Subcategory */}
        {children}
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

          {/* Data Status Section - compact single row */}
          <div className="mb-4 px-4 py-2 bg-gray-300 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-700">Data</h2>
              <span className={`text-sm ${
                loadingMessage.includes('Loaded') ? 'text-green-600' :
                loadingMessage.includes('Error') ? 'text-red-600' :
                'text-gray-600'
              }`}>
                {loadingMessage || 'Ready'}
              </span>
            </div>
            <button
              onClick={loadDataFromSheet}
              disabled={isLoading}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold flex items-center gap-2 disabled:opacity-50 text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              {isLoading ? 'Loading...' : 'Refresh Data'}
            </button>
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
                Backtest
              </button>
              <button
                onClick={() => setActiveView('monthlyPrices')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  activeView === 'monthlyPrices'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setActiveView('annualReturns')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  activeView === 'annualReturns'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Annual
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
                onClick={() => setActiveView('graphs')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  activeView === 'graphs'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Graphs
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
              <button
                onClick={() => setActiveView('correlationMatrix')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  activeView === 'correlationMatrix'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Correlations
              </button>
              <button
                onClick={() => setActiveView('portfolio')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  activeView === 'portfolio'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Portfolio
              </button>
              <button
                onClick={() => setActiveView('positions')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  activeView === 'positions'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Positions
              </button>
            </div>
          )}

          {/* Show the rest of the UI only when data is loaded */}
          {isConnected && assetData && activeView === 'backtest' && (
            <>
              {/* Parameters Section */}
              <div className="mb-6 p-3 bg-gray-50 rounded-lg">
                <div className="flex justify-between items-center mb-2">
                  <h2 className="text-sm font-semibold text-gray-700">Parameters</h2>
                  {/* Quick date range presets */}
                  <div className="flex gap-1">
                    {(['YTD', '1Y', '2Y', '3Y', '4Y', '5Y', '6Y', '7Y', '8Y', '9Y', '10Y', 'Max'] as const).map(preset => (
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
                <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                  {/* Start Date — filtered to only dates >= limiting asset's first available date */}
                  {(() => {
                    const limiting = getLimitingAsset();
                    const minDate = limiting?.date || '';
                    return (
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Start Date</label>
                        <select
                          value={selectedDateRange.start}
                          onChange={(e) => setSelectedStartDate(e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        >
                          {assetData.filter(row => !minDate || row.date >= minDate).map(row => (
                            <option key={row.date} value={row.date}>{row.date}</option>
                          ))}
                        </select>
                        {limiting && (
                          <p className="text-[10px] text-amber-600 mt-0.5" title={`${limiting.assetName} has data from ${limiting.date}`}>
                            Limited by {limiting.assetName}
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {/* End Date */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">End Date</label>
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
                    <label className="block text-xs font-medium text-gray-700 mb-1">Capital ($)</label>
                    <input
                      type="number"
                      value={startingCapital}
                      onChange={(e) => setStartingCapital(parseFloat(e.target.value))}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </div>

                  {/* Rebalance Frequency */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Rebalance</label>
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
                    <label className="block text-xs font-medium text-gray-700 mb-1">Withdrawal (%)</label>
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
                    <label className="block text-xs font-medium text-gray-700 mb-1">Inflation (%)</label>
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

                        {/* Weight Validation + Currency + Inflation Adjustment */}
                        <div className="mt-2 flex items-center justify-between">
                          <div className={`text-xs font-medium ${isValid ? 'text-green-600' : 'text-red-600'}`}>
                            Total: {totalWeight.toFixed(0)}% {isValid ? '✓' : '(need 100%)'}
                          </div>
                          <div className="flex items-center gap-2">
                            {/* Base Currency selector — converts all assets to the chosen currency */}
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-gray-500" title="Convert all asset values to this currency">Ccy:</span>
                              <select
                                value={portfolio.baseCurrency}
                                onChange={(e) => {
                                  const newCcy = e.target.value;
                                  setPortfolios(portfolios.map(p => {
                                    if (p.id === portfolio.id) {
                                      const newName = p.nameManuallyEdited ? p.name : generatePortfolioName(p.assets, p.inflationAdj, newCcy);
                                      return { ...p, baseCurrency: newCcy, name: newName };
                                    }
                                    return p;
                                  }));
                                }}
                                className="px-1 py-0.5 text-xs border border-gray-300 rounded"
                                title="Base currency: converts all asset values to this currency"
                              >
                                {CURRENCY_OPTIONS.map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                            {/* CPI Inflation Adjustment selector */}
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-gray-500" title="Adjust portfolio values for inflation using CPI data">Infl:</span>
                              <select
                                value={portfolio.inflationAdj}
                                onChange={(e) => {
                                  const newInflAdj = e.target.value;
                                  setPortfolios(portfolios.map(p => {
                                    if (p.id === portfolio.id) {
                                      const newName = p.nameManuallyEdited ? p.name : generatePortfolioName(p.assets, newInflAdj, p.baseCurrency);
                                      return { ...p, inflationAdj: newInflAdj, name: newName };
                                    }
                                    return p;
                                  }));
                                }}
                                className="px-1 py-0.5 text-xs border border-gray-300 rounded"
                                title="Inflation adjustment: divides portfolio values by CPI to show real purchasing power"
                              >
                                {CPI_OPTIONS.map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                          </div>
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
                  <LineChart margin={{ top: 5, right: 5, left: -15, bottom: 15 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" type="category" allowDuplicatedCategory={false} ticks={backtestXAxisConfig.ticks} tick={BacktestDateTick} />
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
                  <LineChart margin={{ top: 5, right: 5, left: -15, bottom: 15 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" type="category" allowDuplicatedCategory={false} ticks={backtestXAxisConfig.ticks} tick={BacktestDateTick} />
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
                  <LineChart margin={{ top: 5, right: 5, left: -15, bottom: 15 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" type="category" allowDuplicatedCategory={false} ticks={backtestXAxisConfig.ticks} tick={BacktestDateTick} />
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
                      <th className="text-right py-2 px-2">Longest DD</th>
                      <th className="text-right py-2 px-2">Curr DD</th>
                      <th className="text-right py-2 px-2">End Val</th>
                      <th className="text-right py-2 px-2">End Post W</th>
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
                        <td className="text-right py-2 px-2 text-purple-700">{result.stats.longestDrawdown}</td>
                        <td className="text-right py-2 px-2 text-orange-600">{result.stats.currentDrawdown}%</td>
                        <td className="text-right py-2 px-2 font-semibold">{CURRENCY_SYMBOLS[result.portfolio.baseCurrency] || '$'}{parseFloat(result.stats.endingValue).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                        <td className="text-right py-2 px-2 font-semibold">
                          {(() => {
                            // Calculate ending value after inflation-adjusted withdrawals
                            const wData = calculateWithdrawalReturns(result.returns, parseFloat(withdrawalRate), parseFloat(inflationRate));
                            const endVal = wData.length > 0 ? wData[wData.length - 1].value : 0;
                            return `${CURRENCY_SYMBOLS[result.portfolio.baseCurrency] || '$'}${endVal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
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
                  // Currency symbol for the selected portfolio ($ by default when no currency set)
                  const wSym = CURRENCY_SYMBOLS[selectedResult.portfolio.baseCurrency] || '$';

                  if (details.length === 0) {
                    return <div className="text-center py-4 text-gray-500">Not enough data for withdrawal detail.</div>;
                  }

                  return (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b-2 border-gray-200">
                          <th className="text-right py-2 px-2">Year</th>
                          <th className="text-right py-2 px-2">Start ({wSym})</th>
                          <th className="text-right py-2 px-2">Return (%)</th>
                          <th className="text-right py-2 px-2">Pre-W ({wSym})</th>
                          <th className="text-right py-2 px-2">Eff. W Rate (%)</th>
                          <th className="text-right py-2 px-2">Withdrawal ({wSym})</th>
                          <th className="text-right py-2 px-2">End ({wSym})</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.map((row) => (
                          <tr key={row.year} className="border-b border-gray-100">
                            <td className="text-right py-2 px-2">{row.year}</td>
                            <td className="text-right py-2 px-2">{wSym}{row.startingValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                            <td className={`text-right py-2 px-2 ${row.returnPct >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                              {row.returnPct.toFixed(2)}%
                            </td>
                            <td className="text-right py-2 px-2">{wSym}{row.preWithdrawalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                            <td className="text-right py-2 px-2">{row.effectiveRate.toFixed(2)}%</td>
                            <td className="text-right py-2 px-2 text-red-600">{wSym}{row.withdrawalAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                            <td className="text-right py-2 px-2 font-semibold">{wSym}{row.endValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                          <td className="text-right py-2 px-2" colSpan={5}>Total Withdrawn</td>
                          <td className="text-right py-2 px-2 text-red-600">
                            {wSym}{details.reduce((sum, row) => sum + row.withdrawalAmount, 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </td>
                          <td className="text-right py-2 px-2"></td>
                        </tr>
                      </tfoot>
                    </table>
                  );
                })()}
              </div>

              {/* Rebalancing Table */}
              {/* Month-by-month breakdown showing asset prices, drifted weights, portfolio value, and rebalance events */}
              <div className="bg-white p-4 rounded-lg shadow mt-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-md font-semibold text-gray-700">Rebalancing Detail</h3>
                  {/* Dropdown to pick which portfolio's rebalancing detail to show */}
                  <select
                    className="border rounded px-2 py-1 text-sm"
                    value={selectedRebalancingPortfolio}
                    onChange={(e) => setSelectedRebalancingPortfolio(parseInt(e.target.value))}
                  >
                    {backtestResults.map((result, idx) => (
                      <option key={idx} value={idx}>{result.portfolio.name}</option>
                    ))}
                  </select>
                </div>
                {(() => {
                  // Get the selected portfolio's rebalancing rows
                  const selectedResult = backtestResults[selectedRebalancingPortfolio] || backtestResults[0];
                  const rebalancingRows = getRebalancingDetails(selectedResult);
                  const assets = selectedResult.portfolio.assets;
                  // Currency symbol for this portfolio's rebalancing detail
                  const rSym = CURRENCY_SYMBOLS[selectedResult.portfolio.baseCurrency] || '$';

                  if (rebalancingRows.length === 0) {
                    return <div className="text-center py-4 text-gray-500">Not enough data for rebalancing detail.</div>;
                  }

                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b-2 border-gray-200">
                            {/* Sticky Date column */}
                            <th className="text-left py-2 px-2 sticky left-0 bg-white z-10">Date</th>
                            {/* Three columns per asset: Price, Position (shares), and Weight */}
                            {assets.map(({ asset }) => (
                              <React.Fragment key={asset}>
                                <th className="text-right py-2 px-2">{asset} Price</th>
                                <th className="text-right py-2 px-2">{asset} Pos</th>
                                <th className="text-right py-2 px-2">{asset} Wt%</th>
                              </React.Fragment>
                            ))}
                            <th className="text-right py-2 px-2">Value ({rSym})</th>
                            <th className="text-right py-2 px-2">MoM %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rebalancingRows.map((row) => (
                            <tr
                              key={row.date}
                              className={`border-b border-gray-100 ${row.isRebalanced ? 'bg-blue-50' : ''}`}
                              style={row.isRebalanced ? { fontWeight: 700 } : undefined}
                            >
                              {/* Sticky Date column */}
                              <td className="text-left py-1 px-2 sticky left-0 bg-inherit z-10 whitespace-nowrap">
                                {row.date}
                              </td>
                              {/* Per-asset Price and Weight columns */}
                              {assets.map(({ asset }) => (
                                <React.Fragment key={asset}>
                                  <td className="text-right py-1 px-2">
                                    {row.assetPrices[asset] != null ? row.assetPrices[asset].toFixed(2) : '—'}
                                  </td>
                                  <td className="text-right py-1 px-2">
                                    {row.assetShares[asset] != null ? row.assetShares[asset].toFixed(2) : '—'}
                                  </td>
                                  <td className="text-right py-1 px-2">
                                    {row.assetWeights[asset] != null ? row.assetWeights[asset].toFixed(1) + '%' : '—'}
                                  </td>
                                </React.Fragment>
                              ))}
                              <td className="text-right py-1 px-2 font-semibold">
                                {rSym}{row.portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              </td>
                              <td className={`text-right py-1 px-2 ${row.momPct === null ? '' : row.momPct >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                                {row.momPct !== null ? row.momPct.toFixed(2) + '%' : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Assets Annual Returns Section - Shown when in annualReturns view */}
          {/* This table shows yearly returns for ALL assets in the lookup table */}
          {isConnected && assetData && activeView === 'annualReturns' && (
            <div className="mt-2">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">
                {annualViewMode === 'returns' ? 'Annual Returns' : 'Annual Prices'}
              </h2>

              {(() => {
                // Use memoized annual returns — avoids recalculating when toggling view mode
                const annualReturns = memoizedAnnualReturns;
                const years = getYearsWithData(annualReturns);

                // Years dropdown state
                const allYearsSelected = selectedYears === null || selectedYears.length === years.length;
                const yearsLabel = allYearsSelected
                  ? 'All years'
                  : `${selectedYears!.length} of ${years.length}`;

                return (
                  <>
                  {/* Filter controls for Assets, Asset Class, Currency, and Years */}
                  <AssetFilterControls>
                    {/* Toggle buttons to switch between returns view and prices view */}
                    <div className="flex gap-0">
                      <button
                        onClick={() => setAnnualViewMode('returns')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-l-lg border transition-colors ${
                          annualViewMode === 'returns'
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white border-gray-300 hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        Returns
                      </button>
                      <button
                        onClick={() => setAnnualViewMode('prices')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-r-lg border border-l-0 transition-colors ${
                          annualViewMode === 'prices'
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white border-gray-300 hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        Prices
                      </button>
                    </div>
                    {/* Years filter dropdown - only shown on this tab */}
                    <div className="relative" ref={yearsDropdownRef}>
                      <button
                        onClick={() => setYearsDropdownOpen(!yearsDropdownOpen)}
                        className={`px-3 py-1.5 text-sm border rounded-lg flex items-center gap-2 ${
                          yearsDropdownOpen ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <span className="font-medium">Years:</span>
                        <span className="text-gray-600">{yearsLabel}</span>
                        <svg className={`w-4 h-4 transition-transform ${yearsDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {yearsDropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-300 rounded-lg shadow-lg min-w-[160px]">
                          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                            <span className="text-sm font-medium text-gray-700">Select Years</span>
                            <button
                              onClick={() => {
                                if (allYearsSelected) {
                                  setSelectedYears([]);  // Explicit empty = none selected
                                } else {
                                  setSelectedYears(null);  // null = all selected (default)
                                }
                              }}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              {allYearsSelected ? 'Deselect All' : 'Select All'}
                            </button>
                          </div>
                          <div className="max-h-60 overflow-y-auto p-2">
                            {years.map(year => {
                              const isChecked = selectedYears === null || selectedYears.includes(year);
                              return (
                                <label key={year} className="flex items-center gap-2 py-1 px-2 text-sm cursor-pointer hover:bg-gray-100 rounded">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      if (selectedYears === null) {
                                        // First interaction: switching from "all" to explicit list
                                        // User unchecked one year, so select all except this one
                                        if (!e.target.checked) {
                                          setSelectedYears(years.filter(y => y !== year));
                                        }
                                      } else {
                                        if (e.target.checked) {
                                          const newSelection = [...selectedYears, year];
                                          // If all years now selected, reset to null (= all)
                                          if (newSelection.length === years.length) {
                                            setSelectedYears(null);
                                          } else {
                                            setSelectedYears(newSelection);
                                          }
                                        } else {
                                          setSelectedYears(selectedYears.filter(y => y !== year));
                                        }
                                      }
                                    }}
                                  />
                                  <span>{year}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </AssetFilterControls>

                {(() => {
                // Filter years based on user selection (null = show all)
                const displayYears = selectedYears === null
                  ? years
                  : years.filter(y => selectedYears.includes(y));

                // Helper to get filtered price range for Period/CAGR when years are filtered
                const getFilteredPriceRange = (ticker: string) => {
                  // If no filter active, use the full price range
                  if (selectedYears === null) return getAssetPriceRange(ticker);

                  const tickerYears = annualReturns[ticker];
                  if (!tickerYears) return null;

                  // Find the min and max selected years that this asset has data for
                  const assetDisplayYears = displayYears.filter(y => tickerYears[y]);
                  if (assetDisplayYears.length === 0) return null;

                  const minYear = Math.min(...assetDisplayYears);
                  const maxYear = Math.max(...assetDisplayYears);

                  // Start price = beginning of the min selected year (stored as startPrice/startDate)
                  const startData = tickerYears[minYear];
                  const endData = tickerYears[maxYear];
                  if (!startData || !endData) return null;

                  // Calculate months between start and end dates
                  const firstDate = new Date(startData.startDate);
                  const lastDate = new Date(endData.endDate);
                  const months = (lastDate.getFullYear() - firstDate.getFullYear()) * 12
                               + (lastDate.getMonth() - firstDate.getMonth());

                  return {
                    firstDate: startData.startDate,
                    firstPrice: startData.startPrice,
                    lastDate: endData.endDate,
                    lastPrice: endData.endPrice,
                    months
                  };
                };

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

                  // Year columns (numeric) — sort by return or end-of-year price depending on view mode
                  if (typeof column === 'number') {
                    const data = annualReturns[ticker]?.[column];
                    if (!data) return -Infinity;
                    return annualViewMode === 'prices' ? data.endPrice : data.return;
                  }

                  // Period column - uses filtered price range when years filter is active
                  if (column === 'Period') {
                    const priceRange = getFilteredPriceRange(ticker);
                    return priceRange ? priceRange.months : -Infinity;
                  }

                  // CAGR column - uses filtered price range when years filter is active
                  if (column === 'CAGR') {
                    const priceRange = getFilteredPriceRange(ticker);
                    if (!priceRange) return -Infinity;
                    return calculateCAGR(priceRange.firstPrice, priceRange.lastPrice, priceRange.months);
                  }


                  // Vol column - annualized volatility
                  if (column === 'Vol') {
                    const priceRange = getFilteredPriceRange(ticker);
                    if (!priceRange) return -Infinity;
                    const stats = calculateAssetStats(ticker, priceRange.firstDate, priceRange.lastDate);
                    return stats ? stats.volatility : -Infinity;
                  }

                  // Sharpe column - risk-adjusted return (higher = better)
                  if (column === 'Sharpe') {
                    const priceRange = getFilteredPriceRange(ticker);
                    if (!priceRange) return -Infinity;
                    const cagr = calculateCAGR(priceRange.firstPrice, priceRange.lastPrice, priceRange.months);
                    const stats = calculateAssetStats(ticker, priceRange.firstDate, priceRange.lastDate);
                    if (!stats || stats.volatility <= 0) return -Infinity;
                    return cagr / stats.volatility;
                  }

                  // MaxDD column - maximum drawdown (less negative = better)
                  if (column === 'MaxDD') {
                    const priceRange = getFilteredPriceRange(ticker);
                    if (!priceRange) return -Infinity;
                    const stats = calculateAssetStats(ticker, priceRange.firstDate, priceRange.lastDate);
                    return stats ? stats.maxDrawdown : -Infinity;
                  }

                  // DDDur column - longest drawdown duration (shorter = better)
                  if (column === 'DDDur') {
                    const priceRange = getFilteredPriceRange(ticker);
                    if (!priceRange) return -Infinity;
                    const stats = calculateAssetStats(ticker, priceRange.firstDate, priceRange.lastDate);
                    return stats ? -stats.longestDDMonths : -Infinity;
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
                  return `${baseClass} cursor-pointer select-none ${isSelected ? 'font-bold' : ''}`;
                };

                return (
                  <div className="bg-white p-4 rounded-lg shadow">
                    <div className="overflow-auto max-h-[95vh]">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b-2 border-gray-200">
                          {/* Asset Name column - sticky both top and left (corner cell, highest z-index) */}
                          <th className="text-left py-2 px-2 sticky top-0 left-0 z-30 min-w-[150px]" style={{ backgroundColor: '#e5e7eb' }}>
                            Asset
                          </th>
                          {/* Year columns - oldest to newest, clickable for sorting (filtered by selected years) */}
                          {displayYears.map(year => (
                            <th
                              key={year}
                              className={getSortableHeaderClass(year, 'text-right py-2 px-2 sticky top-0 z-20 min-w-[60px]')}
                              style={{ backgroundColor: annualReturnsSortColumn === year ? '#bfdbfe' : '#e5e7eb' }}
                              onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === year ? null : year)}
                            >
                              {year}
                            </th>
                          ))}
                          {/* Period column - shows data history length */}
                          <th
                            className={getSortableHeaderClass('Period', 'text-right py-2 px-2 sticky top-0 z-20 min-w-[60px]')}
                            style={{ backgroundColor: annualReturnsSortColumn === 'Period' ? '#bfdbfe' : '#e5e7eb' }}
                            onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === 'Period' ? null : 'Period')}
                          >
                            Period
                          </th>
                          {/* CAGR column - compound annual growth rate */}
                          <th
                            className={getSortableHeaderClass('CAGR', 'text-right py-2 px-2 sticky top-0 z-20 min-w-[60px]')}
                            style={{ backgroundColor: annualReturnsSortColumn === 'CAGR' ? '#bfdbfe' : '#e5e7eb' }}
                            onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === 'CAGR' ? null : 'CAGR')}
                          >
                            CAGR
                          </th>
                          {/* Volatility column - annualized std dev of monthly returns */}
                          <th
                            className={getSortableHeaderClass('Vol', 'text-right py-2 px-2 sticky top-0 z-20 min-w-[50px]')}
                            style={{ backgroundColor: annualReturnsSortColumn === 'Vol' ? '#bfdbfe' : '#e5e7eb' }}
                            onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === 'Vol' ? null : 'Vol')}
                          >
                            Vol
                          </th>
                          {/* Sharpe Ratio column - risk-adjusted return */}
                          <th
                            className={getSortableHeaderClass('Sharpe', 'text-right py-2 px-2 sticky top-0 z-20 min-w-[55px]')}
                            style={{ backgroundColor: annualReturnsSortColumn === 'Sharpe' ? '#bfdbfe' : '#e5e7eb' }}
                            onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === 'Sharpe' ? null : 'Sharpe')}
                          >
                            Sharpe
                          </th>
                          {/* Max Drawdown column - worst peak-to-trough decline */}
                          <th
                            className={getSortableHeaderClass('MaxDD', 'text-right py-2 px-2 sticky top-0 z-20 min-w-[55px]')}
                            style={{ backgroundColor: annualReturnsSortColumn === 'MaxDD' ? '#bfdbfe' : '#e5e7eb' }}
                            onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === 'MaxDD' ? null : 'MaxDD')}
                          >
                            Max DD
                          </th>
                          {/* DD Duration column - longest drawdown duration */}
                          <th
                            className={getSortableHeaderClass('DDDur', 'text-right py-2 px-2 sticky top-0 z-20 min-w-[55px]')}
                            style={{ backgroundColor: annualReturnsSortColumn === 'DDDur' ? '#bfdbfe' : '#e5e7eb' }}
                            onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === 'DDDur' ? null : 'DDDur')}
                          >
                            DD Dur
                          </th>
                          {/* Current Drawdown column - distance from ATH */}
                          <th
                            className={getSortableHeaderClass('CurrDD', 'text-right py-2 px-2 sticky top-0 z-20 min-w-[55px]')}
                            style={{ backgroundColor: annualReturnsSortColumn === 'CurrDD' ? '#bfdbfe' : '#e5e7eb' }}
                            onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === 'CurrDD' ? null : 'CurrDD')}
                          >
                            Curr DD
                          </th>
                          {/* Ticker column - placed after Curr DD */}
                          <th className="text-left py-2 px-2 sticky top-0 z-20" style={{ backgroundColor: '#e5e7eb' }}>Ticker</th>
                          {/* Empty separator column */}
                          <th className="py-2 px-1 w-2 sticky top-0 z-20" style={{ backgroundColor: '#e5e7eb' }}></th>
                          {/* Period return columns (1Y-5Y) */}
                          {['1Y', '2Y', '3Y', '4Y', '5Y'].map(period => (
                            <th
                              key={period}
                              className={getSortableHeaderClass(period, 'text-right py-2 px-2 sticky top-0 z-20 min-w-[50px]')}
                              style={{ backgroundColor: annualReturnsSortColumn === period ? '#bfdbfe' : '#e5e7eb' }}
                              onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === period ? null : period)}
                            >
                              {period}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {/* One row per asset in the lookup table, sorted by selected column */}
                        {sortedAssetLookup.map((asset, idx) => {
                          // For prices view: calculate min/max end-of-year prices for this asset's heatmap
                          const validEndPrices = annualViewMode === 'prices'
                            ? displayYears.map(y => annualReturns[asset.ticker]?.[y]?.endPrice).filter((p): p is number => p != null)
                            : [];
                          const minPrice = validEndPrices.length > 0 ? Math.min(...validEndPrices) : 0;
                          const maxPrice = validEndPrices.length > 0 ? Math.max(...validEndPrices) : 0;

                          // Helper to format dates for tooltips (defined once per row, not per cell)
                          const fmtDate = (dateStr: string): string => {
                            const date = new Date(dateStr);
                            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                          };

                          return (
                          <tr key={asset.ticker} className={`border-b border-gray-100 ${idx % 2 === 0 ? '' : 'bg-gray-25'}`}>
                            {/* Asset name - sticky left column with solid background so data doesn't bleed through */}
                            <td className="py-2 px-2 font-medium sticky left-0 z-10" style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                              {asset.name}
                            </td>
                            {/* Annual data for each year — returns (%) or end-of-year prices depending on view mode */}
                            {displayYears.map(year => {
                              const data = annualReturns[asset.ticker]?.[year];

                              // No data for this year = empty cell
                              if (!data) {
                                return (
                                  <td key={year} className="text-right py-2 px-2 text-gray-300">
                                    -
                                  </td>
                                );
                              }

                              if (annualViewMode === 'prices') {
                                // Prices view: show end-of-year price with heatmap coloring (red→yellow→green)
                                return (
                                  <td
                                    key={year}
                                    className="text-right py-2 px-2 font-mono cursor-help"
                                    style={{
                                      backgroundColor: getHeatmapColor(data.endPrice, minPrice, maxPrice),
                                      color: '#374151'
                                    }}
                                    title={`${year}: $${data.endPrice.toFixed(2)} (${fmtDate(data.endDate)})`}
                                  >
                                    {formatPrice(data.endPrice)}
                                  </td>
                                );
                              }

                              // Returns view: color based on positive/negative return
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
                            {/* Period, CAGR, Vol, Sharpe, MaxDD, DD Dur columns - uses filtered price range when years filter is active */}
                            {(() => {
                              const priceRange = getFilteredPriceRange(asset.ticker);
                              if (!priceRange) {
                                return (
                                  <>
                                    <td className="text-right py-2 px-2 text-gray-300">-</td>
                                    <td className="text-right py-2 px-2 text-gray-300">-</td>
                                    <td className="text-right py-2 px-2 text-gray-300">-</td>
                                    <td className="text-right py-2 px-2 text-gray-300">-</td>
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

                              // Calculate volatility and max drawdown (same methodology as Backtest Statistics)
                              const stats = calculateAssetStats(asset.ticker, priceRange.firstDate, priceRange.lastDate);
                              const volatility = stats ? stats.volatility : null;
                              const sharpeRatio = (volatility !== null && volatility > 0) ? cagr / volatility : null;
                              const maxDrawdown = stats ? stats.maxDrawdown : null;

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
                                  {/* Volatility cell */}
                                  <td className="text-right py-2 px-2 bg-gray-50 text-gray-600">
                                    {volatility !== null ? `${volatility.toFixed(1)}%` : '-'}
                                  </td>
                                  {/* Sharpe Ratio cell */}
                                  <td className={`text-right py-2 px-2 ${sharpeRatio !== null && sharpeRatio >= 0.5 ? 'bg-green-50 text-green-700' : 'text-gray-600'}`}>
                                    {sharpeRatio !== null ? sharpeRatio.toFixed(2) : '-'}
                                  </td>
                                  {/* Max Drawdown cell */}
                                  <td className={`text-right py-2 px-2 ${maxDrawdown !== null ? 'bg-red-50 text-red-700' : 'text-gray-300'}`}>
                                    {maxDrawdown !== null ? `${maxDrawdown.toFixed(1)}%` : '-'}
                                  </td>
                                  {/* DD Duration cell */}
                                  <td className={`text-right py-2 px-2 ${stats && stats.longestDDMonths > 0 ? 'text-purple-700' : 'text-gray-300'}`}>
                                    {stats ? formatPeriod(stats.longestDDMonths) : '-'}
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
                            {/* Ticker symbol - placed after Curr DD */}
                            <td className="py-2 px-2 text-gray-600">{asset.ticker}</td>
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
                          );
                        })}
                      </tbody>
                    </table>
                    </div>

                    {/* Show message if no assets match filters */}
                    {sortedAssetLookup.length === 0 && (
                      <div className="text-center py-4 text-gray-500">
                        No assets match the current filters. Try adjusting your selection.
                      </div>
                    )}

                    {/* Legend/explanation — adapts to current view mode */}
                    <div className="mt-4 text-xs text-gray-500">
                      <p>Hover over any cell to see calculation details (start price, end price, dates).</p>
                      {annualViewMode === 'returns' ? (
                        <p className="mt-1">
                          <span className="inline-block w-3 h-3 bg-green-50 border border-green-200 mr-1"></span>
                          Positive return
                          <span className="inline-block w-3 h-3 bg-red-50 border border-red-200 ml-3 mr-1"></span>
                          Negative return
                        </p>
                      ) : (
                        <p className="mt-1">
                          <span className="inline-block w-3 h-3 border border-gray-200 mr-1" style={{ backgroundColor: 'hsl(0, 80%, 85%)' }}></span>
                          Lowest price
                          <span className="inline-block w-3 h-3 border border-gray-200 ml-3 mr-1" style={{ backgroundColor: 'hsl(60, 80%, 85%)' }}></span>
                          Mid
                          <span className="inline-block w-3 h-3 border border-gray-200 ml-3 mr-1" style={{ backgroundColor: 'hsl(120, 80%, 85%)' }}></span>
                          Highest price
                        </p>
                      )}
                    </div>
                  </div>
                );
                })()}
                  </>
                );
              })()}
            </div>
          )}

          {/* Best To Worst Section - Shows assets ranked by return for a selected year */}
          {isConnected && assetData && activeView === 'bestToWorst' && (
            <div className="mt-2">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Best To Worst</h2>

              {(() => {
                // Use memoized annual returns
                const annualReturns = memoizedAnnualReturns;
                const years = getYearsWithData(annualReturns);

                // If no lookup table or no data, show a message
                if (assetLookup.length === 0 || years.length === 0) {
                  return (
                    <>
                      <AssetFilterControls />
                      <div className="bg-yellow-50 p-4 rounded-lg text-yellow-800">
                        No assets in lookup table or no annual return data available.
                      </div>
                    </>
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
                  <>
                  {/* Filter controls + Year/Period selectors on one line */}
                  <AssetFilterControls>
                    {/* Year Dropdown */}
                    <div className="relative">
                      <select
                        value={currentYear}
                        onChange={(e) => {
                          setSelectedRankingYear(parseInt(e.target.value));
                          setBestToWorstMode('year');
                        }}
                        className={`px-3 py-1.5 text-sm border rounded-lg ${isYearMode ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:bg-gray-50'}`}
                      >
                        {years.slice().reverse().map(year => (
                          <option key={year} value={year}>{year}</option>
                        ))}
                      </select>
                    </div>
                    {/* Period Buttons */}
                    <div className="flex gap-1">
                      {([1, 2, 3, 4, 5] as const).map(period => (
                        <button
                          key={period}
                          onClick={() => setBestToWorstMode(period)}
                          className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                            bestToWorstMode === period
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white border-gray-300 hover:bg-gray-100'
                          }`}
                        >
                          {period}Y
                        </button>
                      ))}
                    </div>
                  </AssetFilterControls>

                  <div className="bg-white p-4 rounded-lg shadow">

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
                              <th className="py-1 px-1 bg-gray-200 w-24"></th>
                              <th className="text-right py-1 px-2 bg-gray-200 w-16">{returnColumnHeader}</th>
                              <th className="text-left py-1 px-2 bg-gray-200">Asset</th>
                              <th className="text-left py-1 px-2 bg-gray-200 w-16">Ticker</th>
                              <th className="text-center py-1 px-2 bg-gray-200 w-12">Ccy</th>
                              <th className="text-right py-1 px-2 bg-gray-200 w-20">PLN Return</th>
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
                  </>
                );
              })()}
            </div>
          )}

          {/* Monthly Prices Section - Shows 13 months of raw prices with heatmap and signals */}
          {isConnected && assetData && activeView === 'monthlyPrices' && (
            <div className="mt-2">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">
                {monthlyViewMode === 'prices' ? 'Monthly Prices' : 'Monthly Returns'}
              </h2>

              {/* Filter controls: Assets, Class, Currency + Prices/Returns toggle + End Date */}
              <AssetFilterControls>
                {/* Toggle buttons to switch between price view and return (%) view */}
                <div className="flex gap-0">
                  <button
                    onClick={() => setMonthlyViewMode('prices')}
                    className={`px-3 py-1.5 text-sm font-medium rounded-l-lg border transition-colors ${
                      monthlyViewMode === 'prices'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white border-gray-300 hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    Monthly Prices
                  </button>
                  <button
                    onClick={() => setMonthlyViewMode('returns')}
                    className={`px-3 py-1.5 text-sm font-medium rounded-r-lg border border-l-0 transition-colors ${
                      monthlyViewMode === 'returns'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white border-gray-300 hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    Monthly Returns
                  </button>
                </div>

                {/* End Date selector — pick which month the table ends at */}
                <select
                  value={monthlyEndDate}
                  onChange={(e) => setMonthlyEndDate(e.target.value)}
                  className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white"
                >
                  {(() => {
                    // Build list of unique months from data, most recent first
                    const monthMap = new Map<string, string>();
                    for (const row of assetData!) {
                      const d = new Date(row.date);
                      if (isNaN(d.getTime())) continue;
                      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
                      monthMap.set(ym, row.date); // last date wins (data is chronological)
                    }
                    const endMonths = Array.from(monthMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));
                    return [
                      <option key="" value="">Latest</option>,
                      ...endMonths.map(([ym, date]) => {
                        const d = new Date(date);
                        const label = `${MONTH_ABBR[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(-2)}`;
                        return <option key={ym} value={date}>{label}</option>;
                      })
                    ];
                  })()}
                </select>
              </AssetFilterControls>

              {(() => {
                const { months, assets: unsortedAssets } = getMonthlyPricesData();

                // If the selected ticker was filtered out, deselect it
                if (monthlySelectedTicker && !unsortedAssets.find(a => a.ticker === monthlySelectedTicker)) {
                  setMonthlySelectedTicker('');
                }

                // If no lookup table or no data, show a message
                if (assetLookup.length === 0 || months.length === 0) {
                  return (
                    <div className="bg-yellow-50 p-4 rounded-lg text-yellow-800">
                      No assets in lookup table or no monthly price data available.
                    </div>
                  );
                }

                // Sort assets by selected column (null = keep default lookup-table order)
                const assets = monthlySortColumn === null
                  ? unsortedAssets
                  : [...unsortedAssets].sort((a, b) => {
                      const col = monthlySortColumn;

                      // Text columns: alphabetical A→Z
                      if (col === 'name') return a.name.localeCompare(b.name);
                      if (col === 'ticker') return a.ticker.localeCompare(b.ticker);

                      // Signal column: BUY first, then SELL, then null
                      if (col === 'signal') {
                        const order = { 'BUY': 0, 'SELL': 1 };
                        const aVal = a.signal ? order[a.signal] : 2;
                        const bVal = b.signal ? order[b.signal] : 2;
                        return aVal - bVal;
                      }

                      // Month columns: sort by price or return depending on view mode
                      const monthMatch = col.match(/^month-(\d+)$/);
                      if (monthMatch) {
                        const idx = parseInt(monthMatch[1]);
                        if (monthlyViewMode === 'returns') {
                          const aVal = a.returns[idx] ?? -Infinity;
                          const bVal = b.returns[idx] ?? -Infinity;
                          return bVal - aVal; // Descending (highest first)
                        }
                        const aVal = a.prices[idx] ?? -Infinity;
                        const bVal = b.prices[idx] ?? -Infinity;
                        return bVal - aVal;
                      }

                      // Numeric columns: descending (highest first)
                      let aVal = -Infinity;
                      let bVal = -Infinity;
                      if (col === 'sma10')  { aVal = a.sma10 ?? -Infinity;  bVal = b.sma10 ?? -Infinity; }
                      if (col === 'ret12m') { aVal = a.ret12m ?? -Infinity;  bVal = b.ret12m ?? -Infinity; }
                      if (col === 'dd12m')  { aVal = a.dd12m ?? -Infinity;   bVal = b.dd12m ?? -Infinity; }
                      return bVal - aVal;
                    });

                return (
                  <div className="bg-white p-4 rounded-lg shadow">
                    {/* Scrollable table container */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-gray-200">
                            {/* Asset Name - sticky left column, sortable */}
                            <th
                              className="sticky left-0 z-10 text-left py-1 px-1 min-w-[160px] border-r border-gray-200 cursor-pointer select-none"
                              style={{ backgroundColor: monthlySortColumn === 'name' ? '#bfdbfe' : '#e5e7eb' }}
                              onClick={() => setMonthlySortColumn(monthlySortColumn === 'name' ? null : 'name')}
                            >
                              Asset
                            </th>
                            {/* Month columns - oldest to newest (left to right), sortable */}
                            {months.map((month, idx) => (
                              <th
                                key={idx}
                                className="text-right py-1 px-1 whitespace-nowrap cursor-pointer select-none"
                                style={{ backgroundColor: monthlySortColumn === `month-${idx}` ? '#bfdbfe' : '#e5e7eb' }}
                                onClick={() => setMonthlySortColumn(monthlySortColumn === `month-${idx}` ? null : `month-${idx}`)}
                              >
                                {month}
                              </th>
                            ))}
                            {/* 10m SMA column, sortable */}
                            <th
                              className="text-right py-1 px-1 whitespace-nowrap border-l border-gray-200 cursor-pointer select-none"
                              style={{ backgroundColor: monthlySortColumn === 'sma10' ? '#bfdbfe' : '#e5e7eb' }}
                              onClick={() => setMonthlySortColumn(monthlySortColumn === 'sma10' ? null : 'sma10')}
                            >
                              10mSMA
                            </th>
                            {/* Signal column, sortable */}
                            <th
                              className="text-center py-1 px-1 cursor-pointer select-none"
                              style={{ backgroundColor: monthlySortColumn === 'signal' ? '#bfdbfe' : '#e5e7eb' }}
                              onClick={() => setMonthlySortColumn(monthlySortColumn === 'signal' ? null : 'signal')}
                            >
                              Signal
                            </th>
                            {/* Ticker column, sortable */}
                            <th
                              className="text-left py-1 px-1 border-l border-gray-200 cursor-pointer select-none"
                              style={{ backgroundColor: monthlySortColumn === 'ticker' ? '#bfdbfe' : '#e5e7eb' }}
                              onClick={() => setMonthlySortColumn(monthlySortColumn === 'ticker' ? null : 'ticker')}
                            >
                              Ticker
                            </th>
                            {/* 12-month return column, sortable */}
                            <th
                              className="text-right py-1 px-1 border-l border-gray-200 whitespace-nowrap cursor-pointer select-none"
                              style={{ backgroundColor: monthlySortColumn === 'ret12m' ? '#bfdbfe' : '#e5e7eb' }}
                              onClick={() => setMonthlySortColumn(monthlySortColumn === 'ret12m' ? null : 'ret12m')}
                            >
                              12M Ret
                            </th>
                            {/* 12-month drawdown column, sortable */}
                            <th
                              className="text-right py-1 px-1 border-l border-gray-200 whitespace-nowrap cursor-pointer select-none"
                              style={{ backgroundColor: monthlySortColumn === 'dd12m' ? '#bfdbfe' : '#e5e7eb' }}
                              onClick={() => setMonthlySortColumn(monthlySortColumn === 'dd12m' ? null : 'dd12m')}
                            >
                              12M DD
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
                              <tr
                                key={asset.ticker}
                                onClick={() => setMonthlySelectedTicker(prev => prev === asset.ticker ? '' : asset.ticker)}
                                className={`border-b border-gray-50 cursor-pointer transition-colors ${
                                  monthlySelectedTicker === asset.ticker
                                    ? 'bg-blue-50 hover:bg-blue-100'
                                    : rowIdx % 2 === 0
                                      ? 'hover:bg-gray-50'
                                      : 'bg-gray-25 hover:bg-gray-100'
                                }`}
                              >
                                {/* Asset Name - sticky left column */}
                                <td className={`sticky left-0 z-10 text-left py-0.5 px-1 border-r border-gray-200 font-medium text-gray-700 ${
                                  monthlySelectedTicker === asset.ticker ? 'bg-blue-50' : 'bg-white'
                                }`}>
                                  {asset.name}
                                </td>
                                {/* Price or Return cells depending on view mode */}
                                {monthlyViewMode === 'prices' ? (
                                  /* Prices view: heatmap coloring from red (low) to green (high) */
                                  asset.prices.map((price, colIdx) => (
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
                                  ))
                                ) : (
                                  /* Returns view: green for positive, red for negative */
                                  asset.returns.map((ret, colIdx) => (
                                    <td
                                      key={colIdx}
                                      className={`text-right py-0.5 px-1 font-mono ${
                                        asset.signals[colIdx] === 'SELL' ? 'font-bold' : ''
                                      }`}
                                      style={{
                                        backgroundColor: ret !== null
                                          ? ret >= 0
                                            ? `hsla(120, 70%, 45%, ${Math.min(Math.abs(ret) / 15, 1) * 0.3 + 0.05})`
                                            : `hsla(0, 70%, 45%, ${Math.min(Math.abs(ret) / 15, 1) * 0.3 + 0.05})`
                                          : undefined,
                                        color: ret !== null
                                          ? ret >= 0 ? '#166534' : '#991b1b'
                                          : '#9ca3af'
                                      }}
                                    >
                                      {ret !== null ? `${ret.toFixed(1)}%` : '-'}
                                    </td>
                                  ))
                                )}
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
                                {/* 12-month return: % change over the displayed 13-month window */}
                                <td className={`text-right py-0.5 px-1 font-mono border-l border-gray-200 ${
                                  asset.ret12m === null ? 'text-gray-400'
                                    : asset.ret12m >= 0 ? 'text-green-700'
                                    : 'text-red-600'
                                }`}>
                                  {asset.ret12m !== null ? `${asset.ret12m >= 0 ? '+' : ''}${asset.ret12m.toFixed(1)}%` : '-'}
                                </td>
                                {/* 12-month drawdown: shows how far current price is below the 12M high */}
                                <td className={`text-right py-0.5 px-1 font-mono border-l border-gray-200 ${
                                  asset.dd12m === null ? 'text-gray-400'
                                    : asset.dd12m === 0 ? 'bg-green-50 text-green-700 font-medium'
                                    : asset.dd12m > -5 ? 'text-gray-600'
                                    : asset.dd12m > -15 ? 'text-orange-600'
                                    : 'text-red-600 font-medium'
                                }`}>
                                  {asset.dd12m !== null ? `${asset.dd12m.toFixed(1)}%` : '-'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Legend explaining the color scale and signals */}
                    <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-600">
                      {monthlyViewMode === 'prices' ? (
                        <div className="flex items-center gap-2">
                          <span>Price heatmap (per row):</span>
                          <div className="flex items-center">
                            <div className="w-6 h-4 rounded-l" style={{ backgroundColor: 'hsl(0, 80%, 85%)' }}></div>
                            <div className="w-6 h-4" style={{ backgroundColor: 'hsl(60, 80%, 85%)' }}></div>
                            <div className="w-6 h-4 rounded-r" style={{ backgroundColor: 'hsl(120, 80%, 85%)' }}></div>
                          </div>
                          <span>Low → High</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span>Returns:</span>
                          <span className="px-2 py-0.5 rounded" style={{ backgroundColor: 'hsla(120, 70%, 45%, 0.2)', color: '#166534' }}>+</span>
                          <span>Positive</span>
                          <span className="px-2 py-0.5 rounded" style={{ backgroundColor: 'hsla(0, 70%, 45%, 0.2)', color: '#991b1b' }}>−</span>
                          <span>Negative</span>
                        </div>
                      )}
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
                        <span className="font-bold">Bold {monthlyViewMode === 'prices' ? 'price' : 'return'}</span>
                        <span>= SELL signal that month</span>
                      </div>
                    </div>

                    {/* Show message if no assets match filters */}
                    {assets.length === 0 && (
                      <div className="text-center py-4 text-gray-500">
                        No assets match the current filters. Try adjusting your selection.
                      </div>
                    )}

                    {/* --- Interactive Price & Drawdown charts for the selected asset --- */}
                    {monthlySelectedTicker && (() => {
                      const assetInfo = assetLookup.find(l => l.ticker === monthlySelectedTicker);
                      const assetName = assetInfo ? assetInfo.name : monthlySelectedTicker;
                      const chartResult = getMonthlyChartData(monthlySelectedTicker, monthlyChartPeriod, monthlyEndDate || undefined);

                      if (!chartResult) return (
                        <div className="text-center py-4 text-gray-500 mt-4">
                          No price data available for {monthlySelectedTicker}.
                        </div>
                      );

                      const { priceData, drawdownData, smaDistData, maxPricePoint, minPricePoint, maxDrawdownPoint, maxSmaDistPoint, minSmaDistPoint, totalReturn, cagr } = chartResult;

                      // --- Right-edge bubbles for the price chart ---
                      const lastRow = priceData[priceData.length - 1];
                      const priceBubbleDefs: BubbleDef[] = [];
                      if (lastRow) {
                        priceBubbleDefs.push({ value: lastRow.price, color: '#000000', label: formatPrice(lastRow.price) });
                        if (lastRow.sma10 != null) {
                          priceBubbleDefs.push({ value: lastRow.sma10, color: '#ef4444', label: formatPrice(lastRow.sma10) });
                        }
                      }
                      const MonthlyPriceBubbles = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, priceBubbleDefs);

                      // --- Right-edge bubble for the drawdown chart ---
                      const lastDD = drawdownData[drawdownData.length - 1];
                      const ddBubbleDefs: BubbleDef[] = [];
                      if (lastDD) {
                        ddBubbleDefs.push({ value: lastDD.drawdown, color: '#000000', label: `${lastDD.drawdown.toFixed(1)}%` });
                      }
                      const MonthlyDDBubbles = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, ddBubbleDefs);

                      // --- Right-edge bubble for the SMA distance chart ---
                      const lastSmaDist = smaDistData[smaDistData.length - 1];
                      const smaDistBubbleDefs: BubbleDef[] = [];
                      if (lastSmaDist) {
                        // Green bubble if above SMA (positive distance), red if below
                        const bubbleColor = lastSmaDist.smaDist >= 0 ? '#16a34a' : '#ef4444';
                        smaDistBubbleDefs.push({
                          value: lastSmaDist.smaDist,
                          color: bubbleColor,
                          label: `${lastSmaDist.smaDist >= 0 ? '+' : ''}${lastSmaDist.smaDist.toFixed(1)}%`,
                        });
                      }
                      const MonthlySmaDistBubbles = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, smaDistBubbleDefs);

                      // Gradient offset: where 0% falls in the Y range, so the line/fill
                      // is green above 0 and red below 0 with a single continuous path.
                      // Gradient runs top-to-bottom: 0% offset = Y max, 100% offset = Y min.
                      const smaDistValues = smaDistData.map(d => d.smaDist);
                      const smaDistMax = Math.max(...smaDistValues, 0);   // ensure 0 is within range
                      const smaDistMin = Math.min(...smaDistValues, 0);
                      const smaDistGradientOffset = smaDistMax === smaDistMin
                        ? 0.5
                        : smaDistMax / (smaDistMax - smaDistMin);

                      // --- Compute periodic returns (monthly / quarterly / annual) ---
                      // (uses module-level MONTH_ABBR constant declared at top of file)
                      const computeReturnsData = (): { label: string; return: number }[] => {
                        if (priceData.length < 2) return [];

                        if (returnsChartPeriod === 'monthly') {
                          // Monthly: % change from one month to the next
                          const results: { label: string; return: number }[] = [];
                          for (let i = 1; i < priceData.length; i++) {
                            const ret = ((priceData[i].price - priceData[i - 1].price) / priceData[i - 1].price) * 100;
                            const d = new Date(priceData[i].date);
                            const label = `${MONTH_ABBR[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
                            results.push({ label, return: parseFloat(ret.toFixed(1)) });
                          }
                          return results;
                        }

                        if (returnsChartPeriod === 'quarterly') {
                          // Group by calendar quarter, take last price per quarter
                          const quarterMap = new Map<string, number>();
                          for (const p of priceData) {
                            const d = new Date(p.date);
                            const q = Math.floor(d.getMonth() / 3) + 1;
                            const key = `${d.getFullYear()}-Q${q}`;
                            quarterMap.set(key, p.price);
                          }
                          const quarters = Array.from(quarterMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
                          const results: { label: string; return: number }[] = [];
                          for (let i = 1; i < quarters.length; i++) {
                            const ret = ((quarters[i][1] - quarters[i - 1][1]) / quarters[i - 1][1]) * 100;
                            const [yr, qPart] = quarters[i][0].split('-');
                            const qNum = qPart.replace('Q', '');
                            results.push({ label: `${qNum}Q\n${yr}`, return: parseFloat(ret.toFixed(1)) });
                          }
                          return results;
                        }

                        // Annual: group by year, take last price per year
                        const yearMap = new Map<string, number>();
                        for (const p of priceData) {
                          const d = new Date(p.date);
                          yearMap.set(String(d.getFullYear()), p.price);
                        }
                        const years = Array.from(yearMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
                        const results: { label: string; return: number }[] = [];
                        for (let i = 1; i < years.length; i++) {
                          const ret = ((years[i][1] - years[i - 1][1]) / years[i - 1][1]) * 100;
                          results.push({ label: years[i][0], return: parseFloat(ret.toFixed(1)) });
                        }
                        return results;
                      };
                      const returnsData = computeReturnsData();
                      // Show bar labels unless monthly view with too many bars (≥48 = 4+ years)
                      const showReturnLabels = returnsChartPeriod !== 'monthly' || returnsData.length < 48;

                      // Build ReturnPoint[] from raw asset prices so we can reuse
                      // calculateMonthlyReturns() for the calendar-style returns table
                      const assetReturnPoints: ReturnPoint[] = assetData
                        ?.filter(row => typeof row[monthlySelectedTicker] === 'number')
                        .map(row => ({
                          date: row.date as string,
                          value: row[monthlySelectedTicker] as number,
                          drawdown: 0 // not used by calculateMonthlyReturns
                        })) || [];
                      const assetMonthlyReturns = calculateMonthlyReturns(assetReturnPoints);

                      return (
                        <div className="mt-6 border-t border-gray-200 pt-4">
                          {/* Title + Period buttons */}
                          <div className="flex items-center justify-between mb-3 px-2">
                            <h3 className="text-sm font-semibold text-gray-700">
                              {monthlySelectedTicker} — {assetName}
                              {/* Total return for the visible period, colored green/red */}
                              <span className={`ml-2 ${totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(1)}%
                              </span>
                              {/* CAGR shown when period is >= 1 year */}
                              {cagr !== null && (
                                <span className="ml-1 text-xs font-normal text-gray-500">
                                  (CAGR {cagr >= 0 ? '+' : ''}{cagr.toFixed(1)}%)
                                </span>
                              )}
                            </h3>
                            <div className="flex gap-1">
                              {(['1Y', '2Y', '3Y', '4Y', '5Y', '6Y', 'max'] as const).map(p => (
                                <button
                                  key={p}
                                  onClick={() => setMonthlyChartPeriod(p)}
                                  className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
                                    monthlyChartPeriod === p
                                      ? 'bg-blue-500 text-white border-blue-500'
                                      : 'bg-white border-gray-300 hover:bg-gray-100'
                                  }`}
                                >
                                  {p === 'max' ? 'Max' : p}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Chart 1: Price + 10M SMA */}
                          <ResponsiveContainer width="100%" height={350}>
                            <LineChart data={priceData} margin={{ top: 20, right: 70, left: -5, bottom: 15 }}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis
                                dataKey="date"
                                tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />}
                                height={35}
                              />
                              <YAxis tick={{ fontSize: 9 }} width={40} domain={['auto', 'auto']} />
                              <Tooltip
                                formatter={(value: number, name: string) => {
                                  if (value == null) return ['-', name];
                                  return [formatPrice(value), name];
                                }}
                              />
                              <Legend />
                              <Customized component={MonthlyPriceBubbles} />
                              {/* Black price line */}
                              <Line
                                type="monotone"
                                dataKey="price"
                                name={monthlySelectedTicker}
                                stroke="#000000"
                                strokeWidth={2}
                                dot={false}
                                connectNulls
                              />
                              {/* Red 10-month SMA line */}
                              <Line
                                type="monotone"
                                dataKey="sma10"
                                name="10M SMA"
                                stroke="#ef4444"
                                strokeWidth={1.5}
                                dot={false}
                                connectNulls
                              />
                              {/* Green dot at highest price in the visible period */}
                              {maxPricePoint && (
                                <ReferenceDot
                                  x={maxPricePoint.date}
                                  y={maxPricePoint.price}
                                  r={6}
                                  fill="#22c55e"
                                  stroke="#fff"
                                  strokeWidth={2}
                                  label={{
                                    value: formatPrice(maxPricePoint.price),
                                    position: 'top',
                                    fontSize: 11,
                                    fill: '#111827',
                                    fontWeight: 600,
                                  }}
                                />
                              )}
                              {/* Red dot at lowest price in the visible period */}
                              {minPricePoint && (
                                <ReferenceDot
                                  x={minPricePoint.date}
                                  y={minPricePoint.price}
                                  r={6}
                                  fill="#ef4444"
                                  stroke="#fff"
                                  strokeWidth={2}
                                  label={{
                                    value: formatPrice(minPricePoint.price),
                                    position: 'bottom',
                                    fontSize: 11,
                                    fill: '#111827',
                                    fontWeight: 600,
                                  }}
                                />
                              )}
                            </LineChart>
                          </ResponsiveContainer>

                          {/* Chart 2: Drawdown from All-Time High */}
                          <div className="mt-2">
                            <ResponsiveContainer width="100%" height={180}>
                              <AreaChart data={drawdownData} margin={{ top: 5, right: 70, left: -5, bottom: 15 }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                  dataKey="date"
                                  tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />}
                                  height={35}
                                />
                                <YAxis
                                  tick={{ fontSize: 9 }}
                                  width={40}
                                  domain={['auto', 0]}
                                  tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                                />
                                <Tooltip
                                  formatter={(value: number) => [`${value.toFixed(1)}%`, 'Drawdown']}
                                />
                                <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" strokeWidth={1} />
                                <Customized component={MonthlyDDBubbles} />
                                <Area
                                  type="monotone"
                                  dataKey="drawdown"
                                  name="Drawdown"
                                  stroke="#000000"
                                  fill="#000000"
                                  fillOpacity={0.1}
                                  strokeWidth={1.5}
                                />
                                {/* Red dot at max drawdown in the visible period, label to the left */}
                                {maxDrawdownPoint && (
                                  <ReferenceDot
                                    x={maxDrawdownPoint.date}
                                    y={maxDrawdownPoint.drawdown}
                                    r={6}
                                    fill="#ef4444"
                                    stroke="#fff"
                                    strokeWidth={2}
                                    label={{
                                      value: `${maxDrawdownPoint.drawdown.toFixed(1)}%`,
                                      position: 'left',
                                      fontSize: 11,
                                      fill: '#ef4444',
                                      fontWeight: 600,
                                    }}
                                  />
                                )}
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>

                          {/* Chart 3: SMA Distance — how far price is from 10-month SMA (in %) */}
                          {smaDistData.length > 0 && (
                            <div className="mt-2">
                              <ResponsiveContainer width="100%" height={180}>
                                <AreaChart data={smaDistData} margin={{ top: 5, right: 70, left: -5, bottom: 15 }}>
                                  <CartesianGrid strokeDasharray="3 3" />
                                  <XAxis
                                    dataKey="date"
                                    tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />}
                                    height={35}
                                  />
                                  <YAxis
                                    tick={{ fontSize: 9 }}
                                    width={40}
                                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                                  />
                                  <Tooltip
                                    formatter={(value: number) => [
                                      `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`,
                                      'SMA Distance',
                                    ]}
                                  />
                                  {/* Gradient definitions: green above 0%, red below 0% */}
                                  <defs>
                                    <linearGradient id="smaDistStroke" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor="#16a34a" />
                                      <stop offset={`${smaDistGradientOffset * 100}%`} stopColor="#16a34a" />
                                      <stop offset={`${smaDistGradientOffset * 100}%`} stopColor="#ef4444" />
                                      <stop offset="100%" stopColor="#ef4444" />
                                    </linearGradient>
                                    <linearGradient id="smaDistFill" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor="#16a34a" />
                                      <stop offset={`${smaDistGradientOffset * 100}%`} stopColor="#16a34a" />
                                      <stop offset={`${smaDistGradientOffset * 100}%`} stopColor="#ef4444" />
                                      <stop offset="100%" stopColor="#ef4444" />
                                    </linearGradient>
                                  </defs>
                                  {/* Gray dashed baseline at 0% — price equals SMA */}
                                  <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" strokeWidth={1} />
                                  <Customized component={MonthlySmaDistBubbles} />
                                  {/* Single area: green above 0, red below 0, one continuous line */}
                                  <Area
                                    type="monotone"
                                    dataKey="smaDist"
                                    name="SMA Distance"
                                    stroke="url(#smaDistStroke)"
                                    fill="url(#smaDistFill)"
                                    fillOpacity={0.15}
                                    strokeWidth={1.5}
                                    baseValue={0}
                                    isAnimationActive={false}
                                  />
                                  {/* Green dot at max positive distance from SMA (furthest above) */}
                                  {maxSmaDistPoint && maxSmaDistPoint.smaDist > 0 && (
                                    <ReferenceDot
                                      x={maxSmaDistPoint.date}
                                      y={maxSmaDistPoint.smaDist}
                                      r={6}
                                      fill="#16a34a"
                                      stroke="#fff"
                                      strokeWidth={2}
                                      label={{
                                        value: `+${maxSmaDistPoint.smaDist.toFixed(1)}%`,
                                        position: 'left',
                                        fontSize: 11,
                                        fill: '#16a34a',
                                        fontWeight: 600,
                                      }}
                                    />
                                  )}
                                  {/* Red dot at max negative distance from SMA (furthest below) */}
                                  {minSmaDistPoint && minSmaDistPoint.smaDist < 0 && (
                                    <ReferenceDot
                                      x={minSmaDistPoint.date}
                                      y={minSmaDistPoint.smaDist}
                                      r={6}
                                      fill="#ef4444"
                                      stroke="#fff"
                                      strokeWidth={2}
                                      label={{
                                        value: `${minSmaDistPoint.smaDist.toFixed(1)}%`,
                                        position: 'left',
                                        fontSize: 11,
                                        fill: '#ef4444',
                                        fontWeight: 600,
                                      }}
                                    />
                                  )}
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          )}

                          {/* Chart 4: Periodic Returns bar chart (Monthly / Quarterly / Annual) */}
                          {returnsData.length > 0 && (
                            <div className="mt-2">
                              {/* Toggle buttons: Monthly | Quarterly | Annual */}
                              <div className="flex items-center gap-2 mb-1 px-2">
                                <span className="text-xs font-semibold text-gray-500">Returns:</span>
                                {(['monthly', 'quarterly', 'annual'] as const).map(p => (
                                  <button
                                    key={p}
                                    onClick={() => setReturnsChartPeriod(p)}
                                    className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
                                      returnsChartPeriod === p
                                        ? 'bg-blue-500 text-white border-blue-500'
                                        : 'bg-white border-gray-300 hover:bg-gray-100'
                                    }`}
                                  >
                                    {p === 'monthly' ? 'Monthly' : p === 'quarterly' ? 'Quarterly' : 'Annual'}
                                  </button>
                                ))}
                              </div>
                              <ResponsiveContainer width="100%" height={200}>
                                <BarChart data={returnsData} margin={{ top: 20, right: 10, left: -5, bottom: 15 }}>
                                  <CartesianGrid strokeDasharray="3 3" />
                                  <XAxis
                                    dataKey="label"
                                    tick={(props: { x: number; y: number; payload: { value: string } }) => {
                                      const { x, y, payload } = props;
                                      const parts = String(payload.value).split('\n');
                                      if (parts.length === 2) {
                                        // Two-line label (quarterly: "2Q\n2024")
                                        return (
                                          <text x={x} y={y} textAnchor="middle" fontSize={9} fill="#6B7280">
                                            <tspan x={x} dy="0.5em">{parts[0]}</tspan>
                                            <tspan x={x} dy="1.2em">{parts[1]}</tspan>
                                          </text>
                                        );
                                      }
                                      // Single-line label (monthly: "Jan 25", annual: "2024")
                                      return <text x={x} y={y + 10} textAnchor="middle" fontSize={9} fill="#6B7280">{payload.value}</text>;
                                    }}
                                    height={35}
                                    interval={returnsChartPeriod === 'monthly' && returnsData.length > 24
                                      ? Math.max(0, Math.floor(returnsData.length / 20) - 1)
                                      : 0}
                                  />
                                  <YAxis
                                    tick={{ fontSize: 9 }}
                                    width={40}
                                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                                  />
                                  <Tooltip
                                    formatter={(value: number) => [
                                      `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`,
                                      'Return',
                                    ]}
                                  />
                                  <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" strokeWidth={1} />
                                  <Bar dataKey="return" isAnimationActive={false}>
                                    {/* Color each bar: black for positive, red for negative */}
                                    {returnsData.map((entry, index) => (
                                      <Cell key={index} fill={entry.return >= 0 ? '#000000' : '#ef4444'} />
                                    ))}
                                    {/* Labels above positive bars */}
                                    {showReturnLabels && (
                                      <LabelList
                                        dataKey="return"
                                        position="top"
                                        formatter={(value: number) => value >= 0 ? `+${value.toFixed(1)}%` : ''}
                                        style={{ fontSize: '9px', fill: '#666' }}
                                      />
                                    )}
                                    {/* Labels below negative bars */}
                                    {showReturnLabels && (
                                      <LabelList
                                        dataKey="return"
                                        position="bottom"
                                        formatter={(value: number) => value < 0 ? `${value.toFixed(1)}%` : ''}
                                        style={{ fontSize: '9px', fill: '#ef4444' }}
                                      />
                                    )}
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          )}

                          {/* ================================================
                              MONTHLY & FY RETURNS TABLE
                              Calendar-style table: rows = years, columns = Jan–Dec + FY.
                              Reuses calculateMonthlyReturns() — same table as in backtest tab.
                              ================================================ */}
                          {Object.keys(assetMonthlyReturns).length > 0 && (
                            <div className="bg-white p-4 rounded-lg shadow overflow-x-auto mt-4">
                              <h3 className="text-md font-semibold mb-2 text-gray-700">
                                Returns — {monthlySelectedTicker}
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
                                    <th className="w-2"></th>
                                    <th className="text-right py-2 px-2 bg-gray-100 font-semibold">1Q</th>
                                    <th className="text-right py-2 px-2 bg-gray-100 font-semibold">2Q</th>
                                    <th className="text-right py-2 px-2 bg-gray-100 font-semibold">3Q</th>
                                    <th className="text-right py-2 px-2 bg-gray-100 font-semibold">4Q</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {Object.keys(assetMonthlyReturns)
                                    // Skip years with no monthly returns at all (e.g. only Dec data
                                    // exists as a base for calculating the next year's Jan return)
                                    .filter(year => assetMonthlyReturns[year].monthly.some(r => r !== null))
                                    .sort().reverse().map(year => (
                                    <tr key={year} className="border-b border-gray-100">
                                      <td className="py-2 px-2 font-medium bg-gray-50 sticky left-0">{year}</td>
                                      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(month => {
                                        const ret = assetMonthlyReturns[year].monthly[month];
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
                                        assetMonthlyReturns[year].fy >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                      }`}>
                                        {assetMonthlyReturns[year].fy.toFixed(2)}%
                                      </td>
                                      <td className="w-2"></td>
                                      {/* Quarterly returns: compound the 3 monthly returns in each quarter */}
                                      {[[0,1,2],[3,4,5],[6,7,8],[9,10,11]].map((qMonths, qi) => {
                                        const mReturns = qMonths.map(m => assetMonthlyReturns[year].monthly[m]);
                                        const hasAny = mReturns.some(r => r !== null);
                                        if (!hasAny) {
                                          return <td key={`q${qi}`} className="text-right py-2 px-2 text-gray-300">-</td>;
                                        }
                                        // Compound non-null monthly returns: (1+r1)*(1+r2)*(1+r3) - 1
                                        const qReturn = mReturns.reduce<number>((acc, r) => r !== null ? acc * (1 + r / 100) : acc, 1);
                                        const qPct = (qReturn - 1) * 100;
                                        return (
                                          <td key={`q${qi}`} className={`text-right py-2 px-2 font-semibold ${
                                            qPct >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                          }`}>
                                            {qPct.toFixed(2)}%
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {/* ================================================
                              MONTHLY PRICES TABLE
                              Same layout as returns table above, but shows last
                              available price for each month instead of returns.
                              Heatmap coloring: white (lowest) → dark teal (highest).
                              ================================================ */}
                          {assetReturnPoints.length > 0 && (() => {
                            // Build monthly prices: { year: { monthly: (number|null)[], fyPrice: number|null } }
                            // Each cell = last available price in that month
                            const monthlyPrices: { [year: string]: { monthly: (number | null)[]; fyPrice: number | null } } = {};

                            for (const pt of assetReturnPoints) {
                              const d = new Date(pt.date);
                              const year = d.getFullYear().toString();
                              const month = d.getMonth(); // 0-11
                              if (!monthlyPrices[year]) {
                                monthlyPrices[year] = { monthly: Array(12).fill(null), fyPrice: null };
                              }
                              // Last price in each month (data is chronological, so later rows overwrite)
                              monthlyPrices[year].monthly[month] = pt.value;
                            }

                            // FY price = last available price in the year (last non-null month)
                            for (const year of Object.keys(monthlyPrices)) {
                              const months = monthlyPrices[year].monthly;
                              for (let i = 11; i >= 0; i--) {
                                if (months[i] !== null) {
                                  monthlyPrices[year].fyPrice = months[i];
                                  break;
                                }
                              }
                            }

                            // Collect all non-null prices for heatmap min/max
                            const allPrices: number[] = [];
                            for (const year of Object.keys(monthlyPrices)) {
                              for (const p of monthlyPrices[year].monthly) {
                                if (p !== null) allPrices.push(p);
                              }
                            }
                            const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : 0;
                            const maxPrice = allPrices.length > 0 ? Math.max(...allPrices) : 0;

                            const years = Object.keys(monthlyPrices)
                              .filter(year => monthlyPrices[year].monthly.some(p => p !== null))
                              .sort().reverse();

                            if (years.length === 0) return null;

                            return (
                              <div className="bg-white p-4 rounded-lg shadow overflow-x-auto mt-4">
                                <h3 className="text-md font-semibold mb-2 text-gray-700">
                                  Prices — {monthlySelectedTicker}
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
                                      <th className="w-2"></th>
                                      <th className="text-right py-2 px-2 bg-gray-100 font-semibold">1Q</th>
                                      <th className="text-right py-2 px-2 bg-gray-100 font-semibold">2Q</th>
                                      <th className="text-right py-2 px-2 bg-gray-100 font-semibold">3Q</th>
                                      <th className="text-right py-2 px-2 bg-gray-100 font-semibold">4Q</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {years.map(year => {
                                      // Quarter price = last available price in that quarter
                                      const qPrices = [[0,1,2],[3,4,5],[6,7,8],[9,10,11]].map(qMonths => {
                                        for (let i = qMonths.length - 1; i >= 0; i--) {
                                          const p = monthlyPrices[year].monthly[qMonths[i]];
                                          if (p !== null) return p;
                                        }
                                        return null;
                                      });

                                      return (
                                        <tr key={year} className="border-b border-gray-100">
                                          <td className="py-2 px-2 font-medium bg-gray-50 sticky left-0">{year}</td>
                                          {[0,1,2,3,4,5,6,7,8,9,10,11].map(month => {
                                            const price = monthlyPrices[year].monthly[month];
                                            if (price === null) {
                                              return <td key={month} className="text-right py-2 px-2 text-gray-300">-</td>;
                                            }
                                            return (
                                              <td key={month} className="text-right py-2 px-2" style={{ backgroundColor: getPriceHeatmap(price, minPrice, maxPrice) }}>
                                                {price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                              </td>
                                            );
                                          })}
                                          {/* FY = last price of the year */}
                                          <td className="text-right py-2 px-2 font-semibold" style={
                                            monthlyPrices[year].fyPrice !== null
                                              ? { backgroundColor: getPriceHeatmap(monthlyPrices[year].fyPrice!, minPrice, maxPrice) }
                                              : {}
                                          }>
                                            {monthlyPrices[year].fyPrice !== null
                                              ? monthlyPrices[year].fyPrice!.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                              : '-'}
                                          </td>
                                          <td className="w-2"></td>
                                          {/* Quarterly prices = last available price in each quarter */}
                                          {qPrices.map((qp, qi) => (
                                            <td key={`q${qi}`} className="text-right py-2 px-2 font-semibold" style={
                                              qp !== null ? { backgroundColor: getPriceHeatmap(qp, minPrice, maxPrice) } : {}
                                            }>
                                              {qp !== null
                                                ? qp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                                : '-'}
                                            </td>
                                          ))}
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            );
                          })()}

                          {/* ================================================
                              MONTHLY DRAWDOWNS TABLE
                              Shows % distance from all-time high at each month-end.
                              White = at ATH (0%), red heatmap = underwater (deeper = darker).
                              MaxDD = worst drawdown in each year, ATHs = # of ATH months.
                              ================================================ */}
                          {assetReturnPoints.length > 0 && (() => {
                            // Build monthly drawdowns from the price series
                            // Track running ATH and compute drawdown at each month-end
                            const monthlyDDs: { [year: string]: { monthly: (number | null)[]; maxDD: number; athCount: number } } = {};
                            let peak = 0;

                            for (const pt of assetReturnPoints) {
                              const d = new Date(pt.date);
                              const year = d.getFullYear().toString();
                              const month = d.getMonth(); // 0-11
                              if (!monthlyDDs[year]) {
                                monthlyDDs[year] = { monthly: Array(12).fill(null), maxDD: 0, athCount: 0 };
                              }
                              // Update running peak
                              if (pt.value > peak) peak = pt.value;
                              // Drawdown = % below peak (0 = at ATH, negative = underwater)
                              const dd = peak > 0 ? ((pt.value - peak) / peak) * 100 : 0;
                              monthlyDDs[year].monthly[month] = dd;
                            }

                            // Calculate MaxDD and ATH count per year
                            for (const year of Object.keys(monthlyDDs)) {
                              const months = monthlyDDs[year].monthly;
                              let yearMaxDD = 0;
                              let yearATHs = 0;
                              for (const dd of months) {
                                if (dd === null) continue;
                                if (dd < yearMaxDD) yearMaxDD = dd;
                                if (dd === 0) yearATHs++;
                              }
                              monthlyDDs[year].maxDD = yearMaxDD;
                              monthlyDDs[year].athCount = yearATHs;
                            }

                            // Find the worst drawdown across all data for heatmap scaling
                            let worstDD = 0;
                            for (const year of Object.keys(monthlyDDs)) {
                              if (monthlyDDs[year].maxDD < worstDD) worstDD = monthlyDDs[year].maxDD;
                            }

                            // Red heatmap for drawdowns: white (0%) → muted red (worst DD)
                            // Aligned with getPriceHeatmap red end: rgb(205, 130, 130)
                            const getDDColor = (dd: number): string => {
                              if (dd === 0 || worstDD === 0) return '#ffffff';
                              const pos = dd / worstDD; // 0 = at ATH, 1 = worst drawdown
                              const r = Math.round(255 - pos * (255 - 205));  // 255 → 205
                              const g = Math.round(255 - pos * (255 - 130));  // 255 → 130
                              const b = Math.round(255 - pos * (255 - 130));  // 255 → 130
                              return `rgb(${r}, ${g}, ${b})`;
                            };

                            // Max ATH count for green heatmap scaling
                            const maxATHs = Math.max(...Object.values(monthlyDDs).map(y => y.athCount), 1);

                            // Green heatmap for ATHs: white (0) → muted green (max ATHs)
                            // Aligned with getPriceHeatmap green end: rgb(120, 190, 120)
                            const getATHColor = (count: number): string => {
                              if (count === 0 || maxATHs === 0) return '#ffffff';
                              const pos = count / maxATHs;
                              const r = Math.round(255 - pos * (255 - 120));  // 255 → 120
                              const g = Math.round(255 - pos * (255 - 190));  // 255 → 190
                              const b = Math.round(255 - pos * (255 - 120));  // 255 → 120
                              return `rgb(${r}, ${g}, ${b})`;
                            };

                            const years = Object.keys(monthlyDDs)
                              .filter(year => monthlyDDs[year].monthly.some(d => d !== null))
                              .sort().reverse();

                            if (years.length === 0) return null;

                            return (
                              <div className="bg-white p-4 rounded-lg shadow overflow-x-auto mt-4">
                                <h3 className="text-md font-semibold mb-2 text-gray-700">
                                  Drawdowns — {monthlySelectedTicker}
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
                                      <th className="w-2"></th>
                                      <th className="text-right py-2 px-2 bg-gray-100 font-semibold">MaxDD</th>
                                      <th className="text-right py-2 px-2 bg-gray-100 font-semibold">ATHs</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {years.map(year => (
                                      <tr key={year} className="border-b border-gray-100">
                                        <td className="py-2 px-2 font-medium bg-gray-50 sticky left-0">{year}</td>
                                        {[0,1,2,3,4,5,6,7,8,9,10,11].map(month => {
                                          const dd = monthlyDDs[year].monthly[month];
                                          if (dd === null) {
                                            return <td key={month} className="text-right py-2 px-2 text-gray-300">-</td>;
                                          }
                                          return (
                                            <td key={month} className="text-right py-2 px-2" style={{ backgroundColor: getDDColor(dd) }}>
                                              {dd === 0 ? '0.0' : dd.toFixed(1)}
                                            </td>
                                          );
                                        })}
                                        <td className="w-2"></td>
                                        {/* MaxDD for the year */}
                                        <td className="text-right py-2 px-2 font-semibold" style={{ backgroundColor: getDDColor(monthlyDDs[year].maxDD) }}>
                                          {monthlyDDs[year].maxDD === 0 ? '0.0%' : `${monthlyDDs[year].maxDD.toFixed(1)}%`}
                                        </td>
                                        {/* ATH count for the year — green heatmap scaled to max */}
                                        <td className="text-right py-2 px-2 font-semibold" style={{ backgroundColor: getATHColor(monthlyDDs[year].athCount) }}>
                                          {monthlyDDs[year].athCount}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ============================================
              GRAPHS TAB
              ============================================
              A responsive grid of small line charts — one per asset.
              Each chart shows monthly prices over a selectable period,
              with the ticker and period return in the title. */}
          {isConnected && assetData && activeView === 'graphs' && (
            <div className="mt-2">
              {/* Controls row: filters + SMA toggle on left, period buttons on right */}
              <div className="flex justify-between items-start mb-4">
                <AssetFilterControls>
                  {/* SMA toggle — rendered inside the filter flex container for perfect alignment */}
                  <button
                    onClick={() => setGraphsShowSMA(!graphsShowSMA)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap ${
                      graphsShowSMA
                        ? 'bg-red-500 text-white border-red-500'
                        : 'bg-white border-gray-300 hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    10m SMA
                  </button>
                </AssetFilterControls>
                <div className="flex items-center gap-3">
                  {/* End Date selector — pick which month the charts end at */}
                  <select
                    value={graphsEndDate}
                    onChange={(e) => setGraphsEndDate(e.target.value)}
                    className="px-2 py-1 text-xs border border-gray-300 rounded bg-white"
                  >
                    {(() => {
                      // Build list of unique months (last date per YYYY-MM), most recent first
                      const monthMap = new Map<string, string>();
                      for (const row of assetData!) {
                        const d = new Date(row.date);
                        if (isNaN(d.getTime())) continue;
                        const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
                        monthMap.set(ym, row.date); // last date wins (data is chronological)
                      }
                      const months = Array.from(monthMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));
                      return [
                        <option key="" value="">Latest</option>,
                        ...months.map(([ym, date]) => {
                          const d = new Date(date);
                          const label = `${MONTH_ABBR[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(-2)}`;
                          return <option key={ym} value={date}>{label}</option>;
                        })
                      ];
                    })()}
                  </select>

                  {/* Period buttons */}
                  <div className="flex gap-1">
                    {(['1Y', '2Y', '3Y', '4Y', '5Y', 'Max'] as const).map(p => {
                      const value = p === 'Max' ? 'max' : p;
                      return (
                        <button
                          key={p}
                          onClick={() => setGraphsPeriod(value as typeof graphsPeriod)}
                          className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
                            graphsPeriod === value
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white border-gray-300 hover:bg-gray-100'
                          }`}
                        >
                          {p}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Responsive grid of mini charts: 3 columns on desktop, 2 on tablet, 1 on mobile */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {getFilteredAssetLookup().map(asset => {
                  // Reuse getMonthlyChartData — pass endDate so charts end at the selected month
                  const chartData = getMonthlyChartData(asset.ticker, graphsPeriod, graphsEndDate || undefined);
                  if (!chartData) return null;
                  const { priceData, totalReturn } = chartData;
                  if (priceData.length === 0) return null;

                  // Pick 5 evenly-spaced ticks so the X-axis is uniform
                  const numTicks = 5;
                  const graphTicks: string[] = [];
                  for (let i = 0; i < numTicks; i++) {
                    const idx = Math.round(i * (priceData.length - 1) / (numTicks - 1));
                    graphTicks.push(priceData[idx].date);
                  }

                  // Current price = last data point; format decimals based on magnitude
                  const currentPrice = priceData[priceData.length - 1].price;
                  const formattedPrice = currentPrice < 10
                    ? currentPrice.toFixed(2)    // e.g. 3.45
                    : currentPrice < 1000
                      ? currentPrice.toFixed(1)  // e.g. 123.4
                      : Math.round(currentPrice).toLocaleString(); // e.g. 1,234

                  // Compute 5 evenly-spaced Y-axis ticks for each chart individually.
                  // Goal: lines fill almost all the chart area with Y-axis max at most
                  // ~10% above the highest price and Y-axis min near the lowest price.
                  const allYValues = graphsShowSMA
                    ? priceData.flatMap(d => d.sma10 != null ? [d.price, d.sma10] : [d.price])
                    : priceData.map(d => d.price);
                  const rawMin = Math.min(...allYValues);
                  const rawMax = Math.max(...allYValues);
                  const rawRange = rawMax - rawMin || 1; // avoid zero range
                  // Pick the smallest "nice" step where floor(min/step)*step + 4*step
                  // covers rawMax. Try current magnitude first, then next one up to handle
                  // edge cases where the data range doesn't fit neatly (e.g. range ~39
                  // with mag=1 where the largest candidate 10 can't span the full range).
                  const roughStep = rawRange / 4;
                  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
                  const multipliers = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 7.5, 8, 10];
                  let niceStep = 0;
                  for (const scale of [mag, mag * 10]) {
                    for (const m of multipliers) {
                      const step = m * scale;
                      const lo = Math.floor(rawMin / step) * step;
                      if (lo + 4 * step >= rawMax) {
                        niceStep = step;
                        break;
                      }
                    }
                    if (niceStep > 0) break;
                  }
                  // Ultimate fallback: compute exact step needed (shouldn't normally hit)
                  if (niceStep === 0) {
                    niceStep = Math.ceil(rawRange / 4) || 1;
                  }
                  const yMin = Math.floor(rawMin / niceStep) * niceStep;
                  const yTicks = Array.from({ length: 5 }, (_, i) =>
                    Number((yMin + i * niceStep).toPrecision(10))
                  );

                  // Current drawdown from the peak within the selected period (not all-time ATH)
                  // Use only actual prices (not SMA) so the drawdown is always price-based
                  const maxPriceInPeriod = Math.max(...priceData.map(d => d.price));
                  const currDD = maxPriceInPeriod > 0
                    ? ((currentPrice - maxPriceInPeriod) / maxPriceInPeriod) * 100
                    : 0;

                  return (
                    <div key={asset.ticker} className="bg-white p-3 rounded-lg shadow">
                      {/* Title: Ticker: Price (return%) / Curr DD: (-x.x%) */}
                      <h3 className="text-sm font-semibold text-gray-700 mb-1">
                        {asset.ticker}: <span className="text-gray-400">{formattedPrice}</span>{' '}
                        <span style={{ color: totalReturn >= 0 ? '#16a34a' : '#dc2626' }}>
                          ({totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(1)}%)
                        </span>
                        {' / '}
                        <span className="font-normal text-gray-500">
                          Curr DD: (<span style={{ color: currDD === 0 ? '#16a34a' : currDD > -5 ? '#ca8a04' : currDD > -20 ? '#dc7c7c' : '#dc2626' }}>{currDD.toFixed(1)}%</span>)
                        </span>
                      </h3>

                      {/* Small line chart — black price line, no legend, minimal chrome */}
                      <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={priceData} margin={{ top: 5, right: 5, left: -15, bottom: 15 }}>
                          {/* Force gridlines to draw exactly at our computed tick positions */}
                          <CartesianGrid
                            strokeDasharray="3 3"
                            horizontalCoordinatesGenerator={({ yAxis }: any) => {
                              if (!yAxis?.scale) return [];
                              return yTicks.map(tick => yAxis.scale(tick));
                            }}
                            verticalCoordinatesGenerator={({ xAxis }: any) => {
                              if (!xAxis?.scale) return [];
                              return graphTicks.map(tick => xAxis.scale(tick));
                            }}
                          />
                          <XAxis
                            dataKey="date"
                            ticks={graphTicks}
                            tickFormatter={(d: string) => {
                              const dt = new Date(d);
                              return isNaN(dt.getTime()) ? d : `${MONTH_ABBR[dt.getUTCMonth()]}${String(dt.getUTCFullYear()).slice(-2)}`;
                            }}
                            tick={{ fontSize: 9 }}
                          />
                          <YAxis
                            type="number"
                            tick={{ fontSize: 9 }}
                            width={45}
                            domain={[yTicks[0], yTicks[yTicks.length - 1]]}
                            ticks={yTicks}
                            allowDataOverflow
                          />
                          <Tooltip formatter={(value: number) => formatPrice(value)} />
                          <Line
                            type="monotone"
                            dataKey="price"
                            stroke="#000000"
                            strokeWidth={1.5}
                            dot={false}
                            connectNulls
                          />
                          {/* 10-month SMA red line — only shown when toggle is active */}
                          {graphsShowSMA && (
                            <Line
                              type="monotone"
                              dataKey="sma10"
                              stroke="#ef4444"
                              strokeWidth={1}
                              dot={false}
                              connectNulls
                            />
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })}
              </div>
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

          {/* ============================================ */}
          {/* CORRELATION MATRIX TAB */}
          {/* ============================================ */}
          {/* Shows how different assets move together (or apart). */}
          {/* A correlation of +1 means they move in lockstep (bad for diversification). */}
          {/* A correlation of -1 means they move in opposite directions (great for diversification). */}
          {/* 0 means no relationship at all. */}
          {isConnected && assetData && activeView === 'correlationMatrix' && (
            <div className="mt-2">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Correlations</h2>

              {/* Reuse the same asset/class/currency filter controls as other tabs, with Correlation Period added inline */}
              <AssetFilterControls>
                {/* Correlation Period dropdown — styled to match the other filter buttons */}
                <div className="relative">
                  <div className="px-3 py-1.5 text-sm border border-gray-300 bg-white rounded-lg flex items-center gap-2">
                    <span className="font-medium">Period:</span>
                    <select
                      value={correlationPeriod}
                      onChange={(e) => setCorrelationPeriod(Number(e.target.value))}
                      className="bg-transparent text-gray-600 outline-none cursor-pointer"
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(y => (
                        <option key={y} value={y}>{y}Y</option>
                      ))}
                    </select>
                  </div>
                </div>
              </AssetFilterControls>

              {/* Render the correlation matrix table */}
              {(() => {
                const { tickers, matrix } = calculateCorrelationMatrix(correlationPeriod);

                if (tickers.length === 0) {
                  return (
                    <div className="bg-yellow-50 p-4 rounded-lg text-yellow-800">
                      No assets to display. Please adjust your filters or load data.
                    </div>
                  );
                }

                return (
                  <div className="bg-white p-4 rounded-lg shadow">
                    <div className="overflow-auto max-h-[75vh]">
                    <table className="text-xs border-collapse">
                      <thead>
                        <tr>
                          {/* Empty top-left corner cell - sticky both top and left (highest z-index) */}
                          <th className="py-1 px-2 sticky top-0 left-0 z-30 border border-gray-200 min-w-[60px]" style={{ backgroundColor: '#f3f4f6' }}></th>
                          {/* Column headers — one per ticker, each sticky top */}
                          {tickers.map(ticker => (
                            <th
                              key={ticker}
                              className="py-1 px-2 sticky top-0 z-20 border border-gray-200 text-center font-semibold min-w-[55px]" style={{ backgroundColor: '#f3f4f6' }}
                              title={assetLookup.find(a => a.ticker === ticker)?.name || ticker}
                            >
                              {ticker}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tickers.map((rowTicker, i) => (
                          <tr key={rowTicker}>
                            {/* Row header — sticky on the left with solid background */}
                            <td
                              className="py-1 px-2 sticky left-0 z-10 border border-gray-200 font-semibold" style={{ backgroundColor: '#f3f4f6' }}
                              title={assetLookup.find(a => a.ticker === rowTicker)?.name || rowTicker}
                            >
                              {rowTicker}
                            </td>
                            {/* Correlation values for this row */}
                            {tickers.map((colTicker, j) => {
                              const value = matrix[i][j];
                              const isValid = !isNaN(value);
                              return (
                                <td
                                  key={colTicker}
                                  className="py-1 px-2 text-center border border-gray-200 font-mono"
                                  style={{
                                    backgroundColor: isValid ? getCorrelationColor(value) : '#f3f4f6',
                                    // Make text darker for better readability on colored backgrounds
                                    color: isValid ? '#1f2937' : '#9ca3af',
                                  }}
                                  title={isValid ? `${rowTicker} vs ${colTicker}: ${value.toFixed(4)}` : `${rowTicker} vs ${colTicker}: insufficient data`}
                                >
                                  {isValid ? value.toFixed(2) : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>

                    {/* Color legend */}
                    <div className="mt-4 flex items-center gap-2 text-xs text-gray-600">
                      <span className="font-medium">Legend:</span>
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded" style={{ backgroundColor: getCorrelationColor(-1) }}></div>
                        <span>-1 (opposite)</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded" style={{ backgroundColor: getCorrelationColor(0) }}></div>
                        <span>0 (no relation)</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded" style={{ backgroundColor: getCorrelationColor(1) }}></div>
                        <span>+1 (move together)</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ============================================ */}
              {/* RISK / RETURN SCATTER PLOT                   */}
              {/* X axis = Volatility, Y axis = CAGR           */}
              {/* Only assets with full history for the period */}
              {/* ============================================ */}
              {(() => {
                const filteredAssets = getFilteredAssetLookup();
                const monthsNeeded = correlationPeriod * 12;
                // Slice the last N years of data (+1 row so we can compute the first monthly return)
                const slicedData = assetData.slice(-(monthsNeeded + 1));

                // Color palette for the dots — cycles if there are more than 20 assets
                const DOT_COLORS = [
                  '#6366f1','#f97316','#22c55e','#3b82f6','#ec4899',
                  '#84cc16','#14b8a6','#f59e0b','#8b5cf6','#ef4444',
                  '#06b6d4','#d97706','#10b981','#7c3aed','#e11d48',
                  '#0ea5e9','#65a30d','#0d9488','#dc2626','#7e22ce',
                ];

                const scatterData: { ticker: string; name: string; x: number; y: number; color: string }[] = [];
                let colorIdx = 0;

                for (const asset of filteredAssets) {
                  const ticker = asset.ticker;

                  // Require valid price at both ends of the slice — this enforces the "enough history" rule:
                  // if the asset didn't exist N years ago its first-row price will be 0/missing and it gets skipped
                  const firstPrice = Number(slicedData[0]?.[ticker]);
                  const lastPrice  = Number(slicedData[slicedData.length - 1]?.[ticker]);
                  if (!firstPrice || firstPrice <= 0 || !lastPrice || lastPrice <= 0) continue;

                  // CAGR for the period: ((endPrice / startPrice) ^ (1/years) - 1) × 100
                  const cagr = (Math.pow(lastPrice / firstPrice, 1 / correlationPeriod) - 1) * 100;

                  // Annualised volatility: std dev of monthly returns × sqrt(12) × 100
                  const monthlyReturns: number[] = [];
                  for (let i = 1; i < slicedData.length; i++) {
                    const p    = Number(slicedData[i][ticker]);
                    const prev = Number(slicedData[i - 1][ticker]);
                    if (p > 0 && prev > 0) monthlyReturns.push((p - prev) / prev);
                  }
                  if (monthlyReturns.length < 3) continue;

                  const mean     = monthlyReturns.reduce((s, r) => s + r, 0) / monthlyReturns.length;
                  const variance = monthlyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / monthlyReturns.length;
                  const volatility = Math.sqrt(variance) * Math.sqrt(12) * 100;

                  scatterData.push({
                    ticker,
                    name: asset.name,
                    x: parseFloat(volatility.toFixed(2)),
                    y: parseFloat(cagr.toFixed(2)),
                    color: DOT_COLORS[colorIdx % DOT_COLORS.length],
                  });
                  colorIdx++;
                }

                if (scatterData.length === 0) return null;

                // Compute axis domains with padding so dots and labels have room
                const xs = scatterData.map(d => d.x);
                const ys = scatterData.map(d => d.y);
                const xPad = Math.max(3, (Math.max(...xs) - Math.min(...xs)) * 0.15);
                const yPad = Math.max(3, (Math.max(...ys) - Math.min(...ys)) * 0.15);
                const xMin = parseFloat((Math.min(...xs) - xPad).toFixed(1));
                const xMax = parseFloat((Math.max(...xs) + xPad).toFixed(1));
                const yMin = parseFloat((Math.min(...ys) - yPad).toFixed(1));
                const yMax = parseFloat((Math.max(...ys) + yPad).toFixed(1));

                // Generate explicit Y ticks that always land exactly on 0.
                // Recharts auto-ticks don't guarantee a tick at 0, which causes the
                // zero ReferenceLine to visually mis-align with any nearby tick label.
                const yRange = yMax - yMin;
                const rawInterval = yRange / 5;
                const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rawInterval) || 1)));
                const norm = rawInterval / mag;
                const tickInterval = norm <= 2 ? 2 * mag : norm <= 5 ? 5 * mag : 10 * mag;
                const yTickStart = Math.ceil(yMin / tickInterval) * tickInterval;
                const yTicks: number[] = [];
                for (let t = yTickStart; t <= yMax + tickInterval * 0.01; t += tickInterval) {
                  yTicks.push(Math.round(t * 1000) / 1000); // strip floating-point noise
                }
                // Force 0 into the tick list if it falls within the domain
                if (yMin <= 0 && 0 <= yMax && !yTicks.some(t => t === 0)) {
                  yTicks.push(0);
                  yTicks.sort((a, b) => a - b);
                }

                return (
                  <div className="bg-white p-4 rounded-lg shadow mt-4">
                    <h3 className="text-base font-semibold text-gray-700 mb-1">
                      Risk / Return ({correlationPeriod}Y) — Annualised Return vs. Volatility
                    </h3>
                    <p className="text-xs text-gray-500 mb-4">
                      Only assets with {correlationPeriod}+ years of price history are shown.
                    </p>
                    <ResponsiveContainer width="100%" height={440}>
                      <ScatterChart margin={{ top: 20, right: 100, bottom: 50, left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis
                          type="number"
                          dataKey="x"
                          name="Volatility"
                          domain={[xMin, xMax]}
                          tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                          label={{
                            value: `STANDARD DEVIATION (${correlationPeriod}Y)`,
                            position: 'insideBottom',
                            offset: -15,
                            style: { fontSize: 10, fill: '#6b7280', letterSpacing: '0.05em' },
                          }}
                          tick={{ fontSize: 11, fill: '#6b7280' }}
                        />
                        <YAxis
                          type="number"
                          dataKey="y"
                          name="Return"
                          domain={[yMin, yMax]}
                          ticks={yTicks}
                          tickFormatter={(v: number) => `${Math.round(v)}%`}
                          label={{
                            value: `ANNLZD ${correlationPeriod}Y TR (M)`,
                            angle: -90,
                            position: 'insideLeft',
                            offset: 15,
                            style: { fontSize: 10, fill: '#6b7280', letterSpacing: '0.05em' },
                          }}
                          tick={{ fontSize: 11, fill: '#6b7280' }}
                        />
                        <Tooltip
                          cursor={{ strokeDasharray: '3 3' }}
                          content={(props: any) => {
                            if (!props.active || !props.payload?.length) return null;
                            const d = props.payload[0].payload;
                            return (
                              <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', maxWidth: 240 }}>
                                <div style={{ fontWeight: 700, marginBottom: 4, color: d.color }}>{d.ticker}</div>
                                <div style={{ color: '#374151', marginBottom: 2 }}>{d.name}</div>
                                <div style={{ color: '#6b7280' }}>
                                  <span>Return ({correlationPeriod}Y CAGR): </span>
                                  <strong style={{ color: '#111827' }}>{d.y.toFixed(2)}%</strong>
                                </div>
                                <div style={{ color: '#6b7280' }}>
                                  <span>Volatility ({correlationPeriod}Y): </span>
                                  <strong style={{ color: '#111827' }}>{d.x.toFixed(2)}%</strong>
                                </div>
                              </div>
                            );
                          }}
                        />
                        {/* Dashed red zero line — only shown when at least one asset has negative return */}
                        {scatterData.some(d => d.y < 0) && (
                          <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="6 3" strokeWidth={1.5} />
                        )}
                        <Scatter
                          data={scatterData}
                          shape={(props: any) => {
                            const { cx, cy, payload } = props;
                            return (
                              <g key={payload.ticker}>
                                <circle
                                  cx={cx}
                                  cy={cy}
                                  r={8}
                                  fill={payload.color}
                                  opacity={0.85}
                                  stroke="white"
                                  strokeWidth={1.5}
                                />
                                <text
                                  x={cx + 12}
                                  y={cy + 4}
                                  fontSize={11}
                                  fill="#374151"
                                  fontFamily="sans-serif"
                                  fontWeight={500}
                                >
                                  {payload.ticker}
                                </text>
                              </g>
                            );
                          }}
                        />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ============================================ */}
          {/* PORTFOLIO TAB                                */}
          {/* Shows annual portfolio data from the Years sheet: */}
          {/* Chart 1: Portfolio Value (stacked bar)        */}
          {/* Chart 2: Contributions & Profit (stacked + growth label) */}
          {/* Chart 3: Returns by Year (grouped bars)       */}
          {/* ============================================ */}
          {isConnected && activeView === 'portfolio' && (
            <div className="mt-2">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Portfolio</h2>

              {yearsData.length === 0 ? (
                <div className="bg-yellow-50 p-4 rounded-lg text-yellow-800">
                  No data available. Make sure the &quot;Years&quot; sheet is published in your Google Spreadsheet.
                </div>
              ) : (
                <>
                  {/* Currency dropdown — affects Charts 1 & 2 only */}
                  <div className="mb-4 flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700">Currency:</span>
                    <select
                      value={portfolioCurrency}
                      onChange={(e) => setPortfolioCurrency(e.target.value as typeof portfolioCurrency)}
                      className="px-3 py-1.5 text-sm border border-gray-300 bg-white rounded-lg outline-none cursor-pointer"
                    >
                      {(['PLN', 'USD', 'EUR', 'CHF', 'SGD'] as const).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>

                  {/* Chart 1: Portfolio Value by Year — stacked bar chart */}
                  {/* Bottom segment (black) = cumulative contributions */}
                  {/* Top segment (yellow) = cumulative profit */}
                  {(() => {
                    // Pre-compute chart data so the custom label renderer can access it by index
                    const valueChartData = getPortfolioValueChartData();
                    return (
                      <div className="bg-white p-4 rounded-lg shadow mb-4">
                        <h3 className="text-md font-semibold text-gray-700 mb-2">Portfolio Value by Year ({CURRENCY_SYMBOLS[portfolioCurrency]})</h3>
                        <ResponsiveContainer width="100%" height={350}>
                          <BarChart
                            data={valueChartData}
                            margin={{ top: 30, right: 5, left: -15, bottom: 5 }}
                          >
                            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(1)}M`} domain={[0, 'dataMax + 0.3']} />
                            <Tooltip
                              formatter={(value: number, name: string) => {
                                const label = name === 'contrCumulative' ? 'Contributions' : 'Profit';
                                return [`${value.toFixed(2)}M ${CURRENCY_SYMBOLS[portfolioCurrency]}`, label];
                              }}
                              labelFormatter={(label) => `Year: ${label}`}
                            />
                            {/* Bottom bar: Cumulative Contributions (black) with white label */}
                            <Bar dataKey="contrCumulative" stackId="value" fill="#000000" name="contrCumulative">
                              <LabelList
                                dataKey="contrCumulative"
                                position="center"
                                formatter={(value: number) => value > 0 ? `${value.toFixed(2)}M` : ''}
                                style={{ fontSize: '13px', fill: '#fff', fontWeight: 600 }}
                              />
                            </Bar>
                            {/* Top bar: Cumulative Profit (yellow) with profit label + total above */}
                            <Bar dataKey="profitCumulative" stackId="value" fill="#F5A623" name="profitCumulative">
                              {/* Profit value on the yellow segment */}
                              <LabelList
                                dataKey="profitCumulative"
                                position="center"
                                formatter={(value: number) => value !== 0 ? `${value.toFixed(2)}M` : ''}
                                style={{ fontSize: '15px', fill: '#000', fontWeight: 700 }}
                              />
                              {/* Total (contributions + profit) above the bar — uses custom renderer */}
                              {/* to read the full data entry and compute the sum */}
                              <LabelList
                                dataKey="profitCumulative"
                                position="top"
                                content={(props: any) => {
                                  const { x, y, width, index } = props as { x: number; y: number; width: number; index: number };
                                  const entry = valueChartData[index];
                                  if (!entry) return null;
                                  const total = entry.contrCumulative + entry.profitCumulative;
                                  return (
                                    <text
                                      x={x + width / 2}
                                      y={y - 18}
                                      textAnchor="middle"
                                      style={{ fontSize: '13px', fill: '#991b1b', fontWeight: 700 }}
                                    >
                                      {total.toFixed(2)}M
                                    </text>
                                  );
                                }}
                              />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })()}

                  {/* Chart 2: Contributions and Profit by Year — stacked bars + growth label */}
                  {/* Bottom segment (black) = contributions for the year */}
                  {/* Top segment (yellow) = profit for the year */}
                  {/* Growth label above bar = contributions + profit for that year */}
                  {(() => {
                    const cpChartData = getContributionsProfitChartData();
                    return (
                  <div className="bg-white p-4 rounded-lg shadow mb-4">
                    <h3 className="text-md font-semibold text-gray-700 mb-2">Contributions and Profit by Year ({CURRENCY_SYMBOLS[portfolioCurrency]})</h3>
                    <ResponsiveContainer width="100%" height={350}>
                      <ComposedChart
                        data={cpChartData}
                        margin={{ top: 30, right: 5, left: -15, bottom: 5 }}
                      >
                        <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => {
                          if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(0)}k`;
                          return v.toFixed(0);
                        }} />
                        <Tooltip
                          content={({ active, payload, label }) => {
                            if (!active || !payload || !payload.length) return null;
                            const entry = payload[0]?.payload;
                            if (!entry) return null;
                            const sym = CURRENCY_SYMBOLS[portfolioCurrency];
                            return (
                              <div className="bg-white border border-gray-200 rounded shadow px-3 py-2 text-sm">
                                <div className="font-semibold mb-1">Year: {label}</div>
                                <div>Contributions: {Math.round(entry.contributions).toLocaleString()} {sym}</div>
                                <div style={{ color: entry.profit < 0 ? '#ef4444' : undefined }}>
                                  Profit: {Math.round(entry.profit).toLocaleString()} {sym}
                                </div>
                                <div className="font-semibold mt-1">Total: {Math.round(entry.growthTotal).toLocaleString()} {sym}</div>
                              </div>
                            );
                          }}
                        />
                        {/* Negative profit (yellow) — renders below zero when loss occurs */}
                        {/* Must be FIRST in the stack so it extends downward from 0 */}
                        <Bar dataKey="profitNegative" stackId="cp" fill="#F5A623" name="profitNegative">
                          {/* Custom label: placed at a fixed 20px below the bar baseline */}
                          <LabelList
                            dataKey="profitNegative"
                            content={(props: any) => {
                              const { x, y, width, height, index } = props as { x: number; y: number; width: number; height: number; index: number };
                              const entry = cpChartData[index];
                              if (!entry || entry.profit >= 0) return null;
                              const formatted = Math.abs(entry.profit) >= 1000
                                ? `${(Math.abs(entry.profit) / 1000).toFixed(0)}k`
                                : Math.abs(Math.round(entry.profit)).toLocaleString();
                              return (
                                <text
                                  x={x + width / 2}
                                  y={y + Math.abs(height) + 18}
                                  textAnchor="middle"
                                  style={{ fontSize: '15px', fill: '#ef4444', fontWeight: 700 }}
                                >
                                  ({formatted})
                                </text>
                              );
                            }}
                          />
                        </Bar>
                        {/* Middle bar: Contributions (black) */}
                        <Bar dataKey="contributions" stackId="cp" fill="#000000" name="contributions">
                          <LabelList
                            dataKey="contributions"
                            position="center"
                            formatter={(value: number) => {
                              if (value === 0) return '';
                              if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(0)}k`;
                              return Math.round(value).toLocaleString();
                            }}
                            style={{ fontSize: '13px', fill: '#fff', fontWeight: 600 }}
                          />
                        </Bar>
                        {/* Top bar: Positive profit (yellow) — stacked above contributions */}
                        <Bar dataKey="profitPositive" stackId="cp" fill="#F5A623" name="profitPositive">
                          <LabelList
                            dataKey="profitPositive"
                            position="center"
                            formatter={(value: number) => {
                              if (value === 0) return '';
                              if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
                              return Math.round(value).toLocaleString();
                            }}
                            style={{ fontSize: '15px', fill: '#000', fontWeight: 700 }}
                          />
                        </Bar>
                        {/* Invisible line used only to place the growth total label above each bar */}
                        <Line
                          dataKey="growthTotal"
                          stroke="transparent"
                          dot={false}
                          activeDot={false}
                          legendType="none"
                          name="growthTotal"
                        >
                          <LabelList
                            dataKey="growthTotal"
                            position="top"
                            formatter={(value: number) => {
                              const sym = CURRENCY_SYMBOLS[portfolioCurrency];
                              if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(0)}k ${sym}`;
                              return `${Math.round(value).toLocaleString()} ${sym}`;
                            }}
                            style={{ fontSize: '13px', fill: '#991b1b', fontWeight: 700 }}
                            offset={18}
                          />
                        </Line>
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                    );
                  })()}

                  {/* === Portfolio Statistics Section === */}
                  {(() => {
                    if (!assetData || assetData.length === 0) return null;

                    // Define the 3 portfolio tickers and their matching CPI tickers
                    const portfolioStats = [
                      { ticker: 'Prtf PLN', label: 'Portfolio PLN', cpiTicker: 'CPIMPL' },
                      { ticker: 'Prtf USD', label: 'Portfolio USD', cpiTicker: 'CPIMUS' },
                      { ticker: 'Prtf SGD', label: 'Portfolio SGD', cpiTicker: 'CPIMSG' },
                    ];

                    // Find the latest first-available date among the 3 portfolio tickers
                    // so all rows use the same period and are directly comparable
                    let latestStart = '';
                    for (const ps of portfolioStats) {
                      const firstDate = getAssetFirstAvailableDate(ps.ticker);
                      if (firstDate && firstDate > latestStart) latestStart = firstDate;
                    }
                    if (!latestStart) return null;

                    // Filter assetData to rows from the common start date onward
                    const filteredRows = assetData.filter(row => row.date >= latestStart);
                    if (filteredRows.length < 2) return null;

                    // Calculate statistics for each portfolio ticker
                    const statsRows = portfolioStats.map(ps => {
                      // Build price series (only rows where this ticker has data)
                      const prices: { date: string; value: number }[] = [];
                      for (const row of filteredRows) {
                        const price = Number(row[ps.ticker]);
                        if (price && price > 0) prices.push({ date: row.date, value: price });
                      }
                      if (prices.length < 2) return null;

                      const startValue = prices[0].value;
                      const endValue = prices[prices.length - 1].value;

                      // Total Return %
                      const totalReturn = ((endValue - startValue) / startValue) * 100;

                      // Time period in years
                      const startDate = new Date(prices[0].date);
                      const endDate = new Date(prices[prices.length - 1].date);
                      const years = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

                      // CAGR
                      const cagr = years > 0 ? (Math.pow(endValue / startValue, 1 / years) - 1) * 100 : 0;

                      // Periodic returns for volatility (monthly)
                      const periodicReturns: number[] = [];
                      for (let i = 1; i < prices.length; i++) {
                        periodicReturns.push((prices[i].value - prices[i - 1].value) / prices[i - 1].value);
                      }
                      const mean = periodicReturns.reduce((sum, r) => sum + r, 0) / periodicReturns.length;
                      const variance = periodicReturns.map(r => Math.pow(r - mean, 2)).reduce((sum, sq) => sum + sq, 0) / periodicReturns.length;
                      const volatility = Math.sqrt(variance) * Math.sqrt(12) * 100;

                      // Sharpe (simplified, 0% risk-free rate)
                      const sharpe = volatility > 0 ? cagr / volatility : 0;

                      // Drawdown series
                      let peak = prices[0].value;
                      const drawdowns: number[] = [];
                      for (const p of prices) {
                        if (p.value > peak) peak = p.value;
                        drawdowns.push(((p.value - peak) / peak) * 100);
                      }
                      const maxDD = Math.min(...drawdowns);

                      // Longest drawdown (consecutive months underwater)
                      let longestDDMonths = 0;
                      let currentDDMonths = 0;
                      for (const dd of drawdowns) {
                        if (dd < 0) { currentDDMonths++; }
                        else {
                          if (currentDDMonths > longestDDMonths) longestDDMonths = currentDDMonths;
                          currentDDMonths = 0;
                        }
                      }
                      if (currentDDMonths > longestDDMonths) longestDDMonths = currentDDMonths;

                      // Current drawdown
                      const currDD = drawdowns[drawdowns.length - 1];

                      // CPI Inflation: total return and CAGR over the same period
                      let cumInflation = 0;
                      let annInflation = 0;
                      const startCpi = Number(filteredRows[0][ps.cpiTicker]);
                      const endCpi = Number(filteredRows[filteredRows.length - 1][ps.cpiTicker]);
                      if (startCpi > 0 && endCpi > 0) {
                        cumInflation = ((endCpi - startCpi) / startCpi) * 100;
                        annInflation = years > 0 ? (Math.pow(endCpi / startCpi, 1 / years) - 1) * 100 : 0;
                      }

                      // Real CAGR: nominal CAGR adjusted for inflation
                      // Formula: (1 + nominalCAGR) / (1 + inflationCAGR) - 1
                      const realCagr = annInflation !== 0
                        ? (((1 + cagr / 100) / (1 + annInflation / 100)) - 1) * 100
                        : cagr;

                      return {
                        label: ps.label,
                        totalReturn: totalReturn.toFixed(2),
                        cumInflation: cumInflation.toFixed(2),
                        cagr: cagr.toFixed(2),
                        annInflation: annInflation.toFixed(2),
                        realCagr: realCagr.toFixed(2),
                        volatility: volatility.toFixed(2),
                        sharpe: sharpe.toFixed(2),
                        maxDD: maxDD.toFixed(2),
                        longestDD: formatPeriod(longestDDMonths),
                        currDD: currDD.toFixed(2),
                      };
                    }).filter(Boolean);

                    if (statsRows.length === 0) return null;

                    // Period label for the heading
                    const periodStart = filteredRows[0].date;
                    const periodEnd = filteredRows[filteredRows.length - 1].date;

                    return (
                      <div className="bg-white p-4 rounded-lg shadow mb-4 overflow-x-auto">
                        <h3 className="text-md font-semibold text-gray-700 mb-2">
                          Statistics
                          <span className="text-xs font-normal text-gray-400 ml-2">({periodStart} — {periodEnd})</span>
                        </h3>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b-2 border-gray-200">
                              <th className="text-left py-2 px-2">Portfolio</th>
                              <th className="text-right py-2 px-2">Return</th>
                              <th className="text-right py-2 px-2">Cum Inflation</th>
                              <th className="text-right py-2 px-2">CAGR</th>
                              <th className="text-right py-2 px-2">Ann. Inflation</th>
                              <th className="text-right py-2 px-2">Real CAGR</th>
                              <th className="text-right py-2 px-2">Vol</th>
                              <th className="text-right py-2 px-2">Sharpe</th>
                              <th className="text-right py-2 px-2">Max DD</th>
                              <th className="text-right py-2 px-2">Longest DD</th>
                              <th className="text-right py-2 px-2">Curr DD</th>
                            </tr>
                          </thead>
                          <tbody>
                            {statsRows.map((row: any, idx: number) => (
                              <tr key={idx} className="border-b border-gray-100">
                                <td className="py-2 px-2 font-medium text-gray-700">{row.label}</td>
                                <td className={`text-right py-2 px-2 ${Number(row.totalReturn) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{row.totalReturn}%</td>
                                <td className="text-right py-2 px-2 text-amber-600">{row.cumInflation}%</td>
                                <td className={`text-right py-2 px-2 ${Number(row.cagr) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{row.cagr}%</td>
                                <td className="text-right py-2 px-2 text-amber-600">{row.annInflation}%</td>
                                <td className={`text-right py-2 px-2 ${Number(row.realCagr) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{row.realCagr}%</td>
                                <td className="text-right py-2 px-2">{row.volatility}%</td>
                                <td className="text-right py-2 px-2">{row.sharpe}</td>
                                <td className="text-right py-2 px-2 text-red-600">{row.maxDD}%</td>
                                <td className="text-right py-2 px-2 text-purple-700">{row.longestDD}</td>
                                <td className="text-right py-2 px-2 text-orange-600">{row.currDD}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}

                  {/* Currency filter dropdown — controls which bars appear in Charts 3 & 4 */}
                  <div className="mb-4 relative inline-block">
                    <button
                      onClick={() => setReturnCurrencyDropdownOpen(!returnCurrencyDropdownOpen)}
                      className={`px-3 py-1.5 text-sm border rounded-lg flex items-center gap-2 ${
                        returnCurrencyDropdownOpen ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <span className="font-medium">Currencies:</span>
                      <span className="text-gray-600">
                        {selectedReturnCurrencies.length === 3 ? 'All' : selectedReturnCurrencies.length === 0 ? 'None' : selectedReturnCurrencies.join(', ')}
                      </span>
                      <svg className={`w-4 h-4 transition-transform ${returnCurrencyDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {returnCurrencyDropdownOpen && (
                      <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-300 rounded-lg shadow-lg min-w-[160px]">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                          <span className="text-sm font-medium text-gray-700">Show Currencies</span>
                          <button
                            onClick={() => setSelectedReturnCurrencies(selectedReturnCurrencies.length === 3 ? [] : ['PLN', 'USD', 'SGD'])}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            {selectedReturnCurrencies.length === 3 ? 'Deselect All' : 'Select All'}
                          </button>
                        </div>
                        <div className="p-2">
                          {(['PLN', 'USD', 'SGD'] as const).map(c => (
                            <label key={c} className="flex items-center gap-2 py-1 px-2 text-sm cursor-pointer hover:bg-gray-100 rounded">
                              <input
                                type="checkbox"
                                checked={selectedReturnCurrencies.includes(c)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedReturnCurrencies([...selectedReturnCurrencies, c]);
                                  } else {
                                    setSelectedReturnCurrencies(selectedReturnCurrencies.filter(x => x !== c));
                                  }
                                }}
                              />
                              <span>{c}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Chart 3: Returns by Year — grouped bar chart */}
                  {/* Bars shown/hidden based on selectedReturnCurrencies */}
                  <div className="bg-white p-4 rounded-lg shadow mb-4">
                    <h3 className="text-md font-semibold text-gray-700 mb-2">Returns by Year (%)</h3>
                    <ResponsiveContainer width="100%" height={350}>
                      <BarChart
                        data={getReturnsChartData()}
                        margin={{ top: 20, right: 5, left: 5, bottom: 5 }}
                      >
                        <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                        <YAxis hide domain={['auto', 'auto']} />
                        <Tooltip
                          formatter={(value: number) => [`${value.toFixed(1)}%`, '']}
                          labelFormatter={(label) => `Year: ${label}`}
                        />
                        <Legend />
                        {selectedReturnCurrencies.includes('PLN') && (
                          <Bar dataKey="Return PLN" fill="#000000">
                            <LabelList
                              dataKey="Return PLN"
                              position="top"
                              formatter={(value: number) => value >= 0 ? `${value.toFixed(1)}%` : ''}
                              style={{ fontSize: '11px', fill: '#666' }}
                            />
                            <LabelList
                              dataKey="Return PLN"
                              position="bottom"
                              formatter={(value: number) => value < 0 ? `${value.toFixed(1)}%` : ''}
                              style={{ fontSize: '11px', fill: '#ef4444' }}
                            />
                          </Bar>
                        )}
                        {selectedReturnCurrencies.includes('USD') && (
                          <Bar dataKey="Return USD" fill="#ef4444">
                            <LabelList
                              dataKey="Return USD"
                              position="top"
                              formatter={(value: number) => value >= 0 ? `${value.toFixed(1)}%` : ''}
                              style={{ fontSize: '11px', fill: '#666' }}
                            />
                            <LabelList
                              dataKey="Return USD"
                              position="bottom"
                              formatter={(value: number) => value < 0 ? `${value.toFixed(1)}%` : ''}
                              style={{ fontSize: '11px', fill: '#ef4444' }}
                            />
                          </Bar>
                        )}
                        {selectedReturnCurrencies.includes('SGD') && (
                          <Bar dataKey="Return SGD" fill="#F5A623">
                            <LabelList
                              dataKey="Return SGD"
                              position="top"
                              formatter={(value: number) => value >= 0 ? `${value.toFixed(1)}%` : ''}
                              style={{ fontSize: '11px', fill: '#666' }}
                            />
                            <LabelList
                              dataKey="Return SGD"
                              position="bottom"
                              formatter={(value: number) => value < 0 ? `${value.toFixed(1)}%` : ''}
                              style={{ fontSize: '11px', fill: '#ef4444' }}
                            />
                          </Bar>
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Chart 4: Growth by Year — grouped bar chart */}
                  {/* Bars shown/hidden based on selectedReturnCurrencies */}
                  <div className="bg-white p-4 rounded-lg shadow mb-4">
                    <h3 className="text-md font-semibold text-gray-700 mb-2">Growth by Year (%)</h3>
                    <ResponsiveContainer width="100%" height={350}>
                      <BarChart
                        data={getGrowthByYearChartData()}
                        margin={{ top: 20, right: 5, left: 5, bottom: 5 }}
                      >
                        <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                        <YAxis hide domain={['auto', 'auto']} />
                        <Tooltip
                          formatter={(value: number) => [`${value.toFixed(1)}%`, '']}
                          labelFormatter={(label) => `Year: ${label}`}
                        />
                        <Legend />
                        {selectedReturnCurrencies.includes('PLN') && (
                          <Bar dataKey="Growth PLN" fill="#000000">
                            <LabelList
                              dataKey="Growth PLN"
                              position="top"
                              formatter={(value: number) => value >= 0 ? `${value.toFixed(1)}%` : ''}
                              style={{ fontSize: '11px', fill: '#666' }}
                            />
                            <LabelList
                              dataKey="Growth PLN"
                              position="bottom"
                              formatter={(value: number) => value < 0 ? `${value.toFixed(1)}%` : ''}
                              style={{ fontSize: '11px', fill: '#ef4444' }}
                            />
                          </Bar>
                        )}
                        {selectedReturnCurrencies.includes('USD') && (
                          <Bar dataKey="Growth USD" fill="#ef4444">
                            <LabelList
                              dataKey="Growth USD"
                              position="top"
                              formatter={(value: number) => value >= 0 ? `${value.toFixed(1)}%` : ''}
                              style={{ fontSize: '11px', fill: '#666' }}
                            />
                            <LabelList
                              dataKey="Growth USD"
                              position="bottom"
                              formatter={(value: number) => value < 0 ? `${value.toFixed(1)}%` : ''}
                              style={{ fontSize: '11px', fill: '#ef4444' }}
                            />
                          </Bar>
                        )}
                        {selectedReturnCurrencies.includes('SGD') && (
                          <Bar dataKey="Growth SGD" fill="#F5A623">
                            <LabelList
                              dataKey="Growth SGD"
                              position="top"
                              formatter={(value: number) => value >= 0 ? `${value.toFixed(1)}%` : ''}
                              style={{ fontSize: '11px', fill: '#666' }}
                            />
                            <LabelList
                              dataKey="Growth SGD"
                              position="bottom"
                              formatter={(value: number) => value < 0 ? `${value.toFixed(1)}%` : ''}
                              style={{ fontSize: '11px', fill: '#ef4444' }}
                            />
                          </Bar>
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ============================================ */}
          {/* POSITIONS TAB (Open + Closed)               */}
          {/* ============================================ */}
          {isConnected && assetData && activeView === 'positions' && (
            <div className="mt-2">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Positions</h2>

              {/* --- Positions Tab Filter Controls --- */}
              {/* Shared filter for both open and closed positions */}
              <div ref={closedFilterRef} className="flex flex-wrap gap-2 mb-4">
                {/* Assets Dropdown */}
                {(() => {
                  const positionsLookup = getPositionsTabLookup();
                  const allAssetsSelected = closedSelectedTickers.length === positionsLookup.length && positionsLookup.length > 0;

                  const getSelectionText = (selected: number, total: number, label: string) => {
                    if (selected === 0) return `No ${label}`;
                    if (selected === total) return `All ${label}`;
                    return `${selected} of ${total}`;
                  };

                  return (
                    <div className="relative">
                      <button
                        onClick={() => setClosedOpenFilterDropdown(closedOpenFilterDropdown === 'assets' ? null : 'assets')}
                        className={`px-3 py-1.5 text-sm border rounded-lg flex items-center gap-2 ${
                          closedOpenFilterDropdown === 'assets' ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <span className="font-medium">Assets:</span>
                        <span className="text-gray-600">{getSelectionText(closedSelectedTickers.length, positionsLookup.length, 'assets')}</span>
                        <svg className={`w-4 h-4 transition-transform ${closedOpenFilterDropdown === 'assets' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {closedOpenFilterDropdown === 'assets' && (
                        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-300 rounded-lg shadow-lg min-w-[280px]">
                          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                            <span className="text-sm font-medium text-gray-700">Select Assets</span>
                            <button onClick={() => toggleAllPositionAssets(!allAssetsSelected)} className="text-xs text-blue-600 hover:underline">
                              {allAssetsSelected ? 'Deselect All' : 'Select All'}
                            </button>
                          </div>
                          <div className="max-h-60 overflow-y-auto p-2">
                            {positionsLookup.map(asset => (
                              <label key={asset.ticker} className="flex items-center gap-2 py-1 px-2 text-sm cursor-pointer hover:bg-gray-100 rounded">
                                <input
                                  type="checkbox"
                                  checked={closedSelectedTickers.includes(asset.ticker)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setClosedSelectedTickers([...closedSelectedTickers, asset.ticker]);
                                    } else {
                                      setClosedSelectedTickers(closedSelectedTickers.filter(t => t !== asset.ticker));
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
                  );
                })()}

                {/* Currency conversion dropdown — converts all position values to chosen currency */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500" title="Convert all position values to this currency for comparison">Ccy:</span>
                  <select
                    value={positionsCurrency}
                    onChange={(e) => setPositionsCurrency(e.target.value)}
                    className="px-1 py-0.5 text-xs border border-gray-300 rounded"
                    title="Target currency: converts invested/value/PnL columns to this currency"
                  >
                    {CURRENCY_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* --- SUMMARY VIEW (when no specific asset is drilled into) --- */}
              {!closedSelectedTicker && !openSelectedTicker && (() => {
                const filteredAssets = getClosedFilteredLookup();

                if (closedSelectedTickers.length === 0) {
                  return (
                    <div className="bg-white p-8 rounded-lg shadow text-center text-gray-500">
                      <p className="text-lg mb-2">Select assets using the filters above</p>
                      <p className="text-sm">Use the Assets filter to choose which positions to view.</p>
                    </div>
                  );
                }

                // --- Build Open Positions summary data ---
                const openTickers = getOpenTickers().filter(t => closedSelectedTickers.includes(t));
                const today = new Date().toISOString().split('T')[0];
                // Helper: find the FX rate for a given date by matching the same month's data row.
                // Data is month-end, so a mid-month transaction (e.g., Jan 15) should use
                // that month's rate (Jan 31), not the previous month's (Dec 31).
                const getFxRateForDate = (fxTicker: string, dateStr: string): number => {
                  if (!fxTicker || !assetData) return 1;
                  // Find the first row whose date >= the transaction date (same month's month-end)
                  const matchRow = assetData.find(row => row.date >= dateStr);
                  return matchRow ? getFxRate(matchRow, fxTicker) : (assetData.length > 0 ? getFxRate(assetData[assetData.length - 1], fxTicker) : 1);
                };

                // Helper: convert from an asset's native currency to the target positions currency
                // Uses PLN as a hub: nativeValue → PLN (via native FX rate) → target (÷ target FX rate)
                const getPositionConversionForDate = (nativeCurrency: string, dateStr: string): number => {
                  if (!positionsCurrency || nativeCurrency === positionsCurrency) return 1;
                  const nativeFxTicker = FX_TICKER_MAP[nativeCurrency] || '';
                  const toPLN = nativeCurrency === 'PLN' ? 1 : getFxRateForDate(nativeFxTicker, dateStr);
                  const targetFxTicker = FX_TICKER_MAP[positionsCurrency] || '';
                  const targetToPLN = positionsCurrency === 'PLN' ? 1 : getFxRateForDate(targetFxTicker, dateStr);
                  if (targetToPLN === 0) return toPLN;
                  return toPLN / targetToPLN;
                };

                // Latest FX rates from the most recent data row
                const latestRow = assetData && assetData.length > 0 ? assetData[assetData.length - 1] : null;

                // Helper: conversion rate at latest date for current values
                const getLatestConversion = (nativeCurrency: string): number => {
                  if (!positionsCurrency || nativeCurrency === positionsCurrency) return 1;
                  const nativeFxTicker = FX_TICKER_MAP[nativeCurrency] || '';
                  const toPLN = nativeCurrency === 'PLN' ? 1 : (latestRow ? getFxRate(latestRow, nativeFxTicker) : 1);
                  const targetFxTicker = FX_TICKER_MAP[positionsCurrency] || '';
                  const targetToPLN = positionsCurrency === 'PLN' ? 1 : (latestRow ? getFxRate(latestRow, targetFxTicker) : 1);
                  if (targetToPLN === 0) return toPLN;
                  return toPLN / targetToPLN;
                };

                // Currency label for converted columns (e.g., "PLN", "USD", or hidden when empty)
                const posCcySym = CURRENCY_SYMBOLS[positionsCurrency] || '';
                const posCcyLabel = positionsCurrency || '';

                const openSummaryData = openTickers.map(ticker => {
                  const purchases = getOpenPurchases(ticker);
                  const dividends = getOpenDividends(ticker);
                  const assetInfo = assetLookup.find(a => a.ticker === ticker);
                  const nativeCurrency = assetInfo?.currency || 'PLN';
                  const totalShares = purchases.reduce((sum, t) => sum + t.qty, 0);
                  const totalInvested = purchases.reduce((sum, t) => sum + t.amount, 0);
                  const totalDividends = dividends.reduce((sum, t) => sum + t.amount, 0);
                  const currentPrice = getCurrentPrice(ticker);
                  const currentValue = currentPrice * totalShares;
                  const totalPnL = currentValue + totalDividends - totalInvested;
                  const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
                  const firstBuyDate = purchases.length > 0 ? purchases[0].date : '';
                  const timeHeldYears = firstBuyDate ? (Date.now() - new Date(firstBuyDate).getTime()) / (365.25 * 86400000) : 0;
                  const cashFlows = [
                    ...purchases.map(t => ({ date: new Date(t.date), amount: -t.amount })),
                    ...dividends.map(t => ({ date: new Date(t.date), amount: t.amount })),
                    { date: new Date(), amount: currentValue },
                  ].sort((a, b) => a.date.getTime() - b.date.getTime());
                  const xirr = calculateXIRR(cashFlows);

                  // Convert to target currency: each transaction at its historical FX rate
                  const investedConverted = purchases.reduce((sum, t) => sum + t.amount * getPositionConversionForDate(nativeCurrency, t.date), 0);
                  const dividendsConverted = dividends.reduce((sum, t) => sum + t.amount * getPositionConversionForDate(nativeCurrency, t.date), 0);
                  const latestConversion = getLatestConversion(nativeCurrency);
                  const currentValueConverted = currentValue * latestConversion;
                  const totalPnLConverted = currentValueConverted + dividendsConverted - investedConverted;

                  const avgBuyPrice = totalShares > 0 ? (totalInvested - totalDividends) / totalShares : 0;

                  return {
                    ticker, name: assetInfo?.name || '', assetClass: assetInfo?.assetClass || '',
                    numTransactions: purchases.length,
                    firstBuyDate, lastValuation: today, timeHeldYears,
                    avgBuyPrice, currentPrice, totalShares,
                    totalInvested, currentValue, totalPnL, totalPnLPct, xirr,
                    investedConverted, currentValueConverted, totalPnLConverted,
                  };
                });

                // Sort open positions by asset class: Fixed Income → Crypto → Alternatives → Equities
                const assetClassOrder: Record<string, number> = {
                  'Fixed Income': 0, 'Crypto': 1, 'Alternatives': 2, 'Equities': 3,
                };
                openSummaryData.sort((a, b) => (assetClassOrder[a.assetClass] ?? 99) - (assetClassOrder[b.assetClass] ?? 99));

                // --- Compute portfolio weights for open positions ---
                // Weight = each position's current value / total portfolio value (uses converted currency when available)
                const totalPortfolioValue = openSummaryData.reduce((sum, r) => sum + (positionsCurrency ? r.currentValueConverted : r.currentValue), 0);
                const openWeights = openSummaryData.map(r => {
                  const posValue = positionsCurrency ? r.currentValueConverted : r.currentValue;
                  return totalPortfolioValue > 0 ? (posValue / totalPortfolioValue) * 100 : 0;
                });
                // Max weight is used to scale bar widths (largest weight = full bar width)
                const maxWeight = Math.max(...openWeights, 0.01); // avoid division by zero

                // --- Build Closed Positions summary data ---
                const closedSummaryData = filteredAssets.length === 0 ? [] : filteredAssets.map(asset => {
                  const transactions = getClosedTransactions(asset.ticker);
                  const totalCost = transactions.reduce((sum, t) => sum + t.initialCost, 0);
                  const totalFinalValue = transactions.reduce((sum, t) => sum + t.finalNetValue, 0);
                  const totalPnL = totalFinalValue - totalCost;
                  const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;
                  const sortedBuyDates = transactions.map(t => t.invDate).sort();
                  const sortedSaleDates = transactions.map(t => t.divDate).sort();
                  const firstBuyDate = sortedBuyDates[0] || '';
                  const lastSaleDate = sortedSaleDates[sortedSaleDates.length - 1] || '';
                  const cashFlows = transactions.flatMap(t => [
                    { date: new Date(t.invDate), amount: -t.initialCost },
                    { date: new Date(t.divDate), amount: t.finalNetValue }
                  ]).sort((a, b) => a.date.getTime() - b.date.getTime());
                  const xirr = calculateXIRR(cashFlows);
                  const timeHeldYears = firstBuyDate && lastSaleDate
                    ? (new Date(lastSaleDate).getTime() - new Date(firstBuyDate).getTime()) / (365.25 * 86400000)
                    : 0;
                  return {
                    ticker: asset.ticker, name: asset.name, numTransactions: transactions.length,
                    firstBuyDate, lastSaleDate, timeHeldYears,
                    totalInvested: totalCost, totalFinalValue, totalPnL, totalPnLPct, xirr,
                  };
                });

                if (openSummaryData.length === 0 && closedSummaryData.length === 0) {
                  return (
                    <div className="bg-white p-8 rounded-lg shadow text-center text-gray-500">
                      <p>No positions match the current filters.</p>
                    </div>
                  );
                }

                return (
                  <>
                    {/* === Open Positions Table === */}
                    {openSummaryData.length > 0 && (
                      <div className="bg-white p-4 rounded-lg shadow mb-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">Open Positions</h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-gray-200">
                                <th className="text-left py-2 px-2 bg-gray-200">Asset Name</th>
                                <th className="text-right py-2 px-2 bg-gray-200">Time Held</th>
                                <th className="text-right py-2 px-2 bg-gray-200">Avg Buy</th>
                                <th className="text-right py-2 px-2 bg-gray-200">Price</th>
                                <th className="text-right py-2 px-2 bg-gray-200">PnL %</th>
                                <th className="text-right py-2 px-2 bg-gray-200">Qty</th>
                                <th className="text-right py-2 px-2 bg-gray-200">Total Invested</th>
                                <th className="text-right py-2 px-2 bg-gray-200">Current Value</th>
                                <th className="text-right py-2 px-2 bg-gray-200">Total PnL</th>
                                <th className="text-right py-2 px-2 bg-gray-200">XIRR</th>
                                <th className="text-right py-2 px-2 bg-gray-200" style={{ width: 70 }}>Weight</th>
                                {positionsCurrency && <th className="text-right py-2 px-2 bg-gray-200">Invested {posCcyLabel}</th>}
                                {positionsCurrency && <th className="text-right py-2 px-2 bg-gray-200">Current {posCcyLabel}</th>}
                                {positionsCurrency && <th className="text-right py-2 px-2 bg-gray-200">PnL {posCcyLabel}</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {openSummaryData.map((row, idx) => (
                                <tr
                                  key={row.ticker}
                                  className={`border-b border-gray-50 cursor-pointer hover:bg-blue-50 transition-colors ${idx % 2 === 0 ? '' : 'bg-gray-25'}`}
                                  onClick={() => {
                                    setOpenSelectedTicker(row.ticker);
                                    setClosedSelectedTicker(''); // clear closed detail
                                    setOpenIncludedTxns(null);
                                    setOpenInvestedInto('');
                                    setOpenInvestedFrom('');
                                    setOpenGraphStarts('');
                                    setOpenGraphEnds('');
                                    setOpenSinceInvested(false);
                                    setOpenShowAvgBuy(true);
                                  }}
                                >
                                  <td className="py-2 px-2 text-gray-700">{row.name}</td>
                                  <td className="text-right py-2 px-2 font-mono" title={`First Buy: ${row.firstBuyDate}\nLast Valuation: ${row.lastValuation}`}>{row.timeHeldYears.toFixed(1)}y</td>
                                  <td className="text-right py-2 px-2 font-mono">{row.avgBuyPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  <td className="text-right py-2 px-2 font-mono">{row.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  <td className={`text-right py-2 px-2 font-mono font-medium ${row.totalPnLPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {row.totalPnLPct >= 0 ? '+' : ''}{row.totalPnLPct.toFixed(1)}%
                                  </td>
                                  <td className="text-right py-2 px-2 font-mono">{row.totalShares.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</td>
                                  <td className="text-right py-2 px-2 font-mono">{row.totalInvested.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className="text-right py-2 px-2 font-mono">{row.currentValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className={`text-right py-2 px-2 font-mono font-medium ${row.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {row.totalPnL >= 0 ? '+' : ''}{row.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                  </td>
                                  <td className={`text-right py-2 px-2 font-mono font-medium ${(row.xirr ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {row.xirr !== null ? `${row.xirr >= 0 ? '+' : ''}${row.xirr.toFixed(1)}%` : 'N/A'}
                                  </td>
                                  {/* Weight cell with inline bar chart */}
                                  <td className="py-2 px-2 font-mono" style={{ position: 'relative', overflow: 'hidden' }}>
                                    {/* Gray bar scaled relative to the largest weight */}
                                    <div style={{
                                      position: 'absolute', left: 0, top: 0, bottom: 0,
                                      width: `${(openWeights[idx] / maxWeight) * 100}%`,
                                      backgroundColor: 'rgb(209, 213, 219)', /* gray-300 */
                                      borderRadius: '0 2px 2px 0',
                                    }} />
                                    <span style={{ position: 'relative' }} className="text-right block">
                                      {openWeights[idx].toFixed(1)}%
                                    </span>
                                  </td>
                                  {positionsCurrency && <td className="text-right py-2 px-2 font-mono">{row.investedConverted.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>}
                                  {positionsCurrency && <td className="text-right py-2 px-2 font-mono">{row.currentValueConverted.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>}
                                  {positionsCurrency && <td className={`text-right py-2 px-2 font-mono font-medium ${row.totalPnLConverted >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {row.totalPnLConverted >= 0 ? '+' : ''}{row.totalPnLConverted.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                  </td>}
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              {(() => {
                                const totalInvestedCcy = openSummaryData.reduce((sum, r) => sum + r.investedConverted, 0);
                                const totalCurrentCcy = openSummaryData.reduce((sum, r) => sum + r.currentValueConverted, 0);
                                const totalPnLCcy = openSummaryData.reduce((sum, r) => sum + r.totalPnLConverted, 0);
                                return (
                                  <tr className="border-t-2 border-gray-300 font-semibold bg-gray-200">
                                    <td className="py-2 px-2 text-gray-700 font-mono">{openSummaryData.length} Holdings</td>
                                    <td colSpan={10}></td>
                                    {positionsCurrency && <td className="text-right py-2 px-2 font-mono">{totalInvestedCcy.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>}
                                    {positionsCurrency && <td className="text-right py-2 px-2 font-mono">{totalCurrentCcy.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>}
                                    {positionsCurrency && <td className={`text-right py-2 px-2 font-mono ${totalPnLCcy >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {totalPnLCcy >= 0 ? '+' : ''}{totalPnLCcy.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    </td>}
                                  </tr>
                                );
                              })()}
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* === Closed Positions Table === */}
                    {closedSummaryData.length > 0 && (
                      <div className="bg-white p-4 rounded-lg shadow">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">Closed Positions</h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-gray-200">
                                <th className="text-left py-2 px-2 bg-gray-200">Asset Name</th>
                                <th className="text-right py-2 px-2 bg-gray-200"># Txns</th>
                                <th className="text-right py-2 px-2 bg-gray-200">First Buy</th>
                                <th className="text-right py-2 px-2 bg-gray-200">Last Sale</th>
                                <th className="text-right py-2 px-2 bg-gray-200">Time Held</th>
                                <th className="text-right py-2 px-2 bg-gray-200">Total Invested</th>
                                <th className="text-right py-2 px-2 bg-gray-200">Total Final Value</th>
                                <th className="text-right py-2 px-2 bg-gray-200">Total PnL</th>
                                <th className="text-right py-2 px-2 bg-gray-200">PnL %</th>
                                <th className="text-right py-2 px-2 bg-gray-200">XIRR</th>
                              </tr>
                            </thead>
                            <tbody>
                              {closedSummaryData.map((row, idx) => (
                                <tr
                                  key={row.ticker}
                                  className={`border-b border-gray-50 cursor-pointer hover:bg-blue-50 transition-colors ${idx % 2 === 0 ? '' : 'bg-gray-25'}`}
                                  onClick={() => {
                                    setClosedSelectedTicker(row.ticker);
                                    setOpenSelectedTicker(''); // clear open detail
                                    setClosedIncludedTxns(null);
                                    setClosedInvestedInto('');
                                    setClosedInvestedFrom('');
                                    setClosedGraphEnds('');
                                    setClosedGraphStarts('');
                                    setClosedSinceInvested(false);
                                    setClosedUntilSold(false);
                                    setClosedShowAvgBuy(true);
                                    setClosedShowAvgSell(true);
                                  }}
                                >
                                  <td className="py-2 px-2 text-gray-700">{row.name}</td>
                                  <td className="text-right py-2 px-2">{row.numTransactions}</td>
                                  <td className="text-right py-2 px-2 font-mono">{row.firstBuyDate}</td>
                                  <td className="text-right py-2 px-2 font-mono">{row.lastSaleDate}</td>
                                  <td className="text-right py-2 px-2 font-mono">{row.timeHeldYears.toFixed(1)}y</td>
                                  <td className="text-right py-2 px-2 font-mono">{row.totalInvested.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className="text-right py-2 px-2 font-mono">{row.totalFinalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className={`text-right py-2 px-2 font-mono font-medium ${row.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {row.totalPnL >= 0 ? '+' : ''}{row.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                  </td>
                                  <td className={`text-right py-2 px-2 font-mono font-medium ${row.totalPnLPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {row.totalPnLPct >= 0 ? '+' : ''}{row.totalPnLPct.toFixed(1)}%
                                  </td>
                                  <td className={`text-right py-2 px-2 font-mono font-medium ${(row.xirr ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {row.xirr !== null ? `${row.xirr >= 0 ? '+' : ''}${row.xirr.toFixed(1)}%` : 'N/A'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-gray-400 mt-3">Click a row to see detailed transactions, chart, and statistics.</p>
                  </>
                );
              })()}

              {/* --- OPEN POSITION DETAIL VIEW --- */}
              {openSelectedTicker && (() => {
                const allPurchases = getOpenPurchases(openSelectedTicker);
                const filteredPurchases = getFilteredOpenPurchases(openSelectedTicker);
                const allDividends = getOpenDividends(openSelectedTicker);
                const assetInfo = assetLookup.find(a => a.ticker === openSelectedTicker);
                const stats = getOpenDashboardStats(openSelectedTicker);
                const { chartData, buyDots } = getOpenChartData(openSelectedTicker);
                const capitalChartData = getOpenCapitalChartData(openSelectedTicker);
                const currentPrice = getCurrentPrice(openSelectedTicker);
                const todayStr = new Date().toISOString().split('T')[0];

                // Build merged chronological list of purchases and dividends for the table
                type DisplayRow =
                  | { type: 'purchase'; index: number; data: TransactionRow }
                  | { type: 'dividend'; data: TransactionRow };
                const displayRows: DisplayRow[] = [
                  ...allPurchases.map((t, i) => ({ type: 'purchase' as const, index: i, data: t })),
                  ...allDividends.map(t => ({ type: 'dividend' as const, data: t })),
                ].sort((a, b) => a.data.date.localeCompare(b.data.date));

                // Buy dates for the "Invested From" dropdown
                const buyDates = Array.from(new Set(filteredPurchases.map(t => t.date))).sort();

                // PnL zero-crossing fraction for the gradient (same pattern as closed)
                const pnlZeroFraction = computePnlZeroFraction(capitalChartData);

                // Graph Starts options: all data months up to first buy
                const graphStartsOptions: string[] = (() => {
                  if (!assetData || buyDates.length === 0) return [];
                  const firstBuyD = new Date(buyDates[0]);
                  if (isNaN(firstBuyD.getTime())) return [];
                  const firstBuyYMStr = toYM(firstBuyD);
                  const monthSet = new Set<string>();
                  for (const row of assetData) {
                    const d = new Date(row.date);
                    if (isNaN(d.getTime())) continue;
                    if (toYM(d) <= firstBuyYMStr) monthSet.add(row.date);
                  }
                  return Array.from(monthSet).sort();
                })();

                // Graph Ends options: all data months from latest buy onward
                const graphEndsOptions: string[] = (() => {
                  if (!assetData || buyDates.length === 0) return [];
                  const lastBuyD = new Date(buyDates[buyDates.length - 1]);
                  if (isNaN(lastBuyD.getTime())) return [];
                  const lastBuyYMStr = toYM(lastBuyD);
                  const monthSet = new Set<string>();
                  for (const row of assetData) {
                    const d = new Date(row.date);
                    if (isNaN(d.getTime())) continue;
                    if (toYM(d) >= lastBuyYMStr) monthSet.add(row.date);
                  }
                  return Array.from(monthSet).sort();
                })();

                // Build comparison data if "Invested Into" is selected
                const comparisonDataRaw = openInvestedInto && openInvestedFrom
                  ? getNormalizedComparisonData(openSelectedTicker, openInvestedInto, openInvestedFrom)
                  : [];
                const compGraphStartsYM = openGraphStarts ? toYM(new Date(openGraphStarts)) : '';
                const compGraphEndsYM = openGraphEnds ? toYM(new Date(openGraphEnds)) : '';
                const comparisonData = (compGraphStartsYM || compGraphEndsYM)
                  ? comparisonDataRaw.filter(c => {
                      const d = new Date(c.date);
                      if (isNaN(d.getTime())) return false;
                      const ym = toYM(d);
                      if (compGraphStartsYM && ym < compGraphStartsYM) return false;
                      if (compGraphEndsYM && ym > compGraphEndsYM) return false;
                      return true;
                    })
                  : comparisonDataRaw;

                // Merge comparison data into chart data (uses Map for O(N+M) instead of O(N*M))
                const mergedChartData = mergeComparisonData(chartData, comparisonData);

                // Comparison stats
                let compGainBase: number | null = null;
                let compGainInvested: number | null = null;
                if (openInvestedInto && openInvestedFrom && assetData) {
                  const fromDate = new Date(openInvestedFrom);
                  const fromYM = toYM(fromDate);
                  let basePriceAtBuy = 0, compPriceAtBuy = 0;
                  let baseCurrentPrice = 0, compCurrentPrice = 0;
                  for (const row of assetData) {
                    const rowYM = toYM(new Date(row.date));
                    const bp = Number(row[openSelectedTicker]);
                    const cp = Number(row[openInvestedInto]);
                    if (rowYM === fromYM) {
                      if (bp > 0) basePriceAtBuy = bp;
                      if (cp > 0) compPriceAtBuy = cp;
                    }
                    if (bp > 0) baseCurrentPrice = bp;
                    if (cp > 0) compCurrentPrice = cp;
                  }
                  if (basePriceAtBuy > 0) compGainBase = ((baseCurrentPrice - basePriceAtBuy) / basePriceAtBuy) * 100;
                  if (compPriceAtBuy > 0) compGainInvested = ((compCurrentPrice - compPriceAtBuy) / compPriceAtBuy) * 100;
                }
                const compAssetInfo = openInvestedInto ? assetLookup.find(a => a.ticker === openInvestedInto) : null;

                return (
                  <div>
                    {/* Back button and asset header */}
                    <div className="flex items-center gap-3 mb-4">
                      <button
                        onClick={() => { setOpenSelectedTicker(''); setOpenIncludedTxns(null); }}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 flex items-center gap-1"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        Back to list
                      </button>
                      <h3 className="text-lg font-semibold text-gray-800">
                        {openSelectedTicker} — {assetInfo?.name || 'Unknown'}
                      </h3>
                    </div>

                    {/* --- Transactions Table --- */}
                    <div className="bg-white p-4 rounded-lg shadow mb-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">Transactions</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <th className="text-center py-1.5 px-2 bg-gray-50 w-8">
                                <input
                                  ref={openSelectAllRef}
                                  type="checkbox"
                                  checked={openIncludedTxns === null || openIncludedTxns.size === allPurchases.length}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setOpenIncludedTxns(null);
                                    } else {
                                      setOpenIncludedTxns(new Set());
                                    }
                                  }}
                                  className="rounded border-gray-300 cursor-pointer"
                                  title="Include/exclude all purchase transactions from stats and chart"
                                />
                              </th>
                              <th className="text-left py-1.5 px-2 bg-gray-50">Type</th>
                              <th className="text-left py-1.5 px-2 bg-gray-50">Inv Date</th>
                              <th className="text-left py-1.5 px-2 bg-gray-50">Valuation Date</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Hold (D)</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Hold (Y)</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Shares</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Buy Price</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Buy Comm.</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Initial Cost</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Valuation Price</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Current Value</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Cum. Div</th>
                              <th className="text-right py-1.5 px-2 bg-gray-100">Total Return</th>
                              <th className="text-right py-1.5 px-2 bg-gray-100">Return %</th>
                              <th className="text-right py-1.5 px-2 bg-gray-100">CAGR</th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayRows.map((row, rowIdx) => {
                              if (row.type === 'dividend') {
                                // Dividend row — show date, shares held, and amount
                                return (
                                  <tr key={`div-${rowIdx}`} className="border-b border-gray-50 bg-amber-50/40">
                                    <td className="py-1.5 px-2"></td>
                                    <td className="py-1.5 px-2 text-amber-700 font-medium">Dividend</td>
                                    <td className="py-1.5 px-2 font-mono">{row.data.date}</td>
                                    <td className="py-1.5 px-2"></td>
                                    <td className="py-1.5 px-2"></td>
                                    <td className="py-1.5 px-2"></td>
                                    <td className="text-right py-1.5 px-2 text-gray-400 font-mono">{row.data.qty.toLocaleString()}</td>
                                    <td className="py-1.5 px-2"></td>
                                    <td className="py-1.5 px-2"></td>
                                    <td className="py-1.5 px-2"></td>
                                    <td className="py-1.5 px-2"></td>
                                    <td className="py-1.5 px-2"></td>
                                    <td className="text-right py-1.5 px-2 font-mono text-green-600 font-medium">+{row.data.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="py-1.5 px-2"></td>
                                    <td className="py-1.5 px-2"></td>
                                    <td className="py-1.5 px-2"></td>
                                  </tr>
                                );
                              }
                              // Purchase row — compute valuation stats
                              const t = row.data;
                              const purchaseIdx = row.index;
                              const isIncluded = openIncludedTxns === null || openIncludedTxns.has(purchaseIdx);
                              const holdDays = Math.round((Date.now() - new Date(t.date).getTime()) / 86400000);
                              const holdYears = holdDays / 365.25;
                              const buyPrice = t.qty > 0 ? (t.amount - t.commAbs) / t.qty : 0;
                              const currentVal = t.qty * currentPrice;
                              const totalReturn = currentVal - t.amount;
                              const returnPct = t.amount > 0 ? (totalReturn / t.amount) * 100 : 0;
                              const cagr = holdYears > 0 && t.amount > 0 && currentVal > 0
                                ? (Math.pow(currentVal / t.amount, 1 / holdYears) - 1) * 100
                                : 0;

                              return (
                                <tr key={`buy-${purchaseIdx}`} className={`border-b border-gray-50 ${!isIncluded ? 'opacity-40' : purchaseIdx % 2 === 0 ? '' : 'bg-gray-25'}`}>
                                  <td className="text-center py-1.5 px-2">
                                    <input
                                      type="checkbox"
                                      checked={isIncluded}
                                      onChange={(e) => {
                                        if (openIncludedTxns === null) {
                                          const allIndices = new Set(allPurchases.map((_, i) => i));
                                          allIndices.delete(purchaseIdx);
                                          setOpenIncludedTxns(allIndices);
                                        } else {
                                          const next = new Set(openIncludedTxns);
                                          if (e.target.checked) {
                                            next.add(purchaseIdx);
                                            setOpenIncludedTxns(next.size === allPurchases.length ? null : next);
                                          } else {
                                            next.delete(purchaseIdx);
                                            setOpenIncludedTxns(next);
                                          }
                                        }
                                      }}
                                      className="rounded border-gray-300 cursor-pointer"
                                    />
                                  </td>
                                  <td className="py-1.5 px-2 text-green-700 font-medium">Purchase</td>
                                  <td className="py-1.5 px-2 font-mono">{t.date}</td>
                                  <td className="py-1.5 px-2 font-mono">{todayStr}</td>
                                  <td className="text-right py-1.5 px-2">{holdDays.toLocaleString()}</td>
                                  <td className="text-right py-1.5 px-2">{holdYears.toFixed(1)}</td>
                                  <td className="text-right py-1.5 px-2">{t.qty.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                                  <td className="text-right py-1.5 px-2 font-mono">{buyPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                                  <td className="text-right py-1.5 px-2 font-mono">{t.commAbs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className="text-right py-1.5 px-2 font-mono">{t.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className="text-right py-1.5 px-2 font-mono">{currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                                  <td className="text-right py-1.5 px-2 font-mono">{currentVal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className="text-right py-1.5 px-2 font-mono">—</td>
                                  <td className={`text-right py-1.5 px-2 font-mono font-medium ${totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {totalReturn >= 0 ? '+' : ''}{totalReturn.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                  </td>
                                  <td className={`text-right py-1.5 px-2 font-mono font-medium ${returnPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(1)}%
                                  </td>
                                  <td className={`text-right py-1.5 px-2 font-mono font-medium ${cagr >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {cagr >= 0 ? '+' : ''}{cagr.toFixed(1)}%
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          {/* --- Summary Row --- */}
                          {stats && (() => {
                            const sumShares = stats.totalShares;
                            const sumCost = stats.totalInvested;
                            const sumBuyComm = stats.totalBuyComm;
                            const sumDividends = stats.totalDividends;
                            const sumCurrentVal = stats.currentValue;
                            const sumReturn = sumCurrentVal + sumDividends - sumCost;
                            const sumReturnPct = sumCost > 0 ? (sumReturn / sumCost) * 100 : 0;
                            const maxDays = stats.holdingDays;
                            const maxYears = stats.holdingYears;

                            return (
                              <tfoot>
                                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                                  <td className="py-2 px-2"></td>
                                  <td className="py-2 px-2 text-left text-gray-700" colSpan={2}>Summary</td>
                                  <td className="py-2 px-2"></td>
                                  <td className="text-right py-2 px-2 font-mono">{maxDays.toLocaleString()}</td>
                                  <td className="text-right py-2 px-2 font-mono">{maxYears.toFixed(1)}</td>
                                  <td className="text-right py-2 px-2 font-mono">{sumShares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                                  <td className="text-right py-2 px-2 font-mono">{stats.adjAvgBuyPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                                  <td className="text-right py-2 px-2 font-mono">
                                    {sumBuyComm.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    {(sumCost - sumBuyComm) > 0 && <span className="text-gray-400 text-[10px] ml-0.5">({Math.round(sumBuyComm / (sumCost - sumBuyComm) * 10000)}bps)</span>}
                                  </td>
                                  <td className="text-right py-2 px-2 font-mono">{sumCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className="text-right py-2 px-2 font-mono">{currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                                  <td className="text-right py-2 px-2 font-mono">{sumCurrentVal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className="text-right py-2 px-2 font-mono">{sumDividends.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className={`text-right py-2 px-2 font-mono ${sumReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {sumReturn >= 0 ? '+' : ''}{sumReturn.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                  </td>
                                  <td className={`text-right py-2 px-2 font-mono ${sumReturnPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {sumReturnPct >= 0 ? '+' : ''}{sumReturnPct.toFixed(1)}%
                                  </td>
                                  <td className={`text-right py-2 px-2 font-mono ${stats.xirr !== null && stats.xirr >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {stats.xirr !== null ? `${stats.xirr >= 0 ? '+' : ''}${stats.xirr.toFixed(1)}%` : '—'}
                                  </td>
                                </tr>
                              </tfoot>
                            );
                          })()}
                        </table>
                      </div>
                    </div>

                    {/* --- Price History Chart --- */}
                    <div className="bg-white px-2 py-4 rounded-lg shadow mb-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3 px-2">Price History</h4>

                      {/* Chart controls */}
                      <div className="flex flex-wrap items-end gap-4 mb-4 px-2">
                        <button
                          onClick={() => setOpenSinceInvested(!openSinceInvested)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                            openSinceInvested ? 'bg-blue-500 text-white border-blue-500' : 'bg-white border-gray-300 hover:bg-gray-100'
                          }`}
                        >
                          Since Invested
                        </button>

                        <button
                          onClick={() => setOpenShowAvgBuy(!openShowAvgBuy)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                            openShowAvgBuy ? 'bg-green-500 text-white border-green-500' : 'bg-white border-gray-300 hover:bg-gray-100'
                          }`}
                        >
                          Avg Buy (Div Adj)
                        </button>

                        <div className="border-l border-gray-300 h-6 mx-1" />

                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">Invested Into</label>
                          <select
                            value={openInvestedInto}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              setOpenInvestedInto(newValue);
                              if (newValue && buyDates.length > 0) {
                                setOpenInvestedFrom(buyDates[0]); // default to first buy
                              } else {
                                setOpenInvestedFrom('');
                              }
                            }}
                            className="px-2 py-1.5 border border-gray-300 rounded text-xs max-w-[130px]"
                          >
                            <option value="">— None —</option>
                            {assetLookup
                              .filter(a => a.ticker !== openSelectedTicker)
                              .map(a => <option key={a.ticker} value={a.ticker}>{a.ticker}</option>)}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">Invested From</label>
                          <select
                            value={openInvestedFrom}
                            onChange={(e) => setOpenInvestedFrom(e.target.value)}
                            disabled={!openInvestedInto}
                            className={`px-2 py-1.5 border rounded text-xs min-w-[130px] ${
                              openInvestedInto ? 'border-gray-300' : 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                            }`}
                          >
                            {buyDates.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>

                        <div className="border-l border-gray-300 h-6 mx-1" />

                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">Graph Starts</label>
                          <select
                            value={openGraphStarts}
                            onChange={(e) => setOpenGraphStarts(e.target.value)}
                            className="px-2 py-1.5 border border-gray-300 rounded text-xs min-w-[130px]"
                          >
                            <option value="">— All —</option>
                            {graphStartsOptions.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">Graph Ends</label>
                          <select
                            value={openGraphEnds}
                            onChange={(e) => setOpenGraphEnds(e.target.value)}
                            className="px-2 py-1.5 border border-gray-300 rounded text-xs min-w-[130px]"
                          >
                            <option value="">— All —</option>
                            {graphEndsOptions.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Dashboard Stats Tiles */}
                      {stats && (
                        <div className="flex flex-wrap gap-3 mb-4 px-2">
                          <div className="flex-1 min-w-[180px] p-2 bg-gray-50 rounded-lg">
                            <div className="text-[11px] text-gray-500 mb-0.5">Holding & Return</div>
                            <div className="text-sm font-semibold text-gray-800">
                              {stats.holdingYears.toFixed(1)} yrs ({stats.holdingDays.toLocaleString()} days)
                              <span className="text-gray-300 mx-1">&middot;</span>
                              <span className={(stats.xirr ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}>
                                {stats.xirr !== null ? `XIRR ${stats.xirr >= 0 ? '+' : ''}${stats.xirr.toFixed(1)}%` : 'XIRR N/A'}
                              </span>
                            </div>
                          </div>

                          <div className="flex-1 min-w-[180px] p-2 bg-gray-50 rounded-lg">
                            <div className="text-[11px] text-gray-500 mb-0.5">Unrealized PnL</div>
                            <div className={`text-sm font-semibold ${stats.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {stats.totalPnL >= 0 ? '+' : ''}
                              {stats.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              {' '}({stats.totalPnLPct >= 0 ? '+' : ''}{stats.totalPnLPct.toFixed(1)}%)
                            </div>
                            <div className="text-[11px] text-gray-400">
                              {stats.totalInvested.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              {' → '}
                              {stats.currentValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              {stats.totalDividends > 0 && ` (+${stats.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} div)`}
                            </div>
                          </div>

                          {stats.currentPrice > 0 && (
                            <div className="flex-1 min-w-[180px] p-2 bg-gray-50 rounded-lg">
                              <div className="text-[11px] text-gray-500 mb-0.5">Current Position</div>
                              <div className="text-sm font-semibold text-gray-800">
                                {stats.currentPrice.toFixed(2)} × {stats.totalShares.toLocaleString()} shares
                              </div>
                              <div className="text-[11px] text-gray-400">
                                Value: {stats.currentValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                <span className="mx-1">·</span>
                                Adj Buy: {stats.adjAvgBuyPrice.toFixed(2)}
                              </div>
                            </div>
                          )}

                          {openInvestedInto && compGainBase !== null && compGainInvested !== null && (
                            <div className="flex-1 min-w-[200px] p-2 bg-gray-50 rounded-lg">
                              <div className="text-[11px] text-gray-500 mb-0.5">
                                {openSelectedTicker} vs {openInvestedInto}
                              </div>
                              <div className="text-sm font-semibold text-gray-800">
                                <span className={compGainBase >= 0 ? 'text-green-600' : 'text-red-600'}>
                                  {openSelectedTicker}: {compGainBase >= 0 ? '+' : ''}{compGainBase.toFixed(1)}%
                                </span>
                                {' vs '}
                                <span className={compGainInvested >= 0 ? 'text-green-600' : 'text-red-600'}>
                                  {openInvestedInto}: {compGainInvested >= 0 ? '+' : ''}{compGainInvested.toFixed(1)}%
                                </span>
                              </div>
                              <div className="text-[11px] text-gray-400">
                                {(() => {
                                  const diff = compGainInvested - compGainBase;
                                  if (diff > 0) return `${compAssetInfo?.name || openInvestedInto} outperformed by ${diff.toFixed(1)}pp`;
                                  if (diff < 0) return `${assetInfo?.name || openSelectedTicker} outperformed by ${Math.abs(diff).toFixed(1)}pp`;
                                  return 'Same performance';
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* The Price History chart */}
                      {chartData.length > 0 ? (
                        (() => {
                          const validPriceData = chartData.filter(d => d.price > 0);
                          const maxPricePoint = validPriceData.length > 0
                            ? validPriceData.reduce((best, d) => d.price > best.price ? d : best, validPriceData[0]) : null;
                          const minPricePoint = validPriceData.length > 0
                            ? validPriceData.reduce((worst, d) => d.price < worst.price ? d : worst, validPriceData[0]) : null;

                          let lastPrice: number | null = null;
                          let lastAvgBuyPrice: number | null = null;
                          let lastCompPrice: number | null = null;
                          const hasComp = !!(openInvestedInto && comparisonData.length > 0);
                          for (let i = mergedChartData.length - 1; i >= 0; i--) {
                            const d = mergedChartData[i];
                            if (lastPrice === null && d.price != null && d.price > 0) lastPrice = d.price;
                            if (lastAvgBuyPrice === null && d.avgBuyPrice != null && d.avgBuyPrice > 0) lastAvgBuyPrice = d.avgBuyPrice;
                            if (lastCompPrice === null && d.compPrice != null && d.compPrice > 0) lastCompPrice = d.compPrice;
                            if (lastPrice !== null && (lastAvgBuyPrice !== null || !openShowAvgBuy) && (lastCompPrice !== null || !hasComp)) break;
                          }

                          const priceBubbleDefs: BubbleDef[] = [];
                          if (lastPrice != null) priceBubbleDefs.push({ value: lastPrice, color: '#000000', label: lastPrice.toFixed(2) });
                          if (lastCompPrice != null && openInvestedInto) priceBubbleDefs.push({ value: lastCompPrice, color: '#F59E0B', label: lastCompPrice.toFixed(2) });
                          if (lastAvgBuyPrice != null && openShowAvgBuy) priceBubbleDefs.push({ value: lastAvgBuyPrice, color: '#22c55e', label: lastAvgBuyPrice.toFixed(2) });
                          const OpenPriceBubbles = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, priceBubbleDefs);

                          return (
                            <ResponsiveContainer width="100%" height={350}>
                              <LineChart data={mergedChartData} margin={{ top: 20, right: 70, left: -5, bottom: 15 }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="date" tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />} height={35} />
                                <YAxis tick={{ fontSize: 9 }} width={40} domain={['auto', 'auto']} />
                                <Tooltip formatter={(value: number, name: string) => value != null ? [value.toFixed(2), name] : ['-', name]} />
                                <Legend />
                                <Customized component={OpenPriceBubbles} />
                                <Line type="monotone" dataKey="price" name={openSelectedTicker} stroke="#000000" strokeWidth={2} dot={false} connectNulls />
                                {openInvestedInto && comparisonData.length > 0 && (
                                  <Line type="monotone" dataKey="compPrice" name={openInvestedInto} stroke="#F59E0B" strokeWidth={2} dot={false} strokeDasharray="5 3" connectNulls />
                                )}
                                {openShowAvgBuy && (
                                  <Line type="stepAfter" dataKey="avgBuyPrice" name="Avg Buy (Div Adj)" stroke="#22c55e" strokeWidth={1.5} dot={false} strokeDasharray="6 3" connectNulls />
                                )}
                                {maxPricePoint && (
                                  <ReferenceDot x={maxPricePoint.date} y={maxPricePoint.price} r={9} fill="#3b82f6" stroke="#fff" strokeWidth={2}
                                    label={{ value: maxPricePoint.price.toFixed(2), position: 'left', fontSize: 12, fill: '#111827', fontWeight: 600 }} />
                                )}
                                {minPricePoint && (
                                  <ReferenceDot x={minPricePoint.date} y={minPricePoint.price} r={9} fill="#eab308" stroke="#fff" strokeWidth={2}
                                    label={{ value: minPricePoint.price.toFixed(2), position: 'left', fontSize: 12, fill: '#111827', fontWeight: 600 }} />
                                )}
                                {buyDots.map((dot, i) => (
                                  <ReferenceDot key={`buy-${i}`} x={dot.date} y={dot.price} r={6} fill="#22c55e" stroke="#fff" strokeWidth={2} />
                                ))}
                              </LineChart>
                            </ResponsiveContainer>
                          );
                        })()
                      ) : (
                        <div className="text-center py-8 text-gray-400 text-sm">
                          No price data available for {openSelectedTicker} in the monthly prices sheet.
                        </div>
                      )}

                      <div className="mt-2 flex gap-4 text-xs text-gray-600">
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-full bg-green-500"></div>
                          <span>Buy month</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                          <span>Max price</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                          <span>Min price</span>
                        </div>
                      </div>
                    </div>

                    {/* --- Invested Capital Charts --- */}
                    {capitalChartData.length > 0 && stats && (
                      <div className="bg-white px-2 py-4 rounded-lg shadow mb-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-1 px-2">Invested Capital</h4>
                        <div className="text-sm text-gray-500 mb-3 px-2">
                          {stats.totalInvested.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} invested → now worth {stats.currentValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          {stats.totalDividends > 0 && ` (+${stats.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} div)`}
                          <span className="mx-1">·</span>
                          <span className={stats.totalPnL >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                            Unrealized {stats.totalPnL >= 0 ? 'Profit' : 'Loss'} of {stats.totalPnL >= 0 ? '+' : ''}{stats.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ({stats.totalPnLPct.toFixed(1)}%)
                          </span>
                        </div>

                        {(() => {
                          const allData = capitalChartData;
                          const maxMVPoint = allData.length > 0
                            ? allData.reduce((best, d) => d.marketValue > best.marketValue ? d : best, allData[0]) : null;
                          const sameSharesData = maxMVPoint
                            ? allData.filter(d => Math.abs(d.shares - maxMVPoint.shares) < 1e-9) : [];
                          const minMVPoint = sameSharesData.length > 0
                            ? sameSharesData.reduce((worst, d) => d.marketValue < worst.marketValue ? d : worst, sameSharesData[0]) : null;

                          const lastCapRow = capitalChartData[capitalChartData.length - 1];
                          const capitalBubbleDefs: BubbleDef[] = [];
                          if (lastCapRow) {
                            capitalBubbleDefs.push({ value: lastCapRow.marketValue, color: '#4F46E5', label: lastCapRow.marketValue.toLocaleString() });
                            capitalBubbleDefs.push({ value: lastCapRow.investedCapital, color: '#000000', label: lastCapRow.investedCapital.toLocaleString() });
                          }
                          const OpenCapitalBubbles = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, capitalBubbleDefs);

                          return (
                            <ResponsiveContainer width="100%" height={250}>
                              <AreaChart data={capitalChartData} margin={{ top: 20, right: 70, left: -5, bottom: 15 }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="date" tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />} height={35} />
                                <YAxis tick={{ fontSize: 9 }} width={40} />
                                <Tooltip formatter={(value: number, name: string) => value != null ? [value.toLocaleString(), name] : ['-', name]} />
                                <Legend />
                                <Customized component={OpenCapitalBubbles} />
                                <Area type="stepAfter" dataKey="investedCapital" name="Invested" stroke="#000000" fill="#000000" fillOpacity={0.08} strokeWidth={1.5} strokeDasharray="6 3" />
                                <Area type="monotone" dataKey="marketValue" name="Market Value" stroke="#4F46E5" fill="#4F46E5" fillOpacity={0.2} strokeWidth={2} />
                                {maxMVPoint && (
                                  <ReferenceDot x={maxMVPoint.date} y={maxMVPoint.marketValue} r={6} fill="#22c55e" stroke="#fff" strokeWidth={2}
                                    label={{ value: maxMVPoint.marketValue.toLocaleString(), position: 'left', fontSize: 12, fill: '#111827', fontWeight: 600 }} />
                                )}
                                {minMVPoint && (
                                  <ReferenceDot x={minMVPoint.date} y={minMVPoint.marketValue} r={6} fill="#ef4444" stroke="#fff" strokeWidth={2}
                                    label={{ value: minMVPoint.marketValue.toLocaleString(), position: 'left', fontSize: 12, fill: '#111827', fontWeight: 600 }} />
                                )}
                              </AreaChart>
                            </ResponsiveContainer>
                          );
                        })()}

                        {/* PnL chart */}
                        {(() => {
                          const pnlData = capitalChartData;
                          const maxPnLPoint = pnlData.length > 0 ? pnlData.reduce((best, d) => d.pnl > best.pnl ? d : best, pnlData[0]) : null;
                          const minPnLPoint = pnlData.length > 0 ? pnlData.reduce((worst, d) => d.pnl < worst.pnl ? d : worst, pnlData[0]) : null;
                          const maxPnLPct = maxPnLPoint && maxPnLPoint.investedCapital > 0 ? (maxPnLPoint.pnl / maxPnLPoint.investedCapital * 100) : null;
                          const minPnLPct = minPnLPoint && minPnLPoint.investedCapital > 0 ? (minPnLPoint.pnl / minPnLPoint.investedCapital * 100) : null;

                          const lastPnLRow = capitalChartData[capitalChartData.length - 1];
                          const lastPnL = lastPnLRow?.pnl ?? null;
                          const pnlBubbleDefs: BubbleDef[] = [];
                          if (lastPnL != null) {
                            pnlBubbleDefs.push({ value: lastPnL, color: lastPnL >= 0 ? '#22c55e' : '#ef4444', label: `${lastPnL >= 0 ? '+' : ''}${lastPnL.toLocaleString()}` });
                          }
                          const OpenPnLBubble = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, pnlBubbleDefs);

                          return (
                            <>
                              <h4 className="text-sm font-semibold text-gray-700 mt-4 mb-1 px-2">Unrealized Profit / Loss Over Time</h4>
                              <div className="text-sm text-gray-500 mb-3 px-2">
                                {minPnLPoint && (
                                  <span className="text-red-500 font-medium">
                                    Min {minPnLPoint.pnl >= 0 ? '+' : ''}{minPnLPoint.pnl.toLocaleString()}
                                    {minPnLPct !== null && ` (${minPnLPct >= 0 ? '+' : ''}${minPnLPct.toFixed(1)}%)`}
                                  </span>
                                )}
                                {minPnLPoint && maxPnLPoint && <span className="mx-1">·</span>}
                                {maxPnLPoint && (
                                  <span className="text-green-600 font-medium">
                                    Max {maxPnLPoint.pnl >= 0 ? '+' : ''}{maxPnLPoint.pnl.toLocaleString()}
                                    {maxPnLPct !== null && ` (${maxPnLPct >= 0 ? '+' : ''}${maxPnLPct.toFixed(1)}%)`}
                                  </span>
                                )}
                              </div>
                              <ResponsiveContainer width="100%" height={200}>
                                <AreaChart data={capitalChartData} margin={{ top: 5, right: 70, left: -5, bottom: 15 }}>
                                  <defs>
                                    <linearGradient id="openPnlGradient" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                                      <stop offset={`${(pnlZeroFraction * 100).toFixed(1)}%`} stopColor="#22c55e" stopOpacity={0.05} />
                                      <stop offset={`${(pnlZeroFraction * 100).toFixed(1)}%`} stopColor="#ef4444" stopOpacity={0.05} />
                                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.4} />
                                    </linearGradient>
                                    <linearGradient id="openPnlStrokeGradient" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor="#22c55e" />
                                      <stop offset={`${(pnlZeroFraction * 100).toFixed(1)}%`} stopColor="#22c55e" />
                                      <stop offset={`${(pnlZeroFraction * 100).toFixed(1)}%`} stopColor="#ef4444" />
                                      <stop offset="100%" stopColor="#ef4444" />
                                    </linearGradient>
                                  </defs>
                                  <CartesianGrid strokeDasharray="3 3" />
                                  <XAxis dataKey="date" tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />} height={35} />
                                  <YAxis tick={{ fontSize: 9 }} width={40} />
                                  <Tooltip formatter={(value: number) => value != null ? [`${value >= 0 ? '+' : ''}${value.toLocaleString()}`, 'PnL'] : ['-', 'PnL']} />
                                  <Customized component={OpenPnLBubble} />
                                  <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" strokeWidth={1} />
                                  <Area type="monotone" dataKey="pnl" name="PnL" stroke="url(#openPnlStrokeGradient)" fill="url(#openPnlGradient)" strokeWidth={2} />
                                  {maxPnLPoint && (
                                    <ReferenceDot x={maxPnLPoint.date} y={maxPnLPoint.pnl} r={6} fill="#22c55e" stroke="#fff" strokeWidth={2}
                                      label={{ value: `${maxPnLPoint.pnl >= 0 ? '+' : ''}${maxPnLPoint.pnl.toLocaleString()}`, position: 'left', fontSize: 12, fill: '#111827', fontWeight: 600 }} />
                                  )}
                                  {minPnLPoint && (
                                    <ReferenceDot x={minPnLPoint.date} y={minPnLPoint.pnl} r={6} fill="#ef4444" stroke="#fff" strokeWidth={2}
                                      label={{ value: `${minPnLPoint.pnl >= 0 ? '+' : ''}${minPnLPoint.pnl.toLocaleString()}`, position: 'left', fontSize: 12, fill: '#111827', fontWeight: 600 }} />
                                  )}
                                </AreaChart>
                              </ResponsiveContainer>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* --- CLOSED POSITION DETAIL VIEW (when a specific closed asset is drilled into) --- */}
              {closedSelectedTicker && (() => {
                // allTransactions = every row for this ticker (used by the table to show all rows)
                // filteredTransactions = only checked rows (used for sale dates dropdown)
                const allTransactions = getClosedTransactions(closedSelectedTicker);
                const filteredTransactions = getFilteredClosedTransactions(closedSelectedTicker);
                const assetInfo = assetLookup.find(a => a.ticker === closedSelectedTicker);
                const stats = getClosedDashboardStats(closedSelectedTicker);
                const { chartData, buyDots, sellDots } = getClosedChartData(closedSelectedTicker);
                const capitalChartData = getClosedCapitalChartData(closedSelectedTicker);

                // Pre-compute the zero-crossing fraction for the PnL gradient once,
                // rather than computing it twice inline within the SVG gradient defs.
                // zeroFraction = how far down from the chart's top the y=0 line sits (0 = top, 1 = bottom).
                const pnlZeroFraction = computePnlZeroFraction(capitalChartData);

                // Get sale dates from FILTERED transactions only (so dropdown matches checked rows)
                const saleDates = Array.from(new Set(filteredTransactions.map(t => t.divDate))).sort();

                // Build monthly date options for the "Graph Ends" dropdown:
                // from the last sale date through the last available data month
                const graphEndsOptions: string[] = (() => {
                  if (!assetData || saleDates.length === 0) return [];
                  const lastSale = saleDates[saleDates.length - 1];
                  const lastSaleD = new Date(lastSale);
                  if (isNaN(lastSaleD.getTime())) return [];
                  // Find all data months from the last sale onward
                  const lastSaleYMStr = toYM(lastSaleD);
                  const monthSet = new Set<string>();
                  for (const row of assetData) {
                    const d = new Date(row.date);
                    if (isNaN(d.getTime())) continue;
                    const ym = toYM(d);
                    if (ym >= lastSaleYMStr) monthSet.add(row.date);
                  }
                  return Array.from(monthSet).sort();
                })();

                // Build monthly date options for the "Graph Starts" dropdown:
                // from the first available data month up to (and including) the first buy date
                // Uses filtered transactions so it respects checkboxes
                const buyDates = Array.from(new Set(filteredTransactions.map(t => t.invDate))).sort();
                const graphStartsOptions: string[] = (() => {
                  if (!assetData || buyDates.length === 0) return [];
                  const firstBuy = buyDates[0];
                  const firstBuyD = new Date(firstBuy);
                  if (isNaN(firstBuyD.getTime())) return [];
                  const firstBuyYMStr = toYM(firstBuyD);
                  const monthSet = new Set<string>();
                  for (const row of assetData) {
                    const d = new Date(row.date);
                    if (isNaN(d.getTime())) continue;
                    const ym = toYM(d);
                    if (ym <= firstBuyYMStr) monthSet.add(row.date);
                  }
                  return Array.from(monthSet).sort();
                })();

                // Build comparison data if "Invested Into" is selected,
                // then filter it by the "Invested To" cutoff so both lines end at the same date
                const comparisonDataRaw = closedInvestedInto && closedInvestedFrom
                  ? getNormalizedComparisonData(closedSelectedTicker, closedInvestedInto, closedInvestedFrom)
                  : [];
                // Filter comparison data to respect both Graph Starts and Graph Ends
                const compGraphStartsYM = closedGraphStarts ? toYM(new Date(closedGraphStarts)) : '';
                const compGraphEndsYM = closedGraphEnds ? toYM(new Date(closedGraphEnds)) : '';
                const comparisonData = (compGraphStartsYM || compGraphEndsYM)
                  ? comparisonDataRaw.filter(c => {
                      const d = new Date(c.date);
                      if (isNaN(d.getTime())) return false;
                      const ym = toYM(d);
                      if (compGraphStartsYM && ym < compGraphStartsYM) return false;
                      if (compGraphEndsYM && ym > compGraphEndsYM) return false;
                      return true;
                    })
                  : comparisonDataRaw;

                // Merge chart data with comparison data for the LineChart (uses Map for O(N+M) instead of O(N*M))
                const mergedChartData = mergeComparisonData(chartData, comparisonData);

                // Compute comparison stats (how much each asset gained since the sale)
                let compGainBase: number | null = null;
                let compGainInvested: number | null = null;
                if (closedInvestedInto && closedInvestedFrom && assetData) {
                  const fromDate = new Date(closedInvestedFrom);
                  const fromYM = toYM(fromDate);
                  let basePriceAtSale = 0;
                  let compPriceAtSale = 0;
                  let baseCurrentPrice = 0;
                  let compCurrentPrice = 0;

                  for (const row of assetData) {
                    const rowDate = new Date(row.date);
                    const rowYM = toYM(rowDate);
                    const bp = Number(row[closedSelectedTicker]);
                    const cp = Number(row[closedInvestedInto]);
                    if (rowYM === fromYM) {
                      if (bp > 0) basePriceAtSale = bp;
                      if (cp > 0) compPriceAtSale = cp;
                    }
                    if (bp > 0) baseCurrentPrice = bp;
                    if (cp > 0) compCurrentPrice = cp;
                  }

                  if (basePriceAtSale > 0) compGainBase = ((baseCurrentPrice - basePriceAtSale) / basePriceAtSale) * 100;
                  if (compPriceAtSale > 0) compGainInvested = ((compCurrentPrice - compPriceAtSale) / compPriceAtSale) * 100;
                }

                const compAssetInfo = closedInvestedInto ? assetLookup.find(a => a.ticker === closedInvestedInto) : null;

                return (
                  <div>
                    {/* Back button and asset header */}
                    <div className="flex items-center gap-3 mb-4">
                      <button
                        onClick={() => { setClosedSelectedTicker(''); setClosedIncludedTxns(null); }}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 flex items-center gap-1"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        Back to list
                      </button>
                      <h3 className="text-lg font-semibold text-gray-800">
                        {closedSelectedTicker} — {assetInfo?.name || 'Unknown'}
                      </h3>
                    </div>

                    {/* --- Transaction Table --- */}
                    <div className="bg-white p-4 rounded-lg shadow mb-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">Transactions</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <th className="text-center py-1.5 px-2 bg-gray-50 w-8">
                                <input
                                  ref={closedSelectAllRef}
                                  type="checkbox"
                                  checked={closedIncludedTxns === null || closedIncludedTxns.size === allTransactions.length}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setClosedIncludedTxns(null); // all included
                                    } else {
                                      setClosedIncludedTxns(new Set()); // none included
                                    }
                                  }}
                                  className="rounded border-gray-300 cursor-pointer"
                                  title="Include/exclude all transactions from stats and chart"
                                />
                              </th>
                              <th className="text-left py-1.5 px-2 bg-gray-50">Inv Date</th>
                              <th className="text-left py-1.5 px-2 bg-gray-50">Div Date</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Hold (D)</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Hold (Y)</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Shares</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Buy Price</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Buy Comm.</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Initial Cost</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Sell Price</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Sell Comm.</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Value After Fee</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Cum. Div</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Tax</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Final Net Value</th>
                              <th className="text-right py-1.5 px-2 bg-gray-100">Total Return</th>
                              <th className="text-right py-1.5 px-2 bg-gray-100">Return %</th>
                              <th className="text-right py-1.5 px-2 bg-gray-100">CAGR</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allTransactions.map((t, idx) => (
                              <tr key={idx} className={`border-b border-gray-50 ${closedIncludedTxns !== null && !closedIncludedTxns.has(idx) ? 'opacity-40' : idx % 2 === 0 ? '' : 'bg-gray-25'}`}>
                                <td className="text-center py-1.5 px-2">
                                  <input
                                    type="checkbox"
                                    checked={closedIncludedTxns === null || closedIncludedTxns.has(idx)}
                                    onChange={(e) => {
                                      if (closedIncludedTxns === null) {
                                        // Transitioning from "all included" (null) to explicit set:
                                        // Build a set with all indices, then remove the unchecked one
                                        const allIndices = new Set(allTransactions.map((_, i) => i));
                                        allIndices.delete(idx);
                                        setClosedIncludedTxns(allIndices);
                                      } else {
                                        const next = new Set(closedIncludedTxns);
                                        if (e.target.checked) {
                                          next.add(idx);
                                          // If all are now included, collapse back to null for simplicity
                                          setClosedIncludedTxns(next.size === allTransactions.length ? null : next);
                                        } else {
                                          next.delete(idx);
                                          setClosedIncludedTxns(next);
                                        }
                                      }
                                    }}
                                    className="rounded border-gray-300 cursor-pointer"
                                  />
                                </td>
                                <td className="py-1.5 px-2 font-mono">{t.invDate}</td>
                                <td className="py-1.5 px-2 font-mono">{t.divDate}</td>
                                <td className="text-right py-1.5 px-2">{t.holdingPeriodDays}</td>
                                <td className="text-right py-1.5 px-2">{t.holdingPeriodYears.toFixed(1)}</td>
                                <td className="text-right py-1.5 px-2">{t.sharesSold.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                                <td className="text-right py-1.5 px-2 font-mono">{t.buyPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="text-right py-1.5 px-2 font-mono">{t.buyCommission.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                <td className="text-right py-1.5 px-2 font-mono">{t.initialCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                <td className="text-right py-1.5 px-2 font-mono">{t.sellPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="text-right py-1.5 px-2 font-mono">{t.sellCommission.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                <td className="text-right py-1.5 px-2 font-mono">{t.valueAfterFee.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                <td className="text-right py-1.5 px-2 font-mono">{t.cumDividend.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                <td className="text-right py-1.5 px-2 font-mono">{t.totalTax.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                <td className="text-right py-1.5 px-2 font-mono">{t.finalNetValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                <td className={`text-right py-1.5 px-2 font-mono font-medium ${t.totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {t.totalReturn >= 0 ? '+' : ''}{t.totalReturn.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </td>
                                <td className={`text-right py-1.5 px-2 font-mono font-medium ${t.totalReturnPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {t.totalReturnPct >= 0 ? '+' : ''}{t.totalReturnPct.toFixed(1)}%
                                </td>
                                <td className={`text-right py-1.5 px-2 font-mono font-medium ${t.cagr >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {t.cagr >= 0 ? '+' : ''}{t.cagr.toFixed(1)}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          {/* --- Summary Row (uses only checked/filtered transactions) --- */}
                          {filteredTransactions.length > 0 && (() => {
                            // Compute summary stats from the checked transactions only
                            const sumShares = filteredTransactions.reduce((s, t) => s + t.sharesSold, 0);
                            const sumCost = filteredTransactions.reduce((s, t) => s + t.initialCost, 0);
                            const sumBuyComm = filteredTransactions.reduce((s, t) => s + t.buyCommission, 0);
                            const sumSellComm = filteredTransactions.reduce((s, t) => s + t.sellCommission, 0);
                            const sumValueAfterFee = filteredTransactions.reduce((s, t) => s + t.valueAfterFee, 0);
                            const sumCumDiv = filteredTransactions.reduce((s, t) => s + t.cumDividend, 0);
                            const sumTax = filteredTransactions.reduce((s, t) => s + t.totalTax, 0);
                            const sumFinalNet = filteredTransactions.reduce((s, t) => s + t.finalNetValue, 0);
                            const sumReturn = sumFinalNet - sumCost;
                            const sumReturnPct = sumCost > 0 ? (sumReturn / sumCost) * 100 : 0;
                            // Weighted average buy price (includes commission = true cost basis per share)
                            const wAvgBuy = sumShares > 0 ? sumCost / sumShares : 0;
                            // Weighted average sell price (weighted by shares in each transaction)
                            const wAvgSell = sumShares > 0
                              ? filteredTransactions.reduce((s, t) => s + t.sellPrice * t.sharesSold, 0) / sumShares
                              : 0;
                            // Max holding days/years across the checked transactions
                            const maxDays = Math.max(...filteredTransactions.map(t => t.holdingPeriodDays));
                            const maxYears = maxDays / 365.25;
                            // XIRR across all checked transactions (cumulative CAGR)
                            const cashFlows = filteredTransactions.flatMap(t => [
                              { date: new Date(t.invDate), amount: -t.initialCost },
                              { date: new Date(t.divDate), amount: t.finalNetValue },
                            ]).sort((a, b) => a.date.getTime() - b.date.getTime());
                            const xirr = calculateXIRR(cashFlows);

                            return (
                              <tfoot>
                                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                                  {/* Checkbox column — empty */}
                                  <td className="py-2 px-2"></td>
                                  {/* Inv Date — label */}
                                  <td className="py-2 px-2 text-left text-gray-700" colSpan={2}>Summary</td>
                                  {/* Hold (D) — max */}
                                  <td className="text-right py-2 px-2 font-mono">{maxDays.toLocaleString()}</td>
                                  {/* Hold (Y) — max */}
                                  <td className="text-right py-2 px-2 font-mono">{maxYears.toFixed(1)}</td>
                                  {/* Shares — cumulative */}
                                  <td className="text-right py-2 px-2 font-mono">{sumShares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                                  {/* Buy Price — weighted avg */}
                                  <td className="text-right py-2 px-2 font-mono">{wAvgBuy.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  {/* Buy Comm. — cumulative + basis points vs invested amount (shares × buyPrice, excl. commission) */}
                                  <td className="text-right py-2 px-2 font-mono">
                                    {sumBuyComm.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    {(sumCost - sumBuyComm) > 0 && <span className="text-gray-400 text-[10px] ml-0.5">({Math.round(sumBuyComm / (sumCost - sumBuyComm) * 10000)}bps)</span>}
                                  </td>
                                  {/* Initial Cost — cumulative */}
                                  <td className="text-right py-2 px-2 font-mono">{sumCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  {/* Sell Price — weighted avg */}
                                  <td className="text-right py-2 px-2 font-mono">{wAvgSell.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  {/* Sell Comm. — cumulative + basis points vs gross sale proceeds */}
                                  <td className="text-right py-2 px-2 font-mono">
                                    {sumSellComm.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    {(sumValueAfterFee + sumSellComm) > 0 && <span className="text-gray-400 text-[10px] ml-0.5">({Math.round(sumSellComm / (sumValueAfterFee + sumSellComm) * 10000)}bps)</span>}
                                  </td>
                                  {/* Value After Fee — cumulative */}
                                  <td className="text-right py-2 px-2 font-mono">{sumValueAfterFee.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  {/* Cum. Div — cumulative */}
                                  <td className="text-right py-2 px-2 font-mono">{sumCumDiv.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  {/* Tax — cumulative */}
                                  <td className="text-right py-2 px-2 font-mono">{sumTax.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  {/* Final Net Value — cumulative */}
                                  <td className="text-right py-2 px-2 font-mono">{sumFinalNet.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  {/* Total Return — cumulative */}
                                  <td className={`text-right py-2 px-2 font-mono ${sumReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {sumReturn >= 0 ? '+' : ''}{sumReturn.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                  </td>
                                  {/* Return % — cumulative */}
                                  <td className={`text-right py-2 px-2 font-mono ${sumReturnPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {sumReturnPct >= 0 ? '+' : ''}{sumReturnPct.toFixed(1)}%
                                  </td>
                                  {/* CAGR — XIRR */}
                                  <td className={`text-right py-2 px-2 font-mono ${xirr !== null && xirr >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {xirr !== null ? `${xirr >= 0 ? '+' : ''}${xirr.toFixed(1)}%` : '—'}
                                  </td>
                                </tr>
                              </tfoot>
                            );
                          })()}
                        </table>
                      </div>
                    </div>

                    {/* --- Performance Chart --- */}
                    <div className="bg-white px-2 py-4 rounded-lg shadow mb-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3 px-2">Price History</h4>

                      {/* Chart controls: toggles and Invested Into / From */}
                      <div className="flex flex-wrap items-end gap-4 mb-4 px-2">
                        {/* Since Invested toggle */}
                        <button
                          onClick={() => setClosedSinceInvested(!closedSinceInvested)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                            closedSinceInvested
                              ? 'bg-blue-500 text-white border-blue-500'
                              : 'bg-white border-gray-300 hover:bg-gray-100'
                          }`}
                        >
                          Since Invested
                        </button>

                        {/* Until Sold toggle */}
                        <button
                          onClick={() => setClosedUntilSold(!closedUntilSold)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                            closedUntilSold
                              ? 'bg-blue-500 text-white border-blue-500'
                              : 'bg-white border-gray-300 hover:bg-gray-100'
                          }`}
                        >
                          Until Sold
                        </button>

                        {/* Avg Buy Price toggle — shows/hides the green dashed avg buy line */}
                        <button
                          onClick={() => setClosedShowAvgBuy(!closedShowAvgBuy)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                            closedShowAvgBuy
                              ? 'bg-green-500 text-white border-green-500'
                              : 'bg-white border-gray-300 hover:bg-gray-100'
                          }`}
                        >
                          Avg Buy
                        </button>

                        {/* Avg Sell Price toggle — shows/hides the red dashed avg sell line */}
                        <button
                          onClick={() => setClosedShowAvgSell(!closedShowAvgSell)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                            closedShowAvgSell
                              ? 'bg-red-500 text-white border-red-500'
                              : 'bg-white border-gray-300 hover:bg-gray-100'
                          }`}
                        >
                          Avg Sell
                        </button>

                        <div className="border-l border-gray-300 h-6 mx-1" />

                        {/* Invested Into dropdown */}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">Invested Into</label>
                          <select
                            value={closedInvestedInto}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              setClosedInvestedInto(newValue);
                              // Auto-set "Invested From" to last sale date when a comparison is selected
                              if (newValue && saleDates.length > 0) {
                                setClosedInvestedFrom(saleDates[saleDates.length - 1]);
                              } else {
                                setClosedInvestedFrom('');
                              }
                            }}
                            className="px-2 py-1.5 border border-gray-300 rounded text-xs max-w-[130px]"
                          >
                            <option value="">— None —</option>
                            {assetLookup
                              .filter(a => a.ticker !== closedSelectedTicker)
                              .map(a => (
                                <option key={a.ticker} value={a.ticker}>{a.ticker}</option>
                              ))}
                          </select>
                        </div>

                        {/* Asset 2 Invested From dropdown (only enabled when Invested Into is selected) */}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">Asset 2 Invested From</label>
                          <select
                            value={closedInvestedFrom}
                            onChange={(e) => setClosedInvestedFrom(e.target.value)}
                            disabled={!closedInvestedInto}
                            className={`px-2 py-1.5 border rounded text-xs min-w-[130px] ${
                              closedInvestedInto ? 'border-gray-300' : 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                            }`}
                          >
                            {saleDates.map(d => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        </div>

                        <div className="border-l border-gray-300 h-6 mx-1" />

                        {/* Graph Starts dropdown: pick a start date from first available data up to first buy */}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">Graph Starts</label>
                          <select
                            value={closedGraphStarts}
                            onChange={(e) => setClosedGraphStarts(e.target.value)}
                            className="px-2 py-1.5 border border-gray-300 rounded text-xs min-w-[130px]"
                          >
                            <option value="">— All —</option>
                            {graphStartsOptions.map(d => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        </div>

                        {/* Graph Ends dropdown: pick an end date from last sale onward */}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">Graph Ends</label>
                          <select
                            value={closedGraphEnds}
                            onChange={(e) => setClosedGraphEnds(e.target.value)}
                            className="px-2 py-1.5 border border-gray-300 rounded text-xs min-w-[130px]"
                          >
                            <option value="">— All —</option>
                            {graphEndsOptions.map(d => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* --- Compact Summary Statistics (inline above chart) --- */}
                      {stats && (
                        <div className="flex flex-wrap gap-3 mb-4 px-2">

                          {/* Tile 1: Holding Time + XIRR — how long and what annualized return */}
                          <div className="flex-1 min-w-[180px] p-2 bg-gray-50 rounded-lg">
                            <div className="text-[11px] text-gray-500 mb-0.5">Holding & Return</div>
                            <div className="text-sm font-semibold text-gray-800">
                              {stats.holdingYears.toFixed(1)} yrs ({stats.holdingDays.toLocaleString()} days)
                              <span className="text-gray-300 mx-1">&middot;</span>
                              <span className={(stats.xirr ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}>
                                {stats.xirr !== null
                                  ? `XIRR ${stats.xirr >= 0 ? '+' : ''}${stats.xirr.toFixed(1)}%`
                                  : 'XIRR N/A'}
                              </span>
                            </div>
                          </div>

                          {/* Tile 2: Total PnL — profit/loss with invested → sold breakdown */}
                          <div className="flex-1 min-w-[180px] p-2 bg-gray-50 rounded-lg">
                            <div className="text-[11px] text-gray-500 mb-0.5">Total PnL</div>
                            <div className={`text-sm font-semibold ${stats.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {stats.totalPnL >= 0 ? '+' : ''}
                              {stats.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              {' '}({stats.totalPnLPct >= 0 ? '+' : ''}{stats.totalPnLPct.toFixed(1)}%)
                            </div>
                            <div className="text-[11px] text-gray-400">
                              {stats.totalCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              {' → '}
                              {stats.totalFinalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </div>
                          </div>

                          {/* Tile 3: Current vs Sold + If Not Sold — price comparison & unrealized */}
                          {stats.currentPrice > 0 && (
                            <div className="flex-1 min-w-[220px] p-2 bg-gray-50 rounded-lg">
                              <div className="text-[11px] text-gray-500 mb-0.5">Current vs Sold</div>
                              <div className="text-sm font-semibold text-gray-800">
                                Now {stats.currentPrice.toFixed(2)} vs avg {stats.weightedSellPrice.toFixed(2)}
                                <span className="text-gray-300 mx-1">&middot;</span>
                                <span className={stats.priceVsSoldPct >= 0 ? 'text-red-600' : 'text-green-600'}>
                                  {stats.priceVsSoldPct >= 0 ? '+' : ''}{stats.priceVsSoldPct.toFixed(1)}%
                                </span>
                              </div>
                              <div className="text-[11px] text-gray-400">
                                {stats.ifNotSold.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                {' vs '}
                                {stats.totalFinalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                {' sold '}
                                {(() => {
                                  const unrealized = stats.ifNotSold - stats.totalFinalValue;
                                  return (
                                    <span className={unrealized >= 0 ? 'text-red-500' : 'text-green-500'}>
                                      ({unrealized >= 0 ? '+' : ''}
                                      {unrealized.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                      {' unrealized'})
                                    </span>
                                  );
                                })()}
                              </div>
                            </div>
                          )}

                          {/* Tile 4: Asset vs comparison asset (only when "Invested Into" is active) */}
                          {closedInvestedInto && compGainBase !== null && compGainInvested !== null && (
                            <div className="flex-1 min-w-[200px] p-2 bg-gray-50 rounded-lg">
                              <div className="text-[11px] text-gray-500 mb-0.5">
                                {closedSelectedTicker} vs {closedInvestedInto}
                              </div>
                              <div className="text-sm font-semibold text-gray-800">
                                <span className={compGainBase >= 0 ? 'text-green-600' : 'text-red-600'}>
                                  {closedSelectedTicker}: {compGainBase >= 0 ? '+' : ''}{compGainBase.toFixed(1)}%
                                </span>
                                {' vs '}
                                <span className={compGainInvested >= 0 ? 'text-green-600' : 'text-red-600'}>
                                  {closedInvestedInto}: {compGainInvested >= 0 ? '+' : ''}{compGainInvested.toFixed(1)}%
                                </span>
                              </div>
                              <div className="text-[11px] text-gray-400">
                                {(() => {
                                  const diff = compGainInvested - compGainBase;
                                  if (diff > 0) return `${compAssetInfo?.name || closedInvestedInto} outperformed by ${diff.toFixed(1)}pp`;
                                  if (diff < 0) return `${assetInfo?.name || closedSelectedTicker} would have outperformed by ${Math.abs(diff).toFixed(1)}pp`;
                                  return 'Same performance';
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* The chart itself */}
                      {chartData.length > 0 ? (
                        (() => {
                          // Compute highest and lowest price points from the filtered chart data
                          const validPriceData = chartData.filter(d => d.price > 0);
                          const maxPricePoint = validPriceData.length > 0
                            ? validPriceData.reduce((best, d) => d.price > best.price ? d : best, validPriceData[0])
                            : null;
                          const minPricePoint = validPriceData.length > 0
                            ? validPriceData.reduce((worst, d) => d.price < worst.price ? d : worst, validPriceData[0])
                            : null;

                          // Find the last valid values by walking backwards. The last entry may
                          // be a comparison-only point (no price), so we can't just grab the
                          // last element. A backward loop avoids creating temporary array copies.
                          // We track which values we still need so we can break early even when
                          // some data series don't exist (e.g. no comparison asset selected).
                          let lastPrice: number | null = null;
                          let lastAvgBuyPrice: number | null = null;
                          let lastAvgSellPrice: number | null = null;
                          let lastCompPrice: number | null = null;
                          const hasComp = !!(closedInvestedInto && comparisonData.length > 0);
                          for (let i = mergedChartData.length - 1; i >= 0; i--) {
                            const d = mergedChartData[i];
                            if (lastPrice === null && d.price != null && d.price > 0) lastPrice = d.price;
                            if (lastAvgBuyPrice === null && d.avgBuyPrice != null && d.avgBuyPrice > 0) lastAvgBuyPrice = d.avgBuyPrice;
                            if (lastAvgSellPrice === null && d.avgSellPrice != null && d.avgSellPrice > 0) lastAvgSellPrice = d.avgSellPrice;
                            if (lastCompPrice === null && d.compPrice != null && d.compPrice > 0) lastCompPrice = d.compPrice;
                            // Break early once we've found all values that can possibly exist
                            if (lastPrice !== null
                              && (lastAvgBuyPrice !== null || !closedShowAvgBuy)
                              && (lastAvgSellPrice !== null || !closedShowAvgSell)
                              && (lastCompPrice !== null || !hasComp)) break;
                          }

                          /* Bubble definitions for the Price History chart. Defined here (inside
                             the IIFE) so we can close over the last-value variables. Recharts'
                             Customized doesn't support custom props, so closure is the cleanest
                             approach. All rendering is delegated to the shared renderEdgeBubbles. */
                          const priceBubbleDefs: BubbleDef[] = [];
                          if (lastPrice != null) priceBubbleDefs.push({ value: lastPrice, color: '#000000', label: lastPrice.toFixed(2) });
                          // Only show comparison bubble when the comparison line is actually visible
                          if (lastCompPrice != null && closedInvestedInto) priceBubbleDefs.push({ value: lastCompPrice, color: '#F59E0B', label: lastCompPrice.toFixed(2) });
                          if (lastAvgBuyPrice != null && closedShowAvgBuy) priceBubbleDefs.push({ value: lastAvgBuyPrice, color: '#22c55e', label: lastAvgBuyPrice.toFixed(2) });
                          if (lastAvgSellPrice != null && closedShowAvgSell) priceBubbleDefs.push({ value: lastAvgSellPrice, color: '#ef4444', label: lastAvgSellPrice.toFixed(2) });
                          const PriceBubbles = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, priceBubbleDefs);

                          return (
                        <ResponsiveContainer width="100%" height={350}>
                          {/* Right margin widened to 70 to make room for the right-edge bubbles */}
                          <LineChart data={mergedChartData} margin={{ top: 20, right: 70, left: -5, bottom: 15 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />} height={35} />
                            <YAxis tick={{ fontSize: 9 }} width={40} domain={['auto', 'auto']} />
                            <Tooltip
                              formatter={(value: number, name: string) => {
                                if (value === undefined || value === null) return ['-', name];
                                return [value.toFixed(2), name];
                              }}
                            />
                            <Legend />
                            {/* Bubbles at the right edge showing latest price, comparison, avg buy & avg sell */}
                            <Customized component={PriceBubbles} />
                            {/* Main asset price line (black) */}
                            <Line
                              type="monotone"
                              dataKey="price"
                              name={closedSelectedTicker}
                              stroke="#000000"
                              strokeWidth={2}
                              dot={false}
                              connectNulls
                            />
                            {/* Comparison asset line (only when "Invested Into" is active) */}
                            {closedInvestedInto && comparisonData.length > 0 && (
                              <Line
                                type="monotone"
                                dataKey="compPrice"
                                name={closedInvestedInto}
                                stroke="#F59E0B"
                                strokeWidth={2}
                                dot={false}
                                strokeDasharray="5 3"
                                connectNulls
                              />
                            )}
                            {/* Dashed green line showing FIFO average buy price over time.
                                Steps up/down when new shares are bought or old ones sold.
                                Stops at last sale date. Only shown when toggle is enabled. */}
                            {closedShowAvgBuy && (
                              <Line
                                type="stepAfter"
                                dataKey="avgBuyPrice"
                                name="Avg Buy Price"
                                stroke="#22c55e"
                                strokeWidth={1.5}
                                dot={false}
                                strokeDasharray="6 3"
                                connectNulls
                              />
                            )}
                            {/* Dashed red line showing cumulative weighted avg sell price.
                                Starts at first sale date and continues to end of chart.
                                Only shown when toggle is enabled. */}
                            {closedShowAvgSell && (
                              <Line
                                type="stepAfter"
                                dataKey="avgSellPrice"
                                name="Avg Sell Price"
                                stroke="#ef4444"
                                strokeWidth={1.5}
                                dot={false}
                                strokeDasharray="6 3"
                                connectNulls
                              />
                            )}
                            {/* Max/min price dots render FIRST (behind) so buy/sell dots
                               appear on top when they overlap. Larger radius (r=9) creates
                               a visible ring around any overlapping buy/sell dot (r=6). */}
                            {/* Blue dot at highest price */}
                            {maxPricePoint && (
                              <ReferenceDot
                                x={maxPricePoint.date}
                                y={maxPricePoint.price}
                                r={9}
                                fill="#3b82f6"
                                stroke="#fff"
                                strokeWidth={2}
                                label={{
                                  value: maxPricePoint.price.toFixed(2),
                                  position: 'left',
                                  fontSize: 12,
                                  fill: '#111827',
                                  fontWeight: 600,
                                }}
                              />
                            )}
                            {/* Yellow dot at lowest price */}
                            {minPricePoint && (
                              <ReferenceDot
                                x={minPricePoint.date}
                                y={minPricePoint.price}
                                r={9}
                                fill="#eab308"
                                stroke="#fff"
                                strokeWidth={2}
                                label={{
                                  value: minPricePoint.price.toFixed(2),
                                  position: 'left',
                                  fontSize: 12,
                                  fill: '#111827',
                                  fontWeight: 600,
                                }}
                              />
                            )}
                            {/* Green dots for buy months (on top of max/min) */}
                            {buyDots.map((dot, i) => (
                              <ReferenceDot
                                key={`buy-${i}`}
                                x={dot.date}
                                y={dot.price}
                                r={6}
                                fill="#22c55e"
                                stroke="#fff"
                                strokeWidth={2}
                              />
                            ))}
                            {/* Red dots for sell months (on top of max/min) */}
                            {sellDots.map((dot, i) => (
                              <ReferenceDot
                                key={`sell-${i}`}
                                x={dot.date}
                                y={dot.price}
                                r={6}
                                fill="#ef4444"
                                stroke="#fff"
                                strokeWidth={2}
                              />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                          );
                        })()
                      ) : (
                        <div className="text-center py-8 text-gray-400 text-sm">
                          No price data available for {closedSelectedTicker} in the monthly prices sheet.
                        </div>
                      )}

                      {/* Chart legend for dots */}
                      <div className="mt-2 flex gap-4 text-xs text-gray-600">
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-full bg-green-500"></div>
                          <span>Buy month</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-full bg-red-500"></div>
                          <span>Sell month</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                          <span>Max price</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                          <span>Min price</span>
                        </div>
                      </div>
                    </div>

                    {/* --- Invested Capital Charts --- */}
                    {capitalChartData.length > 0 && stats && (
                      <div className="bg-white px-2 py-4 rounded-lg shadow mb-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-1 px-2">Invested Capital</h4>
                        <div className="text-sm text-gray-500 mb-3 px-2">
                          {stats.totalCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} invested → sold for {stats.totalFinalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          <span className="mx-1">·</span>
                          <span className={stats.totalPnL >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                            {stats.totalPnL >= 0 ? 'Profit' : 'Loss'} of {stats.totalPnL >= 0 ? '+' : ''}{stats.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ({stats.totalPnLPct >= 0 ? '+' : ''}{stats.totalPnLPct.toFixed(1)}%)
                          </span>
                        </div>

                        {/* --- Compute green (max) and red (min) market value dots ---
                           Green dot: the month with the highest market value.
                           Red dot: the month with the LOWEST market value, but only among
                           months where we held the same number of shares as the max-value month.
                           This avoids showing a misleading "min" from early on when we held
                           fewer shares (e.g. 100 shares vs 500 shares later). */}
                        {(() => {
                          // Include ALL data points (including the final sale month where shares=0)
                          // so that sale proceeds are considered for max/min market value
                          const allData = capitalChartData;
                          // Find the data point with the highest market value
                          const maxMVPoint = allData.length > 0
                            ? allData.reduce((best, d) => d.marketValue > best.marketValue ? d : best, allData[0])
                            : null;
                          // Among data points with the same share count as the max, find the lowest market value.
                          // This avoids showing a misleading "min" from early on when we held fewer shares.
                          const sameSharesData = maxMVPoint
                            ? allData.filter(d => Math.abs(d.shares - maxMVPoint.shares) < 1e-9)
                            : [];
                          const minMVPoint = sameSharesData.length > 0
                            ? sameSharesData.reduce((worst, d) => d.marketValue < worst.marketValue ? d : worst, sameSharesData[0])
                            : null;

                          // Last values for right-edge bubbles (all rows guaranteed numeric by getClosedCapitalChartData)
                          const lastCapRow = capitalChartData.length > 0 ? capitalChartData[capitalChartData.length - 1] : null;
                          const lastMV = lastCapRow?.marketValue ?? null;
                          const lastInvested = lastCapRow?.investedCapital ?? null;

                          // Build bubble defs and delegate to shared renderer
                          const capitalBubbleDefs: BubbleDef[] = [];
                          if (lastMV != null) capitalBubbleDefs.push({ value: lastMV, color: '#4F46E5', label: lastMV.toLocaleString() });
                          if (lastInvested != null) capitalBubbleDefs.push({ value: lastInvested, color: '#000000', label: lastInvested.toLocaleString() });
                          const CapitalBubbles = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, capitalBubbleDefs);

                          return (
                        <ResponsiveContainer width="100%" height={250}>
                          <AreaChart data={capitalChartData} margin={{ top: 20, right: 70, left: -5, bottom: 15 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />} height={35} />
                            <YAxis tick={{ fontSize: 9 }} width={40} />
                            <Tooltip
                              formatter={(value: number, name: string) => {
                                if (value === undefined || value === null) return ['-', name];
                                return [value.toLocaleString(), name];
                              }}
                            />
                            <Legend />
                            <Customized component={CapitalBubbles} />
                            <Area
                              type="stepAfter"
                              dataKey="investedCapital"
                              name="Invested"
                              stroke="#000000"
                              fill="#000000"
                              fillOpacity={0.08}
                              strokeWidth={1.5}
                              strokeDasharray="6 3"
                            />
                            <Area
                              type="monotone"
                              dataKey="marketValue"
                              name="Market Value"
                              stroke="#4F46E5"
                              fill="#4F46E5"
                              fillOpacity={0.2}
                              strokeWidth={2}
                            />
                            {/* Green dot at maximum market value */}
                            {maxMVPoint && (
                              <ReferenceDot
                                x={maxMVPoint.date}
                                y={maxMVPoint.marketValue}
                                r={6}
                                fill="#22c55e"
                                stroke="#fff"
                                strokeWidth={2}
                                label={{
                                  value: maxMVPoint.marketValue.toLocaleString(),
                                  position: 'left',
                                  fontSize: 12,
                                  fill: '#111827',
                                  fontWeight: 600,
                                }}
                              />
                            )}
                            {/* Red dot at minimum market value (same share count as max) */}
                            {minMVPoint && (
                              <ReferenceDot
                                x={minMVPoint.date}
                                y={minMVPoint.marketValue}
                                r={6}
                                fill="#ef4444"
                                stroke="#fff"
                                strokeWidth={2}
                                label={{
                                  value: minMVPoint.marketValue.toLocaleString(),
                                  position: 'left',
                                  fontSize: 12,
                                  fill: '#111827',
                                  fontWeight: 600,
                                }}
                              />
                            )}
                          </AreaChart>
                        </ResponsiveContainer>
                          );
                        })()}

                        {/* Chart 2: Cumulative PnL (green above 0, red below 0) */}
                        {/* --- Compute green (max profit) and red (max loss) dots for PnL chart ---
                           Green dot: the month with the highest profit (biggest positive PnL).
                           Red dot: the month with the biggest loss (most negative PnL).
                           No share-count filtering here — we show the actual best/worst PnL moments. */}
                        {(() => {
                          // Include ALL data points (including the final sale month)
                          // so that actual sale profit/loss is considered for max/min
                          const pnlData = capitalChartData;
                          // Find the point with the highest profit
                          const maxPnLPoint = pnlData.length > 0
                            ? pnlData.reduce((best, d) => d.pnl > best.pnl ? d : best, pnlData[0])
                            : null;
                          // Find the point with the biggest loss (lowest PnL)
                          const minPnLPoint = pnlData.length > 0
                            ? pnlData.reduce((worst, d) => d.pnl < worst.pnl ? d : worst, pnlData[0])
                            : null;
                          // Compute % return for max and min points (PnL / invested capital)
                          const maxPnLPct = maxPnLPoint && maxPnLPoint.investedCapital > 0
                            ? (maxPnLPoint.pnl / maxPnLPoint.investedCapital * 100)
                            : null;
                          const minPnLPct = minPnLPoint && minPnLPoint.investedCapital > 0
                            ? (minPnLPoint.pnl / minPnLPoint.investedCapital * 100)
                            : null;

                          // Last PnL value for right-edge bubble. Green if positive, red if negative.
                          const lastPnLRow = capitalChartData.length > 0 ? capitalChartData[capitalChartData.length - 1] : null;
                          const lastPnL = lastPnLRow?.pnl ?? null;

                          // Build bubble def and delegate to shared renderer
                          const pnlBubbleDefs: BubbleDef[] = [];
                          if (lastPnL != null) {
                            const color = lastPnL >= 0 ? '#22c55e' : '#ef4444';
                            pnlBubbleDefs.push({ value: lastPnL, color, label: `${lastPnL >= 0 ? '+' : ''}${lastPnL.toLocaleString()}` });
                          }
                          const PnLBubble = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, pnlBubbleDefs);

                          return (
                        <>
                        <h4 className="text-sm font-semibold text-gray-700 mt-4 mb-1 px-2">Unrealized Profit / Loss Over Time</h4>
                        <div className="text-sm text-gray-500 mb-3 px-2">
                          {/* Show max profit (green) and min/loss (red) aligned with the dot labels */}
                          {minPnLPoint && (
                            <span>
                              <span className="text-red-500 font-medium">
                                Min {minPnLPoint.pnl >= 0 ? '+' : ''}{minPnLPoint.pnl.toLocaleString()}
                                {minPnLPct !== null && ` (${minPnLPct >= 0 ? '+' : ''}${minPnLPct.toFixed(1)}%)`}
                              </span>
                            </span>
                          )}
                          {minPnLPoint && maxPnLPoint && <span className="mx-1">·</span>}
                          {maxPnLPoint && (
                            <span>
                              <span className="text-green-600 font-medium">
                                Max {maxPnLPoint.pnl >= 0 ? '+' : ''}{maxPnLPoint.pnl.toLocaleString()}
                                {maxPnLPct !== null && ` (${maxPnLPct >= 0 ? '+' : ''}${maxPnLPct.toFixed(1)}%)`}
                              </span>
                            </span>
                          )}
                        </div>
                        <ResponsiveContainer width="100%" height={200}>
                          <AreaChart data={capitalChartData} margin={{ top: 5, right: 70, left: -5, bottom: 15 }}>
                            <defs>
                              {/* Fill gradient: green above zero, red below zero (semi-transparent) */}
                              <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                                <stop offset={`${(pnlZeroFraction * 100).toFixed(1)}%`} stopColor="#22c55e" stopOpacity={0.05} />
                                <stop offset={`${(pnlZeroFraction * 100).toFixed(1)}%`} stopColor="#ef4444" stopOpacity={0.05} />
                                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.4} />
                              </linearGradient>
                              {/* Stroke gradient: green above zero, red below zero (solid line) */}
                              <linearGradient id="pnlStrokeGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#22c55e" />
                                <stop offset={`${(pnlZeroFraction * 100).toFixed(1)}%`} stopColor="#22c55e" />
                                <stop offset={`${(pnlZeroFraction * 100).toFixed(1)}%`} stopColor="#ef4444" />
                                <stop offset="100%" stopColor="#ef4444" />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />} height={35} />
                            <YAxis tick={{ fontSize: 9 }} width={40} />
                            <Tooltip
                              formatter={(value: number) => {
                                if (value === undefined || value === null) return ['-', 'PnL'];
                                return [`${value >= 0 ? '+' : ''}${value.toLocaleString()}`, 'PnL'];
                              }}
                            />
                            <Customized component={PnLBubble} />
                            <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" strokeWidth={1} />
                            <Area
                              type="monotone"
                              dataKey="pnl"
                              name="PnL"
                              stroke="url(#pnlStrokeGradient)"
                              fill="url(#pnlGradient)"
                              strokeWidth={2}
                            />
                            {/* Green dot at highest profit */}
                            {maxPnLPoint && (
                              <ReferenceDot
                                x={maxPnLPoint.date}
                                y={maxPnLPoint.pnl}
                                r={6}
                                fill="#22c55e"
                                stroke="#fff"
                                strokeWidth={2}
                                label={{
                                  value: `${maxPnLPoint.pnl >= 0 ? '+' : ''}${maxPnLPoint.pnl.toLocaleString()}`,
                                  position: 'left',
                                  fontSize: 12,
                                  fill: '#111827',
                                  fontWeight: 600,
                                }}
                              />
                            )}
                            {/* Red dot at biggest loss */}
                            {minPnLPoint && (
                              <ReferenceDot
                                x={minPnLPoint.date}
                                y={minPnLPoint.pnl}
                                r={6}
                                fill="#ef4444"
                                stroke="#fff"
                                strokeWidth={2}
                                label={{
                                  value: `${minPnLPoint.pnl >= 0 ? '+' : ''}${minPnLPoint.pnl.toLocaleString()}`,
                                  position: 'left',
                                  fontSize: 12,
                                  fill: '#111827',
                                  fontWeight: 600,
                                }}
                              />
                            )}
                          </AreaChart>
                        </ResponsiveContainer>
                        </>
                          );
                        })()}
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
