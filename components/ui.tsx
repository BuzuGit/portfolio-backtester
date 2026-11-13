/*
  THE APP'S SHARED DESIGN SYSTEM

  Colours, the heat scale, the standard look of buttons and fields, chart helpers and tooltip texts:
  everything a screen needs to look like the rest of the app. It used to sit at the top of the one
  big PortfolioBacktester.tsx; it lives here so that each tab can have a file of its own and still
  share it. Moved word for word, nothing changed.
*/
import React, { useSyncExternalStore } from 'react';
import { ResponsiveContainer as RechartsResponsiveContainer } from 'recharts';

// ---------------------------------------------------------------------------
// CHART PALETTE (Positions tab)
// ---------------------------------------------------------------------------
// One muted, "heritage" palette shared by every Positions chart, so the graphs
// feel like part of the same app as the slate-grey buttons instead of a set of
// bright default web colors. Think of it as choosing a wardrobe: all the pieces
// come from the same drawer, so anything you pull out matches.
//
// The eight hues were checked with a color-blindness / contrast validator: as a
// running sequence every neighbouring pair is clearly distinguishable, and the
// five asset-class colors are distinguishable from EVERY other one in that set
// (which matters for a pie chart, where all slices are on screen at once).
// The six currency colors can't fully clear that bar — no six-color set can —
// so that chart keeps its text labels on each bar and % labels in each slice,
// which is what carries the meaning if two colors ever look similar.
export const CHART_PALETTE = {
  blue:      'var(--c-blue)',       // steel blue
  terracotta:'var(--c-terracotta)', // burnt orange
  teal:      'var(--c-teal)',       // deep teal
  gold:      'var(--c-gold)',       // antique gold
  rose:      'var(--c-rose)',       // dusty rose
  olive:     'var(--c-olive)',      // olive green
  violet:    'var(--c-violet)',     // muted violet
  wine:      'var(--c-wine)',       // deep wine
} as const;

