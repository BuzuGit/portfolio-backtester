/*
  THE MARKETS TAB: RETURNS, STATS AND COUNTRY PAGES

  Every asset (or a country's markets and currency) in one table for the chosen period and currency:
  period returns or CAGR / Vol / Sharpe / drawdown statistics, with a trend chart beside it.
  The tables come from lib/markets.ts. Clicking an asset opens it on the Monthly tab, so the
  filter and Monthly setters are passed in; every choice here lives in the main screen.
*/
import React from 'react';
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, Customized } from 'recharts';
import type { AssetLookup } from '@/lib/fetchData';
import { formatPeriod } from '@/lib/backtest';
import {
  COUNTRY_CURRENCIES, COUNTRY_NAMES, MARKETS_PERIODS, STATS_YEARS, currencyBasketMove, formatFxRate, summariseMatrix,
  type MarketRow, type MarketsCurrency, type MarketsPeriod, type ReturnMatrix, type ValueWorking,
} from '@/lib/markets';
import { PhoneChoice, periodOptions } from '@/components/PhoneSheet';
import {
  CHART_PALETTE, GAIN, INK, LINE, LINE_MID, LOSS, MUTED, PHONE_SCROLL_ROW, PINNED_FILTERS, ResponsiveContainer, SEG,
  formatPrice, readableTextOn, returnHeatColor, segBtn,
} from '@/components/ui';
import { EdgeBubbles, type BubbleDef } from '@/components/charts';

type TrendRange = '1Y' | '3Y' | '5Y' | '10Y' | 'Max';

export interface MarketsTabProps {
  assetLookup: AssetLookup[];
  getAssetCurrency: (ticker: string) => string;
  activeMarketsCategory: string;
  marketsIsCountry: boolean;
  marketsMatrix: ReturnMatrix | null;
  marketsView: 'returns' | 'stats'; setMarketsView: (v: 'returns' | 'stats') => void;
  marketsPeriod: MarketsPeriod; setMarketsPeriod: (p: MarketsPeriod) => void;
  marketsSavedPeriod: React.MutableRefObject<Record<'returns' | 'stats', MarketsPeriod>>;
  marketsCurrency: MarketsCurrency; setMarketsCurrency: (c: MarketsCurrency) => void;
  marketsCountry: Exclude<MarketsCurrency, 'Native'>; setMarketsCountry: (c: Exclude<MarketsCurrency, 'Native'>) => void;
  marketsTrendPeriod: TrendRange; setMarketsTrendPeriod: (p: TrendRange) => void;
  marketsChartRange: TrendRange; setMarketsChartRange: (p: TrendRange) => void;
  setActiveView: (v: 'monthlyPrices') => void;
  setMonthlySelectedTicker: (t: string) => void;
  setMonthlyDisplayCurrency: (c: string) => void;
  setSelectedAssetTickers: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedAssetClasses: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedCurrencies: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedAssetSubcategories: React.Dispatch<React.SetStateAction<string[]>>;
}

