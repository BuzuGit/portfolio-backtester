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
import { paymentYields } from '@/lib/incomeYield';
import { isPhoneScreen } from '@/lib/savedSheet';
import { MONTH_ABBR, periodStartIso } from '@/lib/dates';
import { PhoneChoice, periodOptions } from '@/components/PhoneSheet';
import { CARD, GAIN, INK, LINE, LOSS, MUTED, ResponsiveContainer, SEG, SLATE, segBtn } from '@/components/ui';
import { EdgeBubbles, phoneAxisMoney, twoLineLabelFont, type BubbleDef } from '@/components/charts';
import { RISK_ROW } from '@/components/AllocationHistory';
import { GROUP_COLORS } from '@/components/ValueByMonth';
import type { MonthPeriod } from '@/components/AllocationByMonth';

export type IncomeBy = 'month' | 'quarter' | 'year';
// What the bars measure: money received, market yield, or yield on cost (lib/incomeYield.ts)
export type IncomeMeasure = 'amount' | 'yield' | 'onCost';
const MEASURE_OPTIONS: { value: IncomeMeasure; label: string; hint: string }[] = [
  { value: 'amount', label: 'Amount', hint: 'Money received, in the chosen currency' },
  { value: 'yield', label: 'Yield', hint: 'Each payment ÷ what those shares were worth at the previous month-end, added up per bar' },
  { value: 'onCost', label: 'Yield on cost', hint: 'Each payment ÷ what those shares cost you (average cost), added up per bar' },
];
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
// `kind`: dividend (incl. rent) or interest, so the buttons and the stack keep the two apart.
// `ccy`: the currency it pays in (cash interest is one payer per account AND currency).
interface Payer { key: string; label: string; title: string; cls: string; kind: 'dividend' | 'interest'; ccy: string; color: string; total: number }
// One payment, ready to add up: payer, month, account, and the amount shown — in the chosen
// currency, or (Native) in the payer's own currency, as paid
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
  measure: IncomeMeasure; setMeasure: (m: IncomeMeasure) => void;
}

