/*
  ALLOCATION BY MONTH-END — the Positions tab's chart of how the mix changed.

  The Portfolio tab's Asset Allocation chart covers the whole net worth day by day (Daily sheet,
  property included). This one covers what the Positions tab covers: the holdings in the Lookup tab
  plus cash, rebuilt from the Transactions ledger at every month-end (lib/ledgerAllocation.ts).
  So the two never match exactly, and aren't meant to.

  It follows the tab's own choices, like the By Asset Class / Currency / Account cards above it:
    - the account filter always applies;
    - by class, a currency filter applies (a class filter would leave one band at 100%);
    - by currency, a class filter applies (and vice versa);
    - "Group M&C" decides the classes and puts gold and crypto in their own M&C currency band;
    - amounts are in the tab's chosen currency (PLN when it shows each position natively).

  The choices themselves (view, period) live in the main screen and are passed in, so they survive
  switching tabs; only the hovered month is kept here. Moving the pointer changes only that, so
  every figure below is memoised and the bars sit in their own memoised component: a hover redraws
  the "Then vs Now" strip, not ~100 months x 6 bars.
*/
import React, { useCallback, useMemo, useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Customized } from 'recharts';
import type { AssetLookup, AssetRow } from '@/lib/fetchData';
import { localTodayIso } from '@/lib/fetchData';
import type { PositionsModel } from '@/lib/positions';
import type { CashAccountBalance } from '@/lib/cash';
import { ledgerMonthEnds, type LedgerMonth } from '@/lib/ledgerAllocation';
import { RISK_ON_CLASSES } from '@/lib/allocation';
import { portfolioClassOf } from '@/lib/holdings';
import { isPhoneScreen } from '@/lib/savedSheet';
import { MONTH_ABBR, periodStartIso } from '@/lib/dates';
import { PhoneChoice, periodOptions } from '@/components/PhoneSheet';
import {
  ASSET_CLASS_COLORS, CURRENCY_COLORS, METALS_CRYPTO_CCY, METALS_CRYPTO_LABEL, MUTED, ResponsiveContainer, SEG, segBtn,
} from '@/components/ui';
import {
  ALLOC_LABEL_W, AllocTooltipBox, RISK_LABEL, RISK_LINE, RISK_ROW, ThenVsNow, dateAxisTicks, latestShareBubbles, monthYear,
  type AllocView,
} from '@/components/AllocationHistory';
import { EdgeBubbles, twoLineLabelFont } from '@/components/charts';

export type MonthPeriod = '1Y' | '3Y' | '5Y' | '10Y' | 'Max';
type Period = MonthPeriod;
const PERIODS: readonly Period[] = ['1Y', '3Y', '5Y', '10Y', 'Max'];
const CASH = 'Cash';
// Stacking order, bottom up. Equities and Metals & Crypto first, so with Group M&C on the
// risk-on line runs along the top of the M&C band. Anything unlisted goes before Fixed Income.
// Same order as the Portfolio tab's Asset Allocation (lib/allocation ALLOC_CLASSES), with Real
// estate on top.
const CLASS_ORDER = ['Equities', METALS_CRYPTO_LABEL, 'Crypto', 'Other', 'Alternatives', 'Multi-asset', 'Fixed Income', CASH, 'Real estate'];
const CCY_ORDER = ['PLN', 'USD', 'SGD', 'EUR', 'CHF', METALS_CRYPTO_CCY];
const FALLBACK_COLOR = '#94a3b8';

