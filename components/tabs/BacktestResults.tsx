/*
  THE BACKTEST TAB: RESULTS

  Everything under the Run Backtest button once it has run: the statistics table, value and
  drawdown charts, the value after withdrawals, annual / periodic / rolling returns, the
  head-to-head gap and rolling correlation of two portfolios, and the withdrawal and rebalancing
  detail tables. The calculations are in lib/backtest.ts and lib/correlation.ts; the chart-shaping
  helpers and every choice here live in the main screen and are passed in.
*/
import React from 'react';
import {
  LineChart, Line, BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine,
} from 'recharts';
import type { BacktestResult, DateRange, Portfolio, RebalancingRow } from '@/lib/backtest';
import { calculateMonthlyReturns, calculateWithdrawalReturns, formatPeriod, getWithdrawalDetails } from '@/lib/backtest';
import { getPairedMonthlyReturns, getRollingCorrelationData, pearsonCorrelation } from '@/lib/correlation';
import { PhoneChoice } from '@/components/PhoneSheet';
import {
  BLACK, CAGR_HINT, FIELD, GAIN, LOSS, MUTED, MUTED_LABEL, ResponsiveContainer, SEG, SHARPE_HINT, SLATE,
  formatPrice, lossBarLabel, lossLabelRoom, segBtn,
} from '@/components/ui';
import {
  CORRELATION_WINDOWS, RETURNS_PERIOD_CHOICES, ROLLING_RETURN_YEARS, STREAK_VIEWS, UpMonthsSummary, phoneAxisMoney,
  type PeriodicReturnsRow, type ReturnsChartPeriod,
} from '@/components/charts';
import { CURRENCY_SYMBOLS } from '@/components/options';

export interface BacktestResultsProps {
  backtestResults: BacktestResult[];
  portfolios: Portfolio[];
  selectedDateRange: DateRange;
  withdrawalRate: string;
  inflationRate: string;
  backtestXAxisConfig: { ticks: string[] | undefined; periodYears: number };
  BacktestDateTick: (props: { x: number; y: number; payload: { value: string } }) => React.ReactElement;
  getAnnualReturnsChartData: (results: BacktestResult[], startDate: string) => Array<{ year: string; [portfolioName: string]: string | number }>;
  getBestWorstYears: (results: BacktestResult[], startDate: string) => Record<string, { best: number; bestYear: string; worst: number; worstYear: string }>;
  getPeriodicReturnsChartData: (results: BacktestResult[], startDate: string, period: ReturnsChartPeriod) => PeriodicReturnsRow[];
  getRebalancingDetails: (result: BacktestResult) => RebalancingRow[];
  hasCostLeg: (portfolio: Portfolio) => boolean;
  backtestReturnsPeriod: ReturnsChartPeriod; setBacktestReturnsPeriod: (p: ReturnsChartPeriod) => void;
  correlationWindow: number; setCorrelationWindow: (n: number) => void;
  deltaChartView: 'gap' | 'correlation'; setDeltaChartView: (v: 'gap' | 'correlation') => void;
  deltaPortfolioA: number; setDeltaPortfolioA: (i: number) => void;
  deltaPortfolioB: number; setDeltaPortfolioB: (i: number) => void;
  selectedDetailPortfolio: number; setSelectedDetailPortfolio: (i: number) => void;
  selectedRebalancingPortfolio: number; setSelectedRebalancingPortfolio: (i: number) => void;
}

