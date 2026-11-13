'use client';
/*
  PORTFOLIO BACKTESTER COMPONENT

  This is the main component that does all the heavy lifting: it loads every tab of the
  Google Sheet (lib/fetchData.ts) and draws every page of the app. The arithmetic for the
  bigger pages lives in lib/ (positions, cash, markets, holdings, edo); this file draws.

  The pages, in left-menu order (NAV_VIEWS, further down, is the authoritative list):
   - Backtest         build portfolios (or pick a preset from the sheet's Portfolios tab),
                      simulate them over history with rebalancing, compare stats and charts
   - Markets          one-screen market boards, one per SnapshotCategory in the Lookup tab,
                      each with a Returns and a Stats view; plus EDO (Polish inflation bonds,
                      lib/edo.ts), Country (one country's assets in its own currency) and
                      Holdings (what you own today, cash included, lib/holdings.ts)
   - Portfolio        your real portfolio over time: Daily NAV vs inflation and benchmarks,
                      returns and contributions by year, and each year's profit by asset
   - Positions        Open and Closed positions, rebuilt from the Transactions ledger
                      (lib/positions.ts), plus cash balances (lib/cash.ts)
   - Monthly          13 months of prices as a heatmap with 10-month SMA signals; click an
                      asset for its detail page (stats, charts, seasonality, vs market)
   - Annual           every asset's calendar-year returns
   - Best To Worst    one year's assets ranked (Ranking), or many years side by side (Return Map)
   - Graphs           a grid of price charts, one per asset
   - Trend Following  Buy & Hold vs a 10-month SMA timing rule, per asset
   - Correlations     correlation matrix, head-to-head pairs, and a risk/return scatter

  'use client' at the top tells Next.js this component needs to run
  in the browser (not on the server) because it uses:
  - useState/useEffect (React hooks for interactivity)
  - Charts (need the browser's canvas)
  - User interactions
*/

import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';

// Switches off chart animation app-wide: every chart draws instantly (see the file for why/how)
import '@/lib/noChartAnimation';
import { RefreshCw, Menu, X, FlaskConical, Globe, Briefcase, Layers, CalendarDays, CalendarRange, ArrowDownWideNarrow, LineChart as LineChartIcon, TrendingUp, Grid3x3, Moon, Sun, ChevronDown } from 'lucide-react';
import { fetchSheetData, SheetUnreachableError, localTodayIso, AssetRow, AssetLookup, YearsRow, ClosedPositionRow, TransactionRow, DailyNavRow, PresetPortfolio, FLOW_PURCHASE, FLOW_DIVIDEND, ParsedData, unitFeeQty } from '@/lib/fetchData';
import { isPhoneScreen, readSavedSheet, saveSheet } from '@/lib/savedSheet';
import { BottomSheet, PhoneCheckSheet, PhoneSelectSheets } from '@/components/PhoneSheet';
import { buildPositions, toTransactionRows, toClosedPositionRows, closedTickersFrom, PositionsModel } from '@/lib/positions';
import { buildCashAccounts, selectVisibleCash, CashAccountBalance } from '@/lib/cash';
import { buildReturnMatrix, buildCountryMatrix, snapshotCategories, MARKETS_COUNTRY, MarketsCurrency, MarketsPeriod } from '@/lib/markets';
import { buildHoldings, portfolioClassOf, MARKETS_HOLDINGS, HoldingsCurrency } from '@/lib/holdings';
// The one place CAGR / volatility / Sharpe / drawdown are defined, so every tab agrees.
// Sharpe is imported as `sharpeFor` because many functions here already have a local `sharpeRatio`.
import { sharpeRatio as sharpeFor } from '@/lib/stats';
// The backtest engine, its statistics and tables, and the currency conversion it uses
import {
  portfolioReturns, simulatePortfolio, calculateStatistics, calculateMonthlyReturns, FX_TICKER_MAP,
  type BacktestSettings, type PortfolioAsset, type Portfolio, type DateRange, type ReturnPoint,
  type BacktestResult, type RebalancingRow,
} from '@/lib/backtest';
import TrendFollowingTab from '@/components/tabs/TrendFollowingTab';
import CorrelationsTab from '@/components/tabs/CorrelationsTab';
import GraphsTab from '@/components/tabs/GraphsTab';
import AnnualReturnsTab from '@/components/tabs/AnnualReturnsTab';
import BestToWorstTab from '@/components/tabs/BestToWorstTab';
import MonthlyTab from '@/components/tabs/MonthlyTab';
import BacktestSetup from '@/components/tabs/BacktestSetup';
import BacktestResults from '@/components/tabs/BacktestResults';
import MarketsTab from '@/components/tabs/MarketsTab';
import HoldingsTab from '@/components/tabs/HoldingsTab';
import EdoTab from '@/components/tabs/EdoTab';
import PortfolioTab from '@/components/tabs/PortfolioTab';
// Calculations moved out of this file, each with tests in lib/
import { calculateXIRR } from '@/lib/xirr';
import { getYearlyValueSeries as yearlyValueSeries } from '@/lib/portfolioYears';
import { getYearlyProfitBreakdown as yearlyProfitBreakdown, type YearlyProfitBreakdown } from '@/lib/profitBreakdown';
import PositionsTab from '@/components/tabs/PositionsTab';
import AssetFilterControls, { type FilterBarProps } from '@/components/AssetFilterControls';
// The Positions tab's building blocks: tooltip, trade events and FIFO totals, tables, sorting
import {
  heldQty, nextTableSort, SortableTh, type TableSortMap,
} from '@/components/positionsParts';

// Fixed choices for the controls: date presets, currencies, CPI series, the FX-conversion tooltip
import {
  DATE_PRESETS, CURRENCY_SYMBOLS, CPI_OPTIONS, type DatePreset,
} from '@/components/options';
// Chart helpers shared by the tabs: ticks, edge bubbles, axis scales, return-chart periods...
import {
  ROLLING_RETURN_YEARS, STREAK_VIEWS, niceLogAxisScale, monthlyChartData, type MonthlyChartArgs as ChartArgs,
  type ReturnsChartPeriod, type PeriodicReturnsRow,
} from '@/components/charts';
import type { AssetsAnnualReturns } from '@/lib/assetStats';
import { toYM, MONTH_ABBR } from '@/lib/dates';
// The shared design system: colours, heat scale, button/field looks, chart helpers, tooltip texts
import {
  SERIES_COLORS, BLACK, MUTED, BTN_MAIN, BTN_SECOND, isDarkTheme, setPhoneBarColours, formatPrice,
  type MonthlyChartPeriod, ResponsiveContainer,
} from '@/components/ui';
import { EdoData, EDO_TICKER, MARKETS_EDO, edoWindowReturn, withEdoColumn, edoChainOnRows } from '@/lib/edo';

// ============================================
// UTILITY FUNCTIONS
// ============================================


// ============================================
// TYPE DEFINITIONS
// ============================================
// TypeScript interfaces describe the "shape" of our data.
// Think of them as blueprints that ensure we use data correctly.

// ============================================
// MAIN COMPONENT
// ============================================

// ---------------------------------------------------------------------------
// FX DATA SANITY CHECK
// ---------------------------------------------------------------------------
// The price sheet stores some exchange rates TWICE over. SGD/USD, for instance, is
// there as its own SGDUSD column and also implicitly as SGDPLN / USDPLN, because
// every conversion routes through PLN. Two roads to the same number means the sheet
// can be checked against itself: where the two roads disagree by more than rounding
// noise, one of those columns is wrong, and every value converted with it is junk.
//
// This matters because a bad FX column is invisible in the UI — the numbers still
// look like numbers. It shows up as a currency "move" that never happened.
//
// Each entry names a direct column and the two xxxPLN columns that should reproduce
// it. Add a row here if the sheet ever gains another redundant pair.
const FX_CROSS_CHECKS: { direct: string; numerator: string; denominator: string }[] = [
  { direct: 'SGDUSD', numerator: 'SGDPLN', denominator: 'USDPLN' },
];

// The published CSV carries rates as DISPLAYED in the sheet, i.e. rounded to 2
// decimals. On a number like 0.75 a single step is ~1.3%, so small gaps are normal
// and expected; only a gap well clear of that means the data is genuinely wrong.
//
// Why 3% and not something tighter: the check divides three separately sourced
// numbers, and each can sit ~1% away from another provider's rate purely because of
// when in the day it was sampled. Those differences compound, so the honest noise
// floor is around 2%. Verified against the NBP official fixing on 2026-08-02: at 2%
// this flagged two 2011-2012 rows whose columns were each within 1.6% of NBP — real
// data, false alarm. A permanently-lit warning is worse than none, because you learn
// to ignore it. 3% still catches genuine corruption by a mile (the SGDPLN column was
// out by 5-9% at year-ends, and up to 28.7% on individual rows).
const FX_CROSS_CHECK_TOLERANCE = 3; // percent

// A per-row tolerance alone isn't enough, because a single volatile day can breach any
// threshold honestly: on 2012-06-29 the zloty rallied hard through the afternoon, so a
// closing rate legitimately sits 1.6% from NBP's 11:00 fixing, and three such columns
// compound past 3%. Raising the tolerance until that goes quiet would just blind the
// check. Instead, only report failures that look SYSTEMATIC (a pattern across rows) or
// SEVERE (one row so far out it can't be a timing difference). Corrupt data trips both
// — the 12-month-shifted SGDPLN column failed 140 rows and peaked at 28.7%.
const FX_MIN_BAD_ROWS = 3;      // isolated one-off days are timing noise, not corruption
const FX_SEVERE_GAP = 10;       // percent — no sampling difference explains this

interface FxDataIssue {
  label: string;      // e.g. "SGDPLN / USDPLN vs SGDUSD"
  rows: number;       // how many rows disagree
  total: number;      // how many rows could be checked at all
  firstDate: string;  // first disagreeing row
  lastDate: string;   // last disagreeing row
  worstPct: number;   // largest disagreement seen, in %
}

/**
 * Runs every FX_CROSS_CHECKS entry over the price data and reports the failures.
 * A pure function of the data — no UI, no side effects — so it is easy to reason
 * about and cheap to re-run whenever the sheet reloads.
 *
 * Note it deliberately does NOT guess which of the two columns is at fault: the
 * sheet can only tell us they contradict each other, not which one is lying.
 */
const findFxDataIssues = (rows: AssetRow[] | null): FxDataIssue[] => {
  if (!rows || rows.length === 0) return [];
  const issues: FxDataIssue[] = [];

  for (const check of FX_CROSS_CHECKS) {
    let bad = 0, total = 0, worst = 0;
    let first = '', last = '';

    for (const row of rows) {
      const direct = Number(row[check.direct]);
      const numerator = Number(row[check.numerator]);
      const denominator = Number(row[check.denominator]);
      // Skip rows where any of the three is missing — a gap is not a contradiction
      if (!(direct > 0) || !(numerator > 0) || !(denominator > 0)) continue;
      total++;

      const gap = Math.abs((numerator / denominator) / direct - 1) * 100;
      if (gap > FX_CROSS_CHECK_TOLERANCE) {
        bad++;
        if (!first) first = row.date;
        last = row.date;
        if (gap > worst) worst = gap;
      }
    }

    // Only raise it if the failures are systematic or severe (see the constants above)
    if (bad >= FX_MIN_BAD_ROWS || worst > FX_SEVERE_GAP) {
      issues.push({
        label: `${check.numerator} / ${check.denominator} vs ${check.direct}`,
        rows: bad,
        total,
        firstDate: first,
        lastDate: last,
        worstPct: worst,
      });
    }
  }

  return issues;
};




