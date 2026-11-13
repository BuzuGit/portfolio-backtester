/*
  CHART HELPERS SHARED BY THE TABS

  Tick labels, the edge bubbles at the end of a line, diverging bars, nicely rounded axis scales,
  high-water marks and underwater periods, the returns-chart periods and streak views, the
  benchmark lists, and short phone labels. They used to sit at the top of the one big
  PortfolioBacktester.tsx; they live here so that each tab file can use them. Moved word for word.
*/
import React from 'react';
import { isPhoneScreen } from '@/lib/savedSheet';
import { MONTH_ABBR, toYM } from '@/lib/dates';
import { BLACK, INK, MUTED, ON_BLACK, SLATE, type MonthlyChartPeriod } from '@/components/ui';
import type { AssetRow } from '@/lib/fetchData';
import { getConversionRate } from '@/lib/backtest';
import { isAnnualisable } from '@/lib/stats';

/** The settings monthlyChartData takes after the price table and the currency lookup. */
export type MonthlyChartArgs = Parameters<typeof monthlyChartData> extends [unknown, unknown, ...infer Rest] ? Rest : never;

/** Full month names, used by the Monthly tab seasonality (loss-rate) screen. */
export const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/**
 * Compute the zero-crossing fraction for a PnL gradient.
 * Returns how far down from the chart's top the y=0 line sits (0 = top, 1 = bottom).
 * Used by both Open and Closed position PnL charts to set the green/red gradient split.
 */
