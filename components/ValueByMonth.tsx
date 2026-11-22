/*
  VALUE BY MONTH-END — the Positions tab's chart of how much money there was, month by month.

  Allocation by Month-end (just above it) answers "what share was in each class?". This one answers
  "how much was it?": one bar per month-end with the amount held, in the tab's chosen currency (PLN
  when positions are shown natively). So it shows whether a class grew or shrank in money, which a
  share can hide (a class can lose share while its amount still rises).

  - No filter: every holding plus cash, all classes combined, in the app's main dark slate.
  - Click a class in By Asset Class above: only that class, in its own colour ("how much did I have
    in Metals & Crypto each month?"). The currency and account filters narrow it the same way.

  It reads the month-ends Allocation by Month-end already rebuilt from the ledger (so nothing is
  computed twice) and that chart's class / currency rules. Its period is its own choice, kept in
  the main screen so it survives switching tabs.
*/
import React, { useCallback, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Customized } from 'recharts';
import type { LedgerMonth } from '@/lib/ledgerAllocation';
import { localTodayIso } from '@/lib/fetchData';
import { isPhoneScreen } from '@/lib/savedSheet';
import { MONTH_ABBR, periodStartIso } from '@/lib/dates';
import { PhoneChoice, periodOptions } from '@/components/PhoneSheet';
import {
  ASSET_CLASS_COLORS, CARD, GAIN, INK, LINE, LOSS, MUTED, ResponsiveContainer, SEG, SLATE, readableTextOn, segBtn,
} from '@/components/ui';
import { EdgeBubbles, phoneAxisMoney, twoLineLabelFont, type BubbleDef } from '@/components/charts';
import { RISK_ROW, dateAxisTicks, monthYear } from '@/components/AllocationHistory';
import type { MonthPeriod } from '@/components/AllocationByMonth';

const PERIODS: readonly MonthPeriod[] = ['1Y', '3Y', '5Y', '10Y', 'Max'];
const CASH = 'Cash';
const LABEL_W = 50;   // the latest-amount label beside the right edge ("1.23M", "845k")

// "2026-11-30" -> "Nov 2026"
const monthLong = (d: string) => `${MONTH_ABBR[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
// 1234567.8 -> "1,234,568"
const money = (v: number) => Math.round(v).toLocaleString('en-US');
// Short form for the right-edge label: "845k", "1.23M"
const shortMoney = (v: number) =>
  Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v));
// "+12,300 (+4.1%)" — a change in money and in %, with its sign
const signedMoney = (v: number) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`;
const signedPct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;

// One month-end bar: the amount (null = no exchange rate to convert it that month)
interface ValuePoint { date: string; value: number; estimated: boolean }

export interface ValueByMonthProps {
  months: LedgerMonth[];
  classOf: (ticker: string) => string;
  ccyOf: (ticker: string, fallback: string) => string;
  tickerAccounts: Record<string, Set<string>>;
  accountFilter: string | null;
  currencyFilter: string | null;
  classFilter: string | null;
  amountCcy: string;
  period: MonthPeriod; setPeriod: (p: MonthPeriod) => void;
}

