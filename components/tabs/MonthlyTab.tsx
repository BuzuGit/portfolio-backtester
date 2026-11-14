/*
  THE MONTHLY TAB

  The month-by-month view of every filtered asset: the price / returns grid with SMA signals, and
  for a selected asset its price chart (price, SMA, drawdowns, real terms, vs market, inflation),
  calendar returns, statistics against IWDA and a 50/50 blend, rolling and periodic returns,
  seasonality (which month loses least often) and a year under stress against world equities.

  Its helpers (the price grid, the EDO-aware calendar, seasonality and stress-year data) moved here
  word for word: only this tab uses them. The chart data comes from components/charts.tsx; the
  backtest engine (for the 50/50 blend), the EDO helpers and every choice on this tab live in the
  main screen and are passed in, so the choices survive switching tabs.
*/
import React from 'react';
import {
  Line, BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ComposedChart, Area, ReferenceDot, ReferenceLine, AreaChart, Customized,
} from 'recharts';
import type { AssetRow, AssetLookup } from '@/lib/fetchData';
import { cagrPct, yearsBetween } from '@/lib/stats';
import { MONTH_ABBR, toYM } from '@/lib/dates';
import { monthEndIso, monthKeyOf } from '@/lib/edo';
import {
  calculateMonthlyReturns, calculateStatistics, formatPeriod, getConversionRate,
  type MonthlyReturns, type Portfolio, type ReturnPoint,
} from '@/lib/backtest';
import { PhoneChoice, periodOptions } from '@/components/PhoneSheet';
import {
  BENCH_LABEL, BLACK, CAGR_HINT, CHART_PALETTE, FIELD, GAIN, GAIN_DEEP, GAIN_PILL, HALO, INK, INK_SOFT, LOSS,
  LOSS_DEEP, LOSS_PILL, MUTED, MUTED_LABEL, ResponsiveContainer, SEG, SHARPE_HINT, SMA_COLOR, WINE_LABEL,
  formatPrice, getHeatmapColor, getPriceHeatmap, heatColor, lossBarLabel, lossLabelRoom, heatTextOn,
  segBtn, themedCell, type MonthlyChartPeriod,
} from '@/components/ui';
import {
  BLEND_LINE_COLOR, CURRENCY_CPI, DateAxisTick, MARKET_LINE_COLOR, MONTHLY_CHART_PERIODS, MONTH_FULL,
  RETURNS_PERIOD_CHOICES, ROLLING_RETURN_YEARS, STREAK_VIEWS, UpMonthsSummary, findUnderwaterPeriods,
  monthlyChartData, niceAxisScale, niceLogAxisScale, renderEdgeBubbles, withHighWaterMark,
  type BubbleDef, type MonthlyChartArgs, type RechartsCustomizedProps, type ReturnsBar, type ReturnsChartPeriod,
} from '@/components/charts';

export type MonthlyPriceChartMode = 'price' | 'sma' | 'drawdown' | 'drawdownReal' | 'vsMarket' | 'inflation';

export interface MonthlyTabProps {
  assetData: AssetRow[];
  assetLookup: AssetLookup[];
  filteredAssets: AssetLookup[];                       // the assets passing the filter bar, in order
  getAssetCurrency: (ticker: string) => string;
  calculatePortfolioReturns: (portfolio: Portfolio, data: AssetRow[],
    overrides?: { start?: string; end?: string; rebalanceFreq?: string }) => ReturnPoint[] | null;
  isStartDependent: (ticker: string) => boolean;       // EDO: does the price depend on the purchase date?
  windowPrices: (ticker: string, start: string, end: string) => { startPrice: number; endPrice: number; ret: number } | null | undefined;
  endMonthChoices: { value: string; label: string }[];
  selectedEndDate: string;                             // the Backtest tab's end date (a fallback here)
  rebalanceFreq: string;
  monthlyChartPeriod: MonthlyChartPeriod; setMonthlyChartPeriod: (p: MonthlyChartPeriod) => void;
  monthlyDisplayCurrency: string; setMonthlyDisplayCurrency: (c: string) => void;
  monthlyEndDate: string; setMonthlyEndDate: (d: string) => void;
  monthlyPriceChartLog: boolean; setMonthlyPriceChartLog: (on: boolean) => void;
  monthlyPriceChartMode: MonthlyPriceChartMode; setMonthlyPriceChartMode: (m: MonthlyPriceChartMode) => void;
  monthlySelectedTicker: string; setMonthlySelectedTicker: React.Dispatch<React.SetStateAction<string>>;
  monthlySortColumn: string | null; setMonthlySortColumn: (c: string | null) => void;
  monthlyStatsExpanded: boolean; setMonthlyStatsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  monthlyViewMode: 'prices' | 'returns'; setMonthlyViewMode: (m: 'prices' | 'returns') => void;
  returnsChartPeriod: ReturnsChartPeriod; setReturnsChartPeriod: (p: ReturnsChartPeriod) => void;
  seasonMonth: number | null; setSeasonMonth: (m: number | null) => void;
  stressYear: number; setStressYear: (y: number) => void;
  renderFilters: (extraControls: React.ReactNode) => React.ReactNode;
}