export default function MarketsTab({
  assetLookup, getAssetCurrency, activeMarketsCategory, marketsIsCountry, marketsMatrix, marketsView, setMarketsView,
  marketsPeriod, setMarketsPeriod, marketsSavedPeriod, marketsCurrency, setMarketsCurrency, marketsCountry,
  setMarketsCountry, marketsTrendPeriod, setMarketsTrendPeriod, marketsChartRange, setMarketsChartRange,
  setActiveView, setMonthlySelectedTicker, setMonthlyDisplayCurrency, setSelectedAssetTickers,
  setSelectedAssetClasses, setSelectedCurrencies, setSelectedAssetSubcategories,
}: MarketsTabProps) {
  const m = marketsMatrix;
  const allRows = m ? m.sections.flatMap(s => s.rows) : [];

  // "+12.3" / "-4.5" / "0.0" — rounded first, so a -0.04 never prints as "-0.0".
  const fmtRet = (v: number): string => {
    const r = Math.round(v * 10) / 10;
    if (r === 0) return '0.0';
    // From 1,000% up (long "Max" histories) the decimal is noise and would widen the cell.
    return `${r > 0 ? '+' : ''}${Math.abs(r) >= 1000 ? r.toFixed(0) : r.toFixed(1)}`;
  };

  // Macro rows (rates in bp, inflation in %) follow different rules from prices:
  //  - colours are REVERSED: rising rates/inflation show red, falling green;
  //  - rate rows are in basis points, so they get their own bar and colour scale.
  const isMacroKind = (r: MarketRow) => r.kind === 'rate' || r.kind === 'cpi' || r.kind === 'cpiyoy';
  const isMacroTable = allRows.length > 0 && allRows.every(isMacroKind);
  // The Country page mixes both kinds in one table, so the column layout is decided per
  // SECTION: a section of rates/inflation gets Value / ATH / vs peak, any other section
  // gets Price / Curr DD / Signal. (On the Assets and Macro pages every section agrees.)
  const isMacroSection = (rs: MarketRow[]) => rs.length > 0 && rs.every(isMacroKind);
  const hasMacroRows = allRows.some(isMacroKind);
  const hasPriceRows = allRows.some(r => !isMacroKind(r));
  // The currency the returns are in: the chosen country on the Country page.
  const viewCurrency: MarketsCurrency = marketsIsCountry ? marketsCountry : marketsCurrency;
  const fmtBp = (v: number): string => {
    const r = Math.round(v);
    return r === 0 ? '0' : `${r > 0 ? '+' : ''}${r}`;
  };
  // 1Y-rate cells are LEVELS (3.2 = inflation was 3.2% back then), so no +/- sign like a change.
  const fmtCell = (r: MarketRow, v: number) => (r.kind === 'rate' ? fmtBp(v) : r.kind === 'cpiyoy' ? v.toFixed(1) : fmtRet(v));
  // Macro rows keep a rate / YoY inflation in the row's price fields; it is a percentage,
  // not a share price, so it is printed as one ("4.00%") rather than through formatPrice.
  const fmtPct = (v: number) => `${v.toFixed(2)}%`;
  const fmtPct1 = (v: number) => `${v.toFixed(1)}%`; // inflation: one decimal is enough

  // Bar chart scale for the focused period: from the most negative to the most positive
  // row, always including zero, so every bar starts from the same zero line. Prices, rates
  // (bp) and inflation each get their own scale (+85 bp would otherwise dwarf +3%
  // inflation, and a +20% equity would make inflation bars invisible).
  type BarGroup = 'pct' | 'bp' | 'cpi' | 'yoy';
  const barGroup = (r: MarketRow): BarGroup =>
    (r.kind === 'rate' ? 'bp' : r.kind === 'cpi' ? 'cpi' : r.kind === 'cpiyoy' ? 'yoy' : 'pct');
  const barScale = (group: BarGroup) => {
    const vals = allRows.filter(r => barGroup(r) === group)
      .map(r => r.returns[marketsPeriod]).filter((v): v is number => v !== null);
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const span = (hi - lo) || 1;
    return { span, zeroPct: (-lo / span) * 100 };
  };
  const barScales = { pct: barScale('pct'), bp: barScale('bp'), cpi: barScale('cpi'), yoy: barScale('yoy') };
  // "Inflation 1Y rate" cells are coloured by LEVEL, one scale for the whole section: the
  // highest rate anywhere in it is the deepest red, low inflation a light red, deflation
  // (below zero) green. So this is the largest |rate| across all its cells.
  const yoyCap = Math.max(1e-9, ...allRows.filter(r => r.kind === 'cpiyoy')
    .flatMap(r => MARKETS_PERIODS.map(p => r.returns[p]))
    .filter((v): v is number => v !== null).map(Math.abs));
  // The theme's one gain green and one loss red, exactly as the bar charts on Monthly and
  // Backtest draw them (they used to be a lighter heat-cell shade: two greens for one
  // meaning).
  const BAR_UP = GAIN, BAR_DOWN = LOSS;

  // The sparkline shows the last N years of each row's full history: N years of monthly
  // steps = 12N + 1 month-end points (all of it on "Max").
  const trendPoints = { '1Y': 13, '3Y': 37, '5Y': 61, '10Y': 121, 'Max': Infinity }[marketsTrendPeriod]; // Max = whole history

  // Trend line drawn as a tiny SVG: green if it ends above where it started, red if
  // below (the other way round for Macro rows, where "up" is rising rates or inflation).
  const sparkline = (vals: number[], reversed = false) => {
    if (vals.length < 2) return <span className="text-gray-300">–</span>;
    const W = 80, H = 24;
    const lo = Math.min(...vals), hi = Math.max(...vals), sp = (hi - lo) || 1;
    const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * W).toFixed(1)},${(H - 1 - ((v - lo) / sp) * (H - 2)).toFixed(1)}`).join(' ');
    const col = (vals[vals.length - 1] >= vals[0]) !== reversed ? GAIN : LOSS;
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block">
        <polygon points={`0,${H} ${pts} ${W},${H}`} fill={col} opacity={0.08} />
        <polyline points={pts} fill="none" stroke={col} strokeWidth={1.25} strokeLinejoin="round" />
      </svg>
    );
  };

  // "Oct 2026", flagged as month-to-date when the latest row is the current calendar month.
  // Fixed English month names rather than the browser's locale, which writes "Sept" in
  // British English — so every label on the page reads the same way ("Sep 2026").
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
  const isMtd = !!m && m.endDate.slice(0, 7) === new Date().toISOString().slice(0, 7);
  // KPI tiles, four at most. Category pages: Leader / Laggard / Positive / Trend. The Country
  // page has macro tiles instead (currency vs basket, inflation, policy rate, ...), so the
  // Leader/Laggard summary is only worked out for the category pages.
  const summary = m && !marketsIsCountry ? summariseMatrix(m, marketsPeriod) : null;
  const basket = m && marketsIsCountry ? currencyBasketMove(m, marketsPeriod) : null;
  // One KPI tile. `name` set = Leader/Laggard layout (figure on the label line, name as the
  // headline); otherwise figure + `sub` text. Passing the list through kpiTiles() gives
  // every tile this exact shape, so a misspelt or missing field is a compile error.
  type KpiTile = {
    label: string; value: string; name: string; sub: string; cls: string;
    nameCls?: string; nameSuffix?: string; title?: string;
  };
  const kpiTiles = (tiles: KpiTile[]) => tiles;
  // Country page, Inflation tile: today's 1Y inflation rate vs the rate at the start of the
  // selected period (same comparison as the "Now vs …" column of the Inflation 1Y rate row).
  const inflRow = marketsIsCountry ? allRows.find(r => r.kind === 'cpiyoy') : undefined;
  const inflWk = inflRow?.working[marketsPeriod] ?? null;
  const inflDiff = inflWk ? inflWk.end.result - inflWk.start.result : null;
  // Country page, Unemployment tile: the unemployment rate now vs at the start of the selected
  // period, in pp (the row is stored like a rate: a level in %, its "returns" a change in bp).
  const unempRow = marketsIsCountry
    ? allRows.find(r => r.kind === 'rate' && /unemploy/i.test(`${r.ticker} ${r.name}`))
    : undefined;
  const unempWk = unempRow?.working[marketsPeriod] ?? null;
  const unempDiff = unempWk ? unempWk.end.result - unempWk.start.result : null;
  // Country page, Policy rate tile: the LAST decision of the reference rate (a RATE_ row; the
  // 10Y yield is a market rate, not policy, and unemployment isn't a rate at all — without
  // that exclusion Singapore, which has no RATE_ row, showed its unemployment here).
  const policyRow = marketsIsCountry
    ? (allRows.find(r => r.kind === 'rate' && /^RATE/i.test(r.ticker))
      ?? allRows.find(r => r.kind === 'rate' && !/^10Y/i.test(r.ticker) && r !== unempRow))
    : undefined;
  const policyMove = policyRow?.lastMove ?? null;
  const policyBp = policyMove ? Math.round((policyMove.to - policyMove.from) * 100) : null;
  // A row's level: exchange rates to 4 decimals, share prices through the app-wide formatPrice.
  const fmtLevel = (isFx: boolean, v: number) => (isFx ? formatFxRate(v) : formatPrice(v));
  // Hover text for a return cell: which prices, FX rates and dates produced the number.
  //   S&P 500 · YTD return in EUR: +5.96%
  //   Start 31 Dec 2025: 820.1 USD × 3.5918 (USDPLN) ÷ 4.2166 (EURPLN) = 698.6 EUR
  //   End 31 Oct 2026 (month to date): 833.8 USD × 3.8958 (USDPLN) ÷ 4.3884 (EURPLN) = 740.2 EUR
  //   Return = end ÷ start − 1
  const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${monthLabel(d)}`; // "30 Sep 2026"
  const fmtWorking = (r: MarketRow, w: ValueWorking): string => {
    const first = r.isFx
      ? (w.firstLabel ? `${w.firstLabel} ${formatFxRate(w.first)}` : formatFxRate(w.first))
      : `${formatPrice(w.first)} ${w.firstLabel}`;
    if (!w.ops.length) return first;
    const ops = w.ops.map(o => ` ${o.op} ${formatFxRate(o.value)} (${o.label})`).join('');
    return `${first}${ops} = ${fmtLevel(r.isFx, w.result)} ${w.resultUnit}`;
  };
  const returnTooltip = (r: MarketRow, p: MarketsPeriod, v: number): string => {
    const w = r.working[p];
    // Rates: change in bp, plus the % growth of the rate itself (when it started above zero).
    if (r.kind === 'rate') {
      const head = `${r.name} · ${p} change: ${fmtBp(v)} bp`;
      if (!w) return head;
      const growth = w.start.result > 0
        ? `${fmtRet((w.end.result / w.start.result - 1) * 100)}%`
        : 'n/a (starting rate was zero or negative)';
      return `${head}\n`
        + `Start ${dayLabel(w.startDate)}: ${w.start.result.toFixed(2)}%\n`
        + `End ${dayLabel(w.endDate)}: ${w.end.result.toFixed(2)}%\n`
        + `Change = end − start = ${fmtBp(v)} bp (${w.end.result >= w.start.result ? '+' : ''}${(w.end.result - w.start.result).toFixed(2)} pp)\n`
        + `Growth = end ÷ start − 1 = ${growth}`;
    }
    // Inflation 1Y rate: the YoY rate back then vs today, and which way it has moved since.
    if (r.kind === 'cpiyoy') {
      const when = p === 'YTD' ? 'at last December' : p === 'Max' ? 'at the start of the data' : `${p} before the latest print`;
      const head = `${r.name} · 1Y inflation rate ${when}: ${v.toFixed(2)}%`;
      if (!w) return head;
      const diff = w.end.result - w.start.result;
      // Same words and the same 0.05 pp "unchanged" band as the column and the KPI tile.
      const trend = Math.abs(diff) < 0.05 ? 'unchanged' : diff > 0 ? 'accelerating' : 'easing';
      return `${head}\n`
        + `${monthLabel(w.startDate)}: ${w.start.result.toFixed(2)}% year-on-year\n`
        + `Now (${monthLabel(w.endDate)}, last CPI print): ${w.end.result.toFixed(2)}%\n`
        + `Change since: ${diff >= 0 ? '+' : ''}${diff.toFixed(2)} pp → ${trend}`;
    }
    // Inflation: the CPI index at both ends, anchored at the last real CPI print.
    if (r.kind === 'cpi') {
      const head = `${r.name} · ${p} inflation: ${fmtRet(v)}%`;
      if (!w) return head;
      return `${head}\n`
        + `Start ${dayLabel(w.startDate)}: CPI ${w.start.result.toFixed(2)}\n`
        + `End ${dayLabel(w.endDate)} (last CPI print): CPI ${w.end.result.toFixed(2)}\n`
        + `Inflation = end ÷ start − 1 = ${fmtRet((w.end.result / w.start.result - 1) * 100)}%`;
    }
    const ccy = viewCurrency === 'Native' ? `${r.priceCurrency} (own currency)` : viewCurrency;
    const head = `${r.name} · ${p} return${r.isFx ? '' : ` in ${ccy}`}: ${fmtRet(v)}%`;
    if (!w) return head;
    const mtd = isMtd && w.endDate.slice(0, 7) === m?.endDate.slice(0, 7) ? ' (month to date)' : '';
    return `${head}\n`
      + `Start ${dayLabel(w.startDate)}: ${fmtWorking(r, w.start)}\n`
      + `End ${dayLabel(w.endDate)}${mtd}: ${fmtWorking(r, w.end)}\n`
      + `Return = end ÷ start − 1 = ${(w.end.result / w.start.result - 1 >= 0 ? '+' : '')}${((w.end.result / w.start.result - 1) * 100).toFixed(2)}%`;
  };
  // Hover text explaining the Signal column (header and every BUY/SELL cell).
  const SIGNAL_RULE = '10-month SMA trend signal (same rule as the Monthly tab):\n'
    + '• SMA = average of the last 10 month-end prices, current month included, in the asset\'s own currency.\n'
    + '• BUY when the latest price is above the SMA, SELL when it is at or below it.\n'
    + '• Needs a price in each of those 10 months; otherwise shown as –.';
  // Clicking an asset name opens it in the Monthly tab's detail panel. That panel closes
  // itself if the asset is hidden by the Monthly filters (Assets / Class / Currency /
  // Subcategory), so first make sure each filter lets this asset through — only ever ADDING
  // it, never removing anything else you had selected. Then select it, switch tab, and
  // scroll to the panel once drawn.
  // Currency: an ordinary asset opens in the currency chosen here (MWIG40 viewed in USD
  // stays in USD), or in its own currency when this tab is on "Native". FX and Macro
  // rows open in their own currency, because this tab never converts those either.
  const openInMonthly = (r: MarketRow) => {
    const ticker = r.ticker;
    const a = assetLookup.find(x => x.ticker === ticker);
    if (!a) return;
    const add = (list: string[], v: string) => (v && !list.includes(v) ? [...list, v] : list);
    setSelectedAssetTickers(prev => add(prev, a.ticker));
    setSelectedAssetClasses(prev => add(prev, a.assetClass));
    setSelectedCurrencies(prev => add(prev, a.currency));
    setSelectedAssetSubcategories(prev => add(prev, a.assetSubcategory));
    setMonthlySelectedTicker(ticker);
    setMonthlyDisplayCurrency(
      // (Monthly offers PLN/USD/EUR/CHF/SGD; a GBP or JPY country page opens natively.)
      r.kind === 'asset' && viewCurrency !== 'Native' && ['PLN', 'USD', 'EUR', 'CHF', 'SGD'].includes(viewCurrency)
        ? viewCurrency : getAssetCurrency(ticker),
    );
    setActiveView('monthlyPrices');
    // The Monthly tab is heavy; look for the panel a few times rather than guessing a delay.
    let tries = 0;
    const scroll = () => {
      const el = document.getElementById('monthly-asset-detail');
      // An instant jump (not 'smooth'): we are switching tabs anyway, and it lands reliably.
      if (el) el.scrollIntoView({ block: 'start' });
      else if (++tries < 20) setTimeout(scroll, 100);
    };
    setTimeout(scroll, 50);
  };

  // name + bar + periods + trend + price + (DD + signal | ATH + vs peak) — four after the periods either way
  const colCount = 2 + (m ? m.columns.length : 0) + 4;

  // ---- STATS VIEW ----
  // A section switches to Stats when the Stats button is on and every row in it is an asset or
  // an FX pair (FX is shown as an asset here; macro sections keep their own columns).
  // Columns, for the selected period:
  // a Max DD bar, CAGR, 2x time, Vol, Sharpe, Max DD, Longest DD, Curr DD, the trend line,
  // then the calendar-year returns for the stress years (STATS_YEARS: 2018, 2020, 2022).
  const isStatsSection = (s: { rows: MarketRow[] }) =>
    marketsView === 'stats' && s.rows.length > 0 && s.rows.every(r => r.kind === 'asset' || r.kind === 'fx');
  const statsRows = m ? m.sections.filter(isStatsSection).flatMap(s => s.rows) : [];
  const maxAbs = (vals: (number | null | undefined)[]) =>
    Math.max(1e-9, ...vals.filter((v): v is number => v !== null && v !== undefined).map(Math.abs));
  const ddLo = Math.min(0, ...statsRows.map(r => r.stats[marketsPeriod]?.maxDD ?? 0)) || -1;
  const cagrCap = maxAbs(statsRows.map(r => r.stats[marketsPeriod]?.cagr));
  const yearCaps = Object.fromEntries(STATS_YEARS.map(y => [y, maxAbs(statsRows.map(r => r.yearReturns[y]))]));
  const heatCell = (v: number | null, cap: number, text: string, title: string) => {
    if (v === null) return <td className="px-0.5 py-0.5 text-center text-xs text-gray-300">–</td>;
    const bg = returnHeatColor(Math.max(-1, Math.min(1, v / cap)) * 40);
    return (
      <td className="px-px py-0.5" title={title}>
        <div className="rounded px-1 py-1 cursor-help text-center text-xs tabular-nums" style={{ background: bg, color: readableTextOn(bg) }}>{text}</div>
      </td>
    );
  };
  const plainCell = (text: string | null, title: string, cls = 'text-gray-800') =>
    text === null
      ? <td className="px-0.5 py-0.5 text-center text-xs text-gray-300">–</td>
      : <td className={`px-1 py-0.5 text-center text-xs tabular-nums cursor-help ${cls}`} title={title}>{text}</td>;
  const renderStatsSection = (s: { name: string; rows: MarketRow[] }) => (
    <>
      <tr className="bg-gray-100 text-[11px] uppercase tracking-wide text-gray-500">
        <th className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap">{s.name}</th>
        {/* Phones: no drawdown bar (Max DD is also a column), so more figures show at once */}
        <th className="text-left font-medium px-3 py-2 max-md:hidden">
          <div className="w-[200px]"><span className="text-gray-800 font-semibold">{marketsPeriod === 'Max' ? 'Max drawdown · all history' : `Max drawdown · ${marketsPeriod}`}</span></div>
        </th>
        {['CAGR', '2x time', 'Vol', 'Sharpe', 'Max DD', 'Longest DD', 'Curr DD'].map(h => (
          <th key={h} className="text-center font-medium px-0.5 py-2 w-14 leading-tight">{h}</th>
        ))}
        <th className="text-left font-medium px-2 py-2 whitespace-nowrap">{marketsTrendPeriod === 'Max' ? 'Full' : marketsTrendPeriod} trend</th>
        {STATS_YEARS.map(y => <th key={y} className="text-center font-medium px-0.5 py-2 w-14">{y}</th>)}
      </tr>
      {s.rows.map(r => {
        const st = r.stats[marketsPeriod];
        const span = st ? `${monthLabel(st.startDate)} – ${monthLabel(st.endDate)} (${formatPeriod(st.months)})` : '';
        const w = st ? (Math.abs(st.maxDD) / Math.abs(ddLo)) * 100 : 0;
        return (
          <tr key={r.ticker} className="border-b border-gray-100 hover:bg-gray-50">
            <td className="px-3 py-1 whitespace-nowrap">
              <button type="button" onClick={() => openInMonthly(r)}
                className="text-gray-800 hover:text-slate-900 hover:underline underline-offset-2 text-left"
                title={`${r.ticker} — open full details in the Monthly tab`}>{r.name}</button>
            </td>
            {/* Max drawdown bar: hangs left from zero at the right edge */}
            <td className="px-3 py-1 max-md:hidden" title={st ? `Worst peak-to-trough fall, ${span}` : ''}>
              {!st ? <span className="text-gray-300 text-xs">–</span> : (
                <div className="relative h-4 mx-10">
                  <div className="absolute top-0 bottom-0 w-px bg-gray-300" style={{ left: '100%' }} />
                  <div className="absolute top-0.5 bottom-0.5 rounded-sm" style={{ left: `${100 - w}%`, width: `${w}%`, background: BAR_DOWN }} />
                  <span className="absolute top-1/2 -translate-y-1/2 text-xs tabular-nums text-gray-700 whitespace-nowrap"
                    style={{ right: `calc(${w}% + 4px)` }}>{st.maxDD.toFixed(1)}%</span>
                </div>
              )}
            </td>
            {heatCell(st?.cagr ?? null, cagrCap, st?.cagr != null ? `${fmtRet(st.cagr)}%` : '', `CAGR (compound annual growth), ${span}`)}
            {plainCell(st?.doublingYears != null ? (st.doublingYears > 99 ? '>99y' : formatPeriod(Math.round(st.doublingYears * 12))) : null,
              st?.cagr != null ? `Years to double the money at ${st.cagr.toFixed(2)}% a year (ln 2 ÷ ln(1 + CAGR))` : '')}
            {plainCell(st?.vol != null ? `${st.vol.toFixed(1)}%` : null, `Annualised volatility: std. dev. of monthly returns × √12, ${span}`)}
            {plainCell(st?.sharpe != null ? st.sharpe.toFixed(2) : null, `Sharpe = CAGR ÷ Vol (0% risk-free rate, as elsewhere in the app), ${span}`)}
            {plainCell(st ? `${st.maxDD.toFixed(1)}%` : null, `Max drawdown, ${span}`, 'text-red-700')}
            {plainCell(st ? (st.longestDDMonths === 0 ? '0m' : formatPeriod(st.longestDDMonths)) : null, `Longest stretch below a previous peak, ${span}`)}
            {plainCell(st ? (st.currDD > -0.01 ? 'Peak' : `${st.currDD.toFixed(1)}%`) : null,
              `Current drawdown from the highest value in the window, ${span}`, st && st.currDD > -0.01 ? 'text-green-700 font-semibold' : 'text-red-600')}
            <td className="px-2 py-1">{sparkline(r.spark.slice(-trendPoints))}</td>
            {STATS_YEARS.map(y => (
              <React.Fragment key={y}>
                {heatCell(r.yearReturns[y] ?? null, yearCaps[y], r.yearReturns[y] != null ? fmtRet(r.yearReturns[y] as number) : '',
                  r.isFx
                    ? `${y}: change in ${r.name} (Dec ${y - 1} → Dec ${y}); + = ${r.name.split('/')[0]} strengthened`
                    : `${y} calendar-year return in ${viewCurrency === 'Native' ? r.priceCurrency : viewCurrency} (Dec ${y - 1} → Dec ${y})`)}
              </React.Fragment>
            ))}
          </tr>
        );
      })}
    </>
  );

  // ---- MACRO CHARTS ----
  // Under the "Inflation 1Y rate", "Reference Rates" and "10Y Rates" sections:
  //  - Macro page: one line per country, each ending in a bubble with today's value
  //    (the app's shared right-edge bubbles, which push apart so they never overlap);
  //  - Country page: a monthly bar chart of that country's series, black above zero,
  //    red below (like the rolling-return bars elsewhere in the app).
  // History comes from the row (inflation ends at the last real CPI print); the range
  // buttons (1Y … Max, default Max) are shared by every chart.
  const ymKey = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
  const shortMonth = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`;
  const countryCode = (r: MarketRow) => r.name.trim().split(/\s+/).pop() || r.ticker; // "Rate PL" -> "PL"
  const SERIES_COLOURS = Object.values(CHART_PALETTE);
  const RANGE_MONTHS = { '1Y': 12, '3Y': 36, '5Y': 60, '10Y': 120, 'Max': Infinity } as const;
  const macroChart = (s: { name: string; rows: MarketRow[] }) => {
    const kind = s.rows.every(r => r.kind === 'cpiyoy') ? 'cpiyoy' : s.rows.every(r => r.kind === 'rate') ? 'rate' : null;
    const rows = s.rows.filter(r => (r.history?.length ?? 0) > 1);
    if (!kind || rows.length === 0) return null;
    const latest = Math.max(...rows.map(r => ymKey(r.history![r.history!.length - 1].date)));
    const cutoff = latest - RANGE_MONTHS[marketsChartRange];
    const inRange = (d: string) => ymKey(d) >= cutoff;
    const dp = kind === 'cpiyoy' ? 1 : 2;
    // No title: the chart sits right under its own section, which already names it.
    const header = (
      <div className="flex items-center justify-end mb-1">
        {/* Phones: one box that opens a slide-up panel */}
        <div className="hidden max-md:flex w-1/2">
          <PhoneChoice
            label="Chart range"
            options={periodOptions(['1Y', '3Y', '5Y', '10Y', 'Max'])}
            selected={marketsChartRange}
            onPick={rg => setMarketsChartRange(rg as typeof marketsChartRange)}
          />
        </div>
        <div className={`${SEG} max-md:hidden`}>
          {(['1Y', '3Y', '5Y', '10Y', 'Max'] as const).map(rg => (
            <button key={rg} type="button" onClick={() => setMarketsChartRange(rg)}
              className={segBtn(marketsChartRange === rg)}>{rg}</button>
          ))}
        </div>
      </div>
    );
    const axisProps = { fontSize: 11, fill: MUTED };
    const pctTick = (v: number) => `${v.toFixed(v !== 0 && Math.abs(v) < 1 ? 1 : 0)}%`;

    // Country page: one bar chart per row (normally one), black >= 0, red < 0.
    if (marketsIsCountry) {
      return rows.map(r => {
        const data = r.history!.filter(h => inRange(h.date)).map(h => ({ date: h.date, v: h.v }));
        return (
          <tr key={`chart-${r.ticker}`}><td colSpan={colCount} className="pt-2 pb-4 px-1">
            {header}
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barCategoryGap={1}>
                <XAxis dataKey="date" tickFormatter={shortMonth} tick={axisProps} minTickGap={40} tickLine={false} axisLine={{ stroke: LINE_MID }} />
                <YAxis tickFormatter={pctTick} tick={axisProps} width={44} tickLine={false} axisLine={false} />
                <ReferenceLine y={0} stroke="#9ca3af" />
                <Tooltip
                  formatter={(v: number) => [`${v.toFixed(dp)}%`, r.name]}
                  labelFormatter={(d: string) => shortMonth(d)}
                  cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                />
                <Bar dataKey="v" isAnimationActive={false}>
                  {data.map(d => <Cell key={d.date} fill={d.v < 0 ? LOSS : INK} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </td></tr>
        );
      });
    }

    // Macro page: all countries in one line chart, merged on date.
    const byDate = new Map<string, Record<string, number | string>>();
    rows.forEach(r => r.history!.forEach(h => {
      if (!inRange(h.date)) return;
      if (!byDate.has(h.date)) byDate.set(h.date, { date: h.date });
      byDate.get(h.date)![r.ticker] = h.v;
    }));
    const data = Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const colourOf = (i: number) => SERIES_COLOURS[i % SERIES_COLOURS.length];
    const bubbles: BubbleDef[] = rows.map((r, i) => {
      const last = r.history![r.history!.length - 1].v;
      return { value: last, color: colourOf(i), label: `${countryCode(r)} ${last.toFixed(dp)}%` };
    });
    return (
      <tr key={`chart-${s.name}`}><td colSpan={colCount} className="pt-2 pb-4 px-1">
        {header}
        <ResponsiveContainer width="100%" height={364}>
          <LineChart data={data} margin={{ top: 8, right: 70, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={LINE} />
            <XAxis dataKey="date" tickFormatter={shortMonth} tick={axisProps} minTickGap={40} tickLine={false} axisLine={{ stroke: LINE_MID }} />
            <YAxis tickFormatter={pctTick} tick={axisProps} width={44} tickLine={false} axisLine={false} />
            <ReferenceLine y={0} stroke="#9ca3af" />
            <Tooltip
              formatter={(v: number, key: string) => {
                const r = rows.find(x => x.ticker === key);
                return [`${v.toFixed(dp)}%`, r ? countryCode(r) : key];
              }}
              labelFormatter={(d: string) => shortMonth(d)}
              itemSorter={item => -(Number(item.value) || 0)}
            />
            <Legend verticalAlign="top" height={24} iconType="plainline" wrapperStyle={{ fontSize: 11 }}
              formatter={(key: string) => { const r = rows.find(x => x.ticker === key); return r ? countryCode(r) : key; }} />
            {rows.map((r, i) => (
              <Line key={r.ticker} dataKey={r.ticker} stroke={colourOf(i)} strokeWidth={1.5} dot={false}
                connectNulls isAnimationActive={false} />
            ))}
            <Customized component={<EdgeBubbles defs={bubbles} />} />
          </LineChart>
        </ResponsiveContainer>
      </td></tr>
    );
  };

  // Returns / Stats switch (the desktop buttons and the phone box both use it)
  const switchMarketsView = (v: 'returns' | 'stats') => {
    if (v === marketsView) return;
    // Park this view's period, restore the other view's (Stats starts on 5Y).
    marketsSavedPeriod.current[marketsView] = marketsPeriod;
    const next = marketsSavedPeriod.current[v];
    setMarketsView(v);
    setMarketsPeriod(next);
    if (next === '1Y' || next === '3Y' || next === '5Y' || next === '10Y' || next === 'Max') setMarketsTrendPeriod(next);
  };

  return (
    <div className="mt-2">
      {/* Page-level filters: currency for every return figure, period for the bars and tiles. */}
      {/* "Native" = no conversion. Which category is shown is chosen in the left panel. */}
      {/* Phones: not pinned ("max-md:static"), it scrolls away with the page, leaving the */}
      {/* small screen to the table (same on the Holdings and EDO sections below). */}
      <div className={`${PINNED_FILTERS} max-md:static mb-4 flex flex-wrap items-center gap-x-6 gap-y-2`}>
        {/* Phones: Currency, Period and View as boxes on one row that open slide-up panels */}
        <div className="hidden max-md:flex w-full gap-2">
          {marketsIsCountry
            ? <PhoneChoice
                label="Country"
                options={COUNTRY_CURRENCIES.map(c => ({ value: c, label: c, hint: COUNTRY_NAMES[c] }))}
                selected={marketsCountry}
                onPick={c => setMarketsCountry(c as typeof marketsCountry)}
              />
            : <PhoneChoice
                label="Currency"
                options={(['Native', 'PLN', 'USD', 'EUR', 'CHF', 'SGD'] as const).map(c => ({ value: c, label: c }))}
                selected={marketsCurrency}
                onPick={c => setMarketsCurrency(c as MarketsCurrency)}
              />}
          <PhoneChoice
            label="Period"
            options={periodOptions(MARKETS_PERIODS)}
            selected={marketsPeriod}
            onPick={v => {
              const p = v as MarketsPeriod;
              setMarketsPeriod(p);
              if (p === '1Y' || p === '3Y' || p === '5Y' || p === '10Y' || p === 'Max') setMarketsTrendPeriod(p);
            }}
          />
          {!isMacroTable && (
            <PhoneChoice
              label="View"
              options={[{ value: 'returns', label: 'Returns', hint: 'period returns' }, { value: 'stats', label: 'Stats', hint: 'CAGR, volatility, drawdowns' }]}
              selected={marketsView}
              onPick={v => switchMarketsView(v as 'returns' | 'stats')}
            />
          )}
        </div>
        <div className={`flex items-center gap-1 ${PHONE_SCROLL_ROW} max-md:hidden`}>
          <span className="text-xs text-gray-500 mr-1">Currency:</span>
          <span className={SEG}>
          {marketsIsCountry
            // Country page: the currency IS the country (PLN = Poland...), so no "Native",
            // and GBP / JPY are offered too. Separate from the other pages' currency choice.
            ? COUNTRY_CURRENCIES.map(c => (
                <button
                  key={c}
                  onClick={() => setMarketsCountry(c)}
                  title={COUNTRY_NAMES[c]}
                  className={segBtn(marketsCountry === c)}
                >{c}</button>
              ))
            : (['Native', 'PLN', 'USD', 'EUR', 'CHF', 'SGD'] as const).map(c => (
                <button
                  key={c}
                  onClick={() => setMarketsCurrency(c)}
                  className={segBtn(marketsCurrency === c)}
                >{c}</button>
              ))}
          </span>
        </div>
        <div className={`flex items-center gap-1 ${PHONE_SCROLL_ROW} max-md:hidden`}>
          <span className="text-xs text-gray-500 mr-1">Period:</span>
          <span className={SEG}>
          {MARKETS_PERIODS.map(p => (
            <button
              key={p}
              onClick={() => {
                setMarketsPeriod(p);
                if (p === '1Y' || p === '3Y' || p === '5Y' || p === '10Y' || p === 'Max') setMarketsTrendPeriod(p);
              }}
              className={segBtn(marketsPeriod === p)}
            >{p}</button>
          ))}
          </span>
        </div>
        {/* Returns (default) or Stats for the asset sections; not offered where there are no assets */}
        {!isMacroTable && (
          <div className="flex items-center gap-1 max-md:hidden">
            <span className="text-xs text-gray-500 mr-1">View:</span>
            <span className={SEG}>
            {([['returns', 'Returns'], ['stats', 'Stats']] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => switchMarketsView(v)}
                className={segBtn(marketsView === v)}
              >{label}</button>
            ))}
            </span>
          </div>
        )}
        {/* (The Category choice lives in the left panel, under "Markets".) */}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        {/* Card header */}
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div>
            <h3 className="text-md font-semibold text-gray-800 inline">Return matrix</h3>
            <span className="text-xs text-gray-500 ml-2 uppercase tracking-wide">
              {marketsIsCountry
                ? `${COUNTRY_NAMES[marketsCountry] ?? marketsCountry} · returns in ${marketsCountry} · rates in bp`
                : <>{activeMarketsCategory} · {isMacroTable
                  ? 'rates: change in bp · inflation: cumulative %'
                  : `total return in ${marketsCurrency === 'Native' ? "each asset's own currency" : marketsCurrency}`}</>}
            </span>
          </div>
          {m && (
            <span className="text-xs text-gray-500 border border-gray-200 rounded px-2 py-0.5">
              Data as of {monthLabel(m.endDate)}{isMtd ? ' (month to date)' : ''}
            </span>
          )}
        </div>

        {!m || allRows.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">
            {marketsIsCountry
              ? <>No rows have SnapshotCountry = &quot;{marketsCountry}&quot; in the Lookup tab yet.</>
              : <>No rows have SnapshotCategory = &quot;{activeMarketsCategory}&quot; in the Lookup tab yet.</>}
          </p>
        ) : (
          <>
            {/* Summary tiles for the focused period. Hidden for Macro: there a "leader" would */}
            {/* compare a change in bp with an inflation %, which means nothing. */}
            {/* Leader/Laggard put the ASSET NAME up front in bold — "which one" is the point of */}
            {/* those tiles. Trend is today's 10-month-SMA signal, so it has no period in its label. */}
            {/* Leader and Laggard get wider tiles (1.3 shares each vs 1) because they hold */}
            {/* the only long text — an asset name — and that name must fit on one line. */}
            {/* The Country page has no Leader/Laggard, so its four tiles share the row equally. */}
            {!isMacroTable && <div className={`grid grid-cols-2 gap-2 mb-4 ${marketsIsCountry ? 'md:grid-cols-4' : 'md:grid-cols-[1.3fr_1.3fr_1fr_1fr]'}`}>
              {kpiTiles([
                ...(marketsIsCountry ? [] : [
                  { label: `Leader · ${marketsPeriod}`, value: summary?.leader ? fmtRet(summary.leader.value) : '–', name: summary?.leader?.name ?? '', sub: '', cls: 'text-green-700' },
                  { label: `Laggard · ${marketsPeriod}`, value: summary?.laggard ? fmtRet(summary.laggard.value) : '–', name: summary?.laggard?.name ?? '', sub: '', cls: 'text-red-700' },
                ]),
                ...(marketsIsCountry ? [
                  // Country page: the currency against an equal-weighted basket of the others.
                  {
                      label: `${marketsCountry} vs basket · ${marketsPeriod}`,
                      value: basket ? `${fmtRet(basket.value)}%` : '–',
                      // Shown like Leader/Laggard: the verdict is the headline, in its colour.
                      name: !basket ? '' : basket.value > 0 ? 'Appreciated' : basket.value < 0 ? 'Depreciated' : 'Unchanged',
                      nameCls: !basket || basket.value === 0 ? 'text-gray-900' : basket.value > 0 ? 'text-green-700' : 'text-red-700',
                      sub: '',
                      cls: !basket || basket.value === 0 ? 'text-gray-800' : basket.value > 0 ? 'text-green-700' : 'text-red-700',
                      title: basket
                        ? `${marketsCountry} against an equal-weighted basket of ${basket.parts.length} currencies, ${marketsPeriod}:\n`
                          + basket.parts.map(p => `  ${p.name}  ${fmtRet(p.value)}%`).join('\n')
                          + `\nBasket = geometric average of these moves; + = ${marketsCountry} appreciated.`
                        : '',
                    },
                ] : []),
                ...(marketsIsCountry ? [
                  // Inflation: Accelerating (red) / Easing (green) vs the selected period, in pp.
                  (() => {
                    const flat = inflDiff !== null && Math.abs(inflDiff) < 0.05;
                    const up = inflDiff !== null && !flat && inflDiff > 0;
                    const cls = inflDiff === null || flat ? 'text-gray-900' : up ? 'text-red-700' : 'text-green-700';
                    return {
                      label: `Inflation · ${marketsPeriod}`,
                      value: inflDiff === null ? '–' : flat ? '0.0 pp' : `${up ? '+' : '−'}${Math.abs(inflDiff).toFixed(1)} pp`,
                      name: inflDiff === null ? 'No data' : flat ? 'Unchanged' : up ? 'Accelerating' : 'Easing',
                      nameCls: cls, sub: '', cls,
                      title: inflWk && inflRow
                        ? `${inflRow.name}: 1Y inflation now ${inflWk.end.result.toFixed(2)}% (${monthLabel(inflWk.endDate)})\n`
                          + `vs ${inflWk.start.result.toFixed(2)}% (${monthLabel(inflWk.startDate)}) at the start of the ${marketsPeriod} period`
                        : 'No inflation row tagged for this country',
                    };
                  })(),
                  // Policy rate: the last decision, Hiking (red) / Cutting (green), in bp.
                  (() => {
                    const up = policyBp !== null && policyBp > 0;
                    // A move that rounds to 0 bp (only possible for sub-0.5 bp changes) is no move.
                    const moved = policyMove !== null && policyBp !== null && policyBp !== 0;
                    const cls = !moved ? 'text-gray-900' : up ? 'text-red-700' : 'text-green-700';
                    return {
                      // Short label so it stays on ONE line in the narrow tile (a wrapped label
                      // made the whole row of tiles taller); the decision month sits after the
                      // verdict in small print, e.g. "Cutting  Mar 26".
                      label: 'Policy rate',
                      value: !moved ? '–' : `${up ? '+' : '−'}${Math.abs(policyBp ?? 0)} bp`,
                      name: !moved ? (policyRow ? 'No change' : 'No data') : (up ? 'Hiking' : 'Cutting'),
                      nameSuffix: moved && policyMove ? `${MONTHS[Number(policyMove.date.slice(5, 7)) - 1]} ${policyMove.date.slice(2, 4)}` : '',
                      nameCls: cls, sub: '', cls,
                      title: policyMove && policyRow
                        ? `${policyRow.name}: last decision in ${monthLabel(policyMove.date)}, `
                          + `${policyMove.from.toFixed(2)}% → ${policyMove.to.toFixed(2)}% (${up ? '+' : '−'}${Math.abs(policyBp ?? 0)} bp)\n`
                          + `Now ${policyRow.price !== null ? fmtPct(policyRow.price) : "–"}. (Month-end data: a decision shows in the month it took effect.)`
                        : 'No reference rate tagged for this country',
                    };
                  })(),
                  // Unemployment: Rising (red) / Falling (green) vs the selected period, in pp —
                  // laid out like the Inflation tile, with the same 0.05 pp "unchanged" band.
                  (() => {
                    const flat = unempDiff !== null && Math.abs(unempDiff) < 0.05;
                    const up = unempDiff !== null && !flat && unempDiff > 0;
                    const cls = unempDiff === null || flat ? 'text-gray-900' : up ? 'text-red-700' : 'text-green-700';
                    return {
                      label: `Unemployment · ${marketsPeriod}`,
                      value: unempDiff === null ? '–' : flat ? '0.0 pp' : `${up ? '+' : '−'}${Math.abs(unempDiff).toFixed(1)} pp`,
                      name: unempDiff === null ? 'No data' : flat ? 'Unchanged' : up ? 'Rising' : 'Falling',
                      nameCls: cls, sub: '', cls,
                      title: unempWk && unempRow
                        ? `${unempRow.name}: unemployment now ${unempWk.end.result.toFixed(2)}% (${monthLabel(unempWk.endDate)})\n`
                          + `vs ${unempWk.start.result.toFixed(2)}% (${monthLabel(unempWk.startDate)}) at the start of the ${marketsPeriod} period`
                        : 'No unemployment row tagged for this country',
                    };
                  })(),
                ] : [
                  { label: `Positive · ${marketsPeriod}`, value: summary ? `${summary.positive}/${summary.total}` : '–', name: '', sub: 'assets above 0', cls: 'text-gray-800' },
                  { label: 'Trend · 10M SMA', value: summary ? `${summary.buy}/${summary.signalTotal}` : '–', name: '', sub: 'on BUY signal', cls: 'text-gray-800' },
                ]),
              ]).map(t => (
                <div
                  key={t.label}
                  title={t.title || undefined}
                  className={`rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 min-w-0 ${t.title ? 'cursor-help' : ''}`}
                >
                  {t.name ? (
                    <>
                      {/* Figure sits up on the label line so the name gets a whole line to */}
                      {/* itself, on ONE line. truncate is only a last resort on a phone. */}
                      {/* Phones: a label or name too long for the half-width tile wraps onto a */}
                      {/* second line instead of being cut off with "…" ("max-md:whitespace-normal"). */}
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[10px] uppercase tracking-wide text-gray-500 whitespace-nowrap truncate max-md:whitespace-normal">{t.label}</span>
                        <span className={`text-sm font-bold tabular-nums max-md:whitespace-nowrap ${t.cls}`}>{t.value}</span>
                      </div>
                      <div className={`text-sm leading-5 font-semibold whitespace-nowrap truncate max-md:whitespace-normal ${t.nameCls ?? 'text-gray-900'}`} title={t.name}>
                        {t.name}
                        {/* optional small print after the name, e.g. the policy decision month */}
                        {t.nameSuffix && (
                          <span className="text-[10px] leading-none font-normal text-gray-500 ml-1.5">{t.nameSuffix}</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 whitespace-nowrap truncate max-md:whitespace-normal">{t.label}</div>
                    {/* Phones: the small note on its own line under the figure ("best − worst") */}
                    <div className="text-sm">
                      <span className={`font-semibold tabular-nums ${t.cls}`}>{t.value}</span>
                      <span className="text-xs text-gray-500 ml-2 max-md:block max-md:ml-0">{t.sub}</span>
                    </div>
                    </>
                  )}
                </div>
              ))}
            </div>}

            {/* In Stats view the Stats sections and the sections that keep their Returns columns */}
            {/* (FX, macro) go in two separate tables: one table has ONE set of column widths, and */}
            {/* the two layouts don't line up column for column, so sharing would stretch both. */}
            {/* The same goes for price sections (Price second) and macro sections (Value at the */}
            {/* end) on the Country page, which has both: one table per layout, in page order. */}
            {(['stats', 'price', 'macro'] as const)
              .map(kind => m.sections.filter(s => (isStatsSection(s) ? 'stats' : isMacroSection(s.rows) ? 'macro' : 'price') === kind))
              .filter(g => g.length > 0).map((group, gi) => (
            // Phones: the Stats table is still wider than the screen, so its names stay put on
            // the left while the figures swipe ("phone-pin-first" in globals.css)
            <div key={gi} className={`overflow-x-auto ${gi > 0 ? 'mt-4' : ''} ${isStatsSection(group[0]) ? 'phone-pin-first' : ''}`}>
              <table className="w-full text-sm border-collapse">
                <tbody>
                  {group.map((s, si) => (
                    <React.Fragment key={s.name}>
                      {/* A little air between one category's last row and the next category's header */}
                      {si > 0 && <tr><td colSpan={colCount} className="h-4" /></tr>}
                      {isStatsSection(s) ? renderStatsSection(s) : (<>
                      {/* Each category carries its own copy of the column headers, with the */}
                      {/* category name (e.g. "EQUITIES") in the first cell instead of "Asset". */}
                      <tr className="bg-gray-100 text-[11px] uppercase tracking-wide text-gray-500">
                        <th className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap">{s.name}</th>
                        {/* Price/asset sections show the Price second, right after the name */}
                        {!isMacroSection(s.rows) && <th className="text-right font-medium px-2 py-2">Price</th>}
                        {/* The fixed-width div is what holds this column open: a table ignores min-width */}
                        {/* on cells, and the bars inside are absolutely positioned so they claim no width. */}
                        {/* PHONES: the table keeps only the name, the price and the selected period's */}
                        {/* cell (the Period box picks which), so it fits the screen: the bar, the other */}
                        {/* periods, the trend line and the last columns are "max-md:hidden". */}
                        <th className="text-left font-medium px-3 py-2 max-md:hidden">
                          <div className="w-[200px]"><span className="text-gray-800 font-semibold">{
                            s.rows.every(r => r.kind === 'cpiyoy')
                              ? (marketsPeriod === 'YTD' ? 'Now vs Dec' : marketsPeriod === 'Max' ? 'Now vs start' : `Now vs ${marketsPeriod} ago`)
                              : marketsPeriod === 'Max' ? (isMacroSection(s.rows) ? 'Change since start' : 'Return since start') : `${marketsPeriod} ${isMacroSection(s.rows) ? 'change' : 'return'}`
                          }</span></div>
                        </th>
                        {m.columns.map(p => (
                          <th
                            key={p}
                            className={`text-center px-0.5 py-2 w-14 ${p === marketsPeriod ? 'text-gray-900 font-bold' : 'font-medium max-md:hidden'}`}
                          >
                            <span className={p === marketsPeriod ? 'border-b-2 border-slate-800 pb-0.5' : ''}>
                              {p}{['3Y', '5Y', '10Y', 'Max'].includes(p) && <sup className="text-[8px] ml-px">c</sup>}
                            </span>
                          </th>
                        ))}
                        <th className="text-left font-medium px-2 py-2 whitespace-nowrap max-md:hidden">{marketsTrendPeriod === 'Max' ? 'Full' : marketsTrendPeriod} trend</th>
                        {isMacroSection(s.rows) ? (
                          <>
                            <th className="text-right font-medium px-2 py-2 cursor-help" title="Latest rate, or latest year-on-year inflation">Value</th>
                            <th className="text-right font-medium px-2 py-2 cursor-help max-md:hidden" title="Highest value ever recorded (rate, or YoY inflation)">ATH</th>
                            <th className="text-right font-medium px-2 py-2 whitespace-nowrap cursor-help max-md:hidden" title="ATH − current value, in percentage points">vs peak</th>
                          </>
                        ) : (
                          <>
                            <th className="text-right font-medium px-2 py-2 whitespace-nowrap max-md:hidden" title="Current drawdown: how far the latest price is below its all-time high (asset's own currency)">Curr DD</th>
                            <th className="text-center font-medium px-2 py-2 cursor-help max-md:hidden" title={SIGNAL_RULE}>Signal</th>
                          </>
                        )}
                      </tr>
                      {s.rows.map(r => {
                        const fv = r.returns[marketsPeriod];
                        const macro = isMacroKind(r);
                        const { span: barSpan, zeroPct } = barScales[barGroup(r)];
                        const w = fv === null ? 0 : (Math.abs(fv) / barSpan) * 100;
                        // Bar colour: green = up for prices; reversed for rates/inflation.
                        const barColour = fv !== null && (fv >= 0) !== macro ? BAR_UP : BAR_DOWN;
                        const stale = !!r.priceDate && r.priceDate.slice(0, 7) !== m.endDate.slice(0, 7);
                        return (
                          <tr key={r.ticker} className="border-b border-gray-100 hover:bg-gray-50">
                            {/* Phones: a long name ("10Y Yield US - 5.29%") may wrap rather than widen the table */}
                            <td className="px-3 py-1 whitespace-nowrap max-md:whitespace-normal">
                              <button
                                type="button"
                                onClick={() => openInMonthly(r)}
                                className="text-gray-800 hover:text-slate-900 hover:underline underline-offset-2 text-left"
                                title={`${r.ticker} — open full details in the Monthly tab${r.isFx ? ` (shows the sheet's ${r.ticker} series)` : ''}`}
                              >
                                {/* Inflation 1Y rate and rate/yield rows carry today's level in the name */}
                                {/* ("Inflation PL - 3.2%", "Rate PL - 3.75%", "10Y Yield US - 5.29%"), so the */}
                                {/* changes next to it read against it directly. Rates keep two decimals. */}
                                {r.price !== null && r.kind === 'cpiyoy' ? `${r.name} - ${fmtPct1(r.price)}`
                                  : r.price !== null && r.kind === 'rate' ? `${r.name} - ${fmtPct(r.price)}`
                                  : r.name}
                              </button>
                            </td>

                            {/* Price/asset sections: latest price second, right after the name, in the asset's */}
                            {/* own currency — red if below last month-end, black otherwise. */}
                            {!isMacroSection(s.rows) && (
                              <td className="px-2 py-1 text-right text-xs whitespace-nowrap tabular-nums">
                                {r.price === null ? <span className="text-gray-300">–</span> : (
                                  <>
                                    <span className={r.priceUp === false ? 'text-red-600' : 'text-gray-900'}>{fmtLevel(r.isFx, r.price)}</span>
                                    <span className="text-[9px] text-gray-400 ml-0.5">{r.priceCurrency}</span>
                                    {stale && <span className="text-[10px] text-amber-600 ml-1" title={`Latest price is from ${r.priceDate}`}>({monthLabel(r.priceDate)})</span>}
                                  </>
                                )}
                              </td>
                            )}

                            {/* Horizontal bar for the focused period; label sits just past the bar's end. */}
                            {/* Inflation 1Y rate rows show a verdict instead: today's rate vs the rate at the */}
                            {/* selected period — "Accelerating +0.2 pp" (red) or "Easing −0.5 pp" (green). */}
                            <td className="px-3 py-1 max-md:hidden">
                              {r.kind === 'cpiyoy' ? (() => {
                                const wk = r.working[marketsPeriod];
                                if (!wk) return <span className="text-gray-300 text-xs">–</span>;
                                const diff = wk.end.result - wk.start.result;
                                const flat = Math.abs(diff) < 0.05; // rounds to 0.0 pp
                                const verdict = flat ? 'Unchanged' : diff > 0 ? 'Accelerating' : 'Easing';
                                const cls = flat ? 'text-gray-600' : diff > 0 ? 'text-red-700' : 'text-green-700';
                                return (
                                  <div
                                    className={`text-xs font-semibold whitespace-nowrap cursor-help ${cls}`}
                                    title={`Now ${wk.end.result.toFixed(2)}% (${monthLabel(wk.endDate)}) vs ${wk.start.result.toFixed(2)}% (${monthLabel(wk.startDate)})`}
                                  >
                                    {verdict}{!flat && <>{' '}<span className="tabular-nums ml-1">{diff > 0 ? '+' : '−'}{Math.abs(diff).toFixed(1)} pp</span></>}
                                  </div>
                                );
                              })() : fv === null ? <span className="text-gray-300 text-xs">–</span> : (
                                <div className="relative h-4 mx-10">
                                  <div className="absolute top-0 bottom-0 w-px bg-gray-300" style={{ left: `${zeroPct}%` }} />
                                  <div
                                    className="absolute top-0.5 bottom-0.5 rounded-sm"
                                    style={{ left: `${fv >= 0 ? zeroPct : zeroPct - w}%`, width: `${w}%`, background: barColour }}
                                  />
                                  <span
                                    className="absolute top-1/2 -translate-y-1/2 text-xs tabular-nums text-gray-700 whitespace-nowrap"
                                    style={fv >= 0 ? { left: `calc(${zeroPct + w}% + 4px)` } : { right: `calc(${100 - zeroPct + w}% + 4px)` }}
                                  >{fmtCell(r, fv)}{r.kind === 'rate' && <span className="text-[9px] text-gray-400 ml-0.5">bp</span>}</span>
                                </div>
                              )}
                            </td>

                            {/* One heat-coloured cell per period; each column has its own colour scale */}
                            {m.columns.map(p => {
                              const v = r.returns[p];
                              // Phones: only the selected period's cell (see the header row)
                              const phoneHide = p === marketsPeriod ? '' : 'max-md:hidden';
                              if (v === null) return <td key={p} className={`px-0.5 py-0.5 text-center text-xs text-gray-300 ${phoneHide}`}>–</td>;
                              // Rate rows use the bp scale; Macro rows flip the colour (up = red).
                              const cap = r.kind === 'cpiyoy' ? yoyCap
                                : r.kind === 'rate' ? m.colourCapsBp[p] : r.kind === 'cpi' ? m.colourCapsCpi[p] : m.colourCaps[p];
                              const bg = returnHeatColor(Math.max(-1, Math.min(1, v / cap)) * 40 * (macro ? -1 : 1));
                              return (
                                <td key={p} className={`px-px py-0.5 ${phoneHide}`} title={returnTooltip(r, p, v)}>
                                  <div className="rounded px-1 py-1 cursor-help text-center text-xs tabular-nums" style={{ background: bg, color: readableTextOn(bg) }}>
                                    {fmtCell(r, v)}
                                  </div>
                                </td>
                              );
                            })}

                            <td className="px-2 py-1 max-md:hidden">{sparkline(r.spark.slice(-trendPoints), macro)}</td>

                            {isMacroSection(s.rows) ? (
                              <>
                                {/* Value: latest rate / YoY inflation — red if it rose vs the month before */}
                                <td className="px-2 py-1 text-right text-xs whitespace-nowrap tabular-nums">
                                  {r.price === null ? <span className="text-gray-300">–</span> : (
                                    <>
                                      {/* Inflation to one decimal (3.2%); rates keep two (3.75%), where 0.05 matters */}
                                      <span className={r.priceUp === true ? 'text-red-600' : 'text-gray-900'}>
                                        {r.kind === 'cpi' || r.kind === 'cpiyoy' ? fmtPct1(r.price) : fmtPct(r.price)}
                                      </span>
                                      {stale && <span className="text-[10px] text-gray-900 ml-1" title={`Latest value is from ${r.priceDate}${r.kind === 'cpi' || r.kind === 'cpiyoy' ? ' (last CPI print)' : ''}`}>({monthLabel(r.priceDate)})</span>}
                                    </>
                                  )}
                                </td>
                                {/* ATH: highest value ever recorded */}
                                <td
                                  className={`px-2 py-1 text-right text-xs tabular-nums cursor-help max-md:hidden ${r.isAtAth ? 'font-semibold text-red-700' : 'text-gray-700'}`}
                                  title={r.athPrice === null ? '' : `Highest ${r.kind === 'cpi' ? 'YoY inflation' : 'value'} recorded: ${fmtPct(r.athPrice)} (${monthLabel(r.athDate)})${r.isAtAth ? ' — at that peak now' : ''}`}
                                >
                                  {r.athPrice === null ? '–' : `${fmtPct(r.athPrice)}`}
                                </td>
                                {/* vs peak: ATH − current, in percentage points */}
                                <td
                                  className="px-2 py-1 text-right text-xs tabular-nums whitespace-nowrap text-gray-700 cursor-help max-md:hidden"
                                  title={r.athPrice === null || r.price === null ? '' : `Peak ${fmtPct(r.athPrice)} (${monthLabel(r.athDate)}) − current ${fmtPct(r.price)} = ${(r.athPrice - r.price).toFixed(2)} pp`}
                                >
                                  {r.athPrice === null || r.price === null ? '–' : <>{(r.athPrice - r.price).toFixed(2)}<span className="text-[9px] text-gray-400 ml-0.5">pp</span></>}
                                </td>
                              </>
                            ) : (<>
                            {/* (Price sits second, right after the name — see above.) */}
                            {/* Current drawdown from the all-time high — the same look as the Holdings
                                page's Curr DD: plain text, "Peak" in green at the high, else the % in the
                                same red as a price that fell (the Price column) */}
                            {r.drawdown === null ? (
                              <td className="px-2 py-1 text-right text-xs text-gray-300 max-md:hidden">–</td>
                            ) : r.isAtAth ? (
                              <td className="px-2 py-1 text-right text-xs font-semibold text-green-700 cursor-help max-md:hidden" title={`At all-time high: ${fmtLevel(r.isFx, r.price ?? 0)} ${r.priceCurrency}`}>
                                Peak
                              </td>
                            ) : (
                              <td
                                className="px-2 py-1 text-right text-xs tabular-nums text-red-600 cursor-help max-md:hidden"
                                title={`ATH ${fmtLevel(r.isFx, r.athPrice ?? 0)} ${r.priceCurrency} (${monthLabel(r.athDate)})`}
                              >
                                {r.drawdown.toFixed(1)}%
                              </td>
                            )}

                            {/* 10-month SMA signal — same rule and colours as the Monthly tab */}
                            <td
                              className={`px-2 py-1 text-center text-xs font-medium cursor-help max-md:hidden ${
                                r.signal === 'BUY' ? 'bg-green-100 text-green-700'
                                  : r.signal === 'SELL' ? 'bg-red-100 text-red-700'
                                  : 'text-gray-300'
                              }`}
                              title={r.sma10 !== null && r.price !== null
                                ? `${r.signal}: price ${fmtLevel(r.isFx, r.price)} ${r.priceCurrency} is ${r.signal === 'BUY' ? 'above' : 'at or below'} its 10-month SMA ${fmtLevel(r.isFx, r.sma10)} ${r.priceCurrency} (${fmtRet((r.price / r.sma10 - 1) * 100)}%).\n\n${SIGNAL_RULE}`
                                : `Not enough history: needs 10 months of prices.\n\n${SIGNAL_RULE}`}
                            >
                              {r.signal ?? '–'}
                            </td>
                            </>)}
                          </tr>
                        );
                      })}
                      {/* History chart under the Inflation 1Y rate / Reference Rates / 10Y Rates sections */}
                      {macroChart(s)}
                      </>)}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            ))}

            {/* Footnotes: the price notes and/or the rates & inflation notes — the Country page has both */}
            {marketsIsCountry && (
            <p className="text-[11px] text-gray-500 mt-3">
              Country page: every Lookup row whose SnapshotCountry is {marketsCountry}, seen by a local investor, in {marketsCountry} ·
              {marketsCountry} vs basket = geometric average of its moves
              against the {basket?.parts.length ?? 'other'} currencies in the FX section (equal weights; + = {marketsCountry} appreciated)
            </p>
            )}
            {hasPriceRows && (
            <p className="text-[11px] text-gray-500 mt-3">
              {viewCurrency === 'Native'
                ? <>Total return (adjusted-close prices) in each asset&apos;s own currency, no FX conversion · </>
                : <>Total return (adjusted-close prices) in {viewCurrency}, converted at each month-end&apos;s exchange rate · </>}
              every period ends at the latest price · 3Y/5Y/10Y are cumulative (c), not annualised ·
              colour scaled within each column · price in the asset&apos;s own currency, red if below last month-end ·
              Curr DD and Signal use the asset&apos;s own currency, like the Annual and Monthly tabs ·
              FX rows read BASE/OTHER (units of the other currency per 1 base, cross rates via PLN), so + = the base
              currency strengthened; their price, Curr DD and Signal are on that rate · – = not enough history
            </p>
            )}
            {hasMacroRows && (
            <p className="text-[11px] text-gray-500 mt-3">
              Rates and 10Y yields: period columns are the change in basis points (hover for the % growth) ·
              inflation cumulative: change in the CPI index over the period (1Y = year-on-year), measured from the
              last month the index actually changed (later months repeat it until the next print) ·
              inflation 1Y rate: the year-on-year rate as it stood that long before the last print (1M = the month
              before, YTD = last December), so comparing it with Value shows whether inflation is accelerating;
              coloured by level — deeper red = higher inflation, green = deflation; the first column compares today&apos;s
              rate with the selected period&apos;s: Accelerating (higher now, red) or Easing (lower now, green), in pp ·
              Value = latest rate / YoY inflation, red if it rose vs the month before · ATH = highest ever recorded ·
              vs peak = ATH − Value in pp · colours reversed: rising = red{marketsIsCountry ? '' : ' · the currency button does not apply'} · – = not enough history
            </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