export const computePnlZeroFraction = (data: { pnl: number }[]): number => {
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
export const mergeComparisonData = <T extends { date: string }>(
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
export const DateAxisTick = ({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => {
  const d = new Date(payload.value);
  if (isNaN(d.getTime())) {
    return <text x={x} y={y} textAnchor="middle" fontSize={9} fill={MUTED}>{payload.value}</text>;
  }
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={9} fill={MUTED}>
      <tspan x={x} dy="0.5em">{MONTH_ABBR[d.getMonth()]}</tspan>
      <tspan x={x} dy="1.2em">{d.getFullYear()}</tspan>
    </text>
  );
};

/** Props injected by Recharts into <Customized> components.
 *  We only type the fields we actually use (yAxisMap, offset, width, height). */
export type RechartsCustomizedProps = {
  yAxisMap?: Record<string, { scale: (v: number) => number }>;
  offset?: { top: number; bottom: number; left: number; right: number };
  width?: number;
  height?: number;
};

/** Right-edge bubbles as a component, for `<Customized component={<EdgeBubbles defs={...} />} />`.
 *  Recharts clones the element and passes in the chart geometry. Defined at module scope so it
 *  keeps one identity across renders (see DivergingBar below for why that matters). */
export const EdgeBubbles = (props: Partial<RechartsCustomizedProps> & { defs: BubbleDef[] }) =>
  renderEdgeBubbles(props as RechartsCustomizedProps, props.defs);

/** Definition for a single right-edge bubble (colored label at chart's right edge). */
export interface BubbleDef {
  value: number;   // numeric value (used for Y positioning via yAxis.scale)
  color: string;   // background color of the bubble rectangle
  label: string;   // formatted text to display inside the bubble
}

/** One buy or sell marker on a position's price-history chart.
 *  Two prices, deliberately:
 *   - `price`      the month-END price, i.e. exactly where the black price line sits that
 *                  month. This is where the stem that ties the dot back to the line ends.
 *   - `tradePrice` what you actually paid or received per share. The dot itself is drawn
 *                  here, so it floats above the line on a bad fill and below it on a good
 *                  one, while staying in the correct month horizontally. */
export interface TradeDot {
  date: string;
  price: number;
  tradePrice: number;
}

/** Adds one real trade price into a month bucket. A month can hold several trades, so each
 *  bucket is a list and every entry becomes its own dot. Non-positive prices are ignored —
 *  a missing price would otherwise drag a dot down to zero. */
export function pushTradePrice(map: Map<string, number[]>, ym: string, price: number) {
  if (!(price > 0)) return;
  const existing = map.get(ym);
  if (existing) existing.push(price);
  else map.set(ym, [price]);
}

/** Two fills within half a percent of each other land on the same pixel, so drawing both
 *  gives you one dot with two price labels printed on top of each other — unreadable. This
 *  is purely a legibility rule, not an accounting one: fills that actually differ still get
 *  their own dot, but a batch that filled at effectively one price is shown once, at the
 *  average of that batch. It also collapses the common case of one sale closing five lots,
 *  which arrives here as the same sell price repeated five times. */
export const TRADE_DOT_MERGE_TOLERANCE = 0.005;
export function collapseTradePrices(prices: number[]): number[] {
  if (prices.length < 2) return prices;
  const sorted = [...prices].sort((a, b) => a - b);
  const merged: number[] = [];
  let group: number[] = [];
  const flush = () => { if (group.length) merged.push(group.reduce((s, p) => s + p, 0) / group.length); };
  for (const p of sorted) {
    // Compare against the LOWEST price in the current group, so a long chain of tiny steps
    // can't quietly drift a whole percent away from where the group started.
    if (group.length === 0 || (p - group[0]) / group[0] <= TRADE_DOT_MERGE_TOLERANCE) group.push(p);
    else { flush(); group = [p]; }
  }
  flush();
  return merged;
}

// Shared constants for all right-edge bubbles across charts
export const BUBBLE_W = 62;   // width of the bubble rectangle in pixels
/**
 * A horizontal bar for a diverging (gain/loss) chart: rounded 4px at the DATA end, square
 * where it meets the zero baseline, so the zero line stays one clean edge.
 *
 * READ THIS BEFORE TOUCHING ANY DIVERGING BAR CODE. For a bar below zero, Recharts anchors
 * `x` at the ZERO line and hands over a NEGATIVE `width` — `x` is the bar's right-hand edge,
 * not its left. Assuming otherwise cost two separate bugs in one sitting: first the corner
 * radius collapsed and every loss rounded the wrong end, then every loss amount was printed
 * back at zero, on top of its own red bar. Hence `left`/`right` are derived rather than
 * assumed, and the sign comes from the datum (`payload.profit`) rather than from the props.
 *
 * Lives at module scope on purpose: defining a component inside a render gives it a fresh
 * identity every time, which makes React throw away and rebuild every bar on each repaint.
 */
export const DivergingBar = (props: {
  x?: number; y?: number; width?: number; height?: number; fill?: string; payload?: { profit?: number };
}) => {
  const x = Number(props.x ?? 0), y = Number(props.y ?? 0);
  const rawW = Number(props.width ?? 0);
  const w = Math.abs(rawW), h = Math.abs(Number(props.height ?? 0));
  if (!isFinite(x) || !isFinite(y) || !w || !h) return <path d="" />;
  const left = Math.min(x, x + rawW);
  const right = left + w;
  const r = Math.max(0, Math.min(4, h / 2, w));
  const d = Number(props.payload?.profit ?? 0) >= 0
    // Gain: grows rightwards, so the rounded end is the right one.
    ? `M${left},${y} H${right - r} Q${right},${y} ${right},${y + r} V${y + h - r} Q${right},${y + h} ${right - r},${y + h} H${left} Z`
    // Loss: grows leftwards, so the rounded end is the left one.
    : `M${right},${y} H${left + r} Q${left},${y} ${left},${y + r} V${y + h - r} Q${left},${y + h} ${left + r},${y + h} H${right} Z`;
  return <path d={d} fill={props.fill} />;
};

export const BUBBLE_H = 20;   // height of the bubble rectangle
export const BUBBLE_GAP = 2;  // minimum pixel gap between adjacent bubbles
export const BUBBLE_RX = 4;   // border-radius of rounded corners

/** Renders a group of colored value bubbles at the right edge of a Recharts chart.
 *  Used by Price History, Invested Capital, and PnL charts. Handles:
 *  - Positioning each bubble at its correct Y value via the chart's yAxis.scale
 *  - Sorting bubbles top-to-bottom (highest value at top)
 *  - Preventing overlap by pushing bubbles apart
 *  - Clamping bubbles to stay within the chart's visible area
 *  - Skipping bubbles whose Y position is NaN (value outside axis domain) */
export function renderEdgeBubbles(
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
            fill={[BLACK, INK, SLATE].includes(b.color) ? ON_BLACK : '#ffffff'} fontSize={11} fontWeight={600}
          >
            {b.label}
          </text>
        </g>
      ))}
    </g>
  );
}

// The Monthly tab's own button row. Deliberately NOT every value of the type above: '15Y'
// exists for the Graphs tab, which offers a shorter list of its own, and adding it here
// would put an extra button on the Monthly tab that nobody asked for.
export const MONTHLY_CHART_PERIODS: MonthlyChartPeriod[] =
  ['1Y', '2Y', '3Y', '4Y', '5Y', '6Y', '7Y', '8Y', '9Y', '10Y', 'max'];