// ----------------------------------------
// THE APP'S COLOUR THEME ("Calm", chosen on 2026-11-05)
// ----------------------------------------
// Five rules, so every page uses colour the same way:
//  1. GAIN and LOSS are the one green and the one red, for gains and losses only. The green-* and
//     red-* Tailwind classes are the same two colours (tailwind.config.js). Nothing else (a line,
//     a currency, a portfolio) is ever green or red, so a red bar always means a loss.
//  2. heatColor() (below) is the one heat scale for every heat-coloured cell.
//  3. CURRENCY_COLORS and ASSET_CLASS_COLORS give each currency and asset class one colour, on
//     every page.
//  4. SERIES_COLORS is the order portfolios and other lines take their colours in (dark slate
//     first, the app's main colour). MARKET_LINE_COLOR (gold) is world equities wherever it is the
//     yardstick; the 10-month SMA (red: the one exception to rule 1), inflation and the Trend
//     Following strategy have fixed colours. PROFIT_COLOR, the user's favourite yellow, is profit.
//  5. Amber = warning, a blue tint = a highlighted row, grey = neutral.
// Every colour here is a CSS variable, defined once in app/theme.css with its light value and, where
// it differs, its dark value. The names below are only short for var(--c-...), so dark mode needs
// nothing from the code: the browser swaps the colour wherever it is used, however it is applied (a
// fill, a stroke, a gradient stop, a style, a tooltip). To change a colour, change it in theme.css.
export const GAIN = 'var(--c-gain)';
export const LOSS = 'var(--c-loss)';
export const GAIN_DEEP = 'var(--c-gain-deep)';   // text on a pale heat swatch
export const LOSS_DEEP = 'var(--c-loss-deep)';
export const LOSS_TOTAL = 'var(--c-loss-total)'; // the totals above the Portfolio tab's bars
export const GAIN_PILL = 'var(--c-gain-pill)';   // the pale background of a small label inside a chart
export const LOSS_PILL = 'var(--c-loss-pill)';
export const LOSS_AREA = 'var(--c-loss-area)';   // the pale area under a drawdown line
export const BENCH_LABEL = 'var(--c-bench-label)'; // the small figures on world-equities bars
export const WINE_LABEL = 'var(--c-wine-label)';   // text beside a wine or olive marker: those two hues are
export const OLIVE_LABEL = 'var(--c-olive-label)'; // too dim to read as text on a dark card, so it turns grey
export const SLATE = 'var(--c-slate)';           // the app's main dark colour: first series, and PLN
export const SERIES_COLORS = [SLATE, CHART_PALETTE.blue, CHART_PALETTE.teal, CHART_PALETTE.violet, CHART_PALETTE.rose, CHART_PALETTE.wine];
// The 10-month moving average line, on every chart: red, the one exception to rule 1 (the user's
// choice, 2026-11-05 — the SMA has always been the red line, and that is how it is recognised)
export const SMA_COLOR = 'var(--c-sma)';
export const INFLATION_COLOR = CHART_PALETTE.terracotta; // inflation / CPI lines (as EDO and Monthly already had)
export const TREND_COLOR = CHART_PALETTE.teal;         // the Trend Following strategy, beside Buy & Hold in blue
// The app's signature warm yellow (the user's favourite colour, 2026-11-05): one of the theme's
// main colours, used for profit on the Portfolio tab.
export const THEME_YELLOW = 'var(--c-yellow)';
export const PROFIT_COLOR = THEME_YELLOW;
// The neutrals drawn into charts and tooltips. BLACK, INK and SLATE turn near-white in dark mode;
// ON_BLACK is the text written on top of them, which has to turn dark at the same moment.
export const BLACK = 'var(--c-black)';
export const INK = 'var(--c-ink)';
export const INK_SOFT = 'var(--c-ink-soft)';
export const ON_BLACK = 'var(--c-on-black)';
export const MUTED = 'var(--c-muted)';           // axis text
export const MUTED_LABEL = 'var(--c-muted-label)'; // the small figures above bars
export const LINE = 'var(--c-line)';             // grid lines and tooltip borders
export const LINE_FAINT = 'var(--c-line-faint)';
export const LINE_MID = 'var(--c-line-mid)';     // axis lines, and the faint "other series" lines
export const WEIGHT_BAR = 'var(--c-weight-bar)'; // the grey Weight bars behind the % figures on Positions
export const HALO = 'var(--c-halo)';             // the outline that lifts a dot off the line under it
export const CARD = 'var(--c-card)';             // a custom tooltip's background
export const CARD_GLASS = 'var(--c-card-glass)'; // a see-through box over a chart
export const CELL_TEXT = 'var(--c-cell-text)';   // dark figures on a heat cell, light in dark mode

// The one heat scale: 7 colours from deep red (worst) through neutral grey (about zero) to deep
// green (best). `t` runs from -1 to +1. Tables whose numbers are written in the page's normal
// dark text pass maxStrength 0.67, which stops at the middle shades so the text stays readable;
// tables that pick white or dark text per cell (readableTextOn) use the full range.
// Real numbers rather than CSS variables, because in-between shades are worked out from them.
export const HEAT_STOPS = ['#b8423a', '#dc8a82', '#f3d0cc', '#f1f2f4', '#cfe6d6', '#86bf98', '#2f7a4f'];
export const heatColorLight = (t: number, maxStrength = 1): string => {
  // A value that isn't a number (a NaN from missing data) gets the neutral middle colour, rather
  // than an out-of-range stop that would throw and take the whole page down with it
  const c = (Number.isNaN(t) ? 0 : Math.max(-1, Math.min(1, t))) * maxStrength;
  const pos = (c + 1) * 3;                 // 0 … 6 along the stops
  const i = Math.min(5, Math.floor(pos));
  const f = pos - i;                       // how far between stop i and stop i+1
  const rgb = (h: string) => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
  const [a, b] = [rgb(HEAT_STOPS[i]), rgb(HEAT_STOPS[i + 1])];
  return '#' + a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, '0')).join('');
};

