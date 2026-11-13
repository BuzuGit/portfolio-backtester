/*
  THE GRAPHS TAB

  A grid of small price charts, one per asset passing the filters, each with its price, period
  return and current drawdown in the title, and an optional 10-month moving average.

  The chart data comes from the main screen's getMonthlyChartData (the Monthly tab draws from it
  too), and the filter bar and the tab's choices (period, end month, SMA on/off) live there as well,
  so they are passed in and survive switching tabs.
*/
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import type { AssetLookup } from '@/lib/fetchData';
import { isPhoneScreen } from '@/lib/savedSheet';
import { MONTH_ABBR } from '@/lib/dates';
import { PhoneChoice, periodOptions } from '@/components/PhoneSheet';
import {
  BLACK, FIELD, GAIN, LOSS, PHONE_SCROLL_ROW, PINNED_FILTERS, SEG, SMA_COLOR, ResponsiveContainer,
  formatPrice, segBtn, type MonthlyChartPeriod,
} from '@/components/ui';

/** What a mini chart needs from getMonthlyChartData (it returns more; only this is read here). */
type MiniChartData = {
  priceData: { date: string; price: number; sma10: number | null }[];
  totalReturn: number | null;
} | null;

/** The periods this tab offers: a subset of the Monthly tab's. */
export type GraphsPeriod = Extract<MonthlyChartPeriod, '1Y' | '2Y' | '3Y' | '4Y' | '5Y' | '10Y' | '15Y' | 'max'>;

export interface GraphsTabProps {
  filteredAssets: AssetLookup[];                    // the assets passing the filter bar, in order
  getMonthlyChartData: (ticker: string, period: MonthlyChartPeriod, cutoffDate?: string,
    targetCurrency?: string, allowNonPositive?: boolean) => MiniChartData;
  endMonthChoices: { value: string; label: string }[];
  graphsPeriod: GraphsPeriod;
  setGraphsPeriod: (p: GraphsPeriod) => void;
  graphsEndDate: string;
  setGraphsEndDate: (d: string) => void;
  graphsShowSMA: boolean;
  setGraphsShowSMA: (on: boolean) => void;
  renderFilters: (smaToggle: React.ReactNode) => React.ReactNode;
}