// What the Monthly tab's returns bar chart is showing. The first three are ordinary
// calendar returns (one bar per month / quarter / year). The "rolling" ones answer a
// different question: "if I had bought in month X and held for N years, what annual
// return would I have earned?" — so each bar is one COMPLETE N-year holding period,
// plotted against the month it started. Think of it as sliding an N-year window along
// the price history one month at a time and taking a photo at every stop.
// The last two are different again: not returns at all but STREAK COUNTERS, one bar per
// month, whose height is how many months the run has lasted. They reset to zero the moment
// it breaks, so a long flat stretch of zeros is itself the finding — that is the asset
// going nowhere near its high, or never stringing two green months together.
export type ReturnsChartPeriod =
  'monthly' | 'quarterly' | 'annual' | 'rolling1Y' | 'rolling3Y' | 'rolling5Y' | 'rolling10Y'
  | 'athStreak' | 'upStreak';
// The rolling views and their window length in years. One place, so the buttons, the
// maths and the labels can never disagree about what "Rolling 3Y" means.
export const ROLLING_RETURN_YEARS: { period: ReturnsChartPeriod; years: number }[] = [
  { period: 'rolling1Y', years: 1 },
  { period: 'rolling3Y', years: 3 },
  { period: 'rolling5Y', years: 5 },
  { period: 'rolling10Y', years: 10 },
];
// The streak views, likewise named once and shared by both tabs' charts.
export const STREAK_VIEWS: { period: ReturnsChartPeriod; label: string; noun: string; hint: string }[] = [
  {
    period: 'athStreak',
    label: 'ATHs',
    noun: 'consecutive months at an all-time high',
    hint: 'Consecutive months at an all-time high. The bar grows by one for every month that '
        + 'closes at or above the highest month-end seen so far, and drops to zero the month it '
        + 'closes below. Long flat stretches of zero are the interesting part: that is time spent '
        + 'below a previous peak. Measured over the visible period, the same high-water mark the '
        + 'drawdown chart uses, so the first month of the window counts as a high.',
  },
  {
    period: 'upStreak',
    label: 'Up Months',
    noun: 'consecutive positive months',
    hint: 'Consecutive months with a positive return, whether or not they set a new high. The bar '
        + 'grows by one for each month that finishes up on the one before, and drops to zero on '
        + 'any month that finishes flat or down.',
  },
];
/** One unbroken run of months: how long, and the labels of its first and last month. */
export type MonthRun = { length: number; from: string; to: string; ongoing: boolean };

/**
 * The longest run of up months, and the longest run WITHOUT one, read straight off the
 * Up Months chart's bars (so the summary and the chart can never disagree). Each bar is the
 * running count: above zero = that month finished up, zero = flat or down. The first bar has
 * no month before it, so it is neither and is skipped. On a tie the more recent run wins.
 * `current` is the run the latest month belongs to, up or down.
 */
export function longestMonthRuns(bars: { label: string; count: number }[]): {
  up: MonthRun | null; down: MonthRun | null; current: (MonthRun & { isUp: boolean }) | null;
} {
  let up: MonthRun | null = null;
  let down: MonthRun | null = null;
  let current: (MonthRun & { isUp: boolean }) | null = null;
  let start = 1;   // index where the current run began
  for (let i = 1; i < bars.length; i++) {
    const isUp = bars[i].count > 0;
    const runEnds = i === bars.length - 1 || (bars[i + 1].count > 0) !== isUp;
    if (!runEnds) continue;
    const run = { length: i - start + 1, from: bars[start].label, to: bars[i].label, ongoing: i === bars.length - 1 };
    if (isUp && run.length >= (up?.length ?? 0)) up = run;
    if (!isUp && run.length >= (down?.length ?? 0)) down = run;
    if (run.ongoing) current = { ...run, isUp };
    start = i + 1;
  }
  return { up, down, current };
}

/**
 * The line above the Up Months chart: longest up streak and longest down streak (the longest
 * wait for the next up month). One row per series — the Monthly tab has one, the Backtest tab
 * one per portfolio, each with its colour dot when there is more than one.
 */