// ----------------------------------------
// ONE LOOK FOR EVERY BUTTON AND FILTER
// ----------------------------------------
// Chosen on 2026-11-05 after comparing four mock-ups: Cash Flow Tracker's compact grouped strip,
// in the Markets tab's colours. Use these for every control instead of writing the classes by
// hand: hand-written classes are how the app ended up with ~25 different button looks.
//
//   SEG + segBtn(on)  a pick-one row (Currency, Period, View...): the options sit together in one
//                     light-grey strip, and the chosen one is dark slate with white text. An on/off
//                     switch is a strip with a single button in it.
//   FIELD             a dropdown, date or number box (toolbars and filter bars).
//   FIELD_SM          the same, smaller, for boxes inside a dense row (a portfolio's asset rows).
//   BTN_MAIN          a page's main action (Run Backtest, Add).
//   BTN_SECOND        any other button (+ Add Asset, Show / Hide, Clear...).
//
// Desktop: everything 32px tall. Phones ("max-md:", below 768px): a little taller for fingers.
// Dark mode needs nothing here: app/dark.css already turns bg-gray-100 into the dark grey, and
// bg-slate-800 with white text into the light "selected" pill with dark text.
export const SEG = 'inline-flex items-center gap-0.5 p-[3px] rounded-lg bg-gray-100 shrink-0';
export const segBtn = (on: boolean) =>
  `h-[26px] px-2.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors max-md:h-[34px] max-md:px-3 max-md:text-[13px] ${
    on ? 'bg-slate-800 text-white' : 'text-gray-600 hover:bg-gray-200'
  }`;
export const FIELD = 'h-8 px-2.5 text-xs border border-gray-300 rounded-lg bg-white max-md:h-10 max-md:text-sm';
export const FIELD_SM = 'h-[26px] px-1.5 text-xs border border-gray-300 rounded-md bg-white max-md:h-9';
export const BTN_MAIN = 'h-8 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800 text-white text-xs font-semibold hover:bg-slate-700 disabled:opacity-50 max-md:h-11 max-md:text-[15px]';
export const BTN_SECOND = 'h-8 px-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-medium hover:bg-gray-200 transition-colors max-md:h-11 max-md:text-[15px]';

/**
 * The value label of a LOSS bar, just past the bar's lower end: between the bar and the month /
 * year labels under the chart, where the eye reads it (a gain bar's label sits above it, as
 * position="top" already does). Use as
 *   <LabelList dataKey="…" content={lossBarLabel(v => `${v.toFixed(1)}%`, { fontSize: '11px', fill: LOSS })} />
 * and give the chart room under its lowest bar: <YAxis padding={{ bottom: lossLabelRoom(…) }} />.
 *
 * Why not Recharts' own position="bottom": for a bar below zero, Recharts hands the label a box
 * anchored at one end with a NEGATIVE height back to the other, so "bottom" lands on the zero line
 * and every loss label ended up above the axis instead of under its bar. This works out both ends
 * itself and takes the lower one, whichever way round Recharts gave them.
 */
export const lossBarLabel = (format: (v: number) => string, style: React.CSSProperties = {}) =>
  (props: { x?: string | number; y?: string | number; width?: string | number; height?: string | number; value?: unknown }) => {
    const v = Number(props.value);
    if (props.value === null || props.value === undefined || !isFinite(v) || v >= 0) return null;
    const x = Number(props.x), w = Number(props.width), y = Number(props.y), h = Number(props.height);
    if (![x, w, y, h].every(isFinite)) return null;
    const lower = Math.max(y, y + h);                        // the bar's lower end
    const size = parseFloat(String(style.fontSize ?? 11)) || 11;
    return (
      <text x={x + w / 2} y={lower + size + 1} textAnchor="middle" style={{ fontSize: `${size}px`, fill: LOSS, ...style }}>
        {format(v)}
      </text>
    );
  };
/** Room (px) to leave under a bar chart's lowest bar for its loss label: none if nothing is below zero. */
export const lossLabelRoom = (anyBelowZero: boolean, fontPx: number) => (anyBelowZero ? fontPx + 6 : 0);

