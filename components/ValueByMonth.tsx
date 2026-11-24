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
  - Pick only a Holdings currency (no class): the same exposure split and tick-boxes, over every
    class held in that currency, plus that currency's cash.

  It reads the month-ends Allocation by Month-end already rebuilt from the ledger (so nothing is
  computed twice) and that chart's class / currency rules. Its period and the exposures left out
  are kept in the main screen, so they survive switching tabs.
*/
import React, { useCallback, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Customized, LabelList } from 'recharts';
import type { LedgerMonth } from '@/lib/ledgerAllocation';
import { localTodayIso } from '@/lib/fetchData';
import { isPhoneScreen } from '@/lib/savedSheet';
import { MONTH_ABBR, periodStartIso } from '@/lib/dates';
import { PhoneChoice, periodOptions } from '@/components/PhoneSheet';
import {
  ASSET_CLASS_COLORS, CARD, CHART_PALETTE, GAIN, INK, LINE, LOSS, MUTED, RETURN_MAP_ASSET_COLORS, ResponsiveContainer, SEG,
  SLATE, barLabelRoom, barValueLabel, readableTextOn, segBtn, shortLabelMoney,
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
export const GROUP_COLORS = [...Object.values(CHART_PALETTE), ...RETURN_MAP_ASSET_COLORS];

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
// A figure in the chart's unit: "1,234,567" (money) or "12.3%" (share of the portfolio)
const fmtIn = (share: boolean, v: number) => (share ? `${v.toFixed(1)}%` : money(v));
// A change in the chart's unit: "+12,300 (+4.1%)" in money; in shares, percentage points
// ("+2.1pp"), because "the share grew 20%" would be a % of a % and reads like a much bigger move
const changeIn = (share: boolean, diff: number, from: number) => (share
  ? `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)}pp`
  : `${signedMoney(diff)}${from > 0 ? ` (${signedPct((diff / from) * 100)})` : ''}`);

// A group's key: its label in lower case with spaces tidied, so "World", "world" and "World "
// typed on different rows of the sheet are one group (shown with the first spelling met)
const groupKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase();

// One month-end before any choice of groups: PLN per group key, the rate into the chosen
// currency, and which groups hold a holding valued without a market price
// What "% of portfolio" divides by, two ways (the user's switch, 2026-11-23):
//   `portfolioPln` = "of filtered": every class, after the Holdings (currency) and account filters
//                    — the same total as Allocation by Month-end's bars;
//   `wholePln`     = "of whole portfolio": every class, every currency, every account.
interface RawMonth { date: string; rate: number; byGroup: Record<string, number>; estimated: Set<string>; portfolioPln: number; wholePln: number }
// What "% of portfolio" is a share of
export type ShareBase = 'whole' | 'filtered';
// One bar. `value` and `byGroup` are what the bars show: amounts in the chosen currency, or (in
// "% of portfolio") shares of the portfolio in %. `amount` is always the money, for the hover box.
interface ValuePoint { date: string; value: number; byGroup: Record<string, number>; amount: number; byGroupAmount: Record<string, number>; estimated: boolean }
// What the bars measure: money (the default) or each exposure's share of the whole portfolio
export type ValueMode = 'value' | 'share';
// `name` is the group key (what the unticked list stores), `label` what is shown
interface Group { name: string; label: string; color: string; tickers: string[] }

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
  // Value (money) or % of portfolio. The switch shows once a class or currency is picked: with everything
  // in the bars, the share would be 100% every month.
  mode: ValueMode; setMode: (m: ValueMode) => void;
  // "% of portfolio" of the whole portfolio, or of the part the Holdings / account filters leave
  shareBase: ShareBase; setShareBase: (b: ShareBase) => void;
}

