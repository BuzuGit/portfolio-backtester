/*
  INCOME — the Positions tab's chart of dividends and interest received.

  Every "Dividend" and "Interest" row of the Transactions ledger, added up per month, quarter or
  year (the user's choice, Year by default) and stacked by who paid it:
    - a holding's dividends (or a bond's interest) under its ticker, or its name when the asset
      is no longer in the Lookup tab (PZU, Singtel, UBS, the Savings Bonds...);
    - interest on cash under "Interest · <account>", one per account it was paid into.
  Tick-boxes take payers in or out, to focus on e.g. the REITs alone.

  It follows the tab's class and account filters (never currency: on Positions currency only
  sets how amounts are shown): a class keeps the payers in it (cash interest = "Cash"; an asset
  not in the Lookup tab has no class, so it shows only with no class picked); an account keeps
  income paid into that account, plus the dividends of assets bought from it.

  Amounts are converted with the price sheet's rate for the month of each payment (PLN is the
  hub: amount x xxxPLN, then / yyyPLN for the chosen currency), so a 2019 dividend counts at 2019
  rates. Choices live in the main screen, so they survive switching tabs.
*/
import React, { useCallback, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Customized } from 'recharts';
import type { AssetLookup, AssetRow, LedgerRow } from '@/lib/fetchData';
import { localTodayIso } from '@/lib/fetchData';
import { FX_TICKER_MAP } from '@/lib/backtest';
import { portfolioClassOf } from '@/lib/holdings';
import { isPhoneScreen } from '@/lib/savedSheet';
import { MONTH_ABBR, periodStartIso } from '@/lib/dates';
import { PhoneChoice, periodOptions } from '@/components/PhoneSheet';
import { CARD, GAIN, INK, LINE, LOSS, MUTED, ResponsiveContainer, SEG, SLATE, segBtn } from '@/components/ui';
import { EdgeBubbles, phoneAxisMoney, twoLineLabelFont, type BubbleDef } from '@/components/charts';
import { RISK_ROW } from '@/components/AllocationHistory';
import { GROUP_COLORS } from '@/components/ValueByMonth';
import type { MonthPeriod } from '@/components/AllocationByMonth';

export type IncomeBy = 'month' | 'quarter' | 'year';
const PERIODS: readonly MonthPeriod[] = ['1Y', '3Y', '5Y', '10Y', 'Max'];
const BY_OPTIONS: { value: IncomeBy; label: string }[] = [
  { value: 'month', label: 'Month' }, { value: 'quarter', label: 'Quarter' }, { value: 'year', label: 'Year' },
];
const LABEL_W = 50;   // the latest-bar label beside the right edge

// 1234567.8 -> "1,234,568"
const money = (v: number) => Math.round(v).toLocaleString('en-US');
const shortMoney = (v: number) =>
  Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(Math.abs(v) >= 1e4 ? 0 : 1)}k` : String(Math.round(v));
const signedMoney = (v: number) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`;

// "2026-11" -> the bucket it falls in: "2026-11" (month), "2026-Q4" (quarter) or "2026" (year)
const bucketOf = (ym: string, by: IncomeBy) =>
  by === 'month' ? ym : by === 'quarter' ? `${ym.slice(0, 4)}-Q${Math.floor((Number(ym.slice(5, 7)) - 1) / 3) + 1}` : ym.slice(0, 4);
// A bucket's last month, "2026-Q4" -> "2026-12" (to test it against the period's start)
const lastYmOf = (bucket: string) =>
  bucket.length === 4 ? `${bucket}-12` : bucket.includes('Q') ? `${bucket.slice(0, 4)}-${String(Number(bucket.slice(6)) * 3).padStart(2, '0')}` : bucket;
// How a bucket is written: "Nov 2026", "Q4 2026", "2026"
const longLabel = (bucket: string) =>
  bucket.length === 4 ? bucket : bucket.includes('Q') ? `${bucket.slice(5)} ${bucket.slice(0, 4)}` : `${MONTH_ABBR[Number(bucket.slice(5, 7)) - 1]} ${bucket.slice(0, 4)}`;