export default function IncomeChart({
  rows, assetData, assetLookup, groupMetalsCrypto, tickerAccounts, classFilter, accountFilter, positionsCurrency,
  by, setBy, period, setPeriod, excluded, setExcluded, measure, setMeasure,
}: IncomeChartProps) {
  const [hoverBucket, setHoverBucket] = useState<string | null>(null);
  const amountCcy = positionsCurrency || 'PLN';
  const yieldMode = measure !== 'amount';
  // Native (no currency picked at the top): every payment in the currency it was paid in
  const native = !positionsCurrency && !yieldMode;

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
      // (the purchases and sales in `rows` are only for the yields below)
      if (r.flow !== 'Dividend' && r.flow !== 'Interest') continue;
      const ticker = r.ticker && r.ticker !== '-' ? r.ticker : '';
      const cashInterest = r.flow === 'Interest' && (!ticker || r.asset === 'Cash');
      const inLookup = info.get(ticker);
      // Cash interest: one payer per account and currency (an IBKR account earns USD, SGD and PLN)
      const key = cashInterest ? `int|${r.account}|${r.currency}` : `pay|${ticker || r.asset}`;
      if (!payerInfo.has(key)) {
        const kind = r.flow === 'Interest' ? 'interest' as const : 'dividend' as const;
        payerInfo.set(key, cashInterest
          ? { key, label: `${r.account} · ${r.currency}`, title: `Interest on ${r.currency} cash paid into ${r.account}`, cls: 'Cash', kind, ccy: r.currency }
          : {
            key,
            label: inLookup ? ticker : r.asset,
            title: inLookup ? `${inLookup.name} (${ticker})` : `${r.asset}${ticker ? ` (${ticker})` : ''} — not in the Lookup tab`,
            cls: inLookup ? (groupMetalsCrypto ? portfolioClassOf(inLookup) : (inLookup.assetClass || 'Other')) : '',
            kind, ccy: r.currency,
          });
      }
      const ym = r.date.slice(0, 7);
      const rates = rateAt(ym);
      const toPln = r.currency === 'PLN' ? 1 : rates[r.currency];
      // Native: shown in the payer's own currency (a payment in another currency is converted
      // into it); otherwise in the currency picked at the top
      const target = native ? payerInfo.get(key)!.ccy : amountCcy;
      const toShown = target === 'PLN' ? 1 : rates[target];
      if (r.currency === target) { payments.push({ key, ym, account: r.account, ticker, amount: r.amount }); continue; }
      if (!toPln || !toShown) continue;   // a currency the price sheet has no rate for
      payments.push({ key, ym, account: r.account, ticker, amount: (r.amount * toPln) / toShown });
    }
    return { payments, payerInfo };
  }, [rows, assetLookup, groupMetalsCrypto, ratesByYm, amountCcy, native]);

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

  // The yield of every dividend of a holding with a price (lib/incomeYield.ts), worked out only
  // once a yield view is picked. Prices: the sheet's month-end price of the month BEFORE each
  // payment, in the asset's own currency; amounts are converted into that currency first.
  //
  // The market yield needs the price people actually paid then, NOT the dividend-adjusted one
  // (a "TR" column scales history down as dividends are reinvested, which made old yields read
  // high). The sheet keeps the plain price beside it under the same ticker without "TR"
  // (CFATR -> CFA, KMLMTR -> KMLM, ...), so that column is used whenever it exists. A "TR"
  // ticker without one falls back to its adjusted price and is named under the chart.
  const yieldData = useMemo(() => {
    if (!yieldMode) return { list: [] as ReturnType<typeof paymentYields>, adjustedOnly: [] as string[] };
    const info = new Map(assetLookup.map(a => [a.ticker, a]));
    const tickers = new Set(rows.filter(r => r.flow === 'Dividend' && info.has(r.ticker)).map(r => r.ticker));
    const columns = new Set<string>();
    for (const row of assetData) for (const k of Object.keys(row)) columns.add(k);
    const priceColumn = (t: string) => (t.endsWith('TR') && columns.has(t.slice(0, -2)) ? t.slice(0, -2) : t);
    const adjustedOnly = Array.from(tickers).filter(t => t.endsWith('TR') && priceColumn(t) === t);
    const series = new Map<string, [string, number][]>();   // ticker -> [month, price], oldest first
    const sorted = [...assetData].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const row of sorted) {
      for (const t of Array.from(tickers)) {
        const v = Number(row[priceColumn(t)]);
        if (v > 0) (series.get(t) ?? series.set(t, []).get(t)!).push([String(row.date).slice(0, 7), v]);
      }
    }
    const priceBefore = (t: string, ym: string) => {
      let last: number | null = null;
      for (const [m, p] of series.get(t) ?? []) { if (m < ym) last = p; else break; }
      return last;
    };
    const toAssetCcy = (t: string, amount: number, ccy: string, ym: string) => {
      const target = info.get(t)?.currency || ccy;
      if (ccy === target) return amount;
      const rates = ratesByYm.byYm.get(ym) ?? ratesByYm.latest;
      const from = ccy === 'PLN' ? 1 : rates[ccy], to = target === 'PLN' ? 1 : rates[target];
      return from && to ? (amount * from) / to : null;
    };
    return { list: paymentYields(rows.filter(r => tickers.has(r.ticker)), priceBefore, toAssetCcy), adjustedOnly };
  }, [yieldMode, rows, assetLookup, assetData, ratesByYm]);
  const yieldPayments = yieldData.list;

  // What the bars add up: payments (money) in the Amount view; payment yields (%) in the yield
  // views, for the payers passing the same class / account filters
  const points = useMemo(() => {
    if (!yieldMode) return filtered.map(p => ({ key: p.key, ym: p.ym, value: p.amount }));
    const allowed = new Set(filtered.map(p => p.key));
    return yieldPayments.flatMap(y => {
      const key = `pay|${y.ticker}`;
      const v = measure === 'yield' ? y.marketPct : y.onCostPct;
      return allowed.has(key) && v !== null ? [{ key, ym: y.date.slice(0, 7), value: v }] : [];
    });
  }, [yieldMode, filtered, yieldPayments, measure]);

  // Every bucket from the first payment to today (empty ones too, so a quiet year shows as a
  // gap), within the chosen period
  const buckets = useMemo(() => {
    if (points.length === 0) return [] as string[];
    const first = points.reduce((m, p) => (p.ym < m ? p.ym : m), points[0].ym);
    const todayYm = localTodayIso().slice(0, 7);
    const startYm = periodStartIso(period).slice(0, 7);
    const out: string[] = [];
    for (let ym = first; ym <= todayYm; ym = nextYm(ym)) {
      const b = bucketOf(ym, by);
      if (out[out.length - 1] !== b && lastYmOf(b) >= startYm) out.push(b);
    }
    return out;
  }, [points, by, period]);

  // Each payer's total per bucket, and its total over the buckets shown
  const { perBucket, payers } = useMemo(() => {
    const shownSet = new Set(buckets);
    const perBucket = new Map<string, Record<string, number>>(buckets.map(b => [b, {}]));
    const totals: Record<string, number> = {};
    for (const p of points) {
      const b = bucketOf(p.ym, by);
      if (!shownSet.has(b)) continue;
      const cell = perBucket.get(b)!;
      cell[p.key] = (cell[p.key] ?? 0) + p.value;
      totals[p.key] = (totals[p.key] ?? 0) + p.value;
    }
    // Dividends first, then interest, so the two never mix in a bar (dividends at the bottom);
    // within each, the biggest earner first
    const kindRank = (k: string) => (payerInfo.get(k)!.kind === 'dividend' ? 0 : 1);
    const payers: Payer[] = Object.keys(totals)
      .filter(k => Math.abs(totals[k]) > (yieldMode ? 0 : 0.5))
      .sort((a, b) => kindRank(a) - kindRank(b) || totals[b] - totals[a])
      .map(k => ({ ...payerInfo.get(k)!, color: colorOf.get(k) ?? SLATE, total: totals[k] }));
    return { perBucket, payers };
  }, [points, buckets, by, payerInfo, colorOf, yieldMode]);

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
  // The currencies the bars are in: one (the chosen one) normally; Native, each ticked payer's own.
  // With more than one, a bar adds SGD to PLN, so totals are given per currency instead.
  const barCcys = useMemo(
    () => (native ? Array.from(new Set(shownPayers.map(p => p.ccy))).sort() : [amountCcy]),
    [native, shownPayers, amountCcy],
  );
  const mixed = barCcys.length > 1;
  // "1,200 SGD · 300 PLN": amounts per payer added up by currency
  const totalsByCcy = useCallback((amountOf: (p: Payer) => number) => {
    const sums: Record<string, number> = {};
    for (const p of shownPayers) {
      const ccy = native ? p.ccy : amountCcy;
      sums[ccy] = (sums[ccy] ?? 0) + amountOf(p);
    }
    return Object.entries(sums).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1])
      .map(([c, v]) => `${money(v)} ${c}`).join(' · ') || `0 ${barCcys[0] ?? amountCcy}`;
  }, [shownPayers, native, amountCcy, barCcys]);

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
            {/* (yield views: bars stand side by side, so the list is simply biggest first) */}
            {[...shownPayers].reverse().map(p => (b.byPayer[p.key] ?? 0) > (yieldMode ? 0 : 0.5) && (
              <tr key={p.key}>
                <td style={{ paddingRight: 10 }}>
                  <span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: p.color }} />{p.label}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>
                  {yieldMode ? `${b.byPayer[p.key].toFixed(2)}%` : money(b.byPayer[p.key])}
                </td>
                {/* Native: each amount's own currency, as paid */}
                {native && <td style={{ paddingLeft: 4, color: MUTED }}>{p.ccy}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!yieldMode && (
          <div style={{ color: INK, borderTop: `1px solid ${LINE}`, paddingTop: 2 }}>
            Total <span className="font-semibold">{totalsByCcy(p => b.byPayer[p.key] ?? 0)}</span>
          </div>
        )}
        {/* The change on the bar before: only when everything is in one currency */}
        {!yieldMode && !mixed && diff !== null && prev && (
          <div style={{ color: diff >= 0 ? GAIN : LOSS }}>
            {signedMoney(diff)} vs {longLabel(prev.bucket)}
          </div>
        )}
      </div>
    );
  }, [byBucket, shownPayers, currentBucket, yieldMode, native, mixed, totalsByCcy]);

  if (payments.length === 0) return null;

  // Tick-boxes: one payer in or out; All / None for one group (dividends or interest)
  const toggle = (key: string) => setExcluded(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  const setAll = (group: Payer[], on: boolean) => setExcluded(prev => (on
    ? prev.filter(k => !group.some(p => p.key === k))
    : Array.from(new Set([...prev, ...group.map(p => p.key)]))));

  // Summary figures over the ticked payers: total in the period, the last 12 months, best bar
  // (in Native with several currencies the totals are per currency and "best" is left out)
  const periodTotalText = totalsByCcy(p => bars.reduce((s, b) => s + (b.byPayer[p.key] ?? 0), 0));
  const todayYm = localTodayIso().slice(0, 7);
  let ym12 = todayYm;
  for (let i = 0; i < 11; i++) {
    const y = Number(ym12.slice(0, 4)), m = Number(ym12.slice(5, 7));
    ym12 = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  }
  const last12Text = totalsByCcy(p => points.filter(x => x.key === p.key && x.ym >= ym12).reduce((s, x) => s + Math.max(0, x.value), 0));
  // Yield views: each ticked payer's yield over the last 12 months (its payments' yields added
  // up), biggest first. A payer whose last payment is older than that has no figure here.
  const last12ByPayer = shownPayers
    .map(p => ({ p, v: points.filter(x => x.key === p.key && x.ym >= ym12).reduce((s, x) => s + x.value, 0) }))
    .filter(x => x.v > 0)
    .sort((a, b) => b.v - a.v);
  const best = bars.reduce<typeof bars[number] | null>((m, b) => (!m || b.total > m.total ? b : m), null);

  const filterNote = [classFilter && `${classFilter} only`, accountFilter && `${accountFilter} only`].filter(Boolean).join(' · ');

  return (
    <div className="bg-white p-4 rounded-lg shadow mb-4">
      <div className="flex items-center justify-between mb-3 gap-3 max-md:flex-col max-md:items-start max-md:gap-0.5">
        <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2 flex-wrap">
          Income: Dividends &amp; Interest
          {filterNote && <span className="text-xs font-normal text-amber-600">— {filterNote}</span>}
        </h4>
        <span className="text-xs text-gray-400">
          {native ? 'From the ledger · amounts as paid, each in its own currency' : `From the ledger · amounts in ${amountCcy}, at each payment month's rate`}
        </span>
      </div>

      {/* What the bars measure, bars per month / quarter / year, and the period: one line on
          desktop. Phones: the period is a box that opens a slide-up panel; the rows wrap. */}
      <div className="flex items-center gap-x-5 gap-y-2 mb-3 max-md:gap-x-2 max-md:flex-wrap">
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-gray-500 mr-1 max-md:hidden">Show:</span>
          <span className={SEG}>
            {MEASURE_OPTIONS.map(o => (
              <button key={o.value} onClick={() => setMeasure(o.value)} className={segBtn(measure === o.value)} title={o.hint}>{o.label}</button>
            ))}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-gray-500 mr-1 max-md:hidden">By:</span>
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

      {/* Payers, in two rows so they never mix: Dividends (incl. rent) and Interest (cash per
          account and currency, and bonds). The app's shared strip of segBtn buttons, slate while
          in the bars, each with a dot in its colour (like Daily NAV Drawdowns' currency buttons),
          and an All / None per row. Hover: the full name and its total over the period. */}
      {([['dividend', 'Dividends'], ['interest', 'Interest']] as const).map(([kind, title]) => {
        const group = payers.filter(p => p.kind === kind);
        if (group.length === 0) return null;
        // The label in a fixed column on the left; the buttons (and All / None) wrap beside it
        return (
          <div key={kind} className="flex items-start gap-2 mb-2 text-xs">
            <span className="text-gray-500 w-16 shrink-0 pt-[8px] max-md:pt-[12px]">{title}:</span>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 min-w-0 flex-1">
            {/* (SEG never shrinks, so it is capped at the column's width here: then it wraps) */}
            <span className={`${SEG} flex-wrap max-w-full`}>
              {group.map(p => {
                const on = !left.has(p.key);
                const unit = yieldMode ? '%' : ` ${native ? p.ccy : amountCcy}`;
                return (
                  <button key={p.key} type="button" onClick={() => toggle(p.key)} aria-pressed={on}
                    title={`${p.title} · ${yieldMode ? p.total.toFixed(1) : money(p.total)}${unit} in the period`} className={segBtn(on)}>
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle -mt-px" style={{ backgroundColor: p.color }} />
                    {p.label}
                  </button>
                );
              })}
            </span>
            <span className="inline-flex gap-2 ml-1">
              <button type="button" onClick={() => setAll(group, true)} className="text-blue-600 hover:underline">All</button>
              <button type="button" onClick={() => setAll(group, false)} className="text-blue-600 hover:underline">None</button>
            </span>
            </div>
          </div>
        );
      })}

      {bars.length === 0 || shownPayers.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">
          {payers.length === 0 ? 'No dividends or interest match the filters above.' : 'Nothing to show: tick at least one payer above.'}
        </p>
      ) : (
        <>
          {/* Summary over the ticked payers. Yield views: each payer's last-12-months yield. */}
          {yieldMode ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs mb-3">
              <span className="text-gray-500">{measure === 'yield' ? 'Yield' : 'Yield on cost'}, last 12 months:</span>
              {last12ByPayer.length === 0 && <span className="text-gray-400">no payments in the last 12 months</span>}
              {last12ByPayer.map(({ p, v }) => (
                <span key={p.key} className={RISK_ROW}>
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="text-gray-600">{p.label}</span>
                  <span className="font-semibold text-gray-800">{v.toFixed(1)}%</span>
                </span>
              ))}
            </div>
          ) : (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs mb-3">
            <span className={RISK_ROW}>
              <span className="text-gray-500">Total in period:</span>
              <span className="font-semibold text-gray-800">{periodTotalText}</span>
            </span>
            <span className={RISK_ROW} title="The 12 calendar months up to and including this one">
              <span className="text-gray-500">Last 12 months:</span>
              <span className="font-semibold text-gray-800">{last12Text}</span>
            </span>
            {!mixed && best && best.total > 0 && (
              <span className={RISK_ROW}>
                <span className="text-gray-500">Best {by}:</span>
                <span className="font-semibold text-gray-800">{money(best.total)} {barCcys[0]}</span>
                <span className="text-gray-400">{longLabel(best.bucket)}</span>
              </span>
            )}
          </div>
          )}
          {/* Native with payers in several currencies: a bar then adds SGD to PLN */}
          {mixed && (
            <p className="text-xs text-amber-600 -mt-1 mb-2">
              Amounts as paid, in {barCcys.join(', ')}: a bar adds different currencies, so heights aren&apos;t comparable.
              Tick payers of one currency (or pick a currency at the top) to compare.
            </p>
          )}

          <IncomeBars bars={bars} payers={shownPayers} by={by} yieldMode={yieldMode} unit={mixed ? '' : barCcys[0]}
            renderTooltip={renderTooltip} onHover={setHoverBucket} />
          <p className="text-xs text-gray-400 mt-2">
            {hoverBucket ? `${longLabel(hoverBucket)}: hover box shows each payer.` : 'Hover (or touch) a bar to see who paid what.'}
            {' '}The latest bar is {by === 'year' ? 'the year' : by === 'quarter' ? 'the quarter' : 'the month'} so far.
            {yieldMode
              ? <>
                  {' '}Each bar adds up the yields of the payments in it (four quarterly payments = the year&apos;s yield; never annualised).
                  {' '}Only holdings with a price in the sheet have a yield: cash interest and assets not in the Lookup tab are left out.
                  {measure === 'yield' && ' Yield uses each asset’s plain (unadjusted) price, e.g. CFA for CFATR.'}
                  {measure === 'yield' && yieldData.adjustedOnly.length > 0 &&
                    ` ${yieldData.adjustedOnly.join(', ')}: no unadjusted price in the sheet, so the dividend-adjusted one is used and older years read somewhat high.`}
                </>
              : ' Assets no longer in the Lookup tab show by name and only with no class picked.'}
          </p>
        </>
      )}
    </div>
  );
}