export default function ValueByMonth({
  months, classOf, ccyOf, exposureOf, tickerAccounts, accountFilter, currencyFilter, classFilter, amountCcy,
  period, setPeriod, excluded, setExcluded, mode: chosenMode, setMode, shareBase, setShareBase,
}: ValueByMonthProps) {
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  // The bars split by exposure once a class OR a Holdings currency is picked (the currency one
  // added 2026-11-24: "USD only" then shows World / US / Gold... instead of one grey column).
  // `splitKey` is also where the unticked exposures are remembered: per class ("Equities"), or
  // per currency ("ccy:USD") when only a currency is picked. A class wins when both are picked.
  const splitKey = classFilter ?? (currencyFilter ? `ccy:${currencyFilter}` : null);
  // % of portfolio only means something for a slice of it
  const share = !!splitKey && chosenMode === 'share';
  // The whole / filtered choice matters only while a Holdings or account filter narrows things
  const baseMatters = !!(currencyFilter || accountFilter);
  const ofWhole = !baseMatters || shareBase === 'whole';

  // Every month-end in PLN per group, after ALL the tab's filters (class, currency, account).
  // The group is the asset's Exposure (its ticker when none is given) once a class is picked;
  // without a class everything is one group. Months with no rate into the chosen currency drop out.
  const { raw, tickers, labels } = useMemo(() => {
    // A holding's group label: its Exposure, else its ticker, once a class or currency is picked
    const labelOf = (ticker: string) => (splitKey ? exposureOf(ticker) || ticker : ALL);
    const out: RawMonth[] = [];
    const tickers: Record<string, Set<string>> = {};    // group key -> the tickers in its bars
    const labels: Record<string, string> = {};          // group key -> label to show (first spelling met)
    const add = (byGroup: Record<string, number>, label: string, pln: number) => {
      const key = groupKey(label);
      labels[key] ??= label.trim();
      byGroup[key] = (byGroup[key] ?? 0) + pln;
      return key;
    };
    for (const m of months) {
      const rate = amountCcy === 'PLN' ? 1 : m.pln[amountCcy];
      if (!rate) continue;
      const byGroup: Record<string, number> = {};
      const estimated = new Set<string>();
      // The whole portfolio by class, for "% of portfolio". Built exactly like Allocation by
      // Month-end's class bars (account + currency filters, a class below zero counted as zero),
      // so the two charts agree to the decimal.
      const byClass: Record<string, number> = {};
      // ...and the same with no filters at all, for "of whole portfolio"
      const wholeByClass: Record<string, number> = {};
      for (const h of m.holdings) {
        if (h.valuePln === null) continue;   // no exchange rate at all (the chart above says so)
        const wholeCls = classOf(h.ticker);
        wholeByClass[wholeCls] = (wholeByClass[wholeCls] ?? 0) + h.valuePln;
        if (accountFilter && !tickerAccounts[h.ticker]?.has(accountFilter)) continue;
        if (currencyFilter && ccyOf(h.ticker, h.currency) !== currencyFilter) continue;
        const cls = classOf(h.ticker);
        byClass[cls] = (byClass[cls] ?? 0) + h.valuePln;
        if (classFilter && cls !== classFilter) continue;
        // (the tick-box's hover list is built here, so it obeys the same filters as the bars)
        const key = add(byGroup, labelOf(h.ticker), h.valuePln);
        (tickers[key] ??= new Set()).add(h.ticker);
        if (h.estimated) estimated.add(key);
      }
      for (const c of m.cash) {
        if (c.valuePln === null) continue;
        wholeByClass[CASH] = (wholeByClass[CASH] ?? 0) + c.valuePln;
        if (accountFilter && c.account !== accountFilter) continue;
        if (currencyFilter && c.currency !== currencyFilter) continue;
        byClass[CASH] = (byClass[CASH] ?? 0) + c.valuePln;
        if (classFilter && classFilter !== CASH) continue;
        add(byGroup, splitKey ? CASH : ALL, c.valuePln);
      }
      const portfolioPln = Object.values(byClass).reduce((s, v) => s + Math.max(0, v), 0);
      const wholePln = Object.values(wholeByClass).reduce((s, v) => s + Math.max(0, v), 0);
      out.push({ date: m.date, rate, byGroup, estimated, portfolioPln, wholePln });
    }
    return { raw: out, tickers, labels };
  }, [months, classOf, ccyOf, exposureOf, tickerAccounts, accountFilter, currencyFilter, classFilter, amountCcy, splitKey]);

  // Every group the picked class (or, with only a currency picked, that currency) EVER had,
  // ignoring the other filters, in alphabetical order: the order colours are handed out in, so an
  // exposure keeps its colour when a filter changes or when the amounts rank differently from one
  // month to the next
  const colourOrder = useMemo(() => {
    if (!splitKey) return [] as string[];
    const keys = new Set<string>();
    for (const m of months) for (const h of m.holdings) {
      if (h.valuePln === null) continue;
      const inSlice = classFilter ? classOf(h.ticker) === classFilter : ccyOf(h.ticker, h.currency) === currencyFilter;
      if (inSlice) keys.add(groupKey(exposureOf(h.ticker) || h.ticker));
    }
    // Cash: the Cash class, or (currency picked) any cash ever held in that currency
    if (classFilter ? classFilter === CASH : months.some(m => m.cash.some(c => c.valuePln !== null && c.currency === currencyFilter))) {
      keys.add(groupKey(CASH));
    }
    return Array.from(keys).sort();
  }, [months, splitKey, classFilter, currencyFilter, classOf, ccyOf, exposureOf]);

  // The groups ever held, biggest latest amount first (so the biggest sits at the bottom of each
  // bar), each with its colour and the tickers in it (for the tick-box's hover text)
  const groups = useMemo((): Group[] => {
    const ever: Record<string, number> = {};
    for (const m of raw) for (const [g, v] of Object.entries(m.byGroup)) {
      if (v > 0) ever[g] = Math.max(ever[g] ?? 0, v);
    }
    const lastMonth = raw[raw.length - 1];
    const now = (g: string) => Math.max(0, lastMonth?.byGroup[g] ?? 0);
    const names = Object.keys(ever).sort((a, b) => now(b) - now(a) || ever[b] - ever[a] || a.localeCompare(b));
    // A class with only one group in its whole history keeps the colour the chart had before:
    // the class's own (slate for "All", when no class is picked)
    const single = colourOrder.length <= 1;
    return names.map(name => {
      const at = colourOrder.indexOf(name);
      return {
        name,
        label: labels[name] ?? name,
        color: single || name === groupKey(ALL)
          ? ((classFilter && ASSET_CLASS_COLORS[classFilter]) || SLATE)
          : GROUP_COLORS[(at >= 0 ? at : colourOrder.length) % GROUP_COLORS.length],
        tickers: Array.from(tickers[name] ?? []).sort(),
      };
    });
  }, [raw, tickers, labels, colourOrder, classFilter]);

  const left = useMemo(() => new Set(splitKey ? excluded[splitKey] ?? [] : []), [excluded, splitKey]);
  const shownGroups = useMemo(() => groups.filter(g => !left.has(g.name)), [groups, left]);

  // The bars: the ticked groups' amounts in the chosen currency (or, in "% of portfolio", their
  // share of the whole portfolio that month), from the first month with any money (a class
  // bought in 2021 starts in 2021), inside the chosen period
  const shown = useMemo((): ValuePoint[] => {
    const start = periodStartIso(period);
    const out: ValuePoint[] = [];
    for (const m of raw) {
      const byGroupAmount: Record<string, number> = {}, byGroupShare: Record<string, number> = {};
      let amount = 0, pct = 0, estimated = false;
      for (const g of shownGroups) {
        // A rounding overdraft can't make a bar negative
        const pln = Math.max(0, m.byGroup[g.name] ?? 0);
        byGroupAmount[g.name] = pln / m.rate;
        const base = ofWhole ? m.wholePln : m.portfolioPln;
        byGroupShare[g.name] = base > 0 ? (pln / base) * 100 : 0;
        amount += byGroupAmount[g.name];
        pct += byGroupShare[g.name];
        if (m.estimated.has(g.name)) estimated = true;
      }
      if (out.length === 0 && amount <= 0) continue;
      if (m.date < start) continue;
      out.push({
        date: m.date, value: share ? pct : amount, byGroup: share ? byGroupShare : byGroupAmount,
        amount, byGroupAmount, estimated,
      });
    }
    return out;
  }, [raw, shownGroups, period, share, ofWhole]);

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
              {/* Top of the bar first, like the stack. Value: each group's share of the bar, then
                  its amount. % of portfolio: its share of the portfolio, then its amount. */}
              {[...shownGroups].reverse().map(g => (p.byGroupAmount[g.name] ?? 0) > 0 && (
                <tr key={g.name}>
                  <td style={{ paddingRight: 10 }}>
                    <span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: g.color }} />{g.label}
                  </td>
                  {share ? (
                    <>
                      <td style={{ textAlign: 'right', paddingRight: 10, fontWeight: 600 }}>{p.byGroup[g.name].toFixed(1)}%</td>
                      <td style={{ textAlign: 'right', color: MUTED }}>{money(p.byGroupAmount[g.name])}</td>
                    </>
                  ) : (
                    <>
                      <td style={{ textAlign: 'right', paddingRight: 10, color: MUTED }}>{((p.byGroup[g.name] / p.value) * 100).toFixed(1)}%</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(p.byGroup[g.name])}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ color: INK, borderTop: split ? `1px solid ${LINE}` : undefined, paddingTop: split ? 2 : 0 }}>
          {split ? 'Total ' : ''}
          {share
            ? <><span className="font-semibold">{p.value.toFixed(1)}%</span> of portfolio <span style={{ color: MUTED }}>· {p.estimated ? '≈ ' : ''}{money(p.amount)} {amountCcy}</span></>
            : <><span className="font-semibold">{p.estimated ? '≈ ' : ''}{money(p.value)}</span> {amountCcy}</>}
        </div>
        {diff !== null && prev && (
          <div style={{ color: diff >= 0 ? GAIN : LOSS }}>
            {changeIn(share, diff, prev.value)} vs {monthLong(prev.date)}
          </div>
        )}
        {p.estimated && <div style={{ color: MUTED, fontSize: 11, marginTop: 4, maxWidth: 240 }}>≈ includes a holding with no market price yet, valued from its own buy and sale prices.</div>}
      </div>
    );
  }, [byDate, lastDate, amountCcy, split, shownGroups, share]);

  // Tick-boxes: one group in or out; "All" / "None" for the whole class
  const toggle = (name: string) => {
    if (!splitKey) return;
    setExcluded(prev => {
      const cur = prev[splitKey] ?? [];
      return { ...prev, [splitKey]: cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name] };
    });
  };
  const setAll = (on: boolean) => {
    if (!splitKey) return;
    setExcluded(prev => ({ ...prev, [splitKey]: on ? [] : groups.map(g => g.name) }));
  };

  // What the filters above are doing to this chart, in words
  const filterNote = [
    classFilter && `${classFilter} only`,
    currencyFilter && `${currencyFilter} only`,
    accountFilter && `${accountFilter} only`,
  ].filter(Boolean).join(' · ');

  // The tick-boxes, shown once a class or currency is picked and it has more than one exposure
  // Also shown while anything in it is unticked, even if another filter has left a single group:
  // otherwise an unticked last group would empty the chart with no way back
  const groupPicker = splitKey && (groups.length > 1 || left.size > 0) && (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-3 text-xs">
      <span className="text-gray-500 mr-1">Exposure:</span>
      {/* The app's shared control look: one grey strip (SEG) of segBtn buttons, slate while in
          the bars, each with a dot in its series colour (like Daily NAV Drawdowns' currency
          buttons). The strip wraps onto more lines when there are many exposures. */}
      <span className={`${SEG} flex-wrap max-w-full`}>
        {groups.map(g => {
          const on = !left.has(g.name);
          return (
            <button
              key={g.name}
              type="button"
              onClick={() => toggle(g.name)}
              aria-pressed={on}
              title={g.tickers.length > 0 ? `${g.label}: ${g.tickers.join(', ')}` : g.label}
              className={segBtn(on)}
            >
              <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle -mt-px" style={{ backgroundColor: g.color }} />
              {g.label}
            </button>
          );
        })}
      </span>
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
        <span className="text-xs text-gray-400">Pick a class or a Holdings currency to split it by exposure · amounts in {amountCcy}</span>
      </div>

      {/* Period and (once a class is picked) Value / % of portfolio, side by side on one line.
          Phones: the period is a box that opens a slide-up panel, with the two Show buttons
          beside it (two short choices fit a phone's width). */}
      <div className="flex items-center gap-x-5 gap-y-2 mb-3 max-md:gap-x-2 max-md:flex-wrap">
        <div className="hidden max-md:flex">
          <PhoneChoice label="Period" options={periodOptions(PERIODS)} selected={period} onPick={p => setPeriod(p as MonthPeriod)} />
        </div>
        <div className="flex items-center gap-1 max-md:hidden">
          <span className="text-xs text-gray-500 mr-1">Period:</span>
          <span className={SEG}>
            {PERIODS.map(p => <button key={p} onClick={() => setPeriod(p)} className={segBtn(period === p)}>{p}</button>)}
          </span>
        </div>
        {splitKey && (
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-xs text-gray-500 mr-1 max-md:hidden">Show:</span>
            <span className={SEG}>
              <button onClick={() => setMode('value')} className={segBtn(!share)}
                title={`How much money was in it each month-end, in ${amountCcy}`}>Value</button>
              <button onClick={() => setMode('share')} className={segBtn(share)}
                title="Its share of the portfolio each month-end: the bar grows when the share grows">% of portfolio</button>
            </span>
          </div>
        )}
        {/* "% of portfolio" of what: the whole portfolio, or only the part the Holdings / account
            filters leave (what Allocation by Month-end shows). Only while such a filter is on:
            without one, the two are the same. */}
        {share && baseMatters && (
          <span className={`${SEG} shrink-0`}>
            <button onClick={() => setShareBase('whole')} className={segBtn(shareBase === 'whole')}
              title="Divided by everything you own: every class, currency and account">of whole portfolio</button>
            <button onClick={() => setShareBase('filtered')} className={segBtn(shareBase === 'filtered')}
              title={`Divided by only what the filters keep (${[currencyFilter && `${currencyFilter} holdings`, accountFilter].filter(Boolean).join(', ')}), all classes — as Allocation by Month-end shows it`}>of filtered</button>
          </span>
        )}
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
          <span className="font-semibold text-gray-800">{share ? `${fmtIn(true, last.value)} of portfolio` : `${money(last.value)} ${amountCcy}`}</span>
        </span>
        <span className={RISK_ROW} title={hoverDate ? 'Since the month under the pointer' : 'Since the first month of the period'}>
          <span className="text-gray-500">Since {monthYear(thenP.date)}</span>
          <span className="font-semibold" style={{ color: change >= 0 ? GAIN : LOSS }}>
            {changeIn(share, change, thenP.value)}
          </span>
        </span>
        <span className={RISK_ROW} title="Over finished months only (the current month is still moving)">
          <span className="text-gray-500">High</span>
          <span className="font-semibold text-gray-800">{fmtIn(share, hi.value)}</span>
          <span className="text-gray-400">{monthYear(hi.date)}</span>
        </span>
        <span className={RISK_ROW} title="Over finished months only (the current month is still moving)">
          <span className="text-gray-500">Low</span>
          <span className="font-semibold text-gray-800">{fmtIn(share, lo.value)}</span>
          <span className="text-gray-400">{monthYear(lo.date)}</span>
        </span>
      </div>

      <ValueBars shown={shown} groups={shownGroups} totalColor={totalColor} share={share} renderTooltip={renderTooltip} onHover={setHoverDate} />
      <p className="text-xs text-gray-400 mt-2">
        {hoverDate ? 'Change measured from the month under the pointer.' : 'Hover (or touch) a bar to see its amount and the change from it to the latest month.'}
        {share && (ofWhole
          ? ' % of portfolio = its share of everything you own that month (every class, currency and account, plus cash).'
          : ` % of portfolio = its share of what the filters keep (${[currencyFilter && `${currencyFilter} holdings`, accountFilter].filter(Boolean).join(', ')}), every class plus cash — the same total as Allocation by Month-end.`)}
        {splitKey && groups.length > 1 && ' Exposure comes from the Lookup tab; an asset without one is shown under its ticker.'}
      </p>
    </div>
  );
}

