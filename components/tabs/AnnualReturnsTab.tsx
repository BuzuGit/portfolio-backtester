/*
  THE ANNUAL TAB

  Every filtered asset's calendar-year returns (or year-end prices) side by side, with Period,
  CAGR, Vol, Sharpe, drawdowns and 1–5 year returns, sortable by any column, with a Years filter.

  The calculations are in lib/assetStats.ts and lib/stats.ts. The filter bar and this tab's
  choices (view, years, sort) live in the main screen and are passed in, so they survive switching
  tabs. getPeriodReturn stays in the main screen because it re-prices EDO bonds per window.
*/
import React from 'react';
import type { AssetRow, AssetLookup } from '@/lib/fetchData';
import { isPhoneScreen } from '@/lib/savedSheet';
import { sharpeRatio as sharpeFor } from '@/lib/stats';
import { formatPeriod } from '@/lib/backtest';
import {
  getYearsWithData, getAssetPriceRange as priceRangeOf, calculateCAGR, calculateAssetStats as assetStatsOf,
  getAssetCurrentDrawdown as currentDrawdownOf, type AssetsAnnualReturns,
} from '@/lib/assetStats';
import { PhoneCheckSheet } from '@/components/PhoneSheet';
import {
  CAGR_HINT, INK_SOFT, SEG, SHARPE_HINT, formatPrice, getHeatmapColor, getPeriodReturnTooltip,
  getReturnTooltip, heatColor, segBtn,
} from '@/components/ui';

/** A ticker's return over the last N years (the main screen's getPeriodReturn). */
type PeriodReturn = { return: number; startDate: string; startPrice: number; endDate: string; endPrice: number } | null;

export interface AnnualReturnsTabProps {
  assetData: AssetRow[];
  assetLookup: AssetLookup[];
  filteredAssets: AssetLookup[];                     // the assets passing the filter bar, in order
  memoizedAnnualReturns: AssetsAnnualReturns;
  getPeriodReturn: (ticker: string, years: number) => PeriodReturn;
  annualViewMode: 'returns' | 'prices';
  setAnnualViewMode: (m: 'returns' | 'prices') => void;
  annualReturnsSortColumn: string | number | null;
  setAnnualReturnsSortColumn: (c: string | number | null) => void;
  selectedYears: number[] | null;                    // null = all years
  setSelectedYears: (y: number[] | null) => void;
  yearsDropdownOpen: boolean;
  setYearsDropdownOpen: (open: boolean) => void;
  yearsDropdownRef: React.RefObject<HTMLDivElement>; // the main screen closes the list on an outside click
  renderFilters: (extraControls: React.ReactNode) => React.ReactNode;
}

