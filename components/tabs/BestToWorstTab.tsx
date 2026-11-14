/*
  THE BEST TO WORST TAB

  Two layouts of the same question, "which assets did best?":
  - Ranking: the filtered assets sorted best to worst for one year (or the last 1–10 years),
    with the return in each asset's own currency and in PLN.
  - Return Map: every year a column, assets ranked top to bottom, in a chosen currency,
    coloured by asset, class or return, with assets you click to track across the years.

  Its helpers (getSortedAssetsByReturn, renderReturnMap, getSortedAssetsByPeriodReturn) moved here
  word for word: only this tab uses them. The filter bar, this tab's choices and the FX returns
  live in the main screen and are passed in, so they survive switching tabs.
*/
import React from 'react';
import type { AssetLookup } from '@/lib/fetchData';
import { FX_TICKER_MAP } from '@/lib/backtest';
import { getYearsWithData, type AssetsAnnualReturns } from '@/lib/assetStats';
import { PhoneChoice } from '@/components/PhoneSheet';
import {
  ASSET_CLASS_COLORS, METALS_CRYPTO_LABEL, PHONE_SCROLL_ROW, PINNED_FILTERS, RETURN_MAP_ASSET_COLORS, SEG,
  getPeriodReturnTooltip, getReturnTooltip, readableTextOn, returnHeatColor, segBtn,
} from '@/components/ui';

/** A ticker's return over the last N years (the main screen's getPeriodReturn). */
type PeriodReturn = { return: number; startDate: string; startPrice: number; endDate: string; endPrice: number } | null;
export type BestToWorstMode = 'year' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type ReturnMapCurrency = 'native' | 'PLN' | 'USD' | 'EUR' | 'CHF' | 'SGD';

export interface BestToWorstTabProps {
  assetLookup: AssetLookup[];
  filteredAssets: AssetLookup[];                     // the assets passing the filter bar, in order
  memoizedAnnualReturns: AssetsAnnualReturns;
  fxAnnualReturns: Record<string, Record<number, number>>;   // xxxPLN calendar-year returns, %
  getPeriodReturn: (ticker: string, years: number) => PeriodReturn;
  bestToWorstLayout: 'ranking' | 'map';
  bestToWorstMode: BestToWorstMode;
  setBestToWorstMode: (m: BestToWorstMode) => void;
  selectedRankingYear: number | null;
  setSelectedRankingYear: (y: number | null) => void;
  returnMapWindow: 5 | 10 | 'all';
  setReturnMapWindow: (w: 5 | 10 | 'all') => void;
  returnMapCurrency: ReturnMapCurrency;
  setReturnMapCurrency: (c: ReturnMapCurrency) => void;
  returnMapHighlight: 'asset' | 'class' | 'return';
  setReturnMapHighlight: (h: 'asset' | 'class' | 'return') => void;
  returnMapTracked: string[];
  setReturnMapTracked: React.Dispatch<React.SetStateAction<string[]>>;
  renderFilters: (extraControls: React.ReactNode) => React.ReactNode;
}