export default function ValueByMonth({
  months, classOf, ccyOf, tickerAccounts, accountFilter, currencyFilter, classFilter, amountCcy, period, setPeriod,
}: ValueByMonthProps) {
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  // Every month-end's amount after ALL the tab's filters (class, currency, account), converted
  // from PLN with that month's rate. Months before the first one with any money are dropped, so
  // a class bought in 2021 starts in 2021 rather than after years of empty bars.
  const points = useMemo((): ValuePoint[] => {
    const out: ValuePoint[] = [];
    for (const m of months) {
      let pln = 0, estimated = false;
      for (const h of m.holdings) {
        if (h.valuePln === null) continue;   // no exchange rate at all (the chart above says so)
        if (accountFilter && !tickerAccounts[h.ticker]?.has(accountFilter)) continue;
        if (currencyFilter && ccyOf(h.ticker, h.currency) !== currencyFilter) continue;
        if (classFilter && classOf(h.ticker) !== classFilter) continue;
        pln += h.valuePln;
        if (h.estimated) estimated = true;
      }
      for (const c of m.cash) {
        if (c.valuePln === null) continue;
        if (accountFilter && c.account !== accountFilter) continue;
        if (currencyFilter && c.currency !== currencyFilter) continue;
        if (classFilter && classFilter !== CASH) continue;
        pln += c.valuePln;
      }
      // PLN per unit of the chosen currency that month; no rate = no bar that month
      const rate = amountCcy === 'PLN' ? 1 : m.pln[amountCcy];
      if (!rate) continue;
      const value = Math.max(0, pln / rate);   // a rounding overdraft can't make a bar negative
      if (out.length === 0 && value <= 0) continue;
      out.push({ date: m.date, value, estimated });
    }
    return out;
  }, [months, classOf, ccyOf, tickerAccounts, accountFilter, currencyFilter, classFilter, amountCcy]);

  // The months inside the chosen period (the same rule as both allocation charts)
  const shown = useMemo(() => {
    const start = periodStartIso(period);
    return points.filter(p => p.date >= start);
  }, [points, period]);

  // The bar colour: the class's own colour when one class is picked, else the app's main slate
  const color = (classFilter && ASSET_CLASS_COLORS[classFilter]) || SLATE;
  const byDate = useMemo(() => new Map(shown.map((p, i) => [p.date, { p, prev: shown[i - 1] }])), [shown]);
  const lastDate = shown.length > 0 ? shown[shown.length - 1].date : '';

  // The hover box: the month's amount and how it moved from the month before
  const renderTooltip = useCallback((t: { active?: boolean; label?: string | number }) => {
    const hit = t.active && t.label !== undefined ? byDate.get(String(t.label)) : undefined;
    if (!hit) return null;
    const { p, prev } = hit;
    const diff = prev ? p.value - prev.value : null;
    return (
      <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
        <div className="font-semibold mb-1" style={{ color: INK }}>
          {p.date === lastDate ? `${monthLong(p.date)} · latest` : `End of ${monthLong(p.date)}`}
        </div>
        <div style={{ color: INK }}>
          <span className="font-semibold">{p.estimated ? '≈ ' : ''}{money(p.value)}</span> {amountCcy}
        </div>
        {diff !== null && prev && (
          <div style={{ color: diff >= 0 ? GAIN : LOSS }}>
            {signedMoney(diff)}{prev.value > 0 ? ` (${signedPct((diff / prev.value) * 100)})` : ''} vs {monthLong(prev.date)}
          </div>
        )}
        {p.estimated && <div style={{ color: MUTED, fontSize: 11, marginTop: 4, maxWidth: 240 }}>≈ includes a holding with no market price yet, valued from its own buy and sale prices.</div>}
      </div>
    );
  }, [byDate, lastDate, amountCcy]);

  if (shown.length === 0) return null;

  const first = shown[0], last = shown[shown.length - 1];
  // "Then" = the hovered month, else the period's first month; compared with the latest
  const thenP = (hoverDate && byDate.get(hoverDate)?.p) || first;
  const change = last.value - thenP.value;
  // High and low over COMPLETED months: the last bar is the month in progress (today's prices)
  const today = localTodayIso();
  const completed = shown.filter(p => p.date <= today);
  const ranked = completed.length > 0 ? completed : shown;
  let hi = ranked[0], lo = ranked[0];
  for (const p of ranked) {
    if (p.value > hi.value) hi = p;
    if (p.value < lo.value) lo = p;
  }

  // What the filters above are doing to this chart, in words
  const filterNote = [
    classFilter && `${classFilter} only`,
    currencyFilter && `${currencyFilter} only`,
    accountFilter && `${accountFilter} only`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="bg-white p-4 rounded-lg shadow mb-4">
      <div className="flex items-center justify-between mb-3 gap-3 max-md:flex-col max-md:items-start max-md:gap-0.5">
        <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2 flex-wrap">
          Value by Month-end
          {filterNote
            ? <span className="text-xs font-normal text-amber-600">— {filterNote}</span>
            : <span className="text-xs font-normal text-gray-400">— all assets + cash</span>}
        </h4>
        <span className="text-xs text-gray-400">Click a class in By Asset Class to see only that class · amounts in {amountCcy}</span>
      </div>

      {/* Period. Phones: a box that opens a slide-up panel */}
      <div className="hidden max-md:flex gap-2 mb-3">
        <PhoneChoice label="Period" options={periodOptions(PERIODS)} selected={period} onPick={p => setPeriod(p as MonthPeriod)} />
      </div>
      <div className="flex items-center gap-1 mb-3 max-md:hidden">
        <span className="text-xs text-gray-500 mr-1">Period:</span>
        <span className={SEG}>
          {PERIODS.map(p => <button key={p} onClick={() => setPeriod(p)} className={segBtn(period === p)}>{p}</button>)}
        </span>
      </div>

      {/* Summary: latest amount, the change since "then", and the period's high and low */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs mb-3">
        <span className={RISK_ROW}>
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
          <span className="text-gray-500">Latest:</span>
          <span className="font-semibold text-gray-800">{money(last.value)} {amountCcy}</span>
        </span>
        <span className={RISK_ROW} title={hoverDate ? 'Since the month under the pointer' : 'Since the first month of the period'}>
          <span className="text-gray-500">Since {monthYear(thenP.date)}</span>
          <span className="font-semibold" style={{ color: change >= 0 ? GAIN : LOSS }}>
            {signedMoney(change)}{thenP.value > 0 ? ` (${signedPct((change / thenP.value) * 100)})` : ''}
          </span>
        </span>
        <span className={RISK_ROW} title="Over finished months only (the current month is still moving)">
          <span className="text-gray-500">High</span>
          <span className="font-semibold text-gray-800">{money(hi.value)}</span>
          <span className="text-gray-400">{monthYear(hi.date)}</span>
        </span>
        <span className={RISK_ROW} title="Over finished months only (the current month is still moving)">
          <span className="text-gray-500">Low</span>
          <span className="font-semibold text-gray-800">{money(lo.value)}</span>
          <span className="text-gray-400">{monthYear(lo.date)}</span>
        </span>
      </div>

      <ValueBars shown={shown} color={color} renderTooltip={renderTooltip} onHover={setHoverDate} />
      <p className="text-xs text-gray-400 mt-2">
        {hoverDate ? 'Change measured from the month under the pointer.' : 'Hover (or touch) a bar to see its amount and the change from it to the latest month.'}
      </p>
    </div>
  );
}

// The bars on their own, memoised: hovering changes only the hovered month in the parent, so the
// ~100 bars aren't redrawn on every pointer move.
const ValueBars = React.memo(function ValueBars({ shown, color, renderTooltip, onHover }: {
  shown: ValuePoint[];
  color: string;
  renderTooltip: (t: { active?: boolean; label?: string | number }) => React.ReactNode;
  onHover: (date: string | null) => void;
}) {
  const { ticks, label } = dateAxisTicks(shown.map(p => p.date));
  const phone = isPhoneScreen();
  // As in Allocation by Month-end: on a phone ~100 bars touch, and a 1px outline in the bar's own
  // colour closes the pinstripe gaps that whole-pixel bar widths leave
  const touching = phone && shown.length > 40;
  const last = shown[shown.length - 1];
  const edgeDefs: BubbleDef[] = [{
    value: last.value, color, label: shortMoney(last.value),
    // Slate flips with dark mode and the bubble code already handles it; a class colour doesn't
    textColor: color === SLATE ? undefined : readableTextOn(color),
  }];
  return (
    <ResponsiveContainer width="100%" height={phone ? 240 : 300}>
      <BarChart
        data={shown}
        margin={{ top: 10, right: LABEL_W + 8, left: 0, bottom: 0 }}
        barCategoryGap={touching ? 0 : shown.length > 60 ? '10%' : '20%'}
        onMouseMove={(s: { activeLabel?: string | number }) => { if (s?.activeLabel) onHover(String(s.activeLabel)); }}
        onMouseLeave={() => onHover(null)}
      >
        <XAxis dataKey="date" ticks={ticks} interval={0} tickFormatter={label}
          tick={{ fontSize: 11, fill: MUTED }} tickLine={false} />
        <YAxis tickFormatter={phoneAxisMoney() ?? ((v: number) => money(v))}
          tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} width={phone ? 40 : 76} />
        <Tooltip cursor={{ fill: 'rgba(148,163,184,0.15)' }} content={renderTooltip} />
        <Bar dataKey="value" name="Value" fill={color} isAnimationActive={false}
          stroke={touching ? color : undefined} strokeWidth={touching ? 1 : 0} />
        {/* The latest amount beside the right edge, like the allocation charts' latest % */}
        <Customized component={<EdgeBubbles defs={edgeDefs} bubbleWidth={LABEL_W} fontSize={twoLineLabelFont()} />} />
      </BarChart>
    </ResponsiveContainer>
  );
});
