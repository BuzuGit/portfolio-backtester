/*
  THE PORTFOLIO TAB

  The real portfolio, from the Years and Daily NAV sheets: value by year, contributions and profit,
  the xxxPLN moves, the profit breakdown by asset for a year, the statistics table, the Daily NAV
  chart against inflation and a benchmark, its drawdowns, and returns and growth by year.

  The five chart-data helpers only this tab uses moved here word for word. The profit breakdown
  (built in the main screen from the transaction sheets) and every choice here live in the main
  screen and are passed in, so they survive switching tabs.
*/
import React from 'react';
import {
  LineChart, Line, BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ComposedChart,
  Area, ReferenceLine, AreaChart, Customized,
} from 'recharts';
import type { AssetRow, DailyNavRow, YearsRow } from '@/lib/fetchData';
import { isPhoneScreen } from '@/lib/savedSheet';
import { MONTH_ABBR } from '@/lib/dates';
import {
  annualisedVolPct, cagrPct, drawdownsPct, isAnnualisable, longestUnderwater, maxDrawdownPct, periodReturns,
  sharpeRatio as sharpeFor, yearsBetween,
} from '@/lib/stats';
import { FX_TICKER_MAP, formatPeriod, getConversionRate, type Portfolio } from '@/lib/backtest';
import { FX_ROW_BASE, yearsRowRate, yearsRowStartRate } from '@/lib/yearsRates';
import { CURRENCY_SYMBOLS } from '@/components/options';
import { PhoneChoice, periodOptions } from '@/components/PhoneSheet';
import {
  BLACK, BTN_SECOND, CAGR_HINT, CARD_GLASS, CHART_PALETTE, CURRENCY_COLORS, FIELD, GAIN, INFLATION_COLOR, INK_SOFT,
  LINE, LINE_FAINT, LINE_MID, LOSS, LOSS_TOTAL, MUTED, MUTED_LABEL, ON_BLACK, PHONE_SCROLL_ROW, PROFIT_COLOR,
  ResponsiveContainer, SEG, SHARPE_HINT, SLATE, lossBarLabel, lossLabelRoom, segBtn,
} from '@/components/ui';
import {
  CURRENCY_CPI, DAILY_NAV_BENCHMARKS, DivergingBar, barMillions, barPct, renderEdgeBubbles,
  type BubbleDef, type RechartsCustomizedProps,
} from '@/components/charts';

/** One year's profit split by asset (the main screen's getYearlyProfitBreakdown). */
export type YearlyProfitBreakdown = {
  assets: {
    ticker: string; name: string; nativeCurrency: string;
    totalNative: number; totalConverted: number; totalFx: number;
    retNative: number | null; retConverted: number | null;   // whole-asset % return (this year)
    startValue: number; endValue: number;                    // native position value at each boundary
    segments: {
      label: string;
      shares: number | null;      // null for the income line
      startPrice: number | null; startTag: string;
      endPrice: number | null;   endTag: string;
      startValue: number | null; endValue: number | null;    // native position value (endValue − startValue = profitNative)
      profitNative: number; profitConverted: number;
      fxEffect: number;                         // FX slice of the converted profit
      retNative: number | null;                 // % return in native currency
      retConverted: number | null;              // % return in selected currency
    }[];
  }[];
  other: number;
  total: number;
};

type NavCurrency = 'PLN' | 'USD' | 'SGD' | 'CHF';
type NavPeriod = '1Y' | '3Y' | '5Y' | 'Max';
type NavBenchmark = '' | '60/40' | 'World' | 'EQ-MF' | 'EQ-GLD' | '40/FI/MF/GLD';
export type PortfolioCurrency = 'PLN' | 'USD' | 'EUR' | 'CHF' | 'SGD';

export interface PortfolioTabProps {
  assetData: AssetRow[] | null;
  yearsData: YearsRow[];
  dailyData: DailyNavRow[];
  getAssetCurrency: (ticker: string) => string;
  getAssetFirstAvailableDate: (ticker: string) => string | null;
  getYearlyValueSeries: (cur: string) => { year: string; endValue: number; startValue: number; contributions: number; profit: number }[];
  breakdownData: YearlyProfitBreakdown;
  breakdownYears: number[];
  resolvedBreakdownYear: number | null;
  setBreakdownYear: (y: number | null) => void;
  breakdownExpanded: boolean; setBreakdownExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  portfolioCurrency: PortfolioCurrency; setPortfolioCurrency: (c: PortfolioCurrency) => void;
  selectedReturnCurrencies: string[]; setSelectedReturnCurrencies: React.Dispatch<React.SetStateAction<string[]>>;
  dailyNavCurrency: NavCurrency; setDailyNavCurrency: (c: NavCurrency) => void;
  dailyNavPeriod: NavPeriod; setDailyNavPeriod: (p: NavPeriod) => void;
  dailyNavBenchmark: NavBenchmark; setDailyNavBenchmark: React.Dispatch<React.SetStateAction<NavBenchmark>>;
  ddPeriod: NavPeriod; setDdPeriod: (p: NavPeriod) => void;
  ddSelectedCurrencies: NavCurrency[]; setDdSelectedCurrencies: React.Dispatch<React.SetStateAction<NavCurrency[]>>;
}

