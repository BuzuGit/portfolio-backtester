/*
  THE CORRELATIONS TAB

  How the filtered assets move together (the correlation matrix) and how each was paid for its risk
  (the Risk / Return scatter of annualised return against volatility), over the last N years.
  The matrix maths is in lib/correlation.ts; this file draws it.

  The filter bar (Assets / Class / Currency / Subcategory) is shared with other tabs and its state
  lives in the main screen, so the main screen draws it: renderFilters puts it around this tab's
  own Period dropdown. The chosen period also lives there, so it survives switching tabs.
*/
import React, { useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import type { AssetRow, AssetLookup } from '@/lib/fetchData';
import { correlationMatrix } from '@/lib/correlation';
import {
  CARD, CELL_TEXT, INK, INK_SOFT, LINE, LINE_FAINT, LOSS, MUTED, PINNED_FILTERS, RETURN_MAP_ASSET_COLORS,
  ResponsiveContainer, getCorrelationColor, themedCell,
} from '@/components/ui';

export interface CorrelationsTabProps {
  assetData: AssetRow[];
  assetLookup: AssetLookup[];
  filteredAssets: AssetLookup[];                     // the assets passing the filter bar, in order
  correlationPeriod: number;                         // years
  setCorrelationPeriod: (years: number) => void;
  renderFilters: (periodControl: React.ReactNode) => React.ReactNode;
}

export default function CorrelationsTab({
  assetData, assetLookup, filteredAssets, correlationPeriod, setCorrelationPeriod, renderFilters,
}: CorrelationsTabProps) {
  // The matrix, worked out again only when the data, the filtered assets or the period change.
  // (filteredAssets keeps the same identity until a filter changes: the main screen remembers it.)
  const { tickers, matrix } = useMemo(
    () => correlationMatrix(assetData, filteredAssets.map(a => a.ticker), correlationPeriod),
    [assetData, filteredAssets, correlationPeriod],
  );

  // The Risk / Return scatter's points: each filtered asset's CAGR and volatility over the period.
  // Remembered like the matrix, so clicks elsewhere don't re-walk the price table for every asset.
  const scatterData = useMemo(() => {
    const monthsNeeded = correlationPeriod * 12;
    // Slice the last N years of data (+1 row so we can compute the first monthly return)
    const slicedData = assetData.slice(-(monthsNeeded + 1));

    // Color palette for the dots — cycles if there are more than 20 assets
    const DOT_COLORS = RETURN_MAP_ASSET_COLORS;

    const points: { ticker: string; name: string; x: number; y: number; color: string }[] = [];
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

      points.push({
        ticker,
        name: asset.name,
        x: parseFloat(volatility.toFixed(2)),
        y: parseFloat(cagr.toFixed(2)),
        color: DOT_COLORS[colorIdx % DOT_COLORS.length],
      });
      colorIdx++;
    }
    return points;
  }, [assetData, filteredAssets, correlationPeriod]);

  return (
    <div className="mt-2">

      {/* Reuse the same asset/class/currency filter controls as other tabs, with Correlation Period added inline */}
      {/* (wrapped so it stays pinned while scrolling) */}
      <div className={PINNED_FILTERS}>
      {renderFilters(
        /* Correlation Period dropdown — styled to match the other filter buttons */
        <div className="relative">
          <div className="h-8 px-3 text-xs border border-gray-300 bg-white rounded-lg flex items-center gap-2 max-md:h-10 max-md:text-sm">
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
      )}
      </div>

      {/* Render the correlation matrix table (worked out above) */}
      {(() => {
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
                  <th className="py-1 px-2 sticky top-0 left-0 z-30 border border-gray-200 min-w-[60px] bg-gray-100"></th>
                  {/* Column headers — one per ticker, each sticky top */}
                  {tickers.map(ticker => (
                    <th
                      key={ticker}
                      className="py-1 px-2 sticky top-0 z-20 border border-gray-200 text-center font-semibold min-w-[55px] bg-gray-100"
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
                      className="py-1 px-2 sticky left-0 z-10 border border-gray-200 font-semibold bg-gray-100"
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
                            backgroundColor: isValid ? getCorrelationColor(value) : themedCell('#f3f4f6'),
                            // Make text darker for better readability on colored backgrounds
                            color: isValid ? CELL_TEXT : '#9ca3af',
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
        // (scatterData is worked out once per data / filter / period change, above)
        if (scatterData.length === 0) return null;

        // Compute axis domains with padding so dots and labels have room
        const xs = scatterData.map(d => d.x);
        const ys = scatterData.map(d => d.y);
        const xPad = Math.max(3, (Math.max(...xs) - Math.min(...xs)) * 0.15);
        const yPad = Math.max(3, (Math.max(...ys) - Math.min(...ys)) * 0.15);
        const xMin = Math.max(0, parseFloat((Math.min(...xs) - xPad).toFixed(1)));
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
                <CartesianGrid strokeDasharray="3 3" stroke={LINE_FAINT} />
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
                    style: { fontSize: 10, fill: MUTED, letterSpacing: '0.05em' },
                  }}
                  tick={{ fontSize: 11, fill: MUTED }}
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
                    style: { fontSize: 10, fill: MUTED, letterSpacing: '0.05em' },
                  }}
                  tick={{ fontSize: 11, fill: MUTED }}
                />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={(props: any) => {
                    if (!props.active || !props.payload?.length) return null;
                    const d = props.payload[0].payload;
                    return (
                      <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 6, padding: '8px 12px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', maxWidth: 240 }}>
                        <div style={{ fontWeight: 700, marginBottom: 4, color: d.color }}>{d.ticker}</div>
                        <div style={{ color: INK_SOFT, marginBottom: 2 }}>{d.name}</div>
                        <div style={{ color: MUTED }}>
                          <span>Return ({correlationPeriod}Y CAGR): </span>
                          <strong style={{ color: INK }}>{d.y.toFixed(2)}%</strong>
                        </div>
                        <div style={{ color: MUTED }}>
                          <span>Volatility ({correlationPeriod}Y): </span>
                          <strong style={{ color: INK }}>{d.x.toFixed(2)}%</strong>
                        </div>
                      </div>
                    );
                  }}
                />
                {/* Dashed red zero line — only shown when at least one asset has negative return */}
                {scatterData.some(d => d.y < 0) && (
                  <ReferenceLine y={0} stroke={LOSS} strokeDasharray="6 3" strokeWidth={1.5} />
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
                          fill={INK_SOFT}
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
  );
}
