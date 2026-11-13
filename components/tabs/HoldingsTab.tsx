/*
  THE MARKETS TAB: HOLDINGS PAGE

  Open positions and cash in one currency, grouped by section, with returns, XIRR, drawdowns and
  the portfolio mix. The numbers come from lib/holdings.ts (built in the main screen). Clicking a
  row opens it on the Positions tab, so the Positions setters are passed in.
*/
import React from 'react';
import type { PositionsModel } from '@/lib/positions';
import { HOLDINGS_CURRENCIES, HOLDINGS_MIX_ABBR, type HoldingRow, type HoldingsCurrency, type HoldingsModel } from '@/lib/holdings';
import { PhoneChoice } from '@/components/PhoneSheet';
import { GAIN, LOSS, PINNED_FILTERS, SEG, formatPrice, readableTextOn, returnHeatColor, segBtn } from '@/components/ui';

export interface HoldingsTabProps {
  holdingsModel: HoldingsModel | null;
  positionsModel: PositionsModel | null;
  edoMissingBanner: React.ReactNode;                 // a warning when EDO bonds are held but their sheet is missing
  holdingsCurrency: HoldingsCurrency; setHoldingsCurrency: (c: HoldingsCurrency) => void;
  setActiveView: (v: 'positions') => void;
  setOpenSelectedTicker: (t: string) => void;
  setClosedSelectedTicker: (t: string) => void;
  setCashCategory: (c: string) => void;
  setCashSelected: (c: string) => void;
  setOpenIncludedTxns: (s: Set<number> | null) => void;
  setOpenSinceInvested: (on: boolean) => void;
  setOpenShowMinMax: (on: boolean) => void;
  setOpenShowAvgBuy: (on: boolean) => void;
  setOpenInvestedFrom: (d: string) => void;
  setOpenInvestedInto: (d: string) => void;
  setOpenGraphStarts: (d: string) => void;
  setOpenGraphEnds: (d: string) => void;
}

