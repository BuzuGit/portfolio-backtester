/*
  THE MARKETS TAB: EDO PAGE

  Polish 10-year inflation-linked savings bonds (EDO): the bond on sale now, every series' value
  per 100 zl against inflation, before and after tax, and the matured series. The bond maths is in
  lib/edo.ts; the EDO data and every choice here live in the main screen and are passed in.
*/
import React from 'react';
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ReferenceDot, ReferenceLine, Customized } from 'recharts';
import type { AssetRow } from '@/lib/fetchData';
import { EDO_CPI_TICKER, EDO_TAX_RATE, daysBetween, edoAfterTax, monthEndIso, monthKeyOf, todayIso, type EdoData } from '@/lib/edo';
import { PhoneChoice } from '@/components/PhoneSheet';
import {
  BTN_SECOND, CHART_PALETTE, GAIN, HALO, INK, LINE_MID, LOSS, MUTED, PINNED_FILTERS, ResponsiveContainer, SEG,
  formatPrice, segBtn,
} from '@/components/ui';
import { EdgeBubbles } from '@/components/charts';

type EdoLines = { value: boolean; cpi: boolean; tax: boolean };

export interface EdoTabProps {
  assetData: AssetRow[];
  edoData: EdoData | null;
  edoSelected: string; setEdoSelected: (s: string) => void;
  edoLines: EdoLines; setEdoLines: React.Dispatch<React.SetStateAction<EdoLines>>;
  edoStatusFilter: 'all' | 'running' | 'matured'; setEdoStatusFilter: (f: 'all' | 'running' | 'matured') => void;
  edoMaturedTax: boolean; setEdoMaturedTax: (on: boolean) => void;
  edoMaturedReal: boolean; setEdoMaturedReal: (on: boolean) => void;
}