export default function AnnualReturnsTab({
  assetData, assetLookup, filteredAssets, memoizedAnnualReturns, getPeriodReturn,
  annualViewMode, setAnnualViewMode, annualReturnsSortColumn, setAnnualReturnsSortColumn,
  selectedYears, setSelectedYears, yearsDropdownOpen, setYearsDropdownOpen, yearsDropdownRef, renderFilters,
}: AnnualReturnsTabProps) {
  // The four per-asset calculations, on this tab's price table (lib/assetStats.ts)
  const getAssetPriceRange = (ticker: string) => priceRangeOf(assetData, ticker);
  const calculateAssetStats = (ticker: string, startDate?: string, endDate?: string) => assetStatsOf(assetData, ticker, startDate, endDate);
  const getAssetCurrentDrawdown = (ticker: string) => currentDrawdownOf(assetData, ticker);

  return (
    <div className="mt-2">

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
          {renderFilters(<>
            {/* Toggle buttons to switch between returns view and prices view */}
            <div className={SEG}>
              <button
                onClick={() => setAnnualViewMode('returns')}
                className={segBtn(annualViewMode === 'returns')}
              >
                Returns
              </button>
              <button
                onClick={() => setAnnualViewMode('prices')}
                className={segBtn(annualViewMode === 'prices')}
              >
                Prices
              </button>
            </div>
            {/* Years filter dropdown - only shown on this tab */}
            <div className="relative" ref={yearsDropdownRef}>
              <button
                onClick={() => setYearsDropdownOpen(!yearsDropdownOpen)}
                className={`h-8 px-3 text-xs border rounded-lg flex items-center gap-2 max-md:h-auto max-md:py-1.5 max-md:text-sm ${
                  yearsDropdownOpen ? 'border-slate-400 bg-gray-100' : 'border-gray-300 bg-white hover:bg-gray-50'
                }`}
              >
                <span className="font-medium">Years:</span>
                <span className="text-gray-600">{yearsLabel}</span>
                <svg className={`w-4 h-4 transition-transform ${yearsDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {yearsDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-300 rounded-lg shadow-lg min-w-[160px] max-md:hidden">
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
          </>)}

        {/* Phones: the Years tick list as a slide-up panel (its drop-down list is hidden there).
            Here rather than next to the Years button, which is inside AssetFilterControls:
            that is rebuilt on every tick, which would replay the panel's slide-in each time. */}
        {yearsDropdownOpen && isPhoneScreen() && (
          <PhoneCheckSheet
            title="Years"
            options={years.map(y => ({ value: String(y), label: String(y) }))}
            checked={(selectedYears ?? years).map(String)}
            onToggle={v => {
              const year = years.find(y => String(y) === v)!;
              const current = selectedYears ?? years;
              const next = current.includes(year) ? current.filter(y => y !== year) : [...current, year];
              // All ticked again = back to "all" (null), as on desktop
              setSelectedYears(next.length === years.length ? null : next);
            }}
            onSetAll={all => setSelectedYears(all ? null : [])}
            onClose={() => setYearsDropdownOpen(false)}
          />
        )}

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
            // Under a year there is no Sharpe (a dash), so it sorts with the blanks
            return sharpeFor(cagr, stats.volatility, priceRange.months / 12) ?? -Infinity;
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
        const sortedAssetLookup = [...filteredAssets].sort((a, b) => {
          if (annualReturnsSortColumn === null) return 0;
          const aVal = getSortValue(a.ticker, annualReturnsSortColumn);
          const bVal = getSortValue(b.ticker, annualReturnsSortColumn);
          return bVal - aVal;  // Descending order (best first)
        });

        // Helper for sortable header styling
        const getSortableHeaderClass = (column: string | number, baseClass: string) => {
          const isSelected = annualReturnsSortColumn === column;
          // Background as a class (blue-200 = #bfdbfe sorted, gray-100 = #f3f4f6 otherwise,
          // the same colours the inline style used to set) so app/dark.css can theme it
          return `${baseClass} cursor-pointer select-none ${isSelected ? 'font-bold bg-blue-200' : 'bg-gray-100'}`;
        };

        return (
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="overflow-auto max-h-[95vh]">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  {/* Asset Name column - sticky both top and left (corner cell, highest z-index) */}
                  <th className="text-left py-2 px-2 sticky top-0 left-0 z-30 min-w-[150px] bg-gray-100">
                    Asset
                  </th>
                  {/* Year columns - oldest to newest, clickable for sorting (filtered by selected years) */}
                  {displayYears.map(year => (
                    <th
                      key={year}
                      className={getSortableHeaderClass(year, 'text-right py-2 px-2 sticky top-0 z-20 min-w-[60px]')}                              onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === year ? null : year)}
                    >
                      {year}
                    </th>
                  ))}
                  {/* Period column - shows data history length */}
                  <th
                    className={getSortableHeaderClass('Period', 'text-right py-2 px-2 sticky top-0 z-20 min-w-[60px]')}                            onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === 'Period' ? null : 'Period')}
                  >
                    Period
                  </th>
                  {/* CAGR column - compound annual growth rate */}
                  <th
                    className={getSortableHeaderClass('CAGR', 'text-right py-2 px-2 sticky top-0 z-20 min-w-[60px]')}                            onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === 'CAGR' ? null : 'CAGR')}
                    title={CAGR_HINT}
                  >
                    CAGR
                  </th>
                  {/* Volatility column - annualized std dev of monthly returns */}
                  <th
                    className={getSortableHeaderClass('Vol', 'text-right py-2 px-2 sticky top-0 z-20 min-w-[50px]')}                            onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === 'Vol' ? null : 'Vol')}
                  >
                    Vol
                  </th>
                  {/* Sharpe Ratio column - risk-adjusted return */}
                  <th
                    className={getSortableHeaderClass('Sharpe', 'text-right py-2 px-2 sticky top-0 z-20 min-w-[55px]')}                            onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === 'Sharpe' ? null : 'Sharpe')}
                    title={SHARPE_HINT}
                  >
                    Sharpe
                  </th>
                  {/* Max Drawdown column - worst peak-to-trough decline */}
                  <th
                    className={getSortableHeaderClass('MaxDD', 'text-right py-2 px-2 sticky top-0 z-20 min-w-[55px]')}                            onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === 'MaxDD' ? null : 'MaxDD')}
                  >
                    Max DD
                  </th>
                  {/* DD Duration column - longest drawdown duration */}
                  <th
                    className={getSortableHeaderClass('DDDur', 'text-right py-2 px-2 sticky top-0 z-20 min-w-[55px]')}                            onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === 'DDDur' ? null : 'DDDur')}
                  >
                    DD Dur
                  </th>
                  {/* Current Drawdown column - distance from ATH */}
                  <th
                    className={getSortableHeaderClass('CurrDD', 'text-right py-2 px-2 sticky top-0 z-20 min-w-[55px]')}                            onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === 'CurrDD' ? null : 'CurrDD')}
                  >
                    Curr DD
                  </th>
                  {/* Ticker column - placed after Curr DD */}
                  <th className="text-left py-2 px-2 sticky top-0 z-20 bg-gray-100">Ticker</th>
                  {/* Empty separator column */}
                  <th className="py-2 px-1 w-2 sticky top-0 z-20 bg-gray-100"></th>
                  {/* Period return columns (1Y-5Y) */}
                  {['1Y', '2Y', '3Y', '4Y', '5Y'].map(period => (
                    <th
                      key={period}
                      className={getSortableHeaderClass(period, 'text-right py-2 px-2 sticky top-0 z-20 min-w-[50px]')}                              onClick={() => setAnnualReturnsSortColumn(annualReturnsSortColumn === period ? null : period)}
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
                    <td className={`py-2 px-2 font-medium sticky left-0 z-10 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
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
                              color: INK_SOFT
                            }}
                            title={`${year}: $${formatPrice(data.endPrice)} (${fmtDate(data.endDate)})`}
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
                      const cagrTooltip = `${priceRange.firstDate} ($${formatPrice(priceRange.firstPrice)}) → ${priceRange.lastDate} ($${formatPrice(priceRange.lastPrice)})`;

                      // Calculate volatility and max drawdown (same methodology as Backtest Statistics)
                      const stats = calculateAssetStats(asset.ticker, priceRange.firstDate, priceRange.lastDate);
                      const volatility = stats ? stats.volatility : null;
                      // A dash under a year, or when there was no volatility to divide by
                      const sharpeRatio = (volatility !== null && volatility > 0) ? sharpeFor(cagr, volatility, priceRange.months / 12) : null;
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
                        ? `At All-Time High: $${formatPrice(ddData.currentPrice)} (${formatDate(ddData.currentDate)})`
                        : `Current: $${formatPrice(ddData.currentPrice)} (${formatDate(ddData.currentDate)}) vs ATH: $${formatPrice(ddData.athPrice)} (${formatDate(ddData.athDate)}) = ${ddData.drawdown.toFixed(1)}%`;

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
                  <span className="inline-block w-3 h-3 border border-gray-200 mr-1" style={{ backgroundColor: heatColor(-1, 0.67) }}></span>
                  Lowest price
                  <span className="inline-block w-3 h-3 border border-gray-200 ml-3 mr-1" style={{ backgroundColor: heatColor(0) }}></span>
                  Mid
                  <span className="inline-block w-3 h-3 border border-gray-200 ml-3 mr-1" style={{ backgroundColor: heatColor(1, 0.67) }}></span>
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
  );
}
