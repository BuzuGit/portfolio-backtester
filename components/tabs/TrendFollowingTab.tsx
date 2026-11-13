/*
  THE TREND FOLLOWING TAB

  Buy & Hold against the 10-month moving-average rule for one asset: the controls, the Growth of $1
  and Drawdown charts, the statistics table, annual and monthly returns, and the rules in words.
  The calculations are in lib/trend.ts; this file only draws them.

  Its choices (asset, dates, cash rate, commission) are kept by the main screen and passed in, so
  they are still there when you come back from another tab.
*/
import React, { useEffect, useMemo } from 'react';
import { ComposedChart, BarChart, Bar, LabelList, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceDot } from 'recharts';
import type { AssetRow, AssetLookup } from '@/lib/fetchData';
import type { DateRange } from '@/lib/backtest';
import { trendFollowingAnalysis, calculateTrendMonthlyReturns, getTrendAnnualReturnsChartData } from '@/lib/trend';
import {
  CHART_PALETTE, GAIN, LOSS, LOSS_AREA, MUTED_LABEL, SMA_COLOR, TREND_COLOR, FIELD, PINNED_FILTERS,
  SHARPE_HINT_RF, lossBarLabel, lossLabelRoom, ResponsiveContainer,
} from '@/components/ui';

// Risk-free rate options (0% to 5%, 0.5% steps): the cash the strategy earns while out of the
// market, and the rate its Sharpe ratio subtracts
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

// Commission options (0% to 0.5%, 0.05% steps), charged on each signal change (buy or sell)
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

export interface TrendFollowingTabProps {
  assetData: AssetRow[];
  assetLookup: AssetLookup[];
  selectedDateRange: DateRange;
  setSelectedStartDate: (date: string) => void;
  setSelectedEndDate: (date: string) => void;
  selectedTrendAsset: string;
  setSelectedTrendAsset: (ticker: string) => void;
  trendRiskFreeRate: number;
  setTrendRiskFreeRate: (rate: number) => void;
  trendCommission: number;
  setTrendCommission: (rate: number) => void;
}