export default function HoldingsTab({
  holdingsModel, positionsModel, edoMissingBanner, holdingsCurrency, setHoldingsCurrency, setActiveView,
  setOpenSelectedTicker, setClosedSelectedTicker, setCashCategory, setCashSelected, setOpenIncludedTxns,
  setOpenSinceInvested, setOpenShowMinMax, setOpenShowAvgBuy, setOpenInvestedFrom, setOpenInvestedInto,
  setOpenGraphStarts, setOpenGraphEnds,
}: HoldingsTabProps) {
  const h = holdingsModel;
  // On "Native" each row is in its own currency (r.ccy) and only the figures that add
  // rows together — subtotals, totals, weights, tiles — are in one currency (USD).
  // `ccy` is that adding-up currency; row-level text uses r.ccy.
  const native = holdingsCurrency === 'Native';
  const ccy = h?.totalsCurrency ?? (native ? 'USD' : holdingsCurrency);
  // On Native, the subtotal and total amounts carry a small "USD" so they can't be read as native.
  const totTag = native ? <span className="text-[9px] text-gray-400 font-normal ml-0.5">{ccy}</span> : null;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`; // "Oct 2026"
  const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${monthLabel(d)}`;               // "15 Mar 2021"
  const isMtd = !!h && h.endDate.slice(0, 7) === new Date().toISOString().slice(0, 7);

  // Money is whole units with thousands separators, like the Positions tab; returns carry a sign.
  const fmtMoney = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  // Anything that would print as zero prints as a plain zero, so a −0.3 never shows as "-0"
  // (or −0.04% as "-0.0%"), like the Markets pages. Other values keep the app's usual
  // rounding (toLocaleString / toFixed), so they match the Positions tab to the unit.
  const fmtSigned = (v: number) =>
    (Math.abs(v) < 0.5 ? '0' : `${v > 0 ? '+' : ''}${fmtMoney(v)}`);
  const fmtPctSigned = (v: number) =>
    (Math.abs(v) < 0.05 ? '0.0%' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
  // Share counts: whole shares need no decimals, a fraction of a bitcoin needs four.
  const fmtQty = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: Math.abs(v) < 1 ? 4 : 2 });

  const assetRows = h ? h.sections.flatMap(s => s.rows).filter(r => r.kind === 'asset') : [];
  const allRows = h ? h.sections.flatMap(s => s.rows) : [];

  // Total-return bars: one scale for every holding, from the biggest loss to the biggest
  // gain and always including zero, so every bar starts from the same zero line.
  // Each bar is the row's OWN return (the figure printed next to it), so side and colour
  // always match that figure. On "Native" it is sized at today's rate into USD (fxNow), so a
  // USD bar and an SGD bar are still comparable; elsewhere fxNow is 1.
  const barVal = (r: HoldingRow) => r.ret * r.fxNow;
  const retLo = Math.min(0, ...assetRows.map(barVal));
  const retHi = Math.max(0, ...assetRows.map(barVal));
  const retSpan = (retHi - retLo) || 1;
  const zeroPct = (-retLo / retSpan) * 100;
  // The theme's gain green / loss red, the same as every bar chart (see Markets above)
  const BAR_UP = GAIN, BAR_DOWN = LOSS;
  // Heat colours for Return % and XIRR, each column on its own scale (as on the Markets pages).
  const cap = (vals: (number | null)[]) => Math.max(1e-9, ...vals.filter((v): v is number => v !== null).map(Math.abs));
  const pctCap = cap(assetRows.map(r => r.retPct));
  const xirrCap = cap(assetRows.map(r => r.xirr));
  const maxWeight = Math.max(1e-9, ...allRows.map(r => r.weight));

  const heatCell = (v: number | null, capV: number, title: string, bold = false) => {
    if (v === null) return <td className="px-0.5 py-0.5 text-center text-xs text-gray-300">–</td>;
    const bg = returnHeatColor(Math.max(-1, Math.min(1, v / capV)) * 40);
    return (
      <td className="px-px py-0.5" title={title}>
        <div className={`rounded px-1 py-1 cursor-help text-center text-xs tabular-nums ${bold ? 'font-semibold' : ''}`}
          style={{ background: bg, color: readableTextOn(bg) }}>{fmtPctSigned(v)}</div>
      </td>
    );
  };
  const weightCell = (w: number, bold = false) => (
    <td className="px-1 py-1" title={`${w.toFixed(2)}% of everything held (cash included)`}>
      {/* One compact box: the bar fills it from the left (largest holding = full width; the */}
      {/* subtotal and total rows simply fill it), and the figure sits inside, right-aligned. */}
      <div className="relative w-14 h-5 ml-auto bg-gray-100 rounded-sm overflow-hidden">
        {/* The bar's grey is a class (bg-gray-300), not an inline colour, so dark mode turns it
            dark grey too (app/dark.css); inline, it stayed light grey under light text. */}
        <div className="absolute inset-y-0 left-0 bg-gray-300" style={{ width: `${Math.min(1, Math.max(0, w / maxWeight)) * 100}%` }} />
        <span className={`relative block pr-1 text-right text-xs leading-5 tabular-nums ${w < 0 ? 'text-red-600' : 'text-gray-800'} ${bold ? 'font-semibold' : ''}`}>{w.toFixed(1)}%</span>
      </div>
    </td>
  );

  // Clicking a name opens it in the Positions tab: an investment's detail panel (lots,
  // dividends, chart) or a cash account's statement. That tab's own filters are left as
  // they were — its detail panels show whatever is selected regardless of them. The
  // chart settings reset exactly as a click in the Open Positions table resets them.
  const openInPositions = (r: HoldingRow) => {
    setClosedSelectedTicker('');
    if (r.kind === 'cash') {
      setOpenSelectedTicker('');
      setCashSelected(r.key);
      setCashCategory('');
    } else {
      setCashSelected('');
      setOpenSelectedTicker(r.ticker);
      setOpenIncludedTxns(null);
      setOpenInvestedInto('');
      setOpenInvestedFrom('');
      setOpenGraphStarts('');
      setOpenGraphEnds('');
      setOpenSinceInvested(true);
      setOpenShowAvgBuy(true);
      setOpenShowMinMax(false);
    }
    setActiveView('positions');
    window.scrollTo({ top: 0 });
  };

  // Asset + Price + Held + Invested + Value + Return bar + Return % + XIRR + Qty + Curr DD + Weight
  const colCount = 11;

  return (
    <div className="mt-2">
      {edoMissingBanner}
      {/* Page-level filter: the one currency every money figure is converted into, or */}
      {/* Native (each row in its own currency; totals, weights and tiles then in USD). */}
      <div className={`${PINNED_FILTERS} max-md:static mb-4 flex flex-wrap items-center gap-x-6 gap-y-2`}>
        <div className="hidden max-md:flex w-full">
          <PhoneChoice
            label="Currency"
            options={HOLDINGS_CURRENCIES.map(c => ({ value: c, label: c }))}
            selected={holdingsCurrency}
            onPick={c => setHoldingsCurrency(c as HoldingsCurrency)}
          />
        </div>
        <div className="flex items-center gap-1 max-md:hidden">
          <span className="text-xs text-gray-500 mr-1">Currency:</span>
          <span className={SEG}>
          {HOLDINGS_CURRENCIES.map(c => (
            <button
              key={c}
              onClick={() => setHoldingsCurrency(c)}
              className={segBtn(holdingsCurrency === c)}
            >{c}</button>
          ))}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        {/* Card header */}
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div>
            <h3 className="text-md font-semibold text-gray-800 inline">Holdings</h3>
            <span className="text-xs text-gray-500 ml-2 uppercase tracking-wide">
              {native
                ? <>open positions + cash · each holding in its own currency · totals in {ccy}</>
                : <>open positions + cash · values in {ccy}</>}
            </span>
          </div>
          {h && (
            <span className="text-xs text-gray-500 border border-gray-200 rounded px-2 py-0.5">
              Data as of {monthLabel(h.endDate)}{isMtd ? ' (month to date)' : ''}
            </span>
          )}
        </div>

        {!h || allRows.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">
            {!positionsModel ? 'Loading the Transactions ledger…' : 'No open positions or cash balances found in the Transactions ledger.'}
          </p>
        ) : (
          <>
            {/* Summary tiles: what it is all worth, what it has made, and how it is split */}
            {/* across the sections. The mix tile is wider: its five figures need ~350px on one */}
            {/* line, so below the lg breakpoint it takes a whole row of its own. */}
            <div className="grid grid-cols-2 lg:grid-cols-[1fr_1fr_2fr] gap-2 mb-4">
              {[
                {
                  label: 'Total value', value: `${fmtMoney(h.totals.value)} ${ccy}`, cls: 'text-gray-800',
                  sub: `${h.totals.holdings} holdings + cash`, title: '',
                },
                {
                  label: 'Total return', value: `${fmtSigned(h.totals.ret)} ${ccy}`,
                  cls: h.totals.ret >= 0 ? 'text-green-700' : 'text-red-700',
                  sub: h.totals.retPct !== null ? `${fmtPctSigned(h.totals.retPct)} · incl. dividends & interest` : 'incl. dividends & interest',
                  title: `Value ${fmtMoney(h.totals.value)} + dividends & interest − invested ${fmtMoney(h.totals.invested)} (${ccy}).\n`
                    + 'Shares still held only; gains on shares already sold are in Positions › Closed Positions.\n'
                    + 'The % is on everything invested INCLUDING cash, so idle cash pulls it down.',
                },
                {
                  // "Cash 6.7% | FI 12.0% | EQ 34.9% | ALT 39.3% | OTH 7.1%" — each section's weight,
                  // in page order. OTH = Metals & Crypto. Hover for full names and amounts.
                  label: 'Asset mix', cls: 'text-gray-800', sub: '',
                  value: h.sections.map(s => `${HOLDINGS_MIX_ABBR[s.name] ?? s.name.slice(0, 3).toUpperCase()} ${s.weight.toFixed(1)}%`).join(' | '),
                  title: h.sections.map(s => `${s.name}: ${s.weight.toFixed(1)}% · ${fmtMoney(s.value)} ${ccy}`).join('\n'),
                },
              ].map(t => (
                <div key={t.label} title={t.title || undefined}
                  className={`rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 min-w-0 ${t.title ? 'cursor-help' : ''} ${t.label === 'Asset mix' ? 'col-span-2 lg:col-span-1' : ''}`}>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 whitespace-nowrap truncate">{t.label}</div>
                  {/* Phones: wraps instead of "…" (the Asset mix), and the small note goes on its own line */}
                  <div className="text-sm whitespace-nowrap truncate max-md:whitespace-normal">
                    <span className={`font-semibold tabular-nums ${t.cls}`}>{t.value}</span>
                    <span className="text-xs text-gray-500 ml-2 max-md:block max-md:ml-0">{t.sub}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Phones: names stay put on the left while the figures swipe ("phone-pin-first") */}
            <div className="overflow-x-auto phone-pin-first">
              <table className="w-full text-sm border-collapse">
                <tbody>
                  {h.sections.map((s, si) => (
                    <React.Fragment key={s.name}>
                      {/* A little air between one section's subtotal and the next header */}
                      {si > 0 && <tr><td colSpan={colCount} className="h-4" /></tr>}
                      {/* Each section carries its own copy of the column headers, with the */}
                      {/* section name (e.g. "EQUITIES") in the first cell, as on the Markets pages. */}
                      <tr className="bg-gray-100 text-[11px] uppercase tracking-wide text-gray-500">
                        <th className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap">{s.name}</th>
                        <th className="text-right font-medium px-2 py-2">Price</th>
                        <th className="text-right font-medium px-2 py-2 whitespace-nowrap" title="Years since the first purchase of the shares still held">Held</th>
                        <th className="text-right font-medium px-2 py-2 whitespace-nowrap">Invested</th>
                        <th className="text-right font-medium px-2 py-2 whitespace-nowrap">Value</th>
                        {/* The fixed-width div holds the bar column open (the bars claim no width). */}
                        <th className="text-left font-medium px-3 py-2">
                          <div className="w-[220px]"><span className="text-gray-800 font-semibold">Total return · {native ? 'own currency' : ccy}</span></div>
                        </th>
                        <th className="text-center font-medium px-0.5 py-2 w-16 whitespace-nowrap">Return %</th>
                        <th className="text-center font-medium px-0.5 py-2 w-16 cursor-help"
                          title={'Money-weighted return per year (XIRR), in ' + (native ? "each holding's own currency" : ccy) + '.\nHeld less than a year: the plain total return instead (not annualised).'}>XIRR</th>
                        <th className="text-right font-medium px-2 py-2">Qty</th>
                        <th className="text-right font-medium px-2 py-2 whitespace-nowrap cursor-help"
                          title={'Profit given back since the holding\'s best month-end (its profit/loss line, dividends included), in ' + (native ? "its own currency" : ccy) + '.\nHover a figure for the working.'}>Curr DD</th>
                        <th className="text-right font-medium px-2 py-2">Weight</th>
                      </tr>
                      {s.rows.map(r => {
                        const isCash = r.kind === 'cash';
                        const bv = barVal(r);
                        const w = (Math.abs(bv) / retSpan) * 100;
                        // On Native, a small currency tag after the row's amounts says which one they are in.
                        const tag = native ? <span className="text-[9px] text-gray-400 font-normal ml-0.5">{r.ccy}</span> : null;
                        const stale = !!r.priceDate && r.priceDate.slice(0, 7) !== h.endDate.slice(0, 7);
                        const ddFlat = r.dd !== null && Math.abs(r.dd.amount) < 0.5;
                        return (
                          <tr key={r.key} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="px-3 py-1 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => openInPositions(r)}
                                className="text-gray-800 hover:text-slate-900 hover:underline underline-offset-2 text-left"
                                title={isCash ? `${r.name} — open its statement in the Positions tab` : `${r.ticker} — open its purchases and chart in the Positions tab`}
                              >{r.name}</button>
                            </td>

                            {/* Latest price in the asset's own currency, red if below last month-end */}
                            <td className="px-2 py-1 text-right text-xs whitespace-nowrap tabular-nums">
                              {r.price === null ? <span className="text-gray-300">–</span> : (
                                <>
                                  <span className={r.priceUp === false ? 'text-red-600' : 'text-gray-900'}>{formatPrice(r.price)}</span>
                                  <span className="text-[9px] text-gray-400 ml-0.5">{r.nativeCurrency}</span>
                                  {stale && <span className="text-[10px] text-amber-600 ml-1" title={`Latest price is from ${r.priceDate}`}>({monthLabel(r.priceDate)})</span>}
                                </>
                              )}
                            </td>

                            <td className="px-2 py-1 text-right text-xs tabular-nums whitespace-nowrap cursor-help"
                              title={r.firstBuyDate ? `First buy: ${dayLabel(r.firstBuyDate)}` : ''}>
                              {r.yearsHeld === null ? <span className="text-gray-300">–</span> : `${r.yearsHeld.toFixed(1)}y`}
                            </td>
                            <td className="px-2 py-1 text-right text-xs tabular-nums text-gray-700 whitespace-nowrap">{isCash ? <span className="text-gray-300">–</span> : <>{fmtMoney(r.invested)}{tag}</>}</td>
                            <td className={`px-2 py-1 text-right text-xs tabular-nums whitespace-nowrap ${r.value < 0 ? 'text-red-600' : 'text-gray-900'}`}>{fmtMoney(r.value)}{tag}</td>

                            {/* Total return as an amount: a bar from the shared zero line, the figure */}
                            {/* just past its end. Cash earns no return here, so it gets a dash. */}
                            <td className="px-3 py-1">
                              {isCash ? <span className="text-gray-300 text-xs">–</span> : (
                                <div className="relative h-4 mx-14 cursor-help"
                                  title={`Value ${fmtMoney(r.value)} + dividends & interest ${fmtMoney(r.income)} − invested ${fmtMoney(r.invested)} = ${fmtSigned(r.ret)} ${r.ccy}`
                                    + (native && r.ccy !== ccy ? `\n(bar sized at today's rate: ${fmtSigned(bv)} ${ccy}, so bars compare across currencies)` : '')}>
                                  <div className="absolute top-0 bottom-0 w-px bg-gray-300" style={{ left: `${zeroPct}%` }} />
                                  <div className="absolute top-0.5 bottom-0.5 rounded-sm"
                                    style={{ left: `${bv >= 0 ? zeroPct : zeroPct - w}%`, width: `${w}%`, background: bv >= 0 ? BAR_UP : BAR_DOWN }} />
                                  <span className="absolute top-1/2 -translate-y-1/2 text-xs tabular-nums text-gray-700 whitespace-nowrap"
                                    style={bv >= 0 ? { left: `calc(${zeroPct + w}% + 4px)` } : { right: `calc(${100 - zeroPct + w}% + 4px)` }}
                                  >{fmtSigned(r.ret)}{tag}</span>
                                </div>
                              )}
                            </td>

                            {heatCell(r.retPct, pctCap, r.retPct === null ? '' : `Total return ÷ invested = ${fmtSigned(r.ret)} ÷ ${fmtMoney(r.invested)} ${r.ccy}`)}
                            {heatCell(r.xirr, xirrCap, r.yearsHeld !== null && r.yearsHeld < 1
                              ? `Held less than a year, so this is the plain total return in ${r.ccy}, not annualised`
                              : 'Money-weighted return per year in ' + r.ccy + ': each purchase and dividend on its own date,\ntoday\'s value as the final inflow')}

                            <td className="px-2 py-1 text-right text-xs tabular-nums whitespace-nowrap text-gray-700">
                              {fmtQty(r.qty)}
                              {isCash && <span className="text-[9px] text-gray-400 ml-0.5">{r.nativeCurrency}</span>}
                            </td>

                            {/* Curr DD as an amount, from the holding's own peak (see lib/holdings.ts) */}
                            <td className={`px-2 py-1 text-right text-xs tabular-nums whitespace-nowrap ${r.dd ? 'cursor-help' : ''} ${ddFlat ? 'text-green-700 font-semibold' : 'text-orange-700'}`}
                              title={r.dd
                                ? `Profit given back since this holding's best month-end, in ${r.ccy}.\n`
                                  + 'Profit/loss = shares\' value + dividends & interest received − money put in, at each month-end\n'
                                  + '(the line charted for this holding on the Positions tab).\n\n'
                                  + `Best: ${fmtSigned(r.dd.peakPnl)} ${r.ccy} (${monthLabel(r.dd.peakDate)})\n`
                                  + `Today: ${fmtSigned(r.dd.nowPnl)} ${r.ccy}\n`
                                  + `Given back: ${fmtSigned(r.dd.nowPnl)} − (${fmtSigned(r.dd.peakPnl)}) = ${fmtSigned(r.dd.amount)} ${r.ccy}\n\n`
                                  + 'Buying more never counts as a gain: the money put in rises with the value.'
                                  + (r.ccy !== r.nativeCurrency
                                    ? `\nIncludes FX moves: priced in ${r.nativeCurrency}, shown here in ${r.ccy} (the Positions chart is in ${r.nativeCurrency}).`
                                    : '')
                                : ''}>
                              {!r.dd ? <span className="text-gray-300">–</span> : ddFlat ? 'Peak' : <>{fmtSigned(r.dd.amount)}{tag}</>}
                            </td>

                            {weightCell(r.weight)}
                          </tr>
                        );
                      })}
                      {/* Section subtotal: the class's slice of the portfolio */}
                      {(() => {
                        const isCashSection = s.rows.every(r => r.kind === 'cash');
                        return (
                          <tr className="border-b border-gray-200 text-xs font-semibold text-gray-700">
                            {/* Kept short so it stays on one line (no row count) */}
                            <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">
                              Subtotal{native && <> · in {ccy}</>}
                            </td>
                            <td /><td />
                            <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{isCashSection ? '' : <>{fmtMoney(s.invested)}{totTag}</>}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtMoney(s.value)}{totTag}</td>
                            <td className={`px-3 py-1.5 tabular-nums whitespace-nowrap ${s.ret >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                              {isCashSection ? '' : <span className="ml-14">{fmtSigned(s.ret)}{totTag}</span>}
                            </td>
                            {heatCell(s.retPct, pctCap, s.retPct === null ? '' : `${s.name}: total return ÷ invested = ${fmtSigned(s.ret)} ÷ ${fmtMoney(s.invested)} ${ccy}`, true)}
                            {heatCell(s.xirr, xirrCap, `${s.name}: money-weighted return per year, all its purchases and dividends on one timeline`, true)}
                            <td /><td />
                            {weightCell(s.weight, true)}
                          </tr>
                        );
                      })()}
                    </React.Fragment>
                  ))}
                  {/* Grand total: same light grey as the headers, set apart by the thick top border */}
                  <tr><td colSpan={colCount} className="h-4" /></tr>
                  <tr className="border-t-2 border-gray-300 bg-gray-100 text-xs font-semibold text-gray-800">
                    {/* Kept short so it stays on one line, like the Subtotal rows */}
                    <td className="px-3 py-2 whitespace-nowrap">Total{native && <> · in {ccy}</>}</td>
                    <td /><td />
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap" title="Cash counts at its balance">{fmtMoney(h.totals.invested)}{totTag}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{fmtMoney(h.totals.value)}{totTag}</td>
                    <td className={`px-3 py-2 tabular-nums whitespace-nowrap ${h.totals.ret >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      <span className="ml-14">{fmtSigned(h.totals.ret)}{totTag}</span>
                    </td>
                    {heatCell(h.totals.retPct, pctCap, 'Total return ÷ everything invested, cash included', true)}
                    {heatCell(h.totals.xirr, xirrCap, 'Money-weighted return per year of all the investments together (cash has no dated flows, so it is left out)', true)}
                    <td /><td />
                    {weightCell(100, true)}
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-gray-500 mt-3">
              Shares still held, as in Positions › Open Positions (oldest shares sold first); gains on shares already sold are in Closed Positions ·
              {native
                ? <>Native: each holding in its own currency, no FX; subtotals, totals, weights and tiles in {ccy} (converted as below);
                  each return bar is the holding&apos;s own return, sized at today&apos;s rate into {ccy} so bars compare across currencies · </>
                : null}
              invested and each dividend converted at their own month&apos;s exchange rate, value at today&apos;s, so FX moves are part of the return ·
              total return = value + dividends &amp; interest − invested · XIRR = money-weighted return per year in {native ? 'the row’s currency' : ccy},
              or the plain total return when held less than a year ·
              Curr DD = profit given back since the best month-end of the holding&apos;s profit/loss line (value + dividends − money put in, as charted on the Positions tab) ·
              weight = share of everything held, cash included · price in the asset&apos;s own currency, red if below last month-end ·
              click a name to open it in the Positions tab
            </p>
          </>
        )}
      </div>
    </div>
  );
}
