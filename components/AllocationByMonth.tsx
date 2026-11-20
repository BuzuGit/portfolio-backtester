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
  switching tabs; only the hovered month is kept here.
*/
import React, { useMemo, useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip } from 'recharts';
import type { AssetLookup, AssetRow } from '@/lib/fetchData';
import type { PositionsModel } from '@/lib/positions';
import type { CashAccountBalance } from '@/lib/cash';
import { ledgerMonthEnds, type LedgerMonth } from '@/lib/ledgerAllocation';
import { RISK_ON_CLASSES } from '@/lib/allocation';
import { portfolioClassOf } from '@/lib/holdings';
import { isPhoneScreen } from '@/lib/savedSheet';
import { MONTH_ABBR } from '@/lib/dates';
import { PhoneChoice, periodOptions } from '@/components/PhoneSheet';
import {
  ASSET_CLASS_COLORS, CURRENCY_COLORS, METALS_CRYPTO_CCY, METALS_CRYPTO_LABEL, MUTED, ResponsiveContainer, SEG, segBtn,
} from '@/components/ui';
import { AllocTooltipBox, RISK_LABEL, RISK_LINE, ThenVsNow, type AllocView } from '@/components/AllocationHistory';

type Period = '1Y' | '3Y' | '5Y' | 'Max';
const PERIODS: readonly Period[] = ['1Y', '3Y', '5Y', 'Max'];
const CASH = 'Cash';
// Stacking order, bottom up. Equities and Metals & Crypto first, so with Group M&C on the
// risk-on line runs along the top of the M&C band. Anything unlisted goes before Fixed Income.
const CLASS_ORDER = ['Equities', METALS_CRYPTO_LABEL, 'Crypto', 'Other', 'Alternatives', 'Fixed Income', CASH];
const CCY_ORDER = ['PLN', 'USD', 'SGD', 'EUR', 'CHF', METALS_CRYPTO_CCY];
const FALLBACK_COLOR = '#94a3b8';