export default function GraphsTab({
  filteredAssets, getMonthlyChartData, endMonthChoices, graphsPeriod, setGraphsPeriod,
  graphsEndDate, setGraphsEndDate, graphsShowSMA, setGraphsShowSMA, renderFilters,
}: GraphsTabProps) {
  return (
    <div className="mt-2">
      {/* Controls row: filters + SMA toggle on left, period buttons on right (pinned while scrolling) */}
      {/* On a phone the filters and the period row stack instead of sitting side by side, and */}
      {/* the whole bar scrolls away with the page ("max-md:static"), as on Ranking: pinned, it */}
      {/* covered a quarter of the screen */}
      <div className={`${PINNED_FILTERS} flex justify-between items-start mb-4 max-md:static max-md:flex-col max-md:items-stretch max-md:gap-2`}>
        {renderFilters(
          /* SMA toggle — rendered inside the filter flex container for perfect alignment.
             (Phones: a box in the row below instead.)
             An on/off switch: a strip of one. The dot is the SMA line's colour. */
          <span className={`${SEG} max-md:hidden`}>
            <button
              onClick={() => setGraphsShowSMA(!graphsShowSMA)}
              className={segBtn(graphsShowSMA)}
            >
              <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle -mt-px" style={{ backgroundColor: SMA_COLOR }} />
              10m SMA
            </button>
          </span>
        )}
        <div className={`flex items-center gap-3 ${PHONE_SCROLL_ROW} max-md:w-full`}>
          {/* End Date selector — pick which month the charts end at (endMonthChoices) */}
          <select
            aria-label="End month"
            value={graphsEndDate}
            onChange={(e) => setGraphsEndDate(e.target.value)}
            className={`${FIELD} max-md:hidden`}
          >
            {endMonthChoices.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>

          {/* Phones: End month, Period and the 10m SMA line as three boxes on one row that
              open slide-up panels, like the other pages (the dropdown, the period buttons and
              the SMA button are desktop only) */}
          <div className="hidden max-md:flex w-full gap-2">
            <PhoneChoice
              label="End month"
              options={endMonthChoices}
              selected={graphsEndDate}
              onPick={setGraphsEndDate}
            />
            <PhoneChoice
              label="Period"
              options={periodOptions(['1Y', '2Y', '3Y', '4Y', '5Y', '10Y', '15Y', 'Max']).map(o => ({ ...o, value: o.value === 'Max' ? 'max' : o.value }))}
              selected={graphsPeriod}
              onPick={v => setGraphsPeriod(v as typeof graphsPeriod)}
            />
            <PhoneChoice
              label="10m SMA"
              options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On', hint: 'red line, 10-month average' }]}
              selected={graphsShowSMA ? 'on' : 'off'}
              onPick={v => setGraphsShowSMA(v === 'on')}
            />
          </div>
          <div className={`${SEG} max-md:hidden`}>
            {(['1Y', '2Y', '3Y', '4Y', '5Y', '10Y', '15Y', 'Max'] as const).map(p => {
              const value = p === 'Max' ? 'max' : p;
              return (
                <button
                  key={p}
                  onClick={() => setGraphsPeriod(value as typeof graphsPeriod)}
                  className={segBtn(graphsPeriod === value)}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Responsive grid of mini charts: 3 columns on desktop, 2 on tablet, 1 on mobile */}
      {(() => { const phoneGraphs = isPhoneScreen(); return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredAssets.map(asset => {
          // Reuse getMonthlyChartData — pass endDate so charts end at the selected month
          // Trailing `true`: plot macro series through zero and below, the same as the
          // Monthly tab. Without it this tab silently dropped every non-positive month,
          // so RATE_CH's line stopped dead in May 2025 — the month its rate reached zero —
          // and the same ticker told two different stories on two tabs.
          //
          // The return figure in the card heading is deliberately left alone: on a yield
          // series "−76.2%" is not a meaningful investment return, but it is the honest
          // arithmetic for the line being drawn, and it is how this tab has always
          // labelled every series.
          const chartData = getMonthlyChartData(asset.ticker, graphsPeriod, graphsEndDate || undefined, undefined, true);
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
          const formattedPrice = formatPrice(currentPrice);

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
                {/* Null-safe only for the type's sake: this tab never asks for
                    non-positive prices, so the return is always a number here. */}
                {totalReturn !== null && (
                  <span style={{ color: totalReturn >= 0 ? GAIN : LOSS }}>
                    ({totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(1)}%)
                  </span>
                )}
                {' / '}
                <span className="font-normal text-gray-500">
                  Curr DD: (<span style={{ color: currDD === 0 ? GAIN : currDD > -5 ? '#ca8a04' : currDD > -20 ? '#dc8a82' : LOSS }}>{currDD.toFixed(1)}%</span>)
                </span>
              </h3>

              {/* Small line chart — black price line, no legend, minimal chrome */}
              {/* Phones: no empty strip under the date labels (bottom margin 0 and a */}
              {/* 20px-high date axis instead of 15 + 30) */}
              <ResponsiveContainer width="100%" height={180} keepHeightSideways>
                <LineChart data={priceData} margin={{ top: 5, right: 5, left: -15, bottom: phoneGraphs ? 0 : 15 }}>
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
                    height={phoneGraphs ? 20 : 30}
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
                    stroke={BLACK}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                  />
                  {/* 10-month SMA red line — only shown when toggle is active */}
                  {graphsShowSMA && (
                    <Line
                      type="monotone"
                      dataKey="sma10"
                      stroke={SMA_COLOR}
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
      ); })()}
    </div>
  );
}