// The bars on their own, memoised: hovering changes only the hovered month in the parent, so the
// ~100 bars aren't redrawn on every pointer move. One stacked series per group.
const ValueBars = React.memo(function ValueBars({ shown, groups, totalColor, share, renderTooltip, onHover }: {
  shown: ValuePoint[];
  groups: Group[];
  totalColor: string;
  share: boolean;   // the bars are % of portfolio rather than money
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
    value: last.value, color: totalColor, label: share ? `${last.value.toFixed(1)}%` : shortMoney(last.value),
    // Slate flips with dark mode and the bubble code already handles it; a class colour doesn't
    textColor: totalColor === SLATE ? undefined : readableTextOn(totalColor),
  }];
  // The month's total above each column, by the app-wide rule (ui.tsx barValueLabel): one label
  // per stacked column, on the top series; none over 100 months. Not in the % view, where every
  // column adds up to 100% and the label would say nothing. categoryGap matches barCategoryGap
  // below (touching bars: none), so the labels get exactly the room there is.
  const totalLabel = share ? undefined
    : barValueLabel(shown.length, shortLabelMoney, shown.map(p => p.value), i => shown[i]?.value ?? 0,
      { categoryGap: touching ? 0 : shown.length > 60 ? 0.1 : 0.2 });
  return (
    <ResponsiveContainer width="100%" height={phone ? 240 : 300}>
      <BarChart
        data={data}
        margin={{ top: Math.max(10, totalLabel ? barLabelRoom(shown.length) : 0), right: LABEL_W + 8, left: 0, bottom: 0 }}
        barCategoryGap={touching ? 0 : shown.length > 60 ? '10%' : '20%'}
        onMouseMove={(s: { activeLabel?: string | number }) => { if (s?.activeLabel) onHover(String(s.activeLabel)); }}
        onMouseLeave={() => onHover(null)}
      >
        <XAxis dataKey="date" ticks={ticks} interval={0} tickFormatter={label}
          tick={{ fontSize: 11, fill: MUTED }} tickLine={false} />
        <YAxis tickFormatter={share ? ((v: number) => `${v}%`) : (phoneAxisMoney() ?? ((v: number) => money(v)))}
          tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} width={phone || share ? 40 : 76} />
        <Tooltip cursor={{ fill: 'rgba(148,163,184,0.15)' }} content={renderTooltip} />
        {groups.map((g, i) => (
          <Bar key={g.name} dataKey={`g${i}`} name={g.label} stackId="value" fill={g.color} isAnimationActive={false}
            stroke={touching ? g.color : undefined} strokeWidth={touching ? 1 : 0}>
            {totalLabel && i === groups.length - 1 && <LabelList content={totalLabel} />}
          </Bar>
        ))}
        {/* The latest total beside the right edge, like the allocation charts' latest % */}
        <Customized component={<EdgeBubbles defs={edgeDefs} bubbleWidth={LABEL_W} fontSize={twoLineLabelFont()} />} />
      </BarChart>
    </ResponsiveContainer>
  );
});
