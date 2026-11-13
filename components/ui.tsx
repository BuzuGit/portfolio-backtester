/*
  THE APP'S SHARED DESIGN SYSTEM

  Colours, the heat scale, the standard look of buttons and fields, chart helpers and tooltip texts:
  everything a screen needs to look like the rest of the app. It used to sit at the top of the one
  big PortfolioBacktester.tsx; it lives here so that each tab can have a file of its own and still
  share it. Moved word for word, nothing changed.
*/
import React, { useSyncExternalStore } from 'react';
import { ResponsiveContainer as RechartsResponsiveContainer } from 'recharts';
import { isPhoneScreen } from '@/lib/savedSheet';
import type { AssetsAnnualReturns } from '@/lib/assetStats';

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

// Asset class colors for the breakdown chart and table color dots
export const ASSET_CLASS_COLORS: Record<string, string> = {
  'Fixed Income': CHART_PALETTE.olive, 'Equities': CHART_PALETTE.wine,
  'Crypto': CHART_PALETTE.rose, 'Alternatives': CHART_PALETTE.violet,
  'Metals & Crypto': CHART_PALETTE.gold, // gold-ish to represent the physical + crypto nature
  // Cash is deliberately the one grey in the set. It is not an investment competing with the
  // others for attention, and a muted slice reads as "not at work yet" at a glance.
  'Cash': 'var(--c-cash)',
};

// One colour per currency, on EVERY page (theme rule 3): Positions' by-currency chart, the
// Portfolio tab's yearly bars and drawdowns, the currency toggles. PLN, the home currency, takes
// the app's main dark slate. USD is the green-teal and SGD the blue (the user's choice, 2026-11-07).
// None of them is the gain green or the loss red, so a currency never reads as a gain or a loss.
export const CURRENCY_COLORS: Record<string, string> = {
  PLN: SLATE, USD: CHART_PALETTE.teal, SGD: CHART_PALETTE.blue,
  EUR: CHART_PALETTE.violet, CHF: CHART_PALETTE.rose,
  'M&C': CHART_PALETTE.gold, // matches the Metals & Crypto asset class color
};

// Return Map (Best To Worst tab): one fixed colour per asset, so the same asset is easy to spot
// in every year column. The 8-colour CHART_PALETTE is too small for ~30 assets, so this is a
// separate grid: 10 hues × 3 shades (medium, dark, light) + 2 greys = 32 colours. Checked with a
// perceptual colour-difference test: the closest pair still differs by ΔE 14.9 (above ~10 reads as
// clearly different). With more than 32 assets on the map, colours start repeating.
export const RETURN_MAP_ASSET_COLORS = [
  '#a02222', '#a06122', '#a08b22', '#61a022', '#22a061', '#22a0a0', '#226ba0', '#2237a0', '#6122a0', '#a02276',
  '#631d1d', '#63401d', '#63571d', '#40631d', '#1d6340', '#1d6363', '#1d4663', '#1d2863', '#401d63', '#631d4b',
  '#d45454', '#d49454', '#d4bf54', '#94d454', '#54d494', '#54d4d4', '#549fd4', '#5469d4', '#9454d4', '#d454a9',
  '#5c6b73', '#9aa5ad',
];

/**
 * Picks white or near-black text for a coloured cell — whichever has the higher contrast ratio
 * on that background, using the WCAG accessibility formula (the eye sees green as much brighter
 * than blue, so a plain RGB average would get this wrong).
 */
export const readableTextOn = (color: string): string => {
  // The sums need real numbers, so a theme colour (var(--c-teal)) is first looked up in
  // the page. Before the page exists (the server's first pass) there is nothing to look it up in,
  // but this table only ever appears after the data has loaded in the browser.
  const hex = color.startsWith('var(') && typeof document !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue(color.slice(4, -1)).trim()
    : color;
  const n = parseInt(hex.slice(1), 16);
  const linear = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  // Relative luminance: 0 = black, 1 = white
  const lum = 0.2126 * linear((n >> 16) & 255) + 0.7152 * linear((n >> 8) & 255) + 0.0722 * linear(n & 255);
  // Contrast vs white, and vs the #1f2937 text colour (luminance ≈ 0.02)
  return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.07 ? '#ffffff' : '#1f2937';
};

/**
 * Is dark mode on right now? The "dark" class on <html> is the one source of truth: app/layout.tsx
 * sets it before the first paint, and the button at the top of the left panel flips it.
 */
export const isDarkTheme = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

/**
 * Phones only: colour the phone's own bars above and below the page (clock/battery strip, browser
 * bar, Android's bottom bar) to match the mode, so dark mode isn't framed by white strips. Sets
 * every copy of each tag, because React adds a second status-bar tag while the page starts up.
 * The tags are first set by phoneBarColours in app/layout.tsx; desktop skips this entirely.
 */