export function UpMonthsSummary({ series }: { series: { name: string; color: string; bars: { label: string; count: number }[] }[] }) {
  const months = (n: number) => `${n} month${n === 1 ? '' : 's'}`;
  const when = (r: MonthRun) => (r.ongoing ? `since ${r.from}, still running` : r.from === r.to ? r.from : `${r.from} – ${r.to}`);
  return (
    <div className="px-2 mb-2 space-y-0.5">
      {series.map(s => {
        const { up, down, current } = longestMonthRuns(s.bars);
        return (
          <div key={s.name} className="flex flex-wrap items-baseline gap-x-6 gap-y-0.5 text-xs text-gray-600">
            {series.length > 1 && (
              // Minimum widths (desktop only) keep the portfolios' rows lined up in columns
              <span className="flex items-center gap-1.5 font-medium text-gray-800 md:min-w-[8rem]">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                {s.name}
              </span>
            )}
            <span className="md:min-w-[18rem]" title="The most months in a row that each finished higher than the month before.">
              Longest up streak: <span className="font-semibold text-gray-900">{up ? months(up.length) : '–'}</span>
              {up && <span className="text-gray-400 ml-1.5">{when(up)}</span>}
            </span>
            <span className="md:min-w-[18rem]" title="The most months in a row that finished flat or down: the longest wait for the next up month.">
              Longest down streak: <span className="font-semibold text-red-600">{down ? months(down.length) : '–'}</span>
              {down && <span className="text-gray-400 ml-1.5">{when(down)}</span>}
            </span>
            {/* The run the latest month belongs to: up (black) or down (red), like the two above */}
            <span title="The run the latest month belongs to: how many months in a row it has been going up, or going without an up month.">
              Current streak:{' '}
              <span className={`font-semibold ${current?.isUp ? 'text-gray-900' : 'text-red-600'}`}>
                {current ? `${months(current.length)} ${current.isUp ? 'up' : 'down'}` : '–'}
              </span>
              {current && <span className="text-gray-400 ml-1.5">since {current.from}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Look-back lengths offered for the Head to Head rolling-correlation line, in MONTHS.
// 12 is short enough to show a regime change (a crisis, a rate shock); 36 is smooth
// enough to show a structural one. Named once so the buttons and the maths agree.
export const CORRELATION_WINDOWS = [12, 24, 36];
// One bar of the Monthly tab's returns chart described above. (`CORRELATION_WINDOWS`
// sits between the two, so "that chart" would now be ambiguous.) `range` and the two
// prices are only filled in by the rolling views — a calendar-return bar has no single
// pair of prices behind it to quote.
export type ReturnsBar = {
  label: string;
  return: number;
  range?: string;
  startPrice?: number;
  endPrice?: number;
};
// One bar of the Backtest tab's version of that chart. Same idea, but GROUPED: each row
// carries one entry per portfolio, keyed by the portfolio's name, which is the shape
// Recharts wants for side-by-side bars. `key` is a sortable stamp ('2013-04', '2013-Q2')
// kept separate from `label`, because a display label like "2Q\n2013" does not sort.
export type PeriodicReturnsRow = {
  key: string;
  label: string;
  range?: string;
  [portfolioName: string]: string | number | undefined;
};

// The colour world equities are drawn in wherever they appear as a reference. The market row's
// dot in the Monthly statistics table uses it too, so "the market" looks the same everywhere.
export const MARKET_LINE_COLOR = 'var(--c-gold)'; // CHART_PALETTE.gold (defined further down)

// And the 50/50 blend of the asset with the market. Matches the grey dot on that row of the
// Monthly statistics table, for the same reason.
export const BLEND_LINE_COLOR = '#9ca3af';

/**
 * Adds the running "high water mark" to a price series: the highest price seen SO FAR,
 * walking left to right. Think of it as a ratchet that only ever clicks upwards. Whenever
 * the price sits below it, the asset is "underwater" — it has not yet earned back a
 * previous peak. The mark starts at the first point of whatever series it is given, so a
 * shorter window means "highest since the window began", not "highest ever".
 */
export function withHighWaterMark<T extends { date: string; price: number }>(series: T[]): (T & { hwm: number })[] {
  let hwm = -Infinity;
  return series.map(d => {
    if (d.price > hwm) hwm = d.price;
    return { ...d, hwm };
  });
}

/** One continuous stretch spent below a previous peak. */
export interface UnderwaterPeriod {
  startDate: string;   // first month below the peak
  endDate: string;     // last month below the peak (recovery happens the month after)
  midDate: string;     // middle of the stretch — where the duration label is drawn
  months: number;      // how many months were spent underwater
  peak: number;        // the price level that had to be won back
  troughDate: string;  // the month the price bottomed out inside this stretch
  troughPrice: number; // the lowest close of the stretch
  troughMonths: number;// months from the old peak down to that trough
  depthPct: number;    // how far below the peak the trough sat, e.g. -32.4
}

/**
 * Groups the underwater months into continuous stretches, so a chart can shade each one and
 * say how long it lasted ("3y 4m"). A month counts as underwater when it closed BELOW the
 * running high — the exact same rule calculateStatistics() uses for its "Longest DD" column,
 * so a label on the chart always matches the number in the table above it.
 */
export function findUnderwaterPeriods(series: { date: string; price: number; hwm: number }[]): UnderwaterPeriod[] {
  const periods: UnderwaterPeriod[] = [];
  let runStart = -1;  // index where the current stretch began (-1 = not underwater)
  const closeRun = (startIdx: number, endIdx: number) => {
    // The high water mark cannot move while underwater, so any index in the run gives
    // the same peak — the one the price is trying to climb back to.
    const peak = series[startIdx].hwm;
    // Walk the stretch to find its lowest close: the bottom of the dip. That splits the
    // stretch into its two halves of the story — the fall (peak to trough) and the climb
    // back (trough to recovery).
    let troughIdx = startIdx;
    for (let i = startIdx + 1; i <= endIdx; i++) {
      if (series[i].price < series[troughIdx].price) troughIdx = i;
    }
    periods.push({
      startDate: series[startIdx].date,
      endDate: series[endIdx].date,
      midDate: series[Math.floor((startIdx + endIdx) / 2)].date,
      months: endIdx - startIdx + 1,
      peak,
      troughDate: series[troughIdx].date,
      troughPrice: series[troughIdx].price,
      // Counted the same way as `months` above: the number of months elapsed since the
      // peak month, so "1y 5m" means the trough came 1y 5m after the old all-time high.
      troughMonths: troughIdx - startIdx + 1,
      depthPct: (series[troughIdx].price / peak - 1) * 100,
    });
  };
  for (let i = 0; i < series.length; i++) {
    const isUnderwater = series[i].price < series[i].hwm;
    if (isUnderwater && runStart === -1) runStart = i;             // stretch begins
    if (!isUnderwater && runStart !== -1) { closeRun(runStart, i - 1); runStart = -1; }  // recovered
  }
  // Still underwater at the right edge — close the final stretch at the last month
  if (runStart !== -1) closeRun(runStart, series.length - 1);
  return periods;
}

// Which consumer-price index belongs to which currency. Only three of the five currencies the
// app can display have a CPI series in the sheet; EUR and CHF simply have none, so anything
// inflation-adjusted is shown as "n.a." rather than guessed at from a neighbouring country.
export const CURRENCY_CPI: Record<string, string> = {
  PLN: 'CPIMPL',   // Polish CPI
  USD: 'CPIMUS',   // US CPI
  SGD: 'CPIMSG',   // Singapore CPI
};

// Benchmarks the Daily NAV chart can overlay on the portfolio. Each is a fixed-weight mix of
// tickers from the monthly price sheet, rebalanced back to its weights at every month-end
// (for a single-ticker mix that is just buy-and-hold). `note` is the line shown under the
// chart while the benchmark is selected.
export const DAILY_NAV_BENCHMARKS: { id: '60/40' | 'World' | 'EQ-MF' | 'EQ-GLD' | '40/FI/MF/GLD'; mix: [string, number][]; note: string }[] = [
  { id: '60/40',  mix: [['VWRA', 0.6], ['VDTA', 0.4]],
    note: '60/40 is the classic balanced portfolio: 60% global equities (VWRA, FTSE All-World) and 40% US Treasuries (VDTA), rebalanced back to 60/40 every month-end. It is the standard yardstick for a diversified stock-and-bond portfolio.' },
  { id: 'World',  mix: [['VWRA', 1]],
    note: 'World is 100% VWRA (FTSE All-World): the global equity market on its own.' },
  { id: 'EQ-MF',  mix: [['VWRA', 0.6], ['KMLMTR', 0.4]],
    note: 'EQ-MF is 60% VWRA (global equities) and 40% KMLM (managed futures / trend following), rebalanced every month-end.' },
  { id: 'EQ-GLD', mix: [['VWRA', 0.6], ['GLDM', 0.4]],
    note: 'EQ-GLD is 60% VWRA (global equities) and 40% gold (GLDM), rebalanced every month-end.' },
  { id: '40/FI/MF/GLD', mix: [['VWRA', 0.4], ['VDTA', 0.2], ['KMLMTR', 0.2], ['GLDM', 0.2]],
    note: '40/FI/MF/GLD is 40% VWRA (global equities), 20% VDTA (US Treasuries), 20% KMLM (managed futures) and 20% gold (GLDM), rebalanced every month-end.' },
];

/**
 * Picks a tight, tidy Y-axis scale for a chart.
 *
 * Recharts' default `domain={['auto','auto']}` is generous to a fault: a series topping out
 * at 11.16 gets an axis running all the way to 15, so a third of the chart is empty sky.
 * This does the job by hand, the way a draughtsman would:
 *   1. take the actual highest and lowest values on screen,
 *   2. try candidate gridline steps from fine to coarse — 1, 2, 2.5 or 5 times a power of ten,
 *   3. for each, round the low DOWN and the high UP to the nearest multiple of that step,
 *   4. keep the FIRST (finest) one that still fits inside maxTicks gridlines.
 *
 * Finest-that-fits is what makes it tight: the axis never overshoots the data by more than
 * one gridline at either end. Snapping to a multiple of the step is what makes it readable —
 * 20, 30, 40 … rather than 21.4, 30.6, 39.8 — and guarantees every tick is the same distance
 * from the last. Returns the domain plus the exact tick list for
 * <YAxis domain={...} ticks={...} />.
 */
export function niceAxisScale(
  values: (number | null | undefined)[],
  opts?: { maxTicks?: number }
): { domain: [number, number]; ticks: number[] } | null {
  const clean = values.filter((v): v is number => typeof v === 'number' && isFinite(v));
  if (clean.length === 0) return null;

  let lo = Math.min(...clean);
  let hi = Math.max(...clean);
  let span = hi - lo;
  // A dead-flat series has no span at all; invent one so the line lands mid-chart
  // instead of collapsing onto a single gridline.
  if (span <= 0) {
    span = Math.abs(hi) * 0.1 || 1;
    lo = hi - span / 2;
    hi = lo + span;
  }

  const maxTicks = opts?.maxTicks ?? 10;
  // Start two orders of magnitude below the span — far finer than could ever fit — and walk
  // upwards. The first step that fits is therefore the tightest possible nice axis.
  const startExp = Math.floor(Math.log10(span)) - 2;
  for (let exp = startExp; exp <= startExp + 6; exp++) {
    for (const mantissa of [1, 2, 2.5, 5]) {
      const step = mantissa * Math.pow(10, exp);
      const axisLo = Math.floor(lo / step) * step;
      const axisHi = Math.ceil(hi / step) * step;
      const count = Math.round((axisHi - axisLo) / step) + 1;
      if (count < 3 || count > maxTicks) continue;
      // Floating-point arithmetic leaves crumbs like 6.000000000000001 — round them off
      // to one decimal beyond the step's own precision.
      const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
      const ticks: number[] = [];
      for (let i = 0; i < count; i++) ticks.push(parseFloat((axisLo + i * step).toFixed(decimals)));
      return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
    }
  }
  // Nothing nice fitted (very unusual) — fall back to the plain data range, no fixed ticks.
  return { domain: [lo, hi], ticks: [] };
}

/**
 * The same job as niceAxisScale, but for a LOGARITHMIC axis.
 *
 * On a log axis equal DISTANCES mean equal PERCENTAGE moves, so a doubling looks the same
 * whether it happened at 5 or at 500. That is what rescues an asset that has grown tenfold:
 * on a normal axis the early years are squashed into a flat line at the bottom, because a
 * move from 4 to 5 is 1 unit while a recent move is 50.
 *
 * Two things differ from the linear version:
 *  - padding is MULTIPLICATIVE (divide/multiply by 2%), because on a log axis that is what
 *    "a little breathing room" means;
 *  - the gridlines are round numbers of the 1-2-5 family (…10, 20, 50, 100…) rather than a
 *    constant step, since a constant step is not what looks even on this scale. How dense
 *    that family needs to be depends on how many powers of ten the data covers.
 *
 * For a range narrow enough that log and linear are visually the same (say 2.95 to 4.62),
 * the 1-2-5 family yields almost no gridlines, so we borrow the linear ones instead. They
 * are still POSITIONED by the log scale — only the choice of label values comes from there.
 */
export function niceLogAxisScale(
  values: (number | null | undefined)[],
  opts?: { maxTicks?: number }
): { domain: [number, number]; ticks: number[] } | null {
  // A log scale has no way to draw zero or a negative number — drop them, and give up
  // entirely if nothing is left, so the caller can fall back to a linear axis.
  const clean = values.filter((v): v is number => typeof v === 'number' && isFinite(v) && v > 0);
  if (clean.length === 0) return null;

  const maxTicks = opts?.maxTicks ?? 10;
  const pad = 1.02;
  const domLo = Math.min(...clean) / pad;
  const domHi = Math.max(...clean) * pad;

  const decades = Math.log10(domHi / domLo);
  const mantissas =
    decades >= 2 ? [1, 2, 5] :                          // wide range: decade markers only
    decades >= 1 ? [1, 1.5, 2, 3, 5, 7] :               // about one decade
                   [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8]; // less than a decade: finer
  let ticks: number[] = [];
  for (let exp = Math.floor(Math.log10(domLo)); exp <= Math.ceil(Math.log10(domHi)); exp++) {
    for (const m of mantissas) {
      // toPrecision(12) clears binary-floating-point crumbs such as 0.30000000000000004
      const t = parseFloat((m * Math.pow(10, exp)).toPrecision(12));
      if (t >= domLo && t <= domHi) ticks.push(t);
    }
  }
  ticks.sort((a, b) => a - b);
  while (ticks.length > maxTicks) ticks = ticks.filter((_, i) => i % 2 === 0);  // thin out

  // Too sparse to read (a narrow range) — use the linear axis's round numbers instead.
  if (ticks.length < 4) {
    const linear = niceAxisScale(clean, { maxTicks });
    const borrowed = linear ? linear.ticks.filter(t => t >= domLo && t <= domHi) : [];
    if (borrowed.length > ticks.length) ticks = borrowed;
  }

  return { domain: [domLo, domHi], ticks };
}

// Phones: the returns-chart choices (Backtest and Monthly tabs) as slide-up panel choices, in the
// same three groups the separators split the buttons into on desktop
export const RETURNS_PERIOD_CHOICES = [
  { value: 'monthly', label: 'Monthly', group: 'Returns' },
  { value: 'quarterly', label: 'Quarterly', group: 'Returns' },
  { value: 'annual', label: 'Annual', group: 'Returns' },
  ...ROLLING_RETURN_YEARS.map(r => ({ value: r.period, label: `Rolling ${r.years}Y`, hint: 'annualised', group: 'Rolling returns' })),
  ...STREAK_VIEWS.map(s => ({ value: s.period, label: s.label, group: 'Streaks' })),
];

// Phones: chart labels short enough for each to fit over its own bar (11 yearly bars share
// ~300px there). Percentages drop the "%" (the chart title already says "(%)"), millions keep
// one decimal instead of two. Desktop gets exactly what it always had.
export const barPct = (v: number) => (isPhoneScreen() ? v.toFixed(1) : `${v.toFixed(1)}%`);
export const barMillions = (v: number) => (isPhoneScreen() ? v.toFixed(1) : v.toFixed(2));

// Phones: money on a chart's side axis as "3.5M" / "700k" instead of "3500000", which was wider
// than the axis and got cut off. Desktop: undefined, so the axis prints numbers as it always has.
// (Rounded before the unit is chosen, so 999,800 reads "1M", not "1000k".)
export const phoneAxisMoney = (): ((v: number) => string) | undefined => (isPhoneScreen()
  ? (v: number) => {
      const whole = Math.round(v);
      if (Math.abs(whole) < 1000) return String(whole);
      const thousands = Math.round(v / 1e3);
      return Math.abs(thousands) < 1000 ? `${thousands}k` : `${+(v / 1e6).toFixed(1)}M`;
    }
  : undefined);

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
export const monthlyChartData = (
  assetData: AssetRow[] | null,                  // the monthly price table
  getAssetCurrency: (ticker: string) => string,  // an asset's own currency (from the lookup table)
  ticker: string,
  period: MonthlyChartPeriod,
  cutoffDate?: string,  // Optional: if provided, treat this as the last month (for Graphs tab "End Date" filter)
  targetCurrency?: string,  // Optional: convert every price into this currency (''/native = no conversion)
  // Opt-in: accept 0 and negative values as real readings rather than skipping them.
  // Only the Monthly tab passes this, because only it charts the macro series where a zero
  // or negative interest rate is the actual number. Everything else keeps the old
  // positive-prices-only rule, so no backtest or Graphs mini-chart changes.
  allowNonPositive = false
) => {
  if (!assetData || assetData.length === 0) return null;

  // The asset's native (original) currency — the currency its raw prices are quoted in.
  const assetCcy = getAssetCurrency(ticker);

  // 1. Extract monthly prices: group by YYYY-MM, take the last valid price per month
  const monthlyMap = new Map<string, { date: string; price: number }>();
  for (const row of assetData) {
    const raw = row[ticker];
    const p = Number(raw);
    // A blank cell never reaches the row at all, so an absent key is the "no data" case.
    // Whether a 0 or a negative counts as data is the caller's decision — see allowNonPositive.
    if (raw === undefined || raw === '' || !isFinite(p)) continue;
    if (!allowNonPositive && p <= 0) continue;
    const d = new Date(row.date);
    if (isNaN(d.getTime())) continue;
    const ym = toYM(d);
    // Convert this month's price into the requested currency using THIS row's FX rates.
    // getConversionRate returns 1 when targetCurrency is empty or equals the native currency,
    // so the default (native) case leaves prices untouched.
    const convRate = getConversionRate(row, assetCcy, targetCurrency || '');
    // Overwrite with the latest row for this month (data is chronological)
    monthlyMap.set(ym, { date: row.date, price: p * convRate });
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

    // SMA distance: how far (in %) the price sits above or below the 10M SMA.
    // Needs a POSITIVE average to divide by. A macro series can average exactly zero (ten
    // months of a 0% policy rate), which gave (0-0)/0 = NaN — and a single NaN here reached
    // the chart's gradient as offset="NaN%", which the browser rejects outright. A negative
    // average is no better: "12% above" an average of -0.75 means nothing. Either way the
    // honest answer is "not applicable", which the chart already knows how to skip.
    const smaDistance = sma10 !== null && sma10 > 0 ? ((price - sma10) / sma10) * 100 : null;

    fullData.push({ date, price, sma10, drawdown, smaDistance });
  }

  // 3. Apply period filter — slice the last N months for the visible window
  //    If endDate is provided, first truncate to end at that date, then take last N months
  const periodMonths: Record<string, number> = {
    '1Y': 12, '2Y': 24, '3Y': 36, '4Y': 48, '5Y': 60, '6Y': 72,
    '7Y': 84, '8Y': 96, '9Y': 108, '10Y': 120, '15Y': 180
  };
  // When cutoffDate is set, find the last entry on or before that date
  let effectiveData = fullData;
  if (cutoffDate) {
    const endIdx = fullData.findLastIndex(d => d.date <= cutoffDate);
    if (endIdx >= 0) {
      effectiveData = fullData.slice(0, endIdx + 1);
    }
  }
  // +1 so the window includes both endpoints: e.g. 1Y = Jun 2025 AND Jun 2026 = 13 data points, 12 monthly intervals.
  // Without +1, slicing 12 points gives Jul 2025–Jun 2026 — off by one month from the financial standard.
  const n = period === 'max' ? effectiveData.length : Math.min((periodMonths[period] || 0) + 1, effectiveData.length);
  const visibleData = effectiveData.slice(effectiveData.length - n);
  if (visibleData.length === 0) return null;

  // 4. Separate into price, drawdown, and SMA-distance arrays for the three charts.
  //    The high water mark restarts at the beginning of the visible window (same basis as
  //    drawdownData below), so a 3Y view answers "worst since 3 years ago", not "worst ever".
  const priceData = withHighWaterMark(
    visibleData.map(d => ({ date: d.date, price: d.price, sma10: d.sma10 }))
  );
  const underwaterPeriods = findUnderwaterPeriods(priceData);

  // Recompute drawdown from scratch within the visible window so the chart
  // reflects the selected period only — not the full history ATH.
  let windowAth = 0;
  const drawdownData = visibleData.map(d => {
    if (d.price > windowAth) windowAth = d.price;
    return { date: d.date, drawdown: windowAth > 0 ? ((d.price - windowAth) / windowAth) * 100 : 0 };
  });

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
  for (let i = 0; i < visibleData.length; i++) {
    const d = visibleData[i];
    if (!maxPricePoint || d.price > maxPricePoint.price) maxPricePoint = { date: d.date, price: d.price };
    if (!minPricePoint || d.price < minPricePoint.price) minPricePoint = { date: d.date, price: d.price };
    if (!maxDrawdownPoint || drawdownData[i].drawdown < maxDrawdownPoint.drawdown) maxDrawdownPoint = { date: d.date, drawdown: drawdownData[i].drawdown };
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
  // A percentage change needs a positive base. Now that a macro series can legitimately
  // start a window at 0 or below, "return" stops meaning anything there — 0% to 2% is not
  // an infinite gain — so say so with null rather than rendering Infinity or a sign-flipped
  // number. Only reachable when a caller passed allowNonPositive.
  const hasReturnBase = startPrice > 0;
  const totalReturn = hasReturnBase ? ((endPrice - startPrice) / startPrice) * 100 : null;

  // Years between first and last data point (using actual dates for accuracy)
  const startDate = new Date(visibleData[0].date);
  const endDate = new Date(visibleData[visibleData.length - 1].date);
  const years = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  // CAGR only for a year or more (the app's one rule, lib/stats.ts: 360+ days, so a 365-day
  // "1Y" window counts); for shorter spans the total return is shown instead
  const cagr = isAnnualisable(years) && hasReturnBase
    ? (Math.pow(endPrice / startPrice, 1 / years) - 1) * 100
    : null;

  return { priceData, drawdownData, smaDistData, underwaterPeriods, maxPricePoint, minPricePoint, maxDrawdownPoint, maxSmaDistPoint, minSmaDistPoint, totalReturn, cagr };
};