// "2026-11-30" -> "Nov 2026"
const monthLong = (d: string) => `${MONTH_ABBR[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const monthShort = (d: string) => `${MONTH_ABBR[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`;
const pct = (v: number) => `${v.toFixed(1)}%`;

// One month as the chart needs it: PLN per band, which bands contain an estimated value, the
// risk-on amount, and the rates for converting amounts
interface MonthMix { date: string; byBand: Record<string, number>; estimated: Set<string>; riskOn: number; total: number; pln: LedgerMonth['pln'] }

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

  // Same class / currency rules as the cards above (see effectiveClass / effectiveCurrency there)
  const info = useMemo(() => new Map(assetLookup.map(a => [a.ticker, a])), [assetLookup]);
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

  // Each month split into bands, after the filters
  const mixes: MonthMix[] = months.map(m => {
    const byBand: Record<string, number> = {};
    const estimated = new Set<string>();
    let riskOn = 0;
    for (const h of m.holdings) {
      if (h.valuePln === null) continue;
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
    // A band below zero (an account overdrawn by a rounding difference) can't be drawn in a 100%
    // bar, so it counts as empty
    for (const k of Object.keys(byBand)) if (byBand[k] < 0) byBand[k] = 0;
    const total = Object.values(byBand).reduce((s, v) => s + v, 0);
    return { date: m.date, byBand, estimated, riskOn, total, pln: m.pln };
  }).filter(m => m.total > 0);

  // The months inside the chosen period
  const now = new Date();
  const years = period === 'Max' ? 0 : Number(period[0]);
  const cutoff = years ? new Date(new Date().setFullYear(now.getFullYear() - years)).toISOString().slice(0, 10) : '';
  const shown = mixes.filter(m => m.date >= cutoff);
  if (shown.length === 0) return null;

  // The bands present in the period, in stacking order
  const order = view === 'class' ? CLASS_ORDER : CCY_ORDER;
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i >= 0 ? i : (view === 'class' ? CLASS_ORDER.indexOf('Fixed Income') - 0.5 : order.length);
  };
  const bandNames = Array.from(new Set(shown.flatMap(m => Object.keys(m.byBand).filter(k => m.byBand[k] > 0))))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const bands = bandNames.map(name => ({
    name,
    color: (view === 'class' ? ASSET_CLASS_COLORS[name] : CURRENCY_COLORS[name]) ?? FALLBACK_COLOR,
  }));
  const sharesOf = (m: MonthMix) => bandNames.map(n => ((m.byBand[n] ?? 0) / m.total) * 100);
  const riskPct = (m: MonthMix) => (m.riskOn / m.total) * 100;

  const amountCcy = positionsCurrency || 'PLN';
  const fromPln = (m: MonthMix, v: number) => (amountCcy === 'PLN' ? v : m.pln[amountCcy] ? v / m.pln[amountCcy] : null);

  const chartData = shown.map(m => {
    const row: Record<string, unknown> = { date: m.date, riskOn: riskPct(m) };
    sharesOf(m).forEach((v, i) => { row[`b${i}`] = v; });
    return row;
  });
  const byDate = new Map(shown.map(m => [m.date, m]));
  const last = shown[shown.length - 1];
  const thenMix = (hoverDate && byDate.get(hoverDate)) || shown[0];
  let hi = shown[0], lo = shown[0];
  for (const m of shown) {
    if (riskPct(m) > riskPct(hi)) hi = m;
    if (riskPct(m) < riskPct(lo)) lo = m;
  }
  const showRisk = view === 'class';
  const titleOf = (m: MonthMix) => (m === last ? `${monthLong(m.date)} · latest` : `End of ${monthLong(m.date)}`);

  // X axis: January of each year, or every third month when the period is under 3 years
  const yearly = shown.length > 36;
  const ticks = shown.map(m => m.date).filter(d => (yearly ? d.slice(5, 7) === '01' : (Number(d.slice(5, 7)) - 1) % 3 === 0));
  const phone = isPhoneScreen();

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
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs mb-3">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5" style={{ background: RISK_LINE }} />
            <span className="text-gray-500">{RISK_LABEL}:</span>
            <span className="font-semibold text-gray-800">{pct(riskPct(last))}</span>
            <span className="text-gray-400">latest</span>
          </span>
          <span><span className="text-gray-500">High </span><span className="font-semibold text-gray-800">{pct(riskPct(hi))}</span>
            <span className="text-gray-400"> {monthShort(hi.date)}</span></span>
          <span><span className="text-gray-500">Low </span><span className="font-semibold text-gray-800">{pct(riskPct(lo))}</span>
            <span className="text-gray-400"> {monthShort(lo.date)}</span></span>
        </div>
      )}

      <ResponsiveContainer width="100%" height={phone ? 280 : 340}>
        <ComposedChart
          data={chartData}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
          // Gaps between bars help on a wide screen; on a phone 100 bars are ~2px each and the gaps
          // turn them into pinstripes, so there the bars touch
          barCategoryGap={phone && shown.length > 40 ? 0 : shown.length > 60 ? '10%' : '20%'}
          onMouseMove={(s: { activeLabel?: string | number }) => { if (s?.activeLabel) setHoverDate(String(s.activeLabel)); }}
          onMouseLeave={() => setHoverDate(null)}
        >
          <XAxis dataKey="date" ticks={ticks} interval={0}
            tickFormatter={(d: string) => (yearly ? d.slice(0, 4) : monthShort(d))}
            tick={{ fontSize: 11, fill: MUTED }} tickLine={false} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`}
            tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} width={40} allowDataOverflow />
          <Tooltip cursor={{ fill: 'rgba(148,163,184,0.15)' }} content={(p: { active?: boolean; label?: string | number }) => {
            const m = p.active && p.label !== undefined ? byDate.get(String(p.label)) : undefined;
            if (!m) return null;
            const anyEstimate = bandNames.some(n => m.estimated.has(n));
            return (
              <AllocTooltipBox
                title={titleOf(m)}
                rows={bandNames.map((n, i) => ({
                  name: n, color: bands[i].color, pct: ((m.byBand[n] ?? 0) / m.total) * 100,
                  amount: fromPln(m, m.byBand[n] ?? 0), estimated: m.estimated.has(n),
                }))}
                total={fromPln(m, m.total)}
                currency={amountCcy}
                riskOn={showRisk ? riskPct(m) : undefined}
                note={anyEstimate ? '≈ no market price that month: valued from its own buy and sale prices.' : undefined}
              />
            );
          }} />
          {bands.map((b, i) => (
            <Bar key={b.name} dataKey={`b${i}`} name={b.name} stackId="mix" fill={b.color} isAnimationActive={false} />
          ))}
          {showRisk && (
            <Line type="linear" dataKey="riskOn" name="Risk-on" stroke={RISK_LINE} strokeWidth={1.5}
              dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>

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

      <ThenVsNow
        thenLabel={monthLong(thenMix.date)} nowLabel={`${monthLong(last.date)} (latest)`} bands={bands}
        thenPct={sharesOf(thenMix)} nowPct={sharesOf(last)}
        hint={hoverDate ? 'Showing the month under the pointer.' : 'Then = start of the period. Hover (or touch) a bar to compare another month.'}
      />
    </div>
  );
}