// The bars on their own, memoised: hovering only changes the hovered bucket in the parent
const IncomeBars = React.memo(function IncomeBars({ bars, payers, by, yieldMode, unit, renderTooltip, onHover }: {
  bars: { bucket: string; total: number; byPayer: Record<string, number> }[];
  payers: Payer[];
  by: IncomeBy;
  yieldMode: boolean;   // yields in %: one bar per payer side by side (a yield can't be stacked)
  unit: string;         // the bars' currency ('' when Native mixes several), for the latest-bar label
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
  // (no label when the bars add up several currencies: the sum would mean nothing)
  const edgeDefs: BubbleDef[] = unit ? [{ value: last.total, color: SLATE, label: shortMoney(last.total) }] : [];
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
        <YAxis tickFormatter={yieldMode ? ((v: number) => `${v}%`) : (phoneAxisMoney() ?? ((v: number) => money(v)))}
          tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} width={phone || yieldMode ? 40 : 64} />
        <Tooltip cursor={{ fill: 'rgba(148,163,184,0.15)' }} content={renderTooltip} />
        {payers.map((p, i) => (
          <Bar key={p.key} dataKey={`p${i}`} name={p.label} stackId={yieldMode ? undefined : 'income'} fill={p.color} isAnimationActive={false}
            stroke={touching ? p.color : undefined} strokeWidth={touching ? 1 : 0} />
        ))}
        {/* The latest bar's total (the current month / quarter / year so far); amounts only */}
        {!yieldMode && <Customized component={<EdgeBubbles defs={edgeDefs} bubbleWidth={LABEL_W} fontSize={twoLineLabelFont()} />} />}
      </BarChart>
    </ResponsiveContainer>
  );
});