export default function BestToWorstTab({
  assetLookup, filteredAssets, memoizedAnnualReturns, fxAnnualReturns, getPeriodReturn,
  bestToWorstLayout, bestToWorstMode, setBestToWorstMode, selectedRankingYear, setSelectedRankingYear,
  returnMapWindow, setReturnMapWindow, returnMapCurrency, setReturnMapCurrency,
  returnMapHighlight, setReturnMapHighlight, returnMapTracked, setReturnMapTracked, renderFilters,
}: BestToWorstTabProps) {
  // The moved helpers below ask for the filtered assets by this name, as they did in the main screen
  const getFilteredAssetLookup = () => filteredAssets;

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
   * Best To Worst → "Return Map": each year is a column with assets ranked best (top) to worst
   * (bottom), like BlackRock's asset-class return map. It answers questions such as "did last
   * year's winner stay on top, or fall to the bottom?". Returns are converted into the selected
   * currency BEFORE ranking, so switching currency can reorder a column.
   */
  const renderReturnMap = (annualReturns: AssetsAnnualReturns, allYears: number[]) => {
    const shownYears = returnMapWindow === 'all' ? allYears : allYears.slice(-returnMapWindow);
    const assets = getFilteredAssetLookup();
    const ccyLabel = returnMapCurrency === 'native' ? 'native currency' : returnMapCurrency;

    // One asset's return for one year in the selected currency (percent), or null when there is no
    // price or no FX data for that year. Every conversion goes through PLN, because all FX pairs are
    // quoted against PLN: (1 + native) × (1 + xxxPLN) is the PLN growth, and dividing that by
    // (1 + yyyPLN) turns it into growth measured in yyy.
    const returnIn = (asset: AssetLookup, year: number): number | null => {
      const native = annualReturns[asset.ticker]?.[year]?.return;
      if (native === undefined) return null;
      if (returnMapCurrency === 'native' || returnMapCurrency === asset.currency) return native;
      const toPlnFx = asset.currency === 'PLN' ? 0 : fxAnnualReturns[asset.fx || FX_TICKER_MAP[asset.currency]]?.[year];
      if (toPlnFx === undefined) return null;
      const plnGrowth = (1 + native / 100) * (1 + toPlnFx / 100);
      if (returnMapCurrency === 'PLN') return (plnGrowth - 1) * 100;
      const targetFx = fxAnnualReturns[FX_TICKER_MAP[returnMapCurrency]]?.[year];
      if (targetFx === undefined) return null;
      return (plnGrowth / (1 + targetFx / 100) - 1) * 100;
    };

    // Cell colour for the selected "Colour" mode. (colourIndex, used for "Asset" mode, is built further
    // down once we know which assets made it onto the map.)
    const classColor = (cls: string) =>
      ASSET_CLASS_COLORS[cls === 'Other' ? METALS_CRYPTO_LABEL : cls] ?? '#94a3b8';
    const cellColor = (asset: AssetLookup, ret: number): string => {
      if (returnMapHighlight === 'return') return returnHeatColor(ret);
      if (returnMapHighlight === 'class') return classColor(asset.assetClass || 'Other');
      return RETURN_MAP_ASSET_COLORS[(colourIndex.get(asset.ticker) ?? 0) % RETURN_MAP_ASSET_COLORS.length];
    };

    type MapCell = { asset: AssetLookup; ret: number; tooltip: string; shortHistory?: boolean };
    const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

    // One ranked column per year
    const columns = shownYears.map(year => {
      const ranked = assets
        .map(asset => ({ asset, ret: returnIn(asset, year) }))
        .filter((c): c is { asset: AssetLookup; ret: number } => c.ret !== null)
        .sort((a, b) => b.ret - a.ret);
      // A year whose latest price isn't from December is still in progress → label it "YTD"
      const latestEnd = ranked.reduce((max, c) => Math.max(max, new Date(annualReturns[c.asset.ticker][year].endDate).getTime()), 0);
      const isYtd = ranked.length > 0 && new Date(latestEnd).getMonth() < 11;
      const cells: MapCell[] = ranked.map((c, i) => ({
        ...c,
        tooltip: [
          `${c.asset.name} (${c.asset.ticker})`,
          `Rank ${i + 1} of ${ranked.length} in ${year}${isYtd ? ' (year to date)' : ''}`,
          `Return in ${ccyLabel}: ${signed(c.ret)}`,
          `Prices: ${getReturnTooltip(c.asset.ticker, year, annualReturns)}`,
        ].join('\n'),
      }));
      return { key: String(year), label: isYtd ? `${year} YTD` : String(year), cells };
    });

    // Annualised column: compound each asset's yearly returns over the years shown, then spread the
    // total over the ACTUAL time covered (from each year's start and end price dates), so a partial
    // current year counts as the fraction of a year it really is.
    const annualised: MapCell[] = assets
      .map(asset => {
        let growth = 1, days = 0;
        const covered: number[] = [];
        shownYears.forEach(year => {
          const ret = returnIn(asset, year);
          const data = annualReturns[asset.ticker]?.[year];
          if (ret === null || !data) return;
          growth *= 1 + ret / 100;
          days += (new Date(data.endDate).getTime() - new Date(data.startDate).getTime()) / 86400000;
          covered.push(year);
        });
        const span = days / 365.25;
        if (span < 1) return null;  // under a year of history: annualising would exaggerate it
        return { asset, ret: (Math.pow(growth, 1 / span) - 1) * 100, span, covered, growth };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .sort((a, b) => b.ret - a.ret)
      .map((a, i, all) => {
        const shortHistory = a.covered.length < shownYears.length;
        return {
          asset: a.asset,
          ret: a.ret,
          shortHistory,
          tooltip: [
            `${a.asset.name} (${a.asset.ticker})`,
            `Rank ${i + 1} of ${all.length} by annualised return`,
            `Annualised in ${ccyLabel}: ${signed(a.ret)} a year`,
            `Over ${a.span.toFixed(1)} years (${a.covered[0]}–${a.covered[a.covered.length - 1]}), total ${signed((a.growth - 1) * 100)}`,
            ...(shortHistory ? ['Shorter history than the years shown'] : []),
          ].join('\n'),
        };
      });

    const maxRows = Math.max(annualised.length, ...columns.map(c => c.cells.length), 0);
    const toggleTracked = (ticker: string) =>
      setReturnMapTracked(prev => prev.includes(ticker) ? prev.filter(t => t !== ticker) : [...prev, ticker]);
    // Only followed assets that are actually on the map right now count. Otherwise following an
    // asset and then filtering it out (or picking 5Y when it has no recent data) would fade EVERY cell.
    // The hidden ones stay remembered and light up again when they come back into view.
    const onMap = new Set([...columns.flatMap(c => c.cells), ...annualised].map(c => c.asset.ticker));
    const activeTracked = returnMapTracked.filter(t => onMap.has(t));
    // "Asset" colours are numbered over the assets on the map right now (in lookup-table order), so
    // up to 32 assets on screen never share a colour. Numbering over the whole lookup table would
    // keep colours fixed when filters change, but the sheet holds far more than 32 assets with data,
    // so assets side by side on the map would clash — which defeats the point of colouring by asset.
    const colourIndex = new Map(assets.filter(a => onMap.has(a.ticker)).map((a, i) => [a.ticker, i]));

    // A single coloured cell: ticker on top, return below. Clicking it follows that asset in every column.
    const renderCell = (cell: MapCell, key: string) => {
      const bg = cellColor(cell.asset, cell.ret);
      const tracked = activeTracked.includes(cell.asset.ticker);
      const faded = activeTracked.length > 0 && !tracked;
      return (
        <td key={key} className="p-0.5">
          <button
            type="button"
            onClick={() => toggleTracked(cell.asset.ticker)}
            aria-pressed={tracked}
            title={cell.tooltip}
            className={`w-full rounded px-1 py-1 text-center leading-tight transition-opacity ${tracked ? 'ring-2 ring-offset-1 ring-slate-900' : ''}`}
            style={{ backgroundColor: bg, color: readableTextOn(bg), opacity: faded ? 0.2 : 1 }}
          >
            <div className="font-semibold truncate">{cell.asset.ticker}</div>
            <div>{cell.ret.toFixed(1)}%{cell.shortHistory ? '*' : ''}</div>
          </button>
        </td>
      );
    };

    if (maxRows === 0) {
      return (
        <div className="bg-white p-4 rounded-lg shadow text-center text-gray-500">
          No assets match the current filters. Try adjusting your selection.
        </div>
      );
    }

    // Asset classes on screen, for the colour key in "Asset class" mode
    const classesShown = Array.from(new Set(assets.map(a => a.assetClass || 'Other'))).sort();

    return (
      <div className="bg-white p-4 rounded-lg shadow">
        {/* Wide map scrolls sideways inside its own box instead of stretching the page */}
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr>
                <th className="py-1 px-1 text-gray-400 font-normal">#</th>
                {columns.map(c => (
                  <th key={c.key} className="py-1 px-1 text-sm font-semibold text-gray-800 min-w-[84px]">{c.label}</th>
                ))}
                <th className="w-3"></th>
                <th className="py-1 px-1 text-sm font-semibold text-gray-800 min-w-[84px]">Annualised</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: maxRows }, (_, row) => (
                <tr key={row}>
                  <td className="text-right pr-1 text-gray-400">{row + 1}</td>
                  {columns.map(c => c.cells[row] ? renderCell(c.cells[row], c.key) : <td key={c.key} />)}
                  <td />
                  {annualised[row] ? renderCell(annualised[row], 'annualised') : <td />}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Key and hints under the map */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
          {activeTracked.length > 0 ? (
            <span className="flex items-center gap-2">
              Following: <span className="font-medium text-gray-700">{activeTracked.join(', ')}</span>
              <button onClick={() => setReturnMapTracked([])} className="text-blue-600 hover:underline">Clear</button>
            </span>
          ) : (
            <span>Click a cell to follow that asset through the years.</span>
          )}
          {returnMapHighlight === 'class' && (
            <span className="flex flex-wrap items-center gap-2">
              {classesShown.map(cls => (
                <span key={cls} className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: classColor(cls) }}></span>
                  {cls}
                </span>
              ))}
            </span>
          )}
          {returnMapHighlight === 'return' && (
            <span className="flex items-center gap-1">
              ≤ −40%
              <span
                className="inline-block w-32 h-3 rounded-sm"
                style={{ background: `linear-gradient(to right, ${returnHeatColor(-40)}, ${returnHeatColor(0)}, ${returnHeatColor(40)})` }}
              ></span>
              ≥ +40%
            </span>
          )}
          {annualised.some(a => a.shortHistory) && <span>* annualised over a shorter history than the years shown</span>}
          {returnMapCurrency !== 'native' && <span>Assets without FX data for a year are left out of that year.</span>}
        </div>
      </div>
    );
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

  return (
    <div className="mt-2">

      {(() => {
        // Use memoized annual returns
        const annualReturns = memoizedAnnualReturns;
        const years = getYearsWithData(annualReturns);

        // If no lookup table or no data, show a message
        if (assetLookup.length === 0 || years.length === 0) {
          return (
            <>
              {renderFilters(undefined)}
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
          {/* Filter controls + Year/Period selectors on one line (pinned while scrolling; */}
          {/* in the Return Map this includes its Years / Currency / Colour options). */}
          {/* Phones: not pinned ("max-md:static"), the filters scroll away with the page. */}
          <div className={`${PINNED_FILTERS} max-md:static`}>
          {renderFilters(<>
            {/* (Ranking vs Return Map is chosen in the left panel, under "Best To Worst".) */}
            {bestToWorstLayout === 'map' && (
              <>
                {/* Return Map: how many recent years to show */}
                <div className={SEG}>
                  {([5, 10, 'all'] as const).map(w => (
                    <button
                      key={w}
                      onClick={() => setReturnMapWindow(w)}
                      className={segBtn(returnMapWindow === w)}
                    >
                      {w === 'all' ? 'All' : `${w}Y`}
                    </button>
                  ))}
                </div>
                {/* Return Map: currency the returns are measured (and ranked) in */}
                <div className="hidden max-md:flex w-full">
                  <PhoneChoice
                    label="Currency"
                    options={(['native', 'PLN', 'USD', 'EUR', 'CHF', 'SGD'] as const).map(c => ({ value: c, label: c === 'native' ? 'Native' : c }))}
                    selected={returnMapCurrency}
                    onPick={c => setReturnMapCurrency(c as typeof returnMapCurrency)}
                  />
                </div>
                <div className="flex items-center gap-1 max-md:hidden">
                  <span className="text-xs text-gray-500 mr-1">Currency:</span>
                  <span className={SEG}>
                  {(['native', 'PLN', 'USD', 'EUR', 'CHF', 'SGD'] as const).map(c => (
                    <button
                      key={c}
                      onClick={() => setReturnMapCurrency(c)}
                      className={segBtn(returnMapCurrency === c)}
                    >{c === 'native' ? 'Native' : c}</button>
                  ))}
                  </span>
                </div>
                {/* Return Map: what the cell colour means */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500 mr-1">Colour:</span>
                  <span className={SEG}>
                  {([['asset', 'Asset'], ['class', 'Asset class'], ['return', 'Return']] as const).map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setReturnMapHighlight(value)}
                      className={segBtn(returnMapHighlight === value)}
                    >{label}</button>
                  ))}
                  </span>
                </div>
              </>
            )}
            {bestToWorstLayout === 'ranking' && (<>
            {/* Phones: the year dropdown and the period buttons below as one box, since
                both choose what the ranking covers (one calendar year, or the last N years) */}
            <div className="hidden max-md:flex w-full">
              <PhoneChoice
                label="Ranking period"
                options={[
                  ...years.slice().reverse().map(y => ({ value: `y${y}`, label: String(y), group: 'Calendar year' })),
                  ...([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const).map(p => ({ value: `p${p}`, label: `${p}Y`, hint: `last ${p} year${p === 1 ? '' : 's'}`, group: 'Last years' })),
                ]}
                selected={isYearMode ? `y${currentYear}` : `p${bestToWorstMode}`}
                onPick={v => {
                  const n = parseInt(v.slice(1), 10);
                  if (v[0] === 'y') { setSelectedRankingYear(n); setBestToWorstMode('year'); }
                  else setBestToWorstMode(n as Exclude<typeof bestToWorstMode, 'year'>);
                }}
              />
            </div>
            {/* Year Dropdown */}
            <div className="relative max-md:hidden">
              <select
                value={currentYear}
                onChange={(e) => {
                  setSelectedRankingYear(parseInt(e.target.value));
                  setBestToWorstMode('year');
                }}
                className={`h-8 px-2.5 text-xs border rounded-lg ${isYearMode ? 'border-slate-400 bg-gray-100' : 'border-gray-300 bg-white hover:bg-gray-50'}`}
              >
                {years.slice().reverse().map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
            {/* Period Buttons */}
            <div className={`flex gap-1 ${PHONE_SCROLL_ROW} max-md:hidden`}>
              <span className={SEG}>
              {([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const).map(period => (
                <button
                  key={period}
                  onClick={() => setBestToWorstMode(period)}
                  className={segBtn(bestToWorstMode === period)}
                >
                  {period}Y
                </button>
              ))}
              </span>
            </div>
            </>)}
          </>)}
          </div>

          {bestToWorstLayout === 'map' && renderReturnMap(annualReturns, years)}

          {bestToWorstLayout === 'ranking' && (
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

              // Past-years tiles (desktop only): the 5 calendar years BEFORE what is being ranked,
              // so you can see whether this year's winner or loser had years like it before.
              // - A calendar year picked (e.g. 2026): 2021 … 2025.
              // - A 1Y–10Y period: the 5 full years before the period starts. The period runs back N
              //   years from the latest data, so 3Y in 2026 starts in 2023 and shows 2018 … 2022.
              // Years with no data at all are left out, so an early year can show fewer than 5.
              const historyBefore = isYearMode ? currentYear : years[years.length - 1] - (bestToWorstMode as number);
              const historyYears = [5, 4, 3, 2, 1].map(k => historyBefore - k).filter(y => years.includes(y));
              // Shade: one fixed scale for every year (±40% = deepest, the app's rule for calendar-year
              // tiles), so +30% looks the same in any year and one outlier can't pale the rest.

              return (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200">
                      {/* Past-years tile headers (desktop only) */}
                      {historyYears.map(y => (
                        <th key={y} className="text-center py-1 px-px bg-gray-100 w-14 max-md:hidden">{y}</th>
                      ))}
                      <th className="py-1 px-1 bg-gray-100 w-24"></th>
                      <th className="text-right py-1 px-2 bg-gray-100 w-16">{returnColumnHeader}</th>
                      <th className="text-left py-1 px-2 bg-gray-100">Asset</th>
                      <th className="text-left py-1 px-2 bg-gray-100 w-16">Ticker</th>
                      <th className="text-center py-1 px-2 bg-gray-100 w-12">Ccy</th>
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
                          {/* Past-years tiles (desktop only): that year's return in the asset's own
                              currency, heat-coloured like Markets › Assets; a dash when it has no data */}
                          {historyYears.map(y => {
                            const past = annualReturns[asset.ticker]?.[y];
                            if (!past) return <td key={y} className="px-px py-0.5 text-center text-gray-300 max-md:hidden">–</td>;
                            const bg = returnHeatColor(past.return);
                            return (
                              <td key={y} className="px-px py-0.5 max-md:hidden" title={`${y}: ${getReturnTooltip(asset.ticker, y, annualReturns)}`}>
                                <div className="rounded px-1 h-5 leading-5 cursor-help text-center tabular-nums" style={{ background: bg, color: readableTextOn(bg) }}>
                                  {past.return.toFixed(1)}%
                                </div>
                              </td>
                            );
                          })}
                          {/* Bar Chart Column */}
                          <td className="py-1 px-1">
                            <div className="relative h-4 w-full rounded overflow-hidden">
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
          )}
          </>
        );
      })()}
    </div>
  );
}