export default function PortfolioTab({
  assetData, yearsData, dailyData, getAssetCurrency, getAssetFirstAvailableDate, getYearlyValueSeries,
  breakdownData, breakdownYears, resolvedBreakdownYear, setBreakdownYear, breakdownExpanded, setBreakdownExpanded,
  portfolioCurrency, setPortfolioCurrency, selectedReturnCurrencies, setSelectedReturnCurrencies,
  dailyNavCurrency, setDailyNavCurrency, dailyNavPeriod, setDailyNavPeriod, dailyNavBenchmark, setDailyNavBenchmark,
  ddPeriod, setDdPeriod, ddSelectedCurrencies, setDdSelectedCurrencies,
}: PortfolioTabProps) {
  /**
   * Chart 1 data: Portfolio Value by Year (stacked bar), in millions.
   * Bottom segment = Contributions Cumulative, Top segment = Profit Cumulative.
   * The stack total is the actual portfolio value (endValue). We accumulate the
   * value-consistent yearly profit for the top segment and take contributions as the
   * remainder (endValue − cumulative profit) — so the split matches Chart 2 and the
   * bar total stays exactly the portfolio value in every currency.
   */
  const getPortfolioValueChartData = () => {
    let cumProfit = 0;
    return getYearlyValueSeries(portfolioCurrency).map(s => {
      cumProfit += s.profit;
      return {
        year: s.year,
        contrCumulative: (s.endValue - cumProfit) / 1_000_000,
        profitCumulative: cumProfit / 1_000_000,
        total: s.endValue / 1_000_000,
      };
    });
  };

  /**
   * Chart 2 data: Contributions and Profit by Year (stacked bar + growth label).
   * Bottom segment = Contributions, Top segment = Profit (loss drops below the axis).
   */
  const getContributionsProfitChartData = () => {
    return getYearlyValueSeries(portfolioCurrency).map(s => ({
      year: s.year,
      contributions: s.contributions,
      profitPositive: s.profit >= 0 ? s.profit : 0,
      profitNegative: s.profit < 0 ? s.profit : 0,
      // The bars share one stackId and Recharts accumulates them sequentially, which would
      // push the black "contributions" bar below zero in loss years. A transparent spacer
      // equal to the loss cancels it out, so contributions always starts at 0 and the yellow
      // loss bar (drawn first, 0 → negative) stays visible below the axis.
      lossSpacer: s.profit < 0 ? -s.profit : 0,
      profit: s.profit,
      growthTotal: s.contributions + s.profit,
    }));
  };

  /**
   * How much the exchange rate itself moved, year by year — the small row of
   * percentages printed under Chart 2's year labels.
   *
   * WHICH RATE: the zloty pair belonging to the currency selected above the charts
   * (see FX_ROW_BASE) — USD/PLN for a PLN or USD view, EUR/PLN for EUR, and so on.
   *
   * HOW IT IS MEASURED: end of year against end of the PREVIOUS year, exactly the
   * same close-to-close basis the charts use to convert portfolio VALUES. So +4.2%
   * on 2024 means "one dollar bought 4.2% more zloty on 31 Dec 2024 than it did on
   * 31 Dec 2023" — i.e. the zloty weakened by that much.
   *
   * THE FIRST YEAR has no previous year-end to compare with, so it falls back to
   * that year's own opening rate (the "xxx Start Period" columns of the Years sheet).
   *
   * Returns a { "2024": 4.2, ... } lookup; null means the rate is missing for that
   * year and the row prints a dash rather than a made-up number.
   */
  const getFxYearlyMoves = (): { [year: string]: number | null } => {
    const base = FX_ROW_BASE[portfolioCurrency] || 'USD';
    const out: { [year: string]: number | null } = {};
    let prevEnd: number | null = null;   // last year's closing rate, or null if unusable
    for (const row of yearsData) {
      const year = row.date.includes('-') ? row.date.split('-')[0] : row.date;
      const end = yearsRowRate(row, base, 'end');
      const start = prevEnd != null ? prevEnd : yearsRowStartRate(row, base);
      out[year] = (end && start) ? (end / start - 1) * 100 : null;
      // If this year's close is missing we must NOT carry an older rate forward —
      // that would silently compare across a two-year gap and invent a move.
      prevEnd = end || null;
    }
    return out;
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

  return (
    <div className="mt-2">

      {yearsData.length === 0 ? (
        <div className="bg-yellow-50 p-4 rounded-lg text-yellow-800">
          No data available. Make sure the &quot;Years&quot; sheet is published in your Google Spreadsheet.
        </div>
      ) : (
        <>
          {/* Currency buttons — affects Charts 1 & 2 only; single-select. Kept as buttons on
              phones too (all five fit on one line there), a little taller for the thumb. */}
          <div className="mb-4 flex items-center gap-1">
            <span className="text-xs text-gray-500 mr-1">Currency:</span>
            <span className={SEG}>
            {(['PLN', 'USD', 'EUR', 'CHF', 'SGD'] as const).map(c => (
              <button
                key={c}
                onClick={() => setPortfolioCurrency(c)}
                className={segBtn(portfolioCurrency === c)}
              >{c}</button>
            ))}
            </span>
          </div>

          {/* Chart 1: Portfolio Value by Year — stacked bar chart */}
          {/* Bottom segment (black) = cumulative contributions */}
          {/* Top segment (yellow) = cumulative profit */}
          {(() => {
            // Pre-compute chart data so the custom label renderer can access it by index
            const valueChartData = getPortfolioValueChartData();
            // Phones: a slice thinner than its label (under ~4.5% of the tallest bar, about
            // 12px there) gets no label inside it; the "0.0M"s of the early years otherwise
            // pile on top of each other. The total above every bar stays.
            const minInnerLabel = isPhoneScreen()
              ? 0.045 * Math.max(0, ...valueChartData.map(d => d.contrCumulative + d.profitCumulative))
              : 0;
            return (
              <div className="bg-white p-4 rounded-lg shadow mb-4 phone-bar-labels">
                <h3 className="text-md font-semibold text-gray-700 mb-2">Portfolio Value by Year ({CURRENCY_SYMBOLS[portfolioCurrency]})</h3>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart
                    data={valueChartData}
                    margin={{ top: 30, right: 5, left: 5, bottom: 5 }}
                  >
                    <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                    <YAxis hide domain={[0, 'dataMax + 0.3']} />
                    <Tooltip
                      formatter={(value: number, name: string) => {
                        const label = name === 'contrCumulative' ? 'Contributions' : 'Profit';
                        return [`${value.toFixed(2)}M ${CURRENCY_SYMBOLS[portfolioCurrency]}`, label];
                      }}
                      labelFormatter={(label) => `Year: ${label}`}
                    />
                    {/* Bottom bar: Cumulative Contributions (black) with white label */}
                    <Bar dataKey="contrCumulative" stackId="value" fill={BLACK} name="contrCumulative">
                      <LabelList
                        dataKey="contrCumulative"
                        position="center"
                        formatter={(value: number) => value > 0 && value >= minInnerLabel ? `${barMillions(value)}M` : ''}
                        style={{ fontSize: '13px', fill: ON_BLACK, fontWeight: 600 }}
                      />
                    </Bar>
                    {/* Top bar: Cumulative Profit (yellow) with profit label + total above */}
                    <Bar dataKey="profitCumulative" stackId="value" fill={PROFIT_COLOR} name="profitCumulative">
                      {/* Profit value on the yellow segment */}
                      <LabelList
                        dataKey="profitCumulative"
                        position="center"
                        formatter={(value: number) => value !== 0 && Math.abs(value) >= minInnerLabel ? `${barMillions(value)}M` : ''}
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
                              style={{ fontSize: '13px', fill: INK_SOFT, fontWeight: 700 }}
                            >
                              {barMillions(total)}M
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
            // The FX row under the x-axis: which pair, and its move in each year.
            const fxPair = FX_TICKER_MAP[FX_ROW_BASE[portfolioCurrency] || 'USD'] || '';
            const fxMovesByYear = getFxYearlyMoves();
            // PHONES: the chart fits the screen (no sideways swiping), so each year's bar is
            // only ~25px wide. To fit: the numbers on the bars at 10px ("phone-bar-labels"
            // in globals.css), the total above each bar without the currency (the title has
            // it), every year label shown at 10px, and a slice thinner than its label (under
            // ~4.5% of the tallest bar) gets no number inside it, as in the chart above.
            const phone = isPhoneScreen();
            const minInnerLabel = phone
              ? 0.045 * Math.max(0, ...cpChartData.map(d => Math.abs(d.growthTotal)))
              : 0;
            return (
          <div className="bg-white p-4 rounded-lg shadow mb-4 phone-bar-labels">
            <h3 className="text-md font-semibold text-gray-700 mb-2">Contributions and Profit by Year ({CURRENCY_SYMBOLS[portfolioCurrency]})</h3>
            <ResponsiveContainer width="100%" height={350}>
              <ComposedChart
                data={cpChartData}
                margin={{ top: 30, right: 5, left: 5, bottom: 5 }}
                // Phones: bars only 2px apart (1px each side, instead of 10% of a year's
                // width), so the numbers inside them ("414k") stay within their bar
                barCategoryGap={phone ? 1 : undefined}
              >
                <XAxis dataKey="year" tick={{ fontSize: phone ? 10 : 11 }} interval={phone ? 0 : undefined} />
                <YAxis hide />
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
                        <div style={{ color: entry.profit < 0 ? LOSS : undefined }}>
                          Profit: {Math.round(entry.profit).toLocaleString()} {sym}
                        </div>
                        <div className="font-semibold mt-1">Total: {Math.round(entry.growthTotal).toLocaleString()} {sym}</div>
                      </div>
                    );
                  }}
                />
                {/* Negative profit (yellow) — renders below zero when loss occurs */}
                {/* Must be FIRST in the stack so it extends downward from 0 */}
                <Bar dataKey="profitNegative" stackId="cp" fill={PROFIT_COLOR} name="profitNegative">
                  {/* Loss amount, centred INSIDE the yellow loss bar (below zero) */}
                  <LabelList
                    dataKey="profitNegative"
                    position="center"
                    formatter={(value: number) => {
                      if (!value || value >= 0 || -value < minInnerLabel) return '';
                      const a = Math.abs(value);
                      return a >= 1000 ? `(${(a / 1000).toFixed(0)}k)` : `(${Math.round(a).toLocaleString()})`;
                    }}
                    style={{ fontSize: '14px', fill: LOSS_TOTAL, fontWeight: 700 }}
                  />
                </Bar>
                {/* Transparent spacer = the loss amount. It cancels the negative bar's
                    downward offset so the black "contributions" bar below starts at 0
                    (not below zero) and doesn't cover the yellow loss bar. */}
                <Bar dataKey="lossSpacer" stackId="cp" fill="transparent" legendType="none" isAnimationActive={false} />
                {/* Middle bar: Contributions (black) */}
                <Bar dataKey="contributions" stackId="cp" fill={BLACK} name="contributions">
                  <LabelList
                    dataKey="contributions"
                    position="center"
                    formatter={(value: number) => {
                      if (value === 0 || Math.abs(value) < minInnerLabel) return '';
                      if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(0)}k`;
                      return Math.round(value).toLocaleString();
                    }}
                    style={{ fontSize: '13px', fill: ON_BLACK, fontWeight: 600 }}
                  />
                </Bar>
                {/* Top bar: Positive profit (yellow) — stacked above contributions.
                    It also carries the growth-total label above the whole bar: this bar
                    always sits at the top of the stack (its top edge = contributions +
                    positive profit = the "labelTop"), so a top-positioned label clears the
                    bar in every year, including losses (where its height is 0). */}
                <Bar dataKey="profitPositive" stackId="cp" fill={PROFIT_COLOR} name="profitPositive">
                  <LabelList
                    dataKey="profitPositive"
                    position="center"
                    formatter={(value: number) => {
                      if (value === 0 || value < minInnerLabel) return '';
                      if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
                      return Math.round(value).toLocaleString();
                    }}
                    style={{ fontSize: '15px', fill: '#000', fontWeight: 700 }}
                  />
                  {/* Growth total (contributions + profit) above the bar */}
                  <LabelList
                    dataKey="profitPositive"
                    position="top"
                    content={(props: any) => {
                      const { x, y, width, index } = props as { x: number; y: number; width: number; index: number };
                      const entry = cpChartData[index];
                      if (!entry || typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number') return null;
                      const sym = CURRENCY_SYMBOLS[portfolioCurrency];
                      const v = entry.growthTotal;
                      const unit = phone ? '' : ` ${sym}`;
                      const label = Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k${unit}` : `${Math.round(v).toLocaleString()}${unit}`;
                      return (
                        <text x={x + width / 2} y={y - 10} textAnchor="middle" style={{ fontSize: '13px', fill: INK_SOFT, fontWeight: 700 }}>
                          {label}
                        </text>
                      );
                    }}
                  />
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
            {/* --- Exchange-rate move for each year, printed under the year labels --- */}
            {/* WHY IT LINES UP: the chart hides its Y axis and uses a 5px margin on each
                side, so the plotting area is the full card width inset by 5px, split into
                one equal-width band per year. A flex row with the same 5px padding and one
                equal-width (flex-1) cell per year therefore centres each percentage on the
                exact same x as the bar and its year label above it. */}
            {cpChartData.length > 0 && (
            <div className="mt-0.5">
              <div className="text-[10px] leading-none text-gray-400 mb-1 pl-1">{fxPair}{phone ? ' %' : ''}</div>
              <div className="flex" style={{ paddingLeft: 5, paddingRight: 5 }}>
                {cpChartData.map(d => {
                  const pct = fxMovesByYear[d.year];
                  // Green when the pair rose, red when it fell, gray for a missing rate.
                  const cls = pct == null ? 'text-gray-400' : pct >= 0 ? 'text-green-700' : 'text-red-600';
                  return (
                    <div
                      key={d.year}
                      className={`flex-1 min-w-0 text-center text-[11px] max-md:text-[10px] font-semibold tabular-nums ${cls}`}
                      title={pct == null ? `${fxPair} rate not available for ${d.year}` : `${fxPair} ${pct >= 0 ? 'rose' : 'fell'} ${Math.abs(pct).toFixed(1)}% during ${d.year} (year-end vs previous year-end)`}
                    >
                      {/* Phones: whole percents without the sign ("−16", the "%" is in the row's
                          label), as "−16.1%" is wider than a year's column */}
                      {pct == null ? '—' : `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(phone ? 0 : 1)}${phone ? '' : '%'}`}
                    </div>
                  );
                })}
              </div>
            </div>
            )}
          </div>
            );
          })()}

          {/* === Profit Breakdown by Asset (single year, with year dropdown) === */}
          {/* A transparent worksheet: each asset is split into segments (held from */}
          {/* start, sold, bought this year, income) showing quantity, start price, */}
          {/* end price and profit. Prices are native; the last column converts to the */}
          {/* selected currency (the gap = FX effect). "Other" = unpriced/guarded */}
          {/* assets + cash/fees, so the Total always matches the chart's bar. */}
          {(() => {
            // Selectable years + the resolved selection and the (memoised) breakdown are
            // computed at the top of the component; this block just renders them.
            const allYears = breakdownYears;
            const selectedYear = resolvedBreakdownYear;
            if (allYears.length === 0 || selectedYear == null) return null;

            const sym = CURRENCY_SYMBOLS[portfolioCurrency];
            const { assets, other, total } = breakdownData;

            // --- Formatting helpers ---
            const nativeSym = (ccy: string) => CURRENCY_SYMBOLS[ccy] || ccy;
            const fmtC = (v: number) => `${v < 0 ? '−' : ''}${Math.round(Math.abs(v)).toLocaleString()} ${sym}`;
            const fmtN = (v: number, ccy: string) => `${v < 0 ? '−' : ''}${Math.round(Math.abs(v)).toLocaleString()} ${nativeSym(ccy)}`;
            const fmtPrice = (p: number) =>
              p >= 1000 ? p.toLocaleString(undefined, { maximumFractionDigits: 0 })
                : p >= 1 ? p.toFixed(2) : p.toFixed(4);
            const fmtQty = (q: number) =>
              q >= 1000 ? q.toLocaleString(undefined, { maximumFractionDigits: 0 })
                : q >= 1 ? q.toLocaleString(undefined, { maximumFractionDigits: 2 })
                  : q.toLocaleString(undefined, { maximumFractionDigits: 4 });
            const pctStr = (p: number | null) => (p == null ? '' : `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%`);
            const share = (v: number) => (Math.abs(total) > 0.5 ? `${(v / total * 100).toFixed(1)}%` : '—');
            const colorOf = (v: number) => (v > 0.5 ? 'text-green-700' : v < -0.5 ? 'text-red-600' : 'text-gray-400');
            const fxAll = assets.reduce((s, a) => s + a.totalFx, 0);

            // Whole-portfolio currency effect for the year (accurate; includes the unpriced
            // holdings): total profit − what that profit would be with the exchange rate frozen
            // at the start of the year. In PLN it's 0 (base currency). Cheap: just reuses the
            // yearly totals. "ex-FX profit" (what you made from the assets, not the currency)
            // is then total − currencyEffect.
            const totalPln = getYearlyValueSeries('PLN').find(s => s.year === `${selectedYear}`)?.profit ?? 0;
            const prevYrRow = yearsData.find(r => r.date.startsWith(`${selectedYear - 1}`))
              || yearsData.find(r => r.date.startsWith(`${selectedYear}`)) || null;
            const startCtoPln = portfolioCurrency === 'PLN'
              ? 1
              : (prevYrRow ? yearsRowRate(prevYrRow, portfolioCurrency, 'end') : 0);
            const currencyEffect = (portfolioCurrency === 'PLN' || !startCtoPln)
              ? 0
              : total - totalPln / startCtoPln;

            // How each currency the portfolio held moved against the SELECTED currency this
            // year — the driver behind the FX total. A positive % means the selected currency
            // weakened against that one (so foreign holdings gained from FX). Rates come from
            // the Years sheet (period-end snapshots); the year's start = the prior year-end.
            const fxMoves = (() => {
              const yr = yearsData.find(r => r.date.startsWith(`${selectedYear}`)) || null;
              const prevYr = yearsData.find(r => r.date.startsWith(`${selectedYear - 1}`)) || null;
              if (!yr) return [] as { ccy: string; pct: number }[];
              const endToPln = (row: YearsRow, ccy: string): number => yearsRowRate(row, ccy, 'end');
              // Start-of-year rate: only used for the very first year (otherwise we use the
              // prior year-end). If the sheet has no opening rate for a currency we fall back
              // to that year's close, which reports a 0% move rather than inventing one.
              const startToPln = (row: YearsRow, ccy: string): number =>
                yearsRowStartRate(row, ccy) || endToPln(row, ccy);
              // Every currency that contributed this year (asset natives), plus PLN (the base of
              // "Other"), minus the currency we're already displaying in.
              const ccys = Array.from(new Set([...assets.map(a => a.nativeCurrency), 'PLN'])).filter(c => c !== portfolioCurrency);
              const out: { ccy: string; pct: number }[] = [];
              for (const c of ccys) {
                const endC = endToPln(yr, c), endD = endToPln(yr, portfolioCurrency);
                const startC = prevYr ? endToPln(prevYr, c) : startToPln(yr, c);
                const startD = prevYr ? endToPln(prevYr, portfolioCurrency) : startToPln(yr, portfolioCurrency);
                if (!endC || !endD || !startC || !startD) continue;
                const endRate = endC / endD;     // units of `c` per selected currency, year-end
                const startRate = startC / startD; // ... at year start
                if (!startRate) continue;
                out.push({ ccy: c, pct: (endRate / startRate - 1) * 100 });
              }
              return out.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
            })();

            // A profit cell = big amount + small % return underneath (in the cell's colour).
            const profitCell = (amount: number, pct: number | null, isNative: boolean, ccy: string, bold?: boolean) => (
              <td className={`py-1.5 px-2 text-right tabular-nums ${bold ? 'font-semibold' : ''} ${colorOf(amount)}`}>
                <div>{isNative ? fmtN(amount, ccy) : fmtC(amount)}</div>
                {pct != null && <div style={{ fontSize: '10px' }} className="opacity-70">{pctStr(pct)}</div>}
              </td>
            );
            // An FX-effect cell (always in the selected currency; blank for same-currency assets).
            const fxCell = (v: number, bold?: boolean) => (
              <td className={`py-1.5 px-2 text-right tabular-nums ${bold ? 'font-semibold' : ''}`}>
                {Math.abs(v) < 0.5 ? <span className="text-gray-300">—</span> : <span className={colorOf(v)}>{fmtC(v)}</span>}
              </td>
            );
            // A price cell = the per-share price on top, and below it the position's
            // VALUE at that moment (shares × price, or the cash cost/proceeds). The
            // end value minus the start value equals Profit (native).
            const priceCell = (price: number | null, tag: string, value: number | null, ccy: string) => (
              <td className="py-1.5 px-2 text-right tabular-nums text-gray-700">
                {price != null && (<div>{fmtPrice(price)}<span className="text-gray-400 ml-1" style={{ fontSize: '10px' }}>{tag}</span></div>)}
                {value != null && (<div className="text-gray-400" style={{ fontSize: '10px' }}>{fmtN(value, ccy)}</div>)}
                {price == null && value == null && '—'}
              </td>
            );

            return (
              <div className="bg-white p-4 rounded-lg shadow mb-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <h3 className="text-md font-semibold text-gray-700">
                    Profit Breakdown by Asset — {selectedYear}
                  </h3>
                  <div className="flex items-center gap-2">
                    {/* The year only steers the table, so it is pointless while the
                        table is hidden — it reappears with the rest of the section. */}
                    {breakdownExpanded && (
                      <>
                        <label className="text-xs text-gray-500">Year</label>
                        <select
                          value={selectedYear}
                          onChange={(e) => setBreakdownYear(parseInt(e.target.value, 10))}
                          className={FIELD}
                        >
                          {allYears.map(y => (
                            <option key={y} value={y}>{y}</option>
                          ))}
                        </select>
                      </>
                    )}
                    <button
                      onClick={() => setBreakdownExpanded(v => !v)}
                      className={BTN_SECOND}
                    >
                      {breakdownExpanded ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
                {breakdownExpanded && (<>
                <p className="text-xs text-gray-400 mb-3">
                  Each shaded row is a whole asset (with a <b>Total</b> when it has several parts); the white
                  rows below break it down. Prices are in the asset&apos;s own currency, with the position&apos;s
                  <b> value</b> shown underneath — end value − start value = <b>Profit (native)</b>; the small %
                  is the return on that capital. <b>FX effect</b> is the part of the {portfolioCurrency} profit
                  from the exchange rate moving; <b>Profit ({sym})</b> is the bottom line, and <b>Share</b> = % of
                  the year. Total profit is the change in portfolio value minus contributions (matching the
                  chart above), and &quot;Other&quot; (unpriced assets, cash, fees) is whatever the itemised
                  assets don&apos;t explain.
                </p>

                {/* === Profit by asset — the table below, drawn === */}
                {/* Same numbers as the Profit ({sym}) column, one bar per asset plus the
                    same "Other" residual, so the bars reconcile to the Total profit row.
                    Sorted biggest gain at the top down to biggest loss at the bottom, which
                    puts the outliers you are looking for at the two ends and leaves the
                    zero line sitting naturally between the winners and the losers. */}
                {(() => {
                  const barRows = [
                    ...assets.map(a => ({ label: a.name, ticker: a.ticker, profit: a.totalConverted, isOther: false })),
                    // "Other" is in the table unconditionally, so it is here too — leaving
                    // it out would quietly stop the bars adding up to the Total. It is
                    // flagged rather than detected by its blank ticker, so the black fill
                    // below keys off something explicit.
                    { label: 'Other', ticker: '', profit: other, isOther: true },
                  ].sort((x, y) => y.profit - x.profit);

                  // Compact axis/label numbers: 12,345 becomes 12k. Twenty bars each
                  // carrying a full "12,345 zł" is unreadable, and the axis already says
                  // which currency this is.
                  const compact = (v: number) => {
                    const a = Math.abs(v);
                    const body = a >= 10000 ? `${Math.round(a / 1000)}k`
                      : a >= 1000 ? `${(a / 1000).toFixed(1)}k`
                        : `${Math.round(a)}`;
                    return `${v < 0 ? '−' : ''}${body}`;
                  };

                  // Leave a margin of empty scale at both ends so the longest bar stops short
                  // of the plot edge. Without it the biggest loss runs right up to the asset
                  // names and its value label, which hangs off the outer end, has nowhere to
                  // go but on top of them.
                  const maxV = Math.max(0, ...barRows.map(r => r.profit));
                  const minV = Math.min(0, ...barRows.map(r => r.profit));
                  const span = (maxV - minV) || 1;
                  const xDomain: [number, number] = [minV - span * 0.08, maxV + span * 0.08];

                  // Row pitch and bar thickness go together: 28px of row carrying an 18px
                  // bar leaves 10px of air, which is the gap that separates neighbours —
                  // bars are never allowed to fill their slot.
                  const chartHeight = Math.max(180, barRows.length * 28 + 40);

                  // The bar shape itself is DivergingBar, at module scope — see the note
                  // there about Recharts' negative widths before changing anything.

                  return (
                    <div className="mb-4">
                      <div className="text-xs text-gray-500 mb-1">Profit by asset ({sym})</div>
                      <ResponsiveContainer width="100%" height={chartHeight}>
                        <BarChart
                          layout="vertical"
                          data={barRows}
                          // Right margin is the runway the value label needs outside the
                          // longest gain bar; at 12px type a "−5.7k" wants about 60px.
                          margin={{ top: 5, right: 62, left: 5, bottom: 5 }}
                        >
                          {/* The axis is hidden rather than styled down: every bar already
                              carries its value, so a scale underneath would be a second way
                              to read the same number — and it was drawing the heavy rule
                              along the bottom. The chart keeps the number axis for its
                              scale, it just does not paint it. */}
                          <XAxis type="number" hide domain={xDomain} />
                          {/* No axis rule and no tick marks: the names are the labels, the
                              line beside them was pure chrome. interval={0} forces every
                              asset's name to be drawn — Recharts drops labels to avoid
                              crowding otherwise, and a bar with no name is useless here. */}
                          <YAxis
                            type="category"
                            dataKey="label"
                            width={140}
                            interval={0}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 12, fill: MUTED }}
                          />
                          <Tooltip
                            cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                            content={({ active, payload }) => {
                              if (!active || !payload || !payload.length) return null;
                              const d = payload[0].payload as { label: string; ticker: string; profit: number };
                              return (
                                <div className="bg-white border border-gray-200 rounded shadow px-3 py-2 text-xs">
                                  <div className="font-semibold mb-0.5">
                                    {d.label}{d.ticker ? <span className="font-normal text-gray-400"> ({d.ticker})</span> : null}
                                  </div>
                                  <div className={colorOf(d.profit)}>{fmtC(d.profit)}</div>
                                  <div className="text-gray-400">{share(d.profit)} of the year</div>
                                </div>
                              );
                            }}
                          />
                          {/* With the axes gone this hairline is the only chrome left, and
                              the one piece that earns its place: it is the baseline every
                              bar is measured from. One shade off the surface, solid. */}
                          <ReferenceLine x={0} stroke={LINE} strokeWidth={1} />
                          <Bar dataKey="profit" isAnimationActive={false} barSize={18} shape={<DivergingBar />}>
                            {barRows.map(r => (
                              // "Other" is black, not green or red: it is the residual — cash,
                              // fees and anything without a price — rather than a position that
                              // did well or badly, so it should not read as a winner or a loser
                              // sitting among them.
                              <Cell key={r.ticker || r.label} fill={r.isOther ? BLACK : r.profit >= 0 ? GAIN : LOSS} />
                            ))}
                            {/* Sign-aware label placement. Recharts gives the bar's LEFT
                                edge as x with a positive width either way, so for a loss
                                the end of the bar is x, not x+width — using position="right"
                                would stack every loss label on top of the zero line. */}
                            <LabelList
                              dataKey="profit"
                              content={(props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: number | string }) => {
                                const x = Number(props.x ?? 0), y = Number(props.y ?? 0);
                                const w = Number(props.width ?? 0), h = Number(props.height ?? 0);
                                const v = Number(props.value ?? 0);
                                if (!isFinite(v) || Math.abs(v) < 0.5) return null;
                                const positive = v >= 0;
                                // Recharts anchors a LOSS bar at the zero line and gives it a
                                // NEGATIVE width, so `x` is the zero end, not the far end.
                                // Offsetting from x therefore printed every loss amount on top
                                // of its own red bar — grey text on red, unreadable. Work out
                                // the two edges explicitly and hang the label off the data end.
                                const left = Math.min(x, x + w);
                                const right = Math.max(x, x + w);
                                // Phones: the plot is only ~100px wide there, so a label
                                // hung off the left end of a loss bar lands on the asset's
                                // name. It goes just right of the zero line instead (the
                                // loss bar's right edge), beside its own red bar.
                                const outside = positive || !isPhoneScreen();
                                return (
                                  <text
                                    x={outside ? (positive ? right + 4 : left - 4) : right + 4}
                                    y={y + h / 2}
                                    dy={3}
                                    textAnchor={outside ? (positive ? 'start' : 'end') : 'start'}
                                    // Muted ink, not the bar's green or red. The coloured bar
                                    // right beside the number already says which way it went;
                                    // colouring the text too doubles the ink for no extra
                                    // information and makes nineteen rows shout at once.
                                    style={{ fontSize: 12, fill: MUTED }}
                                  >
                                    {compact(v)}
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

                {/* Phones: the bottom line only, in four columns that fit without swiping:
                    one row per asset (its total), then Other and the year's total. The full
                    table below (segments, quantities, prices, native profit) is desktop only. */}
                <table className="hidden max-md:table w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-200">
                      <th className="text-left font-medium py-2 pr-2">Asset</th>
                      <th className="text-right font-medium py-2 px-1">FX ({sym})</th>
                      <th className="text-right font-medium py-2 px-1">Profit ({sym})</th>
                      <th className="text-right font-medium py-2 pl-1">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map(a => (
                      <tr key={a.ticker} className="border-t border-gray-200">
                        <td className="py-1.5 pr-2 align-top">
                          <div className="font-semibold text-gray-800">{a.name}</div>
                          <div className="text-gray-400">{a.ticker} · {a.nativeCurrency}</div>
                        </td>
                        {fxCell(a.totalFx)}
                        {profitCell(a.totalConverted, a.retConverted, false, a.nativeCurrency, true)}
                        <td className="py-1.5 pl-1 text-right tabular-nums text-gray-600 font-medium">{share(a.totalConverted)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-gray-200">
                      <td className="py-1.5 pr-2 italic text-gray-500">Other</td>
                      <td className="py-1.5 px-2 text-right text-gray-300">—</td>
                      <td className={`py-1.5 px-2 text-right tabular-nums font-medium ${colorOf(other)}`}>{fmtC(other)}</td>
                      <td className="py-1.5 pl-1 text-right tabular-nums text-gray-500">{share(other)}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300">
                      <td className="py-2 pr-2 font-bold text-gray-800">Total {selectedYear}</td>
                      {fxCell(fxAll, true)}
                      <td className={`py-2 px-2 text-right tabular-nums font-bold ${colorOf(total)}`}>{fmtC(total)}</td>
                      <td className="py-2 pl-1 text-right text-gray-500">100%</td>
                    </tr>
                  </tfoot>
                </table>
                <div className="overflow-x-auto max-md:hidden">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-200">
                        <th className="text-left font-medium py-2 pr-3">Asset</th>
                        <th className="text-left font-medium py-2 px-2">Segment</th>
                        <th className="text-right font-medium py-2 px-2">Qty</th>
                        <th className="text-right font-medium py-2 px-2">Start price</th>
                        <th className="text-right font-medium py-2 px-2">End price</th>
                        <th className="text-right font-medium py-2 px-2">Profit (native)</th>
                        <th className="text-right font-medium py-2 px-2">FX effect ({sym})</th>
                        <th className="text-right font-medium py-2 px-2">Profit ({sym})</th>
                        <th className="text-right font-medium py-2 pl-2">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assets.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-3 text-center text-gray-400">
                            No priced-asset activity in {selectedYear}.
                          </td>
                        </tr>
                      ) : assets.flatMap(a => {
                        const multi = a.segments.length > 1;
                        const trs: JSX.Element[] = [];
                        // Whole-asset row is always styled prominently (shaded); the
                        // white rows below it are only the breakdown of the total above.
                        trs.push(
                          <tr key={`${a.ticker}-tot`} className="border-t border-gray-300 bg-gray-50">
                            <td className="py-2 pr-3 align-top">
                              <div className="font-semibold text-gray-800">{a.name}</div>
                              <div className="text-gray-400">{a.ticker} · {a.nativeCurrency}</div>
                            </td>
                            {multi ? (
                              <>
                                <td className="py-2 px-2 font-semibold text-gray-600">Total</td>
                                <td />
                                {priceCell(null, '', a.startValue, a.nativeCurrency)}
                                {priceCell(null, '', a.endValue, a.nativeCurrency)}
                                {profitCell(a.totalNative, a.retNative, true, a.nativeCurrency, true)}
                                {fxCell(a.totalFx, true)}
                                {profitCell(a.totalConverted, a.retConverted, false, a.nativeCurrency, true)}
                                <td className="py-2 pl-2 text-right tabular-nums text-gray-600 font-medium">{share(a.totalConverted)}</td>
                              </>
                            ) : (
                              <>
                                <td className="py-2 px-2 text-gray-600 font-medium">{a.segments[0].label}</td>
                                <td className="py-2 px-2 text-right tabular-nums text-gray-700">{a.segments[0].shares == null ? '—' : fmtQty(a.segments[0].shares)}</td>
                                {priceCell(a.segments[0].startPrice, a.segments[0].startTag, a.segments[0].startValue, a.nativeCurrency)}
                                {priceCell(a.segments[0].endPrice, a.segments[0].endTag, a.segments[0].endValue, a.nativeCurrency)}
                                {profitCell(a.segments[0].profitNative, a.segments[0].retNative, true, a.nativeCurrency, true)}
                                {fxCell(a.segments[0].fxEffect, true)}
                                {profitCell(a.segments[0].profitConverted, a.segments[0].retConverted, false, a.nativeCurrency, true)}
                                <td className="py-2 pl-2 text-right tabular-nums text-gray-600 font-medium">{share(a.totalConverted)}</td>
                              </>
                            )}
                          </tr>
                        );
                        if (multi) {
                          a.segments.forEach((s, i) => trs.push(
                            <tr key={`${a.ticker}-${i}`} className="hover:bg-gray-50">
                              <td className="py-1.5 pr-3" />
                              <td className="py-1.5 px-2 pl-4 text-gray-500">{s.label}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-gray-700">{s.shares == null ? '—' : fmtQty(s.shares)}</td>
                              {priceCell(s.startPrice, s.startTag, s.startValue, a.nativeCurrency)}
                              {priceCell(s.endPrice, s.endTag, s.endValue, a.nativeCurrency)}
                              {profitCell(s.profitNative, s.retNative, true, a.nativeCurrency)}
                              {fxCell(s.fxEffect)}
                              {profitCell(s.profitConverted, s.retConverted, false, a.nativeCurrency)}
                              <td className="py-1.5 pl-2 text-right tabular-nums text-gray-400">{share(s.profitConverted)}</td>
                            </tr>
                          ));
                        }
                        return trs;
                      })}
                      {/* Other = residual so the table reconciles to the chart's bar */}
                      <tr className="bg-gray-50/60 border-t border-gray-200">
                        <td className="py-2 pr-3 italic text-gray-500">Other</td>
                        <td className="py-2 px-2 text-gray-400" colSpan={4}>cash, fees, assets not in the price feed</td>
                        <td className="py-2 px-2 text-right text-gray-300">—</td>
                        <td className="py-2 px-2 text-right text-gray-300">—</td>
                        <td className={`py-2 px-2 text-right tabular-nums font-medium ${colorOf(other)}`}>{fmtC(other)}</td>
                        <td className="py-2 pl-2 text-right tabular-nums text-gray-500">{share(other)}</td>
                      </tr>
                    </tbody>
                    <tfoot>
                      {/* Per-currency FX move this year — the driver behind the FX total below */}
                      {fxMoves.length > 0 && (
                        <tr className="border-t-2 border-gray-300">
                          <td className="pt-2 pr-2 text-right align-top text-gray-400" colSpan={6} style={{ fontSize: '11px' }}>
                            FX move vs {portfolioCurrency} this year:
                          </td>
                          <td className="pt-2 px-2 align-top" colSpan={3} style={{ fontSize: '11px' }}>
                            {fxMoves.map(m => (
                              <span
                                key={m.ccy}
                                className={`inline-block mr-3 tabular-nums ${m.pct > 0.05 ? 'text-green-700' : m.pct < -0.05 ? 'text-red-600' : 'text-gray-400'}`}
                                title={m.pct >= 0 ? `${portfolioCurrency} weakened vs ${m.ccy}` : `${portfolioCurrency} strengthened vs ${m.ccy}`}
                              >
                                {m.ccy}/{portfolioCurrency} {m.pct >= 0 ? '+' : '−'}{Math.abs(m.pct).toFixed(1)}%
                              </span>
                            ))}
                          </td>
                        </tr>
                      )}
                      <tr className={fxMoves.length > 0 ? 'border-t border-gray-200' : 'border-t-2 border-gray-300'}>
                        <td className="py-2 pr-3 font-bold text-gray-800" colSpan={5}>Total profit {selectedYear}</td>
                        <td className="py-2 px-2 text-right text-gray-300">—</td>
                        {fxCell(fxAll, true)}
                        <td className={`py-2 px-2 text-right tabular-nums font-bold ${colorOf(total)}`}>{fmtC(total)}</td>
                        <td className="py-2 pl-2 text-right text-gray-500">100%</td>
                      </tr>
                      {/* Whole-portfolio currency effect (incl. unpriced holdings), measured vs PLN.
                          Only shown in non-PLN views (in PLN it's 0). It's a different lens than the
                          per-asset FX-effect column, so it's a standalone note. */}
                      {portfolioCurrency !== 'PLN' && Math.abs(currencyEffect) > 0.5 && (
                        <tr>
                          <td className="pt-1 pr-2 text-right align-top text-gray-400" colSpan={5} style={{ fontSize: '11px' }}>
                            of which currency effect (whole portfolio vs PLN):
                          </td>
                          <td className="pt-1 px-2" colSpan={4} style={{ fontSize: '11px' }}>
                            <span className={`tabular-nums ${colorOf(currencyEffect)}`}>{fmtC(currencyEffect)}</span>
                            <span className="text-gray-400"> → ex-FX profit </span>
                            <span className={`tabular-nums ${colorOf(total - currencyEffect)}`}>{fmtC(total - currencyEffect)}</span>
                          </td>
                        </tr>
                      )}
                    </tfoot>
                  </table>
                </div>
                </>)}
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
              const years = yearsBetween(prices[0].date, prices[prices.length - 1].date);

              // CAGR, monthly volatility and Sharpe, all from lib/stats (as on the Backtest
              // tab). Under a year: CAGR is the plain total return and Sharpe is a dash.
              const cagr = cagrPct(startValue, endValue, years);
              const volatility = annualisedVolPct(periodReturns(prices.map(p => p.value)), 12);
              const sharpe = sharpeFor(cagr, volatility, years);

              // Drawdowns: the deepest, the longest run of months underwater, and today's
              const drawdowns = drawdownsPct(prices.map(p => p.value));
              const maxDD = maxDrawdownPct(drawdowns);
              const longestDDMonths = longestUnderwater(drawdowns);
              const currDD = drawdowns[drawdowns.length - 1];

              // CPI Inflation: total return and CAGR over the same period (the CAGR follows
              // the same under-a-year rule, so Real CAGR compares like with like)
              let cumInflation = 0;
              let annInflation = 0;
              const startCpi = Number(filteredRows[0][ps.cpiTicker]);
              const endCpi = Number(filteredRows[filteredRows.length - 1][ps.cpiTicker]);
              if (startCpi > 0 && endCpi > 0) {
                cumInflation = ((endCpi - startCpi) / startCpi) * 100;
                annInflation = cagrPct(startCpi, endCpi, years);
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
                sharpe: sharpe === null ? '—' : sharpe.toFixed(2),
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
                {/* Phones: one small card per portfolio with its figures in two columns, in
                    place of the 11-column table (desktop only), which needed a sideways swipe */}
                <div className="hidden max-md:grid gap-2">
                  {statsRows.map((row: any, idx: number) => {
                    const sign = (v: string) => (Number(v) >= 0 ? 'text-green-600' : 'text-red-600');
                    const cells: [string, string, string][] = [
                      ['Return', `${row.totalReturn}%`, sign(row.totalReturn)],
                      ['Cum Inflation', `${row.cumInflation}%`, 'text-amber-600'],
                      ['CAGR', `${row.cagr}%`, sign(row.cagr)],
                      ['Ann. Inflation', `${row.annInflation}%`, 'text-amber-600'],
                      ['Real CAGR', `${row.realCagr}%`, sign(row.realCagr)],
                      ['Vol', `${row.volatility}%`, 'text-gray-700'],
                      ['Sharpe', row.sharpe, 'text-gray-700'],
                      ['Max DD', `${row.maxDD}%`, 'text-red-600'],
                      ['Longest DD', row.longestDD, 'text-purple-700'],
                      ['Curr DD', `${row.currDD}%`, 'text-orange-600'],
                    ];
                    return (
                      <div key={idx} className="rounded-lg border border-gray-200 px-3 py-2">
                        <div className="text-sm font-semibold text-gray-700 mb-1">{row.label}</div>
                        <div className="grid grid-cols-2 gap-x-5 gap-y-0.5 text-xs">
                          {cells.map(([label, value, colour]) => (
                            <div key={label} className="flex items-baseline justify-between gap-2">
                              <span className="text-gray-500">{label}</span>
                              <span className={`font-medium tabular-nums ${colour}`}>{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <table className="w-full text-xs max-md:hidden">
                  <thead>
                    <tr className="border-b-2 border-gray-200">
                      <th className="text-left py-2 px-2">Portfolio</th>
                      <th className="text-right py-2 px-2">Return</th>
                      <th className="text-right py-2 px-2">Cum Inflation</th>
                      <th className="text-right py-2 px-2 cursor-help" title={CAGR_HINT}>CAGR</th>
                      <th className="text-right py-2 px-2">Ann. Inflation</th>
                      <th className="text-right py-2 px-2">Real CAGR</th>
                      <th className="text-right py-2 px-2">Vol</th>
                      <th className="text-right py-2 px-2 cursor-help" title={SHARPE_HINT}>Sharpe</th>
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

          {/* ============================================ */}
          {/* DAILY NAV SECTION                            */}
          {/* Line chart: NAV vs Inflation, both indexed   */}
          {/* to 100 at period start. Currency + period    */}
          {/* selectors. Stats overlay top-left.           */}
          {/* ============================================ */}
          {dailyData.length > 0 && (() => {
            // ---- 1. Filter data to selected period ----
            const today = new Date();
            const cutoff = dailyNavPeriod === '1Y' ? new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())
                         : dailyNavPeriod === '3Y' ? new Date(today.getFullYear() - 3, today.getMonth(), today.getDate())
                         : dailyNavPeriod === '5Y' ? new Date(today.getFullYear() - 5, today.getMonth(), today.getDate())
                         : new Date('1900-01-01');
            const cutoffStr = cutoff.toISOString().split('T')[0];
            // ---- 2. Pick the NAV column for the selected currency ----
            const navKey  = dailyNavCurrency === 'PLN' ? 'navPln'  : dailyNavCurrency === 'USD' ? 'navUsd'  : dailyNavCurrency === 'CHF' ? 'navChf' : 'navSgd';

            // Days with no NAV in this currency are left out (only CHF has any: days where
            // the sheet's CHFPLN rate is blank). PLN/USD/SGD have a value every day, so for
            // them this keeps every row, exactly as before.
            const periodData = dailyData.filter(r => r.date >= cutoffStr && (r[navKey] as number) > 0);
            if (periodData.length < 2) return null;

            // ---- 2b. Inflation comes from the MONTHLY CPI series, not the Daily sheet ----
            // The Daily sheet carries its own InflPLN/InflUSD/InflSGD columns, but the rest
            // of the app (the Monthly tab's real-return view, the portfolio CPI adjustment)
            // measures inflation from the CPIMPL / CPIMUS / CPIMSG columns of the monthly
            // price sheet. Two sources for one quantity means two answers to the same
            // question — they disagree by up to 0.7pp a year on the 5Y window — so this
            // chart now reads the same monthly series as everything else.
            //
            // A CPI print is a monthly number, so there is nothing to interpolate: each
            // daily point takes the most recent print on or before its date and holds it
            // flat until the next one, which draws inflation as the staircase it actually
            // is. Both lists are already in date order, so one walk down each is enough —
            // no repeated searching per day.
            // CHF reads the Swiss CPI (CPIMCH) here. It is kept out of the shared
            // CURRENCY_CPI map on purpose, so no other tab's behaviour changes.
            const cpiTicker = (dailyNavCurrency === 'CHF' ? 'CPIMCH' : CURRENCY_CPI[dailyNavCurrency]) || '';
            const cpiSeries = cpiTicker && assetData
              ? assetData
                  .filter(r => Number(r[cpiTicker]) > 0)
                  .map(r => ({ date: r.date as string, cpi: Number(r[cpiTicker]) }))
              : [];
            const cpiPerDay: (number | null)[] = [];
            let cpiIdx = -1;   // index of the newest print at or before the current day
            for (const r of periodData) {
              while (cpiIdx + 1 < cpiSeries.length && cpiSeries[cpiIdx + 1].date <= r.date) cpiIdx++;
              cpiPerDay.push(cpiIdx >= 0 ? cpiSeries[cpiIdx].cpi : null);
            }

            const firstNAV  = periodData[0][navKey] as number;
            const firstInfl = cpiPerDay[0];
            if (!firstNAV || !firstInfl) return null;

            // ---- 2c. Benchmark (optional) — built from MONTH-END prices ----
            // The benchmark ETFs only have month-end prices, so the line is drawn through
            // month-end points. It starts at 100 on the period's first day, using the last
            // month-end price on or before that day; each later month-end is placed on the
            // last day of the daily series that falls on or before it (for the month in
            // progress, that is simply the latest day).
            //
            // Every price is first converted into the chosen currency at that month-end's
            // FX rate, then the month's return is the weighted average of the components'
            // returns — which is exactly what rebalancing back to the weights each month-end
            // means.
            const benchDef = DAILY_NAV_BENCHMARKS.find(b => b.id === dailyNavBenchmark);
            const BENCH_COLOR = CHART_PALETTE.teal;   // distinct from the slate NAV and terracotta inflation lines
            const benchPerDay: (number | null)[] = periodData.map(() => null);
            const benchMonthly: number[] = [];       // index level at each month-end point used
            const benchMonthReturns: number[] = [];  // the monthly returns between them
            if (benchDef && assetData) {
              // Month rows where every component has a price
              const months = assetData.filter(r => benchDef.mix.every(([t]) => Number(r[t]) > 0));
              const startDate = periodData[0].date;
              let anchor = -1;   // last month-end on or before the period start
              for (let m = 0; m < months.length && (months[m].date as string) <= startDate; m++) anchor = m;
              if (anchor >= 0) {
                // Each component's native currency, looked up once rather than every month
                const nativeCcy: Record<string, string> = Object.fromEntries(benchDef.mix.map(([t]) => [t, getAssetCurrency(t)]));
                // Component prices in the chosen currency for month m
                const priceIn = (m: number, t: string) =>
                  Number(months[m][t]) * getConversionRate(months[m], nativeCcy[t], dailyNavCurrency);
                let level = 100;
                benchPerDay[0] = level;
                benchMonthly.push(level);
                let dayIdx = 0;
                for (let m = anchor + 1; m < months.length; m++) {
                  const monthDate = months[m].date as string;
                  // Last daily row on or before this month-end
                  while (dayIdx + 1 < periodData.length && periodData[dayIdx + 1].date <= monthDate) dayIdx++;
                  const ret = benchDef.mix.reduce((s, [t, w]) => s + w * (priceIn(m, t) / priceIn(m - 1, t) - 1), 0);
                  level *= 1 + ret;
                  benchMonthly.push(level);
                  benchMonthReturns.push(ret);
                  // Day 0 already holds the starting 100; a month-end that lands there
                  // still compounds into the level, it just isn't drawn as its own point.
                  if (dayIdx > 0) benchPerDay[dayIdx] = level;
                  // A month-end beyond the last daily row has nowhere further right to go
                  if (dayIdx === periodData.length - 1) break;
                }
              }
            }

            // ---- 3. Index both series to 100 at period start ----
            // cpiPerDay is only null before the very first CPI print, which the guard above
            // has already ruled out for day one — and the pointer only ever moves forward,
            // so every later day has a reading too.
            const chartData = periodData.map((r, i) => ({
              date:    r.date,
              nav:     ((r[navKey] as number)   / firstNAV)  * 100,
              infl:    ((cpiPerDay[i] as number) / firstInfl) * 100,
              rawNav:  r[navKey] as number,
              rawInfl: cpiPerDay[i] as number,
              bench:   benchPerDay[i],   // null except on month-end points (and day one)
            }));

            const lastRow = chartData[chartData.length - 1];
            const years = yearsBetween(chartData[0].date, lastRow.date);
            // Under a year nothing is annualised: the CAGR rows show plain returns, are
            // labelled that way below, and Sharpe is a dash (lib/stats).
            const annualised = isAnnualisable(years);

            // ---- 4. Statistics ----
            const nominalCAGR  = cagrPct(100, lastRow.nav, years);
            const annInflation = cagrPct(100, lastRow.infl, years);
            const realCAGR     = ((1 + nominalCAGR / 100) / (1 + annInflation / 100) - 1) * 100;

            // Annualised volatility from daily returns (× sqrt(252))
            const annVol     = annualisedVolPct(periodReturns(chartData.map(r => r.nav)), 252);
            const sharpe     = sharpeFor(nominalCAGR, annVol, years);

            // Drawdown stats on raw NAV values (not indexed — same result, just clearer intent).
            // Longest DD here counts trading days, since the points are daily.
            const navDrawdowns = drawdownsPct(periodData.map(r => r[navKey] as number));
            const maxDD = maxDrawdownPct(navDrawdowns);
            const longestDD = longestUnderwater(navDrawdowns);
            // Current drawdown: last price vs running peak through entire period
            const currDD = navDrawdowns[navDrawdowns.length - 1];

            // ---- 4b. Benchmark statistics (monthly data) ----
            // CAGR uses the same span of years as the portfolio, so the two are directly
            // comparable. Volatility is from monthly returns × √12 (there are no daily
            // benchmark prices), and drawdowns are measured on month-end levels, so they
            // can only be shallower than a daily measurement would find. Longest DD is
            // left blank: counting days from monthly points would only pretend precision.
            let benchStats: { cagr: number; real: number; vol: number; sharpe: number | null; maxDD: number; currDD: number } | null = null;
            if (benchDef && benchMonthly.length >= 2) {
              const bLast = benchMonthly[benchMonthly.length - 1];
              const cagr  = cagrPct(100, bLast, years);
              const vol   = annualisedVolPct(benchMonthReturns, 12);
              const bDrawdowns = drawdownsPct(benchMonthly);
              benchStats = {
                cagr,
                real:   ((1 + cagr / 100) / (1 + annInflation / 100) - 1) * 100,
                vol,
                sharpe: sharpeFor(cagr, vol, years),
                maxDD:  maxDrawdownPct(bDrawdowns),
                currDD: bDrawdowns[bDrawdowns.length - 1],
              };
            }

            // ---- 5. X-axis ticks: one per year (closest actual date to Jan 1) ----
            const startYear = new Date(chartData[0].date).getFullYear();
            const endYear   = new Date(lastRow.date).getFullYear();
            const yearTicks: string[] = [];
            // Each tick is labelled with the year it stands for, not the year of its date: the
            // trading day closest to 1 Jan can be 31 Dec, which used to label the 2024 tick
            // "2023" (so one year showed twice and another not at all).
            const tickYear = new Map<string, number>();
            for (let y = startYear + 1; y <= endYear; y++) {
              const target = new Date(`${y}-01-01`).getTime();
              const closest = chartData.reduce((prev, cur) =>
                Math.abs(new Date(cur.date).getTime() - target) < Math.abs(new Date(prev.date).getTime() - target) ? cur : prev
              );
              if (!yearTicks.includes(closest.date)) { yearTicks.push(closest.date); tickYear.set(closest.date, y); }
            }

            // ---- 6. Y-axis ticks: dynamic range based on actual data, step of 5 ----
            const allYValues = chartData.flatMap(r => r.bench != null ? [r.nav, r.infl, r.bench] : [r.nav, r.infl]);
            const yDataMin = Math.min(...allYValues);
            const yDataMax = Math.max(...allYValues);
            const yAxisMin = Math.floor(yDataMin / 5) * 5;
            const yAxisMax = Math.ceil(yDataMax / 5) * 5;
            const yAxisTicks: number[] = [];
            for (let t = yAxisMin; t <= yAxisMax; t += 5) yAxisTicks.push(t);

            // ---- 7. Edge bubbles (right-edge labels) ----
            // The bubble value drives Y positioning; the label is the INDEXED value, so it
            // agrees with the height it sits at and with the Y axis beside it.
            //
            // It used to show the raw per-share price. That reads fine in PLN — the sheet's
            // PLN NAV is itself indexed to 100, so the raw number and the indexed one are
            // the same 180.29 — but in USD the bubble said "47.50" while sitting at height
            // 181, and in SGD "60.60" at height 170. One number on a chart that is otherwise
            // entirely on a 100 = period start scale, which made the foreign-currency lines
            // look like they had not been rebased at all. The raw price is still a click
            // away in the tooltip.
            const navBubbleDefs: BubbleDef[] = [
              { value: lastRow.nav,  color: SLATE, label: lastRow.nav.toFixed(2) },
              { value: lastRow.infl, color: INFLATION_COLOR, label: lastRow.infl.toFixed(2) },
            ];
            if (benchStats) {
              const bLast = benchMonthly[benchMonthly.length - 1];
              navBubbleDefs.push({ value: bLast, color: BENCH_COLOR, label: bLast.toFixed(2) });
            }
            const DailyNavBubbles = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, navBubbleDefs);

            // ---- 7b. The stats, shared by the box over the chart (desktop) and the grid
            // under it (phones). 4th/5th entries = the benchmark's value and colour (null =
            // no benchmark figure).
            const navStatRows = [
              // Under a year the first three rows are plain returns, so they say so
              [annualised ? 'CAGR' : 'Return', `${nominalCAGR.toFixed(1)}%`,  nominalCAGR  >= 0 ? GAIN : LOSS,
                benchStats && `${benchStats.cagr.toFixed(1)}%`, benchStats && (benchStats.cagr >= 0 ? GAIN : LOSS)],
              [annualised ? 'Ann. Infl.' : 'Inflation', `${annInflation.toFixed(1)}%`, MUTED,
                benchStats && `${annInflation.toFixed(1)}%`, MUTED],
              [annualised ? 'Real CAGR' : 'Real Return', `${realCAGR.toFixed(1)}%`,     realCAGR     >= 0 ? GAIN : LOSS,
                benchStats && `${benchStats.real.toFixed(1)}%`, benchStats && (benchStats.real >= 0 ? GAIN : LOSS)],
              ['Ann. Vol.',   `${annVol.toFixed(1)}%`,       INK_SOFT,
                benchStats && `${benchStats.vol.toFixed(1)}%`, INK_SOFT],
              ['Sharpe',      sharpe === null ? '—' : sharpe.toFixed(2), INK_SOFT,
                benchStats && (benchStats.sharpe === null ? '—' : benchStats.sharpe.toFixed(2)), INK_SOFT],
              ['Max DD',      `${maxDD.toFixed(1)}%`,        LOSS,
                benchStats && `${benchStats.maxDD.toFixed(1)}%`, LOSS],
              ['Curr DD',     `${currDD.toFixed(1)}%`,       currDD < -0.01 ? LOSS : GAIN,
                benchStats && `${benchStats.currDD.toFixed(1)}%`, benchStats && (benchStats.currDD < -0.01 ? LOSS : GAIN)],
              ['Longest DD',  `${longestDD}d`,               INK_SOFT,
                benchStats && '—', '#9ca3af'],
            ] as [string, string, string, string | null, string | null][];
            // Phones: the same colours as classes
            const statColourClass = (c: string | null) =>
              c === GAIN ? 'text-green-600' : c === LOSS ? 'text-red-600'
                : c === MUTED ? 'text-gray-500' : c === '#9ca3af' ? 'text-gray-400' : 'text-gray-700';

            // ---- 8. Render ----
            return (
              <div className="mt-6">
                {/* Phones: the note goes under the title instead of squeezing it onto two lines */}
                <div className="flex items-center justify-between mb-2 max-md:flex-col max-md:items-start max-md:gap-0.5">
                  <h3 className="text-md font-semibold text-gray-700">Daily NAV</h3>
                  <span className="text-xs text-gray-400">Both series indexed to 100 at period start · inflation from monthly CPI, held flat within the month</span>
                </div>

                {/* Currency + Period selectors (phones: three boxes that open slide-up panels) */}
                <div className="hidden max-md:flex gap-2 mb-4">
                  <PhoneChoice
                    label="Currency"
                    options={(['PLN', 'USD', 'SGD', 'CHF'] as const).map(c => ({ value: c, label: c }))}
                    selected={dailyNavCurrency}
                    onPick={c => setDailyNavCurrency(c as typeof dailyNavCurrency)}
                  />
                  <PhoneChoice
                    label="Benchmark"
                    options={[{ value: '', label: 'None' }, ...DAILY_NAV_BENCHMARKS.map(b => ({ value: b.id, label: b.id }))]}
                    selected={dailyNavBenchmark}
                    onPick={b => setDailyNavBenchmark(b as typeof dailyNavBenchmark)}
                  />
                  <PhoneChoice
                    label="Period"
                    options={periodOptions(['1Y', '3Y', '5Y', 'Max'])}
                    selected={dailyNavPeriod}
                    onPick={p => setDailyNavPeriod(p as typeof dailyNavPeriod)}
                  />
                </div>
                <div className="flex items-center gap-5 mb-4 flex-wrap max-md:hidden">
                  <div className={`flex items-center gap-1 ${PHONE_SCROLL_ROW}`}>
                    <span className="text-xs text-gray-500 mr-1">Currency:</span>
                    <span className={SEG}>
                    {(['PLN', 'USD', 'SGD', 'CHF'] as const).map(c => (
                      <button key={c} onClick={() => setDailyNavCurrency(c)}
                        className={segBtn(dailyNavCurrency === c)}
                      >{c}</button>
                    ))}
                    </span>
                  </div>
                  {/* Benchmark buttons — one at a time; clicking the active one hides it again */}
                  <div className={`flex items-center gap-1 ${PHONE_SCROLL_ROW}`}>
                    <span className="text-xs text-gray-500 mr-1">Benchmark:</span>
                    <span className={SEG}>
                    {DAILY_NAV_BENCHMARKS.map(b => (
                      <button key={b.id} title={b.note}
                        onClick={() => setDailyNavBenchmark(prev => prev === b.id ? '' : b.id)}
                        className={segBtn(dailyNavBenchmark === b.id)}
                      >{b.id}</button>
                    ))}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500 mr-1">Period:</span>
                    <span className={SEG}>
                    {(['1Y', '3Y', '5Y', 'Max'] as const).map(p => (
                      <button key={p} onClick={() => setDailyNavPeriod(p)}
                        className={segBtn(dailyNavPeriod === p)}
                      >{p}</button>
                    ))}
                    </span>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-lg shadow">
                  {/* Wrapper gives the stats overlay something to position against */}
                  <div style={{ position: 'relative' }}>

                    {/* Stats overlay — top-left corner inside the plot area (past the Y axis).
                        Not on phones: there it would cover a third of the chart, so the
                        same figures go in a grid under it instead. */}
                    <div className="max-md:hidden" style={{
                      position: 'absolute', top: 24, left: 48, zIndex: 10,
                      background: CARD_GLASS, border: `1px solid ${LINE}`,
                      borderRadius: 5, padding: '5px 10px', fontSize: 11, pointerEvents: 'none', lineHeight: 1.75,
                    }}>
                      <table style={{ borderCollapse: 'collapse' }}>
                        {/* Column headings only appear when a benchmark adds a second column */}
                        {benchStats && benchDef && (
                          <thead>
                            <tr>
                              <td></td>
                              <td style={{ color: SLATE, fontWeight: 600, paddingRight: 10 }}>Portfolio</td>
                              {/* No hover tooltip here: the overlay has pointerEvents none. The * is explained in the note under the chart. */}
                              <td style={{ color: BENCH_COLOR, fontWeight: 600 }}>{benchDef.id}*</td>
                            </tr>
                          </thead>
                        )}
                        <tbody>
                          {navStatRows.map(([label, val, color, bVal, bColor]) => (
                            <tr key={label as string}>
                              <td style={{ color: MUTED, paddingRight: 10 }}>{label}</td>
                              <td style={{ fontWeight: 600, color: color as string, ...(benchStats ? { paddingRight: 10 } : {}) }}>{val}</td>
                              {benchStats && <td style={{ fontWeight: 600, color: bColor || INK_SOFT }}>{bVal}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <ResponsiveContainer width="100%" height={420}>
                      <LineChart data={chartData} margin={{ top: 20, right: 55, left: 5, bottom: 35 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={LINE_FAINT} />
                        <XAxis
                          dataKey="date"
                          ticks={yearTicks}
                          tickFormatter={(d: string) => String(tickYear.get(d) ?? d.substring(0, 4))}
                          tick={{ fontSize: 11, fill: MUTED }}
                          height={30}
                        />
                        <YAxis
                          domain={[yAxisMin, yAxisMax]}
                          ticks={yAxisTicks}
                          tickFormatter={(v: number) => v.toFixed(0)}
                          tick={{ fontSize: 11, fill: MUTED }}
                          width={36}
                        />
                        {/* The indexed value is what the chart is about, so it leads; the raw
                            figure behind it follows in brackets — the NAV per share in the
                            chosen currency, and the CPI index reading for that month. */}
                        <Tooltip
                          formatter={(value: number, name: string, item: { payload?: { rawNav: number; rawInfl: number } }) => {
                            const row = item?.payload;
                            const isNav = name.startsWith('NAV');
                            if (benchDef && name === `${benchDef.id} ${dailyNavCurrency}`) return [value.toFixed(2), name];  // benchmark: indexed value only
                            const raw = row ? (isNav ? row.rawNav : row.rawInfl) : null;
                            const suffix = raw == null ? ''
                              : isNav ? `  (${raw.toFixed(2)} ${dailyNavCurrency})`
                                      : `  (CPI ${raw.toFixed(2)})`;
                            return [`${value.toFixed(2)}${suffix}`, name];
                          }}
                          labelFormatter={(label: string) => label}
                          contentStyle={{ fontSize: 12 }}
                        />
                        {/* Right-edge bubbles showing latest raw NAV and inflation values */}
                        <Customized component={DailyNavBubbles} />
                        {/* NAV line — solid blue */}
                        <Line
                          type="monotone"
                          dataKey="nav"
                          name={`NAV ${dailyNavCurrency}`}
                          stroke={SLATE}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                        {/* Inflation line — dashed red */}
                        <Line
                          type="monotone"
                          dataKey="infl"
                          name={`Inflation ${dailyNavCurrency}`}
                          stroke={INFLATION_COLOR}
                          strokeWidth={1.5}
                          strokeDasharray="5 3"
                          dot={false}
                          connectNulls
                        />
                        {/* Benchmark line — straight segments joining its month-end points */}
                        {benchStats && benchDef && (
                          <Line
                            type="linear"
                            dataKey="bench"
                            name={`${benchDef.id} ${dailyNavCurrency}`}
                            stroke={BENCH_COLOR}
                            strokeWidth={1.5}
                            dot={false}
                            connectNulls
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Phones: the stats as a two-column grid under the chart. With a benchmark,
                      each figure is followed by the benchmark's in its own colour. */}
                  <div className="hidden max-md:block mt-1">
                    {benchStats && benchDef && (
                      <div className="text-[11px] mb-1.5">
                        <span className="font-semibold" style={{ color: SLATE }}>Portfolio</span>
                        <span className="text-gray-400"> · </span>
                        <span className="font-semibold" style={{ color: BENCH_COLOR }}>{benchDef.id}*</span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-xs">
                      {navStatRows.map(([label, val, color, bVal, bColor]) => (
                        <div key={label} className="flex items-baseline justify-between gap-2">
                          <span className="text-gray-500">{label}</span>
                          <span className="font-semibold whitespace-nowrap">
                            <span className={statColourClass(color)}>{val}</span>
                            {benchStats && <span className={`ml-1.5 ${statColourClass(bColor)}`}>{bVal}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* What the selected benchmark is, and how its line was built */}
                  {benchStats && benchDef && (
                    <p className="text-xs text-gray-500 mt-2">
                      {benchDef.note} *Built from month-end prices converted to {dailyNavCurrency}, so its line joins month-end points and its volatility and drawdowns are monthly measures.
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── Daily NAV Drawdowns chart ── */}
          {(() => {
            // The same fixed currency colours as Returns by Year and everywhere else
            const DD_COLORS: Record<string, string> = { PLN: CURRENCY_COLORS.PLN, USD: CURRENCY_COLORS.USD, SGD: CURRENCY_COLORS.SGD, CHF: CURRENCY_COLORS.CHF };

            // Re-use the same period-cutoff logic as the Daily NAV chart
            const today = new Date();
            const cutoffs: Record<string, Date> = {
              '1Y': new Date(new Date().setFullYear(today.getFullYear() - 1)),
              '3Y': new Date(new Date().setFullYear(today.getFullYear() - 3)),
              '5Y': new Date(new Date().setFullYear(today.getFullYear() - 5)),
              'Max': new Date('1900-01-01'),
            };
            const cutoff = cutoffs[ddPeriod];

            // Filter rows by the selected period
            const ddFiltered = dailyData.filter(r => new Date(r.date) >= cutoff);

            // Build chart data: DD columns are already in percentage form (e.g. -10.6 = -10.6%)
            const ddChartData = ddFiltered.map(r => ({
              date: r.date,
              PLN: ddSelectedCurrencies.includes('PLN') ? r.ddPln : undefined,
              USD: ddSelectedCurrencies.includes('USD') ? r.ddUsd : undefined,
              SGD: ddSelectedCurrencies.includes('SGD') ? r.ddSgd : undefined,
              // CHF is computed in the parser; days without a CHFPLN rate are left blank
              CHF: ddSelectedCurrencies.includes('CHF') && r.navChf > 0 ? r.ddChf : undefined,
            }));

            // Compute max drawdown per currency over the filtered period
            const maxDdByCurrency: Record<string, number> = {};
            (['PLN', 'USD', 'SGD', 'CHF'] as const).forEach(c => {
              if (ddSelectedCurrencies.includes(c)) {
                const key = c === 'PLN' ? 'ddPln' : c === 'USD' ? 'ddUsd' : c === 'CHF' ? 'ddChf' : 'ddSgd';
                const vals = ddFiltered.filter(r => c !== 'CHF' || r.navChf > 0).map(r => r[key]);
                maxDdByCurrency[c] = vals.length > 0 ? Math.min(...vals) : 0;
              }
            });

            // Y-axis: snap the bottom to the nearest 5% below the worst drawdown
            // e.g. worst = -27% → yMin = -30%; worst = -11% → yMin = -15%
            const allVals = ddChartData.flatMap(d =>
              (['PLN', 'USD', 'SGD', 'CHF'] as const)
                .filter(c => ddSelectedCurrencies.includes(c))
                .map(c => d[c] ?? 0)
            );
            const minVal = allVals.length > 0 ? Math.min(...allVals) : -30;
            const step = 5;
            const yMin = Math.floor(minVal / step) * step; // e.g. floor(-27/5)*5 = -30
            // Generate explicit ticks at every 5% from yMin up to 0
            const yTicks: number[] = [];
            for (let t = yMin; t <= 0; t += step) yTicks.push(t);

            // X-axis tick interval — fewer ticks avoids crowding on small periods
            const tickInterval = Math.max(1, Math.floor(ddChartData.length / 8));
            // Phones: full dates ("2021-03-15") run into each other on a narrow chart, so
            // the axis marks the first trading day of each year ("2021") instead, or of every
            // third month ("Apr 26") when the period is too short for yearly marks.
            const ddPhone = isPhoneScreen();
            const ddPhoneTicks: string[] = [];
            const ddPhoneLabel = new Map<string, string>();
            if (ddPhone && ddChartData.length > 0) {
              const spanYears = (new Date(ddChartData[ddChartData.length - 1].date).getTime() - new Date(ddChartData[0].date).getTime()) / (365.25 * 864e5);
              const yearly = spanYears >= 3;
              let prevKey = ddChartData[0].date.slice(0, yearly ? 4 : 7);
              for (const d of ddChartData) {
                const key = d.date.slice(0, yearly ? 4 : 7);
                const month = Number(d.date.slice(5, 7));
                if (key !== prevKey && (yearly || (month - 1) % 3 === 0)) {
                  ddPhoneTicks.push(d.date);
                  ddPhoneLabel.set(d.date, yearly ? key : `${MONTH_ABBR[month - 1]} ${d.date.slice(2, 4)}`);
                }
                prevKey = key;
              }
            }

            if (dailyData.length === 0) return null;

            return (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-md font-semibold text-gray-700">Daily NAV Drawdowns</h3>
                </div>

                {/* Currency toggles (multi-select) + Period buttons + Max DD info.
                    Phones: the toggles and the Period box share one row (the "Currency:"
                    label is dropped there to make room; the coloured buttons explain themselves). */}
                <div className="flex items-center gap-5 mb-4 flex-wrap max-md:gap-x-3 max-md:gap-y-2">

                  {/* Currency mini-buttons — clicking toggles a currency on/off */}
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500 mr-1 max-md:hidden">Currency:</span>
                    {/* Pick several: each one switched on is slate, like a chosen option.
                        The dot is that currency's line colour in the chart. */}
                    <span className={SEG}>
                    {(['PLN', 'USD', 'SGD', 'CHF'] as const).map(c => {
                      const active = ddSelectedCurrencies.includes(c);
                      return (
                        <button
                          key={c}
                          onClick={() => {
                            // Toggle this currency in the selected set
                            setDdSelectedCurrencies(prev =>
                              prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
                            );
                          }}
                          className={segBtn(active)}
                        >
                          <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle -mt-px" style={{ backgroundColor: DD_COLORS[c] }} />
                          {c}
                        </button>
                      );
                    })}
                    </span>
                  </div>

                  {/* Period buttons — same style as Daily NAV (phones: one box) */}
                  <div className="hidden max-md:flex flex-1 min-w-0">
                    <PhoneChoice
                      label="Period"
                      options={periodOptions(['1Y', '3Y', '5Y', 'Max'])}
                      selected={ddPeriod}
                      onPick={p => setDdPeriod(p as typeof ddPeriod)}
                    />
                  </div>
                  <div className="flex items-center gap-1 max-md:hidden">
                    <span className="text-xs text-gray-500 mr-1">Period:</span>
                    <span className={SEG}>
                    {(['1Y', '3Y', '5Y', 'Max'] as const).map(p => (
                      <button key={p} onClick={() => setDdPeriod(p)}
                        className={segBtn(ddPeriod === p)}
                      >{p}</button>
                    ))}
                    </span>
                  </div>

                  {/* Max DD per currency for the selected period */}
                  {ddSelectedCurrencies.length > 0 && (
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <span className="text-gray-400">Max DD:</span>
                      {(['PLN', 'USD', 'SGD', 'CHF'] as const)
                        .filter(c => ddSelectedCurrencies.includes(c))
                        .map((c, i, arr) => (
                          <span key={c}>
                            <span style={{ color: DD_COLORS[c] }}>
                              {c}: {maxDdByCurrency[c] !== undefined ? `${maxDdByCurrency[c].toFixed(1)}%` : '—'}
                            </span>
                            {i < arr.length - 1 && <span className="text-gray-300 mx-1">|</span>}
                          </span>
                        ))
                      }
                    </div>
                  )}
                </div>

                <div className="bg-white p-4 rounded-lg shadow">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={ddChartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                      <defs>
                        {(['PLN', 'USD', 'SGD', 'CHF'] as const).map(c => (
                          <linearGradient key={c} id={`ddGrad${c}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={DD_COLORS[c]} stopOpacity={0.25} />
                            <stop offset="95%" stopColor={DD_COLORS[c]} stopOpacity={0.03} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={LINE_FAINT} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                        interval={ddPhone ? 0 : tickInterval}
                        ticks={ddPhone ? ddPhoneTicks : undefined}
                        tickFormatter={ddPhone ? (d: string) => ddPhoneLabel.get(d) ?? d : undefined}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[yMin, 0]}
                        ticks={yTicks}
                        tickFormatter={v => `${v}%`}
                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                        tickLine={false}
                        axisLine={false}
                        width={40}
                      />
                      <Tooltip
                        formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name]}
                        labelFormatter={label => `Date: ${label}`}
                        contentStyle={{ fontSize: 11 }}
                      />
                      {/* A horizontal line at 0 to make the baseline clear */}
                      <ReferenceLine y={0} stroke={LINE_MID} strokeWidth={1} />
                      {(['PLN', 'USD', 'SGD', 'CHF'] as const).map(c =>
                        ddSelectedCurrencies.includes(c) ? (
                          <Area
                            key={c}
                            type="monotone"
                            dataKey={c}
                            name={c}
                            stroke={DD_COLORS[c]}
                            strokeWidth={1.5}
                            fill={`url(#ddGrad${c})`}
                            dot={false}
                            connectNulls
                          />
                        ) : null
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}

          {/* Currency toggle buttons — controls which bars appear in Charts 3 & 4; multi-select */}
          <div className="mb-4 flex items-center gap-1">
            <span className="text-xs text-gray-500 mr-1">Currency:</span>
            {/* Pick several; the dot is that currency's bar colour in the charts */}
            <span className={SEG}>
            {([['PLN', CURRENCY_COLORS.PLN], ['USD', CURRENCY_COLORS.USD], ['SGD', CURRENCY_COLORS.SGD]] as const).map(([c, color]) => {
              const active = selectedReturnCurrencies.includes(c);
              return (
                <button
                  key={c}
                  onClick={() => setSelectedReturnCurrencies(prev =>
                    prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
                  )}
                  className={segBtn(active)}
                >
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle -mt-px" style={{ backgroundColor: color }} />
                  {c}
                </button>
              );
            })}
            </span>
          </div>

          {/* Chart 3: Returns by Year — grouped bar chart */}
          {/* Bars shown/hidden based on selectedReturnCurrencies */}
          {/* ("phone-bar-labels": smaller bar labels on phones, see globals.css) */}
          <div className="bg-white p-4 rounded-lg shadow mb-4 phone-bar-labels">
            {/* Compute CAGR from annual returns for each selected currency.
                CAGR = geometric mean = (Π(1 + r_i/100))^(1/N) − 1.
                Only rows with a valid (finite) return value are included. */}
            {(() => {
              const ccyKeys: { key: 'PLN' | 'USD' | 'SGD'; field: 'returnPln' | 'returnUsd' | 'returnSgd'; color: string }[] = [
                { key: 'PLN', field: 'returnPln', color: CURRENCY_COLORS.PLN },
                { key: 'USD', field: 'returnUsd', color: CURRENCY_COLORS.USD },
                { key: 'SGD', field: 'returnSgd', color: CURRENCY_COLORS.SGD },
              ];
              const cagrParts = ccyKeys
                .filter(c => selectedReturnCurrencies.includes(c.key))
                .map(c => {
                  const validReturns = yearsData.map(r => r[c.field]).filter(v => typeof v === 'number' && !isNaN(v));
                  if (validReturns.length === 0) return null;
                  const product = validReturns.reduce((acc, r) => acc * (1 + r / 100), 1);
                  const cagr = (Math.pow(product, 1 / validReturns.length) - 1) * 100;
                  const sign = cagr >= 0 ? '+' : '';
                  return { key: c.key, cagr, sign, color: c.color };
                })
                .filter(Boolean) as { key: string; cagr: number; sign: string; color: string }[];
              return (
                <h3 className="text-md font-semibold text-gray-700 mb-2 flex items-center gap-3 flex-wrap">
                  <span>Returns by Year (%)</span>
                  {cagrParts.map(c => (
                    <span key={c.key} className="text-sm font-normal" style={{ color: c.color }}>
                      {c.key} CAGR: {c.sign}{c.cagr.toFixed(1)}%
                    </span>
                  ))}
                </h3>
              );
            })()}
            {(() => { const returnsRows = getReturnsChartData(); return (
            <ResponsiveContainer width="100%" height={350}>
              <BarChart
                data={returnsRows}
                margin={{ top: 20, right: 5, left: 5, bottom: 5 }}
              >
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                {/* padding: room under the lowest bar for its loss label (lossBarLabel) */}
                <YAxis hide domain={['auto', 'auto']}
                  padding={{ bottom: lossLabelRoom(returnsRows.some(d => ['Return PLN', 'Return USD', 'Return SGD'].some(k => Number(d[k as keyof typeof d]) < 0)), 14) }} />
                <Tooltip
                  formatter={(value: number) => [`${value.toFixed(1)}%`, '']}
                  labelFormatter={(label) => `Year: ${label}`}
                />
                <Legend />
                {selectedReturnCurrencies.includes('PLN') && (
                  <Bar dataKey="Return PLN" fill={CURRENCY_COLORS.PLN}>
                    <LabelList
                      dataKey="Return PLN"
                      position="top"
                      formatter={(value: number) => value >= 0 ? barPct(value) : ''}
                      style={{ fontSize: '14px', fontWeight: 600, fill: MUTED_LABEL }}
                    />
                    <LabelList
                      dataKey="Return PLN"
                      content={lossBarLabel((value: number) => barPct(value), { fontSize: '14px', fontWeight: 600, fill: LOSS })}
                    />
                  </Bar>
                )}
                {selectedReturnCurrencies.includes('USD') && (
                  <Bar dataKey="Return USD" fill={CURRENCY_COLORS.USD}>
                    <LabelList
                      dataKey="Return USD"
                      position="top"
                      formatter={(value: number) => value >= 0 ? barPct(value) : ''}
                      style={{ fontSize: '14px', fontWeight: 600, fill: MUTED_LABEL }}
                    />
                    <LabelList
                      dataKey="Return USD"
                      content={lossBarLabel((value: number) => barPct(value), { fontSize: '14px', fontWeight: 600, fill: LOSS })}
                    />
                  </Bar>
                )}
                {selectedReturnCurrencies.includes('SGD') && (
                  <Bar dataKey="Return SGD" fill={CURRENCY_COLORS.SGD}>
                    <LabelList
                      dataKey="Return SGD"
                      position="top"
                      formatter={(value: number) => value >= 0 ? barPct(value) : ''}
                      style={{ fontSize: '14px', fontWeight: 600, fill: MUTED_LABEL }}
                    />
                    <LabelList
                      dataKey="Return SGD"
                      content={lossBarLabel((value: number) => barPct(value), { fontSize: '14px', fontWeight: 600, fill: LOSS })}
                    />
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
            ); })()}
          </div>

          {/* Chart 4: Growth by Year — grouped bar chart */}
          {/* Bars shown/hidden based on selectedReturnCurrencies */}
          <div className="bg-white p-4 rounded-lg shadow mb-4 phone-bar-labels">
            <h3 className="text-md font-semibold text-gray-700 mb-2">Growth by Year (%)</h3>
            {(() => { const growthRows = getGrowthByYearChartData(); return (
            <ResponsiveContainer width="100%" height={350}>
              <BarChart
                data={growthRows}
                margin={{ top: 20, right: 5, left: 5, bottom: 5 }}
              >
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                {/* padding: room under the lowest bar for its loss label (lossBarLabel) */}
                <YAxis hide domain={['auto', 'auto']}
                  padding={{ bottom: lossLabelRoom(growthRows.some(d => d['Growth PLN'] < 0 || d['Growth USD'] < 0 || d['Growth SGD'] < 0), 14) }} />
                <Tooltip
                  formatter={(value: number) => [`${value.toFixed(1)}%`, '']}
                  labelFormatter={(label) => `Year: ${label}`}
                />
                <Legend />
                {selectedReturnCurrencies.includes('PLN') && (
                  <Bar dataKey="Growth PLN" fill={CURRENCY_COLORS.PLN}>
                    <LabelList
                      dataKey="Growth PLN"
                      position="top"
                      formatter={(value: number) => value >= 0 ? barPct(value) : ''}
                      style={{ fontSize: '14px', fontWeight: 600, fill: MUTED_LABEL }}
                    />
                    <LabelList
                      dataKey="Growth PLN"
                      content={lossBarLabel((value: number) => barPct(value), { fontSize: '14px', fontWeight: 600, fill: LOSS })}
                    />
                  </Bar>
                )}
                {selectedReturnCurrencies.includes('USD') && (
                  <Bar dataKey="Growth USD" fill={CURRENCY_COLORS.USD}>
                    <LabelList
                      dataKey="Growth USD"
                      position="top"
                      formatter={(value: number) => value >= 0 ? barPct(value) : ''}
                      style={{ fontSize: '14px', fontWeight: 600, fill: MUTED_LABEL }}
                    />
                    <LabelList
                      dataKey="Growth USD"
                      content={lossBarLabel((value: number) => barPct(value), { fontSize: '14px', fontWeight: 600, fill: LOSS })}
                    />
                  </Bar>
                )}
                {selectedReturnCurrencies.includes('SGD') && (
                  <Bar dataKey="Growth SGD" fill={CURRENCY_COLORS.SGD}>
                    <LabelList
                      dataKey="Growth SGD"
                      position="top"
                      formatter={(value: number) => value >= 0 ? barPct(value) : ''}
                      style={{ fontSize: '14px', fontWeight: 600, fill: MUTED_LABEL }}
                    />
                    <LabelList
                      dataKey="Growth SGD"
                      content={lossBarLabel((value: number) => barPct(value), { fontSize: '14px', fontWeight: 600, fill: LOSS })}
                    />
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
            ); })()}
          </div>
        </>
      )}
    </div>
  );
}