// "2026-11-30" -> "Nov 2026"
const monthLong = (d: string) => `${MONTH_ABBR[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const pct = (v: number) => `${v.toFixed(1)}%`;

// One month as the chart needs it: PLN per band, which bands contain an estimated value, the
// risk-on amount, and the rates for converting amounts
interface MonthMix { date: string; byBand: Record<string, number>; estimated: Set<string>; riskOn: number; total: number; pln: LedgerMonth['pln'] }
interface Band { name: string; color: string }

export interface AllocationByMonthProps {
  assetData: AssetRow[];
  assetLookup: AssetLookup[];
  positionsModel: PositionsModel | null;
  allCashAccounts: CashAccountBalance[];
  groupMetalsCrypto: boolean;
  tickerAccounts: Record<string, Set<string>>;   // which accounts paid for each ticker (the By Account rule)
  accountFilter: string | null;
  currencyFilter: string | null;
  classFilter: string | null;
  positionsCurrency: string;                       // '' = native: amounts then shown in PLN
  view: AllocView; setView: (v: AllocView) => void;
  period: Period; setPeriod: (p: Period) => void;
}

export default function AllocationByMonth({
  assetData, assetLookup, positionsModel, allCashAccounts, groupMetalsCrypto, tickerAccounts,
  accountFilter, currencyFilter, classFilter, positionsCurrency, view, setView, period, setPeriod,
}: AllocationByMonthProps) {
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  // The heavy part — what was held at every month-end — redone only when the data reloads
  const months = useMemo(
    () => (positionsModel ? ledgerMonthEnds(positionsModel, allCashAccounts, assetLookup, assetData) : []),
    [positionsModel, allCashAccounts, assetLookup, assetData],
  );
  const info = useMemo(() => new Map(assetLookup.map(a => [a.ticker, a])), [assetLookup]);

  // Each month split into bands, after the filters. Same class / currency rules as the cards above
  // (effectiveClass / effectiveCurrency there).
  const mixes = useMemo((): MonthMix[] => {
    const classOf = (t: string) => {
      const a = info.get(t);
      if (!a) return 'Other';
      return groupMetalsCrypto ? portfolioClassOf(a) : (a.assetClass || 'Other');
    };
    const ccyOf = (t: string, fallback: string) => {
      const a = info.get(t);
      return a && groupMetalsCrypto && portfolioClassOf(a) === METALS_CRYPTO_LABEL ? METALS_CRYPTO_CCY : (a?.currency || fallback);
    };
    // Risk-on is always Equities + Metals & Crypto by the PortfolioClass column, whatever the
    // toggle shows, so the figure doesn't change when you flip Group M&C
    const isRiskOn = (t: string) => {
      const a = info.get(t);
      return !!a && (RISK_ON_CLASSES as readonly string[]).includes(portfolioClassOf(a));
    };
    return months.map(m => {
      const byBand: Record<string, number> = {};
      const estimated = new Set<string>();
      let riskOn = 0;
      for (const h of m.holdings) {
        if (h.valuePln === null) continue;   // no exchange rate at all: listed under the chart instead
        if (accountFilter && !tickerAccounts[h.ticker]?.has(accountFilter)) continue;
        const cls = classOf(h.ticker), ccy = ccyOf(h.ticker, h.currency);
        if (view === 'class' && currencyFilter && ccy !== currencyFilter) continue;
        if (view === 'currency' && classFilter && cls !== classFilter) continue;
        const band = view === 'class' ? cls : ccy;
        byBand[band] = (byBand[band] ?? 0) + h.valuePln;
        if (h.estimated) estimated.add(band);
        if (isRiskOn(h.ticker)) riskOn += h.valuePln;
      }
      for (const c of m.cash) {
        if (c.valuePln === null) continue;
        if (accountFilter && c.account !== accountFilter) continue;
        if (view === 'class' && currencyFilter && c.currency !== currencyFilter) continue;
        if (view === 'currency' && classFilter && classFilter !== CASH) continue;
        const band = view === 'class' ? CASH : c.currency;
        byBand[band] = (byBand[band] ?? 0) + c.valuePln;
      }
      // A band below zero (an account overdrawn by a rounding difference) can't be drawn in a
      // 100% bar, so it counts as empty
      for (const k of Object.keys(byBand)) if (byBand[k] < 0) byBand[k] = 0;
      const total = Object.values(byBand).reduce((s, v) => s + v, 0);
      return { date: m.date, byBand, estimated, riskOn, total, pln: m.pln };
    }).filter(m => m.total > 0);
  }, [months, info, groupMetalsCrypto, tickerAccounts, accountFilter, currencyFilter, classFilter, view]);

  // Currencies that never had an exchange rate in the price sheet: their holdings and cash can't
  // be converted, so they are left out of the bars — said in words under the chart, never silently
  const unconverted = useMemo(() => {
    const s = new Set<string>();
    for (const m of months) {
      for (const h of m.holdings) if (h.valuePln === null) s.add(h.currency);
      for (const c of m.cash) if (c.valuePln === null) s.add(c.currency);
    }
    return Array.from(s).sort();
  }, [months]);

  // The months inside the chosen period (periodStartIso: the rule both allocation charts share)
  const shown = useMemo(() => {
    const start = periodStartIso(period);
    return mixes.filter(m => m.date >= start);
  }, [mixes, period]);

  // The bands present in the period, in stacking order
  const bands = useMemo((): Band[] => {
    const order = view === 'class' ? CLASS_ORDER : CCY_ORDER;
    const rank = (k: string) => {
      const i = order.indexOf(k);
      return i >= 0 ? i : (view === 'class' ? CLASS_ORDER.indexOf('Fixed Income') - 0.5 : order.length);
    };
    return Array.from(new Set(shown.flatMap(m => Object.keys(m.byBand).filter(k => m.byBand[k] > 0))))
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map(name => ({ name, color: (view === 'class' ? ASSET_CLASS_COLORS[name] : CURRENCY_COLORS[name]) ?? FALLBACK_COLOR }));
  }, [shown, view]);

  const chartData = useMemo(() => shown.map(m => {
    const row: Record<string, unknown> = { date: m.date, riskOn: (m.riskOn / m.total) * 100 };
    bands.forEach((b, i) => { row[`b${i}`] = ((m.byBand[b.name] ?? 0) / m.total) * 100; });
    return row;
  }), [shown, bands]);
  const byDate = useMemo(() => new Map(shown.map(m => [m.date, m])), [shown]);

  const amountCcy = positionsCurrency || 'PLN';
  const showRisk = view === 'class';
  const lastDate = shown.length > 0 ? shown[shown.length - 1].date : '';

  // The hover box. useCallback so the memoised bars below keep the same function across hovers.
  const renderTooltip = useCallback((p: { active?: boolean; label?: string | number }) => {
    const m = p.active && p.label !== undefined ? byDate.get(String(p.label)) : undefined;
    if (!m) return null;
    const fromPln = (v: number) => (amountCcy === 'PLN' ? v : m.pln[amountCcy] ? v / m.pln[amountCcy] : null);
    return (
      <AllocTooltipBox
        title={m.date === lastDate ? `${monthLong(m.date)} · latest` : `End of ${monthLong(m.date)}`}
        rows={bands.map(b => ({
          name: b.name, color: b.color, pct: ((m.byBand[b.name] ?? 0) / m.total) * 100,
          amount: fromPln(m.byBand[b.name] ?? 0), estimated: m.estimated.has(b.name),
        }))}
        total={fromPln(m.total)}
        currency={amountCcy}
        riskOn={showRisk ? (m.riskOn / m.total) * 100 : undefined}
        note={bands.some(b => m.estimated.has(b.name)) ? '≈ no market price yet: valued from its own buy and sale prices.' : undefined}
      />
    );
  }, [byDate, bands, amountCcy, showRisk, lastDate]);

  if (shown.length === 0) return null;

  const last = shown[shown.length - 1];
  const thenMix = (hoverDate && byDate.get(hoverDate)) || shown[0];
  const sharesOf = (m: MonthMix) => bands.map(b => ((m.byBand[b.name] ?? 0) / m.total) * 100);
  const riskPct = (m: MonthMix) => (m.riskOn / m.total) * 100;

  // The risk-on high and low over COMPLETED months only: the last bar is the month in progress,
  // valued at today's prices (it has its own "latest" figure). Same rule as the Portfolio chart.
  const today = localTodayIso();
  const completed = shown.filter(m => m.date <= today);
  const ranked = completed.length > 0 ? completed : shown;
  let hi = ranked[0], lo = ranked[0];
  for (const m of ranked) {
    if (riskPct(m) > riskPct(hi)) hi = m;
    if (riskPct(m) < riskPct(lo)) lo = m;
  }

  // What the filters above are doing to this chart, in words
  const filterNote = [
    accountFilter && `${accountFilter} only`,
    view === 'class' && currencyFilter && `${currencyFilter} only`,
    view === 'currency' && classFilter && `${classFilter} only`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="bg-white p-4 rounded-lg shadow mb-4">
      <div className="flex items-center justify-between mb-3 gap-3 max-md:flex-col max-md:items-start max-md:gap-0.5">
        <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          Allocation by Month-end
          {filterNote && <span className="text-xs font-normal text-amber-600">— {filterNote}</span>}
        </h4>
        <span className="text-xs text-gray-400">Holdings + cash from the ledger · amounts in {amountCcy}</span>
      </div>

      {/* Controls. Phones: two boxes that open slide-up panels */}
      <div className="hidden max-md:flex gap-2 mb-3">
        <PhoneChoice label="View" options={[{ value: 'class', label: 'By class' }, { value: 'currency', label: 'By currency' }]}
          selected={view} onPick={v => setView(v as AllocView)} />
        <PhoneChoice label="Period" options={periodOptions(PERIODS)} selected={period} onPick={p => setPeriod(p as Period)} />
      </div>
      <div className="flex items-center gap-5 mb-3 flex-wrap max-md:hidden">
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">View:</span>
          <span className={SEG}>
            <button onClick={() => setView('class')} className={segBtn(view === 'class')}>By class</button>
            <button onClick={() => setView('currency')} className={segBtn(view === 'currency')}>By currency</button>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Period:</span>
          <span className={SEG}>
            {PERIODS.map(p => <button key={p} onClick={() => setPeriod(p)} className={segBtn(period === p)}>{p}</button>)}
          </span>
        </div>
      </div>

      {showRisk && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs mb-3">
          <span className={RISK_ROW}>
            <span className="inline-block w-4 h-0.5" style={{ background: RISK_LINE }} />
            <span className="text-gray-500">{RISK_LABEL}:</span>
            <span className="font-semibold text-gray-800">{pct(riskPct(last))}</span>
            <span className="text-gray-400">latest</span>
          </span>
          <span className={RISK_ROW} title="Over finished months only (the current month is still moving)">
            <span className="text-gray-500">High</span>
            <span className="font-semibold text-gray-800">{pct(riskPct(hi))}</span>
            <span className="text-gray-400">{monthYear(hi.date)}</span>
          </span>
          <span className={RISK_ROW} title="Over finished months only (the current month is still moving)">
            <span className="text-gray-500">Low</span>
            <span className="font-semibold text-gray-800">{pct(riskPct(lo))}</span>
            <span className="text-gray-400">{monthYear(lo.date)}</span>
          </span>
        </div>
      )}

      <MonthBars chartData={chartData} bands={bands} showRisk={showRisk} renderTooltip={renderTooltip} onHover={setHoverDate} />

      {/* Legend, top band first like the bars */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-600">
        {[...bands].reverse().map(b => (
          <span key={b.name} className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: b.color }} />{b.name}
          </span>
        ))}
        {showRisk && (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="inline-block w-4 h-0.5" style={{ background: RISK_LINE }} />{RISK_LABEL}
          </span>
        )}
      </div>
      {unconverted.length > 0 && (
        <p className="text-xs text-amber-600 mt-1.5">
          Not in the bars: anything held in {unconverted.join(', ')} (the price sheet has no exchange rate for it).
        </p>
      )}

      <ThenVsNow
        thenLabel={monthLong(thenMix.date)} nowLabel={`${monthLong(last.date)} (latest)`} bands={bands}
        thenPct={sharesOf(thenMix)} nowPct={sharesOf(last)}
        hint={hoverDate ? 'Showing the month under the pointer.' : 'Then = start of the period. Hover (or touch) a bar to compare another month.'}
      />
    </div>
  );
}

// The stacked bars on their own, memoised: hovering changes only the hovered month in the parent,
// and none of these props, so the bars aren't redrawn on every pointer move.
const MonthBars = React.memo(function MonthBars({ chartData, bands, showRisk, renderTooltip, onHover }: {
  chartData: Record<string, unknown>[];
  bands: Band[];
  showRisk: boolean;
  renderTooltip: (p: { active?: boolean; label?: string | number }) => React.ReactNode;
  onHover: (date: string | null) => void;
}) {
  const { ticks, label } = dateAxisTicks(chartData.map(r => String(r.date)));
  const phone = isPhoneScreen();
  // The latest month's share of each band, labelled beside the right edge (as on the Portfolio chart)
  const edgeDefs = latestShareBubbles(chartData, bands);
  // Gaps between bars help on a wide screen; on a phone ~100 bars are under 3px each, so the bars
  // touch. Even then Recharts rounds each bar's width DOWN to whole pixels (a 1.77px slot gets a
  // 1px bar), and the leftover sliver shows the card through as pinstripes. A 1px outline in the
  // bar's own colour adds half a pixel on each side, which closes a gap of up to 1px.
  const touching = phone && chartData.length > 40;
  return (
    <ResponsiveContainer width="100%" height={phone ? 280 : 340}>
      <ComposedChart
        data={chartData}
        // Room on the right for the latest-% labels (ALLOC_LABEL_W wide, plus a small gap)
        margin={{ top: 4, right: ALLOC_LABEL_W + 8, left: 0, bottom: 0 }}
        barCategoryGap={touching ? 0 : chartData.length > 60 ? '10%' : '20%'}
        onMouseMove={(s: { activeLabel?: string | number }) => { if (s?.activeLabel) onHover(String(s.activeLabel)); }}
        onMouseLeave={() => onHover(null)}
      >
        <XAxis dataKey="date" ticks={ticks} interval={0} tickFormatter={label}
          tick={{ fontSize: 11, fill: MUTED }} tickLine={false} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`}
          tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} width={40} allowDataOverflow />
        <Tooltip cursor={{ fill: 'rgba(148,163,184,0.15)' }} content={renderTooltip} />
        {bands.map((b, i) => (
          <Bar key={b.name} dataKey={`b${i}`} name={b.name} stackId="mix" fill={b.color} isAnimationActive={false}
            stroke={touching ? b.color : undefined} strokeWidth={touching ? 1 : 0} />
        ))}
        {showRisk && (
          <Line type="linear" dataKey="riskOn" name="Risk-on" stroke={RISK_LINE} strokeWidth={1.5}
            dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
        )}
        {/* The latest % of each band, in its colour, beside the chart's right edge */}
        <Customized component={<EdgeBubbles defs={edgeDefs} bubbleWidth={ALLOC_LABEL_W} fontSize={twoLineLabelFont()} />} />
      </ComposedChart>
    </ResponsiveContainer>
  );
});