// Hover text for XIRR on the Positions tab: what the figure is, and the under-a-year rule in
// calculateXIRR (the Markets Holdings page says the same in its own tooltips).
export const XIRR_HINT = 'XIRR: money-weighted return per year, each purchase, dividend and sale on its own date.\n'
  + 'Held less than a year: the plain total return instead (not annualised).';
// Same rule for the per-purchase CAGR columns in the Positions detail tables.
export const CAGR_LOT_HINT = 'CAGR: this purchase\'s return per year.\n'
  + 'Held less than a year: the plain Return % instead (not annualised).';
// Same rule again for the statistics tables (Backtest, Annual Returns, Portfolio, Trend Following),
// whose figures all come from lib/stats.ts.
export const CAGR_HINT = 'CAGR: compound return per year.\n'
  + 'Periods under a year: the plain total return instead (not annualised).';
export const SHARPE_HINT = 'Sharpe = CAGR ÷ Vol, assuming a 0% risk-free rate.\n'
  + 'Periods under a year: — (there is no annual return to divide).';
// Trend Following is the one place a risk-free rate is subtracted: the cash rate set on that tab.
export const SHARPE_HINT_RF = 'Sharpe = (CAGR − the risk-free rate set above) ÷ Std Dev.\n'
  + 'Periods under a year: — (there is no annual return to divide).';

// PHONE TURNED SIDEWAYS: every chart grows to the height of the screen, so the one you are looking
// at fills it (the page then scrolls from chart to chart; the effect "PHONE TURNED SIDEWAYS" in the
// component scrolls back to the chart you were reading after the turn).
// How: every chart in this file sits in Recharts' ResponsiveContainer, so this stand-in of the same
// name hands each one the screen's height instead of its own fixed height while a phone is held
// sideways, and passes everything through untouched otherwise (desktop, tablets, phones upright).
// The height has to reach the chart itself: resizing only the chart's box from CSS (the first try)
// made charts shorter than the screen leave a blank strip under them, and squeezed taller ones
// narrower to fit.
// Left alone: charts sized by their box ("100%", the small donuts) and charts marked
// keepHeightSideways (the Graphs page's grid of small charts).
export const PHONE_SIDEWAYS = '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)';
export const subscribeSideways = (onChange: () => void) => {
  const mq = window.matchMedia(PHONE_SIDEWAYS);
  mq.addEventListener('change', onChange);
  window.addEventListener('resize', onChange); // the browser's bars coming and going change the height
  return () => { mq.removeEventListener('change', onChange); window.removeEventListener('resize', onChange); };
};
// The height to give charts: the screen less a little room, or 0 when not a phone held sideways
export const sidewaysChartHeight = () =>
  (window.matchMedia(PHONE_SIDEWAYS).matches ? Math.max(240, window.innerHeight - 32) : 0);
export function ResponsiveContainer({ keepHeightSideways, height, ...rest }:
  React.ComponentProps<typeof RechartsResponsiveContainer> & { keepHeightSideways?: boolean }) {
  const sideways = useSyncExternalStore(subscribeSideways, sidewaysChartHeight, () => 0);
  const fill = sideways > 0 && !keepHeightSideways && typeof height === 'number';
  return <RechartsResponsiveContainer {...rest} height={fill ? sideways : height} />;
}

// A filter bar that stays pinned to the top of the window while the page scrolls under it.
// White background so rows passing underneath don't show through; z-40 keeps it (and its
// dropdown menus) above the tables and charts — including the tables' OWN pinned header
// cells, which go up to z-30 (the Correlations corner cell), so anything lower would let that
// cell draw over the filters. For "sticky" to last the whole page, the bar must sit DIRECTLY
// inside the tab's outer box — inside anything shorter it would stop being pinned when that
// shorter box scrolls away.
// Desktop ("md:top-4"): it pins 16px below the top of the window, level with the top of the
// dark sidebar, just under the grey strip that covers those 16px (.page-top-mask in
// globals.css). Phones keep it at the very top.
export const PINNED_FILTERS = 'sticky top-0 md:top-4 z-40 bg-white pt-2 pb-1';