export const setPhoneBarColours = (dark: boolean) => {
  if (!isPhoneScreen()) return;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#0e1014' : '#f1f2f4'));
  document.querySelectorAll('meta[name="apple-mobile-web-app-status-bar-style"]').forEach(m => m.setAttribute('content', dark ? 'black' : 'default'));
};

/**
 * Heatmap cell colour, adjusted for dark mode. The heatmaps run from white (nothing to see) to a
 * strong colour (look here), and their colours are computed in code, so app/dark.css can't reach
 * them. In dark mode this keeps the hue and turns the lightness upside down, like a photo negative
 * that keeps its colours: the white end becomes near-black (blends into the dark card) and the
 * strong end stays strong, so "brighter = bigger" still holds. In light mode the colour comes back
 * untouched. Accepts "#rgb", "#rrggbb", "rgb(r, g, b)" or "hsl(h, s%, l%)"; returns "#rrggbb".
 */
export const themedCell = (color: string): string => {
  if (!isDarkTheme()) return color;
  const nums = (color.match(/-?[\d.]+/g) ?? []).map(Number);
  // Work in hue / saturation / lightness (H in degrees, S and L from 0 to 1)
  let H = 0, S = 0, L = 0;
  if (color.startsWith('hsl')) {
    // Already in that form: read it straight off
    [H, S, L] = [nums[0], nums[1] / 100, nums[2] / 100];
  } else {
    let r: number, g: number, b: number;
    if (color.startsWith('#')) {
      // "#fff" is shorthand for "#ffffff": each digit doubled
      const hex = color.length === 4 ? color.slice(1).split('').map(c => c + c).join('') : color.slice(1);
      const n = parseInt(hex, 16);
      [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    } else if (color.startsWith('rgb')) {
      [r, g, b] = nums;
    } else {
      return color; // a colour format we don't know: leave it alone
    }
    // rgb → hsl (standard formula)
    const [R, G, B] = [r / 255, g / 255, b / 255];
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const d = max - min;
    L = (max + min) / 2;
    S = d === 0 ? 0 : d / (1 - Math.abs(2 * L - 1));
    if (d !== 0) {
      if (max === R) H = 60 * (((G - B) / d) % 6);
      else if (max === G) H = 60 * ((B - R) / d + 2);
      else H = 60 * ((R - G) / d + 4);
    }
  }
  // Flip the lightness: white (1) → 0.11, about the dark card colour; mid tones stay mid.
  // Slightly less saturated, because full-strength colour glares on a dark page.
  const [r2, g2, b2] = hslToRgb((H + 360) % 360, S * 0.8, 0.11 + (1 - L) * 0.85);
  return `#${[r2, g2, b2].map(c => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
};

/** hsl → [r, g, b] (0–255), the standard formula. H in degrees, S and L from 0 to 1. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))));
  return [f(0), f(8), f(4)];
}


/** The one heat scale (heatColorLight, with the theme at the top of the file), dark-mode aware. */
export const heatColor = (t: number, maxStrength = 1): string => themedCell(heatColorLight(t, maxStrength));

/**
 * Return Map "Return" highlight and the Markets / Holdings heat cells: pale for returns near zero,
 * deep green for big gains, deep red for big losses. Anything beyond ±40% gets the deepest shade so
 * one outlier doesn't wash out the rest. (Their cells pick white or dark text per colour.)
 */
export const returnHeatColor = (ret: number): string => heatColor(ret / 40);

/**
 * Correlation (-1 to +1) on the one heat scale:
 * +1 (move together, little diversification) → red; 0 (independent) → neutral grey;
 * -1 (move opposite, great diversification) → green.
 */
export const getCorrelationColor = (value: number): string => heatColor(-value, 0.67);

/**
 * ============================================================
 * THE one way to print a PER-SHARE ASSET PRICE, app-wide.
 * ============================================================
 *
 * Precision slides with magnitude, so every price carries roughly the same number
 * of MEANINGFUL digits instead of the same number of decimal places:
 *
 *      below 2      → 3 decimals   0.776,  1.355
 *      2 – 99       → 2 decimals   4.28,   43.77
 *      100 – 999    → 1 decimal    507.0
 *      1000 and up  → 0 decimals   114,056
 *
 * WHY IT SLIDES: two decimals is right for a share priced in tens, but on a 0.85
 * holding it throws real information away — 0.844 and 0.851 both collapse to "0.85",
 * so a 1% move looks like no move at all. At the other end, ".00" on a five-figure
 * crypto price is noise that just makes a dense grid wider.
 *
 * WHY THE FIRST STEP IS AT 2 AND NOT 1: nothing magic about either, but a chunk of
 * the portfolio (Singapore REITs, some bond ETFs) trades in the 0.5–1.9 band, and
 * cutting at 1 left exactly those holdings on two decimals. 2 covers the band.
 *
 * Formats via toLocaleString, so prices of 1000+ keep their thousands separator.
 *
 * Judged on MAGNITUDE, so a negative behaves like its positive twin.
 *
 * SCOPE: per-share PRICES only. Portfolio values, invested capital, P&L, commissions
 * and cash balances are money totals with their own formatting — they are not prices
 * and must not be routed through here.
 */
export const priceDecimals = (n: number): number => {
  const magnitude = Math.abs(n);
  if (magnitude < 2) return 3;
  if (magnitude < 100) return 2;
  if (magnitude < 1000) return 1;
  return 0;
};

/**
 * The four number formatters formatPrice needs, built once and reused.
 *
 * WHY NOT JUST toLocaleString: that call builds a fresh Intl.NumberFormat every time,
 * which costs ~20µs — about 230x what the old toFixed cost. Cheap once, but the
 * Monthly tab's price grid is ~370 cells and repaints on every hover, so it was
 * paying roughly 7ms per render purely to format numbers. Reusing the formatter is
 * ~40x faster and produces byte-identical output (verified against toLocaleString
 * over 300k random and edge-case values, negatives and NaN included).
 *
 * Keyed by decimal count, of which priceDecimals only ever returns four.
 */
export const PRICE_FORMATTERS = new Map<number, Intl.NumberFormat>();

/** A per-share asset price as display text. See priceDecimals above for the rule. */
export const formatPrice = (price: number): string => {
  const decimals = priceDecimals(price);
  let formatter = PRICE_FORMATTERS.get(decimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    PRICE_FORMATTERS.set(decimals, formatter);
  }
  return formatter.format(price);
};

// PHONES ONLY (every "max-md:" class applies below 768px of width and nowhere else, so none of
// the phone fixes below can change the desktop or laptop layout).
// A row of small option buttons (Currency, Period...) wider than a phone screen used to push past
// the right edge, and then the browser zooms the WHOLE page out, or lets it slide sideways, to
// show it. On a phone such a row instead scrolls sideways on its own, like a strip of chips,
// and the rest of the page stays put.
export const PHONE_SCROLL_ROW = 'max-md:overflow-x-auto max-md:max-w-full';

// How much history the Monthly tab's charts show. Named once, so the button row, the
// state and getMonthlyChartData's lookup table can never drift apart.
export type MonthlyChartPeriod = '1Y' | '2Y' | '3Y' | '4Y' | '5Y' | '6Y' | '7Y' | '8Y' | '9Y' | '10Y' | '15Y' | 'max';

/**
 * Generates tooltip text for a specific asset/year cell.
 * Shows the calculation details so users understand how the return was computed.
 *
 * Example output: "2023: $100.00 (Dec 30, 2022) → $110.00 (Dec 29, 2023) = +10.00%"
 */
export const getReturnTooltip = (ticker: string, year: number, annualReturns: AssetsAnnualReturns): string => {
  const data = annualReturns[ticker]?.[year];
  if (!data) return 'No data available';

  // Format dates to show month, day, and year (e.g., "Dec 30, 2022")
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Format the return with a + or - sign
  const returnSign = data.return >= 0 ? '+' : '';
  const returnStr = `${returnSign}${data.return.toFixed(2)}%`;

  return `${year}: $${formatPrice(data.startPrice)} (${formatDate(data.startDate)}) → $${formatPrice(data.endPrice)} (${formatDate(data.endDate)}) = ${returnStr}`;
};

/**
 * Generates tooltip text for period return columns (1Y, 2Y, etc.)
 */
export const getPeriodReturnTooltip = (data: { startDate: string; startPrice: number; endDate: string; endPrice: number; return: number }): string => {
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const returnSign = data.return >= 0 ? '+' : '';
  return `${formatDate(data.startDate)} ($${formatPrice(data.startPrice)}) → ${formatDate(data.endDate)} ($${formatPrice(data.endPrice)}) = ${returnSign}${data.return.toFixed(2)}%`;
};

/**
 * Heatmap colour for a value's position in a min–max range (used by the Annual prices table):
 * lowest = red, middle = neutral grey, highest = green, on the theme's one heat scale
 * (heatColor). These cells keep the page's normal dark text, so the scale stops at its
 * middle shades (0.67) to stay readable.
 */
export const getHeatmapColor = (value: number, min: number, max: number): string => {
  if (min === max) return heatColor(0);
  const position = (value - min) / (max - min);   // 0 = min, 1 = max
  return heatColor(position * 2 - 1, 0.67);
};

/**
 * Price heatmap: lowest red → middle neutral → highest green, per row, on the one heat scale.
 * Used for all price tables (Monthly prices, Annual prices, detail view prices). Only the
 * background colour changes; the text keeps the page's normal colour.
 */
export const getPriceHeatmap = (value: number, min: number, max: number): string => {
  if (min === max) return heatColor(0);
  const pos = (value - min) / (max - min); // 0 = min, 1 = max
  return heatColor(pos * 2 - 1, 0.67);
};