export default function MonthlyTab({
  assetData, assetLookup, filteredAssets, getAssetCurrency, calculatePortfolioReturns, isStartDependent,
  windowPrices, endMonthChoices, selectedEndDate, rebalanceFreq,
  monthlyChartPeriod, setMonthlyChartPeriod, monthlyDisplayCurrency, setMonthlyDisplayCurrency,
  monthlyEndDate, setMonthlyEndDate, monthlyPriceChartLog, setMonthlyPriceChartLog,
  monthlyPriceChartMode, setMonthlyPriceChartMode, monthlySelectedTicker, setMonthlySelectedTicker,
  monthlySortColumn, setMonthlySortColumn, monthlyStatsExpanded, setMonthlyStatsExpanded,
  monthlyViewMode, setMonthlyViewMode, returnsChartPeriod, setReturnsChartPeriod,
  seasonMonth, setSeasonMonth, stressYear, setStressYear, renderFilters,
}: MonthlyTabProps) {
  // The names the moved code uses for things it used to reach in the main screen
  const getFilteredAssetLookup = () => filteredAssets;
  const getMonthlyChartData = (...args: MonthlyChartArgs) => monthlyChartData(assetData, getAssetCurrency, ...args);
  const MONTH_LABELS = MONTH_ABBR;   // the same twelve short month names

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
      prevPrices: (number | null)[]; // the month-end price before each of those 13 months
      startDependent: boolean;    // EDO: each month is a fresh purchase, not a price ratio
      returns: (number | null)[]; // 13 monthly returns (%), null if can't compute
      sma10: number | null;       // 10-month SMA (average of last 10 months including current)
      signal: 'BUY' | 'SELL' | null;  // BUY if price > SMA, SELL if price < SMA
      signals: ('BUY' | 'SELL' | null)[];  // Signal at each of 13 months (for historical view)
      dd12m: number | null;       // 12-month drawdown: how far current price is below the 12-month high (%)
      ret12m: number | null;      // 12-month return: % change from first to last of the 13 displayed months
    }>;
    prevMonth: string;            // label of the month before the first displayed month
  } => {
    if (!assetData || assetData.length === 0) {
      return { months: [], assets: [], prevMonth: '' };
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

    // Group the price history by calendar month ONCE, up front.
    //
    // This used to be a `.filter()` over the whole history inside getLastPriceOfMonth, which
    // meant re-scanning all 202 rows — and building a Date object for each — separately for
    // every ticker AND every month. With the asset filter widened to all 92 tickers that is
    // 92 x 22 = 2,024 full passes, around 410,000 Date constructions, on EVERY render of the
    // tab: measured at 209ms, i.e. a visible stall on each repaint. Indexing once costs 202
    // Date constructions and turns the lookup into a Map hit: the same work drops to 0.3ms.
    //
    // Keyed year*12+month so a single integer identifies a calendar month. Insertion order is
    // preserved within each bucket, so "the last row of the month" is still the last entry.
    const rowsByMonth = new Map<number, typeof assetData>();
    for (const row of assetData) {
      const d = new Date(row.date);
      if (isNaN(d.getTime())) continue;
      const key = d.getFullYear() * 12 + d.getMonth();
      const bucket = rowsByMonth.get(key);
      if (bucket) bucket.push(row); else rowsByMonth.set(key, [row]);
    }

    // For each month, find the last trading day's price for each asset
    const getLastPriceOfMonth = (ticker: string, year: number, month: number): number | null => {
      const monthRows = rowsByMonth.get(year * 12 + month) || [];

      // Get the last row that actually carries a value for this ticker.
      //
      // "Carries a value" means the key is present, not that the number is positive. The CSV
      // parser omits blank cells entirely (see parseSheetData), so presence IS the test — and
      // that is what lets a macro series show a true 0 or a negative rate instead of a dash.
      // Asking `price > 0` here is what turned Swiss rates into a row of "-".
      for (let i = monthRows.length - 1; i >= 0; i--) {
        const raw = monthRows[i][ticker];
        if (raw === undefined || raw === '') continue;
        const price = Number(raw);
        if (isFinite(price)) {
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

      // EDO: each month's return (and the 12M one) is a FRESH purchase at the previous month-end,
      // the same rule as the Annual tab and Best to Worst (lib/edo.ts). Prices stay the one chain.
      const freshReturn = (from: Date, to: Date): number | null => {
        const w = windowPrices(asset.ticker, monthEndIso(from.getFullYear() * 12 + from.getMonth()), monthEndIso(to.getFullYear() * 12 + to.getMonth()));
        return w ? w.ret : null;
      };
      const startDependent = isStartDependent(asset.ticker);

      return {
        ticker: asset.ticker,
        name: asset.name,
        prices,
        // The month-end price BEFORE each displayed month: what each month's return starts from
        // (only for the Returns table's tooltip, which shows how the return was worked out)
        prevPrices: allPrices.slice(8, 21),
        startDependent,
        returns: startDependent
          ? returns.map((r, i) => (r === null ? null : freshReturn(allMonthDates[i + 8], monthDates[i])))
          : returns,
        sma10,
        signal,
        signals,
        dd12m,
        ret12m: startDependent && ret12m !== null ? freshReturn(monthDates[0], monthDates[12]) : ret12m
      };
    });

    // The label of the month before the first displayed one ("Oct25"), for that column's tooltip
    const d0 = allMonthDates[8];
    const prevMonth = `${d0.toLocaleDateString('en-US', { month: 'short' })}${d0.getFullYear().toString().slice(-2)}`;

    return { months, assets, prevMonth };
  };

  /**
   * A start-dependent asset (EDO) in the Monthly tab's calendar returns table: every month (and
   * FY) is re-priced as a FRESH purchase at the previous month-end (or the year's start) — the
   * same rule as the Annual tab and Best to Worst (lib/edo.ts) — rather than read off the one
   * chain the price line draws. Converted into the display currency with the same month-end FX
   * rates as the line.
   *
   * Every figure in the result is on that one basis: FY runs from the month-end before the year's
   * first fresh month (normally last December) to its last; a year with no fresh month at all is
   * left out rather than filled from the chain.
   */
  const freshCalendar = (ticker: string, mr: MonthlyReturns, displayCcy: string): MonthlyReturns => {
    if (!isStartDependent(ticker) || !assetData) return mr;
    const nativeCcy = getAssetCurrency(ticker);
    const rowByMonth = new Map<number, AssetRow>();
    assetData.forEach(r => rowByMonth.set(monthKeyOf(String(r.date)), r));
    // Return (%) from the month-end of month `from` to the month-end of month `to`, in displayCcy.
    const fresh = (from: number, to: number): number | null => {
      const a = rowByMonth.get(from), b = rowByMonth.get(to);
      if (!a || !b) return null;
      const w = windowPrices(ticker, String(a.date), String(b.date));
      if (!w) return null;
      const fx = getConversionRate(b, nativeCcy, displayCcy) / getConversionRate(a, nativeCcy, displayCcy);
      // In its own currency this is exactly the window's return (no division, so no float drift).
      return fx === 1 ? w.ret : ((1 + w.ret / 100) * fx - 1) * 100;
    };
    const out: MonthlyReturns = {};
    Object.entries(mr).forEach(([y, row]) => {
      const year = Number(y);
      const monthly = row.monthly.map((v, m) => (v === null ? null : fresh(year * 12 + m - 1, year * 12 + m)));
      const firstMonth = monthly.findIndex(v => v !== null);
      if (firstMonth < 0) return;
      const lastMonth = monthly.reduce((acc: number, v, m) => (v !== null ? m : acc), -1);
      const fy = fresh(year * 12 + firstMonth - 1, year * 12 + lastMonth);
      if (fy === null) return;
      out[y] = { ...row, monthly, fy };
    });
    return out;
  };

  // Minimum years of history required for an asset to appear in the seasonality
  // ranking. Guards against a single fluke month (e.g. 1/1 = 100%) dominating.
  const MIN_SEASON_YEARS = 5;

  /**
   * Seasonality screen for the Monthly tab.
   *
   * Ranks the currently-filtered assets by how often they have LOST money in a
   * given calendar month (0 = Jan … 11 = Dec), across every year of available
   * history. This answers "which assets are safest / riskiest in September?".
   *
   * - "Loss rate" = (# years that month's return was negative) / (# years with data).
   *   A return of exactly 0% is NOT counted as a loss (same convention as the
   *   Returns table's Loss rate row).
   * - Returns are measured in each asset's NATIVE currency (raw prices, no FX
   *   conversion) — the same basis as the main Monthly table above.
   * - Only assets with at least MIN_SEASON_YEARS years of that month are kept.
   * - Respects the Assets/Class/Currency/Subcategory filters via getFilteredAssetLookup().
   * - Sorted best → worst: lowest loss rate first; ties broken by higher average return.
   */
  const getSeasonalityRanking = (month: number): Array<{
    ticker: string;
    name: string;
    years: number;      // how many years of this month we have data for
    losses: number;     // how many of those years were negative
    lossRate: number;   // losses / years, in 0..1
    avg: number;        // simple average return (%) for this month across the years
  }> => {
    if (!assetData || assetData.length === 0) return [];

    return getFilteredAssetLookup()
      .map(asset => {
        // Build this asset's native-currency price series, then reuse the same
        // month-by-month engine the per-asset Returns table uses.
        const points: ReturnPoint[] = assetData
          .filter(row => typeof row[asset.ticker] === 'number')
          .map(row => ({ date: row.date as string, value: row[asset.ticker] as number, drawdown: 0 }));
        const monthlyReturns = calculateMonthlyReturns(points);

        // Collect this calendar month's return from every year that has one
        const vals: number[] = [];
        for (const year of Object.keys(monthlyReturns)) {
          const v = monthlyReturns[year].monthly[month];
          if (v !== null) vals.push(v);
        }

        const years = vals.length;
        const losses = vals.filter(v => v < 0).length;
        const avg = years > 0 ? vals.reduce((a, b) => a + b, 0) / years : 0;
        return { ticker: asset.ticker, name: asset.name, years, losses, lossRate: years > 0 ? losses / years : 0, avg };
      })
      .filter(r => r.years >= MIN_SEASON_YEARS)
      // Lowest loss rate first (best); ties → higher average return ranks higher
      .sort((a, b) => a.lossRate - b.lossRate || b.avg - a.avg);
  };

  // ---------------------------------------------------------------------------
  // "DURING STRESS" — one calendar year, month by month, asset against the market
  // ---------------------------------------------------------------------------
  // A beta or a correlation compresses years of history into one number. This does the
  // opposite: it picks a year the market had a bad time and lays out all twelve months
  // side by side, so you can see whether a holding actually fell WITH equities or held
  // its nerve. March 2020 either shows up as a matching red bar or it doesn't.
  //
  // Deliberately reads `assetData` directly rather than the visible `priceData`, so the
  // period buttons (1Y, 2Y, Max) cannot hide the year you asked to look at.
  const STRESS_BENCHMARK = 'IWDA';

  /**
   * Monthly returns for one calendar year, for an asset and for world equities, both
   * expressed in the SAME currency — the same rule the correlation and beta columns
   * follow. Comparing a PLN return against a USD one would silently measure the zloty.
   *
   * @param ticker         the asset to examine
   * @param year           calendar year, e.g. 2022
   * @param targetCurrency display currency ('' = each asset's own, which would defeat
   *                       the purpose here, so callers pass a real currency)
   * @returns 12 rows (Jan..Dec) with a return for each side, `null` where a month has
   *          no price, plus the compounded year total for each side. `null` overall if
   *          the price data has not loaded.
   */
  const getStressYearData = (ticker: string, year: number, targetCurrency: string) => {
    if (!assetData || assetData.length === 0) return null;

    // Last price of each month for one ticker, converted into the display currency
    const monthEndPrices = (t: string): Map<string, number> => {
      const nativeCcy = getAssetCurrency(t);
      const out = new Map<string, number>();
      for (const row of assetData) {
        const p = Number(row[t]);
        if (!p || p <= 0) continue;
        const d = new Date(row.date as string);
        if (isNaN(d.getTime())) continue;
        // Later rows overwrite earlier ones, leaving each month's LAST price
        out.set(toYM(d), p * getConversionRate(row, nativeCcy, targetCurrency || ''));
      }
      return out;
    };

    const assetPrices = monthEndPrices(ticker);
    const benchPrices = monthEndPrices(STRESS_BENCHMARK);

    // January's return needs December of the previous year, hence the `prev` lookup
    const returnFor = (prices: Map<string, number>, monthIdx: number): number | null => {
      const cur = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
      const prev = monthIdx === 0 ? `${year - 1}-12` : `${year}-${String(monthIdx).padStart(2, '0')}`;
      const a = prices.get(cur), b = prices.get(prev);
      if (!a || !b || b === 0) return null;
      return (a / b - 1) * 100;
    };

    // Running index, rebased to 100 at the start of the year and compounded month by
    // month. Held outside the map so each month builds on the one before it.
    //
    // A month with no price does not compound and gets no value, so a series that only
    // starts mid-year begins its climb from 100 at its own first month rather than
    // pretending to have been flat since January. The "only N of 12 months" warning
    // above the chart is what tells you that happened.
    let idxAsset = 100, idxBench = 100;

    const rows = MONTH_LABELS.map((month, i) => {
      const asset = returnFor(assetPrices, i);
      const bench = returnFor(benchPrices, i);
      if (asset !== null) idxAsset *= 1 + asset / 100;
      if (bench !== null) idxBench *= 1 + bench / 100;
      return {
        month,
        asset,
        bench,
        // The running index itself: 100 at the start of the year, compounded from there.
        // Plotted as-is against a zero-based axis, so a bar's HEIGHT is what the holding
        // is worth. An earlier version plotted the change from 100 instead; it made a
        // holding worth 99.5 draw as a bar hanging below the line, which reads as a loss
        // of 99.5 rather than a level of 99.5. The differences are less exaggerated this
        // way, but the picture is the one people actually expect.
        cumAsset: asset === null ? null : idxAsset,
        cumBench: bench === null ? null : idxBench,
        // The month's relative result in percentage points. Arithmetic difference, which
        // is how a one-month lead is normally quoted: -1.6% against -8.6% is "+7.0pp".
        // Note this is RELATIVE — a green +7.0 can still be a month you lost money.
        //
        // Subtracted from the values as DISPLAYED (one decimal), not the raw ones. All
        // three numbers sit on screen together, so a reader who checks the arithmetic
        // must get the answer shown: Jan 2022 gold is -1.650 and world equities -6.019,
        // a true gap of +4.369, but the bars read -1.7 and -6.0 and a pill saying "+4.4"
        // next to them looks broken. Rounding first costs at most 0.05pp — far below the
        // noise in a monthly return — and buys arithmetic that ties out.
        gap: (asset !== null && bench !== null)
          ? Math.round(asset * 10) / 10 - Math.round(bench * 10) / 10
          : null,
      };
    });

    // Compound the months that exist. Averaging or summing them would be wrong: a -50%
    // followed by +50% is -25% overall, not zero.
    const compound = (pick: (r: typeof rows[number]) => number | null): number | null => {
      const known = rows.map(pick).filter((v): v is number => v !== null);
      if (known.length === 0) return null;
      return (known.reduce((acc, r) => acc * (1 + r / 100), 1) - 1) * 100;
    };

    return {
      rows,
      assetTotal: compound(r => r.asset),
      benchTotal: compound(r => r.bench),
      assetMonths: rows.filter(r => r.asset !== null).length,
      benchMonths: rows.filter(r => r.bench !== null).length,
    };
  };

  return (
    <div className="mt-2">

      {/* Filter controls: Assets, Class, Currency + Prices/Returns toggle + End Date */}
      {renderFilters(<>
        {/* PHONES: View, End month and Seasonality as three boxes on one row that open
            slide-up panels, like the other pages; the buttons and dropdowns below are
            desktop only ("contents" makes their wrapper vanish there, so they sit in the
            filter row exactly as before). */}
        <div className="hidden max-md:flex w-full gap-2">
          <PhoneChoice
            label="View"
            options={[{ value: 'prices', label: 'Prices' }, { value: 'returns', label: 'Returns' }]}
            selected={monthlyViewMode}
            onPick={v => setMonthlyViewMode(v as 'prices' | 'returns')}
          />
          <PhoneChoice
            label="End month"
            options={endMonthChoices}
            selected={monthlyEndDate}
            onPick={setMonthlyEndDate}
          />
          <PhoneChoice
            label="Seasonality"
            subtitle="rank by loss rate in a month"
            options={[{ value: '', label: 'Off' }, ...MONTH_FULL.map((name, i) => ({ value: String(i), label: name }))]}
            selected={seasonMonth === null ? '' : String(seasonMonth)}
            onPick={v => setSeasonMonth(v === '' ? null : parseInt(v))}
          />
        </div>
        <div className="contents max-md:hidden">
        {/* Toggle buttons to switch between price view and return (%) view */}
        <div className={SEG}>
          <button
            onClick={() => setMonthlyViewMode('prices')}
            className={segBtn(monthlyViewMode === 'prices')}
          >
            Monthly Prices
          </button>
          <button
            onClick={() => setMonthlyViewMode('returns')}
            className={segBtn(monthlyViewMode === 'returns')}
          >
            Monthly Returns
          </button>
        </div>

        {/* End Date selector — pick which month the table ends at */}
        <select
          aria-label="End month"
          value={monthlyEndDate}
          onChange={(e) => setMonthlyEndDate(e.target.value)}
          className={FIELD}
        >
          {endMonthChoices.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>

        {/* Seasonality screen selector — pick a calendar month to rank assets
            by their historical loss rate in that month (best → worst). */}
        <select
          aria-label="Seasonality"
          value={seasonMonth === null ? '' : String(seasonMonth)}
          onChange={(e) => setSeasonMonth(e.target.value === '' ? null : parseInt(e.target.value))}
          className={FIELD}
          title="Rank the filtered assets by how often they lost money in a chosen month"
        >
          <option value="">Seasonality: off</option>
          {MONTH_FULL.map((name, i) => (
            <option key={i} value={i}>{name}</option>
          ))}
        </select>
        </div>
      </>)}

      {/* ================================================
          SEASONALITY RANKING CARD
          Appears only when a month is chosen in the "Seasonality" selector.
          Ranks the filtered assets from lowest to highest loss rate in that
          month, so you can see which assets to favour / avoid seasonally.
          ================================================ */}
      {seasonMonth !== null && (() => {
        const ranking = getSeasonalityRanking(seasonMonth);
        const monthName = MONTH_FULL[seasonMonth];
        return (
          <div className="bg-white p-4 rounded-lg shadow mb-4">
            <h3 className="text-md font-semibold mb-1 text-gray-700">
              {monthName} — assets ranked best → worst
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Lowest loss rate first. Loss rate = share of years with a negative {monthName} return
              (native currency). Only assets with {MIN_SEASON_YEARS}+ years of history are shown;
              ties are broken by higher average return.
            </p>
            {ranking.length === 0 ? (
              <div className="bg-yellow-50 p-3 rounded text-yellow-800 text-sm">
                No filtered assets have at least {MIN_SEASON_YEARS} years of {monthName} history.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b-2 border-gray-200 text-gray-600">
                      <th className="text-right py-2 px-2 bg-gray-50">#</th>
                      <th className="text-left py-2 px-2 bg-gray-50">Asset</th>
                      {/* Phones: no Ticker column (the name says which asset), so the table fits */}
                      <th className="text-left py-2 px-2 bg-gray-50 max-md:hidden">Ticker</th>
                      <th className="text-right py-2 px-2 bg-gray-100 font-semibold">Loss rate</th>
                      <th className="text-right py-2 px-2 bg-gray-50">Avg {monthName.slice(0, 3)}</th>
                      <th className="text-right py-2 px-2 bg-gray-50">Years</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((r, i) => {
                      const lossPct = Math.round(r.lossRate * 100);
                      // Colour the loss rate: greener when low (good), redder when high (bad)
                      const lossColor = r.lossRate <= 0.34
                        ? 'bg-green-100 text-green-800'
                        : r.lossRate >= 0.5
                          ? 'bg-red-100 text-red-800'
                          : 'bg-yellow-50 text-yellow-800';
                      const avgColor = r.avg >= 0 ? 'text-green-700' : 'text-red-700';
                      return (
                        <tr
                          key={r.ticker}
                          onClick={() => setMonthlySelectedTicker(prev => {
                            // Clicking a row opens that asset's detail below (same as the main table)
                            const next = prev === r.ticker ? '' : r.ticker;
                            if (next) setMonthlyDisplayCurrency(getAssetCurrency(next));
                            return next;
                          })}
                          className={`border-b border-gray-100 cursor-pointer transition-colors ${
                            monthlySelectedTicker === r.ticker ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'
                          }`}
                        >
                          <td className="text-right py-1.5 px-2 text-gray-400">{i + 1}</td>
                          <td className="text-left py-1.5 px-2 font-medium">{r.name}</td>
                          <td className="text-left py-1.5 px-2 text-gray-500 max-md:hidden">{r.ticker}</td>
                          <td className={`text-right py-1.5 px-2 font-semibold ${lossColor}`}>
                            {r.losses}/{r.years} ({lossPct}%)
                          </td>
                          <td className={`text-right py-1.5 px-2 ${avgColor}`}>{r.avg.toFixed(2)}%</td>
                          <td className="text-right py-1.5 px-2 text-gray-500">{r.years}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {(() => {
        const { months, assets: unsortedAssets, prevMonth } = getMonthlyPricesData();

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

        // Header background: blue-200 (#bfdbfe) on the sorted column, gray-100 (#f3f4f6) on the
        // rest. A class rather than an inline style so app/dark.css can theme it.
        const monthlyHeadBg = (col: string) => monthlySortColumn === col ? 'bg-blue-200' : 'bg-gray-100';

        return (
          <div className="bg-white p-4 rounded-lg shadow">
            {/* Scrollable table container */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    {/* Asset Name - sticky left column, sortable. Phones: 104px instead of 160px
                        (a long name goes onto two lines), so about four months fit beside it. */}
                    <th
                      className={`sticky left-0 z-10 text-left py-1 px-1 min-w-[160px] max-md:min-w-[104px] max-md:w-[104px] border-r border-gray-200 cursor-pointer select-none ${monthlyHeadBg('name')}`}
                      onClick={() => setMonthlySortColumn(monthlySortColumn === 'name' ? null : 'name')}
                    >
                      Asset
                    </th>
                    {/* Month columns - oldest to newest (left to right), sortable */}
                    {months.map((month, idx) => (
                      <th
                        key={idx}
                        className={`text-right py-1 px-1 whitespace-nowrap cursor-pointer select-none ${monthlyHeadBg(`month-${idx}`)}`}
                        onClick={() => setMonthlySortColumn(monthlySortColumn === `month-${idx}` ? null : `month-${idx}`)}
                      >
                        {month}
                      </th>
                    ))}
                    {/* 10m SMA column, sortable */}
                    <th
                      className={`text-right py-1 px-1 whitespace-nowrap border-l border-gray-200 cursor-pointer select-none ${monthlyHeadBg('sma10')}`}
                      onClick={() => setMonthlySortColumn(monthlySortColumn === 'sma10' ? null : 'sma10')}
                    >
                      10mSMA
                    </th>
                    {/* Signal column, sortable */}
                    <th
                      className={`text-center py-1 px-1 cursor-pointer select-none ${monthlyHeadBg('signal')}`}
                      onClick={() => setMonthlySortColumn(monthlySortColumn === 'signal' ? null : 'signal')}
                    >
                      Signal
                    </th>
                    {/* Ticker column, sortable */}
                    <th
                      className={`text-left py-1 px-1 border-l border-gray-200 cursor-pointer select-none ${monthlyHeadBg('ticker')}`}
                      onClick={() => setMonthlySortColumn(monthlySortColumn === 'ticker' ? null : 'ticker')}
                    >
                      Ticker
                    </th>
                    {/* 12-month return column, sortable */}
                    <th
                      className={`text-right py-1 px-1 border-l border-gray-200 whitespace-nowrap cursor-pointer select-none ${monthlyHeadBg('ret12m')}`}
                      onClick={() => setMonthlySortColumn(monthlySortColumn === 'ret12m' ? null : 'ret12m')}
                    >
                      12M Ret
                    </th>
                    {/* 12-month drawdown column, sortable */}
                    <th
                      className={`text-right py-1 px-1 border-l border-gray-200 whitespace-nowrap cursor-pointer select-none ${monthlyHeadBg('dd12m')}`}
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
                        onClick={() => setMonthlySelectedTicker(prev => {
                          // Toggle selection: clicking the already-selected asset closes it
                          const next = prev === asset.ticker ? '' : asset.ticker;
                          // When opening a (new) asset, reset the display currency to that
                          // asset's native currency so it always opens in its "original" currency.
                          if (next) setMonthlyDisplayCurrency(getAssetCurrency(next));
                          return next;
                        })}
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
                                color: price !== null ? INK_SOFT : '#9ca3af'
                              }}
                            >
                              {price !== null ? formatPrice(price) : '-'}
                            </td>
                          ))
                        ) : (
                          /* Returns view: green for positive, red for negative */
                          asset.returns.map((ret, colIdx) => {
                            // Hover text: how this month's return was worked out, from the
                            // two month-end prices it compares (EDO: a fresh bond each month)
                            const from = colIdx === 0 ? prevMonth : months[colIdx - 1];
                            const p0 = asset.prevPrices[colIdx], p1 = asset.prices[colIdx];
                            const howCalculated = ret === null || p0 === null || p1 === null ? undefined
                              : asset.startDependent
                                ? `${asset.name}, ${months[colIdx]}: ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%\n`
                                  + `A fresh EDO bought at the end of ${from} and valued at the end of ${months[colIdx]}\n`
                                  + '(each month is a new purchase, as on the Annual tab)'
                                : `${asset.name}, ${months[colIdx]}: ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%\n`
                                  + `End of ${from}: ${formatPrice(p0)}\n`
                                  + `End of ${months[colIdx]}: ${formatPrice(p1)}\n`
                                  + `${formatPrice(p1)} ÷ ${formatPrice(p0)} − 1 = ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%`;
                            return (
                            <td
                              key={colIdx}
                              title={howCalculated}
                              className={`text-right py-0.5 px-1 font-mono ${howCalculated ? 'cursor-help' : ''} ${
                                asset.signals[colIdx] === 'SELL' ? 'font-bold' : ''
                              }`}
                              style={(() => {
                                if (ret === null) return { color: '#9ca3af' };
                                // The one heat scale behind, and whichever of white / near-black
                                // text reads better on that colour (as the Markets heat cells do):
                                // fixed green / red text on the stronger shades was hard to read,
                                // in dark mode especially
                                const bg = heatColor(ret / 15, 0.67);
                                return { backgroundColor: bg, color: heatTextOn(bg) };
                              })()}
                            >
                              {ret !== null ? `${ret.toFixed(1)}%` : '-'}
                            </td>
                            );
                          })
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
                    <div className="w-6 h-4 rounded-l" style={{ backgroundColor: heatColor(-1, 0.67) }}></div>
                    <div className="w-6 h-4" style={{ backgroundColor: heatColor(0) }}></div>
                    <div className="w-6 h-4 rounded-r" style={{ backgroundColor: heatColor(1, 0.67) }}></div>
                  </div>
                  <span>Low → High</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span>Returns:</span>
                  <span className="px-2 py-0.5 rounded" style={{ backgroundColor: heatColor(0.4, 0.67), color: GAIN_DEEP }}>+</span>
                  <span>Positive</span>
                  <span className="px-2 py-0.5 rounded" style={{ backgroundColor: heatColor(-0.4, 0.67), color: LOSS_DEEP }}>−</span>
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
              // The trailing `true` lets this tab — and only this tab — plot a macro
              // series through zero and below, so an interest-rate line is unbroken.
              const chartResult = getMonthlyChartData(monthlySelectedTicker, monthlyChartPeriod, monthlyEndDate || undefined, monthlyDisplayCurrency, true);

              if (!chartResult) return (
                <div className="text-center py-4 text-gray-500 mt-4">
                  No price data available for {monthlySelectedTicker}.
                </div>
              );

              const { priceData, drawdownData, smaDistData, underwaterPeriods, maxPricePoint, minPricePoint, maxDrawdownPoint, maxSmaDistPoint, minSmaDistPoint, totalReturn, cagr } = chartResult;

              // --- Inflation, for the "Real" statistics column and the inflation chart view ---
              // The CPI that matters is the one for the currency being DISPLAYED, not the
              // asset's home country: if you are looking at an American fund priced in zloty,
              // what erodes your purchasing power is Polish inflation.
              //
              // cpiAt() takes the most recent reading on or before a date rather than an exact
              // match, because a CPI print lands a few weeks after the month it describes — an
              // exact-date lookup would blank out the newest month or two of every series.
              const monthlyCpiTicker = CURRENCY_CPI[monthlyDisplayCurrency] || '';
              const cpiSeries = monthlyCpiTicker && assetData
                ? assetData
                    .filter(r => Number(r[monthlyCpiTicker]) > 0)
                    .map(r => ({ date: r.date as string, cpi: Number(r[monthlyCpiTicker]) }))
                : [];
              const cpiAt = (date: string): number | null => {
                // Binary search for the last reading at or before `date` (assetData is chronological)
                let lo = 0, hi = cpiSeries.length - 1, found: number | null = null;
                while (lo <= hi) {
                  const mid = (lo + hi) >> 1;
                  if (cpiSeries[mid].date <= date) { found = cpiSeries[mid].cpi; lo = mid + 1; }
                  else hi = mid - 1;
                }
                return found;
              };

              // --- "vs IWDA" view: this asset against world equities ---
              // Both series are rebased to 100 at the first month they SHARE, which is the
              // only honest way to compare two lines: it answers "what would 100 have become
              // in each", so the gap between the lines is the relative performance and
              // nothing else. Prices are already in the selected display currency, and the
              // benchmark is fetched through the same helper with the same period and
              // currency — the identical pattern the statistics table above uses.
              const marketChart = monthlyPriceChartMode === 'vsMarket' && monthlySelectedTicker !== STRESS_BENCHMARK
                ? getMonthlyChartData(STRESS_BENCHMARK, monthlyChartPeriod, monthlyEndDate || undefined, monthlyDisplayCurrency)
                : null;
              const vsMarketData = (() => {
                if (!marketChart) return null;
                const marketByDate = new Map(marketChart.priceData.map(p => [p.date, p.price]));
                // Keep only the months BOTH have — an asset younger than the benchmark
                // would otherwise appear to start from nowhere.
                const shared = priceData.filter(p => marketByDate.has(p.date));
                if (shared.length < 2) return null;
                const assetBase = shared[0].price;
                const marketBase = marketByDate.get(shared[0].date)!;
                if (!assetBase || !marketBase) return null;

                // Third line: half the asset, half the market, rebalanced once a year.
                // Deliberately run through calculatePortfolioReturns — the Backtest tab's
                // own engine, with the same settings the statistics table's 50/50 row uses —
                // rather than a lookalike averaged here. That is what makes the line END
                // exactly where that row's "100 → ?" says it should, instead of merely near it.
                const blendByDate = (() => {
                  if (!assetData || monthlySelectedTicker === STRESS_BENCHMARK) return null;
                  const blendPortfolio = {
                    id: -1, name: `50/50 ${monthlySelectedTicker}/${STRESS_BENCHMARK}`,
                    assets: [
                      { asset: monthlySelectedTicker, weight: 50 },
                      { asset: STRESS_BENCHMARK, weight: 50 },
                    ],
                    color: BLACK, nameManuallyEdited: false,
                    inflationAdj: '', baseCurrency: monthlyDisplayCurrency,
                  } as Portfolio;
                  const pts = calculatePortfolioReturns(blendPortfolio, assetData,
                    { start: shared[0].date, end: shared[shared.length - 1].date, rebalanceFreq: 'yearly' });
                  if (!pts || pts.length < 2) return null;
                  return new Map(pts.map(p => [p.date, p.value]));
                })();
                const blendBase = blendByDate?.get(shared[0].date) ?? null;

                return shared.map(p => {
                  const blendValue = blendByDate?.get(p.date);
                  return {
                    date: p.date,
                    assetIdx: (p.price / assetBase) * 100,
                    marketIdx: (marketByDate.get(p.date)! / marketBase) * 100,
                    blendIdx: blendValue != null && blendBase ? (blendValue / blendBase) * 100 : null,
                  };
                });
              })();
              const hasBlend = vsMarketData !== null && vsMarketData.some(d => d.blendIdx !== null);
              // --- Real (inflation-adjusted) prices, for the real drawdown view ---
              // Every month restated in the purchasing power of the window's FIRST month:
              // price x (CPI then / CPI now). The line therefore starts at the same place as
              // the nominal one and diverges downward from it. Drawdowns measured on this
              // series are the honest ones — recovering your money is not the same as
              // recovering what your money could buy, so real recoveries take longer and
              // some nominal "new highs" turn out not to be highs at all.
              //
              // canDeflate is one binary search rather than one per month: cpiAt only comes
              // back empty for dates BEFORE the first CPI reading, so if the window's first
              // month has one then every later month does too. It gates the button as well,
              // so the view is never offered when it would silently show nothing new.
              const canDeflate = monthlyCpiTicker !== '' && priceData.length > 0
                && cpiAt(priceData[0].date) !== null;
              const realPriceData = monthlyPriceChartMode === 'drawdownReal' && canDeflate
                ? (() => {
                    const baseCpi = cpiAt(priceData[0].date)!;
                    const deflated: { date: string; price: number }[] = [];
                    for (const d of priceData) {
                      const cpi = cpiAt(d.date);
                      if (!cpi) return null;   // unreachable given canDeflate, but a gap would distort the peaks
                      deflated.push({ date: d.date, price: d.price * (baseCpi / cpi) });
                    }
                    return withHighWaterMark(deflated);
                  })()
                : null;

              // If a view can't be built (the asset IS the benchmark, or there is no CPI for
              // this currency), quietly fall back rather than blanking the chart. Every
              // branch below keys off this EFFECTIVE mode, not the raw state.
              const priceChartMode =
                monthlyPriceChartMode === 'vsMarket' && !vsMarketData ? 'sma'
                // No CPI for this currency (EUR, CHF) — the real view has nothing to show,
                // so fall back to the nominal drawdowns it is otherwise identical to.
                : monthlyPriceChartMode === 'drawdownReal' && !realPriceData ? 'drawdown'
                : monthlyPriceChartMode;

              // --- "Inflation adjusted" view ---
              // Three lines from 100: what the asset did, what prices in general did, and
              // the asset with that inflation taken back out — i.e. the return in constant
              // purchasing power. The gap between the black and the green line IS the
              // inflation line: money that grew but bought no more than before.
              // With no CPI for the displayed currency (EUR, CHF) only the asset is drawn.
              const inflationData = (() => {
                if (priceChartMode !== 'inflation' || priceData.length < 2) return null;
                const basePrice = priceData[0].price;
                const baseCpi = cpiAt(priceData[0].date);
                if (!basePrice) return null;
                return priceData.map(d => {
                  const nominal = (d.price / basePrice) * 100;
                  const cpi = baseCpi ? cpiAt(d.date) : null;
                  const inflationIdx = cpi && baseCpi ? (cpi / baseCpi) * 100 : null;
                  return {
                    date: d.date,
                    nominalIdx: nominal,
                    inflationIdx,
                    // Deflating by the SAME ratio the inflation line plots keeps the three
                    // lines arithmetically consistent: nominal / inflation = real.
                    realIdx: inflationIdx ? (nominal / inflationIdx) * 100 : null,
                  };
                });
              })();
              const hasInflation = inflationData !== null && inflationData.some(d => d.inflationIdx !== null);
              // The two "indexed to 100" views. Anything expressed in PRICES — the price
              // line itself, the peak and trough dots — has no meaning on their axis.
              const isIndexView = priceChartMode === 'vsMarket' || priceChartMode === 'inflation';

              // --- Drawdown ("underwater") view of the price chart ---
              // Recharts can shade the gap between two lines if the data point carries a
              // [low, high] pair, so we hand it [price, high water mark]. When the price IS
              // the high water mark the pair collapses to a zero-height band and nothing shows —
              // which is exactly right: at a new all-time high there is no drawdown to shade.
              //
              // The nominal and real drawdown views are the same chart over a different
              // price series, so everything below is driven by which series is in play
              // rather than by branching the rendering twice.
              const isDrawdownView = priceChartMode === 'drawdown' || priceChartMode === 'drawdownReal';
              const ddSeries = priceChartMode === 'drawdownReal' && realPriceData ? realPriceData : priceData;
              const priceChartData = isDrawdownView
                ? ddSeries.map(d => ({ ...d, underwaterBand: [d.price, d.hwm] as [number, number] }))
                : priceData;
              // Only stretches of a year or more get a duration label — shorter ones would
              // just clutter the chart, and a two-month dip is not a story worth telling.
              const labelledUnderwaterPeriods = !isDrawdownView ? []
                : (priceChartMode === 'drawdownReal' && realPriceData
                    ? findUnderwaterPeriods(realPriceData)
                    : underwaterPeriods
                  ).filter(p => p.months >= 12);
              // The green/red highest- and lowest-price dots. The drawdown views leave them
              // off: those charts are already telling a story in percentages — peaks, troughs
              // and depths — and a raw price marker on top of it is noise.
              const shownMaxPoint = isDrawdownView ? null : maxPricePoint;
              const shownMinPoint = isDrawdownView ? null : minPricePoint;

              // Y-axis scale for the price chart. Built from whichever lines are actually
              // on screen (the SMA can dip below the visible price range; the high water
              // mark never exceeds it), so the price line fills the chart instead of
              // floating in empty space above. In the vs-IWDA view the axis is in index
              // points rather than prices, so it is built from both indexed series.
              const priceAxisValues: (number | null)[] =
                priceChartMode === 'vsMarket' && vsMarketData
                  ? vsMarketData.flatMap(d => [d.assetIdx, d.marketIdx, d.blendIdx])
                : priceChartMode === 'inflation' && inflationData
                  ? inflationData.flatMap(d => [d.nominalIdx, d.inflationIdx, d.realIdx])
                  : ddSeries.map(d => d.price);
              if (priceChartMode === 'sma') priceAxisValues.push(...priceData.map(d => d.sma10));
              // Log needs its own gridlines, and it cannot plot a zero or negative value —
              // if the helper can't build one, quietly stay linear rather than break.
              const logAxis = monthlyPriceChartLog ? niceLogAxisScale(priceAxisValues) : null;
              const priceAxisIsLog = logAxis !== null;
              const priceAxis = logAxis ?? niceAxisScale(priceAxisValues);

              // --- Right-edge bubbles for the price chart ---
              const lastRow = ddSeries[ddSeries.length - 1];
              const priceBubbleDefs: BubbleDef[] = [];
              if (priceChartMode === 'vsMarket' && vsMarketData) {
                // Where 100 ended up for each line.
                const lastVs = vsMarketData[vsMarketData.length - 1];
                priceBubbleDefs.push({ value: lastVs.assetIdx, color: BLACK, label: lastVs.assetIdx.toFixed(1) });
                priceBubbleDefs.push({ value: lastVs.marketIdx, color: MARKET_LINE_COLOR, label: lastVs.marketIdx.toFixed(1) });
                if (lastVs.blendIdx !== null) {
                  priceBubbleDefs.push({ value: lastVs.blendIdx, color: BLEND_LINE_COLOR, label: lastVs.blendIdx.toFixed(1) });
                }
              } else if (priceChartMode === 'inflation' && inflationData) {
                const lastInf = inflationData[inflationData.length - 1];
                priceBubbleDefs.push({ value: lastInf.nominalIdx, color: BLACK, label: lastInf.nominalIdx.toFixed(1) });
                if (lastInf.realIdx !== null) {
                  priceBubbleDefs.push({ value: lastInf.realIdx, color: CHART_PALETTE.teal, label: lastInf.realIdx.toFixed(1) });
                }
                if (lastInf.inflationIdx !== null) {
                  priceBubbleDefs.push({ value: lastInf.inflationIdx, color: CHART_PALETTE.terracotta, label: lastInf.inflationIdx.toFixed(1) });
                }
              } else if (lastRow) {
                priceBubbleDefs.push({ value: lastRow.price, color: BLACK, label: formatPrice(lastRow.price) });
                // Second bubble follows whichever overlay is on screen: the SMA in the
                // default view, the high water mark in either drawdown view. The bare
                // 'price' view has no overlay, so it gets no second bubble — otherwise
                // an SMA figure would sit at the edge of a chart with no SMA line on it.
                if (isDrawdownView) {
                  priceBubbleDefs.push({ value: lastRow.hwm, color: CHART_PALETTE.rose, label: formatPrice(lastRow.hwm) });
                } else if (priceChartMode === 'sma') {
                  // The SMA only exists on the nominal series, which is what this branch draws.
                  const lastSma = priceData[priceData.length - 1]?.sma10;
                  if (lastSma != null) {
                    priceBubbleDefs.push({ value: lastSma, color: SMA_COLOR, label: formatPrice(lastSma) });
                  }
                }
              }
              const MonthlyPriceBubbles = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, priceBubbleDefs);

              // --- Right-edge bubble for the drawdown chart ---
              const lastDD = drawdownData[drawdownData.length - 1];
              const ddBubbleDefs: BubbleDef[] = [];
              if (lastDD) {
                ddBubbleDefs.push({ value: lastDD.drawdown, color: BLACK, label: `${lastDD.drawdown.toFixed(1)}%` });
              }
              const MonthlyDDBubbles = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, ddBubbleDefs);

              // --- Right-edge bubble for the SMA distance chart ---
              const lastSmaDist = smaDistData[smaDistData.length - 1];
              const smaDistBubbleDefs: BubbleDef[] = [];
              if (lastSmaDist) {
                // Green bubble if above SMA (positive distance), red if below
                const bubbleColor = lastSmaDist.smaDist >= 0 ? GAIN : LOSS;
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

              // Is a rolling-CAGR view selected, and over how many years? Looked up once
              // and reused by the maths below and by the chart itself (labels, tick
              // spacing, tooltip wording), so the two can never disagree about the view.
              const rollingView = ROLLING_RETURN_YEARS.find(r => r.period === returnsChartPeriod);
              // Likewise for the two streak counters, which are counts of months rather
              // than percentages and so need their own axis, tooltip and labels.
              const streakView = STREAK_VIEWS.find(s => s.period === returnsChartPeriod);

              // --- Compute periodic returns (monthly / quarterly / annual / rolling CAGR / streaks) ---
              // (uses module-level MONTH_ABBR constant declared at top of file)
              const computeReturnsData = (): ReturnsBar[] => {
                if (priceData.length < 2) return [];

                // --- Streak views ---
                // One bar per month; its height is how many months the run has lasted.
                // Both reset to zero the moment it breaks.
                if (streakView) {
                  const results: ReturnsBar[] = [];
                  // Highest month-end SO FAR IN THE VISIBLE WINDOW — the same high-water
                  // mark the drawdown chart above uses, so the two charts agree about
                  // when the asset was at a peak. On "Max" that is the true all-time high.
                  let peak = -Infinity;
                  let streak = 0;
                  for (let i = 0; i < priceData.length; i++) {
                    const price = priceData[i].price;
                    let onRun: boolean;
                    if (streakView.period === 'athStreak') {
                      // "At a high" means not below the mark, matching drawdown == 0,
                      // so a month that merely holds the peak still counts.
                      onRun = price >= peak;
                      if (price > peak) peak = price;
                    } else {
                      // Strictly up on the previous month. The first month of the window
                      // has nothing before it, so it can never start an up-run.
                      onRun = i > 0 && price > priceData[i - 1].price;
                    }
                    streak = onRun ? streak + 1 : 0;
                    const d = new Date(priceData[i].date);
                    results.push({
                      label: `${MONTH_ABBR[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
                      return: streak,
                    });
                  }
                  return results;
                }

                // --- Rolling CAGR views ---
                // Slide an N-year window along the visible history one month at a time.
                // Each bar = one complete N-year holding period, labelled with the month
                // it STARTED. So on "Rolling 3Y" the first bar is Dec-09 → Dec-12, the
                // next Jan-10 → Jan-13, and so on; the last bar is the newest window that
                // has a full N years of data behind it.
                if (rollingView) {
                  const years = rollingView.years;
                  // Index every month by its YYYY-MM key so we can jump exactly N calendar
                  // years forward. Counting N*12 array slots instead would quietly measure
                  // the wrong span if the price history ever has a gap.
                  const idxByMonth = new Map<string, number>();
                  priceData.forEach((p, i) => idxByMonth.set(toYM(new Date(p.date)), i));

                  // "Dec 09" — the same short form the monthly view uses on its X axis.
                  const fmt = (d: Date) => `${MONTH_ABBR[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
                  const results: ReturnsBar[] = [];
                  for (let i = 0; i < priceData.length; i++) {
                    const startDate = new Date(priceData[i].date);
                    const endKey = `${startDate.getFullYear() + years}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
                    const endIdx = idxByMonth.get(endKey);
                    if (endIdx === undefined) continue;   // window runs past the end of the data
                    const startPrice = priceData[i].price;
                    const endPrice = priceData[endIdx].price;
                    if (!(startPrice > 0) || !(endPrice > 0)) continue;
                    // CAGR: the steady annual rate that turns the start price into the end
                    // price over N years. Nth root of the growth multiple, minus 1.
                    const cagr = (Math.pow(endPrice / startPrice, 1 / years) - 1) * 100;
                    const endDate = new Date(priceData[endIdx].date);
                    results.push({
                      label: fmt(startDate),
                      return: parseFloat(cagr.toFixed(1)),
                      range: `${fmt(startDate)} → ${fmt(endDate)}`,
                      // Carried through so the tooltip can show the two prices the
                      // CAGR was computed from — the arithmetic is then checkable
                      // on the spot rather than taken on trust.
                      startPrice,
                      endPrice,
                    });
                  }
                  return results;
                }

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
              // Rolling and streak views produce one bar per month, like the monthly view,
              // so they share the monthly view's crowding rules for labels and axis ticks.
              // Show bar labels unless there are too many bars to read (≥48 = 4+ years)
              const monthlyGrained = returnsChartPeriod === 'monthly' || !!rollingView || !!streakView;
              const showReturnLabels = !monthlyGrained || returnsData.length < 48;

              // Build ReturnPoint[] from raw asset prices so we can reuse
              // calculateMonthlyReturns() for the calendar-style returns table
              // Convert each raw price into the selected display currency (native = no-op)
              // so the Returns and Prices tables below match the charts/statistics above.
              const selectedAssetCcy = getAssetCurrency(monthlySelectedTicker);
              const assetReturnPoints: ReturnPoint[] = assetData
                ?.filter(row => typeof row[monthlySelectedTicker] === 'number')
                .map(row => ({
                  date: row.date as string,
                  value: (row[monthlySelectedTicker] as number) * getConversionRate(row, selectedAssetCcy, monthlyDisplayCurrency),
                  drawdown: 0 // not used by calculateMonthlyReturns
                })) || [];
              // (A start-dependent asset like EDO is re-priced as fresh purchases; others pass through.)
              const assetMonthlyReturns = freshCalendar(monthlySelectedTicker, calculateMonthlyReturns(assetReturnPoints), monthlyDisplayCurrency);

              // The id lets the Markets tab scroll straight here after opening an asset.
              return (
                <div id="monthly-asset-detail" className="mt-6 border-t border-gray-200 pt-4 scroll-mt-4">
                  {/* Title + Period buttons. Phones: the title on its own line, the two boxes
                      under it at full width (side by side they squeezed the title into a strip) */}
                  <div className="flex items-center justify-between mb-3 px-2 max-md:flex-col max-md:items-stretch max-md:gap-2">
                    <h3 className="text-sm font-semibold text-gray-700">
                      {monthlySelectedTicker} — {assetName}
      {/* Total return for the visible period, colored green/red. Null on a macro
          series whose window starts at or below zero — a percentage change has no
          meaning there, so the figure is simply left off rather than faked. */}
                      {totalReturn !== null && (
                        <span className={`ml-2 ${totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(1)}%
                        </span>
                      )}
                      {/* CAGR shown when period is >= 1 year */}
                      {cagr !== null && (
                        <span className="ml-1 text-xs font-normal text-gray-500">
                          (CAGR {cagr >= 0 ? '+' : ''}{cagr.toFixed(1)}%)
                        </span>
                      )}
                    </h3>
                    {/* Phones: currency and period as two boxes that open slide-up panels */}
                    <div className="hidden max-md:flex w-full gap-2">
                      <PhoneChoice
                        label="Currency"
                        options={(['PLN', 'USD', 'EUR', 'CHF', 'SGD'] as const).map(c => ({ value: c, label: c }))}
                        selected={monthlyDisplayCurrency}
                        onPick={setMonthlyDisplayCurrency}
                      />
                      <PhoneChoice
                        label="Period"
                        options={periodOptions(MONTHLY_CHART_PERIODS, p => (p === 'max' ? 'Max' : p))}
                        selected={monthlyChartPeriod}
                        onPick={p => setMonthlyChartPeriod(p as MonthlyChartPeriod)}
                      />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end max-md:hidden">
                      {/* Currency buttons — re-express everything below in the chosen currency.
                          The button matching the asset's native currency is highlighted by
                          default (that's the "original currency" view). */}
                      <div className={SEG}>
                        {(['PLN', 'USD', 'EUR', 'CHF', 'SGD'] as const).map(ccy => (
                          <button
                            key={ccy}
                            onClick={() => setMonthlyDisplayCurrency(ccy)}
                            className={segBtn(monthlyDisplayCurrency === ccy)}
                          >
                            {ccy}
                          </button>
                        ))}
                      </div>
                      {/* Period buttons — how many years of history to show */}
                      <div className={SEG}>
                        {MONTHLY_CHART_PERIODS.map(p => (
                          <button
                            key={p}
                            onClick={() => setMonthlyChartPeriod(p)}
                            className={segBtn(monthlyChartPeriod === p)}
                          >
                            {p === 'max' ? 'Max' : p}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Statistics — delegates to the shared calculateStatistics() used by the Backtest tab */}
                  {(() => {
                    // Everything below is computed for a SERIES, not for the selected asset
                    // specifically, so the asset, the market and the 50/50 blend can each be run
                    // through identical arithmetic. Three rows that quietly disagreed about how
                    // they were measured would be worse than no rows at all.
                    const buildStatsRow = (
                      label: string,
                      // Row labels are kept to a ticker or a couple of characters so the table
                      // stays compact at any window width; the full description moves here and
                      // shows on hover, which costs no horizontal space.
                      hint: string,
                      series: { date: string; price: number }[],
                      drawdowns: { drawdown: number }[],
                    ) => {
                      // Every figure in this table — CAGR, volatility, Sharpe, the value of
                      // 100 invested — is built on percentage changes, and a percentage change
                      // needs a positive base. A macro series does not have one: a policy rate
                      // running -0.75 -> 0 -> 1.0 makes "the return from -0.75 to 0" undefined
                      // and "from 0 to 1.0" infinite, and those NaNs printed straight into the
                      // table. There is no sensible number to show, so the table sits this one
                      // out rather than inventing one. Real assets are unaffected: their prices
                      // are positive by definition.
                      if (series.some(p => !(p.price > 0))) return null;

                      const statPoints: ReturnPoint[] = series.map((p, i) => ({
                        date: p.date,
                        value: p.price,
                        drawdown: drawdowns[i]?.drawdown ?? 0,
                      }));
                      const stats = calculateStatistics(statPoints, { name: label } as Portfolio);
                      if (!stats) return null;

                      // Intervals between monthly data points = the actual period covered.
                      // (length-1 because 13 points from Jun 25 to Jun 26 = 12 monthly intervals = 1y)
                      const periodMonths = statPoints.length - 1;

                      // Value of 100 invested at the start of the period
                      const valueOf100 = (100 * statPoints[statPoints.length - 1].value / statPoints[0].value).toFixed(0);

                      // ---- Real (inflation-adjusted) CAGR ----
                      // Growth in purchasing power rather than in money: strip the CPI's own
                      // growth out of the asset's before annualising. Note this is NOT
                      // "CAGR minus inflation" — returns compound, so the two must be divided,
                      // which is why 12.8% nominal against 4% inflation gives 8.5% and not 8.8%.
                      // Uses the same elapsed-years basis as calculateStatistics' CAGR so the
                      // two columns are directly comparable.
                      const realCagr = (() => {
                        if (!monthlyCpiTicker) return null;  // EUR / CHF: no CPI series exists
                        const startCpi = cpiAt(series[0].date);
                        const endCpi = cpiAt(series[series.length - 1].date);
                        if (!startCpi || !endCpi || startCpi <= 0) return null;
                        const yrs = yearsBetween(series[0].date, series[series.length - 1].date);
                        if (yrs <= 0) return null;
                        const realGrowth = (statPoints[statPoints.length - 1].value / statPoints[0].value)
                                         * (startCpi / endCpi);
                        if (realGrowth <= 0) return null;
                        // lib/stats: under a year, the plain real return (not annualised)
                        return cagrPct(1, realGrowth, yrs);
                      })();

                      // ---- Best / Worst calendar year within the visible period ----
                      // Group series by year, compute return for each year using the
                      // previous year-end price (or first price in window for the first year).
                      const bestWorstYear = (() => {
                        if (series.length < 2) return null;
                        const yearMap = new Map<number, number[]>();
                        for (const p of series) {
                          const y = new Date(p.date).getFullYear();
                          if (!yearMap.has(y)) yearMap.set(y, []);
                          yearMap.get(y)!.push(p.price);
                        }
                        const years = Array.from(yearMap.keys()).sort();
                        if (years.length < 1) return null;
                        const yearReturns: number[] = [];
                        let prevEnd = series[0].price;
                        for (const y of years) {
                          const prices = yearMap.get(y)!;
                          const lastPrice = prices[prices.length - 1];
                          yearReturns.push(((lastPrice - prevEnd) / prevEnd) * 100);
                          prevEnd = lastPrice;
                        }
                        return { best: Math.max(...yearReturns), worst: Math.min(...yearReturns) };
                      })();

                      // ---- Paired monthly returns of the asset and a benchmark ----
                      // Extracted so correlation and beta are computed from the SAME pairs.
                      // They answer different halves of one question and must never disagree
                      // about which months they looked at.
                      //
                      // BOTH SIDES ARE CONVERTED TO THE DISPLAY CURRENCY. This is not a detail.
                      // `series` is already expressed in `monthlyDisplayCurrency`, so leaving
                      // the benchmark in its native USD regresses a PLN return on a USD one and
                      // silently measures the asset partly against USDPLN. The damage is easy to
                      // miss and easy to prove: on the mixed basis, IWDA scored a beta of 0.48
                      // and a correlation of 0.57 against ITSELF when viewed in PLN, and the
                      // diversifiers came out with the wrong SIGN — long treasuries -0.66
                      // instead of +0.29, managed futures -0.79 instead of +0.16. Converting the
                      // benchmark the same way the asset was restores beta == 1.00 exactly for
                      // an index against itself, in every display currency.
                      const benchReturnPairs = (benchTicker: string): { a: number; b: number }[] => {
                        if (!assetData) return [];

                        // Build benchmark last-price-per-month map, on the SAME currency basis
                        // as series (see getMonthlyChartData, which converts identically).
                        const benchCcy = getAssetCurrency(benchTicker);
                        const benchByMonth = new Map<string, number>();
                        for (const row of assetData) {
                          const p = Number(row[benchTicker]);
                          if (!p || p <= 0) continue;
                          const conv = getConversionRate(row, benchCcy, monthlyDisplayCurrency || '');
                          benchByMonth.set(toYM(new Date(row.date as string)), p * conv);
                        }

                        const pairs: { a: number; b: number }[] = [];
                        for (let i = 1; i < series.length; i++) {
                          const ym = toYM(new Date(series[i].date));
                          const prevYm = toYM(new Date(series[i - 1].date));
                          const bCurr = benchByMonth.get(ym);
                          const bPrev = benchByMonth.get(prevYm);
                          if (bCurr == null || bPrev == null || bPrev === 0) continue;
                          pairs.push({
                            a: (series[i].price - series[i - 1].price) / series[i - 1].price,
                            b: (bCurr - bPrev) / bPrev,
                          });
                        }
                        return pairs;
                      };

                      // IWDA's pairs are needed by both beta and correlation. Without this the
                      // benchmark's whole price history is rebuilt twice per render for no gain.
                      const pairsCache = new Map<string, { a: number; b: number }[]>();
                      const cachedPairs = (benchTicker: string) => {
                        let p = pairsCache.get(benchTicker);
                        if (!p) { p = benchReturnPairs(benchTicker); pairsCache.set(benchTicker, p); }
                        return p;
                      };

                      // Fewer than three overlapping months and any of these figures is noise
                      // dressed up as a statistic.
                      const MIN_PAIRS = 3;
                      // The downside sample is a subset — only months the benchmark fell — so it
                      // needs its own, stricter floor before a slope through it means anything.
                      const MIN_DOWN_PAIRS = 8;

                      // ---- Correlation: Pearson correlation of monthly returns vs a benchmark ----
                      const calcCorr = (benchTicker: string): number | null => {
                        const pairs = cachedPairs(benchTicker);
                        if (pairs.length < MIN_PAIRS) return null;

                        const n = pairs.length;
                        const aMean = pairs.reduce((s, p) => s + p.a, 0) / n;
                        const bMean = pairs.reduce((s, p) => s + p.b, 0) / n;
                        let num = 0, denA = 0, denB = 0;
                        for (const p of pairs) {
                          const da = p.a - aMean, db = p.b - bMean;
                          num += da * db; denA += da * da; denB += db * db;
                        }
                        const denom = Math.sqrt(denA * denB);
                        return denom === 0 ? null : num / denom;
                      };

                      // ---- Beta: how far this asset moves for a given move in the benchmark ----
                      // Correlation says whether two things move TOGETHER; it is capped at 1 and
                      // says nothing about size. Gold and world equities could both correlate 0.30
                      // while one swings twice as hard as the other. Beta supplies the missing
                      // half — the slope of the asset's return regressed on the benchmark's:
                      //
                      //     beta = covariance(asset, benchmark) / variance(benchmark)
                      //
                      // 1.0 means it has historically moved one-for-one with world equities, 1.5
                      // means it amplifies them by half again, 0.5 means it damps them, and a
                      // negative beta means it has tended to move the opposite way.
                      //
                      // The (n-1) divisor cancels between the covariance and the variance, so it
                      // is left out rather than written twice.
                      //
                      // `downsideOnly` restricts the sample to months the BENCHMARK fell, giving
                      // a "bear beta". This matters because a full-sample beta averages crashes
                      // together with calm months and can flatter an asset badly: WIG20 scores
                      // 0.34 against world equities in PLN, but 0.64 when only down months count,
                      // and it lost 20.8% in March 2020. Covariance and variance use the
                      // sub-sample's own means, which is the standard bear-beta construction.
                      const calcBeta = (benchTicker: string, downsideOnly = false): number | null => {
                        const all = cachedPairs(benchTicker);
                        const pairs = downsideOnly ? all.filter(p => p.b < 0) : all;
                        // A bear beta needs enough drawdown months to mean anything. Three would
                        // be a slope through noise, so the downside figure holds out for more.
                        if (pairs.length < (downsideOnly ? MIN_DOWN_PAIRS : MIN_PAIRS)) return null;

                        const n = pairs.length;
                        const aMean = pairs.reduce((s, p) => s + p.a, 0) / n;
                        const bMean = pairs.reduce((s, p) => s + p.b, 0) / n;
                        let cov = 0, varB = 0;
                        for (const p of pairs) {
                          const da = p.a - aMean, db = p.b - bMean;
                          cov += da * db;
                          varB += db * db;
                        }
                        // A benchmark that never moved has no slope to measure against
                        return varB === 0 ? null : cov / varB;
                      };

                      const iwdaBeta = calcBeta('IWDA');
                      const iwdaDownBeta = calcBeta('IWDA', true);
                      const iwdaDownMonths = cachedPairs('IWDA').filter(p => p.b < 0).length;
                      const iwdaCorr = calcCorr('IWDA');
                      const vdtaCorr = calcCorr('VDTA');

                      return { label, hint, stats, periodMonths, valueOf100, realCagr, bestWorstYear,
                               iwdaBeta, iwdaDownBeta, iwdaDownMonths, iwdaCorr, vdtaCorr };
                    };
                    // ---- end of the per-series row builder ----

                    const assetName = assetLookup.find(a => a.ticker === monthlySelectedTicker)?.name || monthlySelectedTicker;
                    const assetRow = buildStatsRow(monthlySelectedTicker, assetName, priceData, drawdownData);
                    if (!assetRow) return null;

                    // The window every row is measured over: whatever months the selected asset
                    // actually has on screen. Bitcoin's history starts in 2016, so on "Max" the
                    // market row is trimmed to 2016 too — otherwise it would be reporting a
                    // different decade and the comparison would be meaningless.
                    const windowStart = priceData[0].date;
                    const windowEnd = priceData[priceData.length - 1].date;
                    const windowDates = new Set(priceData.map(p => p.date));

                    // ---- Row 2: the market on its own ----
                    // Same helper the asset's own chart uses, same period, same currency, then
                    // trimmed to the asset's months.
                    const benchChart = getMonthlyChartData(STRESS_BENCHMARK, monthlyChartPeriod, monthlyEndDate || undefined, monthlyDisplayCurrency);
                    const benchRow = (() => {
                      if (!benchChart) return null;
                      const keep: number[] = [];
                      benchChart.priceData.forEach((p, i) => { if (windowDates.has(p.date)) keep.push(i); });
                      if (keep.length < 2) return null;
                      return buildStatsRow(STRESS_BENCHMARK,
                        'World equities — the benchmark every Beta and Corr column is measured against',
                        keep.map(i => benchChart.priceData[i]),
                        keep.map(i => benchChart.drawdownData[i]));
                    })();

                    // ---- Row 3: half the asset, half the market, rebalanced once a year ----
                    // Deliberately run through calculatePortfolioReturns — the Backtest tab's own
                    // engine — rather than a lookalike written here, so "rebuild this in the
                    // Backtest tab and you get the same numbers" is true by construction rather
                    // than by careful copying. Only the window and cadence are overridden.
                    const blendRow = (() => {
                      if (monthlySelectedTicker === STRESS_BENCHMARK || !assetData) return null;
                      const blendPortfolio = {
                        id: -1, name: `50/50 ${monthlySelectedTicker}/${STRESS_BENCHMARK}`,
                        assets: [
                          { asset: monthlySelectedTicker, weight: 50 },
                          { asset: STRESS_BENCHMARK, weight: 50 },
                        ],
                        color: BLACK, nameManuallyEdited: false,
                        inflationAdj: '', baseCurrency: monthlyDisplayCurrency,
                      } as Portfolio;
                      const pts = calculatePortfolioReturns(blendPortfolio, assetData,
                        { start: windowStart, end: windowEnd, rebalanceFreq: 'yearly' });
                      if (!pts || pts.length < 2) return null;
                      return buildStatsRow('50/50',
                        `50% ${monthlySelectedTicker} and 50% ${STRESS_BENCHMARK}, rebalanced annually, run through the Backtest tab's own engine`,
                        pts.map(p => ({ date: p.date, price: p.value })),
                        pts.map(p => ({ drawdown: p.drawdown })));
                    })();

                    const allStatsRows = [assetRow, benchRow, blendRow].filter((r): r is NonNullable<typeof assetRow> => r !== null);
                    // Collapsed = just the asset's own line, with the two reference rows
                    // (IWDA and the 50/50 blend) folded away behind the +/- in the header.
                    const statsRows = monthlyStatsExpanded ? allStatsRows : allStatsRows.slice(0, 1);
                    // Only worth offering the toggle when there is something to fold away.
                    const hasReferenceRows = allStatsRows.length > 1;

                    // ---- The currency caveat, written once and shown on every column it applies to ----
                    // Correlation and beta both change when you switch the display currency, and
                    // that surprises people because correlation is scale-invariant: measure two
                    // things in metres or feet and the answer is the same. Currency is NOT a
                    // scale factor though. Converting a return ADDS the currency's own return to
                    // it, and USDPLN is itself ~-0.61 correlated with world equities, so the
                    // added term is far from neutral. Hence the same fund is a different asset
                    // to a different owner: IWDA's volatility is 14.1% to a dollar investor and
                    // 11.8% to a zloty one, because the zloty falls when markets do.
                    //
                    // This lives in a tooltip rather than a comment alone because the user has
                    // to make portfolio decisions off these numbers and the trap is invisible.
                    const displayedCcy = monthlyDisplayCurrency || 'the asset\'s own currency';
                    const currencyNote = (bench: string, benchDesc: string) =>
                      `HOW THIS IS MEASURED\n`
                      + `Both this asset and ${bench} (${benchDesc}) are converted to ${displayedCcy} — the currency selected above — so the two sides always share one basis.\n\n`
                      + `WHY THE NUMBER CHANGES WHEN YOU SWITCH CURRENCY\n`
                      + `Not a rounding artefact. Converting a return adds that currency's own return to it, and USDPLN moves about -0.61 with world equities — the dollar rises exactly when markets fall. So to a zloty investor ${bench} is not simply ${benchDesc}; it is ${benchDesc} PLUS a long-dollar position that cushions crises. IWDA's volatility is 14.1% to a dollar investor but 11.8% to a zloty one — the same fund, a genuinely calmer ride.\n\n`
                      + `EXAMPLE — WIG20 vs IWDA\n`
                      + `0.21 measured in PLN, but 0.71 measured in USD.\n\n`
                      + `WHICH ONE TO USE\n`
                      + `The currency you think of your wealth in. Your portfolio NAV is tracked in PLN, so for "does WIG20 diversify my world equities?" the PLN answer (0.21) is the decision-relevant one — WIG20 diversifies you MORE than the USD figure implies. The USD answer (0.71) tells you what the Polish market is as an asset to a global investor. Different questions, both valid.\n\n`
                      + `Note: switching to another asset resets this to that asset's own currency, so pick one currency deliberately before comparing correlations across assets.`;

                    return (
                      // Phones: only the table swipes ("max-md:overflow-x-visible" on the card, the
                      // wrapper below scrolls instead), so the heading and the note under the table
                      // stay readable, and the row names stay put while you swipe ("phone-pin-first")
                      <div className="bg-white p-4 rounded-lg shadow overflow-x-auto mb-4 max-md:overflow-x-visible">
                        {/* The window used to be a column repeated on every row. It is the same
                            fact for the whole table, so it belongs in the heading — the key part
                            dark, the exact dates and the basis as quieter supporting detail. */}
                        <h3 className="text-md font-semibold text-gray-900 mb-2">
                          Statistics for {formatPeriod(assetRow.periodMonths)}
                          <span className="font-normal text-gray-500">
                            {' '}({windowStart.slice(0, 7)} / {windowEnd.slice(0, 7)}) based on month end prices
                          </span>
                        </h3>
                        <div className="max-md:overflow-x-auto phone-pin-first">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b-2 border-gray-200">
                              {/* +/- folds the two reference rows (IWDA and the 50/50 blend)
                                  away, leaving just the selected asset. Expanded by default. */}
                              <th className="text-left py-2 px-2">
                                {hasReferenceRows ? (
                                  <button
                                    onClick={() => setMonthlyStatsExpanded(v => !v)}
                                    title={monthlyStatsExpanded
                                      ? 'Hide the IWDA and 50/50 comparison rows'
                                      : 'Show the IWDA and 50/50 comparison rows'}
                                    aria-expanded={monthlyStatsExpanded}
                                    className="w-4 h-4 leading-none flex items-center justify-center rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 transition-colors"
                                  >
                                    {monthlyStatsExpanded ? '−' : '+'}
                                  </button>
                                ) : <>&nbsp;</>}
                              </th>
                              <th className="text-right py-2 px-2">Total Return</th>
                              <th className="text-right py-2 px-2">100 → ?</th>
                              <th className="text-right py-2 px-2 cursor-help" title={CAGR_HINT}>CAGR</th>
                              <th className="text-right py-2 px-2"
                                  title={'Real CAGR — the annual growth in PURCHASING POWER, after the inflation of the currency shown above.\n\n'
                                    + 'Returns compound, so this is not simply CAGR minus inflation: the two are divided, not subtracted. 12.8% nominal against 4.0% inflation is 8.5% real, not 8.8%.\n\n'
                                    + (monthlyCpiTicker
                                        ? `Using ${monthlyCpiTicker} (${monthlyDisplayCurrency} consumer prices) over the same months as the CAGR beside it.`
                                        : `Shown as n.a. because there is no CPI series for ${monthlyDisplayCurrency} — only PLN, USD and SGD have one. Switch the currency above to see a real return.`)}>
                                Real
                              </th>
                              <th className="text-right py-2 px-2">Vol</th>
                              <th className="text-right py-2 px-2 cursor-help" title={SHARPE_HINT}>Sharpe</th>
                              <th className="text-right py-2 px-2">Max DD</th>
                              <th className="text-right py-2 px-2">Longest DD</th>
                              <th className="text-right py-2 px-2">Curr DD</th>
                              <th className="text-right py-2 px-2">Best Year</th>
                              <th className="text-right py-2 px-2">Worst Year</th>
                              <th className="text-right py-2 px-2"
                                  title={'Beta vs IWDA (world equities): how far this asset has moved for each 1% move in the market, from monthly returns over the visible period. 1.00 = one-for-one, above 1 = amplifies the market, below 1 = damps it, negative = tends to move the opposite way. Read it alongside Corr IWDA — beta is only meaningful when the correlation is high enough for "moves with the market" to mean anything.\n\n'
                                    + currencyNote('IWDA', 'world equities')}>
                                Beta IWDA
                              </th>
                              <th className="text-right py-2 px-2"
                                  title={'Downside beta vs IWDA — the same calculation, but using ONLY the months world equities FELL.\n\n'
                                    + 'WHY IT EXISTS\nA full-sample beta averages crashes together with calm months, which can flatter an asset badly. The number you care about in a drawdown is this one.\n\n'
                                    + 'HOW TO READ IT\nHigher than the plain beta = the asset gets MORE correlated exactly when markets fall, which is when diversification is supposed to help. Lower, or negative, = it held up or rose while markets dropped, a genuine hedge.\n\n'
                                    + `Based on ${assetRow.iwdaDownMonths} down month${assetRow.iwdaDownMonths === 1 ? '' : 's'} in the visible period. Shown as — when there are too few for a slope to mean anything.\n\n`
                                    + 'CAUTION\nA low beta still does not mean safe. WIG20 scores 0.34 against world equities in PLN and still lost 20.8% in March 2020 — it fell hard, just not in step with a PLN investor\'s IWDA, which the dollar was busy rescuing.\n\n'
                                    + currencyNote('IWDA', 'world equities')}>
                                Beta ↓
                              </th>
                              <th className="text-right py-2 px-2"
                                  title={'Correlation vs IWDA (world equities): whether this asset moves in the same DIRECTION as the market, from -1 to +1. It says nothing about how far it moves — that is Beta.\n\n'
                                    + currencyNote('IWDA', 'world equities')}>
                                Corr IWDA
                              </th>
                              <th className="text-right py-2 px-2"
                                  title={'Correlation vs VDTA (US government bonds, intermediate): whether this asset moves in the same DIRECTION as the bond market, from -1 to +1.\n\n'
                                    + currencyNote('VDTA', 'US government bonds')}>
                                Corr VDTA
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {statsRows.map((row, rowIdx) => {
                              const { stats, bestWorstYear, iwdaBeta, iwdaDownBeta, iwdaDownMonths, iwdaCorr, vdtaCorr } = row;
                              // The selected asset keeps the plain styling it always had; the two
                              // reference rows are tinted so it stays obvious which line is yours.
                              const isAsset = rowIdx === 0;
                              return (
                              <tr key={row.label} className={`border-b border-gray-100 ${isAsset ? '' : 'bg-gray-50/60'}`}>
                                {/* Each row's own span moves into the hover text. The heading
                                    gives the asset's window, but a reference row can cover
                                    fewer months if the benchmark lacks data, and that is
                                    worth being able to check. */}
                                <td className={`text-left py-2 px-2 whitespace-nowrap ${isAsset ? 'font-medium text-gray-800' : 'text-gray-500'}`}
                                    title={`${row.hint}\n\nMeasured over ${formatPeriod(row.periodMonths)}.`}>
                                  {!isAsset && (
                                    <span className="inline-block w-2 h-2 rounded-sm mr-1.5"
                                          style={{ backgroundColor: rowIdx === 1 ? MARKET_LINE_COLOR : '#9ca3af' }} />
                                  )}
                                  {row.label}
                                </td>
                                <td className="text-right py-2 px-2">{stats.totalReturn}%</td>
                              <td className="text-right py-2 px-2 font-semibold">{row.valueOf100}</td>
                              <td className="text-right py-2 px-2">{stats.cagr}%</td>
                              {/* Real CAGR. Grey "n.a." rather than a dash, so a missing CPI
                                  reads as "not available here" and not as "zero". */}
                              <td className={`text-right py-2 px-2 ${row.realCagr === null ? 'text-gray-400' : ''}`}>
                                {row.realCagr !== null ? `${row.realCagr.toFixed(2)}%` : 'n.a.'}
                              </td>
                              <td className="text-right py-2 px-2">{stats.volatility}%</td>
                              <td className="text-right py-2 px-2">{stats.sharpeRatio}</td>
                              <td className="text-right py-2 px-2 text-red-600">{stats.maxDrawdown}%</td>
                              <td className="text-right py-2 px-2 text-purple-700">{stats.longestDrawdown}</td>
                              <td className="text-right py-2 px-2 text-orange-600">{stats.currentDrawdown}%</td>
                              <td className="text-right py-2 px-2 text-green-600">
                                {bestWorstYear ? `${bestWorstYear.best >= 0 ? '+' : ''}${bestWorstYear.best.toFixed(1)}%` : '—'}
                              </td>
                              <td className="text-right py-2 px-2 text-red-600">
                                {bestWorstYear ? `${bestWorstYear.worst.toFixed(1)}%` : '—'}
                              </td>
                              {/* Beta is the one figure here whose SIGN flips its meaning, so it
                                  carries the only colour: a negative beta means the asset has
                                  hedged the market rather than tracked it, which is worth
                                  spotting at a glance. Magnitude is left uncoloured — whether a
                                  beta of 1.4 is good or bad depends entirely on why you hold it. */}
                              <td className={`text-right py-2 px-2 ${iwdaBeta !== null && iwdaBeta < 0 ? 'text-green-600' : ''}`}
                                  title={iwdaBeta === null ? undefined
                                    : `A 1% move in world equities has coincided with a ${iwdaBeta.toFixed(2)}% move in this asset, on average`}>
                                {iwdaBeta !== null ? iwdaBeta.toFixed(2) : '—'}
                              </td>
                              {/* Downside beta. Green when negative (it rose while markets fell)
                                  and amber when it is materially WORSE than the all-month beta —
                                  the "diversifier that stops diversifying in a drawdown" case,
                                  which is the whole reason this column exists. */}
                              <td className={`text-right py-2 px-2 font-mono font-medium ${
                                    iwdaDownBeta === null ? 'text-gray-400'
                                    : iwdaDownBeta < 0 ? 'text-green-600'
                                    : (iwdaBeta !== null && iwdaDownBeta > iwdaBeta + 0.15) ? 'text-amber-600'
                                    : ''}`}
                                  title={iwdaDownBeta === null
                                    ? 'Too few months where world equities fell to measure a slope'
                                    : `Over the ${iwdaDownMonths} months world equities fell, this moved ${iwdaDownBeta.toFixed(2)}% per 1% of their decline`
                                      + (iwdaBeta !== null ? `, versus ${iwdaBeta.toFixed(2)} across all months` : '')}>
                                {iwdaDownBeta !== null ? iwdaDownBeta.toFixed(2) : '—'}
                              </td>
                              <td className="text-right py-2 px-2">
                                {iwdaCorr !== null ? iwdaCorr.toFixed(2) : '—'}
                              </td>
                              <td className="text-right py-2 px-2">
                                {vdtaCorr !== null ? vdtaCorr.toFixed(2) : '—'}
                              </td>
                            </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        </div>
                        {/* How to reproduce the 50/50 row in the Backtest tab. Without the exact
                            window you would have to guess which months the period covers. */}
                        {/* Hidden along with the row it explains when the table is collapsed. */}
                        {blendRow && monthlyStatsExpanded && (
                          <p className="text-[10px] text-gray-400 mt-2">
                            50/50 row = this asset and IWDA at 50% each, rebalanced annually, run through the
                            Backtest tab&apos;s own engine. To reproduce it there: Start {windowStart}, End {windowEnd},
                            currency {monthlyDisplayCurrency || 'native'}, rebalancing Yearly, no inflation adjustment.
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {/* View switch for the price chart: moving average, underwater periods,
                      or the asset against world equities. The third is hidden when the
                      selected asset IS the benchmark — comparing IWDA with itself would
                      just draw one line on top of another. */}
                  <div className="flex justify-end gap-1 mb-1 px-2 flex-wrap max-md:flex-nowrap max-md:items-center max-md:gap-2">
                    {(() => { const modes = ([
                      // Price on its own: same chart as the next button without the red
                      // SMA line. A moving average of an interest rate or a GDP series
                      // says nothing, so those are better read bare.
                      { key: 'price', label: 'Price' },
                      { key: 'sma', label: 'Price & 10m SMA' },
                      { key: 'drawdown', label: 'Price & drawdowns' },
                      // Needs a CPI covering this window; EUR and CHF have none at all.
                      ...(canDeflate
                        ? [{ key: 'drawdownReal', label: 'Price & drawdowns inflation adjusted' }] as const
                        : []),
                      ...(monthlySelectedTicker !== STRESS_BENCHMARK
                        ? [{ key: 'vsMarket', label: `vs ${STRESS_BENCHMARK}` }] as const
                        : []),
                      { key: 'inflation', label: 'vs Inflation' },
                    ] as const);
                    return (<>
                    {/* Phones: the chart choice as one box that opens a slide-up panel */}
                    <div className="hidden max-md:flex flex-1 min-w-0">
                      <PhoneChoice
                        label="Chart"
                        options={modes.map(m => ({ value: m.key, label: m.label }))}
                        selected={priceChartMode}
                        onPick={k => setMonthlyPriceChartMode(k as (typeof modes)[number]['key'])}
                      />
                    </div>
                    <span className={`${SEG} max-md:hidden`}>
                    {modes.map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setMonthlyPriceChartMode(opt.key)}
                        // Highlights the EFFECTIVE mode, so that when a vs-IWDA view falls
                        // back (e.g. you then select IWDA itself) the highlighted button
                        // still matches the chart on screen instead of nothing being lit.
                        className={segBtn(priceChartMode === opt.key)}
                      >
                        {opt.label}
                      </button>
                    ))}
                    </span>
                    </>); })()}
                    {/* Axis scale, kept slightly apart because it applies to all three
                        views above rather than being a fourth view of its own. */}
                    <div className={`${SEG} ml-3`}>
                      {([
                        { key: false, label: 'Linear' },
                        { key: true, label: 'Log' },
                      ] as const).map(opt => (
                        <button
                          key={String(opt.key)}
                          onClick={() => setMonthlyPriceChartLog(opt.key)}
                          title={opt.key
                            ? 'Logarithmic: equal distances mean equal PERCENTAGE moves, so early years stay readable after an asset has multiplied'
                            : 'Normal scale: equal distances mean equal amounts of money'}
                          className={segBtn(monthlyPriceChartLog === opt.key)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Chart 1: Price + 10M SMA (or, in drawdown mode, price + high water mark) */}
                  <ResponsiveContainer width="100%" height={525}>
                    {/* top margin 28, not the usual 20: now that the Y axis hugs the data, the
                        highest point can land exactly ON the top gridline, and the price label
                        above it needs ~23px of room or it gets cut off by the canvas edge. */}
                    <ComposedChart
                      data={
                        priceChartMode === 'vsMarket' && vsMarketData ? vsMarketData
                        : priceChartMode === 'inflation' && inflationData ? inflationData
                        : priceChartData
                      }
                      margin={{ top: 28, right: 70, left: -5, bottom: 15 }}
                    >
                      {/* No CartesianGrid here on purpose: the axis labels carry the levels,
                          and an empty background lets the lines themselves read clearly.
                          The two charts below keep their grids. */}
                      <XAxis
                        dataKey="date"
                        tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />}
                        height={35}
                      />
                      <YAxis
                        tick={{ fontSize: 9 }}
                        width={40}
                        scale={priceAxisIsLog ? 'log' : 'auto'}
                        domain={priceAxis ? priceAxis.domain : ['auto', 'auto']}
                        ticks={priceAxis && priceAxis.ticks.length > 0 ? priceAxis.ticks : undefined}
                      />
                      <Tooltip
                        formatter={(value: number, name: string, item: { payload?: { hwm?: number } }) => {
                          if (value == null) return ['-', name];
                          // The underwater band carries a [low, high] pair rather than a single
                          // number; show it as a range so it never renders as "[1,2]".
                          if (Array.isArray(value)) {
                            const [lo, hi] = value as unknown as number[];
                            return [`${formatPrice(lo)} – ${formatPrice(hi)}`, name];
                          }
                          // These views are in index points (every line starts at 100), not money.
                          if (priceChartMode === 'vsMarket' || priceChartMode === 'inflation') {
                            return [value.toFixed(1), name];
                          }
                          // On the asset's own price line, add how far below its running peak
                          // that month closed — the same figure the drawdown chart below plots.
                          const peak = item?.payload?.hwm;
                          if (name === monthlySelectedTicker && typeof peak === 'number' && peak > 0) {
                            const dd = ((value - peak) / peak) * 100;
                            const ddText = dd < -0.05 ? `${dd.toFixed(1)}% below peak` : 'at peak';
                            return [`${formatPrice(value)}  (${ddText})`, name];
                          }
                          return [formatPrice(value), name];
                        }}
                      />
                      <Legend />
                      <Customized component={MonthlyPriceBubbles} />
                      {/* Pink shading between the price and its high water mark — the gap the
                          asset still has to climb back. Drawn first so the lines sit on top. */}
                      {isDrawdownView && (
                        <Area
                          type="monotone"
                          dataKey="underwaterBand"
                          name="Below peak"
                          stroke="none"
                          fill={CHART_PALETTE.rose}
                          fillOpacity={0.28}
                          activeDot={false}
                          legendType="none"
                          isAnimationActive={false}
                        />
                      )}
                      {/* Light grey fill under the price, matching the drawdown chart below
                          (black at 10% opacity). Drawn before the lines so they sit on top.
                          It carries no extra information — it gives the price line a body so
                          the eye follows it, which matters more now the gridlines are gone. */}
                      {priceChartMode === 'sma' && (
                        <Area
                          type="monotone"
                          dataKey="price"
                          name={monthlySelectedTicker}
                          stroke="none"
                          fill={BLACK}
                          fillOpacity={0.1}
                          activeDot={false}
                          legendType="none"
                          tooltipType="none"
                          isAnimationActive={false}
                        />
                      )}
                      {/* Black price line.
                          isAnimationActive={false} on every line in THIS chart: Recharts
                          animates a line by morphing its path from the old shape to the new
                          one, and switching the axis between Linear and Log changes every
                          point at once. Morphing through that looks like the chart lurching,
                          and leaves the line briefly drawn against the wrong scale. Redrawing
                          straight away is both calmer and always self-consistent. */}
                      {!isIndexView && (
                        <Line
                          type="monotone"
                          dataKey="price"
                          name={monthlySelectedTicker}
                          stroke={BLACK}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                          isAnimationActive={false}
                        />
                      )}
                      {/* vs IWDA: both series rebased to 100, plus a dashed line at the
                          starting level so "ahead or behind where we began" reads instantly. */}
                      {priceChartMode === 'vsMarket' && vsMarketData && (
                        <ReferenceLine y={100} stroke="#9CA3AF" strokeDasharray="3 3" strokeWidth={1} />
                      )}
                      {priceChartMode === 'vsMarket' && vsMarketData && hasBlend && (
                        <Line
                          type="monotone"
                          dataKey="blendIdx"
                          name={`50/50 ${monthlySelectedTicker}/${STRESS_BENCHMARK}`}
                          stroke={BLEND_LINE_COLOR}
                          strokeWidth={1.5}
                          dot={false}
                          connectNulls
                          isAnimationActive={false}
                        />
                      )}
                      {priceChartMode === 'vsMarket' && vsMarketData && (
                        <Line
                          type="monotone"
                          dataKey="marketIdx"
                          name={`${STRESS_BENCHMARK} (world equities)`}
                          stroke={MARKET_LINE_COLOR}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                          isAnimationActive={false}
                        />
                      )}
                      {priceChartMode === 'vsMarket' && vsMarketData && (
                        <Line
                          type="monotone"
                          dataKey="assetIdx"
                          name={monthlySelectedTicker}
                          stroke={BLACK}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                          isAnimationActive={false}
                        />
                      )}
                      {/* Inflation adjusted: the asset, general prices, and the asset with
                          that inflation taken back out — all from 100 at the window start. */}
                      {priceChartMode === 'inflation' && inflationData && (
                        <ReferenceLine y={100} stroke="#9CA3AF" strokeDasharray="3 3" strokeWidth={1} />
                      )}
                      {priceChartMode === 'inflation' && inflationData && hasInflation && (
                        <Line
                          type="monotone"
                          dataKey="inflationIdx"
                          name={`${monthlyDisplayCurrency} inflation (CPI)`}
                          stroke={CHART_PALETTE.terracotta}
                          strokeWidth={1.5}
                          dot={false}
                          connectNulls
                          isAnimationActive={false}
                        />
                      )}
                      {priceChartMode === 'inflation' && inflationData && hasInflation && (
                        <Line
                          type="monotone"
                          dataKey="realIdx"
                          name={`${monthlySelectedTicker} after inflation`}
                          stroke={CHART_PALETTE.teal}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                          isAnimationActive={false}
                        />
                      )}
                      {priceChartMode === 'inflation' && inflationData && (
                        <Line
                          type="monotone"
                          dataKey="nominalIdx"
                          name={monthlySelectedTicker}
                          stroke={BLACK}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                          isAnimationActive={false}
                        />
                      )}
                      {/* Today's price, extended back across the whole chart. Wherever the
                          black line crosses it, the asset was last worth what it is worth
                          now — which turns "how long have I been going sideways?" into
                          something you can read off at a glance. */}
                      {priceChartMode === 'sma' && lastRow && (
                        <ReferenceLine
                          y={lastRow.price}
                          stroke="#9ca3af"
                          strokeDasharray="5 4"
                          strokeWidth={1}
                        />
                      )}
                      {/* Red 10-month SMA line — the default overlay */}
                      {priceChartMode === 'sma' && (
                        <Line
                          type="monotone"
                          dataKey="sma10"
                          name="10M SMA"
                          stroke={SMA_COLOR}
                          strokeWidth={1.5}
                          dot={false}
                          connectNulls
                          isAnimationActive={false}
                        />
                      )}
                      {/* High water mark — the ratchet of previous peaks, flat until a new high */}
                      {isDrawdownView && (
                        <Line
                          type="monotone"
                          dataKey="hwm"
                          name="High water mark"
                          stroke={CHART_PALETTE.rose}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                          isAnimationActive={false}
                        />
                      )}
                      {/* "3y 4m" over the middle of every underwater stretch that lasted a year
                          or more. The dot itself is invisible (r=0) — it exists only to anchor
                          the text at the peak level, just above the pink area. */}
                      {labelledUnderwaterPeriods.map(p => (
                        <ReferenceDot
                          key={`uw-${p.startDate}`}
                          x={p.midDate}
                          y={p.peak}
                          r={0}
                          fill="none"
                          stroke="none"
                          label={{
                            value: formatPeriod(p.months),
                            position: 'top',
                            fontSize: 11,
                            fill: WINE_LABEL,
                            fontWeight: 600,
                          }}
                        />
                      ))}
                      {/* The other half of each of those stretches: how far and how fast the
                          fall was. Sits just under the price line at the bottom of the dip and
                          reads "-32.4% after 1y 5m" — the depth below the old peak, and how long
                          it took to get there. The label above answers "how long back to a new
                          high?"; this one answers "how bad did it get, and how quickly?".
                          Same invisible-anchor trick (r=0) as above. */}
                      {labelledUnderwaterPeriods.map(p => (
                        <ReferenceDot
                          key={`uw-trough-${p.startDate}`}
                          x={p.troughDate}
                          y={p.troughPrice}
                          r={0}
                          fill="none"
                          stroke="none"
                          label={{
                            value: `${p.depthPct.toFixed(1)}% after ${formatPeriod(p.troughMonths)}`,
                            position: 'bottom',
                            offset: 6,
                            fontSize: 11,
                            fill: WINE_LABEL,
                            fontWeight: 600,
                          }}
                        />
                      ))}
                      {/* Green dot at highest price in the visible period. Hidden in the
                          indexed views: those are PRICES, and those charts' axes are in
                          index points, so they would land at meaningless heights. */}
                      {!isIndexView && shownMaxPoint && (
                        <ReferenceDot
                          x={shownMaxPoint.date}
                          y={shownMaxPoint.price}
                          r={6}
                          fill={GAIN}
                          stroke={HALO}
                          strokeWidth={2}
                          label={{
                            value: formatPrice(shownMaxPoint.price),
                            position: 'top',
                            fontSize: 11,
                            fill: INK,
                            fontWeight: 600,
                          }}
                        />
                      )}
                      {/* Red dot at lowest price in the visible period */}
                      {!isIndexView && shownMinPoint && (
                        <ReferenceDot
                          x={shownMinPoint.date}
                          y={shownMinPoint.price}
                          r={6}
                          fill={LOSS}
                          stroke={HALO}
                          strokeWidth={2}
                          label={{
                            value: formatPrice(shownMinPoint.price),
                            position: 'bottom',
                            fontSize: 11,
                            fill: INK,
                            fontWeight: 600,
                          }}
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>

                  {/* Chart 2: Drawdown from All-Time High */}
                  <div className="mt-2">
                    <ResponsiveContainer width="100%" height={180}>
                      {/* No CartesianGrid on purpose — same as the price chart above it.
                          The Y-axis labels and the dashed zero line carry the levels, and
                          the shaded underwater area reads more cleanly without a mesh. */}
                      <AreaChart data={drawdownData} margin={{ top: 5, right: 70, left: -5, bottom: 15 }}>
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
                          stroke={BLACK}
                          fill={BLACK}
                          fillOpacity={0.1}
                          strokeWidth={1.5}
                        />
                        {/* Red dot at max drawdown in the visible period, label to the left */}
                        {maxDrawdownPoint && (
                          <ReferenceDot
                            x={maxDrawdownPoint.date}
                            y={maxDrawdownPoint.drawdown}
                            r={6}
                            fill={LOSS}
                            stroke={HALO}
                            strokeWidth={2}
                            label={{
                              value: `${maxDrawdownPoint.drawdown.toFixed(1)}%`,
                              position: 'left',
                              fontSize: 11,
                              fill: LOSS,
                              fontWeight: 600,
                            }}
                          />
                        )}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Chart 3: Periodic Returns bar chart (Monthly / Quarterly / Annual / Rolling CAGR) */}
                  {/* The rolling views are allowed through even with no bars, so a window
                      longer than the visible history shows an explanation rather than
                      silently taking the buttons away with it. */}
                  {(returnsData.length > 0 || rollingView) && (
                    <div className="mt-2">
                      {/* Toggle buttons: Monthly | Quarterly | Annual, then the rolling views
                          (phones: one box that opens a slide-up panel) */}
                      <div className="hidden max-md:flex mb-1 w-1/2">
                        <PhoneChoice
                          label="Returns"
                          options={RETURNS_PERIOD_CHOICES}
                          selected={returnsChartPeriod}
                          onPick={p => setReturnsChartPeriod(p as ReturnsChartPeriod)}
                        />
                      </div>
                      <div className="flex items-center gap-2 mb-1 px-2 flex-wrap max-md:hidden">
                        <span className="text-xs font-semibold text-gray-500">Returns:</span>
                        <span className={SEG}>
                        {(['monthly', 'quarterly', 'annual'] as const).map(p => (
                          <button
                            key={p}
                            onClick={() => setReturnsChartPeriod(p)}
                            className={segBtn(returnsChartPeriod === p)}
                          >
                            {p === 'monthly' ? 'Monthly' : p === 'quarterly' ? 'Quarterly' : 'Annual'}
                          </button>
                        ))}
                        </span>
                        {/* Rolling CAGR buttons — same look, kept in their own strip because
                            they answer a different question to the three above. */}
                        <span className={SEG}>
                        {ROLLING_RETURN_YEARS.map(r => (
                          <button
                            key={r.period}
                            onClick={() => setReturnsChartPeriod(r.period)}
                            title={`Rolling ${r.years}-year CAGR: every bar is the annual return you would have earned buying in that month and holding for ${r.years} year${r.years === 1 ? '' : 's'}. The X axis is the month the holding period STARTED.`}
                            className={segBtn(returnsChartPeriod === r.period)}
                          >
                            Rolling {r.years}Y
                          </button>
                        ))}
                        </span>
                        {/* Streak counters — months, not percentages, hence their own group */}
                        <span className={SEG}>
                        {STREAK_VIEWS.map(s => (
                          <button
                            key={s.period}
                            onClick={() => setReturnsChartPeriod(s.period)}
                            title={s.hint}
                            className={segBtn(returnsChartPeriod === s.period)}
                          >
                            {s.label}
                          </button>
                        ))}
                        </span>
                      </div>
                      {/* A rolling window needs at least that many years of history to draw
                          a single bar; say so instead of showing an empty chart. */}
                      {returnsData.length === 0 ? (
                        <p className="text-xs text-gray-500 px-2 py-6">
                          Not enough history in the visible period for a {rollingView?.years}-year rolling window.
                          Pick a longer period above (or Max), or a shorter rolling window.
                        </p>
                      ) : (
                      <>
                      {/* Up Months: longest up and down streak, above the bars */}
                      {returnsChartPeriod === 'upStreak' && (
                        <UpMonthsSummary series={[{
                          name: 'asset', color: BLACK,
                          bars: returnsData.map(b => ({ label: b.label, count: b.return })),
                        }]} />
                      )}
                      {/* height 300 = 50% taller than the original 200 for easier reading */}
                      <ResponsiveContainer width="100%" height={300}>
                        {/* No CartesianGrid, matching the price and drawdown charts above:
                            the bars themselves carry the shape, and the dashed zero line
                            below is the only reference level that actually matters here. */}
                        <BarChart data={returnsData} margin={{ top: 20, right: 10, left: -5, bottom: 15 }}>
                          <XAxis
                            dataKey="label"
                            tick={(props: { x: number; y: number; payload: { value: string } }) => {
                              const { x, y, payload } = props;
                              const parts = String(payload.value).split('\n');
                              if (parts.length === 2) {
                                // Two-line label (quarterly: "2Q\n2024")
                                return (
                                  <text x={x} y={y} textAnchor="middle" fontSize={9} fill={MUTED}>
                                    <tspan x={x} dy="0.5em">{parts[0]}</tspan>
                                    <tspan x={x} dy="1.2em">{parts[1]}</tspan>
                                  </text>
                                );
                              }
                              // Single-line label (monthly: "Jan 25", annual: "2024")
                              return <text x={x} y={y + 10} textAnchor="middle" fontSize={9} fill={MUTED}>{payload.value}</text>;
                            }}
                            height={35}
                            interval={monthlyGrained && returnsData.length > 24
                              ? Math.max(0, Math.floor(returnsData.length / 20) - 1)
                              : 0}
                          />
                          {/* Streaks are a count of months, so the axis drops the % sign */}
                          <YAxis
                            tick={{ fontSize: 9 }}
                            width={40}
                            tickFormatter={(v: number) => streakView ? v.toFixed(0) : `${v.toFixed(0)}%`}
                            padding={{ bottom: lossLabelRoom(returnsData.some(d => d.return < 0), 9) }}
                          />
                          <Tooltip
                            formatter={(value: number) => streakView
                              ? [`${value} month${value === 1 ? '' : 's'}`, streakView.noun]
                              : [
                                `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`,
                                rollingView ? `${rollingView.years}Y CAGR` : 'Return',
                              ]}
                            {...(rollingView ? {
                              // On a rolling view the X label alone ("Dec 09") is only half
                              // the story, so the tooltip spells out the whole window and the
                              // two month-end prices the CAGR was worked out from.
                              labelFormatter: (label: string,
                                               payload: readonly { payload?: { range?: string; startPrice?: number; endPrice?: number } }[]) => {
                                const p = payload?.[0]?.payload;
                                if (!p?.range) return label;
                                return (
                                  <>
                                    {p.range}
                                    {p.startPrice !== undefined && p.endPrice !== undefined && (
                                      <>
                                        <br />
                                        <span style={{ fontWeight: 400, color: MUTED }}>
                                          {formatPrice(p.startPrice)} → {formatPrice(p.endPrice)}
                                          {' '}{monthlyDisplayCurrency || selectedAssetCcy}
                                        </span>
                                      </>
                                    )}
                                  </>
                                );
                              },
                            } : {})}
                          />
                          <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" strokeWidth={1} />
                          <Bar dataKey="return" isAnimationActive={false}>
                            {/* Color each bar: GAIN green for positive, LOSS red for negative */}
                            {returnsData.map((entry, index) => (
                              <Cell key={index} fill={entry.return >= 0 ? GAIN : LOSS} />
                            ))}
                            {/* Labels above positive bars — a plain month count on a streak
                                view, where a "%" would be nonsense */}
                            {showReturnLabels && (
                              <LabelList
                                dataKey="return"
                                position="top"
                                formatter={(value: number) => streakView
                                  ? (value > 0 ? String(value) : '')
                                  : (value >= 0 ? `+${value.toFixed(1)}%` : '')}
                                style={{ fontSize: '9px', fill: MUTED_LABEL }}
                              />
                            )}
                            {/* Labels below negative bars */}
                            {showReturnLabels && (
                              <LabelList
                                dataKey="return"
                                content={lossBarLabel((value: number) => `${value.toFixed(1)}%`, { fontSize: '9px', fill: LOSS })}
                              />
                            )}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      </>
                      )}
                    </div>
                  )}

                  {/* === DURING STRESS — this asset vs world equities, month by month === */}
                  {(() => {
                    // Years world equities had a hard time. 2020 and 2015 finished UP overall,
                    // which is precisely why the monthly view matters: the damage was
                    // concentrated in a few months (Feb-Mar 2020) that an annual figure hides.
                    const STRESS_YEARS = [2025, 2022, 2020, 2018, 2015, 2011];
                    const ccy = monthlyDisplayCurrency || getAssetCurrency(monthlySelectedTicker);
                    const stress = getStressYearData(monthlySelectedTicker, stressYear, ccy);
                    if (!stress) return null;

                    const { rows, assetTotal, benchTotal, assetMonths } = stress;
                    const diff = (assetTotal !== null && benchTotal !== null) ? assetTotal - benchTotal : null;
                    const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
                    // Bar labels drop the leading "+" — the bar's direction already says the sign,
                    // and with 24 of them on screen every saved character helps. Months with no
                    // price return an empty string so nothing is drawn for them.
                    // Gains: above the bar (Recharts' "top"). Losses: lossBarLabel, under the bar.
                    const barLabel = (v: number | null) =>
                      (v === null || v === undefined || v < 0) ? '' : `${v.toFixed(1)}%`;

                    // --- The gap strip ---
                    // Drawn as a LabelList with custom content rather than as HTML above the
                    // chart, because Recharts hands us each bar's real x here. That is the only
                    // way the pills stay glued to their month when the panel is resized; an
                    // HTML row would drift the moment the y-axis width changed.
                    //
                    // A gap under a point either way is noise, so it renders as plain grey text
                    // with no pill. The eye then lands only on months that actually moved the
                    // needle — which is the whole reason for the strip.
                    const GAP_MUTED_THRESHOLD = 1;
                    // Pixels between the asset bar and the benchmark bar within a month. Recharts
                    // defaults this to 4, but it is declared here and passed to the chart because
                    // the pill-centring maths below depends on it — leaving it implicit meant the
                    // pills sat 2px left of true centre, and would have silently drifted further
                    // if a Recharts upgrade changed the default.
                    const STRESS_BAR_GAP = 4;
                    // Headroom above the tallest bar. Without it Recharts lets a bar touch the
                    // top of the plot area, its value label rides up into the margin, and the
                    // gap pills — which sit just above the plot area — get collided with. The
                    // extra space is what makes it safe to tuck the pills down close to the
                    // chart instead of parking them far away at the top of the SVG.
                    const stressVals = rows.flatMap(r => [r.asset, r.bench]).filter((v): v is number => v !== null);
                    const stressHi = Math.max(0, ...stressVals);
                    const stressLo = Math.min(0, ...stressVals);
                    const stressSpan = (stressHi - stressLo) || 1;
                    // (Room below for the loss labels under the lowest bars: 10% of the span)
                    const stressDomain: [number, number] = [stressLo - stressSpan * (stressLo < 0 ? 0.10 : 0.06), stressHi + stressSpan * 0.18];
                    // Pinning the domain costs Recharts its round auto-ticks — the axis came out
                    // reading -10%, -4%, 2%, 11%. So the ticks are chosen here instead: a 1/2/5
                    // step, and only the multiples that fall INSIDE the domain. That keeps the
                    // domain tight (headroom preserved) while every label stays a round number,
                    // and 0 is always among them since 0 is a multiple of any step.
                    const stressStep = (() => {
                      const raw = (stressDomain[1] - stressDomain[0]) / 5;
                      if (!isFinite(raw) || raw <= 0) return 1;
                      const mag = Math.pow(10, Math.floor(Math.log10(raw)));
                      const n = raw / mag;
                      return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
                    })();
                    const stressTicks = (() => {
                      const out: number[] = [];
                      const start = Math.ceil(stressDomain[0] / stressStep) * stressStep;
                      for (let v = start; v <= stressDomain[1] + 1e-9 && out.length < 20; v += stressStep) {
                        out.push(Math.round(v * 1e6) / 1e6);   // shake off float dust like 4.999999
                      }
                      return out;
                    })();

                    // The cumulative axis runs from ZERO up past the tallest bar, so bar height
                    // means value. Headroom on top leaves room for the year-end labels, which
                    // sit just above their bars. Divided by 6 with a 2.5 rung on the ladder
                    // because a 0..140 range over 5 steps lands on 50s and gives only three
                    // labels; this way it lands on 25s.
                    const niceStep = (span: number) => {
                      const raw = span / 6;
                      if (!isFinite(raw) || raw <= 0) return 1;
                      const mag = Math.pow(10, Math.floor(Math.log10(raw)));
                      const n = raw / mag;
                      return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
                    };
                    const cumVals = rows.flatMap(r => [r.cumAsset, r.cumBench]).filter((v): v is number => v !== null);
                    const cumHi = Math.max(100, ...cumVals);
                    const cumDomain: [number, number] = [0, cumHi * 1.1];
                    const cumStep = niceStep(cumDomain[1]);
                    const cumTicks = (() => {
                      const out: number[] = [];
                      for (let v = 0; v <= cumDomain[1] + 1e-9 && out.length < 20; v += cumStep) {
                        out.push(Math.round(v * 1e6) / 1e6);
                      }
                      return out;
                    })();

                    // Only the LAST month with a value gets a label — the year's outcome. Which
                    // month that is differs per series (one may run out of data earlier), so it
                    // is found per key rather than assumed to be December.
                    const lastFilled = (key: 'cumAsset' | 'cumBench') => {
                      for (let i = rows.length - 1; i >= 0; i--) if (rows[i][key] !== null) return i;
                      return -1;
                    };
                    const renderEndLabel = (key: 'cumAsset' | 'cumBench', fill: string) =>
                      (props: { x?: string | number; y?: string | number; width?: string | number; height?: string | number; index?: number }) => {
                        const index = props.index;
                        if (index === undefined || index !== lastFilled(key)) return null;
                        const v = rows[index][key];
                        if (v === null) return null;
                        const x = Number(props.x), width = Number(props.width);
                        const y = Number(props.y), height = Number(props.height);
                        if (!isFinite(x) || !isFinite(width) || !isFinite(y)) return null;
                        // Do NOT assume `y` is the bar's top edge with a positive height. For a bar
                        // hanging below the 100 line Recharts anchors `y` at the VALUE end and hands
                        // back a NEGATIVE height back up to the baseline — assuming otherwise put
                        // every below-100 label in the same spot just under the 100 line, nowhere
                        // near the bar it belonged to. Deriving both edges works either way round.
                        // Do NOT assume `y` is the bar's top edge with a positive height —
                        // Recharts sometimes anchors `y` at the value end and returns a NEGATIVE
                        // height back to the baseline. Deriving the top from both ends works
                        // either way round.
                        const h = isFinite(height) ? height : 0;
                        const top = Math.min(y, y + h);
                        return (
                          <text x={x + width / 2} y={top - 5} textAnchor="middle" fontSize={11} fontWeight={700} fill={fill}>
                            {v.toFixed(1)}
                          </text>
                        );
                      };
                    // Recharts types x/width as `string | number`, so they are coerced rather
                    // than assumed — a non-numeric x would place the pill at NaN and vanish it.
                    const renderGapPill = (props: { x?: string | number; width?: string | number; index?: number }) => {
                      const x = Number(props.x), width = Number(props.width), index = props.index;
                      if (!isFinite(x) || !isFinite(width) || index === undefined) return null;
                      const gap = rows[index]?.gap;
                      if (gap === null || gap === undefined) return null;
                      // The asset bar starts at x, then a STRESS_BAR_GAP gutter, then the
                      // benchmark bar of the same width. So the pair spans x .. x+2*width+gap,
                      // and its centre is one full bar plus half the gutter to the right.
                      const cx = x + width + STRESS_BAR_GAP / 2;
                      const text = `${gap >= 0 ? '+' : ''}${gap.toFixed(1)}`;
                      const muted = Math.abs(gap) < GAP_MUTED_THRESHOLD;
                      const pillW = text.length * 6 + 10;
                      const fg = muted ? '#9ca3af' : gap >= 0 ? GAIN : LOSS;
                      const bg = gap >= 0 ? GAIN_PILL : LOSS_PILL;
                      // Sits low in the top margin so it reads as belonging to the chart rather
                      // than floating above it. The Y-axis headroom above keeps this band clear.
                      return (
                        <g>
                          {!muted && (
                            <rect x={cx - pillW / 2} y={13} width={pillW} height={17} rx={5} fill={bg} />
                          )}
                          <text x={cx} y={25} textAnchor="middle" fontSize={11}
                                fontWeight={muted ? 500 : 700} fill={fg}>
                            {text}
                          </text>
                        </g>
                      );
                    };
                    const assetName = assetLookup.find(a => a.ticker === monthlySelectedTicker)?.name || monthlySelectedTicker;

                    return (
                      <div className="mt-4 pt-3 border-t border-gray-200">
                        {/* Phones: the stress year as one box that opens a slide-up panel */}
                        <div className="hidden max-md:flex items-center gap-2 mb-2">
                          <div className="w-1/2 flex">
                            <PhoneChoice
                              label="During stress"
                              options={STRESS_YEARS.map(y => ({ value: String(y), label: String(y) }))}
                              selected={String(stressYear)}
                              onPick={y => setStressYear(Number(y))}
                            />
                          </div>
                          <span className="text-xs text-gray-400">in {ccy}</span>
                        </div>
                        <div className="flex items-center gap-2 mb-2 px-2 flex-wrap max-md:hidden">
                          <span className="text-xs font-semibold text-gray-700">During stress:</span>
                          <span className={SEG}>
                          {STRESS_YEARS.map(y => (
                            <button
                              key={y}
                              onClick={() => setStressYear(y)}
                              className={segBtn(stressYear === y)}
                            >
                              {y}
                            </button>
                          ))}
                          </span>
                          <span className="text-xs text-gray-400">in {ccy}</span>
                        </div>

                        {assetMonths === 0 ? (
                          <div className="text-xs text-gray-500 px-2 py-6 text-center">
                            No price history for {assetName} in {stressYear}.
                          </div>
                        ) : (
                          <>
                            {/* Full-year summary — compounded, so it is the real outcome of
                                holding it through the year, not the sum of the bars */}
                            <div className="text-xs px-2 mb-1">
                              <span className="font-semibold text-gray-700">{stressYear}:</span>{' '}
                              <span className="text-gray-700">{assetName} </span>
                              <span className={`font-mono font-semibold ${assetTotal !== null && assetTotal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {assetTotal !== null ? pct(assetTotal) : '—'}
                              </span>
                              <span className="text-gray-400"> vs </span>
                              <span className="text-gray-700">world equities </span>
                              <span className={`font-mono font-semibold ${benchTotal !== null && benchTotal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {benchTotal !== null ? pct(benchTotal) : '—'}
                              </span>
                              {diff !== null && (
                                <>
                                  <span className="text-gray-400"> → </span>
                                  <span className={`font-medium ${diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {diff >= 0 ? 'outperformed' : 'underperformed'} by {Math.abs(diff).toFixed(1)}pp
                                  </span>
                                </>
                              )}
                              {assetMonths < 12 && (
                                <span className="text-amber-600"> · only {assetMonths} of 12 months have data</span>
                              )}
                            </div>
                            {/* Says what the pills are, and warns that they are RELATIVE — a
                                green month can still be a month you lost money, it just lost
                                less than the market did. */}
                            <div className="text-[10px] text-gray-400 px-2 mb-1">
                              Pills show each month&apos;s gap in percentage points (this asset − world equities);
                              grey under {GAP_MUTED_THRESHOLD}pp. Green means it beat the market that month, not that it made money.
                            </div>

                            {/* The gap strip owns y=13..30 and the plot area starts at 34, so
                                the pills sit just above the chart rather than adrift at the top
                                of the SVG. Their lane stays clear because stressDomain reserves
                                headroom above the tallest bar. */}
                            {/* Month labels and the legend live on the cumulative chart below —
                                the two share one axis, so printing them twice would just be
                                noise between the panes. `hide` keeps the category scale doing
                                its job while removing the labels. */}
                            <ResponsiveContainer width="100%" height={218}>
                              <BarChart data={rows} barGap={STRESS_BAR_GAP} margin={{ top: 34, right: 10, left: -5, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="month" hide />
                                <YAxis tick={{ fontSize: 9 }} width={40} domain={stressDomain} ticks={stressTicks}
                                       tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                                <Tooltip
                                  formatter={(value: number, name: string) => [pct(value), name]}
                                  labelFormatter={(l: string) => `${l} ${stressYear}`}
                                />
                                <ReferenceLine y={0} stroke="#9CA3AF" strokeWidth={1} />
                                {/* Black for the asset and gold (MARKET_LINE_COLOR) for the benchmark:
                                    world equities are gold wherever they are the yardstick.
                                    Labels sit above a gain bar and under a loss bar (lossBarLabel),
                                    in each series' own label colour. isAnimationActive={false} is what
                                    makes them appear at all: Recharts draws labels only after the
                                    entry animation finishes. */}
                                <Bar dataKey="asset" name={assetName} fill={BLACK} isAnimationActive={false}>
                                  <LabelList dataKey="asset" position="top" formatter={barLabel}
                                             style={{ fontSize: '8px', fill: INK_SOFT }} />
                                  <LabelList dataKey="asset" content={lossBarLabel(v => `${v.toFixed(1)}%`, { fontSize: '8px', fill: INK_SOFT })} />
                                  {/* The gap strip rides on this series purely to get its x */}
                                  <LabelList content={renderGapPill} />
                                </Bar>
                                <Bar dataKey="bench" name="World equities (IWDA)" fill={MARKET_LINE_COLOR} isAnimationActive={false}>
                                  <LabelList dataKey="bench" position="top" formatter={barLabel}
                                             style={{ fontSize: '8px', fill: BENCH_LABEL }} />
                                  <LabelList dataKey="bench" content={lossBarLabel(v => `${v.toFixed(1)}%`, { fontSize: '8px', fill: BENCH_LABEL })} />
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>

                            {/* --- Cumulative: 100 invested on 1 January, compounded --- */}
                            {/* Identical left/right margins, YAxis width and barGap as the chart
                                above, which is what makes every bar sit directly under its
                                monthly counterpart. Change one and you must change both. */}
                            <div className="text-[10px] text-gray-500 px-2 mt-1 mb-0.5">
                              Cumulative — 100 at the start of {stressYear}, compounded month by month
                            </div>
                            <ResponsiveContainer width="100%" height={196}>
                              <BarChart data={rows} barGap={STRESS_BAR_GAP} margin={{ top: 14, right: 10, left: -5, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                                <YAxis tick={{ fontSize: 9 }} width={40} domain={cumDomain} ticks={cumTicks}
                                       tickFormatter={(v: number) => v.toFixed(0)} />
                                <Tooltip
                                  formatter={(value: number, name: string) =>
                                    [`${value.toFixed(1)}  (${value >= 100 ? '+' : ''}${(value - 100).toFixed(1)}%)`, name]}
                                  labelFormatter={(l: string) => `${l} ${stressYear}`}
                                />
                                {/* The starting level, so you can see at a glance which bars are
                                    above water and which are below without reading the axis */}
                                <ReferenceLine y={100} stroke="#9CA3AF" strokeDasharray="3 3" strokeWidth={1} />
                                <Legend wrapperStyle={{ fontSize: 11 }} />
                                <Bar dataKey="cumAsset" name={assetName} fill={BLACK} isAnimationActive={false}>
                                  <LabelList content={renderEndLabel('cumAsset', INK)} />
                                </Bar>
                                <Bar dataKey="cumBench" name="World equities (IWDA)" fill={MARKET_LINE_COLOR} isAnimationActive={false}>
                                  <LabelList content={renderEndLabel('cumBench', BENCH_LABEL)} />
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {/* Chart 4: SMA Distance — how far price is from 10-month SMA (in %) */}
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
                              <stop offset="0%" stopColor={GAIN} />
                              <stop offset={`${smaDistGradientOffset * 100}%`} stopColor={GAIN} />
                              <stop offset={`${smaDistGradientOffset * 100}%`} stopColor={LOSS} />
                              <stop offset="100%" stopColor={LOSS} />
                            </linearGradient>
                            <linearGradient id="smaDistFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={GAIN} />
                              <stop offset={`${smaDistGradientOffset * 100}%`} stopColor={GAIN} />
                              <stop offset={`${smaDistGradientOffset * 100}%`} stopColor={LOSS} />
                              <stop offset="100%" stopColor={LOSS} />
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
                              fill={GAIN}
                              stroke={HALO}
                              strokeWidth={2}
                              label={{
                                value: `+${maxSmaDistPoint.smaDist.toFixed(1)}%`,
                                position: 'left',
                                fontSize: 11,
                                fill: GAIN,
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
                              fill={LOSS}
                              stroke={HALO}
                              strokeWidth={2}
                              label={{
                                value: `${minSmaDistPoint.smaDist.toFixed(1)}%`,
                                position: 'left',
                                fontSize: 11,
                                fill: LOSS,
                                fontWeight: 600,
                              }}
                            />
                          )}
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* ================================================
                      MONTHLY & FY RETURNS TABLE
                      Calendar-style table: rows = years, columns = Jan–Dec + FY.
                      Reuses calculateMonthlyReturns() — same table as in backtest tab.
                      ================================================ */}
                  {Object.keys(assetMonthlyReturns).length > 0 && (() => {
                    // Years that actually have at least one monthly return (same filter used by the rows below)
                    const returnYears = Object.keys(assetMonthlyReturns)
                      .filter(year => assetMonthlyReturns[year].monthly.some(r => r !== null));

                    // --- Column summary stats (for the Average + Loss rate footer rows) ---
                    // For each of the 12 months: simple average of the shown values, and [# negative, # total]
                    const monthAvg: (number | null)[] = [];
                    const monthLoss: [number, number][] = [];
                    for (let m = 0; m < 12; m++) {
                      const vals = returnYears
                        .map(y => assetMonthlyReturns[y].monthly[m])
                        .filter((r): r is number => r !== null);
                      monthAvg[m] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
                      monthLoss[m] = [vals.filter(v => v < 0).length, vals.length];
                    }

                    // FY column: simple average of each year's full-year return, plus loss count
                    const fyVals = returnYears.map(y => assetMonthlyReturns[y].fy);
                    const fyAvg = fyVals.length ? fyVals.reduce((a, b) => a + b, 0) / fyVals.length : null;
                    const fyLoss: [number, number] = [fyVals.filter(v => v < 0).length, fyVals.length];

                    // Quarter columns (1Q–4Q): recompute each year's quarter return, then average / count losses
                    const qAvg: (number | null)[] = [];
                    const qLoss: [number, number][] = [];
                    [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]].forEach((qMonths, qi) => {
                      const qvals: number[] = [];
                      for (const y of returnYears) {
                        const mReturns = qMonths.map(m => assetMonthlyReturns[y].monthly[m]);
                        if (!mReturns.some(r => r !== null)) continue;
                        const qReturn = mReturns.reduce<number>((acc, r) => r !== null ? acc * (1 + r / 100) : acc, 1);
                        qvals.push((qReturn - 1) * 100);
                      }
                      qAvg[qi] = qvals.length ? qvals.reduce((a, b) => a + b, 0) / qvals.length : null;
                      qLoss[qi] = [qvals.filter(v => v < 0).length, qvals.length];
                    });

                    return (
                    <div className="bg-white p-4 rounded-lg shadow overflow-x-auto mt-4">
                      <h3 className="text-md font-semibold mb-2 text-gray-700 max-md:sticky max-md:left-0">
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
                          {/* ---- AVERAGE row: simple mean of each column, colored green/red like the data ---- */}
                          <tr className="border-t-2 border-gray-200">
                            <td className="py-2 px-2 font-medium bg-gray-50 sticky left-0">Average</td>
                            {monthAvg.map((avg, m) => {
                              if (avg === null) {
                                return <td key={m} className="text-right py-2 px-2 text-gray-300">-</td>;
                              }
                              const bgColor = avg >= 0 ? 'bg-green-50' : 'bg-red-50';
                              const textColor = avg >= 0 ? 'text-green-700' : 'text-red-700';
                              return (
                                <td key={m} className={`text-right py-2 px-2 ${bgColor} ${textColor}`}>
                                  {avg.toFixed(2)}%
                                </td>
                              );
                            })}
                            <td className={`text-right py-2 px-2 font-semibold ${
                              fyAvg === null ? 'text-gray-300' : fyAvg >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {fyAvg === null ? '-' : `${fyAvg.toFixed(2)}%`}
                            </td>
                            <td className="w-2"></td>
                            {qAvg.map((avg, qi) => {
                              if (avg === null) {
                                return <td key={`qa${qi}`} className="text-right py-2 px-2 text-gray-300">-</td>;
                              }
                              return (
                                <td key={`qa${qi}`} className={`text-right py-2 px-2 font-semibold ${
                                  avg >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                }`}>
                                  {avg.toFixed(2)}%
                                </td>
                              );
                            })}
                          </tr>
                          {/* ---- LOSS RATE row: "x/Y" = negative months / total months, styled like the header ---- */}
                          <tr className="border-b border-gray-100">
                            <td className="py-2 px-2 font-semibold bg-gray-50 sticky left-0">Loss rate</td>
                            {monthLoss.map(([neg, total], m) => (
                              <td key={m} className="text-right py-2 px-2 bg-gray-50 text-gray-600">
                                {total > 0 ? `${neg}/${total}` : '-'}
                              </td>
                            ))}
                            <td className="text-right py-2 px-2 bg-gray-100 font-semibold text-gray-600">
                              {fyLoss[1] > 0 ? `${fyLoss[0]}/${fyLoss[1]}` : '-'}
                            </td>
                            <td className="w-2"></td>
                            {qLoss.map(([neg, total], qi) => (
                              <td key={`ql${qi}`} className="text-right py-2 px-2 bg-gray-100 font-semibold text-gray-600">
                                {total > 0 ? `${neg}/${total}` : '-'}
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    );
                  })()}

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
                        <h3 className="text-md font-semibold mb-2 text-gray-700 max-md:sticky max-md:left-0">
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
                                        {formatPrice(price)}
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
                                      ? formatPrice(monthlyPrices[year].fyPrice!)
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

                    // Drawdowns: white at 0% (nothing to see), then the red half of the one heat
                    // scale up to the worst drawdown (stopping at its middle shade, for the text)
                    const getDDColor = (dd: number): string => {
                      if (dd === 0 || worstDD === 0) return themedCell('#ffffff');
                      const pos = dd / worstDD; // 0 = at ATH, 1 = worst drawdown
                      return heatColor(-pos, 0.67);
                    };

                    // Max ATH count for green heatmap scaling
                    const maxATHs = Math.max(...Object.values(monthlyDDs).map(y => y.athCount), 1);

                    // All-time highs: white at 0, then the green half of the one heat scale
                    const getATHColor = (count: number): string => {
                      if (count === 0 || maxATHs === 0) return themedCell('#ffffff');
                      const pos = count / maxATHs;
                      return heatColor(pos, 0.67);
                    };

                    const years = Object.keys(monthlyDDs)
                      .filter(year => monthlyDDs[year].monthly.some(d => d !== null))
                      .sort().reverse();

                    if (years.length === 0) return null;

                    return (
                      <div className="bg-white p-4 rounded-lg shadow overflow-x-auto mt-4">
                        <h3 className="text-md font-semibold mb-2 text-gray-700 max-md:sticky max-md:left-0">
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
  );
}
