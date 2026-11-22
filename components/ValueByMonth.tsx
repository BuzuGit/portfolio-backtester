/*
  VALUE BY MONTH-END — the Positions tab's chart of how much money there was, month by month.

  Allocation by Month-end (just above it) answers "what share was in each class?". This one answers
  "how much was it?": one bar per month-end with the amount held, in the tab's chosen currency (PLN
  when positions are shown natively). So it shows whether a class grew or shrank in money, which a
  share can hide (a class can lose share while its amount still rises).

  - No filter: every holding plus cash, all classes combined, in the app's main dark slate.
  - Click a class in By Asset Class above: only that class, its bars split by EXPOSURE (the Lookup
    tab's Exposure column: "World", "Poland", "EM", "Gold"...), with a tick-box per exposure to
    leave some out. An ETF sold and replaced by a similar one (for tax) shares an exposure label,
    so "World equities" stays one continuous series across the swap. An asset with no Exposure
    given shows under its own ticker. The currency and account filters narrow it the same way.

  It reads the month-ends Allocation by Month-end already rebuilt from the ledger (so nothing is
  computed twice) and that chart's class / currency rules. Its period and the exposures left out
  are kept in the main screen, so they survive switching tabs.
*/
import React, { useCallback, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Customized } from 'recharts';
import type { LedgerMonth } from '@/lib/ledgerAllocation';
import { localTodayIso } from '@/lib/fetchData';
import { isPhoneScreen } from '@/lib/savedSheet';
import { MONTH_ABBR, periodStartIso } from '@/lib/dates';
import { PhoneChoice, periodOptions } from '@/components/PhoneSheet';
import {
  ASSET_CLASS_COLORS, CARD, CHART_PALETTE, GAIN, INK, LINE, LOSS, MUTED, RETURN_MAP_ASSET_COLORS, ResponsiveContainer, SEG,
  SLATE, readableTextOn, segBtn,
} from '@/components/ui';
import { EdgeBubbles, phoneAxisMoney, twoLineLabelFont, type BubbleDef } from '@/components/charts';
import { RISK_ROW, dateAxisTicks, monthYear } from '@/components/AllocationHistory';
import type { MonthPeriod } from '@/components/AllocationByMonth';

const PERIODS: readonly MonthPeriod[] = ['1Y', '3Y', '5Y', '10Y', 'Max'];
const CASH = 'Cash';
const ALL = 'All';    // the one group when no class is picked
const LABEL_W = 50;   // the latest-amount label beside the right edge ("1.23M", "845k")
// One colour per exposure group: the theme's eight chart colours first, then the Return Map's
// 32 distinct ones, so even a long list never repeats
const GROUP_COLORS = [...Object.values(CHART_PALETTE), ...RETURN_MAP_ASSET_COLORS];

// "2026-11-30" -> "Nov 2026"
const monthLong = (d: string) => `${MONTH_ABBR[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
// 1234567.8 -> "1,234,568"
const money = (v: number) => Math.round(v).toLocaleString('en-US');
// Short form for the right-edge label: "845k", "1.23M"
const shortMoney = (v: number) =>
  Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v));
// "+12,300" / "−4.1%" — a change with its sign
const signedMoney = (v: number) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`;
const signedPct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;

// One month-end before any choice of groups: PLN per group, the rate into the chosen currency,
// and which groups hold a holding valued without a market price
interface RawMonth { date: string; rate: number; byGroup: Record<string, number>; estimated: Set<string> }
// One bar: the chosen groups' amounts (in the chosen currency) and their sum
interface ValuePoint { date: string; value: number; byGroup: Record<string, number>; estimated: boolean }
interface Group { name: string; color: string; tickers: string[] }

export interface ValueByMonthProps {
  months: LedgerMonth[];
  classOf: (ticker: string) => string;
  ccyOf: (ticker: string, fallback: string) => string;
  exposureOf: (ticker: string) => string;
  tickerAccounts: Record<string, Set<string>>;
  accountFilter: string | null;
  currencyFilter: string | null;
  classFilter: string | null;
  amountCcy: string;
  period: MonthPeriod; setPeriod: (p: MonthPeriod) => void;
  // Exposure groups left out, per class ("Equities" -> ["Sector"]); remembered per class
  excluded: Record<string, string[]>;
  setExcluded: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
}