const PortfolioBacktester = () => {
  // ----------------------------------------
  // STATE VARIABLES
  // ----------------------------------------
  // State = data that can change over time. When state changes, React re-renders the UI.

  // Data loading states
  const [isConnected, setIsConnected] = useState(false);      // Do we have data loaded?
  const [isLoading, setIsLoading] = useState(true);           // Are we currently loading?
  const [loadingMessage, setLoadingMessage] = useState('');   // Status message to show user
  // When the app last finished pulling the sheet successfully (shown at the bottom of the menu)
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);

  // The actual data
  const [assetData, setAssetData] = useState<AssetRow[] | null>(null);  // Historical price data
  const [availableAssets, setAvailableAssets] = useState<string[]>([]); // List of asset names
  const [presetPortfolios, setPresetPortfolios] = useState<PresetPortfolio[]>([]); // Ready-made portfolios (Portfolios sheet)
  // EDO bonds (EDO sheet): every series' terms and value grid. null until loaded, or if the tab failed.
  const [edoData, setEdoData] = useState<EdoData | null>(null);
  const [assetLookup, setAssetLookup] = useState<AssetLookup[]>([]);    // Lookup table (ticker -> name)

  // ---- The one place that knows some assets have no single price history ----
  // EDO's path depends on WHEN you buy it (lib/edo.ts): a window starting in 2015 holds the bond
  // sold then, not a slice of one chain begun in 2009. Every window calculation asks these instead
  // of special-casing EDO, so a new start-dependent asset — or a new window view — only needs
  // wiring here.
  //   isStartDependent(t)        does this ticker's price path depend on the window's start?
  //   windowPrices(t, start, end) the start/end prices of a window bought fresh at `start`, and
  //                               its return in % (use `ret`, not endPrice ÷ startPrice: the
  //                               division drifts in floating point, so 6.75 would print as 6.7):
  //                               undefined = an ordinary ticker (read its column as usual),
  //                               null = no price for that window.
  //   rowsForWindow(rows, tickers, start)  price rows with any start-dependent column among
  //                               `tickers` re-drawn from `start` (other rows/columns untouched).
  const isStartDependent = (ticker: string): boolean => ticker === EDO_TICKER && !!edoData;
  const windowPrices = (ticker: string, start: string, end: string): { startPrice: number; endPrice: number; ret: number } | null | undefined => {
    if (!isStartDependent(ticker)) return undefined;
    const r = edoWindowReturn(edoData!, start, end);
    return r === null ? null : { startPrice: 100, endPrice: 100 + r, ret: r };
  };
  const rowsForWindow = (rows: AssetRow[], tickers: string[], start: string): AssetRow[] =>
    (edoData && tickers.some(isStartDependent) ? withEdoColumn(rows, edoData, start) : rows);

  // Cross-check the sheet's FX columns against each other. Recomputed only when the
  // data actually reloads, not on every re-render (it walks every row).
  const fxDataIssues = useMemo(() => findFxDataIssues(assetData), [assetData]);
  // The months a table or chart can end at ("End month" on the Monthly and Graphs tabs): the last
  // date of each month in the data, newest first, labelled "Oct26"; "" = Latest. Shared by the
  // desktop dropdowns and the phone boxes, and worked out once per data load.
  const endMonthChoices = useMemo(() => {
    const monthMap = new Map<string, string>();
    for (const row of assetData ?? []) {
      const d = new Date(row.date);
      if (isNaN(d.getTime())) continue;
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      monthMap.set(ym, row.date); // last date wins (data is chronological)
    }
    return [{ value: '', label: 'Latest' }, ...Array.from(monthMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([, date]) => {
        const d = new Date(date);
        return { value: date, label: `${MONTH_ABBR[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(-2)}` };
      })];
  }, [assetData]);
  const [fxWarningDismissed, setFxWarningDismissed] = useState(false);  // hide the banner for this session

  // Portfolio configurations - start with one empty portfolio
  const [portfolios, setPortfolios] = useState<Portfolio[]>([
    { id: 1, name: 'Portfolio 1', assets: [], color: BLACK, nameManuallyEdited: false, inflationAdj: '', baseCurrency: '' }
  ]);

  // Raw text the user is currently typing into the weight / cost boxes, keyed by "portfolioId:assetIndex:field".
  // WHY THIS EXISTS: those boxes are "controlled" — React overwrites them with the stored number on every
  // keystroke. The instant you type a lone "-" (or "1." ), that isn't a valid number yet, so it would snap
  // back to 0 and you could never finish typing "-100". Keeping the raw text here lets the half-typed value
  // sit on screen while the parsed number goes into the portfolio. Cleared when the box loses focus.
  const [numDrafts, setNumDrafts] = useState<{ [key: string]: string }>({});

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

  // Which page is open (the left menu, NAV_VIEWS, lists them in order):
  // 'backtest' = show the portfolio configuration and backtest results
  // 'markets' = market boards from the Lookup tab's Snapshot columns, plus the EDO, Country and Holdings pages
  // 'portfolio' = your real portfolio: Daily NAV, returns by year, profit breakdown
  // 'positions' = Open and Closed positions from the Transactions ledger, plus cash balances
  // 'monthlyPrices' = show monthly price heatmap with SMA signals
  // 'annualReturns' = show a table of yearly returns for all assets in the lookup table
  // 'bestToWorst' = assets ranked by return for a selected year (Ranking), or across years (Return Map)
  // 'graphs' = a grid of price charts, one per asset
  // 'trendFollowing' = compare Buy & Hold vs 10-month SMA trend following strategy
  // 'correlationMatrix' = correlation matrix, head-to-head pairs and the risk/return scatter
  const [activeView, setActiveView] = useState<'backtest' | 'markets' | 'annualReturns' | 'bestToWorst' | 'monthlyPrices' | 'graphs' | 'trendFollowing' | 'correlationMatrix' | 'portfolio' | 'positions'>('backtest');
  // Narrow screens only: is the slide-in navigation drawer open? (Wide screens show the sidebar.)
  const [navOpen, setNavOpen] = useState(false);
  // Phones only: is the slide-up list of the open page's sections open? (Tapping the page's name
  // at the top, "Markets · Equities ▾", opens it.)
  const [sectionSheetOpen, setSectionSheetOpen] = useState(false);
  // Dark mode on/off. Starts as light; the real value is read from <html> once the page is in the
  // browser (app/layout.tsx may already have switched it to dark from the saved choice).
  const [darkMode, setDarkMode] = useState(false);
  useEffect(() => { setDarkMode(isDarkTheme()); setPhoneBarColours(isDarkTheme()); }, []);
  // The left-panel button: flip the class on <html> (which switches app/dark.css on or off),
  // remember the choice for next time, and re-render so the computed heatmap colours update too.
  // Reads the current mode from <html> itself, not from the state above, so a click right after
  // loading (before the state has caught up) still goes the right way.
  const toggleDarkMode = () => {
    const next = !isDarkTheme();
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch { /* private window: just don't remember */ }
    setPhoneBarColours(next);
    setDarkMode(next);
  };
  // Escape closes the drawer, as it would any pop-over. The listener only exists while it's open.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

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
  const [bestToWorstMode, setBestToWorstMode] = useState<'year' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10>('year');

  // Best To Worst "Return Map" — years laid side by side, each column ranked best (top) to worst (bottom).
  // layout: 'ranking' = the original single-year table, 'map' = the multi-year return map
  const [bestToWorstLayout, setBestToWorstLayout] = useState<'ranking' | 'map'>('ranking');
  // How many of the most recent years the map shows
  const [returnMapWindow, setReturnMapWindow] = useState<5 | 10 | 'all'>(10);
  // Which currency the returns are measured in ('native' = each asset's own currency) — also drives the ranking
  const [returnMapCurrency, setReturnMapCurrency] = useState<'native' | 'PLN' | 'USD' | 'EUR' | 'CHF' | 'SGD'>('native');
  // What the cell colour means: one colour per asset, per asset class, or green/red by size of return
  const [returnMapHighlight, setReturnMapHighlight] = useState<'asset' | 'class' | 'return'>('asset');
  // Tickers the user clicked to follow across years (all other cells fade out)
  const [returnMapTracked, setReturnMapTracked] = useState<string[]>([]);

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

  // Markets tab state: which currency the returns are shown in, and which period the bar
  // chart and the summary tiles focus on. Separate from the Portfolio tab's currency on
  // purpose, so switching one tab never quietly changes the other.
  const [marketsCurrency, setMarketsCurrency] = useState<MarketsCurrency>('USD');
  // Markets "Country" page: which country (as its currency code) is shown. Poland by default.
  const [marketsCountry, setMarketsCountry] = useState<Exclude<MarketsCurrency, 'Native'>>('PLN');
  // Which SnapshotCategory the table shows ("Assets", "Factor", ...). '' = the first one in the sheet.
  const [marketsCategory, setMarketsCategory] = useState<string>('');
  // Markets "EDO" page: the series shown in the chart ('' = the oldest still running), which
  // lines it draws (value, inflation since purchase, value after tax), and the table filter.
  const [edoSelected, setEdoSelected] = useState<string>('');
  const [edoLines, setEdoLines] = useState<{ value: boolean; cpi: boolean; tax: boolean }>({ value: true, cpi: false, tax: false });
  const [edoStatusFilter, setEdoStatusFilter] = useState<'all' | 'running' | 'matured'>('all');
  // The "Matured series" section: outcomes after tax or before, and real (after inflation) or nominal.
  const [edoMaturedTax, setEdoMaturedTax] = useState(false);
  const [edoMaturedReal, setEdoMaturedReal] = useState(true);
  const [marketsPeriod, setMarketsPeriod] = useState<MarketsPeriod>('YTD');
  // How many years the trend sparkline covers. Follows the period button for 1Y/3Y/5Y/10Y; the
  // shorter periods (YTD/1M/3M/6M) are too short for a trend, so they leave it where it was.
  const [marketsTrendPeriod, setMarketsTrendPeriod] = useState<'1Y' | '3Y' | '5Y' | '10Y' | 'Max'>('5Y');
  // Markets "Returns" (period returns, the default) or "Stats" (CAGR, Vol, Sharpe, drawdowns and
  // stress-year returns for the selected period) for the asset sections.
  const [marketsView, setMarketsView] = useState<'returns' | 'stats'>('returns');
  // How much history the Macro / Country rate & inflation charts show (shared by all of them).
  const [marketsChartRange, setMarketsChartRange] = useState<'1Y' | '3Y' | '5Y' | '10Y' | 'Max'>('Max');
  // Each view remembers its own period: Stats opens on 5Y (a year or more is what its CAGR / Vol /
  // Sharpe need), Returns keeps whatever was last chosen there. Switching view swaps them over.
  const marketsSavedPeriod = useRef<Record<'returns' | 'stats', MarketsPeriod>>({ returns: 'YTD', stats: '5Y' });
  // Markets "Holdings" page: the one currency every money figure on it is converted into.
  // Its own setting (USD by default), so it never moves the Positions tab's currency.
  const [holdingsCurrency, setHoldingsCurrency] = useState<HoldingsCurrency>('USD');
  // Which year the "Profit Breakdown by Asset" table shows.
  // null = default to the latest available year in yearsData (computed at render time).
  const [breakdownYear, setBreakdownYear] = useState<number | null>(null);
  // Is that table expanded? Collapsed by default: it runs to dozens of rows, and it sits
  // above Statistics and everything below it, so leaving it open means scrolling past a
  // worksheet you only occasionally want to read. The heading and its Show button stay
  // visible, so it is still obvious the detail is there.
  const [breakdownExpanded, setBreakdownExpanded] = useState(false);
  // Which currencies are shown in Charts 3 & 4 (Returns/Growth by Year)
  // PLN selected by default; user can toggle individual currencies on/off
  const [selectedReturnCurrencies, setSelectedReturnCurrencies] = useState<string[]>(['PLN']);

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
  // Closed round trips, rebuilt from the Transactions ledger by lib/positions.ts (the old
  // "Closed"/"Exit" sheet tabs are gone). "Closed tab" below = the Closed half of Positions.
  const [closedData, setClosedData] = useState<ClosedPositionRow[]>([]);
  // Which asset the user drilled into (empty string = showing summary list)
  const [closedSelectedTicker, setClosedSelectedTicker] = useState<string>('');
  // "Invested Into" comparison: which other asset to compare against
  const [closedInvestedInto, setClosedInvestedInto] = useState<string>('');
  // "Invested From": which sale date to use as the normalization starting point
  const [closedInvestedFrom, setClosedInvestedFrom] = useState<string>('');
  // Chart toggle: start the chart from the first buy date instead of first available price.
  // On by default — the years before you owned the asset are rarely what you came to look at.
  const [closedSinceInvested, setClosedSinceInvested] = useState(true);
  // Chart toggle: end the chart at the last sale date instead of latest available price
  const [closedUntilSold, setClosedUntilSold] = useState(false);
  // Chart toggle: show the all-time high/low price markers. Off by default — they're occasionally
  // useful but they crowd the line, and the labels sit on top of the data.
  const [closedShowMinMax, setClosedShowMinMax] = useState(false);
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

  // ---- Positions currency conversion ----
  // Currency to convert all position values into (PLN default, '' = no conversion)
  const [positionsCurrency, setPositionsCurrency] = useState<string>('PLN');

  // ---- Open Positions state ----
  // Raw transaction data from the "Data" sheet (purchases, dividends, sales for all assets)
  const [transactionData, setTransactionData] = useState<TransactionRow[]>([]);
  // Open positions, round trips and warnings, replayed from the Transactions ledger once
  // at load. `transactionData` and `closedData` above are filled from this in the shapes
  // the Positions and Portfolio screens already expect, so those tabs needed a new source
  // rather than a rewrite. The raw ledger rows are deliberately NOT kept in state — once
  // the model is built nothing reads them, and holding 1,100+ rows for nothing is waste.
  const [positionsModel, setPositionsModel] = useState<PositionsModel | null>(null);
  const [ledgerWarningDismissed, setLedgerWarningDismissed] = useState(false);  // hide for this session
  // ---- Daily NAV chart state ----
  const [dailyData, setDailyData] = useState<DailyNavRow[]>([]);
  const [dailyNavCurrency, setDailyNavCurrency] = useState<'PLN' | 'USD' | 'SGD' | 'CHF'>('PLN');
  const [dailyNavPeriod, setDailyNavPeriod] = useState<'1Y' | '3Y' | '5Y' | 'Max'>('Max');
  // Which benchmark line is overlaid on the Daily NAV chart ('' = none, the default)
  const [dailyNavBenchmark, setDailyNavBenchmark] = useState<'' | '60/40' | 'World' | 'EQ-MF' | 'EQ-GLD' | '40/FI/MF/GLD'>('');
  // ---- Daily NAV Drawdowns chart state ----
  // Which currencies are shown on the drawdown chart (multi-select; CHF starts off so the
  // chart opens exactly as it did before CHF was added)
  const [ddSelectedCurrencies, setDdSelectedCurrencies] = useState<('PLN' | 'USD' | 'SGD' | 'CHF')[]>(['PLN', 'USD', 'SGD']);
  const [ddPeriod, setDdPeriod] = useState<'1Y' | '3Y' | '5Y' | 'Max'>('Max');
  // Which open-position asset the user drilled into (empty string = showing summary list)
  const [openSelectedTicker, setOpenSelectedTicker] = useState<string>('');
  // Set of purchase transaction indices that are currently included (checked).
  // null = all included (default). Dividends are always included in calculations.
  const [openIncludedTxns, setOpenIncludedTxns] = useState<Set<number> | null>(null);
  // Chart toggle: start the chart from the first buy date. On by default, same reasoning as the
  // closed-position equivalent above.
  const [openSinceInvested, setOpenSinceInvested] = useState(true);
  // Chart toggle: show the all-time high/low price markers. Off by default.
  const [openShowMinMax, setOpenShowMinMax] = useState(false);
  // Toggle: show/hide the avg buy price line (dividend-adjusted) on the price chart
  const [openShowAvgBuy, setOpenShowAvgBuy] = useState(true);
  // "Invested Into" comparison: which other asset to compare against
  const [openInvestedInto, setOpenInvestedInto] = useState<string>('');
  // "Invested From": which buy date to use as the normalization starting point
  const [openInvestedFrom, setOpenInvestedFrom] = useState<string>('');
  // Chart date range controls for open position price chart
  const [openGraphStarts, setOpenGraphStarts] = useState<string>('');
  const [openGraphEnds, setOpenGraphEnds] = useState<string>('');
  // Asset class filter: clicking a row/slice in the breakdown filters Open Positions
  const [openAssetClassFilter, setOpenAssetClassFilter] = useState<string | null>(null);
  // Currency filter: clicking a bar in the currency breakdown filters Asset Class + Open Positions
  const [openCurrencyFilter, setOpenCurrencyFilter] = useState<string | null>(null);
  // Account filter: clicking a bar in the By Account breakdown filters Asset Class, By Currency, and Open Positions
  const [openAccountFilter, setOpenAccountFilter] = useState<string | null>(null);
  // Toggle: when true, each asset is shown under its PortfolioClass from the Lookup tab (blank =
  // its Asset Class; see portfolioClassOf in lib/holdings.ts), so gold, silver and crypto sit
  // together under "Metals & Crypto" — and those are pulled out of their fiat currency bucket
  // into a "M&C" pseudo-currency.
  const [groupMetalsCrypto, setGroupMetalsCrypto] = useState(true);
  // Ref for the "select all" checkbox in open position detail view
  const openSelectAllRef = useRef<HTMLInputElement>(null);

  // ---- Cash section state ----
  // How much money is sitting in each account, in each currency. Built from the same
  // Transactions ledger as the positions above, but answering a different question:
  // not "what do I own?" but "what cash is parked where?". See lib/cash.ts.
  const [cashAccounts, setCashAccounts] = useState<CashAccountBalance[]>([]);
  // Which cash balance the user drilled into, keyed "account|currency".
  // Empty string = showing the summary list, mirroring openSelectedTicker above.
  const [cashSelected, setCashSelected] = useState<string>('');
  // Which row of the drill-down's "Inflows & Outflows by Type" table is expanded
  // (e.g. 'Dividends'). Empty string = none. Cleared whenever a different balance is
  // opened, so you never land on a page showing a category from the previous account.
  const [cashCategory, setCashCategory] = useState<string>('');

  // ---- Positions tab: click-to-sort state ----
  // One entry per table, keyed by a short table id ('positionsOpen', 'cashStatement', ...).
  // A missing key simply means "that table is not sorted", which is why this starts empty
  // and why every table shows its own natural order until you click something.
  // The three-click cycle itself lives in nextTableSort() up at the top of the file.
  const [tableSort, setTableSort] = useState<TableSortMap>({});
  // Advance one table through the cycle: sort descending, sort ascending, then off again.
  const toggleTableSort = (tableId: string, col: string, firstDir: 'asc' | 'desc') => {
    setTableSort(prev => ({ ...prev, [tableId]: nextTableSort(prev[tableId] ?? null, col, firstDir) }));
  };
  // Small convenience so a table only has to name itself once in its JSX: hands back the
  // pair of props (current sort + click handler) that every SortableTh in it needs.
  const sortPropsFor = (tableId: string) => ({
    sort: tableSort[tableId] ?? null,
    onSort: (col: string, firstDir: 'asc' | 'desc') => toggleTableSort(tableId, col, firstDir),
  });

  // ---- Monthly Prices chart state ----
  // Which asset's row is currently selected for chart display (empty = no chart)
  const [monthlySelectedTicker, setMonthlySelectedTicker] = useState<string>('');
  // How many years of data to show in the monthly charts (default: show everything)
  const [monthlyChartPeriod, setMonthlyChartPeriod] = useState<MonthlyChartPeriod>('max');
  // What the main price chart shows:
  //  'sma'       = price + the 10-month moving average (the original, default view)
  //  'drawdown'  = price + the high water mark, with the underwater stretches shaded pink
  //  'vsMarket'  = this asset against world equities, both rebased to 100 at the window start
  //  'price'     = the price line on its own, no overlay — for macro series (interest rates,
  //                GDP) where a 10-month moving average is meaningless
  const [monthlyPriceChartMode, setMonthlyPriceChartMode] =
    useState<'price' | 'sma' | 'drawdown' | 'drawdownReal' | 'vsMarket' | 'inflation'>('sma');
  // Linear (default) or logarithmic Y axis on that same chart. Log is what makes the early
  // years of a big winner readable — see niceLogAxisScale for why.
  const [monthlyPriceChartLog, setMonthlyPriceChartLog] = useState(false);
  // Which currency the selected asset's detail subsection is displayed in.
  // Defaults to the asset's own native currency (set when an asset is clicked),
  // so by default everything shows in the asset's original currency (no conversion).
  // The user can switch to PLN / USD / EUR / CHF / SGD to re-express all stats,
  // charts, and tables below in that currency using the app's FX data.
  const [monthlyDisplayCurrency, setMonthlyDisplayCurrency] = useState<string>('');
  // Which year the "During stress" chart is showing. 2022 by default — the rate shock,
  // the deepest full-year equity drawdown in this data. Deliberately NOT reset when you
  // switch asset, so you can hold a year fixed and click down the list comparing how
  // each holding behaved in it.
  const [stressYear, setStressYear] = useState<number>(2022);
  // Which return period to show in the periodic returns bar chart
  // (Monthly/Quarterly/Annual, or one of the rolling-CAGR views — see ReturnsChartPeriod)
  const [returnsChartPeriod, setReturnsChartPeriod] = useState<ReturnsChartPeriod>('quarterly');
  // Monthly tab statistics table: false = show only the selected asset's row, hiding the
  // IWDA and 50/50 reference rows. Expanded by default, so nothing changes until you click.
  const [monthlyStatsExpanded, setMonthlyStatsExpanded] = useState(true);
  // Which period the BACKTEST tab's returns bar chart shows. Kept separate from
  // returnsChartPeriod above so the two charts don't yank each other around. Defaults to
  // 'annual' — the only view this chart had before it gained the buttons.
  const [backtestReturnsPeriod, setBacktestReturnsPeriod] = useState<ReturnsChartPeriod>('annual');
  // The head-to-head chart sits directly under that one and READS THE SAME PERIOD — one row
  // of buttons drives both, so the two charts can never be showing different periods while
  // stacked on top of each other. Only the pair being compared is its own state.
  // Note the rolling views measure a different quantity to the calendar ones there: the gap
  // between two ANNUALISED returns over one window, so percentage points PER YEAR rather
  // than per period. Its axis, tooltip and footnote all say so rather than leaving it implied.
  const [deltaPortfolioA, setDeltaPortfolioA] = useState(0);
  const [deltaPortfolioB, setDeltaPortfolioB] = useState(1);
  // The Head to Head chart has TWO views behind one toggle. 'gap' is the original
  // difference bars — who won each period. 'correlation' swaps in a rolling-correlation
  // line, which answers the other question: were the two moving together at all?
  // Defaults to 'gap', so the section looks and behaves exactly as it did before.
  const [deltaChartView, setDeltaChartView] = useState<'gap' | 'correlation'>('gap');
  // How many months of history each correlation point looks back over.
  const [correlationWindow, setCorrelationWindow] = useState(12);
  // Period selector for the Graphs tab (separate from Monthly Prices so they don't interfere)
  const [graphsPeriod, setGraphsPeriod] = useState<'1Y' | '2Y' | '3Y' | '4Y' | '5Y' | '10Y' | '15Y' | 'max'>('2Y');
  // End date for the Graphs tab ('' = most recent month in data)
  const [graphsEndDate, setGraphsEndDate] = useState('');
  // Toggle for showing 10-month SMA overlay on all Graphs tab charts
  const [graphsShowSMA, setGraphsShowSMA] = useState(false);

  // PHONES: OPEN WHERE YOU LEFT OFF. An app reopens on the page you last used, with the same
  // choices, instead of starting from the first page every time. So on a phone the open page and
  // its main choices (section, currency, period) are kept in the browser's small storage
  // (localStorage) after every change, and put back when the app opens. Desktop neither saves nor
  // restores anything, so it still always opens on Backtest with the defaults.
  // A saved value that no longer makes sense (a Markets section the sheet dropped, say) is
  // harmless: each page already falls back to its default for a value it doesn't recognise.
  // PHONES: WORKS WITH NO SIGNAL. Installs the service worker (public/sw.js), which keeps the app's
  // own files on the phone so it opens at once, even offline; the data then comes from the saved
  // copy (lib/savedSheet.ts). A phone here = narrow screen AND a touch screen, so a desktop window
  // that happens to be narrow never gets it, and anywhere else it is removed if it was ever there.
  // Only in the published app: on the local dev server it would keep serving yesterday's code.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const phone = isPhoneScreen() && window.matchMedia('(pointer: coarse)').matches;
    if (phone && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* not installed: the app works as before */ });
    } else if (!phone) {
      navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(() => {});
    }
  }, []);

  const phoneMemoryFirstSave = useRef(true);
  // The page an app-icon shortcut asked for ("/?view=positions"), read once when the app opens
  const shortcutView = useRef(typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('view'));
  useEffect(() => {
    // The remembered choices are a phone thing; the shortcut below works at any width (a phone held
    // sideways is wider than a "phone", and a desktop install shows the shortcuts too)
    if (isPhoneScreen()) try {
      const saved = JSON.parse(localStorage.getItem('phoneState') ?? 'null');
      if (saved && typeof saved === 'object') {
        if (saved.view) setActiveView(saved.view);
        if (typeof saved.marketsCategory === 'string') setMarketsCategory(saved.marketsCategory);
        if (saved.marketsCurrency) setMarketsCurrency(saved.marketsCurrency);
        if (saved.marketsView && saved.marketsPeriod) {
          setMarketsView(saved.marketsView);
          setMarketsPeriod(saved.marketsPeriod);
          // Markets parks each view's period here when you switch view, so keep it in step
          marketsSavedPeriod.current[saved.marketsView as 'returns' | 'stats'] = saved.marketsPeriod;
        }
        if (saved.marketsTrendPeriod) setMarketsTrendPeriod(saved.marketsTrendPeriod);
        if (saved.bestToWorstLayout) setBestToWorstLayout(saved.bestToWorstLayout);
        if (saved.portfolioCurrency) setPortfolioCurrency(saved.portfolioCurrency);
        if (saved.positionsCurrency) setPositionsCurrency(saved.positionsCurrency);
        if (saved.holdingsCurrency) setHoldingsCurrency(saved.holdingsCurrency);
        if (saved.dailyNavCurrency) setDailyNavCurrency(saved.dailyNavCurrency);
        if (saved.dailyNavPeriod) setDailyNavPeriod(saved.dailyNavPeriod);
        if (saved.graphsPeriod) setGraphsPeriod(saved.graphsPeriod);
      }
    } catch { /* nothing saved, or storage blocked: open on the defaults */ }
    // Opened from a shortcut on the app icon (press and hold the icon: Portfolio, Positions...,
    // listed in public/manifest.webmanifest as "/?view=portfolio" etc.): that page wins over the
    // remembered one. The "?view=..." is then taken off the address, so it doesn't stick around
    // (it was read once, into shortcutView, so running this again still finds it).
    const fromShortcut = shortcutView.current;
    if (fromShortcut) {
      if (NAV_VIEWS.some(v => v.view === fromShortcut)) {
        setActiveView(fromShortcut as typeof activeView);
        if (fromShortcut === 'bestToWorst') setBestToWorstLayout('ranking');
      }
      window.history.replaceState(null, '', '/');
    }
    // Runs once, when the app opens. NAV_VIEWS is a fixed list, so leaving it out changes nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // Skip the very first run: it happens before the restore above has taken effect, so it would
    // save the defaults over the remembered choices
    if (phoneMemoryFirstSave.current) { phoneMemoryFirstSave.current = false; return; }
    if (!isPhoneScreen()) return;
    try {
      localStorage.setItem('phoneState', JSON.stringify({
        view: activeView, marketsCategory, marketsCurrency, marketsView, marketsPeriod, marketsTrendPeriod,
        bestToWorstLayout, portfolioCurrency, positionsCurrency, holdingsCurrency,
        dailyNavCurrency, dailyNavPeriod, graphsPeriod,
      }));
    } catch { /* private window: just don't remember */ }
  }, [activeView, marketsCategory, marketsCurrency, marketsView, marketsPeriod, marketsTrendPeriod,
      bestToWorstLayout, portfolioCurrency, positionsCurrency, holdingsCurrency,
      dailyNavCurrency, dailyNavPeriod, graphsPeriod]);

  // PHONES: EACH PAGE KEEPS ITS PLACE. Scroll halfway down Positions, look at Markets, come back,
  // and Positions is where you left it, as in other apps (a page not visited yet opens at its top).
  // How: while you scroll, the position is noted against the open page; when another page opens,
  // it is scrolled to the position noted for it. Only kept while the app is open.
  // Desktop doesn't note or move anything.
  const scrollByView = useRef<Partial<Record<typeof activeView, number>>>({});
  const scrollView = useRef(activeView);   // the page the noted positions currently belong to
  useEffect(() => {
    if (!isPhoneScreen()) return;
    const onScroll = () => { scrollByView.current[scrollView.current] = window.scrollY; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // A layout effect runs after the new page is in place but before it is shown, so it opens
  // straight at its spot instead of flashing its top first
  useLayoutEffect(() => {
    if (scrollView.current === activeView) return;
    scrollView.current = activeView;
    if (!isPhoneScreen()) return;
    const target = scrollByView.current[activeView] ?? 0;
    // Charts draw themselves a moment later, so the page may not be tall enough yet to reach the
    // spot: try again a few times over about a third of a second
    let tries = 0;
    const scrollToSpot = () => {
      // 'instant': globals.css makes scrolling smooth by default, which would visibly slide there
      window.scrollTo({ top: target, behavior: 'instant' });
      if (Math.abs(window.scrollY - target) > 2 && ++tries < 6) setTimeout(scrollToSpot, 60);
    };
    scrollToSpot();
  }, [activeView]);
  // Monthly Prices tab: toggle between price view and monthly return (%) view
  const [monthlyViewMode, setMonthlyViewMode] = useState<'prices' | 'returns'>('prices');
  // Monthly Prices tab: end date filter ('' = latest month in data)
  const [monthlyEndDate, setMonthlyEndDate] = useState('');
  // Monthly Prices tab: which column is currently sorted (null = default lookup-table order)
  // Values: 'name', 'month-0'..'month-12', 'sma10', 'signal', 'ticker', 'ret12m', 'dd12m'
  const [monthlySortColumn, setMonthlySortColumn] = useState<string | null>(null);
  // Monthly Prices tab: seasonality screen — selected calendar month (0=Jan..11=Dec, null = off).
  // When set, a ranking card appears sorting the filtered assets by their loss rate in that month.
  const [seasonMonth, setSeasonMonth] = useState<number | null>(null);

  // Close Years dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // A tap inside the phone's slide-up panel isn't "outside": the panel lives elsewhere on the page
      if ((event.target as Element).closest?.('[role="dialog"]')) return;
      if (yearsDropdownRef.current && !yearsDropdownRef.current.contains(event.target as Node)) {
        setYearsDropdownOpen(false);
      }
    };
    if (yearsDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [yearsDropdownOpen]);

  // Manage the "indeterminate" state of the select-all checkbox in the Closed tab.
  // HTML checkbox has three visual states: checked, unchecked, and indeterminate (dash icon).
  // React can't set indeterminate via props — it's a DOM property, so we use a ref.
  useEffect(() => {
    if (closedSelectAllRef.current && closedSelectedTicker) {
      const total = getClosedTransactions(closedSelectedTicker).length;
      const included = closedIncludedTxns === null ? total : closedIncludedTxns.size;
      closedSelectAllRef.current.indeterminate = included > 0 && included < total;
    }
    // closedData is what getClosedTransactions reads: listed so the box also updates after
    // Refresh Data. (The function itself is defined further down, so it can't be listed here.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedIncludedTxns, closedSelectedTicker, closedData]);

  // Same indeterminate checkbox management for the Open positions detail view
  useEffect(() => {
    if (openSelectAllRef.current && openSelectedTicker) {
      const total = getOpenPurchases(openSelectedTicker).length;
      const included = openIncludedTxns === null ? total : openIncludedTxns.size;
      openSelectAllRef.current.indeterminate = included > 0 && included < total;
    }
    // positionsModel is what getOpenPurchases reads: listed so the box also updates after
    // Refresh Data. (The function itself is defined further down, so it can't be listed here.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIncludedTxns, openSelectedTicker, positionsModel]);

  // ----------------------------------------
  // AUTO-LOAD DATA ON MOUNT
  // ----------------------------------------
  // useEffect runs code when the component first appears ("mounts").
  //
  // The ref guard matters: next.config.js sets reactStrictMode, which makes React
  // deliberately run mount effects TWICE in development to surface bugs. Without the
  // guard that fired two full loads, so every sheet was downloaded twice — and Google
  // throttles parallel requests to the same document, so the duplicates did not just
  // waste bandwidth, they slowed the real ones down. Production only mounts once, but
  // there is no reason to do the work twice in development either.
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    loadDataFromSheet();
    // Deliberately runs once, on opening (see above); Refresh Data calls it again by hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------------------
  // DATA LOADING FUNCTIONS
  // ----------------------------------------

  /**
   * Puts one download of the sheet into the app: works out positions and cash from it and stores
   * everything the pages read. Used for every fresh download and, on a phone, for the copy saved
   * on the phone last time (see loadDataFromSheet below).
   * resetSelections: also select every asset, class and currency again (what a load has always
   * done). Off only when a phone swaps its saved copy for the fresh download of the same assets,
   * so a filter tapped in the meantime isn't undone a few seconds later.
   */
  const applySheetData = (parsed: ParsedData, resetSelections: boolean) => {
      const { data, assets, lookup, yearsData: fetchedYearsData, dailyData: fetchedDailyData, ledgerData: fetchedLedgerData, presetPortfolios: fetchedPresets, edo: fetchedEdo } = parsed;

      // ---- Derive positions from the ledger -------------------------------
      // Replay the Transactions tab to work out what is still held, what was sold,
      // and which dividends belong to which shares. Only tickers in the lookup table
      // are reported — anything left out of it is deliberately not an investment we
      // want to see. This is the single source now: the old Open/Exit tabs are gone.
      const allowedTickers = new Set(lookup.map(a => a.ticker));
      const model = buildPositions(fetchedLedgerData, allowedTickers);
      const effectiveTransactions = toTransactionRows(fetchedLedgerData, allowedTickers);
      const effectiveClosed = toClosedPositionRows(model);

      // ---- Derive cash balances from the same ledger ------------------------
      // The Transactions tab is double-entry: every row names the account the money
      // LEFT and the account it ARRIVED at. Replaying that gives a bank statement,
      // and therefore a balance, for each account and currency. `selectVisibleCash`
      // drops accounts closed years ago at zero.
      //
      // Unlike positionsModel above, this DOES keep per-row detail in state: ~1,250
      // movements, about 230 KB. That is deliberate rather than an oversight — the
      // drill-down page renders the statement line by line, so the alternative is
      // holding the raw ledger and recomputing, which costs the same memory and more
      // work. Building it takes well under a millisecond, so it happens once here
      // rather than on render.
      const cash = selectVisibleCash(buildCashAccounts(fetchedLedgerData));

      if (fetchedLedgerData.length === 0) {
        console.warn('Ledger is empty — the Positions tab will have nothing to show');
      } else {
        console.log(`Ledger: ${model.open.length} open, ${closedTickersFrom(model).length} closed, `
          + `${model.roundTrips.length} round trips, ${model.warnings.length} warning(s), `
          + `${cash.length} cash balance(s)`);
      }

      // Update all our state with the new data
      setAssetData(data);
      setAvailableAssets(assets);
      setAssetLookup(lookup);
      setYearsData(fetchedYearsData);
      setPositionsModel(model);
      setCashAccounts(cash);
      setClosedData(effectiveClosed);
      setTransactionData(effectiveTransactions);
      setDailyData(fetchedDailyData);
      setPresetPortfolios(fetchedPresets);
      setEdoData(fetchedEdo);
      setIsConnected(true);

      if (resetSelections) {
        // Initialize filters to "all selected" when data loads
        // This ensures all assets are visible by default
        setSelectedAssetTickers(lookup.map(a => a.ticker));
        setSelectedAssetClasses(Array.from(new Set(lookup.map(a => a.assetClass).filter(Boolean))));
        setSelectedCurrencies(Array.from(new Set(lookup.map(a => a.currency).filter(Boolean))));
        setSelectedAssetSubcategories(['Basic']);
      }

      // Set the date range based on the data
      if (data.length > 0) {
        setDateRange({
          start: data[0].date,
          end: data[data.length - 1].date
        });
      }

  };

  // Phones only: has this visit already looked for the copy saved on the phone? (Only the first
  // load does; pressing Refresh later just downloads.)
  const triedSavedSheetRef = useRef(false);
  // "30 Oct 21:14", the same style as the "Fetched" line in the menu
  const fmtStamp = (d: Date) =>
    `${d.getDate()} ${MONTH_LABELS[d.getMonth()]} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

  /**
   * Fetches fresh data from the Google Sheet.
   * Called automatically on page load and when user clicks "Refresh Data"
   *
   * On a phone, the first load also shows the copy saved on the phone last time while the download
   * runs ("Saved copy from ... · updating..."), then swaps in the fresh data and saves that for
   * next time. If the download fails, the saved copy stays on screen with the error above it.
   * Desktop does exactly what it always did: wait for the download, then show it.
   */
  const loadDataFromSheet = async () => {
    setIsLoading(true);
    setLoadingMessage('Fetching data from Google Sheets...');

    const phone = isPhoneScreen();
    // Start the download first, so reading the saved copy doesn't hold it up
    const freshRequest = fetchSheetData();
    let freshSettled = false;
    // (The second handler also stops the browser warning about a failure nobody is waiting for yet;
    // the failure itself is still caught below.)
    freshRequest.then(() => { freshSettled = true; }, () => { freshSettled = true; });

    let savedShown: { data: ParsedData; savedAt: Date } | null = null;
    if (phone && !triedSavedSheetRef.current) {
      triedSavedSheetRef.current = true;
      const saved = await readSavedSheet();
      // Skip it if the download already beat it (it never should, but stale must not win)
      if (saved && !freshSettled) {
        try {
          applySheetData(saved.data, true);
          setLastFetchedAt(saved.savedAt);
          setLoadingMessage(`Saved copy from ${fmtStamp(saved.savedAt)} · updating…`);
          savedShown = saved;
        } catch (err) {
          // A saved copy the current code can't read: ignore it and wait for the download
          console.warn('Saved copy of the sheet could not be shown:', err);
        }
      }
    }

    try {
      const parsed = await freshRequest;
      const { data, assets, edo: fetchedEdo } = parsed;
      // Swapping the saved copy for fresh data of the SAME assets: keep the selections as they are
      const sameAssets = savedShown !== null
        && savedShown.data.lookup.map(a => a.ticker).join('|') === parsed.lookup.map(a => a.ticker).join('|');
      applySheetData(parsed, !sameAssets);

      // A failed EDO tab is not fatal, but it must not be silent: it also takes away the price of
      // any EDO bond held in Positions / Holdings. (Shown as a third status line.)
      setLoadingMessage(`Loaded ${assets.length} assets, ${data.length} data points${fetchedEdo ? '' : ', EDO tab missing: Refresh'}`);
      setLastFetchedAt(new Date());
      if (phone) saveSheet(parsed); // in the background; nothing waits for it
    } catch (error) {
      console.error('Failed to load data:', error);
      // Phones: no signal at all is not an error in the app, so it gets a calm grey "Offline"
      // line instead of a red error (the status line turns red only when it says "Error"), and
      // the data comes back by itself once the phone is online again (see the effect below).
      // "No signal" = the phone says it's offline, or the sheet never answered at all (lib/fetchData.ts
      // gives up with a SheetUnreachableError whose noAnswer is true, e.g. Wi-Fi connected but no
      // internet); anything else, e.g. Google answering with a server fault, is an error.
      const offline = phone && (!navigator.onLine || error instanceof TypeError
        || (error instanceof SheetUnreachableError && error.noAnswer));
      if (savedShown) {
        // Keep the saved copy on screen rather than an empty page, and say plainly it is old
        setLoadingMessage(offline
          ? `Offline · saved copy from ${fmtStamp(savedShown.savedAt)}`
          : `Error updating, showing the copy saved ${fmtStamp(savedShown.savedAt)}`);
      } else if (phone && assetData && lastFetchedAt) {
        // Phone, pulled down to refresh with no signal: keep what's on screen (desktop still
        // clears the page on a failed refresh, as it always has)
        setLoadingMessage(offline
          ? `Offline · data from ${fmtStamp(lastFetchedAt)}`
          : `Error updating, showing data from ${fmtStamp(lastFetchedAt)}`);
      } else {
        // (Phone with no signal and nothing to show yet, e.g. the very first opening: "Offline"
        // too, so the data still arrives by itself once there is a signal. Pulling down can't be
        // used then, as there is no page to pull.)
        setLoadingMessage(offline
          ? 'Offline · the data will load when there is a signal'
          : `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        setIsConnected(false);
      }
    }

    setIsLoading(false);
  };

  // PHONES: PULL DOWN TO REFRESH. At the top of a page, drag down and let go: a round arrow follows
  // your finger down from the top edge, and once it has come far enough, letting go fetches fresh
  // data (the arrow spins until it's in). Letting go sooner just slides it back.
  // The arrow is moved by setting its style directly rather than through React state: this
  // component is very large, and redrawing all of it on every finger movement would stutter.
  // The browser's own pull-to-refresh (which reloads the whole page) is switched off in globals.css.
  const pullIndicatorRef = useRef<HTMLDivElement>(null);
  const pullSpinningRef = useRef(false);
  // The latest versions of these, for the touch handlers below (set up once, so they'd otherwise
  // keep seeing the values from the very first render)
  const pullRefreshRef = useRef<() => void>(() => {});
  pullRefreshRef.current = () => { if (!isLoading) loadDataFromSheet(); };

  // PHONE TURNED SIDEWAYS: every chart grows to the screen's height (the ResponsiveContainer
  // stand-in at the top of this file), which moves
  // everything on the page, so turning the phone would lose the chart you were reading. So: each
  // time the page comes to rest after scrolling, note the chart nearest the middle of the screen
  // (only then, not on every scrolled frame: measuring every chart, 32 of them on Graphs, while the
  // page moves is wasted work); when the phone turns, bring that chart back to the middle once the
  // page has settled into its new shape. Turning back upright does the same. Phones only (a touch
  // screen whose short side is a phone's).
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches || Math.min(window.screen.width, window.screen.height) >= 768) return;
    let focus: Element | null = null;
    let frozenUntil = 0; // after a turn, the page jumps about for a moment: don't re-pick then
    let wasLandscape = window.innerWidth > window.innerHeight;
    const pick = () => {
      if (Date.now() < frozenUntil) return;
      const mid = window.innerHeight / 2;
      let best: Element | null = null, bestDist = Infinity;
      document.querySelectorAll('.recharts-responsive-container').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.height === 0 || r.bottom < 0 || r.top > window.innerHeight) return;
        const dist = Math.abs((r.top + r.bottom) / 2 - mid);
        if (dist < bestDist) { bestDist = dist; best = el; }
      });
      focus = best;
    };
    // Pick once the scrolling has paused for 150 ms
    let restTimer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(restTimer);
      restTimer = setTimeout(pick, 150);
    };
    // "resize" comes before the scrolling the turn causes, so `focus` is still the chart from before
    const onResize = () => {
      const landscape = window.innerWidth > window.innerHeight;
      if (landscape === wasLandscape) return;
      wasLandscape = landscape;
      const el = focus;
      frozenUntil = Date.now() + 700;
      if (el) setTimeout(() => { if (el.isConnected) el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }); }, 350);
    };
    pick();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(restTimer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // PHONES: BACK ONLINE = FRESH DATA. While the status line says "Offline", the moment the phone
  // gets a signal again the data is fetched by itself, without having to pull the page down.
  const offlineRef = useRef(false);
  offlineRef.current = loadingMessage.startsWith('Offline');
  useEffect(() => {
    if (!isPhoneScreen()) return;
    const onOnline = () => { if (offlineRef.current) pullRefreshRef.current(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);
  const pullBlockedRef = useRef(false);
  pullBlockedRef.current = navOpen || !isConnected;
  useEffect(() => {
    if (!isPhoneScreen()) return;
    const PULL_TO_REFRESH = 64; // how far (in px) the arrow must come down before letting go refreshes
    let startX = 0, startY = 0, pulling = false, distance = 0;
    // Place the arrow: "distance" px down from just above the screen, turning as it comes
    const place = (d: number, animate: boolean) => {
      const el = pullIndicatorRef.current;
      if (!el) return;
      el.style.transition = animate ? 'transform 0.2s, opacity 0.2s' : 'none';
      el.style.transform = `translateY(${d}px)`;
      el.style.opacity = String(Math.min(1, d / PULL_TO_REFRESH));
      const icon = el.querySelector('svg');
      if (icon && !pullSpinningRef.current) icon.style.transform = `rotate(${d * 4}deg)`;
    };
    const onStart = (e: TouchEvent) => {
      // Only a one-finger drag that starts with the page scrolled right to the top
      // (and not while a slide-up choice panel is open: components/PhoneSheet.tsx sets the flag)
      pulling = window.scrollY <= 0 && e.touches.length === 1 && !pullBlockedRef.current && !pullSpinningRef.current
        && !document.body.dataset.sheetOpen;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      distance = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      // A sideways swipe (a table or a row of buttons scrolling) or a scroll up is not a pull
      if (distance === 0 && (dy <= 0 || Math.abs(dx) > dy)) { pulling = false; return; }
      distance = Math.max(0, Math.min(dy * 0.5, 100)); // the arrow moves at half the finger's speed
      place(distance, false);
    };
    const onEnd = () => {
      if (!pulling) return;
      pulling = false;
      if (distance >= PULL_TO_REFRESH) {
        // Park it in view and spin until the data is in (see the effect below)
        pullSpinningRef.current = true;
        const icon = pullIndicatorRef.current?.querySelector('svg');
        if (icon) { icon.style.transform = ''; icon.classList.add('animate-spin'); }
        place(PULL_TO_REFRESH, true);
        pullRefreshRef.current();
      } else {
        place(0, true);
      }
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);
  // Once the refresh has finished, stop the arrow spinning and slide it away
  useEffect(() => {
    if (isLoading || !pullSpinningRef.current) return;
    pullSpinningRef.current = false;
    const el = pullIndicatorRef.current;
    if (!el) return;
    el.querySelector('svg')?.classList.remove('animate-spin');
    el.style.transition = 'transform 0.2s, opacity 0.2s';
    el.style.transform = 'translateY(0px)';
    el.style.opacity = '0';
  }, [isLoading]);

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


  /** Returns all closed position rows for a specific ticker. */
  const getClosedTransactions = (ticker: string): ClosedPositionRow[] => {
    return closedData.filter(row => row.ticker === ticker);
  };


  // ----------------------------------------
  // OPEN POSITIONS TAB HELPER FUNCTIONS
  // ----------------------------------------
  // These support the Open Positions section: identifying open tickers,
  // computing stats, building chart data — all from raw transaction data.

  /**
   * Returns the purchase rows that make up an open position, sorted by date.
   *
   * Two things this must get right, both of which broke when the ledger arrived:
   *
   *  1. These are the SURVIVING lots, not every purchase ever made. BCASH was bought
   *     4,054 units over time and 589 sold, so listing every purchase would claim
   *     4,054 are held when only 3,465 are.
   *  2. A ticker with nothing left open returns NOTHING. The ledger still holds the
   *     original buy rows of assets sold years ago; treating those as open lots
   *     resurrects sold holdings.
   *
   * Commission comes back with each lot. It is already inside `amount`, so it is there
   * to be displayed, never to be added on top.
   */
  const getOpenPurchases = (ticker: string): TransactionRow[] => {
    const pos = positionsModel?.open.find(o => o.ticker === ticker);
    if (!pos) return [];   // not open, or the ledger hasn't loaded yet
    return pos.lots.map(l => ({
      // What was BOUGHT (less anything sold), so amount / qty stays the real price paid.
      // Units later given up to fees paid in units travel alongside in `unitFees`; use
      // heldQty() for the units still held. For almost every lot the two are equal.
      date: l.date, fx: pos.currency, qty: l.qty + unitFeeQty(l.unitFees), unitFees: l.unitFees,
      commAbs: l.commission, commBps: l.commissionBps,
      amount: l.cost, asset: pos.asset, flow: FLOW_PURCHASE, ticker,
      // Each lot keeps the account it was actually bought in — ETHSGD spans
      // BinanceSG and Gemini, so a single per-position account would mislabel half.
      account: l.account,
      // ...and which cash account paid for it, which is a different account entirely
      // (shares land in "IB ETF"; the money left "Interactive Brokers").
      fundedFrom: l.fundedFrom,
    }));
  };

  /**
   * Returns the dividends the CURRENTLY HELD shares actually earned, sorted by date.
   *
   * This is not the asset's full payment history. If you bought MBHTR in 2021, sold
   * those shares, and bought again in 2025, the 2021 dividends belong to the shares you
   * no longer own — they went out with the round trips. Listing them against today's
   * holding would be meaningless and would double-count the income, since the Closed
   * section reports it too.
   *
   * The lot replay already tracked which payment reached which shares, so this simply
   * reads that back.
   */
  const getOpenDividends = (ticker: string): TransactionRow[] => {
    // Nothing open means no income belongs here — it all left with the round trips.
    // Reading the raw ledger instead would report a closed position's entire dividend
    // history a second time, on top of what those round trips already carry.
    const pos = positionsModel?.open.find(o => o.ticker === ticker);
    if (!pos) return [];
    return pos.incomeEvents.map(e => ({
      date: e.date, fx: pos.currency, qty: 0, commAbs: 0, commBps: 0,
      amount: e.amount, asset: pos.asset, flow: FLOW_DIVIDEND, ticker, account: '',
    }));
  };

  // ----------------------------------------
  // PORTFOLIO MANAGEMENT FUNCTIONS
  // ----------------------------------------

  /**
   * Generates a portfolio name from its assets.
   * e.g., [SPY 60%, BND 40%] -> "SPY60-BND40"
   */
  const generatePortfolioName = (assets: PortfolioAsset[], inflationAdj?: string, baseCurrency?: string, presetName?: string): string => {
    // Include shorts (negative weights) in the name too — only a zero weight is "not in the portfolio"
    const validAssets = assets.filter(a => a.asset && a.weight !== 0);
    if (validAssets.length === 0) return 'Portfolio';
    // If any leg is short, join with " / " instead of "-", otherwise "CSPX200-IB01-100" is unreadable
    // (you can't tell the separator from the minus sign). All-long portfolios keep the original "-" style.
    const hasShort = validAssets.some(a => a.weight < 0);
    // A card still holding an unedited preset is named after the preset ("Global 60/40")
    const baseName = presetName || validAssets.map(a => `${a.asset}${Math.round(a.weight)}`).join(hasShort ? ' / ' : '-');
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
   * The preset a card is still showing, or undefined once it has been edited.
   *
   * A card remembers which preset was loaded into it (presetName), but it only still
   * "is" that preset while its assets and weights match the sheet exactly, in the same
   * order and with no carry costs added. Checking that here, instead of clearing the
   * flag in every function that edits an asset, means no existing edit code had to
   * change: edit a weight and the card simply stops matching.
   */
  const matchingPreset = (p: Portfolio): PresetPortfolio | undefined => {
    if (!p.presetName) return undefined;
    const preset = presetPortfolios.find(pp => pp.name === p.presetName);
    if (!preset || preset.assets.length !== p.assets.length) return undefined;
    const same = preset.assets.every((a, i) =>
      p.assets[i].asset === a.asset && p.assets[i].weight === a.weight && !p.assets[i].costPct);
    return same ? preset : undefined;
  };

  /**
   * Loads a preset (from the Portfolios sheet) into a card: its assets and weights replace
   * the card's, while the card's currency and inflation choices are kept.
   */
  const applyPreset = (portfolioId: number, presetName: string) => {
    const preset = presetPortfolios.find(pp => pp.name === presetName);
    if (!preset) return;
    setNumDrafts({});   // half-typed numbers belong to the old rows — same reason as removeAsset
    const updatedPortfolios = portfolios.map(p => {
      if (p.id !== portfolioId) return p;
      const newAssets: PortfolioAsset[] = preset.assets.map(a => ({ asset: a.asset, weight: a.weight }));
      return {
        ...p,
        assets: newAssets,
        presetName: preset.name,
        nameManuallyEdited: false,   // picking a preset is a fresh start for the name too
        name: generatePortfolioName(newAssets, p.inflationAdj, p.baseCurrency, preset.name),
      };
    });
    setPortfolios(updatedPortfolios);
    autoAdjustStartDate(updatedPortfolios);   // same as adding assets by hand
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
    const colors = SERIES_COLORS;
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
    setNumDrafts({});  // row indices shift when the list grows — see removeAsset

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
    // NOTE: no longer clamped at 0 — with shorting enabled the balancing asset is allowed to go
    // negative (e.g. type 200% into slot 2 and slot 1 becomes -100%, i.e. the financing leg).
    const firstAssetWeight = 100 - otherAssetsWeight;

    const newAssets = [...assets];
    newAssets[0] = { ...newAssets[0], weight: firstAssetWeight };
    return newAssets;
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
   * Sets the start date based on a preset period (YTD, 1Y, 3Y, 5Y).
   * Keeps the end date unchanged and calculates the new start date.
   * Finds the closest available date in the data if exact date doesn't exist.
   */
  const setDatePreset = (preset: DatePreset) => {
    const start = presetStartDate(preset);
    if (start) setSelectedStartDate(start);
  };

  /**
   * The start date a quick preset (YTD, 1Y … 10Y, Max) would set, without setting it. Used by
   * setDatePreset above, and to light up the preset button that matches the dates on screen.
   * `limiting` is the shortest asset history; checking all twelve presets passes it in, so that
   * search runs once rather than once per preset.
   */
  const presetStartDate = (preset: DatePreset, limiting = getLimitingAsset()): string | null => {
    if (!assetData || assetData.length === 0) return null;

    if (preset === 'Max') {
      // Use the limiting asset's first date (shortest history), or the first date in the dataset
      return limiting ? limiting.date : assetData[0].date;
    }

    // Dates are "YYYY-MM-DD" strings. new Date() reads them as midnight UTC, so every step below
    // stays in UTC: mixing in the computer's own time zone (getFullYear, a local new Date(y, 0, 1))
    // made the answer depend on where the browser is — YTD began at the December month-end in
    // Singapore but skipped January west of London.
    const endDate = new Date(selectedDateRange.end);
    let targetDateStr: string;

    if (preset === 'YTD') {
      // Year to date: from the last day of the previous year, so the first row on or after it is
      // the year-end price the year's return is measured from
      targetDateStr = `${endDate.getUTCFullYear() - 1}-12-31`;
    } else {
      // 1Y, 2Y, 3Y, 4Y, 5Y: subtract years from end date
      const years = parseInt(preset);  // "1Y" -> 1, "2Y" -> 2, etc.
      const targetStartDate = new Date(endDate);
      targetStartDate.setUTCFullYear(endDate.getUTCFullYear() - years);
      targetDateStr = targetStartDate.toISOString().split('T')[0];
    }

    // Enforce: can't go earlier than the limiting asset's first available date
    if (limiting && targetDateStr < limiting.date) {
      targetDateStr = limiting.date;
    }

    // Find first date >= target date; if there is none after the target, the first available date
    const closestDate = assetData.find(row => row.date >= targetDateStr);
    return closestDate ? closestDate.date : assetData[0].date;
  };

  /**
   * Which quick preset the dates on screen match (undefined if none: dates picked by hand).
   * When the shortest asset history cuts several presets to the same start (say 9Y, 10Y and Max
   * all begin at its first month) the longest one wins, since that is what "Max" means.
   */
  const activeDatePreset = (): DatePreset | undefined => {
    const limiting = getLimitingAsset();
    return [...DATE_PRESETS].reverse().find(p => presetStartDate(p, limiting) === selectedDateRange.start);
  };

  /**
   * Updates a specific field of an asset in a portfolio
   */
  const updateAsset = (portfolioId: number, assetIndex: number, field: 'asset' | 'weight' | 'costPct', value: string | number) => {
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
   * Handles typing in the Weight / Cost boxes, which have to accept negative numbers.
   *
   * Two things happen on every keystroke:
   *  1. The raw text is stashed in `numDrafts` so a half-finished entry like "-" or "1." stays on
   *     screen instead of being snapped back to a number (see the numDrafts comment above).
   *  2. The parsed number is written into the portfolio, so the backtest always has a valid value.
   */
  const handleNumericAssetInput = (
    portfolioId: number,
    assetIndex: number,
    field: 'weight' | 'costPct',
    raw: string
  ) => {
    setNumDrafts(prev => ({ ...prev, [`${portfolioId}:${assetIndex}:${field}`]: raw }));
    const parsed = parseFloat(raw);
    // Number.isFinite (not !isNaN) — it rejects Infinity as well as NaN. Typing something like
    // "1e400" parses to Infinity, which sails past the liquidation guard (Infinity is not <= 0)
    // and then turns the whole backtest into NaN when the long and short legs cancel. Anything
    // that isn't a real number becomes 0, i.e. "no adjustment".
    updateAsset(portfolioId, assetIndex, field, Number.isFinite(parsed) ? parsed : 0);
  };

  /** Drops the draft when a box loses focus, so it goes back to showing the tidy stored number. */
  const clearNumDraft = (portfolioId: number, assetIndex: number, field: 'weight' | 'costPct') => {
    setNumDrafts(prev => {
      const next = { ...prev };
      delete next[`${portfolioId}:${assetIndex}:${field}`];
      return next;
    });
  };

  /**
   * Removes an asset from a portfolio
   */
  const removeAsset = (portfolioId: number, assetIndex: number) => {
    // Drafts are keyed by row index, so removing a row would make them point at the wrong asset.
    // Simplest correct fix: throw them all away — the stored numbers are the source of truth anyway.
    setNumDrafts({});
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

  /** True if any leg of this portfolio carries a financing/expense adjustment. */
  const hasCostLeg = (portfolio: Portfolio): boolean => {
    return portfolio.assets.some(a => !!a.costPct);
  };

  // ----------------------------------------
  // BACKTEST CALCULATIONS (the engine itself is in lib/backtest.ts)
  // ----------------------------------------

  // The Backtest tab's settings, as the engine takes them. Only the Monthly tab's "vs market"
  // rows pass overrides: they need this very engine over a different span, and a second, parallel
  // implementation there would eventually disagree with the Backtest tab, which is precisely the
  // thing those rows exist to rule out.
  const backtestSettings = (overrides?: { start?: string; end?: string; rebalanceFreq?: string }): BacktestSettings => ({
    start: overrides?.start ?? selectedDateRange.start,
    end: overrides?.end ?? selectedDateRange.end,
    rebalanceFreq: overrides?.rebalanceFreq ?? rebalanceFreq,
    startingCapital,
    currencyOf: getAssetCurrency,
    prepareRows: rowsForWindow,
  });

  /** A portfolio's value line and drawdown over the selected window (null if it can't run). */
  const calculatePortfolioReturns = (
    portfolio: Portfolio,
    data: AssetRow[],
    overrides?: { start?: string; end?: string; rebalanceFreq?: string },
  ): ReturnPoint[] | null => portfolioReturns(portfolio, data, backtestSettings(overrides));

  /** The month-by-month Rebalancing table: the same simulation the chart line comes from. */
  const getRebalancingDetails = (result: BacktestResult): RebalancingRow[] =>
    (assetData ? simulatePortfolio(result.portfolio, assetData, backtestSettings()) : []);

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

  /**
   * Best and worst CALENDAR YEAR for each portfolio, keyed by portfolio name.
   *
   * Deliberately read off the very same getAnnualReturnsChartData() that feeds the
   * Annual Returns chart and its table further down the page, rather than worked out
   * again here. The Best Year figure has to be the tallest bar in that chart — anyone
   * reading the page will check exactly that — and reusing the numbers makes it true
   * by construction instead of by two pieces of arithmetic happening to agree.
   *
   * Note this inherits that helper's definition of a year, which includes a partial
   * first year (when the backtest starts mid-year) and the partial current year. The
   * year itself is returned so the cell can name it on hover.
   */
  const getBestWorstYears = (
    results: BacktestResult[],
    startDate: string,
  ): Record<string, { best: number; bestYear: string; worst: number; worstYear: string }> => {
    const out: Record<string, { best: number; bestYear: string; worst: number; worstYear: string }> = {};
    if (!results || results.length === 0) return out;
    const rows = getAnnualReturnsChartData(results, startDate);

    results.forEach(result => {
      const name = result.portfolio.name;
      let best: { v: number; year: string } | null = null;
      let worst: { v: number; year: string } | null = null;
      for (const row of rows) {
        const v = row[name];
        if (typeof v !== 'number') continue;   // portfolio has no data for that year
        const year = String(row.year);
        if (!best || v > best.v) best = { v, year };
        if (!worst || v < worst.v) worst = { v, year };
      }
      if (best && worst) {
        out[name] = { best: best.v, bestYear: best.year, worst: worst.v, worstYear: worst.year };
      }
    });

    return out;
  };

  /**
   * Builds the Backtest tab's returns bar chart data at ANY period — calendar
   * months, quarters, years, or one of the rolling-CAGR windows. It is the
   * grouped, multi-portfolio counterpart of the Monthly tab's computeReturnsData.
   *
   * Example output (quarterly, two portfolios):
   * [
   *   { key: '2023-Q1', label: '1Q\n2023', 'Portfolio 1': 4.2, 'Portfolio 2': -1.1 },
   *   ...
   * ]
   *
   * The 'annual' case DELEGATES to getAnnualReturnsChartData rather than working the
   * numbers out again, so the default view is guaranteed to keep showing exactly what
   * it showed before this chart gained its buttons — including that helper's rule
   * about dropping a December start year (one data point, would read as 0%).
   *
   * @param results - the backtested portfolios
   * @param startDate - backtest start, only used by the annual path above
   * @param period - which view the buttons have selected
   * @returns one row per bar, sorted oldest to newest
   */
  const getPeriodicReturnsChartData = (
    results: BacktestResult[],
    startDate: string,
    period: ReturnsChartPeriod,
  ): PeriodicReturnsRow[] => {
    if (!results || results.length === 0) return [];

    if (period === 'annual') {
      return getAnnualReturnsChartData(results, startDate)
        .map(row => ({ ...row, key: String(row.year), label: String(row.year) }));
    }

    const rolling = ROLLING_RETURN_YEARS.find(r => r.period === period);
    const streak = STREAK_VIEWS.find(s => s.period === period);

    // Portfolios are merged into shared rows so a bar group lines up on one X value.
    // A portfolio missing that period simply has no entry, and Recharts draws no bar.
    const rowsByKey = new Map<string, PeriodicReturnsRow>();
    const rowFor = (key: string, label: string, range?: string): PeriodicReturnsRow => {
      let row = rowsByKey.get(key);
      if (!row) {
        row = range ? { key, label, range } : { key, label };
        rowsByKey.set(key, row);
      }
      return row;
    };
    const fmtMonth = (d: Date) => `${MONTH_ABBR[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;

    results.forEach(result => {
      const name = result.portfolio.name;

      // Last value per calendar month, oldest first. The engine already emits one point
      // per month; going through a map keeps this true even if that ever changes.
      const byMonth = new Map<string, { date: string; value: number }>();
      for (const p of result.returns) byMonth.set(toYM(new Date(p.date)), { date: p.date, value: p.value });
      const months = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));

      if (streak) {
        // Same counters as the Monthly tab, run on portfolio VALUE instead of price.
        // The high-water mark starts at the first month of the backtest, so that month
        // counts as a high — the same convention the drawdown figures use.
        let peak = -Infinity;
        let run = 0;
        for (let i = 0; i < months.length; i++) {
          const value = months[i][1].value;
          let onRun: boolean;
          if (period === 'athStreak') {
            onRun = value >= peak;              // at the mark counts, matching drawdown == 0
            if (value > peak) peak = value;
          } else {
            onRun = i > 0 && value > months[i - 1][1].value;   // strictly up on last month
          }
          run = onRun ? run + 1 : 0;
          const row = rowFor(months[i][0], fmtMonth(new Date(months[i][1].date)));
          row[name] = run;
        }
        return;
      }

      if (rolling) {
        // Same method as the Monthly tab: look the window's end month up BY NAME rather
        // than counting 12*N slots forward, so a bar is either exactly N years or absent.
        const idxByMonth = new Map<string, number>();
        months.forEach(([ym], i) => idxByMonth.set(ym, i));
        for (let i = 0; i < months.length; i++) {
          const startD = new Date(months[i][1].date);
          const endKey = `${startD.getFullYear() + rolling.years}-${String(startD.getMonth() + 1).padStart(2, '0')}`;
          const endIdx = idxByMonth.get(endKey);
          if (endIdx === undefined) continue;   // window runs past the end of the backtest
          const startValue = months[i][1].value;
          const endValue = months[endIdx][1].value;
          if (!(startValue > 0) || !(endValue > 0)) continue;
          const cagr = (Math.pow(endValue / startValue, 1 / rolling.years) - 1) * 100;
          const endD = new Date(months[endIdx][1].date);
          const row = rowFor(months[i][0], fmtMonth(startD), `${fmtMonth(startD)} → ${fmtMonth(endD)}`);
          row[name] = parseFloat(cagr.toFixed(1));
          // The two portfolio values behind the CAGR, so the tooltip can show its
          // working the way the Monthly tab's shows the two prices.
          row[`${name}__start`] = startValue;
          row[`${name}__end`] = endValue;
        }
        return;
      }

      if (period === 'monthly') {
        for (let i = 1; i < months.length; i++) {
          const prev = months[i - 1][1].value;
          const curr = months[i][1].value;
          if (!(prev > 0)) continue;
          const row = rowFor(months[i][0], fmtMonth(new Date(months[i][1].date)));
          row[name] = parseFloat((((curr - prev) / prev) * 100).toFixed(1));
        }
        return;
      }

      // Quarterly: last value in each calendar quarter, then quarter over quarter.
      const byQuarter = new Map<string, number>();
      for (const [, p] of months) {
        const d = new Date(p.date);
        byQuarter.set(`${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`, p.value);
      }
      const quarters = Array.from(byQuarter.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      for (let i = 1; i < quarters.length; i++) {
        const prev = quarters[i - 1][1];
        const curr = quarters[i][1];
        if (!(prev > 0)) continue;
        const [yr, qPart] = quarters[i][0].split('-');
        const row = rowFor(quarters[i][0], `${qPart.replace('Q', '')}Q\n${yr}`);
        row[name] = parseFloat((((curr - prev) / prev) * 100).toFixed(1));
      }
    });

    return Array.from(rowsByKey.values()).sort((a, b) => a.key.localeCompare(b.key));
  };

  // ----------------------------------------
  // HEAD TO HEAD CORRELATION FUNCTIONS
  // ----------------------------------------
  //
  // Correlation answers a different question to the difference bars above it: not
  // "which portfolio won", but "did the two move together at all". Everything below
  // runs on MONTHLY returns whatever period the Returns buttons happen to be showing.
  // Two reasons: monthly is the convention everywhere else in finance, and the
  // rolling-CAGR views overlap each other heavily — correlating overlapping windows
  // would count the same months over and over and quietly drag the number toward 1.

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

        // EDO: a calendar year is a FRESH purchase at the prior year-end (see lib/edo.ts), not a
        // slice of one long chain — so 2022 is the bond sold in January 2022, held to Dec 2022.
        const fresh = windowPrices(ticker, priorYearData.date, endYearData.date);
        if (fresh !== undefined) {
          if (fresh === null) continue;
          result[ticker][year] = {
            return: fresh.ret,
            startDate: priorYearData.date, startPrice: fresh.startPrice,
            endDate: endYearData.date, endPrice: fresh.endPrice,
          };
          continue;
        }

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
  // NOT when toggling between Returns/Prices view or changing other UI state.
  // Checked 2026-11-13: these three are everything the function reads (edoData via windowPrices).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoizedAnnualReturns = useMemo(() => calculateAssetsAnnualReturns(), [assetData, assetLookup, edoData]);

  // Markets tab: the whole Return matrix for the selected currency (see lib/markets.ts).
  // Recomputed only when the data or the currency changes — switching the period button just
  // re-reads it, because every period's figure is already in there.
  // The Category buttons come straight from the sheet, so a new category needs no code change.
  // If the remembered choice disappears from the sheet (renamed or removed), fall back to the first.
  // "Country" is always added at the end: it isn't a SnapshotCategory but a page built from the
  // SnapshotCountry column (see buildCountryMatrix).
  // (A sheet category that happens to be called "Country" is skipped, so it can't clash with it.)
  // "Holdings" follows Country the same way: a page of what you own, built from the
  // Transactions ledger rather than from the Lookup tab (see lib/holdings.ts).
  // "EDO" (the Polish savings-bond page, built from the EDO tab — see lib/edo.ts) goes right
  // after Equities, or before Country if the sheet has no Equities category; only once the
  // EDO tab has loaded.
  const marketsCategories = useMemo(
    () => {
      const fromSheet = snapshotCategories(assetLookup)
        .filter(c => ![MARKETS_COUNTRY, MARKETS_HOLDINGS, MARKETS_EDO].some(x => x.toLowerCase() === c.toLowerCase()));
      if (edoData) {
        const eq = fromSheet.findIndex(c => c.toLowerCase() === 'equities');
        fromSheet.splice(eq >= 0 ? eq + 1 : fromSheet.length, 0, MARKETS_EDO);
      }
      return [...fromSheet, MARKETS_COUNTRY, MARKETS_HOLDINGS];
    },
    [assetLookup, edoData],
  );
  const activeMarketsCategory =
    marketsCategories.find(c => c.toLowerCase() === marketsCategory.toLowerCase()) ?? marketsCategories[0] ?? 'Assets';
  const marketsIsCountry = activeMarketsCategory === MARKETS_COUNTRY;
  const marketsIsHoldings = activeMarketsCategory === MARKETS_HOLDINGS;
  const marketsIsEdo = activeMarketsCategory === MARKETS_EDO;
  // EDO has no single price history (lib/edo.ts), so the Return matrix re-draws its column from
  // each period's own start: the "3Y" cell is the bond bought three years ago.
  // (Just the re-priced numbers: lib/markets.ts scales the column, no rows are copied.)
  const edoReanchor = useMemo(
    () => (edoData
      // (isStartDependent(ticker) spelled out: edoData is already known to be loaded here)
      ? (ticker: string, startDate: string, rows: AssetRow[]) => (ticker === EDO_TICKER ? edoChainOnRows(rows, edoData, startDate) : null)
      : undefined),
    [edoData],
  );
  const marketsMatrix = useMemo(
    () => (marketsIsHoldings || marketsIsEdo ? null : marketsIsCountry
      ? buildCountryMatrix(assetData, assetLookup, marketsCountry, edoReanchor)
      : buildReturnMatrix(assetData, assetLookup, marketsCurrency, activeMarketsCategory, edoReanchor)),
    [assetData, assetLookup, marketsCurrency, activeMarketsCategory, marketsIsCountry, marketsIsHoldings, marketsIsEdo, marketsCountry, edoReanchor],
  );
  // Markets "Holdings" page: open positions + cash in one currency. Only worked out while that
  // page is on screen; the arithmetic is in lib/holdings.ts.
  const holdingsModel = useMemo(
    () => (activeView === 'markets' && marketsIsHoldings && assetData && positionsModel
      ? buildHoldings({
          open: positionsModel.open, lookup: assetLookup, data: assetData, cash: cashAccounts,
          currency: holdingsCurrency, fxTickerMap: FX_TICKER_MAP, xirr: calculateXIRR,
        })
      : null),
    [activeView, marketsIsHoldings, assetData, positionsModel, assetLookup, cashAccounts, holdingsCurrency],
  );

  // Calendar-year returns of the xxxPLN exchange rates, for the Return Map's currency buttons.
  // Same method as calculateAssetsAnnualReturns (last price of the year vs last price of the prior
  // year), but done in one pass over the data and for FX pairs even if they aren't in the lookup table.
  // Shape: { USDPLN: { 2023: -9.8, 2024: 7.1, ... }, EURPLN: {...}, ... } in percent.
  const fxAnnualReturns = useMemo(() => {
    const result: Record<string, Record<number, number>> = {};
    if (!assetData) return result;
    const pairs = new Set([...Object.values(FX_TICKER_MAP), ...assetLookup.map(a => a.fx)].filter(Boolean));
    pairs.forEach(pair => {
      // Rows are in date order, so the last price written for a year is that year's closing price
      const yearEnd: Record<number, number> = {};
      assetData.forEach(row => {
        const price = Number(row[pair]);
        if (price > 0) yearEnd[new Date(row.date).getFullYear()] = price;
      });
      result[pair] = {};
      Object.keys(yearEnd).forEach(y => {
        const year = Number(y);
        if (yearEnd[year - 1]) result[pair][year] = (yearEnd[year] / yearEnd[year - 1] - 1) * 100;
      });
    });
    return result;
  }, [assetData, assetLookup]);

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

    // Reject if the actual start date is more than ~3 months from the target.
    // This means the asset doesn't have data going back the full requested period,
    // so it should be excluded rather than showing a shorter return mislabelled as e.g. "10Y".
    const actualStartMs = new Date(startRow.date).getTime();
    const targetStartMs = new Date(targetDateStr).getTime();
    if (actualStartMs - targetStartMs > 93 * 24 * 60 * 60 * 1000) return null;

    // EDO: "3Y" is the bond BOUGHT three years ago and held (rolled at maturity) — a fresh
    // purchase at the window's start, not a slice of one long chain (see lib/edo.ts).
    const fresh = windowPrices(ticker, startRow.date, endRow.date);
    if (fresh !== undefined) {
      if (fresh === null) return null;
      return {
        return: fresh.ret,
        startDate: startRow.date, startPrice: fresh.startPrice, endDate: endRow.date, endPrice: fresh.endPrice,
      };
    }

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

  // The chart data for one ticker (components/charts.tsx), on this screen's price table
  const getMonthlyChartData = (...args: ChartArgs) => monthlyChartData(assetData, getAssetCurrency, ...args);

  const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];


  // ============================================
  // PORTFOLIO TAB HELPER FUNCTIONS
  // ============================================

  // Use the module-level CURRENCY_SYMBOLS constant for display (e.g., "3.96M zl" or "$1.2M")

  // Per-year portfolio figures in `cur` (lib/portfolioYears.ts), from this screen's Years sheet
  const getYearlyValueSeries = (cur: string) => yearlyValueSeries(yearsData, cur);

  // One year's profit split by asset (lib/profitBreakdown.ts), on this screen's data
  const getYearlyProfitBreakdown = (year: number, currency: string): YearlyProfitBreakdown =>
    yearlyProfitBreakdown({ assetData, assetLookup, yearsData, closedData, transactionData, getOpenPurchases, getOpenDividends, getAssetCurrency }, year, currency);

  // The years the breakdown table can show (newest first), and the resolved selection
  // (the user's pick, else the latest year). Cheap, but memoised so the value below is stable.
  const breakdownYears = useMemo(
    () => Array.from(new Set(
      yearsData.map(r => parseInt(r.date.slice(0, 4), 10)).filter(y => !isNaN(y))
    )).sort((a, b) => b - a),
    [yearsData],
  );
  const resolvedBreakdownYear = (breakdownYear != null && breakdownYears.includes(breakdownYear))
    ? breakdownYear
    : (breakdownYears[0] ?? null);

  // getYearlyProfitBreakdown is the heaviest per-render computation (per-asset lot walk over
  // the transaction + closed sheets). Memoise it on its real inputs so it only recomputes when
  // the data, the selected year, or the currency actually change — not on every re-render.
  const breakdownData = useMemo(
    () => (resolvedBreakdownYear == null
      ? { assets: [] as ReturnType<typeof getYearlyProfitBreakdown>['assets'], other: 0, total: 0 }
      : getYearlyProfitBreakdown(resolvedBreakdownYear, portfolioCurrency)),
    // Everything the function reads (checked 2026-11-13). positionsModel was missing: it feeds
    // the open purchases and dividends, and only worked because it changes alongside transactionData.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedBreakdownYear, portfolioCurrency, yearsData, assetData, transactionData, closedData, assetLookup, positionsModel],
  );

  // formatPrice now lives at module scope (see the top of this file) so the shared
  // Positions components can reach it too, and there is exactly one price rule.

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
      // A value of zero can only come from the liquidation guard in calculatePortfolioReturns
      // (a normal portfolio always has some value left), so the first zero is the wipeout date.
      const wipedOutDate = returns?.find(r => r.value <= 0)?.date ?? null;
      return { portfolio, returns: returns!, stats: stats!, wipedOutDate };
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
        return <text x={x} y={y} textAnchor="middle" fontSize={9} fill={MUTED}>{payload.value}</text>;
      }
      if (py > 9) {
        // Long period — just the four-digit year
        return (
          <text x={x} y={y} textAnchor="middle" fontSize={9} fill={MUTED}>
            <tspan x={x} dy="0.8em">{d.getUTCFullYear()}</tspan>
          </text>
        );
      }
      if (py <= 1) {
        // Short period — compact "Jan26" format
        const yy = String(d.getUTCFullYear()).slice(-2);
        return (
          <text x={x} y={y} textAnchor="middle" fontSize={9} fill={MUTED}>
            <tspan x={x} dy="0.8em">{MONTH_ABBR[d.getUTCMonth()]}{yy}</tspan>
          </text>
        );
      }
      // Medium period (1–9 years) — year on top, month abbreviation below
      return (
        <text x={x} y={y} textAnchor="middle" fontSize={9} fill={MUTED}>
          <tspan x={x} dy="0.5em">{d.getUTCFullYear()}</tspan>
          <tspan x={x} dy="1.2em">{MONTH_ABBR[d.getUTCMonth()]}</tspan>
        </text>
      );
    };
  }, [backtestXAxisConfig.periodYears]);

  // ----------------------------------------
  // THE SHARED FILTER BAR (components/AssetFilterControls.tsx)
  // ----------------------------------------
  // Everything it reads, bundled once; every use below passes {...filterBarProps}.
  const filterBarProps: FilterBarProps = {
    assetLookup, selectedAssetTickers, setSelectedAssetTickers, selectedAssetClasses, setSelectedAssetClasses,
    selectedCurrencies, setSelectedCurrencies, selectedAssetSubcategories, setSelectedAssetSubcategories,
    openFilterDropdown, setOpenFilterDropdown, getUniqueAssetClasses, getUniqueCurrencies, getUniqueAssetSubcategories,
    toggleAllAssets, toggleAllAssetClasses, toggleAllCurrencies, toggleAllAssetSubcategories,
  };

  // ----------------------------------------
  // RENDER THE UI
  // ----------------------------------------



  // EDO bonds held (Lookup tickers named like a series, e.g. "EDO0734") get their price from the
  // EDO tab. If that tab failed to load, say so on the pages that value them, rather than letting
  // the holding quietly show no price.
  const heldEdoTickers = assetLookup.map(a => a.ticker).filter(t => /^EDO\d{4}$/.test(t));
  const edoMissingBanner = !edoData && heldEdoTickers.length > 0 ? (
    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      The EDO tab didn&apos;t load, so {heldEdoTickers.join(', ')} {heldEdoTickers.length === 1 ? 'has' : 'have'} no price
      below. Press Refresh Data to try again.
    </div>
  ) : null;

  // Every view, in menu order. The sidebar (wide screens) and the slide-in drawer (narrow
  // screens) are both drawn from this one list, so they can never disagree.
  // Each has a small icon drawn to the left of its label.
  const NAV_VIEWS: { view: typeof activeView; label: string; icon: React.ElementType }[] = [
    { view: 'backtest', label: 'Backtest', icon: FlaskConical },
    { view: 'markets', label: 'Markets', icon: Globe },
    { view: 'portfolio', label: 'Portfolio', icon: Briefcase },
    { view: 'positions', label: 'Positions', icon: Layers },
    { view: 'monthlyPrices', label: 'Monthly', icon: CalendarDays },
    { view: 'annualReturns', label: 'Annual', icon: CalendarRange },
    { view: 'bestToWorst', label: 'Best To Worst', icon: ArrowDownWideNarrow },
    { view: 'graphs', label: 'Graphs', icon: LineChartIcon },
    { view: 'trendFollowing', label: 'Trend Following', icon: TrendingUp },
    { view: 'correlationMatrix', label: 'Correlations', icon: Grid3x3 },
  ];
  // Sections INSIDE a view, always listed indented under it in the left panel (clicking one
  // opens that view at that section): the left panel is for moving between pages and sections,
  // the top of each page for filtering what is on it. To give another view sections, add a case here.
  //   Markets      — its categories, straight from the sheet's SnapshotCategory column
  //   Best To Worst — the one-year Ranking table or the multi-year Return Map
  const navSections = (view: typeof activeView): { items: { key: string; label: string }[]; active: string; select: (key: string) => void } | null => {
    if (view === 'markets') {
      return {
        items: marketsCategories.map(c => ({ key: c, label: c })),
        active: activeMarketsCategory,
        select: setMarketsCategory,
      };
    }
    if (view === 'bestToWorst') {
      return {
        items: [{ key: 'ranking', label: 'Ranking' }, { key: 'map', label: 'Return Map' }],
        active: bestToWorstLayout,
        select: key => setBestToWorstLayout(key as 'ranking' | 'map'),
      };
    }
    return null;
  };

  // The list of view buttons, shared by the sidebar and the drawer. Choosing one also closes
  // the drawer (harmless on wide screens, where it is never open).
  // Dark panel look: the open view is a white "pill" with dark text; the others are light grey
  // text that brightens on hover. A section counts as selected only while its own view is open.
  const navList = (
    <div className="flex flex-col gap-1">
      {NAV_VIEWS.map(({ view, label, icon: Icon }) => {
        const sections = navSections(view);
        const isActive = activeView === view;
        return (
          <React.Fragment key={view}>
            <button
              type="button"
              onClick={() => { setActiveView(view); setNavOpen(false); }}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center gap-2 text-left px-2.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-slate-700' : 'text-slate-400'}`} />
              {label}
            </button>
            {sections && sections.items.length > 0 && (
              <div className="flex flex-col gap-0.5 ml-[18px] pl-2 border-l border-white/10 mb-1">
                {sections.items.map(s => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => { setActiveView(view); sections.select(s.key); setNavOpen(false); }}
                    aria-current={isActive && sections.active === s.key ? 'true' : undefined}
                    // Markets' names come from the sheet, so a long one is cut with "…" (full name on hover)
                    // rather than pushing past the edge of the narrow panel.
                    title={s.label}
                    className={`w-full text-left px-2 py-1 rounded-md text-sm font-medium truncate transition-colors ${
                      isActive && sections.active === s.key
                        ? 'bg-white/10 text-white'
                        : 'text-slate-400 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );

  // Dark / light mode switch: a small icon-only button. Sits beside Refresh Data in the sidebar and
  // beside the close button in the narrow-screen drawer, and beside the title of the phone's page
  // menu (className gives each spot its own look).
  // The icon shows the mode it switches TO (moon = go dark, sun = go light).
  // Both icons are always there and the "dark:" classes show the right one straight from the class
  // on <html>, so a reload in dark mode shows the sun from the very first frame (no moon flicker
  // while React catches up). For screen readers it's an on/off switch with a fixed name: "Dark
  // mode, pressed" means dark mode is on.
  const themeToggle = (className: string) => (
    <button
      type="button"
      onClick={toggleDarkMode}
      aria-pressed={darkMode}
      aria-label="Dark mode"
      title="Dark mode"
      className={`shrink-0 rounded-lg transition-colors ${className}`}
    >
      <Moon className="w-4 h-4 dark:hidden" />
      <Sun className="w-4 h-4 hidden dark:block" />
    </button>
  );

  // Footer card at the bottom of the menu: how fresh the data is.
  //   "Data as of" — the last row of the Daily sheet, so a sheet that stopped updating shows up
  //                  here even after a fresh fetch. (Its pre-filled future rows are already
  //                  dropped when it is read, in lib/fetchData.ts.) If the Daily tab failed, the
  //                  price sheet's last row instead — capped at today, because that row is labelled
  //                  with the current month's END date while holding month-to-date prices.
  //   "Fetched"    — when the app last pulled from Google. Always with its date, so a page left
  //                  open overnight can't pass yesterday's fetch off as today's.
  const fmtNavDate = (iso: string) => {
    // Built from the "YYYY-MM-DD" parts directly, so no timezone can shift it by a day
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${MONTH_LABELS[m - 1]} ${y}`;
  };
  const navToday = localTodayIso();
  const lastPriceDate = assetData && assetData.length > 0 ? assetData[assetData.length - 1].date : '';
  const latestDataDate = dailyData.length > 0
    ? dailyData[dailyData.length - 1].date
    : lastPriceDate && lastPriceDate > navToday ? navToday : lastPriceDate;
  const fetchedLabel = lastFetchedAt
    ? `${lastFetchedAt.getDate()} ${MONTH_LABELS[lastFetchedAt.getMonth()]} `
      + lastFetchedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '';
  const navFooter = latestDataDate ? (
    <div className="mt-2 shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">Data as of</div>
      <div className="text-lg leading-tight text-white whitespace-nowrap">{fmtNavDate(latestDataDate)}</div>
      {fetchedLabel && <div className="mt-0.5 text-[11px] text-slate-400 whitespace-nowrap">Fetched {fetchedLabel}</div>}
    </div>
  ) : null;

  // Refresh button + load status. Lives at the top of the sidebar on wide screens; narrow
  // screens keep the original "Data" bar above the page instead (they have no sidebar).
  // (Colours chosen to read on the dark sidebar.)
  const loadStatusClass =
    loadingMessage.includes('Error') ? 'text-red-400' : 'text-slate-400';

  // Page background: flat, neutral light grey so the white cards stand out cleanly.
  //
  // LAYOUT (desktop): the same width rule as Cash Flow Tracker, so both apps fill a laptop screen
  // the same way. The page stretches with the window (20px of grey at each side) up to a block
  // 1,656px wide; only on wider screens than that does grey margin appear around it, centred.
  // (It used to be a fixed 1,268px content column, which left ~95px of empty grey each side on a
  // 1,707px-wide laptop window.)
  // From 1,520px of window width the 192px sidebar + 8px gap sits to the left of the content and
  // the content takes all the remaining width (at 1,520px that is still ~1,263px, so wide tables
  // keep the room they were sized for). Below 1,520px the sidebar disappears and a "Menu" button
  // opens the drawer instead, so the content never gives up width to navigation.
  // (The sidebar was 168px; it grew to 192px so the dark-mode icon fits beside Refresh Data.)
  //
  // The sidebar is a dark panel exactly one window tall (minus the 16px margin top and bottom),
  // pinned in place while the page scrolls, so its rounded corners always stay on screen and the
  // panel itself never moves. Inside: Refresh at the top, the menu in the middle (scrolls on its
  // own if the window is too short), the "Data as of" card at the bottom.
  //
  // PHONES (below 768px): 16px of grey page edge + 16px of card padding used up 64px of a ~375px
  // screen, so both are thinner there; the extra bottom padding keeps the last rows clear of the
  // tab bar along the bottom (56px, plus the iPhone home bar's strip when there is one).
  return (
    <div className="min-h-screen bg-page p-4 md:px-5 max-md:p-2 max-md:pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-[1656px] min-[1520px]:flex min-[1520px]:items-start min-[1520px]:gap-2">
      <nav aria-label="Pages" className="hidden min-[1520px]:block w-[192px] shrink-0 sticky top-4 h-[calc(100vh-2rem)] rounded-xl bg-gradient-to-b from-slate-900 to-black shadow-sm">
        <div className="h-full flex flex-col p-2">
          {/* Data controls: Refresh button with the dark-mode icon beside it, then the load status in small print */}
          <div className="flex gap-1.5 shrink-0">
            <button
              type="button"
              onClick={loadDataFromSheet}
              disabled={isLoading}
              className="flex-1 min-w-0 px-3 py-2 bg-white/10 text-white border border-white/10 rounded-lg hover:bg-white/15 font-semibold flex items-center justify-center gap-2 disabled:opacity-50 text-sm whitespace-nowrap"
            >
              <RefreshCw className={`w-4 h-4 shrink-0 ${isLoading ? 'animate-spin' : ''}`} />
              {isLoading ? 'Loading...' : 'Refresh Data'}
            </button>
            {themeToggle('px-2.5 bg-white/10 text-slate-300 border border-white/10 hover:bg-white/15 hover:text-white')}
          </div>
          <div className={`px-1 pt-1.5 pb-2 text-[11px] leading-snug text-center shrink-0 ${loadStatusClass}`}>
            {/* Too long for one line at this width, so break it deliberately after the first comma
                ("Loaded 128 assets" / "203 data points") instead of wherever the text happens to wrap.
                Other messages (loading, errors) have no comma and show as they are. */}
            {(loadingMessage || 'Ready').split(/,\s*/).map((part, i) => <div key={i}>{part}</div>)}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto border-t border-white/10 pt-2 [scrollbar-width:thin] [scrollbar-color:#334155_transparent]">
            {isConnected && assetData
              ? navList
              : <div className="px-3 py-2 text-xs text-slate-500">Loading data…</div>}
          </div>
          {navFooter}
        </div>
      </nav>
      <div className="min-w-0 min-[1520px]:flex-1">
        {/* Desktop only: a grey strip pinned to the top 16px of the window, so while scrolling the
            white card never shows above the top of the dark sidebar (see .page-top-mask in globals.css) */}
        <div aria-hidden="true" className="page-top-mask" />
        {/* Main card: soft rounded corners, hairline border and a very light shadow (elegant, not heavy).
            On wide screens no bottom margin, so it ends level with the dark sidebar beside it. */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4 min-[1520px]:mb-0 max-md:p-3">

          {/* Phones only: one slim line instead of the Data box and Menu button below (together they
              took about a quarter of the first screen): the page's name with the load status in
              small print under it. Pages are switched from the tab bar at the bottom, and the data
              is refreshed by pulling the page down, as in other apps. */}
          <div className="hidden max-md:flex items-center justify-between gap-3 mb-3">
            <div className="min-w-0">
              {isConnected && assetData
                ? (() => {
                    // Page name, plus the open section where the page has some ("Markets · Equities").
                    // A page with several sections: the name is a button (with ▾) that opens a
                    // slide-up list of them, so you can switch section without going through More.
                    const label = NAV_VIEWS.find(v => v.view === activeView)?.label;
                    const sections = navSections(activeView);
                    const section = sections?.items.find(s => s.key === sections.active)?.label;
                    const text = section ? `${label} · ${section}` : label;
                    if (!sections || sections.items.length < 2) {
                      return <div className="text-base font-semibold text-gray-900 truncate">{text}</div>;
                    }
                    return (
                      <>
                        <button
                          type="button"
                          onClick={() => setSectionSheetOpen(true)}
                          className="max-w-full flex items-center gap-1 text-base font-semibold text-gray-900 text-left"
                        >
                          <span className="truncate">{text}</span>
                          <ChevronDown className="w-4 h-4 shrink-0 text-gray-500" />
                        </button>
                        {sectionSheetOpen && (
                          <BottomSheet
                            title={label ?? ''}
                            options={sections.items.map(s => ({ value: s.key, label: s.label }))}
                            selected={sections.active}
                            onPick={key => sections.select(key)}
                            onClose={() => setSectionSheetOpen(false)}
                          />
                        )}
                      </>
                    );
                  })()
                : <div className="text-base font-semibold text-gray-900 truncate">Portfolio Backtester</div>}
              <div className={`text-[11px] leading-snug ${loadingMessage.includes('Error') ? 'text-red-600' : 'text-gray-500'}`}>
                {loadingMessage || 'Ready'}
              </div>
            </div>
          </div>

          {/* Data Status Section - compact single row. Narrow screens only: wide screens show
              the same Refresh button and status at the top of the sidebar instead.
              (Phones show the slim line above instead.) */}
          <div className="mb-4 px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-between min-[1520px]:hidden max-md:hidden">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-700">Data</h2>
              <span className={`text-sm ${
                loadingMessage.includes('Loaded') ? 'text-gray-900' :
                loadingMessage.includes('Error') ? 'text-red-600' :
                'text-gray-600'
              }`}>
                {loadingMessage || 'Ready'}
              </span>
            </div>
            <button
              onClick={loadDataFromSheet}
              disabled={isLoading}
              className={BTN_MAIN}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              {isLoading ? 'Loading...' : 'Refresh Data'}
            </button>
          </div>

          {/* FX data warning — raised when the sheet's exchange-rate columns contradict
              each other. Amber, not red: the app still works, but any figure converted
              through the named columns in that date range can't be trusted. */}
          {fxDataIssues.length > 0 && !fxWarningDismissed && (
            <div className="mb-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-start justify-between gap-3">
              <div className="text-xs text-amber-900">
                <span className="font-semibold">FX data check</span>
                {fxDataIssues.map(issue => (
                  <div key={issue.label} className="mt-1">
                    <span className="font-mono">{issue.label}</span> disagree in{' '}
                    <span className="font-semibold">{issue.rows} of {issue.total}</span> rows
                    {' '}({issue.firstDate} to {issue.lastDate}, worst {issue.worstPct.toFixed(1)}%).
                    {' '}One of those columns is wrong in the source sheet, so values converted
                    to or from that currency in this period are unreliable.
                  </div>
                ))}
              </div>
              <button
                onClick={() => setFxWarningDismissed(true)}
                className="text-amber-700 hover:text-amber-900 text-xs font-semibold shrink-0"
                title="Hide this warning until the page is reloaded"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Ledger warnings — rows the position replay could not honour, so the shares were
              left where they were rather than guessed at. Shown for the same reason as the FX
              banner above: a silently skipped sale looks exactly like a position you still
              hold, and nothing else on screen would tell you the difference. */}
          {positionsModel && positionsModel.warnings.length > 0 && !ledgerWarningDismissed && (
            <div className="mb-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-start justify-between gap-3">
              <div className="text-xs text-amber-900">
                <span className="font-semibold">Transactions check</span>
                {positionsModel.warnings.map(w => (
                  <div key={`${w.ticker}-${w.date}`} className="mt-1">
                    <span className="font-mono">{w.ticker}</span> {w.date} — {w.reason}.
                    {' '}The sale was skipped and the position left open, so its size and P&amp;L
                    are wrong until the row is corrected in the sheet.
                  </div>
                ))}
              </div>
              <button
                onClick={() => setLedgerWarningDismissed(true)}
                className="text-amber-700 hover:text-amber-900 text-xs font-semibold shrink-0"
                title="Hide this warning until the page is reloaded"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Navigation on narrow screens. Wide screens (1,392px+) get the sidebar on the left
              instead, so this button hides there. Tapping it slides the same list in from the
              left (see the drawer at the bottom of the page). Phones use the floating button instead. */}
          {isConnected && assetData && (
            <div className="mb-6 min-[1520px]:hidden max-md:hidden">
              <button
                type="button"
                onClick={() => setNavOpen(true)}
                className={BTN_SECOND}
                aria-label="Open navigation"
              >
                <Menu className="w-4 h-4" />
                Menu
                <span className="text-gray-400">·</span>
                <span className="text-gray-900">{NAV_VIEWS.find(v => v.view === activeView)?.label}</span>
              </button>
            </div>
          )}

          {/* Show the rest of the UI only when data is loaded */}
          {isConnected && assetData && activeView === 'backtest' && (
            <BacktestSetup
              assetData={assetData} selectedDateRange={selectedDateRange}
              setSelectedStartDate={setSelectedStartDate} setSelectedEndDate={setSelectedEndDate}
              activeDatePreset={activeDatePreset} setDatePreset={setDatePreset} getLimitingAsset={getLimitingAsset}
              startingCapital={startingCapital} setStartingCapital={setStartingCapital}
              rebalanceFreq={rebalanceFreq} setRebalanceFreq={setRebalanceFreq}
              withdrawalRate={withdrawalRate} setWithdrawalRate={setWithdrawalRate}
              inflationRate={inflationRate} setInflationRate={setInflationRate}
              portfolios={portfolios} setPortfolios={setPortfolios} presetPortfolios={presetPortfolios}
              numDrafts={numDrafts} availableAssetsFiltered={availableAssetsFiltered}
              getAssetCurrency={getAssetCurrency} getAssetDisplayName={getAssetDisplayName}
              getTotalWeight={getTotalWeight} matchingPreset={matchingPreset} generatePortfolioName={generatePortfolioName}
              applyPreset={applyPreset} addPortfolio={addPortfolio} removePortfolio={removePortfolio}
              handlePortfolioNameChange={handlePortfolioNameChange} addAssetToPortfolio={addAssetToPortfolio}
              updateAsset={updateAsset} handleNumericAssetInput={handleNumericAssetInput}
              clearNumDraft={clearNumDraft} removeAsset={removeAsset} runBacktest={runBacktest}
            />
          )}

          {/* Results Section - Only shown after running backtest AND when in backtest view */}
          {backtestResults && activeView === 'backtest' && (
            <BacktestResults
              backtestResults={backtestResults} portfolios={portfolios} selectedDateRange={selectedDateRange}
              withdrawalRate={withdrawalRate} inflationRate={inflationRate}
              backtestXAxisConfig={backtestXAxisConfig} BacktestDateTick={BacktestDateTick}
              getAnnualReturnsChartData={getAnnualReturnsChartData} getBestWorstYears={getBestWorstYears}
              getPeriodicReturnsChartData={getPeriodicReturnsChartData} getRebalancingDetails={getRebalancingDetails}
              hasCostLeg={hasCostLeg}
              backtestReturnsPeriod={backtestReturnsPeriod} setBacktestReturnsPeriod={setBacktestReturnsPeriod}
              correlationWindow={correlationWindow} setCorrelationWindow={setCorrelationWindow}
              deltaChartView={deltaChartView} setDeltaChartView={setDeltaChartView}
              deltaPortfolioA={deltaPortfolioA} setDeltaPortfolioA={setDeltaPortfolioA}
              deltaPortfolioB={deltaPortfolioB} setDeltaPortfolioB={setDeltaPortfolioB}
              selectedDetailPortfolio={selectedDetailPortfolio} setSelectedDetailPortfolio={setSelectedDetailPortfolio}
              selectedRebalancingPortfolio={selectedRebalancingPortfolio} setSelectedRebalancingPortfolio={setSelectedRebalancingPortfolio}
            />
          )}

          {/* Assets Annual Returns Section - Shown when in annualReturns view */}
          {/* This table shows yearly returns for ALL assets in the lookup table */}
          {isConnected && assetData && activeView === 'annualReturns' && (
            <AnnualReturnsTab
              assetData={assetData} assetLookup={assetLookup} filteredAssets={getFilteredAssetLookup()}
              memoizedAnnualReturns={memoizedAnnualReturns} getPeriodReturn={getPeriodReturn}
              annualViewMode={annualViewMode} setAnnualViewMode={setAnnualViewMode}
              annualReturnsSortColumn={annualReturnsSortColumn} setAnnualReturnsSortColumn={setAnnualReturnsSortColumn}
              selectedYears={selectedYears} setSelectedYears={setSelectedYears}
              yearsDropdownOpen={yearsDropdownOpen} setYearsDropdownOpen={setYearsDropdownOpen}
              yearsDropdownRef={yearsDropdownRef}
              renderFilters={extra => <AssetFilterControls {...filterBarProps}>{extra}</AssetFilterControls>}
            />
          )}

          {/* Best To Worst Section - assets ranked by return for a selected year (Ranking), or */}
          {/* several years side by side (Return Map); the left panel switches between the two */}
          {isConnected && assetData && activeView === 'bestToWorst' && (
            <BestToWorstTab
              assetLookup={assetLookup} filteredAssets={getFilteredAssetLookup()}
              memoizedAnnualReturns={memoizedAnnualReturns} fxAnnualReturns={fxAnnualReturns}
              getPeriodReturn={getPeriodReturn} bestToWorstLayout={bestToWorstLayout}
              bestToWorstMode={bestToWorstMode} setBestToWorstMode={setBestToWorstMode}
              selectedRankingYear={selectedRankingYear} setSelectedRankingYear={setSelectedRankingYear}
              returnMapWindow={returnMapWindow} setReturnMapWindow={setReturnMapWindow}
              returnMapCurrency={returnMapCurrency} setReturnMapCurrency={setReturnMapCurrency}
              returnMapHighlight={returnMapHighlight} setReturnMapHighlight={setReturnMapHighlight}
              returnMapTracked={returnMapTracked} setReturnMapTracked={setReturnMapTracked}
              renderFilters={extra => <AssetFilterControls {...filterBarProps}>{extra}</AssetFilterControls>}
            />
          )}

          {/* Markets tab — a one-screen overview: the Return matrix for the category chosen in the */}
          {/* left panel (Assets, Equities, Macro... from the sheet's SnapshotCategory column, plus the */}
          {/* Country page), in Returns or Stats view. All the arithmetic is in lib/markets.ts. */}
          {/* (The Holdings and EDO pages are drawn by their own blocks below, so this one stands aside for them.) */}
          {isConnected && assetData && activeView === 'markets' && !marketsIsHoldings && !marketsIsEdo && (
            <MarketsTab
              assetLookup={assetLookup} getAssetCurrency={getAssetCurrency}
              activeMarketsCategory={activeMarketsCategory} marketsIsCountry={marketsIsCountry} marketsMatrix={marketsMatrix}
              marketsView={marketsView} setMarketsView={setMarketsView}
              marketsPeriod={marketsPeriod} setMarketsPeriod={setMarketsPeriod} marketsSavedPeriod={marketsSavedPeriod}
              marketsCurrency={marketsCurrency} setMarketsCurrency={setMarketsCurrency}
              marketsCountry={marketsCountry} setMarketsCountry={setMarketsCountry}
              marketsTrendPeriod={marketsTrendPeriod} setMarketsTrendPeriod={setMarketsTrendPeriod}
              marketsChartRange={marketsChartRange} setMarketsChartRange={setMarketsChartRange}
              setActiveView={setActiveView} setMonthlySelectedTicker={setMonthlySelectedTicker}
              setMonthlyDisplayCurrency={setMonthlyDisplayCurrency} setSelectedAssetTickers={setSelectedAssetTickers}
              setSelectedAssetClasses={setSelectedAssetClasses} setSelectedCurrencies={setSelectedCurrencies}
              setSelectedAssetSubcategories={setSelectedAssetSubcategories}
            />
          )}

          {/* Markets tab, Holdings page — what you own today, in the Markets look: open positions */}
          {/* (shares still held, as in Positions › Open Positions) plus cash, grouped by asset class, */}
          {/* every money figure in one currency. The arithmetic is in lib/holdings.ts. */}
          {isConnected && assetData && activeView === 'markets' && marketsIsHoldings && (
            <HoldingsTab
              holdingsModel={holdingsModel} positionsModel={positionsModel} edoMissingBanner={edoMissingBanner}
              holdingsCurrency={holdingsCurrency} setHoldingsCurrency={setHoldingsCurrency} setActiveView={setActiveView}
              setOpenSelectedTicker={setOpenSelectedTicker} setClosedSelectedTicker={setClosedSelectedTicker}
              setCashCategory={setCashCategory} setCashSelected={setCashSelected} setOpenIncludedTxns={setOpenIncludedTxns}
              setOpenSinceInvested={setOpenSinceInvested} setOpenShowMinMax={setOpenShowMinMax}
              setOpenShowAvgBuy={setOpenShowAvgBuy} setOpenInvestedFrom={setOpenInvestedFrom}
              setOpenInvestedInto={setOpenInvestedInto} setOpenGraphStarts={setOpenGraphStarts}
              setOpenGraphEnds={setOpenGraphEnds}
            />
          )}

          {/* Markets "EDO" page — Polish 10-year inflation-linked savings bonds, from the sheet's */}
          {/* EDO tab: the rates and margins every series was sold on, one series' value since */}
          {/* purchase against inflation and after tax, and the full series list. Arithmetic in lib/edo.ts. */}
          {isConnected && assetData && activeView === 'markets' && marketsIsEdo && (
            <EdoTab
              assetData={assetData} edoData={edoData} edoSelected={edoSelected} setEdoSelected={setEdoSelected}
              edoLines={edoLines} setEdoLines={setEdoLines}
              edoStatusFilter={edoStatusFilter} setEdoStatusFilter={setEdoStatusFilter}
              edoMaturedTax={edoMaturedTax} setEdoMaturedTax={setEdoMaturedTax}
              edoMaturedReal={edoMaturedReal} setEdoMaturedReal={setEdoMaturedReal}
            />
          )}

          {/* Monthly Prices Section - Shows 13 months of raw prices with heatmap and signals */}
          {isConnected && assetData && activeView === 'monthlyPrices' && (
            <MonthlyTab
              assetData={assetData} assetLookup={assetLookup} filteredAssets={getFilteredAssetLookup()}
              getAssetCurrency={getAssetCurrency} calculatePortfolioReturns={calculatePortfolioReturns}
              isStartDependent={isStartDependent} windowPrices={windowPrices} endMonthChoices={endMonthChoices}
              selectedEndDate={selectedEndDate} rebalanceFreq={rebalanceFreq}
              monthlyChartPeriod={monthlyChartPeriod} setMonthlyChartPeriod={setMonthlyChartPeriod}
              monthlyDisplayCurrency={monthlyDisplayCurrency} setMonthlyDisplayCurrency={setMonthlyDisplayCurrency}
              monthlyEndDate={monthlyEndDate} setMonthlyEndDate={setMonthlyEndDate}
              monthlyPriceChartLog={monthlyPriceChartLog} setMonthlyPriceChartLog={setMonthlyPriceChartLog}
              monthlyPriceChartMode={monthlyPriceChartMode} setMonthlyPriceChartMode={setMonthlyPriceChartMode}
              monthlySelectedTicker={monthlySelectedTicker} setMonthlySelectedTicker={setMonthlySelectedTicker}
              monthlySortColumn={monthlySortColumn} setMonthlySortColumn={setMonthlySortColumn}
              monthlyStatsExpanded={monthlyStatsExpanded} setMonthlyStatsExpanded={setMonthlyStatsExpanded}
              monthlyViewMode={monthlyViewMode} setMonthlyViewMode={setMonthlyViewMode}
              returnsChartPeriod={returnsChartPeriod} setReturnsChartPeriod={setReturnsChartPeriod}
              seasonMonth={seasonMonth} setSeasonMonth={setSeasonMonth}
              stressYear={stressYear} setStressYear={setStressYear}
              renderFilters={extra => <AssetFilterControls {...filterBarProps}>{extra}</AssetFilterControls>}
            />
          )}

          {/* ============================================
              GRAPHS TAB
              ============================================
              A responsive grid of small line charts — one per asset.
              Each chart shows monthly prices over a selectable period,
              with the ticker and period return in the title. */}
          {isConnected && assetData && activeView === 'graphs' && (
            <GraphsTab
              filteredAssets={getFilteredAssetLookup()} getMonthlyChartData={getMonthlyChartData}
              endMonthChoices={endMonthChoices}
              graphsPeriod={graphsPeriod} setGraphsPeriod={setGraphsPeriod}
              graphsEndDate={graphsEndDate} setGraphsEndDate={setGraphsEndDate}
              graphsShowSMA={graphsShowSMA} setGraphsShowSMA={setGraphsShowSMA}
              renderFilters={smaToggle => <AssetFilterControls {...filterBarProps}>{smaToggle}</AssetFilterControls>}
            />
          )}

          {/* Trend Following Section - Compares Buy & Hold vs 10-month SMA strategy */}
          {isConnected && assetData && activeView === 'trendFollowing' && (
            <TrendFollowingTab
              assetData={assetData} assetLookup={assetLookup} selectedDateRange={selectedDateRange}
              setSelectedStartDate={setSelectedStartDate} setSelectedEndDate={setSelectedEndDate}
              selectedTrendAsset={selectedTrendAsset} setSelectedTrendAsset={setSelectedTrendAsset}
              trendRiskFreeRate={trendRiskFreeRate} setTrendRiskFreeRate={setTrendRiskFreeRate}
              trendCommission={trendCommission} setTrendCommission={setTrendCommission}
            />
          )}

          {/* ============================================ */}
          {/* CORRELATION MATRIX TAB */}
          {/* ============================================ */}
          {/* Shows how different assets move together (or apart). */}
          {/* A correlation of +1 means they move in lockstep (bad for diversification). */}
          {/* A correlation of -1 means they move in opposite directions (great for diversification). */}
          {/* 0 means no relationship at all. */}
          {isConnected && assetData && activeView === 'correlationMatrix' && (
            <CorrelationsTab
              assetData={assetData} assetLookup={assetLookup} filteredAssets={getFilteredAssetLookup()}
              correlationPeriod={correlationPeriod} setCorrelationPeriod={setCorrelationPeriod}
              renderFilters={periodControl => <AssetFilterControls {...filterBarProps}>{periodControl}</AssetFilterControls>}
            />
          )}

          {/* ============================================ */}
          {/* PORTFOLIO TAB                                */}
          {/* Shows annual portfolio data from the Years sheet: */}
          {/* Chart 1: Portfolio Value (stacked bar)        */}
          {/* Chart 2: Contributions & Profit (stacked + growth label) */}
          {/* Chart 3: Returns by Year (grouped bars)       */}
          {/* ============================================ */}
          {isConnected && activeView === 'portfolio' && (
            <PortfolioTab
              assetData={assetData} yearsData={yearsData} dailyData={dailyData}
              getAssetCurrency={getAssetCurrency} getAssetFirstAvailableDate={getAssetFirstAvailableDate}
              getYearlyValueSeries={getYearlyValueSeries}
              breakdownData={breakdownData} breakdownYears={breakdownYears}
              resolvedBreakdownYear={resolvedBreakdownYear} setBreakdownYear={setBreakdownYear}
              breakdownExpanded={breakdownExpanded} setBreakdownExpanded={setBreakdownExpanded}
              portfolioCurrency={portfolioCurrency} setPortfolioCurrency={setPortfolioCurrency}
              selectedReturnCurrencies={selectedReturnCurrencies} setSelectedReturnCurrencies={setSelectedReturnCurrencies}
              dailyNavCurrency={dailyNavCurrency} setDailyNavCurrency={setDailyNavCurrency}
              dailyNavPeriod={dailyNavPeriod} setDailyNavPeriod={setDailyNavPeriod}
              dailyNavBenchmark={dailyNavBenchmark} setDailyNavBenchmark={setDailyNavBenchmark}
              ddPeriod={ddPeriod} setDdPeriod={setDdPeriod}
              ddSelectedCurrencies={ddSelectedCurrencies} setDdSelectedCurrencies={setDdSelectedCurrencies}
            />
          )}

          {/* ============================================ */}
          {/* POSITIONS TAB (Open + Closed)               */}
          {/* ============================================ */}
          {isConnected && assetData && activeView === 'positions' && (
            <PositionsTab
              assetData={assetData} assetLookup={assetLookup} closedData={closedData} transactionData={transactionData}
              positionsModel={positionsModel} cashAccounts={cashAccounts} edoMissingBanner={edoMissingBanner}
              calculateXIRR={calculateXIRR} getClosedTransactions={getClosedTransactions}
              getOpenPurchases={getOpenPurchases} getOpenDividends={getOpenDividends}
              tableSort={tableSort} sortPropsFor={sortPropsFor}
              closedSelectAllRef={closedSelectAllRef} openSelectAllRef={openSelectAllRef}
              positionsCurrency={positionsCurrency} setPositionsCurrency={setPositionsCurrency}
              groupMetalsCrypto={groupMetalsCrypto} setGroupMetalsCrypto={setGroupMetalsCrypto}
              cashCategory={cashCategory} setCashCategory={setCashCategory}
              cashSelected={cashSelected} setCashSelected={setCashSelected}
              openAccountFilter={openAccountFilter} setOpenAccountFilter={setOpenAccountFilter}
              openAssetClassFilter={openAssetClassFilter} setOpenAssetClassFilter={setOpenAssetClassFilter}
              openCurrencyFilter={openCurrencyFilter} setOpenCurrencyFilter={setOpenCurrencyFilter}
              openSelectedTicker={openSelectedTicker} setOpenSelectedTicker={setOpenSelectedTicker}
              openIncludedTxns={openIncludedTxns} setOpenIncludedTxns={setOpenIncludedTxns}
              openSinceInvested={openSinceInvested} setOpenSinceInvested={setOpenSinceInvested}
              openShowMinMax={openShowMinMax} setOpenShowMinMax={setOpenShowMinMax}
              openShowAvgBuy={openShowAvgBuy} setOpenShowAvgBuy={setOpenShowAvgBuy}
              openInvestedFrom={openInvestedFrom} setOpenInvestedFrom={setOpenInvestedFrom}
              openInvestedInto={openInvestedInto} setOpenInvestedInto={setOpenInvestedInto}
              openGraphStarts={openGraphStarts} setOpenGraphStarts={setOpenGraphStarts}
              openGraphEnds={openGraphEnds} setOpenGraphEnds={setOpenGraphEnds}
              closedSelectedTicker={closedSelectedTicker} setClosedSelectedTicker={setClosedSelectedTicker}
              closedIncludedTxns={closedIncludedTxns} setClosedIncludedTxns={setClosedIncludedTxns}
              closedSinceInvested={closedSinceInvested} setClosedSinceInvested={setClosedSinceInvested}
              closedUntilSold={closedUntilSold} setClosedUntilSold={setClosedUntilSold}
              closedShowMinMax={closedShowMinMax} setClosedShowMinMax={setClosedShowMinMax}
              closedShowAvgBuy={closedShowAvgBuy} setClosedShowAvgBuy={setClosedShowAvgBuy}
              closedShowAvgSell={closedShowAvgSell} setClosedShowAvgSell={setClosedShowAvgSell}
              closedInvestedFrom={closedInvestedFrom} setClosedInvestedFrom={setClosedInvestedFrom}
              closedInvestedInto={closedInvestedInto} setClosedInvestedInto={setClosedInvestedInto}
              closedGraphStarts={closedGraphStarts} setClosedGraphStarts={setClosedGraphStarts}
              closedGraphEnds={closedGraphEnds} setClosedGraphEnds={setClosedGraphEnds}
            />
          )}
        </div>
      </div>
      </div>

      {/* Phones: "More" in the tab bar opens the page menu as a slide-up panel, like every other
          choice on a phone: each page with its icon, the sections of Markets and Best To Worst
          indented under it, a tick on the one that's open. The dark-mode button sits beside the
          title, and how fresh the data is fits on one line at the bottom. */}
      {navOpen && isPhoneScreen() && (
        <BottomSheet
          title="Pages"
          options={NAV_VIEWS.flatMap(({ view, label, icon }) => [
            { value: `v:${view}`, label, icon },
            ...(navSections(view)?.items ?? []).map(s => ({ value: `s:${view}:${s.key}`, label: s.label, indent: true })),
          ])}
          selected={(() => {
            const sections = navSections(activeView);
            return sections && sections.items.length > 0 ? `s:${activeView}:${sections.active}` : `v:${activeView}`;
          })()}
          onPick={value => {
            // "v:markets" = a page; "s:markets:Equities" = a section of it (a name may contain ":")
            const [kind, view, ...rest] = value.split(':');
            setActiveView(view as typeof activeView);
            if (kind === 's') navSections(view as typeof activeView)?.select(rest.join(':'));
          }}
          onClose={() => setNavOpen(false)}
          headerExtra={themeToggle('p-2 text-gray-600 bg-gray-100 border border-gray-200 [&_svg]:w-5 [&_svg]:h-5')}
          footer={latestDataDate ? (
            <div className="text-xs text-gray-500 truncate">
              Data as of <span className="font-medium text-gray-900">{fmtNavDate(latestDataDate)}</span>
              {fetchedLabel && ` · Fetched ${fetchedLabel}`}
            </div>
          ) : undefined}
        />
      )}

      {/* Slide-in navigation drawer (narrow screens other than phones), opened by the "Menu" button.
          Tapping the dimmed backdrop, the close button, or any view closes it. */}
      {navOpen && !isPhoneScreen() && (
        <div className="fixed inset-0 z-50 min-[1520px]:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/30" onClick={() => setNavOpen(false)} />
          {/* Same dark look as the wide-screen sidebar: menu scrolls, "Data as of" card stays at the bottom. */}
          <nav aria-label="Pages" className="absolute left-0 top-0 bottom-0 w-64 max-w-[80vw] bg-gradient-to-b from-slate-900 to-black shadow-xl p-3 flex flex-col">
            <div className="flex items-center justify-between mb-2 px-1 shrink-0">
              <span className="text-sm font-semibold text-slate-300">Views</span>
              <div className="flex items-center gap-1">
              {themeToggle('p-1.5 text-slate-400 hover:bg-white/10 hover:text-white')}
              <button
                type="button"
                onClick={() => setNavOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
                aria-label="Close navigation"
              >
                <X className="w-4 h-4" />
              </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">{navList}</div>
            {navFooter}
          </nav>
        </div>
      )}

      {/* Phones only: every dropdown opens a slide-up panel instead of the browser's list */}
      <PhoneSelectSheets />

      {/* Phones: the tick lists of the shared asset filters (AssetFilterControls, on Ranking,
          Graphs, Monthly...) and of the Positions tab's Assets filter, as slide-up panels like
          every other choice; their drop-down lists are hidden on phones. Drawn here rather than
          inside AssetFilterControls, which is rebuilt from scratch on every tick (it's defined
          inside this component) and would replay the panel's slide-in each time. */}
      {openFilterDropdown && isPhoneScreen() && (() => {
        const lists = {
          assets: { title: 'Assets', options: assetLookup.map(a => ({ value: a.ticker, label: a.ticker, hint: a.name })),
            checked: selectedAssetTickers, set: setSelectedAssetTickers, setAll: toggleAllAssets },
          assetClass: { title: 'Class', options: getUniqueAssetClasses().map(v => ({ value: v, label: v })),
            checked: selectedAssetClasses, set: setSelectedAssetClasses, setAll: toggleAllAssetClasses },
          currency: { title: 'Currency', options: getUniqueCurrencies().map(v => ({ value: v, label: v })),
            checked: selectedCurrencies, set: setSelectedCurrencies, setAll: toggleAllCurrencies },
          assetSubcategory: { title: 'Subcategory', options: getUniqueAssetSubcategories().map(v => ({ value: v, label: v })),
            checked: selectedAssetSubcategories, set: setSelectedAssetSubcategories, setAll: toggleAllAssetSubcategories },
        };
        const list = lists[openFilterDropdown];
        return (
          <PhoneCheckSheet
            title={list.title}
            options={list.options}
            checked={list.checked}
            onToggle={v => list.set(list.checked.includes(v) ? list.checked.filter(x => x !== v) : [...list.checked, v])}
            onSetAll={list.setAll}
            onClose={() => setOpenFilterDropdown(null)}
          />
        );
      })()}

      {/* Phones only: the pull-to-refresh arrow. It waits just above the top edge, invisible, and
          is moved into view by the touch handlers next to loadDataFromSheet. */}
      <div
        ref={pullIndicatorRef}
        aria-hidden="true"
        className="hidden max-md:flex fixed left-1/2 -ml-5 -top-11 z-50 w-10 h-10 rounded-full bg-white border border-gray-200 shadow-md text-gray-700 items-center justify-center pointer-events-none"
        style={{ opacity: 0 }}
      >
        <RefreshCw className="w-5 h-5" />
      </div>

      {/* Phones only: the tab bar along the bottom, like most phone apps. The four most-used pages
          are one tap away; "More" opens the full menu (the drawer) for the rest, and is the one
          lit up while you're on one of those other pages. Each page reopens where you left it;
          tapping the page you're already on scrolls back to its top, as apps do.
          env(safe-area-inset-bottom) keeps it above the iPhone's home bar when the app runs full
          screen. (Its aria-label is deliberately not "Pages": app/dark.css styles that one.) */}
      {isConnected && assetData && (() => {
        const tabs: { label: string; icon: React.ElementType; active: boolean; go: () => void }[] = [
          { label: 'Portfolio', icon: Briefcase, active: activeView === 'portfolio', go: () => setActiveView('portfolio') },
          { label: 'Positions', icon: Layers, active: activeView === 'positions', go: () => setActiveView('positions') },
          { label: 'Markets', icon: Globe, active: activeView === 'markets', go: () => setActiveView('markets') },
          {
            label: 'Ranking', icon: ArrowDownWideNarrow,
            active: activeView === 'bestToWorst' && bestToWorstLayout === 'ranking',
            go: () => { setActiveView('bestToWorst'); setBestToWorstLayout('ranking'); },
          },
        ];
        const onOtherPage = !tabs.some(t => t.active);
        return (
          <nav
            aria-label="Main pages"
            className="hidden max-md:grid grid-cols-5 fixed inset-x-0 bottom-0 z-40 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]"
          >
            {[...tabs, { label: 'More', icon: Menu, active: onOtherPage, go: () => setNavOpen(true) }].map(({ label, icon: Icon, active, go }) => (
              <button
                key={label}
                type="button"
                // (The page that opens goes back to where it was scrolled last time: see
                // "EACH PAGE KEEPS ITS PLACE")
                onClick={() => {
                  if (active && label !== 'More') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
                  go();
                }}
                aria-current={active && label !== 'More' ? 'page' : undefined}
                className={`h-14 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? 'text-slate-900' : 'text-gray-500'}`}
              >
                {/* The open page's icon sits in a soft grey pill */}
                <span className={`px-4 py-0.5 rounded-full ${active ? 'bg-gray-100' : ''}`}>
                  <Icon className="w-5 h-5" />
                </span>
                {label}
              </button>
            ))}
          </nav>
        );
      })()}
    </div>
  );
};

export default PortfolioBacktester;