// The next month after "2026-11"
const nextYm = (ym: string) => {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

// One payer: its key (what the unticked list stores), its label, a longer name for hover text,
// and its class ('' = unknown: not in the Lookup tab)
interface Payer { key: string; label: string; title: string; cls: string; color: string; total: number }
// One payment, ready to add up: payer, month, account, amount in PLN and in the chosen currency
interface Payment { key: string; ym: string; account: string; ticker: string; amount: number }

export interface IncomeChartProps {
  rows: LedgerRow[];
  assetData: AssetRow[];
  assetLookup: AssetLookup[];
  groupMetalsCrypto: boolean;
  tickerAccounts: Record<string, Set<string>>;   // which accounts paid for each ticker (the By Account rule)
  classFilter: string | null;
  accountFilter: string | null;
  positionsCurrency: string;                       // '' = native: amounts then shown in PLN
  by: IncomeBy; setBy: (b: IncomeBy) => void;
  period: MonthPeriod; setPeriod: (p: MonthPeriod) => void;
  excluded: string[]; setExcluded: React.Dispatch<React.SetStateAction<string[]>>;
}

export default function IncomeChart({
  rows, assetData, assetLookup, groupMetalsCrypto, tickerAccounts, classFilter, accountFilter, positionsCurrency,
  by, setBy, period, setPeriod, excluded, setExcluded,
}: IncomeChartProps) {
  const [hoverBucket, setHoverBucket] = useState<string | null>(null);
  const amountCcy = positionsCurrency || 'PLN';

  // PLN per unit of each currency, for every month of the price sheet. A month with no rate
  // keeps the last one known, so a gap in the sheet never turns a payment into nonsense.
  const ratesByYm = useMemo(() => {
    const out = new Map<string, Record<string, number>>();
    const last: Record<string, number> = { PLN: 1 };
    const sorted = [...assetData].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const row of sorted) {
      for (const [ccy, fx] of Object.entries(FX_TICKER_MAP)) {
        if (!fx) continue;
        const v = Number(row[fx]);
        if (v > 0) last[ccy] = v;
      }
      out.set(String(row.date).slice(0, 7), { ...last });
    }
    return { byYm: out, latest: { ...last } };
  }, [assetData]);

  // Every payment with its payer, converted into the chosen currency at that month's rates.
  // Payers are built once, with a colour each from a fixed (alphabetical) order, so a payer keeps
  // its colour whatever the filters or ticks.
  const { payments, payerInfo } = useMemo(() => {
    const info = new Map(assetLookup.map(a => [a.ticker, a]));
    const rateAt = (ym: string) => ratesByYm.byYm.get(ym) ?? ratesByYm.latest;
    const payerInfo = new Map<string, Omit<Payer, 'color' | 'total'>>();
    const payments: Payment[] = [];
    for (const r of rows) {
      const ticker = r.ticker && r.ticker !== '-' ? r.ticker : '';
      const cashInterest = r.flow === 'Interest' && (!ticker || r.asset === 'Cash');
      const inLookup = info.get(ticker);
      const key = cashInterest ? `int|${r.account}` : `pay|${ticker || r.asset}`;
      if (!payerInfo.has(key)) {
        payerInfo.set(key, cashInterest
          ? { key, label: `Interest · ${r.account}`, title: `Interest on cash paid into ${r.account}`, cls: 'Cash' }
          : {
            key,
            label: inLookup ? ticker : r.asset,
            title: inLookup ? `${inLookup.name} (${ticker})` : `${r.asset}${ticker ? ` (${ticker})` : ''} — not in the Lookup tab`,
            cls: inLookup ? (groupMetalsCrypto ? portfolioClassOf(inLookup) : (inLookup.assetClass || 'Other')) : '',
          });
      }
      const ym = r.date.slice(0, 7);
      const rates = rateAt(ym);
      const toPln = r.currency === 'PLN' ? 1 : rates[r.currency];
      const toShown = amountCcy === 'PLN' ? 1 : rates[amountCcy];
      if (!toPln || !toShown) continue;   // a currency the price sheet has no rate for
      payments.push({ key, ym, account: r.account, ticker, amount: (r.amount * toPln) / toShown });
    }
    return { payments, payerInfo };
  }, [rows, assetLookup, groupMetalsCrypto, ratesByYm, amountCcy]);

  const colorOf = useMemo(() => {
    const keys = Array.from(payerInfo.keys()).sort();
    return new Map(keys.map((k, i) => [k, GROUP_COLORS[i % GROUP_COLORS.length]]));
  }, [payerInfo]);

  // The payments passing the tab's class and account filters
  const filtered = useMemo(() => payments.filter(p => {
    const payer = payerInfo.get(p.key)!;
    if (classFilter && payer.cls !== classFilter) return false;
    if (accountFilter && p.account !== accountFilter && !(p.ticker && tickerAccounts[p.ticker]?.has(accountFilter))) return false;
    return true;
  }), [payments, payerInfo, classFilter, accountFilter, tickerAccounts]);

  // Every bucket from the first payment to today (empty ones too, so a quiet year shows as a
  // gap), within the chosen period
  const buckets = useMemo(() => {
    if (filtered.length === 0) return [] as string[];
    const first = filtered.reduce((m, p) => (p.ym < m ? p.ym : m), filtered[0].ym);
    const todayYm = localTodayIso().slice(0, 7);
    const startYm = periodStartIso(period).slice(0, 7);
    const out: string[] = [];
    for (let ym = first; ym <= todayYm; ym = nextYm(ym)) {
      const b = bucketOf(ym, by);
      if (out[out.length - 1] !== b && lastYmOf(b) >= startYm) out.push(b);
    }
    return out;
  }, [filtered, by, period]);

  // Each payer's total per bucket, and its total over the buckets shown
  const { perBucket, payers } = useMemo(() => {
    const shownSet = new Set(buckets);
    const perBucket = new Map<string, Record<string, number>>(buckets.map(b => [b, {}]));
    const totals: Record<string, number> = {};
    for (const p of filtered) {
      const b = bucketOf(p.ym, by);
      if (!shownSet.has(b)) continue;
      const cell = perBucket.get(b)!;
      cell[p.key] = (cell[p.key] ?? 0) + p.amount;
      totals[p.key] = (totals[p.key] ?? 0) + p.amount;
    }
    // Biggest earner first, so it sits at the bottom of each bar
    const payers: Payer[] = Object.keys(totals)
      .filter(k => Math.abs(totals[k]) > 0.5)
      .sort((a, b) => totals[b] - totals[a])
      .map(k => ({ ...payerInfo.get(k)!, color: colorOf.get(k) ?? SLATE, total: totals[k] }));
    return { perBucket, payers };
  }, [filtered, buckets, by, payerInfo, colorOf]);

  const left = useMemo(() => new Set(excluded), [excluded]);
  const shownPayers = useMemo(() => payers.filter(p => !left.has(p.key)), [payers, left]);

  // The bars: per bucket, the ticked payers' amounts and their sum
  const bars = useMemo(() => buckets.map(b => {
    const cell = perBucket.get(b) ?? {};
    const byPayer: Record<string, number> = {};
    let total = 0;
    for (const p of shownPayers) {
      // A refund or correction can make a payer's bucket negative; a stacked bar can't show
      // that, so it counts as nothing there (the hover box and totals use the same figure)
      const v = Math.max(0, cell[p.key] ?? 0);
      byPayer[p.key] = v;
      total += v;
    }
    return { bucket: b, total, byPayer };
  }), [buckets, perBucket, shownPayers]);

  const byBucket = useMemo(() => new Map(bars.map((b, i) => [b.bucket, { b, prev: bars[i - 1] }])), [bars]);
  const currentBucket = bucketOf(localTodayIso().slice(0, 7), by);

  const renderTooltip = useCallback((t: { active?: boolean; label?: string | number }) => {
    const hit = t.active && t.label !== undefined ? byBucket.get(String(t.label)) : undefined;
    if (!hit) return null;
    const { b, prev } = hit;
    const diff = prev ? b.total - prev.total : null;
    return (
      <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
        <div className="font-semibold mb-1" style={{ color: INK }}>
          {longLabel(b.bucket)}{b.bucket === currentBucket ? ' · so far' : ''}
        </div>
        <table style={{ borderCollapse: 'collapse', marginBottom: 2 }}>
          <tbody>
            {/* Top of the bar first, like the stack */}
            {[...shownPayers].reverse().map(p => (b.byPayer[p.key] ?? 0) > 0.5 && (
              <tr key={p.key}>
                <td style={{ paddingRight: 10 }}>
                  <span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: p.color }} />{p.label}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(b.byPayer[p.key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ color: INK, borderTop: `1px solid ${LINE}`, paddingTop: 2 }}>
          Total <span className="font-semibold">{money(b.total)}</span> {amountCcy}
        </div>
        {diff !== null && prev && (
          <div style={{ color: diff >= 0 ? GAIN : LOSS }}>
            {signedMoney(diff)} vs {longLabel(prev.bucket)}
          </div>
        )}
      </div>
    );
  }, [byBucket, shownPayers, amountCcy, currentBucket]);

  if (payments.length === 0) return null;

  // Tick-boxes: one payer in or out; All / None
  const toggle = (key: string) => setExcluded(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  const setAll = (on: boolean) => setExcluded(prev => (on
    ? prev.filter(k => !payers.some(p => p.key === k))
    : Array.from(new Set([...prev, ...payers.map(p => p.key)]))));

  // Summary figures over the ticked payers: total in the period, the last 12 months, best bar
  const periodTotal = bars.reduce((s, b) => s + b.total, 0);
  const todayYm = localTodayIso().slice(0, 7);
  let ym12 = todayYm;
  for (let i = 0; i < 11; i++) {
    const y = Number(ym12.slice(0, 4)), m = Number(ym12.slice(5, 7));
    ym12 = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  }
  const shownKeys = new Set(shownPayers.map(p => p.key));
  const last12 = filtered.filter(p => p.ym >= ym12 && shownKeys.has(p.key)).reduce((s, p) => s + Math.max(0, p.amount), 0);
  const best = bars.reduce<typeof bars[number] | null>((m, b) => (!m || b.total > m.total ? b : m), null);

  const filterNote = [classFilter && `${classFilter} only`, accountFilter && `${accountFilter} only`].filter(Boolean).join(' · ');

  return (
    <div className="bg-white p-4 rounded-lg shadow mb-4">
      <div className="flex items-center justify-between mb-3 gap-3 max-md:flex-col max-md:items-start max-md:gap-0.5">
        <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2 flex-wrap">
          Income: Dividends &amp; Interest
          {filterNote && <span className="text-xs font-normal text-amber-600">— {filterNote}</span>}
        </h4>
        <span className="text-xs text-gray-400">From the ledger · amounts in {amountCcy}, at each payment month&apos;s rate</span>
      </div>

      {/* Bars per month / quarter / year and the period, on one line. Phones: the period is a
          box that opens a slide-up panel, the three short "by" buttons beside it. */}
      <div className="flex items-center gap-x-5 gap-y-2 mb-3 max-md:gap-x-2">
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-gray-500 mr-1 max-md:hidden">Show by:</span>
          <span className={SEG}>
            {BY_OPTIONS.map(o => <button key={o.value} onClick={() => setBy(o.value)} className={segBtn(by === o.value)}>{o.label}</button>)}
          </span>
        </div>
        <div className="hidden max-md:flex">
          <PhoneChoice label="Period" options={periodOptions(PERIODS)} selected={period} onPick={p => setPeriod(p as MonthPeriod)} />
        </div>
        <div className="flex items-center gap-1 max-md:hidden">
          <span className="text-xs text-gray-500 mr-1">Period:</span>
          <span className={SEG}>
            {PERIODS.map(p => <button key={p} onClick={() => setPeriod(p)} className={segBtn(period === p)}>{p}</button>)}
          </span>
        </div>
      </div>

      {/* Payers: the app's shared strip of segBtn buttons, slate while in the bars, each with a
          dot in its colour (like Daily NAV Drawdowns' currency buttons). Hover: the full name and
          its total over the period. */}
      {payers.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-3 text-xs">
          <span className="text-gray-500 mr-1">Paid by:</span>
          {/* (SEG never shrinks, so it is capped at the card's width here: then it wraps) */}
          <span className={`${SEG} flex-wrap max-w-full`}>
            {payers.map(p => {
              const on = !left.has(p.key);
              return (
                <button key={p.key} type="button" onClick={() => toggle(p.key)} aria-pressed={on}
                  title={`${p.title} · ${money(p.total)} ${amountCcy} in the period`} className={segBtn(on)}>
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle -mt-px" style={{ backgroundColor: p.color }} />
                  {p.label}
                </button>
              );
            })}
          </span>
          <span className="inline-flex gap-2 ml-1">
            <button type="button" onClick={() => setAll(true)} className="text-blue-600 hover:underline">All</button>
            <button type="button" onClick={() => setAll(false)} className="text-blue-600 hover:underline">None</button>
          </span>
        </div>
      )}

      {bars.length === 0 || shownPayers.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">
          {payers.length === 0 ? 'No dividends or interest match the filters above.' : 'Nothing to show: tick at least one payer above.'}
        </p>
      ) : (
        <>
          {/* Summary over the ticked payers */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs mb-3">
            <span className={RISK_ROW}>
              <span className="text-gray-500">Total in period:</span>
              <span className="font-semibold text-gray-800">{money(periodTotal)} {amountCcy}</span>
            </span>
            <span className={RISK_ROW} title="The 12 calendar months up to and including this one">
              <span className="text-gray-500">Last 12 months:</span>
              <span className="font-semibold text-gray-800">{money(last12)}</span>
            </span>
            {best && best.total > 0 && (
              <span className={RISK_ROW}>
                <span className="text-gray-500">Best {by}:</span>
                <span className="font-semibold text-gray-800">{money(best.total)}</span>
                <span className="text-gray-400">{longLabel(best.bucket)}</span>
              </span>
            )}
          </div>

          <IncomeBars bars={bars} payers={shownPayers} by={by} renderTooltip={renderTooltip} onHover={setHoverBucket} />
          <p className="text-xs text-gray-400 mt-2">
            {hoverBucket ? `${longLabel(hoverBucket)}: hover box shows each payer.` : 'Hover (or touch) a bar to see who paid what.'}
            {' '}The latest bar is {by === 'year' ? 'the year' : by === 'quarter' ? 'the quarter' : 'the month'} so far.
            {' '}Assets no longer in the Lookup tab show by name and only with no class picked.
          </p>
        </>
      )}
    </div>
  );
}

// The bars on their own, memoised: hovering only changes the hovered bucket in the parent
const IncomeBars = React.memo(function IncomeBars({ bars, payers, by, renderTooltip, onHover }: {
  bars: { bucket: string; total: number; byPayer: Record<string, number> }[];
  payers: Payer[];
  by: IncomeBy;
  renderTooltip: (t: { active?: boolean; label?: string | number }) => React.ReactNode;
  onHover: (bucket: string | null) => void;
}) {
  const phone = isPhoneScreen();
  const touching = phone && bars.length > 40;
  const data = useMemo(() => bars.map(b => {
    const row: Record<string, number | string> = { bucket: b.bucket };
    payers.forEach((p, i) => { row[`p${i}`] = b.byPayer[p.key] ?? 0; });
    return row;
  }), [bars, payers]);
  // Axis labels: every year; quarters and months labelled once a year (at Q1 / January), with
  // their own labels when the period is short enough to read them
  const ticks = useMemo(() => {
    if (by === 'year') return bars.map(b => b.bucket);
    const dense = bars.length > (phone ? 6 : 14);
    return bars.map(b => b.bucket).filter(k => !dense || (by === 'quarter' ? k.endsWith('Q1') : k.endsWith('-01')));
  }, [bars, by, phone]);
  const tickLabel = (k: string) => {
    if (by === 'year') return k;
    const dense = bars.length > (phone ? 6 : 14);
    if (dense) return k.slice(0, 4);
    return by === 'quarter' ? `${k.slice(5)} ${k.slice(2, 4)}` : `${MONTH_ABBR[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
  };
  const last = bars[bars.length - 1];
  const edgeDefs: BubbleDef[] = [{ value: last.total, color: SLATE, label: shortMoney(last.total) }];
  return (
    <ResponsiveContainer width="100%" height={phone ? 240 : 300}>
      <BarChart
        data={data}
        margin={{ top: 10, right: LABEL_W + 8, left: 0, bottom: 0 }}
        barCategoryGap={touching ? 0 : bars.length > 60 ? '10%' : '20%'}
        onMouseMove={(s: { activeLabel?: string | number }) => { if (s?.activeLabel) onHover(String(s.activeLabel)); }}
        onMouseLeave={() => onHover(null)}
      >
        <XAxis dataKey="bucket" ticks={ticks} interval={0} tickFormatter={tickLabel}
          tick={{ fontSize: 11, fill: MUTED }} tickLine={false} />
        <YAxis tickFormatter={phoneAxisMoney() ?? ((v: number) => money(v))}
          tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} width={phone ? 40 : 64} />
        <Tooltip cursor={{ fill: 'rgba(148,163,184,0.15)' }} content={renderTooltip} />
        {payers.map((p, i) => (
          <Bar key={p.key} dataKey={`p${i}`} name={p.label} stackId="income" fill={p.color} isAnimationActive={false}
            stroke={touching ? p.color : undefined} strokeWidth={touching ? 1 : 0} />
        ))}
        {/* The latest bar's total (the current month / quarter / year so far) */}
        <Customized component={<EdgeBubbles defs={edgeDefs} bubbleWidth={LABEL_W} fontSize={twoLineLabelFont()} />} />
      </BarChart>
    </ResponsiveContainer>
  );
});