export default function TrendFollowingTab({
  assetData, assetLookup, selectedDateRange, setSelectedStartDate, setSelectedEndDate,
  selectedTrendAsset, setSelectedTrendAsset, trendRiskFreeRate, setTrendRiskFreeRate,
  trendCommission, setTrendCommission,
}: TrendFollowingTabProps) {
  // No asset chosen yet: pick the first one in the lookup table
  useEffect(() => {
    if (!selectedTrendAsset && assetLookup.length > 0) setSelectedTrendAsset(assetLookup[0].ticker);
  }, [selectedTrendAsset, assetLookup, setSelectedTrendAsset]);

  // The analysis, worked out again only when one of its inputs changes (not on every click elsewhere)
  const analysis = useMemo(
    () => (selectedTrendAsset
      ? trendFollowingAnalysis(assetData, selectedTrendAsset, selectedDateRange.start, selectedDateRange.end, trendRiskFreeRate, trendCommission)
      : null),
    [assetData, selectedTrendAsset, selectedDateRange.start, selectedDateRange.end, trendRiskFreeRate, trendCommission],
  );

  return (
    <div className="mt-2">
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Trend Following</h2>

      {(() => {
        // No asset chosen yet: the effect above is picking the first one, so draw nothing this time
        if (!selectedTrendAsset && assetLookup.length > 0) return null;

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
            {/* Controls Row (pinned while scrolling — this white box holds the whole tab) */}
            <div className={`${PINNED_FILTERS} grid grid-cols-2 md:grid-cols-5 gap-4 mb-4`}>
              {/* Asset Selector */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Asset</label>
                <select
                  value={selectedTrendAsset}
                  onChange={(e) => setSelectedTrendAsset(e.target.value)}
                  className={`w-full ${FIELD}`}
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
                <label className="block text-xs font-medium text-gray-700 mb-1">Start Date</label>
                <select
                  value={selectedDateRange.start}
                  onChange={(e) => setSelectedStartDate(e.target.value)}
                  className={`w-full ${FIELD}`}
                >
                  {assetData.map(row => (
                    <option key={row.date} value={row.date}>{row.date}</option>
                  ))}
                </select>
              </div>

              {/* End Date Selector */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">End Date</label>
                <select
                  value={selectedDateRange.end}
                  onChange={(e) => setSelectedEndDate(e.target.value)}
                  className={`w-full ${FIELD}`}
                >
                  {assetData.slice().reverse().filter(row => row.date >= selectedDateRange.start).map(row => (
                    <option key={row.date} value={row.date}>{row.date}</option>
                  ))}
                </select>
              </div>

              {/* Risk-Free Rate Selector */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Risk-Free Rate</label>
                <select
                  value={trendRiskFreeRate}
                  onChange={(e) => setTrendRiskFreeRate(parseFloat(e.target.value))}
                  className={`w-full ${FIELD}`}
                >
                  {RISK_FREE_RATE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Commission Selector */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Commission</label>
                <select
                  value={trendCommission}
                  onChange={(e) => setTrendCommission(parseFloat(e.target.value))}
                  className={`w-full ${FIELD}`}
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
                  {/* Swatches in the lines' own colours (Buy & Hold area, TREND_COLOR, red SMA) */}
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border rounded" style={{ backgroundColor: '#d5e2f0', borderColor: CHART_PALETTE.blue }}></div>
                    <span>Buy & Hold</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-1 rounded" style={{ backgroundColor: TREND_COLOR }}></div>
                    <span>Trend Following</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-0.5" style={{ borderTop: `2px dashed ${SMA_COLOR}` }}></div>
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
                        fill="#d5e2f0"
                        stroke={CHART_PALETTE.blue}
                        strokeWidth={1}
                        fillOpacity={0.6}
                        name="buyHoldValue"
                      />
                      {/* Trend Following Line */}
                      <Line
                        type="monotone"
                        dataKey="trendFollowingValue"
                        stroke={TREND_COLOR}
                        strokeWidth={2}
                        dot={false}
                        name="trendFollowingValue"
                      />
                      {/* 10-month SMA Line (normalized to Growth of $1 scale) */}
                      <Line
                        type="monotone"
                        dataKey="sma10"
                        stroke={SMA_COLOR}
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
                          fill={signal.newSignal === 'BUY' ? GAIN : LOSS}
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
                        fill={LOSS_AREA}
                        stroke={LOSS}
                        strokeWidth={1}
                        fillOpacity={0.4}
                        name="buyHoldDrawdown"
                      />
                      {/* Trend Following Drawdown */}
                      <Line
                        type="monotone"
                        dataKey="trendFollowingDrawdown"
                        stroke={TREND_COLOR}
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
                      {/* Sharpe Ratio (higher is better). A dash under a year, where there
                          is no annual return to divide; then neither side is highlighted. */}
                      {(() => {
                        const bh = analysis.buyHoldStats.sharpeRatio;
                        const tf = analysis.trendFollowingStats.sharpeRatio;
                        return (
                          <tr className="border-b border-gray-100">
                            <td className="py-2 px-3 font-medium text-gray-700" title={SHARPE_HINT_RF}>Sharpe Ratio</td>
                            <td className={`text-right py-2 px-3 ${
                              bh !== null && tf !== null && bh >= tf ? 'font-semibold text-blue-700' : 'text-gray-600'
                            }`}>
                              {bh === null ? '—' : bh.toFixed(2)}
                            </td>
                            <td className={`text-right py-2 px-3 ${
                              bh !== null && tf !== null && tf >= bh ? 'font-semibold text-green-700' : 'text-gray-600'
                            }`}>
                              {tf === null ? '—' : tf.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })()}
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
                            <YAxis hide domain={['auto', 'auto']}
                              padding={{ bottom: lossLabelRoom(chartData.some(d => Number(d['Buy & Hold']) < 0 || Number(d['Trend Following']) < 0), 10) }} />
                            <Tooltip
                              formatter={(value: number) => [`${value.toFixed(1)}%`, '']}
                              labelFormatter={(label) => `Year: ${label}`}
                            />
                            <Legend />
                            {/* Buy & Hold bars - Blue */}
                            <Bar dataKey="Buy & Hold" fill={CHART_PALETTE.blue}>
                              <LabelList
                                dataKey="Buy & Hold"
                                position="top"
                                formatter={(value: number) => value >= 0 ? `${value.toFixed(1)}%` : ''}
                                style={{ fontSize: '10px', fill: MUTED_LABEL }}
                              />
                              <LabelList
                                dataKey="Buy & Hold"
                                content={lossBarLabel((value: number) => `${value.toFixed(1)}%`, { fontSize: '10px', fill: LOSS })}
                              />
                            </Bar>
                            {/* Trend Following bars - teal (TREND_COLOR) */}
                            <Bar dataKey="Trend Following" fill={TREND_COLOR}>
                              <LabelList
                                dataKey="Trend Following"
                                position="top"
                                formatter={(value: number) => value >= 0 ? `${value.toFixed(1)}%` : ''}
                                style={{ fontSize: '10px', fill: MUTED_LABEL }}
                              />
                              <LabelList
                                dataKey="Trend Following"
                                content={lossBarLabel((value: number) => `${value.toFixed(1)}%`, { fontSize: '10px', fill: LOSS })}
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
  );
}