export default function BacktestResults({
  backtestResults, portfolios, selectedDateRange, withdrawalRate, inflationRate, backtestXAxisConfig,
  BacktestDateTick, getAnnualReturnsChartData, getBestWorstYears, getPeriodicReturnsChartData,
  getRebalancingDetails, hasCostLeg, backtestReturnsPeriod, setBacktestReturnsPeriod, correlationWindow,
  setCorrelationWindow, deltaChartView, setDeltaChartView, deltaPortfolioA, setDeltaPortfolioA,
  deltaPortfolioB, setDeltaPortfolioB, selectedDetailPortfolio, setSelectedDetailPortfolio,
  selectedRebalancingPortfolio, setSelectedRebalancingPortfolio,
}: BacktestResultsProps) {
  // The start date the shown results were RUN with (every portfolio in a run shares it), so the
  // annual and periodic charts below stay in step with the results even if the Start Date control
  // has been changed since and Run not pressed again.
  const runStart = backtestResults[0]?.settings.start ?? selectedDateRange.start;
  return (
    <div className="mt-6">
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Results</h2>

      {/* Liquidation warning — only appears when a leveraged portfolio ran out of equity */}
      {backtestResults.some(r => r.wipedOutDate) && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-xs text-red-700">
          <span className="font-semibold">Wiped out: </span>
          {backtestResults.filter(r => r.wipedOutDate).map(r => `${r.portfolio.name} (${r.wipedOutDate})`).join(', ')}
          {' — '}leverage took the equity to zero on that date. A real broker would have
          liquidated the account there, so the portfolio is closed out and held at zero from
          then on: its return is −100% and the other statistics describe only the period it was alive.
        </div>
      )}

      {/* Statistics Table */}
      {/* Phones: the table is wider than the screen and swipes; the heading stays put while it */}
      {/* does ("max-md:sticky max-md:left-0"), and so do the portfolio names ("phone-pin-first") */}
      <div className="bg-white p-4 rounded-lg shadow overflow-x-auto mb-4 phone-pin-first">
        {/* Same heading treatment as the Monthly tab's statistics: what window these
            numbers cover, and on what basis, rather than a bare "Statistics". The window
            is read from the results themselves rather than from the date pickers above,
            so it always describes the months the statistics were actually computed over —
            which is the requested range trimmed to the rows the data really has. */}
        <h3 className="text-md font-semibold text-gray-900 mb-2 max-md:sticky max-md:left-0">
          Statistics
          {(() => {
            const pts = backtestResults[0]?.returns;
            if (!pts || pts.length < 2) return null;
            const start = pts[0].date, end = pts[pts.length - 1].date;
            return (
              <>
                {' for '}{formatPeriod(pts.length - 1)}
                <span className="font-normal text-gray-500">
                  {' '}({start.slice(0, 7)} / {end.slice(0, 7)}) based on month end prices
                </span>
              </>
            );
          })()}
        </h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b-2 border-gray-200">
              <th className="text-left py-2 px-2">Portfolio</th>
              <th className="text-right py-2 px-2">Return</th>
              <th className="text-right py-2 px-2 cursor-help" title={CAGR_HINT}>CAGR</th>
              <th className="text-right py-2 px-2">Vol</th>
              <th className="text-right py-2 px-2 cursor-help" title={SHARPE_HINT}>Sharpe</th>
              <th className="text-right py-2 px-2">Max DD</th>
              <th className="text-right py-2 px-2">Longest DD</th>
              <th className="text-right py-2 px-2">Curr DD</th>
              {/* Best / worst calendar year, the same figures as the Annual Returns
                  chart below — its tallest and shortest bar for that portfolio. */}
              <th className="text-right py-2 px-2">Best Year</th>
              <th className="text-right py-2 px-2">Worst Year</th>
              <th className="text-right py-2 px-2">End Val</th>
              <th className="text-right py-2 px-2">End Post W</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
            // Worked out once for the whole table rather than per row, since the
            // helper walks every portfolio's yearly returns each time it is called.
            const bestWorst = getBestWorstYears(backtestResults, runStart);
            return backtestResults.map((result, idx) => (
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
                {/* Best / worst year. Coloured like the same two columns on the
                    Monthly tab, and naming the year on hover — worth having,
                    because the best or worst year is often a part-year at either
                    end of the backtest rather than a full twelve months. */}
                <td className="text-right py-2 px-2 text-green-600"
                    title={bestWorst[result.portfolio.name] ? `Best calendar year: ${bestWorst[result.portfolio.name].bestYear}` : undefined}>
                  {bestWorst[result.portfolio.name]
                    ? `${bestWorst[result.portfolio.name].best >= 0 ? '+' : ''}${bestWorst[result.portfolio.name].best.toFixed(1)}%`
                    : '—'}
                </td>
                <td className="text-right py-2 px-2 text-red-600"
                    title={bestWorst[result.portfolio.name] ? `Worst calendar year: ${bestWorst[result.portfolio.name].worstYear}` : undefined}>
                  {bestWorst[result.portfolio.name]
                    ? `${bestWorst[result.portfolio.name].worst >= 0 ? '+' : ''}${bestWorst[result.portfolio.name].worst.toFixed(1)}%`
                    : '—'}
                </td>
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
            ));
            })()}
          </tbody>
        </table>
      </div>

      {/* Portfolio Value Chart */}
      <div className="bg-white p-2 sm:p-4 rounded-lg shadow mb-4">
        <h3 className="text-md font-semibold text-gray-700 mb-2 text-center">Portfolio Value</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart margin={{ top: 5, right: 5, left: -15, bottom: 15 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" type="category" allowDuplicatedCategory={false} ticks={backtestXAxisConfig.ticks} tick={BacktestDateTick} />
            <YAxis tick={{ fontSize: 9 }} width={55} domain={['auto', 'auto']} tickFormatter={phoneAxisMoney()} />
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
            <YAxis tick={{ fontSize: 9 }} width={55} domain={['auto', 'auto']} tickFormatter={phoneAxisMoney()} />
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

      {/* Returns Bar Chart — the same views as the Monthly tab's chart, applied to the
          backtested portfolios: grouped bars for each period, one bar per portfolio. */}
      <div className="bg-white p-4 rounded-lg shadow mt-4">
        {(() => {
          const rolling = ROLLING_RETURN_YEARS.find(r => r.period === backtestReturnsPeriod);
          const streak = STREAK_VIEWS.find(s => s.period === backtestReturnsPeriod);
          const rows = getPeriodicReturnsChartData(backtestResults, runStart, backtestReturnsPeriod);
          // ONE portfolio gets the Monthly tab's look exactly — black bars, red when
          // negative. TWO OR MORE keep their own colours, because telling the portfolios
          // apart is the entire point of this chart and one colour per sign would erase it.
          const singleSeries = backtestResults.length === 1;
          // The annual view keeps a label on every bar, exactly as it always had. The
          // other views can run to hundreds of bars, so it is the TOTAL number of labels
          // (bars x portfolios) that decides whether they would still be readable.
          const showLabels = backtestReturnsPeriod === 'annual'
            || rows.length * backtestResults.length < 48;
          const heading = backtestReturnsPeriod === 'annual' ? 'Annual Returns'
            : backtestReturnsPeriod === 'monthly' ? 'Monthly Returns'
            : backtestReturnsPeriod === 'quarterly' ? 'Quarterly Returns'
            : streak ? (streak.period === 'athStreak' ? 'Consecutive Months at an All-Time High' : 'Consecutive Up Months')
            : `Rolling ${rolling?.years}Y CAGR`;
          // Portfolio values are money, not prices, so they get thousands separators
          // rather than the Monthly tab's decimal-place-by-magnitude treatment.
          const fmtValue = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });
          return (
            <>
              <h3 className="text-md font-semibold text-gray-700 mb-2">{heading}</h3>
              {/* Period buttons, laid out and styled exactly like the Monthly tab's
                  (phones: one box that opens a slide-up panel) */}
              <div className="hidden max-md:flex mb-2 w-1/2">
                <PhoneChoice
                  label="Returns"
                  options={RETURNS_PERIOD_CHOICES}
                  selected={backtestReturnsPeriod}
                  onPick={p => setBacktestReturnsPeriod(p as ReturnsChartPeriod)}
                />
              </div>
              <div className="flex items-center gap-2 mb-2 px-2 flex-wrap max-md:hidden">
                <span className="text-xs font-semibold text-gray-500">Returns:</span>
                <span className={SEG}>
                {(['monthly', 'quarterly', 'annual'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setBacktestReturnsPeriod(p)}
                    className={segBtn(backtestReturnsPeriod === p)}
                  >
                    {p === 'monthly' ? 'Monthly' : p === 'quarterly' ? 'Quarterly' : 'Annual'}
                  </button>
                ))}
                </span>
                <span className={SEG}>
                {ROLLING_RETURN_YEARS.map(r => (
                  <button
                    key={r.period}
                    onClick={() => setBacktestReturnsPeriod(r.period)}
                    title={`Rolling ${r.years}-year CAGR: every bar is the annual return the portfolio would have earned starting in that month and holding for ${r.years} year${r.years === 1 ? '' : 's'}. The X axis is the month the holding period STARTED.`}
                    className={segBtn(backtestReturnsPeriod === r.period)}
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
                    onClick={() => setBacktestReturnsPeriod(s.period)}
                    title={s.hint}
                    className={segBtn(backtestReturnsPeriod === s.period)}
                  >
                    {s.label}
                  </button>
                ))}
                </span>
              </div>
              {rows.length === 0 ? (
                <p className="text-xs text-gray-500 px-2 py-6">
                  {rolling
                    ? `The backtest is not long enough for a ${rolling.years}-year rolling window. Widen the date range above, or pick a shorter rolling window.`
                    : 'No periods to show for this backtest.'}
                </p>
              ) : (
              <>
              {/* Up Months: longest up and down streak per portfolio, above the bars.
                  A portfolio's months are only the rows that carry its name. */}
              {backtestReturnsPeriod === 'upStreak' && (
                <UpMonthsSummary series={backtestResults.map(r => ({
                  name: r.portfolio.name,
                  color: r.portfolio.color,
                  bars: rows.filter(row => typeof row[r.portfolio.name] === 'number')
                    .map(row => ({ label: row.label, count: Number(row[r.portfolio.name]) })),
                }))} />
              )}
              <ResponsiveContainer width="100%" height={300}>
                {/* No CartesianGrid, matching the Monthly tab's returns chart */}
                <BarChart data={rows} margin={{ top: 20, right: 5, left: 5, bottom: 5 }}>
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
                      // Single-line label (monthly/rolling: "Jan 25", annual: "2024")
                      return <text x={x} y={y + 10} textAnchor="middle" fontSize={9} fill={MUTED}>{payload.value}</text>;
                    }}
                    height={35}
                    interval={(backtestReturnsPeriod === 'monthly' || rolling || streak) && rows.length > 24
                      ? Math.max(0, Math.floor(rows.length / 20) - 1)
                      : 0}
                  />
                  {/* The axis stays hidden while every bar carries its own label — that is
                      how this chart has always looked. Once the labels are too dense to
                      draw, it appears, so the bars never lose their scale entirely.
                      Streaks are a count of months, so it drops the % sign. */}
                  {/* padding: room under the lowest bar for its loss label (lossBarLabel) */}
                  {showLabels
                    ? <YAxis hide domain={['auto', 'auto']}
                        padding={{ bottom: lossLabelRoom(rows.some(r => backtestResults.some(res => Number(r[res.portfolio.name]) < 0)), 11) }} />
                    : <YAxis tick={{ fontSize: 9 }} width={40} tickFormatter={(v: number) => streak ? v.toFixed(0) : `${v.toFixed(0)}%`} />}
                  <Tooltip
                    formatter={(value: number, name: string, props: { payload?: PeriodicReturnsRow }) => {
                      if (streak) return [`${value} month${value === 1 ? '' : 's'}`, name];
                      const pct = `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
                      if (!rolling) return [pct, name];
                      // On a rolling view, show the two portfolio values the CAGR came
                      // from — the same "here is the working" idea as the Monthly tab.
                      const from = props?.payload?.[`${name}__start`];
                      const to = props?.payload?.[`${name}__end`];
                      return [
                        typeof from === 'number' && typeof to === 'number'
                          ? `${pct}  (${fmtValue(from)} → ${fmtValue(to)})`
                          : pct,
                        name,
                      ];
                    }}
                    labelFormatter={(label: string, payload: readonly { payload?: PeriodicReturnsRow }[]) => {
                      if (rolling) return payload?.[0]?.payload?.range || label;
                      if (backtestReturnsPeriod === 'annual') return `Year: ${label}`;
                      return String(label).replace('\n', ' ');
                    }}
                  />
                  <Legend />
                  <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" strokeWidth={1} />
                  {/* Create one Bar component for each portfolio */}
                  {backtestResults.map((result) => (
                    <Bar
                      key={result.portfolio.id}
                      dataKey={result.portfolio.name}
                      fill={singleSeries ? BLACK : result.portfolio.color}
                      isAnimationActive={false}
                    >
                      {/* Single portfolio: colour each bar by sign, like the Monthly tab */}
                      {singleSeries && rows.map((row, index) => (
                        <Cell key={index} fill={Number(row[result.portfolio.name]) < 0 ? LOSS : GAIN} />
                      ))}
                      {/* Labels for positive returns - positioned above bar.
                          A streak label is a plain month count, not a percentage. */}
                      {showLabels && (
                        <LabelList
                          dataKey={result.portfolio.name}
                          position="top"
                          formatter={(value: number) => streak
                            ? (value > 0 ? String(value) : '')
                            : (value >= 0 ? `${value.toFixed(1)}%` : '')}
                          style={{ fontSize: '11px', fill: MUTED_LABEL }}
                        />
                      )}
                      {/* Labels for negative returns - positioned below bar in red */}
                      {showLabels && (
                        <LabelList
                          dataKey={result.portfolio.name}
                          content={lossBarLabel((value: number) => `${value.toFixed(1)}%`, { fontSize: '11px', fill: LOSS })}
                        />
                      )}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
              </>
              )}
              {/* The Δ table further down always shows CALENDAR YEARS, whatever this
                  chart is showing, so say so rather than let the two look like they
                  disagree. It is no longer the next thing on the page — the
                  head-to-head chart sits between — hence "further down". */}
              {backtestReturnsPeriod !== 'annual' && (
                <p className="text-[10px] text-gray-400 mt-2">
                  The year-by-year table further down always shows calendar-year returns, regardless of the view selected above.
                </p>
              )}
            </>
          );
        })()}

      {/* Head-to-head: one portfolio MINUS another, period by period.
          Only worth showing when there are two portfolios to compare. */}
      {backtestResults.length >= 2 && (() => {
        // Guard the stored positions: a portfolio can be removed between runs,
        // which would otherwise leave a dropdown pointing at nothing.
        const aIdx = backtestResults[deltaPortfolioA] ? deltaPortfolioA : 0;
        const bIdx = backtestResults[deltaPortfolioB] ? deltaPortfolioB : 1;
        const a = backtestResults[aIdx].portfolio;
        const b = backtestResults[bIdx].portfolio;
        // Same portfolio picked twice — or two portfolios sharing a name, which the
        // chart data is keyed by. An auto-generated name covers assets, currency and
        // inflation adjustment, and rebalancing is a global setting, so a shared name
        // means genuinely identical portfolios: the honest answer is "these are the
        // same thing", not a row of zero-height bars that looks like a broken chart.
        const sameTwice = a.id === b.id || a.name === b.name;
        const deltaRolling = ROLLING_RETURN_YEARS.find(r => r.period === backtestReturnsPeriod);
        // The streak views have no sensible difference. Subtracting one run length
        // from another — seven months at a high minus three — produces a number that
        // reads like a quantity but means nothing, so this chart sits those views out
        // and says so rather than drawing bars nobody could interpret.
        const deltaStreak = STREAK_VIEWS.find(s => s.period === backtestReturnsPeriod);

        // CORRELATION. Independent of the period buttons on purpose — it always
        // runs on monthly returns over the selected date range (see the helper
        // functions for why), so the headline number stays put while you click
        // between Monthly, Annual and the rolling views above.
        const paired = sameTwice ? [] : getPairedMonthlyReturns(backtestResults[aIdx], backtestResults[bIdx]);
        const fullCorr = pearsonCorrelation(paired.map(p => p.a), paired.map(p => p.b));
        // The ROLLING series is only built when its view is on screen. The pairing
        // above is not gated, because the title shows the correlation in both views
        // — so the gap view does carry about 0.25ms of extra work per render that it
        // did not before (measured on a 200-month backtest). That is far inside a
        // frame budget and in line with the rest of this component, which recomputes
        // its chart data on every render rather than memoising.
        const corrRows = deltaChartView === 'correlation'
          ? getRollingCorrelationData(paired, correlationWindow)
          : [];

        // Built from the SAME helper as the returns chart above, so a bar here is
        // always exactly the difference of two bars up there — and in the annual
        // view, exactly the Δ column of the table. Nothing is recomputed.
        const periodRows = (sameTwice || deltaStreak)
          ? []
          : getPeriodicReturnsChartData(backtestResults, runStart, backtestReturnsPeriod);
        // One bar of this chart: the gap, plus both sides' own returns and (on a
        // rolling view) the window the gap was measured over, for the tooltip.
        type DeltaBar = { label: string; range?: string; delta: number; aVal: number; bVal: number };
        const rows = periodRows
          .map((row): DeltaBar | null => {
            const aVal = row[a.name];
            const bVal = row[b.name];
            if (typeof aVal !== 'number' || typeof bVal !== 'number') return null;
            // Percentage POINTS: both sides are already percentages, so beating
            // 10% with 12% is +2pp. Never call that +2%, which would mean 10.2%.
            // On a rolling view both sides are CAGRs, so the gap is pp PER YEAR.
            return {
              label: row.label,
              range: typeof row.range === 'string' ? row.range : undefined,
              delta: parseFloat((aVal - bVal).toFixed(2)),
              aVal,
              bVal,
            };
          })
          .filter((r): r is DeltaBar => r !== null);

        const aWins = rows.filter(r => r.delta > 0).length;
        const periodNoun = deltaRolling ? `${deltaRolling.years}-year windows`
          : backtestReturnsPeriod === 'annual' ? 'years'
          : backtestReturnsPeriod === 'quarterly' ? 'quarters' : 'months';
        // Rolling bars are annualised, so their unit carries a "per year".
        const unit = deltaRolling ? 'pp/yr' : 'pp';
        // Same crowding rule as the chart above: one series here, so it is simply
        // the bar count that decides whether a label on each one stays readable.
        const showLabels = rows.length < 48;

        return (
          // A section of the returns card rather than a card of its own, so this
          // chart sits directly under the one it is derived from. A hairline rule
          // separates them, the way the Monthly tab divides its own sections.
          <div className="mt-6 border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              {/* Title, the whole-period correlation, and the view toggle, all in
                  one left-hand group so the dropdowns stay on the right. */}
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-md font-semibold text-gray-700">
                  Head to Head
                  {/* Suppressed when the pair is the same portfolio twice (it would
                      trivially be 1.00) or when there are too few months to mean
                      anything — see pearsonCorrelation, which returns null for both. */}
                  {fullCorr !== null && (
                    <span
                      className="font-normal text-gray-500"
                      title={`Pearson correlation of the two portfolios' ${paired.length} monthly returns over the selected date range. +1 = they moved in lockstep, 0 = no relationship, -1 = they moved opposite. It measures direction, not size.`}
                    >
                      {' '}(Correlation of {fullCorr.toFixed(2)})
                    </span>
                  )}
                </h3>
                {/* Two views of the same pair: who won each period, or how closely
                    the two moved together. Styled like the Returns period buttons. */}
                <div className={SEG}>
                  {([['gap', 'Gap'], ['correlation', 'Correlation']] as const).map(([view, label]) => (
                    <button
                      key={view}
                      onClick={() => setDeltaChartView(view)}
                      title={view === 'gap'
                        ? 'Period-by-period difference between the two portfolios — who won, and by how much.'
                        : 'Rolling correlation of the two portfolios’ monthly returns — whether they were moving together, and how that changed over time.'}
                      className={segBtn(deltaChartView === view)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Which two portfolios, in which direction. Positive bars always
                  mean the FIRST dropdown is ahead. */}
              <div className="flex items-center gap-2 text-sm">
                <select
                  aria-label="Portfolio shown as positive bars"
                  className={FIELD}
                  value={aIdx}
                  onChange={(e) => setDeltaPortfolioA(parseInt(e.target.value))}
                >
                  {backtestResults.map((result, idx) => (
                    <option key={idx} value={idx}>{result.portfolio.name}</option>
                  ))}
                </select>
                <span className="text-gray-500">vs</span>
                <select
                  aria-label="Portfolio shown as negative bars"
                  className={FIELD}
                  value={bIdx}
                  onChange={(e) => setDeltaPortfolioB(parseInt(e.target.value))}
                >
                  {backtestResults.map((result, idx) => (
                    <option key={idx} value={idx}>{result.portfolio.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* The GAP view has no period buttons of its own: the row above the
                previous chart drives it too, which is the point of having them
                adjacent. The correlation view below is the exception — it ignores
                that row entirely and carries its own window length. */}
            {/* CORRELATION VIEW. Sits in front of the existing chain rather than
                inside it, because it is driven by monthly returns and so has none
                of the gap chart's period restrictions — it works perfectly well
                while the buttons above are on a streak view. `!sameTwice` lets the
                "pick two different portfolios" message below still do its job. */}
            {deltaChartView === 'correlation' && !sameTwice ? (
              <>
                {/* How far back each point looks */}
                <div className="flex items-center gap-2 mb-2 px-2 flex-wrap">
                  <span className="text-xs font-semibold text-gray-500">Window:</span>
                  <span className={SEG}>
                  {CORRELATION_WINDOWS.map(w => (
                    <button
                      key={w}
                      onClick={() => setCorrelationWindow(w)}
                      title={`Each point is the correlation over the ${w} months ending that month.`}
                      className={segBtn(correlationWindow === w)}
                    >
                      {w}M
                    </button>
                  ))}
                  </span>
                </div>
                {corrRows.length === 0 ? (
                  <p className="text-xs text-gray-500 px-2 py-6">
                    The backtest is not long enough for a {correlationWindow}-month correlation window.
                    Widen the date range above, or pick a shorter window.
                  </p>
                ) : (
                  <>
                    {/* The headline the line below is the detail of: where the pair
                        sits over the whole period, before you look at when it moved. */}
                    <p className="text-xs text-gray-600 mb-1 px-2">
                      <span className="font-semibold" style={{ color: a.color }}>{a.name}</span>
                      {' '}vs{' '}
                      <span className="font-semibold" style={{ color: b.color }}>{b.name}</span>
                      {fullCorr !== null && (
                        <> — {fullCorr.toFixed(2)} over the whole period (dashed line), {corrRows.length} rolling {correlationWindow}-month windows</>
                      )}
                    </p>
                    <ResponsiveContainer width="100%" height={300}>
                      {/* Gridless, matching every other chart on this page */}
                      <LineChart data={corrRows} margin={{ top: 20, right: 5, left: 5, bottom: 5 }}>
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 9, fill: MUTED }}
                          height={35}
                          interval={corrRows.length > 24 ? Math.max(0, Math.floor(corrRows.length / 20) - 1) : 0}
                        />
                        {/* Pinned to the full -1..+1 range on purpose. Auto-scaling
                            would zoom into a band of 0.85-0.95 and make a pair that
                            never decoupled look like it swung wildly. */}
                        <YAxis
                          domain={[-1, 1]}
                          ticks={[-1, -0.5, 0, 0.5, 1]}
                          tick={{ fontSize: 9 }}
                          width={45}
                          tickFormatter={(v: number) => v.toFixed(1)}
                        />
                        <Tooltip
                          formatter={(value: number) => [value.toFixed(2), 'Correlation']}
                          labelFormatter={(label: string, payload: readonly { payload?: { range?: string } }[]) =>
                            payload?.[0]?.payload?.range || label}
                        />
                        <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" strokeWidth={1} />
                        {/* The whole-period figure from the title, drawn across the
                            chart so you can see which stretches were tighter or
                            looser than the pair's own long-run average. */}
                        {fullCorr !== null && (
                          <ReferenceLine
                            y={parseFloat(fullCorr.toFixed(3))}
                            stroke="#94A3B8"
                            strokeDasharray="6 3"
                            strokeWidth={1.5}
                          />
                        )}
                        {/* Neutral slate rather than either portfolio's colour: this
                            line belongs to the pair, not to one side of it.
                            Animation off so the shape is correct immediately. */}
                        <Line
                          type="monotone"
                          dataKey="corr"
                          stroke={SLATE}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    <p className="text-[10px] text-gray-400 mt-2 px-2">
                      Each point is the correlation of the two portfolios’ MONTHLY returns over the {correlationWindow} months
                      ending that month, so the X axis is the month each window closed. +1 means they moved in lockstep,
                      0 means no relationship, −1 means they moved opposite. Correlation measures direction only, not size:
                      a portfolio that swings three times as hard as the other, but always on the same months, still reads +1 —
                      the Gap view above is where the size of the difference shows up.
                    </p>
                  </>
                )}
              </>
            ) : deltaStreak ? (
              <p className="text-xs text-gray-500 px-2 py-6">
                Not applicable to the {deltaStreak.label} view — a streak minus a streak is not a
                meaningful number. Pick one of the returns views above to compare these two portfolios.
              </p>
            ) : sameTwice ? (
              <p className="text-xs text-gray-500 px-2 py-6">
                Pick two different portfolios to compare.
              </p>
            ) : rows.length === 0 ? (
              <p className="text-xs text-gray-500 px-2 py-6">
                {deltaRolling
                  ? `The backtest is not long enough for a ${deltaRolling.years}-year rolling window. Widen the date range above, or pick a shorter rolling window.`
                  : 'No overlapping periods to compare for these two portfolios.'}
              </p>
            ) : (
              <>
                {/* How often the first one came out ahead — the headline the bars
                    below are the detail of. */}
                <p className="text-xs text-gray-600 mb-1 px-2">
                  <span className="font-semibold" style={{ color: a.color }}>{a.name}</span>
                  {' '}ahead in {aWins} of {rows.length} {periodNoun}
                  {' '}({Math.round((aWins / rows.length) * 100)}%)
                </p>
                {/* Says which way is which, so a bar's direction needs no decoding.
                    Repeated under the chart for the downside, per the same idea. */}
                <p className="text-xs font-medium px-2" style={{ color: a.color }}>
                  ▲ {a.name} outperforms {b.name}
                </p>
                <ResponsiveContainer width="100%" height={300}>
                  {/* Gridless, matching every other chart on this page */}
                  <BarChart data={rows} margin={{ top: 20, right: 5, left: 5, bottom: 5 }}>
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
                        return <text x={x} y={y + 10} textAnchor="middle" fontSize={9} fill={MUTED}>{payload.value}</text>;
                      }}
                      height={35}
                      interval={(backtestReturnsPeriod === 'monthly' || deltaRolling) && rows.length > 24
                        ? Math.max(0, Math.floor(rows.length / 20) - 1)
                        : 0}
                    />
                    <YAxis
                      tick={{ fontSize: 9 }}
                      width={45}
                      tickFormatter={(v: number) => `${v.toFixed(0)}${unit}`}
                      padding={{ bottom: lossLabelRoom(rows.some(r => Number(r.delta) < 0), 9) }}
                    />
                    <Tooltip
                      formatter={(value: number) => [
                        `${value >= 0 ? '+' : ''}${value.toFixed(2)}${unit}`,
                        value >= 0 ? `${a.name} ahead` : `${b.name} ahead`,
                      ]}
                      labelFormatter={(label: string, payload: readonly { payload?: { aVal?: number; bVal?: number; range?: string } }[]) => {
                        const p = payload?.[0]?.payload;
                        // A rolling bar covers a whole window, so name both ends of it
                        // rather than just the month it started.
                        const period = p?.range || String(label).replace('\n', ' ');
                        // Show both sides' own returns, so the difference can be
                        // checked against the chart above without leaving the page.
                        return typeof p?.aVal === 'number' && typeof p?.bVal === 'number'
                          ? `${period}  —  ${a.name} ${p.aVal.toFixed(1)}%, ${b.name} ${p.bVal.toFixed(1)}%`
                          : period;
                      }}
                    />
                    <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" strokeWidth={1} />
                    <Bar dataKey="delta" isAnimationActive={false}>
                      {/* Each bar wears the colour of whoever won that period */}
                      {rows.map((row, index) => (
                        <Cell key={index} fill={row.delta >= 0 ? a.color : b.color} />
                      ))}
                      {/* Two label lists so each side's numbers carry its own colour */}
                      {showLabels && (
                        <LabelList
                          dataKey="delta"
                          position="top"
                          formatter={(value: number) => value >= 0 ? `+${value.toFixed(1)}` : ''}
                          style={{ fontSize: '9px', fill: a.color }}
                        />
                      )}
                      {showLabels && (
                        <LabelList
                          dataKey="delta"
                          content={lossBarLabel((value: number) => value.toFixed(1), { fontSize: '9px', fill: b.color })}
                        />
                      )}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-xs font-medium px-2" style={{ color: b.color }}>
                  ▼ {b.name} outperforms {a.name}
                </p>
                <p className="text-[10px] text-gray-400 mt-2 px-2">
                  {deltaRolling
                    ? `Bars are the gap between the two portfolios' ANNUALISED returns (CAGR) over each complete ${deltaRolling.years}-year holding period, in percentage points per year (pp/yr). Compounding 12%/yr against 10%/yr is +2pp/yr. The X axis is the month each window started.`
                    : 'Bars are the difference between the two portfolios’ returns for that period, in percentage points (pp). Beating 10% with 12% is +2pp.'}
                </p>
              </>
            )}
          </div>
        );
      })()}
        {/* Same numbers as the bars above, in table form: one row per year, one column
            per portfolio. It reads from the SAME getAnnualReturnsChartData() helper the
            chart uses, so the table and the bars can never drift apart — including the
            rule that drops a December start year (only one data point, would show 0%). */}
        {(() => {
          const annualRows = getAnnualReturnsChartData(backtestResults, runStart);
          if (annualRows.length === 0) return null;
          // The chart runs oldest -> newest left to right; the table puts the newest year
          // on top, matching the Returns tables further down the page.
          const rowsNewestFirst = [...annualRows].reverse();
          // The FIRST portfolio is the benchmark. Every other portfolio gets an extra
          // "Δ" column: its return minus the benchmark's, for the same year. Because
          // both numbers are already percentages, the difference is in percentage
          // POINTS (pp) — beating 10% with 12% is +2pp, not +2%.
          const benchmark = backtestResults[0];
          const challengers = backtestResults.slice(1);  // empty when there's only one portfolio
          return (
            <div className="overflow-x-auto mt-3">
              {/* Spell out what the Δ columns mean, so nobody has to guess the direction */}
              {challengers.length > 0 && (
                <p className="text-xs text-gray-500 mb-1">
                  Δ columns = that portfolio minus <span className="font-medium" style={{ color: benchmark.portfolio.color }}>{benchmark.portfolio.name}</span> (benchmark), in percentage points.
                </p>
              )}
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left py-2 px-2 bg-gray-100 sticky left-0">Year</th>
                    {/* One column per portfolio, its name in the same colour as its bar */}
                    {backtestResults.map(result => (
                      <th
                        key={result.portfolio.id}
                        className="text-right py-2 px-2 bg-gray-100 font-semibold"
                        style={{ color: result.portfolio.color }}
                        title={result.portfolio.id === benchmark.portfolio.id && challengers.length > 0
                          ? 'Benchmark — the Δ columns are measured against this portfolio'
                          : undefined}
                      >
                        {result.portfolio.name}
                      </th>
                    ))}
                    {/* Then the Δ columns, one per non-benchmark portfolio */}
                    {challengers.map(result => (
                      <th
                        key={`delta-${result.portfolio.id}`}
                        className="text-right py-2 px-2 bg-gray-100 font-semibold border-l border-gray-300"
                        style={{ color: result.portfolio.color }}
                        title={`${result.portfolio.name} minus ${benchmark.portfolio.name} (benchmark), in percentage points`}
                      >
                        Δ {result.portfolio.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowsNewestFirst.map(row => (
                    <tr key={row.year} className="border-b border-gray-100">
                      <td className="py-2 px-2 font-medium bg-gray-50 sticky left-0">{row.year}</td>
                      {backtestResults.map(result => {
                        const ret = row[result.portfolio.name];
                        // A portfolio with no return for this year (shouldn't normally happen,
                        // since all portfolios share one date range) shows a dash, not a 0%
                        if (typeof ret !== 'number') {
                          return <td key={result.portfolio.id} className="text-right py-2 px-2 text-gray-300">-</td>;
                        }
                        // Same green/red shading as the monthly Returns tables below
                        const bgColor = ret >= 0 ? 'bg-green-50' : 'bg-red-50';
                        const textColor = ret >= 0 ? 'text-green-700' : 'text-red-700';
                        return (
                          <td key={result.portfolio.id} className={`text-right py-2 px-2 ${bgColor} ${textColor}`}>
                            {ret.toFixed(2)}%
                          </td>
                        );
                      })}
                      {/* Δ vs benchmark. Deliberately NOT shaded like the columns above —
                          plain coloured text plus a divider line keeps the two blocks
                          visually separate, so a green cell always means "beat the benchmark"
                          here and "made money" over there. */}
                      {challengers.map(result => {
                        const base = row[benchmark.portfolio.name];
                        const own = row[result.portfolio.name];
                        if (typeof base !== 'number' || typeof own !== 'number') {
                          return <td key={`delta-${result.portfolio.id}`} className="text-right py-2 px-2 text-gray-300 border-l border-gray-300">-</td>;
                        }
                        const delta = own - base;
                        return (
                          <td
                            key={`delta-${result.portfolio.id}`}
                            className={`text-right py-2 px-2 font-medium border-l border-gray-300 ${delta >= 0 ? 'text-green-700' : 'text-red-700'}`}
                          >
                            {delta >= 0 ? '+' : ''}{delta.toFixed(2)}pp
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      {/* Monthly Returns Tables */}
      {backtestResults.map((result, idx) => {
        const monthlyReturns = calculateMonthlyReturns(result.returns);

        // Determine if we should skip the start year (when start month is December)
        // Same logic as the bar chart - December start years only have one data point
        const startDateObj = new Date(runStart);
        const startMonth = startDateObj.getMonth(); // 0-11, December = 11
        const startYear = startDateObj.getFullYear().toString();
        const skipStartYear = startMonth === 11; // December

        return (
          <div key={idx} className="bg-white p-4 rounded-lg shadow overflow-x-auto mt-4">
            {/* Phones: the heading stays put while the table swipes */}
            <h3 className="text-md font-semibold mb-2 max-md:sticky max-md:left-0" style={{ color: result.portfolio.color }}>
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
      {/* Phones: the heading row stays put while the table swipes, and so does the Year column */}
      <div className="bg-white p-4 rounded-lg shadow overflow-x-auto mt-4 phone-pin-first">
        <div className="flex items-center justify-between mb-2 max-md:sticky max-md:left-0">
          <h3 className="text-md font-semibold text-gray-700">Withdrawal Detail</h3>
          {/* Dropdown to pick which portfolio's detail to show */}
          <select
            aria-label="Portfolio"
            className={FIELD}
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
            aria-label="Portfolio"
            className={FIELD}
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
          // Only show the financing column when some leg actually carries a cost —
          // otherwise it'd be a column of zeros on every existing portfolio.
          const showCostCol = hasCostLeg(selectedResult.portfolio);

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
                    {/* Financing accrued since the last rebalance (already inside Value) */}
                    {showCostCol && (
                      <th className="text-right py-2 px-2" title="Financing / carry accrued since the last rebalance. Already deducted from Value; resets to zero each rebalance.">Fin. ({rSym})</th>
                    )}
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
                            {row.assetPrices[asset] != null ? formatPrice(row.assetPrices[asset]) : '—'}
                          </td>
                          <td className="text-right py-1 px-2">
                            {row.assetShares[asset] != null ? row.assetShares[asset].toFixed(2) : '—'}
                          </td>
                          <td className="text-right py-1 px-2">
                            {row.assetWeights[asset] != null ? row.assetWeights[asset].toFixed(1) + '%' : '—'}
                          </td>
                        </React.Fragment>
                      ))}
                      {showCostCol && (
                        <td className={`text-right py-1 px-2 ${row.accruedCost < 0 ? 'text-amber-700' : 'text-gray-400'}`}>
                          {row.accruedCost ? `${rSym}${row.accruedCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}
                        </td>
                      )}
                      <td className={`text-right py-1 px-2 font-semibold ${row.isWipedOut ? 'text-red-600' : ''}`}>
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
  );
}