export default function ValueByMonth({
  months, classOf, ccyOf, exposureOf, tickerAccounts, accountFilter, currencyFilter, classFilter, amountCcy,
  period, setPeriod, excluded, setExcluded,
}: ValueByMonthProps) {
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  // Every month-end in PLN per group, after ALL the tab's filters (class, currency, account).
  // The group is the asset's Exposure (its ticker when none is given) once a class is picked;
  // without a class everything is one group. Months with no rate into the chosen currency drop out.
  const raw = useMemo((): RawMonth[] => {
    const groupOf = (ticker: string) => (classFilter ? exposureOf(ticker) || ticker : ALL);
    const out: RawMonth[] = [];
    for (const m of months) {
      const rate = amountCcy === 'PLN' ? 1 : m.pln[amountCcy];
      if (!rate) continue;
      const byGroup: Record<string, number> = {};
      const estimated = new Set<string>();
      for (const h of m.holdings) {
        if (h.valuePln === null) continue;   // no exchange rate at all (the chart above says so)
        if (accountFilter && !tickerAccounts[h.ticker]?.has(accountFilter)) continue;
        if (currencyFilter && ccyOf(h.ticker, h.currency) !== currencyFilter) continue;
        if (classFilter && classOf(h.ticker) !== classFilter) continue;
        const g = groupOf(h.ticker);
        byGroup[g] = (byGroup[g] ?? 0) + h.valuePln;
        if (h.estimated) estimated.add(g);
      }
      for (const c of m.cash) {
        if (c.valuePln === null) continue;
        if (accountFilter && c.account !== accountFilter) continue;
        if (currencyFilter && c.currency !== currencyFilter) continue;
        if (classFilter && classFilter !== CASH) continue;
        const g = classFilter ? CASH : ALL;
        byGroup[g] = (byGroup[g] ?? 0) + c.valuePln;
      }
      out.push({ date: m.date, rate, byGroup, estimated });
    }
    return out;
  }, [months, classOf, ccyOf, exposureOf, tickerAccounts, accountFilter, currencyFilter, classFilter, amountCcy]);

  // The groups ever held, biggest latest amount first (so the biggest sits at the bottom of each
  // bar), each with a fixed colour and the tickers in it (for the tick-box's hover text)
  const groups = useMemo((): Group[] => {
    const latest: Record<string, number> = {}, ever: Record<string, number> = {};
    for (const m of raw) for (const [g, v] of Object.entries(m.byGroup)) {
      if (v > 0) { latest[g] = v; ever[g] = Math.max(ever[g] ?? 0, v); }
    }
    const lastMonth = raw[raw.length - 1];
    const now = (g: string) => Math.max(0, lastMonth?.byGroup[g] ?? 0);
    const names = Object.keys(ever).sort((a, b) => now(b) - now(a) || ever[b] - ever[a] || a.localeCompare(b));
    // Which tickers make up each group, over the whole history
    const tickers: Record<string, Set<string>> = {};
    if (classFilter) {
      for (const m of months) for (const h of m.holdings) {
        if (h.valuePln === null || classOf(h.ticker) !== classFilter) continue;
        const g = exposureOf(h.ticker) || h.ticker;
        (tickers[g] ??= new Set()).add(h.ticker);
      }
    }
    const single = names.length === 1;
    return names.map((name, i) => ({
      name,
      // One group alone keeps the colour the chart had before: the class's, or slate for "All"
      color: single || name === ALL
        ? ((classFilter && ASSET_CLASS_COLORS[classFilter]) || SLATE)
        : GROUP_COLORS[i % GROUP_COLORS.length],
      tickers: Array.from(tickers[name] ?? []).sort(),
    }));
  }, [raw, months, classFilter, classOf, exposureOf]);

  const left = useMemo(() => new Set(classFilter ? excluded[classFilter] ?? [] : []), [excluded, classFilter]);
  const shownGroups = useMemo(() => groups.filter(g => !left.has(g.name)), [groups, left]);

  // The bars: the ticked groups' amounts in the chosen currency, from the first month with any
  // money (a class bought in 2021 starts in 2021), inside the chosen period
  const shown = useMemo((): ValuePoint[] => {
    const start = periodStartIso(period);
    const out: ValuePoint[] = [];
    for (const m of raw) {
      const byGroup: Record<string, number> = {};
      let value = 0, estimated = false;
      for (const g of shownGroups) {
        // A rounding overdraft can't make a bar negative
        const v = Math.max(0, (m.byGroup[g.name] ?? 0) / m.rate);
        byGroup[g.name] = v;
        value += v;
        if (m.estimated.has(g.name)) estimated = true;
      }
      if (out.length === 0 && value <= 0) continue;
      if (m.date < start) continue;
      out.push({ date: m.date, value, byGroup, estimated });
    }
    return out;
  }, [raw, shownGroups, period]);

  const byDate = useMemo(() => new Map(shown.map((p, i) => [p.date, { p, prev: shown[i - 1] }])), [shown]);
  const lastDate = shown.length > 0 ? shown[shown.length - 1].date : '';
  const split = shownGroups.length > 1;

  // The hover box: the month's amount (and each group's, when split) and the move from the month before
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
        {split && (
          <table style={{ borderCollapse: 'collapse', marginBottom: 2 }}>
            <tbody>
              {/* Top of the bar first, like the stack */}
              {[...shownGroups].reverse().map(g => (p.byGroup[g.name] ?? 0) > 0 && (
                <tr key={g.name}>
                  <td style={{ paddingRight: 10 }}>
                    <span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: g.color }} />{g.name}
                  </td>
                  <td style={{ textAlign: 'right', paddingRight: 10, color: MUTED }}>{((p.byGroup[g.name] / p.value) * 100).toFixed(1)}%</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(p.byGroup[g.name])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ color: INK, borderTop: split ? `1px solid ${LINE}` : undefined, paddingTop: split ? 2 : 0 }}>
          {split ? 'Total ' : ''}<span className="font-semibold">{p.estimated ? '≈ ' : ''}{money(p.value)}</span> {amountCcy}
        </div>
        {diff !== null && prev && (
          <div style={{ color: diff >= 0 ? GAIN : LOSS }}>
            {signedMoney(diff)}{prev.value > 0 ? ` (${signedPct((diff / prev.value) * 100)})` : ''} vs {monthLong(prev.date)}
          </div>
        )}
        {p.estimated && <div style={{ color: MUTED, fontSize: 11, marginTop: 4, maxWidth: 240 }}>≈ includes a holding with no market price yet, valued from its own buy and sale prices.</div>}
      </div>
    );
  }, [byDate, lastDate, amountCcy, split, shownGroups]);

  // Tick-boxes: one group in or out; "All" / "None" for the whole class
  const toggle = (name: string) => {
    if (!classFilter) return;
    setExcluded(prev => {
      const cur = prev[classFilter] ?? [];
      return { ...prev, [classFilter]: cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name] };
    });
  };
  const setAll = (on: boolean) => {
    if (!classFilter) return;
    setExcluded(prev => ({ ...prev, [classFilter]: on ? [] : groups.map(g => g.name) }));
  };

  // What the filters above are doing to this chart, in words
  const filterNote = [
    classFilter && `${classFilter} only`,
    currencyFilter && `${currencyFilter} only`,
    accountFilter && `${accountFilter} only`,
  ].filter(Boolean).join(' · ');

  // The tick-boxes, shown once a class is picked and it has more than one exposure
  const groupPicker = classFilter && groups.length > 1 && (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-3 text-xs">
      <span className="text-gray-500 mr-1">Exposure:</span>
      {groups.map(g => {
        const on = !left.has(g.name);
        return (
          <button
            key={g.name}
            type="button"
            onClick={() => toggle(g.name)}
            aria-pressed={on}
            title={g.tickers.length > 0 ? `${g.name}: ${g.tickers.join(', ')}` : g.name}
            className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border ${on ? 'border-slate-400 bg-white text-gray-800' : 'border-gray-200 bg-gray-50 text-gray-400'}`}
          >
            {/* A tick-box in the group's colour: filled while it is in the bars */}
            <span className="inline-block w-3 h-3 rounded-sm border" style={{ background: on ? g.color : 'transparent', borderColor: g.color }} />
            {g.name}
          </button>
        );
      })}
      <span className="inline-flex gap-2 ml-1">
        <button type="button" onClick={() => setAll(true)} className="text-blue-600 hover:underline">All</button>
        <button type="button" onClick={() => setAll(false)} className="text-blue-600 hover:underline">None</button>
      </span>
    </div>
  );

  const header = (
    <>
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
      {groupPicker}
    </>
  );

  // Nothing to draw (e.g. every exposure unticked): keep the controls, so they can be ticked back
  if (shown.length === 0) {
    if (groups.length === 0) return null;
    return (
      <div className="bg-white p-4 rounded-lg shadow mb-4">
        {header}
        <p className="text-sm text-gray-500 py-6 text-center">Nothing to show: tick at least one exposure above.</p>
      </div>
    );
  }

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
  // The summary's colour swatch and the latest-amount label: one group's colour, else slate
  const totalColor = split ? SLATE : shownGroups[0]?.color ?? SLATE;

  return (
    <div className="bg-white p-4 rounded-lg shadow mb-4">
      {header}

      {/* Summary: latest amount, the change since "then", and the period's high and low */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs mb-3">
        <span className={RISK_ROW}>
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: totalColor }} />
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

      <ValueBars shown={shown} groups={shownGroups} totalColor={totalColor} renderTooltip={renderTooltip} onHover={setHoverDate} />
      <p className="text-xs text-gray-400 mt-2">
        {hoverDate ? 'Change measured from the month under the pointer.' : 'Hover (or touch) a bar to see its amount and the change from it to the latest month.'}
        {classFilter && groups.length > 1 && ' Exposure comes from the Lookup tab; an asset without one is shown under its ticker.'}
      </p>
    </div>
  );
}

// The bars on their own, memoised: hovering changes only the hovered month in the parent, so the
// ~100 bars aren't redrawn on every pointer move. One stacked series per group.
const ValueBars = React.memo(function ValueBars({ shown, groups, totalColor, renderTooltip, onHover }: {
  shown: ValuePoint[];
  groups: Group[];
  totalColor: string;
  renderTooltip: (t: { active?: boolean; label?: string | number }) => React.ReactNode;
  onHover: (date: string | null) => void;
}) {
  const { ticks, label } = dateAxisTicks(shown.map(p => p.date));
  const phone = isPhoneScreen();
  // As in Allocation by Month-end: on a phone ~100 bars touch, and a 1px outline in the bar's own
  // colour closes the pinstripe gaps that whole-pixel bar widths leave
  const touching = phone && shown.length > 40;
  // Recharts reads each series from a flat row: g0, g1... in `groups` order (bottom first)
  const data = useMemo(
    () => shown.map(p => {
      const row: Record<string, number | string> = { date: p.date };
      groups.forEach((g, i) => { row[`g${i}`] = p.byGroup[g.name] ?? 0; });
      return row;
    }),
    [shown, groups],
  );
  const last = shown[shown.length - 1];
  const edgeDefs: BubbleDef[] = [{
    value: last.value, color: totalColor, label: shortMoney(last.value),
    // Slate flips with dark mode and the bubble code already handles it; a class colour doesn't
    textColor: totalColor === SLATE ? undefined : readableTextOn(totalColor),
  }];
  return (
    <ResponsiveContainer width="100%" height={phone ? 240 : 300}>
      <BarChart
        data={data}
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
        {groups.map((g, i) => (
          <Bar key={g.name} dataKey={`g${i}`} name={g.name} stackId="value" fill={g.color} isAnimationActive={false}
            stroke={touching ? g.color : undefined} strokeWidth={touching ? 1 : 0} />
        ))}
        {/* The latest total beside the right edge, like the allocation charts' latest % */}
        <Customized component={<EdgeBubbles defs={edgeDefs} bubbleWidth={LABEL_W} fontSize={twoLineLabelFont()} />} />
      </BarChart>
    </ResponsiveContainer>
  );
});
