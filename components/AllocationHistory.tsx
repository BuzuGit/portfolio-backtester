/*
  ASSET ALLOCATION OVER TIME — the Portfolio tab's chart under Daily NAV Drawdowns.

  Answers "how has my mix changed?": each day of the Daily sheet split into asset classes (or
  currencies) as a share of net worth, stacked to 100%. Equities and Metals & Crypto sit at the
  bottom, so the dark line along the top of the gold band is the "risk-on" share.

  Under the chart, a "Then vs Now" strip compares one past day (the start of the period, or the
  day under the pointer) with today, band by band.

  The maths is in lib/allocation.ts. Every choice (view, currency, period) lives in the main
  screen and is passed in, so it survives switching tabs; only the hovered day is kept here.
*/
import React, { useMemo, useState } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip } from 'recharts';
import type { DailyNavRow } from '@/lib/fetchData';
import {
  ALLOC_CLASSES, ALLOC_CURRENCIES, RISK_ON_CLASSES, dailyAllocation, plnTo, riskOnPct, sharesPct, type AllocPoint,
} from '@/lib/allocation';
import { isPhoneScreen } from '@/lib/savedSheet';
import { MONTH_ABBR } from '@/lib/dates';
import { PhoneChoice, periodOptions } from '@/components/PhoneSheet';
import {
  ASSET_CLASS_COLORS, CARD, CURRENCY_COLORS, INK, LINE, MUTED, ResponsiveContainer, SEG, readableTextOn, segBtn,
} from '@/components/ui';

export type AllocView = 'class' | 'currency';
type Ccy = 'PLN' | 'USD' | 'SGD' | 'CHF';
type Period = '1Y' | '3Y' | '5Y' | 'Max';
const CCYS: readonly Ccy[] = ['PLN', 'USD', 'SGD', 'CHF'];
const PERIODS: readonly Period[] = ['1Y', '3Y', '5Y', 'Max'];
// The risk-on line: the app's main dark ink, so it reads as "the summary" over the coloured bands.
// Shared with the Positions tab's month-end chart.
export const RISK_LINE = INK;
export const RISK_LABEL = `Risk-on (${RISK_ON_CLASSES.join(' + ').replace('Metals & Crypto', 'M&C')})`;

// One band of the chart: what it is called, its colour, and how to read its amount from a day
interface Band { name: string; color: string; pln: (p: AllocPoint) => number }

const classBands: Band[] = ALLOC_CLASSES.map(c => ({ name: c, color: ASSET_CLASS_COLORS[c] ?? '#94a3b8', pln: p => p.byClass[c] }));
const currencyBands: Band[] = ALLOC_CURRENCIES.map(c => ({ name: c, color: CURRENCY_COLORS[c] ?? '#94a3b8', pln: p => p.byCurrency[c] }));