export default function EdoTab({
  assetData, edoData, edoSelected, setEdoSelected, edoLines, setEdoLines, edoStatusFilter, setEdoStatusFilter,
  edoMaturedTax, setEdoMaturedTax, edoMaturedReal, setEdoMaturedReal,
}: EdoTabProps) {
  const edo = edoData;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`; // "Oct 2026"
  const keyLabel = (k: number) => `${MONTHS[k % 12]} ${Math.floor(k / 12)}`;
  const keyIso = monthEndIso; // a month key as its month-end date (lib/edo.ts)
  const fmtPct2 = (v: number | null) => (v === null ? '–' : `${v.toFixed(2)}%`);
  const fmtPctSigned = (v: number) => (Math.abs(v) < 0.05 ? '0.0%' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

  if (!edo) {
    return (
      <div className="mt-2 bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-sm text-gray-500 text-center">
        The EDO tab could not be loaded. Try Refresh Data.
      </div>
    );
  }

  // Values in the grid run ahead of today (each coupon year is fixed in advance). The
  // page shows what has actually happened: month-ends up to the last one before today.
  const lastDoneKey = monthKeyOf(todayIso()) - 1;

  // Polish CPI index by month, from the price sheet (the same series the Macro page shows).
  const cpiByKey = new Map<number, number>();
  assetData.forEach(r => { const v = Number(r[EDO_CPI_TICKER]); if (v > 0) cpiByKey.set(monthKeyOf(String(r.date)), v); });
  // 1Y inflation (%) at a month-end, from the index 12 months earlier.
  const cpiYoY = (k: number) => {
    const a = cpiByKey.get(k - 12), b = cpiByKey.get(k);
    return a && b ? (b / a - 1) * 100 : null;
  };
  // Latest REAL inflation print: the sheet repeats the last CPI into later months, so step
  // back to the last month the index actually changed (as the Macro page does).
  let cpiKey = Math.max(-1, ...Array.from(cpiByKey.keys()).filter(k => k <= lastDoneKey + 1));
  while (cpiByKey.has(cpiKey - 1) && cpiByKey.get(cpiKey - 1) === cpiByKey.get(cpiKey)) cpiKey--;
  const inflationNow = cpiYoY(cpiKey);

  const bySold = [...edo.series].filter(s => s.sold).sort((a, b) => a.sold.localeCompare(b.sold));
  const newest = bySold[bySold.length - 1];
  const running = edo.series.filter(s => s.status === 'running').length;
  const selected = edo.series.find(s => s.series === edoSelected)
    ?? bySold.find(s => s.status === 'running') ?? newest;

  // Rates & margins chart: one point per series, at its sale month, beside the 1Y
  // inflation known when it went on sale (the month-end before).
  const ratesData = bySold.map(s => {
    const k = monthKeyOf(s.sold);
    return { date: s.sold, series: s.series, rate: s.firstYearRate, margin: s.margin, inflation: cpiYoY(k - 1) };
  });
  // Its Y axis, set by hand: left to itself the chart picks round steps of 7 and starts at
  // -7% for a low point of -1.x%, which squashes the lines. Instead: the lowest point
  // rounded down to a whole percent (-2%), then zero, then steps of 4 to above the highest.
  const ratesVals = ratesData.flatMap(d => [d.rate, d.inflation]).filter((v): v is number => v !== null);
  const ratesLo = Math.min(0, Math.floor(Math.min(...ratesVals)));
  const ratesHi = Math.max(4, Math.ceil(Math.max(...ratesVals) / 4) * 4);
  const ratesTicks = [...(ratesLo < 0 ? [ratesLo] : []), ...Array.from({ length: ratesHi / 4 + 1 }, (_, i) => i * 4)];
  // The highest and lowest point of each line, marked like the Monthly tab's price chart:
  // a green dot for the max, a red one for the min (the first time it was reached).
  const extremes = (key: 'rate' | 'inflation') => {
    const pts = ratesData.filter(d => d[key] !== null);
    if (!pts.length) return [];
    const hi = pts.reduce((a, b) => ((b[key] as number) > (a[key] as number) ? b : a));
    const lo = pts.reduce((a, b) => ((b[key] as number) < (a[key] as number) ? b : a));
    return [
      { key: `${key}-max`, date: hi.date, v: hi[key] as number, max: true },
      { key: `${key}-min`, date: lo.date, v: lo[key] as number, max: false },
    ];
  };
  const ratesExtremes = [...extremes('rate'), ...extremes('inflation')];

  // ---- Matured series: every completed 10-year hold, side by side ----
  // Each matured series' path from purchase (month 0, = 100) to maturity (month 120), on
  // the chosen basis: pre-tax or after tax (as if paid out that month), and real (divided
  // by Polish inflation since purchase) or nominal. A series is left out if any month is
  // missing — e.g. in real terms the very first series, bought before the CPI index starts.
  const maturedPaths = bySold.filter(s => s.status === 'matured').map(s => {
    const g = edo.values.get(s.series);
    const b = monthKeyOf(s.sold) - 1;
    const c0 = cpiByKey.get(b);
    const pts: number[] = [];
    for (let i = 0; i <= 120; i++) {
      const v = i === 0 ? 100 : g?.get(b + i);
      if (v === undefined) return null;
      let x = edoMaturedTax ? edoAfterTax(v) : v;
      if (edoMaturedReal) {
        const c = cpiByKey.get(b + i);
        if (!c0 || !c) return null;
        x = x / (c / c0);
      }
      pts.push(x);
    }
    return { s, pts, final: pts[120] - 100, perYear: (Math.pow(pts[120] / 100, 1 / 10) - 1) * 100 };
  }).filter((p): p is NonNullable<typeof p> => p !== null);
  const byOutcome = [...maturedPaths].sort((a, b) => a.final - b.final);
  const mWorst = byOutcome[0], mBest = byOutcome[byOutcome.length - 1];
  const mMedian = byOutcome.length ? byOutcome[Math.floor((byOutcome.length - 1) / 2)] : undefined;
  // "Beat inflation" is always measured in real terms, on the chosen tax basis.
  const beatInflation = bySold.filter(s => s.status === 'matured').filter(s => {
    const b = monthKeyOf(s.sold) - 1, v = edo.values.get(s.series)?.get(b + 120);
    const c0 = cpiByKey.get(b), c1 = cpiByKey.get(b + 120);
    return v !== undefined && c0 && c1 && (edoMaturedTax ? edoAfterTax(v) : v) / (c1 / c0) > 100;
  }).length;
  const beatOf = bySold.filter(s => s.status === 'matured' && cpiByKey.has(monthKeyOf(s.sold) - 1)).length;
  // The black line: the MEDIAN across all series at each month (not one series' path).
  const median = (xs: number[]) => {
    const a = [...xs].sort((p, q) => p - q), m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const pathsData = Array.from({ length: 121 }, (_, i) => {
    const row: Record<string, number> = { i, median: median(maturedPaths.map(p => p.pts[i])) };
    maturedPaths.forEach(p => { row[p.s.series] = p.pts[i]; });
    return row;
  });
  const outcomeData = maturedPaths.map(p => ({ date: p.s.sold, series: p.s.series, ret: p.final, perYear: p.perYear }));
  const basisLabel = `${edoMaturedReal ? 'real' : 'nominal'}, ${edoMaturedTax ? 'after tax' : 'pre-tax'}`;
  // The sale-month charts get one tick per year, on each January's series, so no year
  // label repeats or goes missing (left to itself the axis did both).
  const januaryTicks = (rows: { date: string }[]) => rows.map(r => r.date).filter(d => d.slice(5, 7) === '01');

  // The selected series, month by month since purchase: 100 at the month-end before its
  // sale month, then the sheet's values up to the last finished month (or maturity).
  const grid = edo.values.get(selected.series) ?? new Map<number, number>();
  const buyKey = monthKeyOf(selected.sold) - 1;
  const endKey = Math.min(lastDoneKey, monthKeyOf(selected.matures) - 1);
  const cpi0 = cpiByKey.get(buyKey);
  const seriesData: { date: string; value: number; tax: number; cpi: number | null }[] = [];
  for (let k = buyKey; k <= endKey; k++) {
    const v = k === buyKey ? 100 : grid.get(k);
    if (v === undefined) continue;
    const c = cpiByKey.get(k);
    seriesData.push({ date: keyIso(k), value: v, tax: edoAfterTax(v), cpi: cpi0 && c ? (c / cpi0) * 100 : null });
  }
  const last = seriesData[seriesData.length - 1];
  const monthsHeld = last ? monthKeyOf(last.date) - buyKey : 0;
  const lastCpi = [...seriesData].reverse().find(p => p.cpi !== null)?.cpi ?? null;
  const realAfterTax = last && lastCpi ? ((last.tax / lastCpi) - 1) * 100 : null;

  // The selected series month by month, purchase to maturity: the purchase plus 120
  // month-ends. Each bond year's rate is worked out from the bond's OWN values (interest
  // is capitalised once a year, so it is the year-end value over the year-start value),
  // which makes the table reconcile exactly with the sheet. Years 2-10 pay CPI + margin,
  // so the CPI used is that rate minus the margin; with zero or negative inflation the
  // bond pays the margin alone ("≤ 0"). Year 1 is the fixed first-year rate.
  const bondYearRate = (y: number): number | null => {
    if (y === 1) return selected.firstYearRate;
    const st = buyKey + 12 * (y - 1);
    const v0 = grid.get(st);
    if (v0 === undefined) return null;
    const v1 = grid.get(st + 12);
    if (v1 !== undefined) return (v1 / v0 - 1) * 100;
    // A coupon year whose end value isn't on the sheet yet: interest accrues evenly over
    // the year (365-day basis), so read the rate off the latest month that is.
    let k = st + 11;
    while (k > st && !grid.has(k)) k--;
    if (k === st) return null;
    return (grid.get(k)! / v0 - 1) * (365 / daysBetween(keyIso(st), keyIso(k))) * 100;
  };
  const yearRates = Array.from({ length: 10 }, (_, i) => bondYearRate(i + 1));
  const ladder = Array.from({ length: 121 }, (_, i) => {
    const k = buyKey + i;
    const year = i === 0 ? 0 : Math.ceil(i / 12);
    const v = i === 0 ? 100 : grid.get(k) ?? null;
    const prev = i === 0 ? null : i === 1 ? 100 : grid.get(k - 1) ?? null;
    const c = cpiByKey.get(k);
    const cpiIdx = cpi0 && c && k <= lastDoneKey ? (c / cpi0) * 100 : null;
    const tax = v !== null ? edoAfterTax(v) : null;
    return {
      k, i, year, v, tax, cpiIdx,
      monthPct: v !== null && prev !== null ? (v / prev - 1) * 100 : null,
      real: tax !== null && cpiIdx !== null ? (tax / cpiIdx - 1) * 100 : null,
      ahead: k > lastDoneKey, // already fixed by the sheet, but not yet accrued
    };
  });

  // Series table rows, newest first, after the Running / Matured filter.
  const tableRows = edo.series.filter(s => edoStatusFilter === 'all' || s.status === edoStatusFilter);
  // Pre-tax return a year since purchase — only once a series has been held a full year
  // (the app never annualises less than a year).
  const annualised = (s: typeof selected): number | null => {
    if (s.value === null || !s.valueAt) return null;
    const months = monthKeyOf(s.valueAt) - (monthKeyOf(s.sold) - 1);
    return months >= 12 ? (Math.pow(s.value / 100, 12 / months) - 1) * 100 : null;
  };

  const lineButtons: { key: 'value' | 'cpi' | 'tax'; label: string }[] = [
    { key: 'value', label: 'Value' }, { key: 'cpi', label: 'Inflation' }, { key: 'tax', label: 'After tax' },
  ];
  // A line can be switched off, but not the last one left on (an empty chart says nothing).
  const toggleLine = (k: 'value' | 'cpi' | 'tax') => setEdoLines(prev => {
    const next = { ...prev, [k]: !prev[k] };
    return next.value || next.cpi || next.tax ? next : prev;
  });
  const allOn = edoLines.value && edoLines.cpi && edoLines.tax;
  const shortHistory = seriesData.length <= 25;
  const xTick = (d: string) => (shortHistory ? `${MONTHS[Number(d.slice(5, 7)) - 1]}${d.slice(2, 4)}` : d.slice(0, 4));
  // Long histories: one tick per year, on its January, so no year label repeats.
  const seriesTicks = shortHistory ? undefined : seriesData.map(p => p.date).filter(d => d.slice(5, 7) === '01');
  const latestValueAt = edo.series.reduce((m, s) => (s.valueAt > m ? s.valueAt : m), '');

  return (
    <div className="mt-2">
      {/* Page-level filter: which series the table lists */}
      <div className={`${PINNED_FILTERS} max-md:static mb-4 flex flex-wrap items-center gap-x-6 gap-y-2`}>
        {/* Phones: one box that opens a slide-up panel, like the other Markets pages */}
        <div className="hidden max-md:flex w-full">
          <PhoneChoice
            label="Series"
            options={[
              { value: 'all', label: 'All' },
              { value: 'running', label: 'Running', hint: 'not yet matured' },
              { value: 'matured', label: 'Matured', hint: 'completed 10 years' },
            ]}
            selected={edoStatusFilter}
            onPick={k => setEdoStatusFilter(k as typeof edoStatusFilter)}
          />
        </div>
        <div className="flex items-center gap-1 max-md:hidden">
          <span className="text-xs text-gray-500 mr-1">Series:</span>
          <span className={SEG}>
          {([['all', 'All'], ['running', 'Running'], ['matured', 'Matured']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setEdoStatusFilter(k)}
              className={segBtn(edoStatusFilter === k)}
            >{label}</button>
          ))}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        {/* Card header */}
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div>
            <h3 className="text-md font-semibold text-gray-800 inline">EDO</h3>
            <span className="text-xs text-gray-500 ml-2 uppercase tracking-wide">10-year inflation-linked savings bonds · per 100 zl · pre-tax unless marked</span>
          </div>
          {latestValueAt && (
            <span className="text-xs text-gray-500 border border-gray-200 rounded px-2 py-0.5">Values as of {monthLabel(latestValueAt)}</span>
          )}
        </div>

        {/* Summary tiles: what is on sale now, today's inflation, how many series */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
          {[
            {
              label: 'On sale now', cls: 'text-gray-800',
              value: newest ? `${newest.series} · ${fmtPct2(newest.firstYearRate)}` : '–',
              sub: newest?.margin !== null && newest ? `then CPI + ${fmtPct2(newest.margin)}` : '',
            },
            {
              label: 'Inflation PL 1Y', cls: 'text-gray-800',
              value: inflationNow !== null ? `${inflationNow.toFixed(1)}%` : '–',
              sub: cpiKey >= 0 ? keyLabel(cpiKey) : '',
            },
            {
              label: 'Series', cls: 'text-gray-800',
              value: `${running} running`, sub: `${edo.series.length - running} matured`,
            },
          ].map(t => (
            <div key={t.label} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 min-w-0">
              <div className="text-xs uppercase tracking-wide text-gray-500 whitespace-nowrap truncate">{t.label}</div>
              {/* Phones: wraps instead of "…", and the small note goes on its own line */}
              <div className="text-base whitespace-nowrap truncate max-md:whitespace-normal">
                <span className={`font-semibold tabular-nums ${t.cls}`}>{t.value}</span>
                <span className="text-sm text-gray-500 ml-2 max-md:block max-md:ml-0">{t.sub}</span>
              </div>
            </div>
          ))}
        </div>

        {/* First-year rates: what each series was sold on, beside the inflation of the day */}
        <div className="mb-6">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-1">First-year rate by sale month</div>
          <div className="flex flex-wrap gap-4 text-xs text-gray-600 mb-1">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5" style={{ background: CHART_PALETTE.blue }} />First-year rate</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5" style={{ background: CHART_PALETTE.terracotta }} />Inflation PL 1Y when sold</span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={ratesData} margin={{ top: 22, right: 10, bottom: 0, left: 0 }}>
              <XAxis dataKey="date" ticks={januaryTicks(ratesData)} interval="preserveStartEnd" minTickGap={8} tickFormatter={d => String(d).slice(0, 4)} tick={{ fontSize: 11 }} />
              <YAxis domain={[ratesLo, ratesHi]} ticks={ratesTicks} interval={0} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} width={40} />
              <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />
              <Tooltip
                labelFormatter={(d, p) => `${(p?.[0]?.payload as { series?: string })?.series ?? ''} · sold ${monthLabel(String(d))}`}
                formatter={(v: number, name: string) => [`${Number(v).toFixed(2)}%`, name]}
              />
              <Line type="stepAfter" dataKey="rate" name="First-year rate" stroke={CHART_PALETTE.blue} strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls />
              <Line type="monotone" dataKey="inflation" name="Inflation PL 1Y" stroke={CHART_PALETTE.terracotta} strokeWidth={1.25} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />
              {/* Max (green, value above) and min (red, value below) of each line */}
              {ratesExtremes.map(p => (
                <ReferenceDot
                  key={p.key}
                  x={p.date}
                  y={p.v}
                  r={5}
                  fill={p.max ? GAIN : LOSS}
                  stroke={HALO}
                  strokeWidth={2}
                  // A low sitting on the bottom of the axis would print its value over the
                  // year labels, so that one is written beside the dot instead.
                  label={{
                    value: `${p.v.toFixed(2)}%`, fontSize: 11, fill: INK, fontWeight: 600,
                    position: p.max ? 'top' : p.v - ratesLo < (ratesHi - ratesLo) * 0.12 ? 'right' : 'bottom',
                  }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Margin over CPI (years 2-10) of every series, one bar per sale month — drawn like */}
        {/* the Country page's monthly macro bars (black above zero, red below). */}
        <div className="mb-6">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Margin over CPI by sale month (years 2–10)</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={ratesData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barCategoryGap={1}>
              <XAxis dataKey="date" ticks={januaryTicks(ratesData)} interval="preserveStartEnd" minTickGap={8} tickFormatter={d => String(d).slice(0, 4)} tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={{ stroke: LINE_MID }} />
              <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: MUTED }} width={44} tickLine={false} axisLine={false} />
              <ReferenceLine y={0} stroke="#9ca3af" />
              <Tooltip
                labelFormatter={(d, p) => `${(p?.[0]?.payload as { series?: string })?.series ?? ''} · sold ${monthLabel(String(d))}`}
                formatter={(v: number) => [`${Number(v).toFixed(2)}%`, 'Margin over CPI']}
                cursor={{ fill: 'rgba(0,0,0,0.05)' }}
              />
              <Bar dataKey="margin" isAnimationActive={false}>
                {ratesData.map(d => <Cell key={d.series} fill={(d.margin ?? 0) < 0 ? LOSS : INK} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Matured series: how every completed 10-year hold played out — best, worst and */}
        {/* median, the outcome by sale month, and every path on one chart. */}
        {maturedPaths.length > 0 && mBest && mWorst && mMedian && (
          <div className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
                Matured series · {maturedPaths.length} ten-year holds · {basisLabel}
              </div>
              <div className="flex items-center gap-3">
                <span className={SEG}>
                {([[false, 'Pre-tax'], [true, 'After tax']] as const).map(([v, label]) => (
                  <button key={label} onClick={() => setEdoMaturedTax(v)}
                    className={segBtn(edoMaturedTax === v)}
                  >{label}</button>
                ))}
                </span>
                <span className={SEG}>
                {([[true, 'Real'], [false, 'Nominal']] as const).map(([v, label]) => (
                  <button key={label} onClick={() => setEdoMaturedReal(v)}
                    title={v ? 'After Polish inflation since purchase' : 'Before inflation'}
                    className={segBtn(edoMaturedReal === v)}
                  >{label}</button>
                ))}
                </span>
              </div>
            </div>

            {/* Best / median / worst outcome, and how many beat inflation */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
              {[
                { label: 'Best', p: mBest, cls: 'text-green-700' },
                { label: 'Median', p: mMedian, cls: 'text-gray-800' },
                { label: 'Worst', p: mWorst, cls: mWorst.final >= 0 ? 'text-gray-800' : 'text-red-700' },
              ].map(t => (
                <button key={t.label} onClick={() => setEdoSelected(t.p.s.series)} title={`Open ${t.p.s.series} below`}
                  className="text-left rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 px-3 py-2 min-w-0">
                  <div className="text-xs uppercase tracking-wide text-gray-500 whitespace-nowrap truncate">{t.label} · {t.p.s.series}</div>
                  {/* Phones: wraps instead of "…", and the small note goes on its own line */}
                  <div className="text-base whitespace-nowrap truncate max-md:whitespace-normal">
                    <span className={`font-semibold tabular-nums ${t.cls}`}>{fmtPctSigned(t.p.final)}</span>
                    <span className="text-sm text-gray-500 ml-2 max-md:block max-md:ml-0">{fmtPctSigned(t.p.perYear)} a year</span>
                  </div>
                </button>
              ))}
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 min-w-0"
                title={`Series whose ${edoMaturedTax ? 'after-tax' : 'pre-tax'} payout at maturity bought more than 100 zl did at purchase`}>
                <div className="text-xs uppercase tracking-wide text-gray-500 whitespace-nowrap truncate">Beat inflation</div>
                <div className="text-base whitespace-nowrap truncate max-md:whitespace-normal">
                  <span className="font-semibold tabular-nums text-gray-800">{beatInflation} of {beatOf}</span>
                  <span className="text-sm text-gray-500 ml-2 max-md:block max-md:ml-0">{edoMaturedTax ? 'after tax' : 'pre-tax'}</span>
                </div>
              </div>
            </div>

            {/* The 10-year outcome of each series, by the month it was sold */}
            <div className="text-xs text-gray-500 mb-1">10-year return by sale month — total, not annualised. Click a bar to open that series below.</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={outcomeData} margin={{ top: 20, right: 8, left: -8, bottom: 0 }} barCategoryGap={1}
                onClick={(e: { activePayload?: { payload?: { series?: string } }[] }) => {
                  const s = e?.activePayload?.[0]?.payload?.series;
                  if (s) setEdoSelected(s);
                }}>
                <XAxis dataKey="date" ticks={januaryTicks(outcomeData)} interval="preserveStartEnd" minTickGap={8} tickFormatter={d => String(d).slice(0, 4)} tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={{ stroke: LINE_MID }} />
                <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: MUTED }} width={44} tickLine={false} axisLine={false} />
                <ReferenceLine y={0} stroke="#9ca3af" />
                <Tooltip
                  labelFormatter={(d, p) => `${(p?.[0]?.payload as { series?: string })?.series ?? ''} · sold ${monthLabel(String(d))}`}
                  formatter={(v: number, _n: string, item: { payload?: { perYear?: number } }) =>
                    [`${fmtPctSigned(Number(v))} (${fmtPctSigned(item?.payload?.perYear ?? 0)} a year)`, `10-year return, ${basisLabel}`]}
                  cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                />
                <Bar dataKey="ret" isAnimationActive={false} cursor="pointer">
                  {outcomeData.map(d => (
                    <Cell key={d.series} fill={d.series === mBest.s.series ? GAIN : d.series === mWorst.s.series ? LOSS : d.ret < 0 ? LOSS : INK} />
                  ))}
                </Bar>
                <ReferenceDot x={mBest.s.sold} y={mBest.final} r={0} fill="none" stroke="none"
                  label={{ value: `${mBest.s.series} ${fmtPctSigned(mBest.final)}`, position: 'top', fontSize: 11, fill: GAIN, fontWeight: 600 }} />
                <ReferenceDot x={mWorst.s.sold} y={mWorst.final} r={0} fill="none" stroke="none"
                  label={{ value: `${mWorst.s.series} ${fmtPctSigned(mWorst.final)}`, position: mWorst.final < 0 ? 'bottom' : 'top', fontSize: 11, fill: LOSS, fontWeight: 600 }} />
              </BarChart>
            </ResponsiveContainer>

            {/* Every path on one chart: grey, with the best, worst and the median picked out */}
            <div className="flex flex-wrap gap-4 text-xs text-gray-600 mt-4 mb-1">
              <span>Every matured series from purchase (100) to maturity, {basisLabel}:</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-green-600" />Best ({mBest.s.series})</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-red-600" />Worst ({mWorst.s.series})</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#111827]" />Median of all, month by month</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#d1d5db]" />Others</span>
            </div>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={pathsData} margin={{ top: 5, right: 70, bottom: 0, left: 0 }}>
                <XAxis dataKey="i" type="number" domain={[0, 120]} ticks={[0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120]}
                  tickFormatter={v => (v === 0 ? 'Buy' : `${v / 12}y`)} tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={{ stroke: LINE_MID }} />
                <YAxis domain={['auto', 'auto']} tickFormatter={v => formatPrice(Number(v))} tick={{ fontSize: 11, fill: MUTED }} width={44} tickLine={false} axisLine={false} />
                <ReferenceLine y={100} stroke="#9ca3af" strokeDasharray="3 3" />
                {/* With ~80 lines the default tooltip would list them all: show only the three that matter. */}
                <Tooltip content={({ active, label }) => {
                  if (!active || label === undefined) return null;
                  const i = Number(label), row = pathsData[i];
                  if (!row) return null;
                  return (
                    <div className="bg-white border border-gray-200 rounded shadow-sm px-2 py-1 text-xs tabular-nums">
                      <div className="font-medium text-gray-700 mb-0.5">{i === 0 ? 'Purchase' : `Month ${i} (${(i / 12).toFixed(1)} years)`}</div>
                      <div className="text-green-700">Best {mBest.s.series}: {formatPrice(row[mBest.s.series])}</div>
                      <div className="text-gray-900">Median: {formatPrice(row.median)}</div>
                      <div className="text-red-700">Worst {mWorst.s.series}: {formatPrice(row[mWorst.s.series])}</div>
                    </div>
                  );
                }} />
                {maturedPaths.filter(p => p !== mBest && p !== mWorst).map(p => (
                  <Line key={p.s.series} dataKey={p.s.series} stroke={LINE_MID} strokeWidth={1} dot={false} isAnimationActive={false} activeDot={false} />
                ))}
                <Line dataKey={mWorst.s.series} stroke={LOSS} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey={mBest.s.series} stroke={GAIN} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="median" stroke={INK} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Customized component={<EdgeBubbles defs={[
                  { value: mBest.pts[120], color: GAIN, label: formatPrice(mBest.pts[120]) },
                  { value: pathsData[120].median, color: INK, label: formatPrice(pathsData[120].median) },
                  { value: mWorst.pts[120], color: LOSS, label: formatPrice(mWorst.pts[120]) },
                ]} />} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* One series since purchase: value, inflation over the same months, value after tax */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <div className="text-sm">
              <span className="font-semibold text-gray-800">{selected.series}</span>
              <span className="text-xs text-gray-500 ml-2">
                sold {monthLabel(selected.sold)} · matures {monthLabel(selected.matures)} · {fmtPct2(selected.firstYearRate)} then CPI + {fmtPct2(selected.margin)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className={SEG}>
              {lineButtons.map(b => (
                <button
                  key={b.key}
                  onClick={() => toggleLine(b.key)}
                  className={segBtn(edoLines[b.key])}
                >{b.label}</button>
              ))}
              </span>
              <button
                onClick={() => setEdoLines(allOn ? { value: true, cpi: false, tax: false } : { value: true, cpi: true, tax: true })}
                className={`ml-1 ${BTN_SECOND}`}
              >{allOn ? 'Value only' : 'All 3'}</button>
            </div>
          </div>
          {last ? (
            <>
              {/* What the lines end at, in one line: the result since purchase */}
              <div className="text-sm text-gray-600 mb-2 tabular-nums">
                {monthsHeld} months to {monthLabel(last.date)}: <span className="font-medium text-gray-800">{fmtPctSigned(last.value - 100)}</span> pre-tax
                {' · '}<span className="font-medium text-gray-800">{fmtPctSigned(last.tax - 100)}</span> after {Math.round(EDO_TAX_RATE * 100)}% tax
                {lastCpi !== null && <>{' · '}inflation {fmtPctSigned(lastCpi - 100)}</>}
                {realAfterTax !== null && <>{' · '}real after tax <span className={`font-medium ${realAfterTax >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmtPctSigned(realAfterTax)}</span></>}
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={seriesData} margin={{ top: 5, right: 70, bottom: 0, left: 0 }}>
                  <XAxis dataKey="date" ticks={seriesTicks} tickFormatter={xTick} tick={{ fontSize: 11 }} minTickGap={20} />
                  <YAxis domain={['auto', 'auto']} tickFormatter={v => formatPrice(Number(v))} tick={{ fontSize: 11 }} width={44} />
                  <ReferenceLine y={100} stroke="#9ca3af" strokeDasharray="3 3" />
                  <Tooltip
                    labelFormatter={d => monthLabel(String(d))}
                    formatter={(v: number, name: string) => [formatPrice(Number(v)), name]}
                  />
                  {edoLines.value && <Line type="monotone" dataKey="value" name="Value" stroke={CHART_PALETTE.blue} strokeWidth={2} dot={false} isAnimationActive={false} />}
                  {edoLines.cpi && <Line type="monotone" dataKey="cpi" name="Inflation (CPI = 100 at purchase)" stroke={CHART_PALETTE.terracotta} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />}
                  {edoLines.tax && <Line type="monotone" dataKey="tax" name={`After ${Math.round(EDO_TAX_RATE * 100)}% tax`} stroke={CHART_PALETTE.teal} strokeWidth={1.75} dot={false} isAnimationActive={false} />}
                  {/* Where each shown line ends, as a bubble at the right edge in the line's */}
                  {/* colour — the same bubbles as the Monthly tab's price chart. */}
                  <Customized component={<EdgeBubbles defs={[
                    ...(edoLines.value ? [{ value: last.value, color: CHART_PALETTE.blue, label: formatPrice(last.value) }] : []),
                    ...(edoLines.cpi && lastCpi !== null ? [{ value: lastCpi, color: CHART_PALETTE.terracotta, label: formatPrice(lastCpi) }] : []),
                    ...(edoLines.tax ? [{ value: last.tax, color: CHART_PALETTE.teal, label: formatPrice(last.tax) }] : []),
                  ]} />} />
                </LineChart>
              </ResponsiveContainer>
            </>
          ) : (
            <p className="text-sm text-gray-500 py-6 text-center">{selected.series} has no finished month yet.</p>
          )}

          {/* The same series month by month, from purchase to maturity (all 120 months). */}
          {/* Grey rows are already fixed by the sheet but lie in the future; "–" = not known yet. */}
          <div className="mt-4 text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-1">{selected.series} month by month</div>
          {/* Phones: the Month column stays put on the left while the figures swipe ("phone-pin-first") */}
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-gray-100 rounded phone-pin-first">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0">
                <tr className="bg-gray-100 text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="text-left font-semibold text-gray-700 px-3 py-2 cursor-help" title="Month-end the row is valued at. The first row is the purchase, at par (100).">Month</th>
                  <th className="text-right font-medium px-2 py-2 cursor-help" title="Year of the bond's life (1-10). Each bond year runs from one anniversary of the sale month to the next.">Year</th>
                  <th className="text-right font-medium px-2 py-2 cursor-help" title={'Interest rate for this bond year, a year\'s rate (not this month\'s).\nYear 1: the fixed first-year rate.\nYears 2-10: CPI used + margin, worked out from the bond\'s own values (year-end value ÷ year-start value − 1).'}>Rate</th>
                  <th className="text-right font-medium px-2 py-2 whitespace-nowrap cursor-help" title={`The 12-month CPI behind this year's rate: rate minus the ${fmtPct2(selected.margin)} margin — exact, worked out from the bond's own values.\nThe reference month shown on hover (two months before the bond year starts) is inferred from all series and fits best, but is not stated in the sheet; the sheet's own CPI index can differ from GUS's published figure by about 0.1pp.\n"≤ 0" = inflation was zero or negative, so only the margin was paid.`}>CPI used</th>
                  <th className="text-right font-medium px-2 py-2 cursor-help" title={'What 100 zl of this series is worth at the month-end, pre-tax.\nInterest accrues day by day and is added to the value at every anniversary, so later years earn interest on it.'}>Value</th>
                  <th className="text-right font-medium px-2 py-2 cursor-help" title={'Change in value over this one month (this month-end ÷ the previous one − 1).\nNot annualised.'}>Month</th>
                  <th className="text-right font-medium px-2 py-2 whitespace-nowrap cursor-help" title={'Total pre-tax return since purchase (value ÷ 100 − 1).\nCumulative, NOT annualised.'}>Since purchase</th>
                  <th className="text-right font-medium px-2 py-2 whitespace-nowrap cursor-help" title={`What you would get after tax if the bond paid out at this value: 100 + ${Math.round((1 - EDO_TAX_RATE) * 100)}% of the gain (${Math.round(EDO_TAX_RATE * 100)}% tax on everything above 100). Early-redemption fee ignored.`}>After tax</th>
                  <th className="text-right font-medium px-2 py-2 whitespace-nowrap cursor-help" title={'Polish inflation since purchase: CPI at this month-end ÷ CPI at purchase − 1.\nCumulative, NOT annualised. (The sheet\'s CPI index, which repeats the last print until the next one.)'}>Inflation</th>
                  <th className="text-right font-medium px-2 py-2 whitespace-nowrap cursor-help" title={'After-tax value in today\'s money: after-tax value ÷ (1 + inflation since purchase) − 1.\nTotal since purchase — cumulative, NOT annualised. Positive = you beat inflation after tax.'}>Real after tax</th>
                </tr>
              </thead>
              <tbody>
                {ladder.map((r, idx) => {
                  const rate = r.year > 0 ? yearRates[r.year - 1] : null;
                  const cpiUsed = r.year > 1 && rate !== null && selected.margin !== null ? rate - selected.margin : null;
                  // The CPI month the rate followed: two months before the bond year's first month.
                  const refKey = buyKey + 12 * (r.year - 1) - 1;
                  const yearStart = r.i % 12 === 1;
                  const known = r.v !== null;
                  // Each cell's tooltip shows its own working with this row's numbers. Rows still
                  // in the future say so on every cell (a cell's tooltip hides the row's).
                  const aheadNote = r.ahead && known ? '\n(fixed in advance by the sheet — not yet accrued)' : '';
                  const tip = (s: string | null) => (s ? s + aheadNote : undefined);
                  const prevV = idx > 0 ? ladder[idx - 1].v : null;
                  const cpiNow = cpiByKey.get(r.k);
                  const yearFrom = buyKey + 12 * (r.year - 1) + 1;
                  const fmt2 = (v: number) => v.toFixed(2);
                  return (
                    <tr key={r.k}
                      className={`${yearStart ? 'border-t-2 border-gray-200' : 'border-t border-gray-100'} ${r.ahead && known ? 'text-gray-400 italic' : ''}`}>
                      <td className="px-3 py-1 whitespace-nowrap cursor-help"
                        title={tip(r.i === 0 ? `Bought at par (100) on 1 ${monthLabel(selected.sold)}` : `Valued at ${keyIso(r.k)}`)}>
                        {r.i === 0 ? `Bought ${monthLabel(selected.sold)}` : keyLabel(r.k)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums cursor-help"
                        title={tip(r.year > 0 ? `Bond year ${r.year} of 10: ${keyLabel(yearFrom)} – ${keyLabel(yearFrom + 11)}` : null)}>{r.year || '–'}</td>
                      <td className={`px-2 py-1 text-right tabular-nums cursor-help ${yearStart ? 'font-medium' : ''}`}
                        title={tip(rate === null ? null : r.year === 1 ? `Fixed first-year rate: ${fmt2(rate)}% for the year`
                          : cpiUsed !== null && cpiUsed > 0.005 ? `CPI ${fmt2(cpiUsed)}% + margin ${fmtPct2(selected.margin)} = ${fmt2(rate)}% for the year`
                          : `Inflation zero or negative: the margin alone, ${fmt2(rate)}% for the year`)}>
                        {rate !== null ? `${rate.toFixed(2)}%` : '–'}
                      </td>
                      <td className={`px-2 py-1 text-right tabular-nums cursor-help ${yearStart ? 'font-medium' : ''}`}
                        title={tip(r.year === 1 ? 'Year 1 pays a fixed rate, not CPI' : r.year > 1 && rate !== null
                          ? `Rate ${fmt2(rate)}% − margin ${fmtPct2(selected.margin)}: the 12-month CPI behind this year (most likely GUS's figure for ${keyLabel(refKey)})` : null)}>
                        {r.year === 1 ? 'fixed' : cpiUsed === null ? '–' : cpiUsed <= 0.005 ? '≤ 0' : `${cpiUsed.toFixed(2)}%`}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums font-medium cursor-help"
                        title={tip(known ? `${fmt2(r.v as number)} zl per 100 zl, pre-tax` : null)}>{known ? formatPrice(r.v as number) : '–'}</td>
                      <td className="px-2 py-1 text-right tabular-nums cursor-help"
                        title={tip(r.monthPct !== null && prevV !== null ? `${fmt2(r.v as number)} ÷ ${fmt2(prevV)} − 1 = ${r.monthPct.toFixed(2)}% (this month only)` : null)}>
                        {r.monthPct !== null ? `${r.monthPct.toFixed(2)}%` : '–'}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums cursor-help"
                        title={tip(known ? `${fmt2(r.v as number)} ÷ 100 − 1 = ${fmt2((r.v as number) - 100)}% total since purchase (not annualised)` : null)}>
                        {known ? fmtPctSigned((r.v as number) - 100) : '–'}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums cursor-help"
                        title={tip(r.tax !== null && known ? `100 + (${fmt2(r.v as number)} − 100) × ${Math.round((1 - EDO_TAX_RATE) * 100)}% = ${fmt2(r.tax)}` : null)}>
                        {r.tax !== null ? formatPrice(r.tax) : '–'}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums cursor-help"
                        title={tip(r.cpiIdx !== null && cpiNow && cpi0 ? `CPI ${fmt2(cpiNow)} ÷ ${fmt2(cpi0)} at purchase − 1 = ${fmt2(r.cpiIdx - 100)}% cumulative since purchase (not annualised)` : null)}>
                        {r.cpiIdx !== null ? fmtPctSigned(r.cpiIdx - 100) : '–'}
                      </td>
                      <td className={`px-2 py-1 text-right tabular-nums cursor-help ${r.real === null ? '' : r.real >= 0 ? 'text-green-700' : 'text-red-700'}`}
                        title={tip(r.real !== null && r.tax !== null && r.cpiIdx !== null ? `${fmt2(r.tax)} after tax ÷ ${(r.cpiIdx / 100).toFixed(4)} inflation − 1 = ${fmt2(r.real)}% total since purchase (not annualised)` : null)}>
                        {r.real !== null ? fmtPctSigned(r.real) : '–'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* The full series list. Click a row to chart it. Phones: the Series column stays put. */}
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto border border-gray-100 rounded phone-pin-first">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0">
              <tr className="bg-gray-100 text-[11px] uppercase tracking-wide text-gray-500">
                <th className="text-left font-semibold text-gray-700 px-3 py-2">Series</th>
                <th className="text-left font-medium px-2 py-2">Sold</th>
                <th className="text-left font-medium px-2 py-2">Matures</th>
                <th className="text-right font-medium px-2 py-2 whitespace-nowrap">1st year</th>
                <th className="text-right font-medium px-2 py-2 whitespace-nowrap cursor-help" title="Margin over CPI paid in years 2-10">Margin</th>
                <th className="text-left font-medium px-2 py-2">Status</th>
                <th className="text-right font-medium px-2 py-2">Value</th>
                <th className="text-right font-medium px-2 py-2 whitespace-nowrap cursor-help" title={`100 + ${Math.round((1 - EDO_TAX_RATE) * 100)}% of the gain: ${Math.round(EDO_TAX_RATE * 100)}% tax is due on everything above 100`}>After tax</th>
                <th className="text-right font-medium px-2 py-2 whitespace-nowrap cursor-help" title="Pre-tax return a year since purchase. Blank until a series has been held a full year.">Per year</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map(s => {
                const isSel = s.series === selected.series;
                const ann = annualised(s);
                return (
                  <tr
                    key={s.series}
                    onClick={() => setEdoSelected(s.series)}
                    className={`border-t border-gray-100 cursor-pointer ${isSel ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                  >
                    <td className="px-3 py-1 font-medium text-gray-800 whitespace-nowrap">{s.series}</td>
                    <td className="px-2 py-1 text-gray-600 whitespace-nowrap">{s.sold ? monthLabel(s.sold) : '–'}</td>
                    <td className="px-2 py-1 text-gray-600 whitespace-nowrap">{s.matures ? monthLabel(s.matures) : '–'}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtPct2(s.firstYearRate)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtPct2(s.margin)}</td>
                    <td className={`px-2 py-1 text-xs ${s.status === 'running' ? 'text-green-700' : 'text-gray-500'}`}>{s.status}</td>
                    <td className="px-2 py-1 text-right tabular-nums" title={s.valueAt ? `as of ${monthLabel(s.valueAt)}` : undefined}>{s.value !== null ? formatPrice(s.value) : '–'}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-600">{s.value !== null ? formatPrice(edoAfterTax(s.value)) : '–'}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-600">{ann !== null ? `${ann.toFixed(2)}%` : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          As an asset (Backtest, Monthly, Annual, Best to Worst), EDO is bought at par on the start date — the series sold the following
          month — held to maturity and rolled into the next series. Pre-tax; the early-redemption fee is ignored.
        </p>
      </div>
    </div>
  );
}