// "2021-03-15" -> "15 Mar 2021"
export const longDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTH_ABBR[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
// "2021-03-15" -> "Mar 21"
export const monthYear = (d: string) => `${MONTH_ABBR[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`;
const pct = (v: number) => `${v.toFixed(1)}%`;
const money = (v: number | null, ccy: string) =>
  v === null ? '—' : `${Math.round(v).toLocaleString('en-US')} ${ccy}`;

export interface AllocationHistoryProps {
  dailyData: DailyNavRow[];
  view: AllocView; setView: (v: AllocView) => void;
  currency: Ccy; setCurrency: (c: Ccy) => void;
  period: Period; setPeriod: (p: Period) => void;
}

export default function AllocationHistory({ dailyData, view, setView, currency, setCurrency, period, setPeriod }: AllocationHistoryProps) {
  // The day under the pointer (null = not hovering: "Then" is the start of the period)
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  // Every day of the sheet, sorted into classes and currencies (redone only when the data reloads)
  const points = useMemo(
    () => dailyAllocation(dailyData.flatMap(r => (r.alloc ? [r.alloc] : []))),
    [dailyData],
  );

  // The days inside the chosen period — the same cut-off rule as the two charts above
  const shown = useMemo(() => {
    const now = new Date();
    const years = period === 'Max' ? 0 : Number(period[0]);
    const cutoff = years ? new Date(new Date().setFullYear(now.getFullYear() - years)) : new Date('1900-01-01');
    return points.filter(p => new Date(p.date) >= cutoff);
  }, [points, period]);

  // The bands for this view, dropping any that are empty for the whole period (Multi-asset in the
  // last year, say), so the legend lists only what is actually in the chart
  const bands = useMemo(
    () => (view === 'class' ? classBands : currencyBands).filter(b => shown.some(p => b.pln(p) > 0)),
    [view, shown],
  );

  // The chart's rows: each band's share in % (keys b0, b1... because names like "M&C" make poor
  // keys), the risk-on share, and the day itself for the tooltip's amounts
  const chartData = useMemo(() => shown.map(p => {
    const row: Record<string, unknown> = { date: p.date, point: p, riskOn: riskOnPct(p) };
    bands.forEach((b, i) => { row[`b${i}`] = (b.pln(p) / p.totalPln) * 100; });
    return row;
  }), [shown, bands]);

  if (points.length === 0 || shown.length === 0) return null;

  const now = shown[shown.length - 1];
  const thenPoint = (hoverDate && shown.find(p => p.date === hoverDate)) || shown[0];

  // The risk-on share's high and low in the period, measured on MONTH-END days only. Selling one
  // ETF and buying its replacement a day or two later parks the money in cash for those days
  // (12 Sep 2025: 19.9% for one trading day), which is a trade in progress, not a risk-off period.
  // The chart still shows those days; the headline figures skip them.
  const monthEnds = shown.filter((p, i) => i === shown.length - 1 || shown[i + 1].date.slice(0, 7) !== p.date.slice(0, 7));
  let hi = monthEnds[0], lo = monthEnds[0];
  for (const p of monthEnds) {
    if (riskOnPct(p) > riskOnPct(hi)) hi = p;
    if (riskOnPct(p) < riskOnPct(lo)) lo = p;
  }

  return (
    <div className="mb-6">
      {/* Phones: the note goes under the title instead of squeezing it */}
      <div className="flex items-center justify-between mb-2 max-md:flex-col max-md:items-start max-md:gap-0.5">
        <h3 className="text-md font-semibold text-gray-700">Asset Allocation</h3>
        <span className="text-xs text-gray-400">Share of net worth each day, incl. property · from the Daily sheet</span>
      </div>

      {/* Controls. Phones: three boxes that open slide-up panels */}
      <div className="hidden max-md:flex gap-2 mb-4">
        <PhoneChoice label="View" options={[{ value: 'class', label: 'By class' }, { value: 'currency', label: 'By currency' }]}
          selected={view} onPick={v => setView(v as AllocView)} />
        <PhoneChoice label="Amounts in" options={CCYS.map(c => ({ value: c, label: c }))}
          selected={currency} onPick={c => setCurrency(c as Ccy)} />
        <PhoneChoice label="Period" options={periodOptions(PERIODS)}
          selected={period} onPick={p => setPeriod(p as Period)} />
      </div>
      <div className="flex items-center gap-5 mb-4 flex-wrap max-md:hidden">
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">View:</span>
          <span className={SEG}>
            <button onClick={() => setView('class')} className={segBtn(view === 'class')}>By class</button>
            <button onClick={() => setView('currency')} className={segBtn(view === 'currency')}>By currency</button>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Amounts in:</span>
          <span className={SEG}>
            {CCYS.map(c => <button key={c} onClick={() => setCurrency(c)} className={segBtn(currency === c)}>{c}</button>)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Period:</span>
          <span className={SEG}>
            {PERIODS.map(p => <button key={p} onClick={() => setPeriod(p)} className={segBtn(period === p)}>{p}</button>)}
          </span>
        </div>
      </div>

      <div className="bg-white p-4 rounded-lg shadow">
        {/* Risk-on summary: today, and the period's high and low with their dates (class view
            only, like the line it describes) */}
        <div className={`flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs mb-3 ${view === 'class' ? '' : 'hidden'}`}>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5" style={{ background: RISK_LINE }} />
            <span className="text-gray-500">{RISK_LABEL}:</span>
            <span className="font-semibold text-gray-800">{pct(riskOnPct(now))}</span>
            <span className="text-gray-400">today</span>
          </span>
          <span title="Measured on month-end days, so the day or two an ETF switch spends in cash doesn't count">
            <span className="text-gray-500">Month-end high </span><span className="font-semibold text-gray-800">{pct(riskOnPct(hi))}</span>
            <span className="text-gray-400"> {monthYear(hi.date)}</span></span>
          <span title="Measured on month-end days, so the day or two an ETF switch spends in cash doesn't count">
            <span className="text-gray-500">low </span><span className="font-semibold text-gray-800">{pct(riskOnPct(lo))}</span>
            <span className="text-gray-400"> {monthYear(lo.date)}</span></span>
        </div>

        <AllocationChart chartData={chartData} bands={bands} showRisk={view === 'class'} currency={currency} onHover={setHoverDate} />

        {/* Legend, in the same top-to-bottom order as the bands */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-600">
          {[...bands].reverse().map(b => (
            <span key={b.name} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: b.color }} />{b.name}
            </span>
          ))}
          {view === 'class' && (
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="inline-block w-4 h-0.5" style={{ background: RISK_LINE }} />{RISK_LABEL}
            </span>
          )}
        </div>

        <ThenVsNow
          thenLabel={longDate(thenPoint.date)} nowLabel={longDate(now.date)} bands={bands}
          thenPct={bands.map(b => (b.pln(thenPoint) / thenPoint.totalPln) * 100)}
          nowPct={bands.map(b => (b.pln(now) / now.totalPln) * 100)}
          hint={hoverDate ? 'Showing the day under the pointer.' : 'Then = start of the period. Hover (or touch) the chart to compare another day.'}
        />
      </div>
    </div>
  );
}

// The stacked chart on its own, and memoised: moving the pointer changes the "Then" day above,
// and without this every move would redraw ~1,800 days x 7 bands.
const AllocationChart = React.memo(function AllocationChart({ chartData, bands, showRisk, currency, onHover }: {
  chartData: Record<string, unknown>[];
  bands: Band[];
  showRisk: boolean;
  currency: Ccy;
  onHover: (date: string | null) => void;
}) {
  // X axis: the first day of each year, or of every third month when the period is under 3 years
  const ticks: string[] = [];
  const tickLabel = new Map<string, string>();
  if (chartData.length > 0) {
    const first = String(chartData[0].date), last = String(chartData[chartData.length - 1].date);
    const yearly = (new Date(last).getTime() - new Date(first).getTime()) / (365.25 * 864e5) >= 3;
    let prev = first.slice(0, yearly ? 4 : 7);
    for (const r of chartData) {
      const d = String(r.date);
      const key = d.slice(0, yearly ? 4 : 7);
      const month = Number(d.slice(5, 7));
      if (key !== prev && (yearly || (month - 1) % 3 === 0)) {
        ticks.push(d);
        tickLabel.set(d, yearly ? key : monthYear(d));
      }
      prev = key;
    }
  }
  const phone = isPhoneScreen();

  return (
    <ResponsiveContainer width="100%" height={phone ? 280 : 360}>
      <ComposedChart
        data={chartData}
        margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
        onMouseMove={(s: { activeLabel?: string | number }) => { if (s?.activeLabel) onHover(String(s.activeLabel)); }}
        onMouseLeave={() => onHover(null)}
      >
        <XAxis dataKey="date" ticks={ticks} interval={0} tickFormatter={(d: string) => tickLabel.get(d) ?? d}
          tick={{ fontSize: 11, fill: MUTED }} tickLine={false} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`}
          tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} width={40} allowDataOverflow />
        <Tooltip content={<AllocTooltip bands={bands} showRisk={showRisk} currency={currency} />} />
        {bands.map((b, i) => (
          <Area key={b.name} type="linear" dataKey={`b${i}`} name={b.name} stackId="mix"
            stroke={b.color} strokeWidth={0.5} fill={b.color} fillOpacity={0.88} isAnimationActive={false} />
        ))}
        {showRisk && (
          <Line type="linear" dataKey="riskOn" name="Risk-on" stroke={RISK_LINE} strokeWidth={1.5}
            dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
});

// The Portfolio chart's hover box: turns the day under the pointer into rows for AllocTooltipBox
function AllocTooltip({ active, payload, bands, showRisk, currency }: {
  active?: boolean;
  payload?: { payload?: { point?: AllocPoint; riskOn?: number } }[];
  bands: Band[]; showRisk: boolean; currency: Ccy;
}) {
  const row = payload?.[0]?.payload;
  const p = row?.point;
  if (!active || !p) return null;
  return (
    <AllocTooltipBox
      title={longDate(p.date)}
      rows={bands.map(b => ({ name: b.name, color: b.color, pct: (b.pln(p) / p.totalPln) * 100, amount: plnTo(p, b.pln(p), currency) }))}
      total={plnTo(p, p.totalPln, currency)}
      currency={currency}
      riskOn={showRisk ? row?.riskOn : undefined}
    />
  );
}

/**
 * The hover box both allocation charts share: each band from top to bottom with its share and
 * its amount, the total, and the risk-on share. `rows` run bottom band first (the stack order);
 * empty ones are skipped. `estimated` puts "≈" before an amount valued without a market price.
 */
export function AllocTooltipBox({ title, rows, total, currency, riskOn, note }: {
  title: string;
  rows: { name: string; color: string; pct: number; amount: number | null; estimated?: boolean }[];
  total: number | null;
  currency: string;
  riskOn?: number;
  note?: string;
}) {
  return (
    <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
      <div className="font-semibold mb-1" style={{ color: INK }}>{title}</div>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {[...rows].reverse().map(r => {
            if (!(r.pct > 0)) return null;
            return (
              <tr key={r.name}>
                <td style={{ paddingRight: 10 }}>
                  <span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: r.color }} />{r.name}
                </td>
                <td style={{ textAlign: 'right', paddingRight: 10, fontWeight: 600 }}>{pct(r.pct)}</td>
                <td style={{ textAlign: 'right', color: MUTED }}>{r.estimated ? '≈ ' : ''}{money(r.amount, currency)}</td>
              </tr>
            );
          })}
          <tr style={{ borderTop: `1px solid ${LINE}` }}>
            <td style={{ paddingRight: 10, paddingTop: 2 }}>Total</td>
            <td />
            <td style={{ textAlign: 'right', paddingTop: 2, fontWeight: 600 }}>{money(total, currency)}</td>
          </tr>
          {riskOn !== undefined && (
            <tr>
              <td style={{ paddingRight: 10 }}>Risk-on</td>
              <td style={{ textAlign: 'right', paddingRight: 10, fontWeight: 600 }}>{pct(riskOn)}</td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
      {note && <div style={{ color: MUTED, fontSize: 11, marginTop: 4, maxWidth: 260 }}>{note}</div>}
    </div>
  );
}

/**
 * Two thin 100% bars, a past date and today, and how much each band moved between them, in
 * percentage points. Neutral colours on purpose: a shift in the mix is not a gain or a loss.
 * Shared by both allocation charts. `bands`, `thenPct` and `nowPct` run bottom band first.
 */
export function ThenVsNow({ thenLabel, nowLabel, bands, thenPct, nowPct, hint }: {
  thenLabel: string; nowLabel: string;
  bands: { name: string; color: string }[];
  thenPct: number[]; nowPct: number[];
  hint: string;
}) {
  const bar = (shares: number[]) => (
    <div className="flex h-5 w-full rounded overflow-hidden">
      {[...bands].reverse().map((b, ri) => {
        const v = shares[bands.length - 1 - ri];
        if (v <= 0) return null;
        return (
          <div key={b.name} title={`${b.name} ${pct(v)}`} className="h-full flex items-center justify-center overflow-hidden"
            style={{ width: `${v}%`, background: b.color }}>
            {v >= 7 && <span className="text-[10px] font-semibold whitespace-nowrap" style={{ color: readableTextOn(b.color) }}>{v.toFixed(0)}%</span>}
          </div>
        );
      })}
    </div>
  );
  return (
    <div className="mt-4 pt-3 border-t border-gray-200">
      <div className="grid grid-cols-[150px_1fr] max-md:grid-cols-1 gap-x-3 gap-y-1.5 items-center text-xs">
        <span className="text-gray-500 whitespace-nowrap">
          <span className="font-semibold text-gray-700">Then</span> · {thenLabel}
        </span>
        {bar(thenPct)}
        <span className="text-gray-500 whitespace-nowrap max-md:mt-1">
          <span className="font-semibold text-gray-700">Now</span> · {nowLabel}
        </span>
        {bar(nowPct)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
        <span className="text-gray-400">Change:</span>
        {[...bands].reverse().map(b => {
          const i = bands.indexOf(b);
          const d = nowPct[i] - thenPct[i];
          if (Math.abs(d) < 0.05) return null;
          return (
            <span key={b.name} className="whitespace-nowrap text-gray-600">
              <span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: b.color }} />
              {b.name} <span className="font-semibold text-gray-800">{d > 0 ? '▲ +' : '▼ −'}{Math.abs(d).toFixed(1)}pp</span>
            </span>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-400 mt-1.5">{hint}</p>
    </div>
  );
}
