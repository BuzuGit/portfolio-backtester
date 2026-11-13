'use client';
/*
  PORTFOLIO BACKTESTER COMPONENT

  This is the main component that does all the heavy lifting: it loads every tab of the
  Google Sheet (lib/fetchData.ts) and draws every page of the app. The arithmetic for the
  bigger pages lives in lib/ (positions, cash, markets, holdings, edo); this file draws.

  The pages, in left-menu order (NAV_VIEWS, further down, is the authoritative list):
   - Backtest         build portfolios (or pick a preset from the sheet's Portfolios tab),
                      simulate them over history with rebalancing, compare stats and charts
   - Markets          one-screen market boards, one per SnapshotCategory in the Lookup tab,
                      each with a Returns and a Stats view; plus EDO (Polish inflation bonds,
                      lib/edo.ts), Country (one country's assets in its own currency) and
                      Holdings (what you own today, cash included, lib/holdings.ts)
   - Portfolio        your real portfolio over time: Daily NAV vs inflation and benchmarks,
                      returns and contributions by year, and each year's profit by asset
   - Positions        Open and Closed positions, rebuilt from the Transactions ledger
                      (lib/positions.ts), plus cash balances (lib/cash.ts)
   - Monthly          13 months of prices as a heatmap with 10-month SMA signals; click an
                      asset for its detail page (stats, charts, seasonality, vs market)
   - Annual           every asset's calendar-year returns
   - Best To Worst    one year's assets ranked (Ranking), or many years side by side (Return Map)
   - Graphs           a grid of price charts, one per asset
   - Trend Following  Buy & Hold vs a 10-month SMA timing rule, per asset
   - Correlations     correlation matrix, head-to-head pairs, and a risk/return scatter

  'use client' at the top tells Next.js this component needs to run
  in the browser (not on the server) because it uses:
  - useState/useEffect (React hooks for interactivity)
  - Charts (need the browser's canvas)
  - User interactions
*/

import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Area, ReferenceDot, ReferenceLine, AreaChart, Customized, PieChart, Pie } from 'recharts';
// Switches off chart animation app-wide: every chart draws instantly (see the file for why/how)
import '@/lib/noChartAnimation';
import { RefreshCw, Menu, X, FlaskConical, Globe, Briefcase, Layers, CalendarDays, CalendarRange, ArrowDownWideNarrow, LineChart as LineChartIcon, TrendingUp, Grid3x3, Moon, Sun, ChevronDown } from 'lucide-react';
import { fetchSheetData, SheetUnreachableError, localTodayIso, AssetRow, AssetLookup, YearsRow, ClosedPositionRow, TransactionRow, DailyNavRow, PresetPortfolio, FLOW_PURCHASE, FLOW_DIVIDEND, ParsedData, UnitFee, unitFeeQty } from '@/lib/fetchData';
import { isPhoneScreen, readSavedSheet, saveSheet } from '@/lib/savedSheet';
import { BottomSheet, PhoneCheckSheet, PhoneSelectSheets } from '@/components/PhoneSheet';
import { buildPositions, toTransactionRows, toClosedPositionRows, closedTickersFrom, PositionsModel } from '@/lib/positions';
import { buildCashAccounts, selectVisibleCash, CashAccountBalance } from '@/lib/cash';
import { buildReturnMatrix, buildCountryMatrix, snapshotCategories, MARKETS_COUNTRY, MarketsCurrency, MarketsPeriod } from '@/lib/markets';
import { buildHoldings, portfolioClassOf, MARKETS_HOLDINGS, HoldingsCurrency } from '@/lib/holdings';
// The one place CAGR / volatility / Sharpe / drawdown are defined, so every tab agrees.
// Sharpe is imported as `sharpeFor` because many functions here already have a local `sharpeRatio`.
import { sharpeRatio as sharpeFor } from '@/lib/stats';
// The backtest engine, its statistics and tables, and the currency conversion it uses
import {
  portfolioReturns, simulatePortfolio, calculateStatistics, calculateMonthlyReturns, getConversionRate,
  getFxRate, FX_TICKER_MAP, type BacktestSettings, type PortfolioAsset, type Portfolio, type DateRange,
  type ReturnPoint, type BacktestResult, type RebalancingRow,
} from '@/lib/backtest';
import TrendFollowingTab from '@/components/tabs/TrendFollowingTab';
import CorrelationsTab from '@/components/tabs/CorrelationsTab';
import GraphsTab from '@/components/tabs/GraphsTab';
import AnnualReturnsTab from '@/components/tabs/AnnualReturnsTab';
import BestToWorstTab from '@/components/tabs/BestToWorstTab';
import MonthlyTab from '@/components/tabs/MonthlyTab';
import BacktestSetup from '@/components/tabs/BacktestSetup';
import BacktestResults from '@/components/tabs/BacktestResults';
import MarketsTab from '@/components/tabs/MarketsTab';
import HoldingsTab from '@/components/tabs/HoldingsTab';
import EdoTab from '@/components/tabs/EdoTab';
import PortfolioTab, { type YearlyProfitBreakdown } from '@/components/tabs/PortfolioTab';
import { yearsRowRate } from '@/lib/yearsRates';
// Fixed choices for the controls: date presets, currencies, CPI series, the FX-conversion tooltip
import {
  DATE_PRESETS, CURRENCY_SYMBOLS, CURRENCY_OPTIONS, CPI_OPTIONS,
  type DatePreset,
} from '@/components/options';
// Chart helpers shared by the tabs: ticks, edge bubbles, axis scales, return-chart periods...
import {
  computePnlZeroFraction, mergeComparisonData, DateAxisTick, pushTradePrice, collapseTradePrices,
  renderEdgeBubbles, ROLLING_RETURN_YEARS, STREAK_VIEWS, niceLogAxisScale, barPct, monthlyChartData,
  type MonthlyChartArgs as ChartArgs, type RechartsCustomizedProps, type BubbleDef, type TradeDot,
  type ReturnsChartPeriod, type PeriodicReturnsRow,
} from '@/components/charts';
import type { AssetsAnnualReturns } from '@/lib/assetStats';
import { toYM, MONTH_ABBR } from '@/lib/dates';
// The shared design system: colours, heat scale, button/field looks, chart helpers, tooltip texts
import {
  CHART_PALETTE, GAIN, LOSS, WINE_LABEL, OLIVE_LABEL, SLATE, SERIES_COLORS, BLACK, INK, ON_BLACK, MUTED, LINE,
  WEIGHT_BAR, HALO, SEG, segBtn, FIELD, BTN_MAIN, BTN_SECOND, ASSET_CLASS_COLORS, CURRENCY_COLORS, isDarkTheme,
  setPhoneBarColours, formatPrice, type MonthlyChartPeriod, METALS_CRYPTO_LABEL, METALS_CRYPTO_CCY, XIRR_HINT,
  CAGR_LOT_HINT, ResponsiveContainer,
} from '@/components/ui';
import { EdoData, EDO_TICKER, MARKETS_EDO, edoWindowReturn, withEdoColumn, edoChainOnRows } from '@/lib/edo';

// ============================================
// UTILITY FUNCTIONS
// ============================================

/** One row of the Price History data, as far as the Shares Held tooltip cares about it. */
type SharesTooltipRow = {
  date: string;
  shares?: number;
  avgBuyPrice?: number;
  investedCapital?: number;
  // Open positions supply this: the FIFO cost-basis average, which is what the Transaction
  // History table shows. It's preferred over avgBuyPrice (dividend-adjusted, and the value
  // behind the dashed line on the price chart) so the tooltip and the table agree.
  fifoAvgPrice?: number | null;
};


/**
 * Custom tooltip for the "Shares Held" bar chart, shared by the Open and Closed sections.
 *
 * WHY A CUSTOM ONE: the default Recharts tooltip can only show series that are actually
 * drawn, and the only drawn series here is the bar (shares). Average buy price and invested
 * capital ride along in the same data row without being plotted, so we reach into
 * payload[0].payload — the whole row behind the hovered bar — and print them ourselves.
 *
 * That's the point of the chart: hover two adjacent months around a purchase or a sale and
 * you can read straight off whether the trade pulled your average cost up or down.
 */
const SharesHeldTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: SharesTooltipRow }[] }) => {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  if (!row) return null;

  // Shares can be fractional (crypto, accumulating ETFs), prices need cents, and capital
  // reads better as a round number with thousand separators.
  const fmtShares = (n?: number) =>
    n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const fmtPrice = (n?: number) =>
    n == null ? '—' : formatPrice(n);
  const fmtCapital = (n?: number) =>
    n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div className="bg-white border border-gray-300 rounded shadow-sm px-3 py-2 text-xs">
      <div className="font-semibold text-gray-700 mb-1">{row.date}</div>
      <div className="flex justify-between gap-4">
        <span className="text-gray-500">Shares held</span>
        <span className="font-medium text-gray-900">{fmtShares(row.shares)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-gray-500">Avg buy price</span>
        <span className="font-medium text-gray-900">
          {fmtPrice(row.fifoAvgPrice !== undefined ? (row.fifoAvgPrice ?? undefined) : row.avgBuyPrice)}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-gray-500">Invested</span>
        <span className="font-medium text-gray-900">{fmtCapital(row.investedCapital)}</span>
      </div>
    </div>
  );
};

/**
 * One individual trade in a position's history — a single buy or a single sell.
 *
 * The source sheets store COMPLETED investments as round trips (one record holding both a
 * purchase and its matching sale), which is the wrong shape for "what did I do, in what order".
 * A TradeEvent is one half of that: a real thing that happened on a real day. The cumulative
 * fields are filled in afterwards by a FIFO pass over the whole sorted list.
 */
type TradeEvent = {
  date: string;
  // 'fee' = a fee paid in UNITS (see UnitFee in lib/fetchData): units leave, cost stays,
  // nothing is realised. Its price is what the units were worth when taken, and its
  // amount is that value, i.e. the fee itself.
  type: 'buy' | 'sell' | 'fee';
  price: number;
  quantity: number;
  commission: number;
  commissionBps: number;
  amount: number;              // what left your pocket on a buy, what came back on a sell
  costPerShare: number;        // internal: what this lot really cost per share, for the FIFO pass
  cumQuantity: number;         // shares still held AFTER this trade
  cumAvgPrice: number | null;  // avg cost of those remaining shares; null when holding none
  cumCost: number;             // what those remaining shares originally COST you
  cumSold: number;             // running total of sale proceeds taken out of this position
  income: number;              // dividends/interest this round trip earned, net of tax (0 for buys)
  cumIncome: number;           // running total of that income — the part of Cum. PnL that isn't price gain
  pnlBasis: number;            // internal: net value this sale actually returned (0 for buys)
  realisedPnl: number | null;  // profit/loss this SALE booked; null on a buy (nothing realised)
  cumRealisedPnl: number;      // running total of realised profit/loss up to and including this row
  stillHeld: boolean;          // true for a purchase whose shares you have NOT sold — outlined in the table
};

/**
 * Runs FIFO ("first in, first out") lot accounting over a sorted list of trades and fills in
 * every cumulative field in place. Shared by the Open and Closed views so both tell the same story.
 *
 * FIFO means a sale retires your OLDEST shares first. That has two visible consequences the
 * table is designed to show: selling can push your average cost UP (because the cheap early
 * shares are the ones that left), and the cumulative cost falls by what the shares originally
 * COST rather than by what you sold them for — the difference being your realised profit.
 */
/**
 * A fee paid in units, applied to a FIFO queue of {shares, price} lots: every lot gives
 * up its share of the units in proportion to its size, and its per-share price rises so
 * that its total cost stays exactly the same. You own fewer units for the same money.
 */
const applyUnitFeeToLots = (lots: { shares: number; price: number }[], units: number) => {
  const held = lots.reduce((s, l) => s + l.shares, 0);
  if (held <= 1e-9) return;
  const keep = Math.max(0, 1 - units / held);
  if (keep <= 1e-12) { lots.length = 0; return; }   // the fee took everything
  for (const l of lots) { l.shares *= keep; l.price /= keep; }
};

/** Fees paid in units from several lots, merged into one entry per date, oldest first. */
const mergeUnitFees = (lists: (UnitFee[] | undefined)[]): UnitFee[] => {
  const byDate = new Map<string, UnitFee>();
  for (const list of lists) for (const f of list ?? []) {
    const m = byDate.get(f.date);
    if (m) { m.qty += f.qty; m.amount += f.amount; }
    else byDate.set(f.date, { date: f.date, qty: f.qty, amount: f.amount });
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * Units a purchase row still holds: what was bought less anything given up to fees paid
 * in units. Pass `upTo` (YYYY-MM-DD) for the count held on that day instead of today.
 */
const heldQty = (t: TransactionRow, upTo?: string): number => t.qty - unitFeeQty(t.unitFees, upTo);

/** A fee paid in units as a Transaction History row; the FIFO pass fills in the rest. */
const unitFeeToEvent = (f: UnitFee): TradeEvent => ({
  date: f.date, type: 'fee',
  price: f.qty > 0 ? f.amount / f.qty : 0,
  quantity: f.qty, commission: 0, commissionBps: 0, amount: f.amount, costPerShare: 0,
  cumQuantity: 0, cumAvgPrice: null, cumCost: 0, cumSold: 0, income: 0, cumIncome: 0,
  pnlBasis: 0, realisedPnl: null, cumRealisedPnl: 0, stillHeld: false,
});

const applyFifoRunningTotals = (events: TradeEvent[]) => {
  const lots: { shares: number; price: number }[] = [];
  let runningPnl = 0;
  // Everything you've taken back OUT of this position, at the price you actually sold for.
  // Read it against Cum. Cost: cost is what the shares you still hold set you back, sold is
  // what the ones you let go actually returned.
  let runningSold = 0;
  // Dividends and interest banked so far. Cum. PnL already contains this; the column exists so
  // you can see how much of the profit came from being paid to hold rather than from the price.
  let runningIncome = 0;

  for (const e of events) {
    // Snapshot the cost basis before this trade touches the queue, so a sale can tell us
    // exactly how much original cost walked out of the door with the shares.
    const costBefore = lots.reduce((s, l) => s + l.shares * l.price, 0);

    if (e.type === 'buy') {
      lots.push({ shares: e.quantity, price: e.costPerShare });
    } else if (e.type === 'fee') {
      // Units leave, cost stays: Cum. Quantity drops, Cum. Cost doesn't, Cum. Avg Price rises
      applyUnitFeeToLots(lots, e.quantity);
    } else {
      let toSell = e.quantity;
      while (toSell > 0 && lots.length > 0) {
        if (lots[0].shares <= toSell) {
          toSell -= lots[0].shares;
          lots.shift();          // whole lot consumed
        } else {
          lots[0].shares -= toSell;
          toSell = 0;
        }
      }
    }

    const totalShares = lots.reduce((s, l) => s + l.shares, 0);
    const totalCost = lots.reduce((s, l) => s + l.shares * l.price, 0);

    // Realised profit/loss: what the sale brought in, minus what those particular shares cost.
    // A buy realises nothing — it converts cash into shares, it doesn't settle a result.
    if (e.type === 'sell') {
      const costReleased = costBefore - totalCost;
      e.realisedPnl = e.pnlBasis - costReleased;
      runningPnl += e.realisedPnl;
      // Proceeds as they actually landed — the same figure the Cost / Sale Value column shows
      // for this row, so the running total is one you can add up by eye down the page.
      runningSold += e.amount;
      runningIncome += e.income;
    }
    e.cumRealisedPnl = runningPnl;
    e.cumSold = runningSold;
    e.cumIncome = runningIncome;

    // Epsilon guard: repeated subtraction of fractional shares leaves floating-point dust,
    // and we'd rather show a clean 0 than 0.0000000002.
    e.cumQuantity = totalShares > 1e-9 ? totalShares : 0;
    e.cumAvgPrice = totalShares > 1e-9 ? totalCost / totalShares : null;
    e.cumCost = totalShares > 1e-9 ? totalCost : 0;
  }
};

/**
 * The Transaction History table, shared by the Open and Closed position views.
 *
 * Deliberately ONE component rather than two copies: these two tables must always agree, and
 * the surest way to make two things agree is to have only one of them.
 */
const TradeHistoryTable = ({ events }: { events: TradeEvent[] }) => (
  <div className="mt-6">
    <h5 className="text-xs font-semibold text-gray-600 mb-2 px-2">Transaction History</h5>
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b-2 border-gray-200">
            <th className="text-left py-1.5 px-2 bg-gray-50">Date</th>
            <th className="text-left py-1.5 px-2 bg-gray-50">Type</th>
            <th className="text-right py-1.5 px-2 bg-gray-50">Price</th>
            <th className="text-right py-1.5 px-2 bg-gray-50">Quantity</th>
            <th className="text-right py-1.5 px-2 bg-gray-50" title="Shares still held after this trade (running position).">Cum. Quantity</th>
            <th className="text-right py-1.5 px-2 bg-gray-50" title="Average cost of the shares still held after this trade, FIFO. A sale can move it, because FIFO retires your oldest lots first.">Cum. Avg Price</th>
            <th className="text-right py-1.5 px-2 bg-gray-50" title="Commission paid, with its size in basis points of the gross trade value (price × quantity). 1 bp = 0.01%.">Commission</th>
            <th className="text-right py-1.5 px-2 bg-gray-50" title="Buy: total cost including commission. Sell: proceeds after commission. Fee (units): what the units given up were worth, i.e. the fee.">Cost / Sale Value</th>
            <th className="text-right py-1.5 px-2 bg-gray-50" title="What the shares you still hold originally cost. A sale reduces this by the purchase cost of the shares sold, not by the sale proceeds.">Cum. Cost</th>
            <th className="text-right py-1.5 px-2 bg-gray-50" title="Running total of what you have sold, at the prices you actually got (proceeds after commission). Read against Cum. Cost: what you still hold cost you X, and what you let go returned Y.">Cum. Sold</th>
            <th className="text-right py-1.5 px-2 bg-gray-50" title="Dividends and interest collected on the shares you have sold, net of tax. This is ALREADY part of Cum. PnL — it tells you how much of the profit came from being paid to hold rather than from the price moving. Income on shares you still hold is not counted, because nothing is realised until you sell.">Income</th>
            <th className="text-right py-1.5 px-2 bg-gray-50" title="Running total of realised profit/loss, with this sale's own contribution in brackets. Realised = what the sale returned (including dividends received and any tax paid) less the original cost of the shares sold. Buys realise nothing, so the total is carried forward in grey. The final row equals this position's total profit.">Cum. PnL</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, idx) => {
            // Draw a still-held row as a closed RECTANGLE. In a border-collapse table an
            // `outline` on the <tr> only paints the horizontal edges, giving a line above and
            // below rather than a box. The reliable way is to border the CELLS instead:
            // top+bottom on every cell, left on the first, right on the last.
            const box  = e.stillHeld ? ' border-y border-black' : '';
            const boxL = e.stillHeld ? ' border-l border-black' : '';
            const boxR = e.stillHeld ? ' border-r border-black' : '';
            return (
            <tr
              key={`${e.date}-${e.type}-${idx}`}
              className={`border-b border-gray-100 ${e.type === 'buy' ? 'bg-green-50' : e.type === 'fee' ? 'bg-gray-50' : 'bg-red-50'}`}
            >
              <td className={`py-1.5 px-2 font-mono${box}${boxL}`}>{e.date}</td>
              <td
                className={`py-1.5 px-2 font-medium ${e.type === 'buy' ? 'text-green-700' : e.type === 'fee' ? 'text-gray-500' : 'text-red-700'}${box}`}
                title={e.type === 'fee' ? 'A fee paid by giving up units instead of cash. Units leave, the cost stays, so the average cost per unit rises. Nothing is realised.' : undefined}
              >
                {e.type === 'buy' ? 'Buy' : e.type === 'fee' ? 'Fee (units)' : 'Sell'}
              </td>
              <td className={`text-right py-1.5 px-2 font-mono${box}`}>
                {formatPrice(e.price)}
              </td>
              <td className={`text-right py-1.5 px-2${box}`}>
                {/* A fee's units are shown as leaving, the way they reduce Cum. Quantity */}
                {e.type === 'fee' ? '−' : ''}{e.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </td>
              <td className={`text-right py-1.5 px-2 font-medium${box}`}>
                {e.cumQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </td>
              <td className={`text-right py-1.5 px-2 font-mono font-medium${box}`}>
                {e.cumAvgPrice != null
                  ? formatPrice(e.cumAvgPrice)
                  : '—'}
              </td>
              <td className={`text-right py-1.5 px-2 font-mono whitespace-nowrap${box}`}>
                {e.commission.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                <span className="text-gray-500"> ({e.commissionBps.toFixed(0)}bps)</span>
              </td>
              <td className={`text-right py-1.5 px-2 font-mono font-medium${box}`}>
                {/* A fee is small, so it keeps its cents; buys and sells round to whole units */}
                {e.type === 'fee'
                  ? e.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : e.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </td>
              <td className={`text-right py-1.5 px-2 font-mono font-medium${box}`}>
                {e.cumCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </td>
              {/* Cumulative proceeds. Greyed until the first sale, since a position you've
                  never sold out of has taken nothing back yet. */}
              <td className={`text-right py-1.5 px-2 font-mono font-medium${e.cumSold > 0 ? '' : ' text-gray-400'}${box}`}>
                {e.cumSold.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </td>
              {/* Income already sits inside Cum. PnL, so it's rendered quietly — it's a
                  breakdown of the profit beside it, not another number to add on. */}
              <td className={`text-right py-1.5 px-2 font-mono${e.cumIncome > 0 ? ' text-teal-700' : ' text-gray-400'}${box}`}>
                {e.cumIncome.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </td>
              {/* Running realised P&L. On a sale it's coloured and carries this sale's own
                  contribution in brackets; on a buy the same total is carried forward in grey,
                  so the column never has holes to scan past. */}
              <td className={`text-right py-1.5 px-2 font-mono whitespace-nowrap ${
                e.realisedPnl == null
                  ? 'text-gray-400'
                  : e.cumRealisedPnl >= 0 ? 'text-green-700 font-medium' : 'text-red-600 font-medium'
              }${box}${boxR}`}>
                {e.cumRealisedPnl >= 0 ? '+' : ''}{e.cumRealisedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                {e.realisedPnl != null && (
                  <span className={e.realisedPnl >= 0 ? 'text-green-600' : 'text-red-500'}>
                    {' '}({e.realisedPnl >= 0 ? '+' : ''}{e.realisedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })})
                  </span>
                )}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
);

// ============================================
// TABLE SORTING (Positions tab)
// ============================================
// Every table in the Positions tab can be re-ordered by clicking a column heading.
// The rule is the same everywhere and deliberately simple:
//
//   1st click  ->  most interesting first: biggest number, or A-Z for words and dates
//   2nd click  ->  the exact reverse
//   3rd click  ->  sorting off, back to the table's own natural order
//
// That third click matters more than it sounds. These tables are already ordered
// thoughtfully - cash is grouped by account, the statement runs newest-first, the
// asset classes follow a fixed house order - so "remove sort" has to restore the
// original arrangement, not leave a leftover ordering behind. That is why sorting
// never touches the underlying arrays: it always produces a re-ordered COPY, and
// clearing the sort simply stops making that copy.

/** Which column a table is sorted by, and in which direction. `null` = not sorted at all. */
type TableSortState = { col: string; dir: 'asc' | 'desc' } | null;

/** One sort state per table, looked up by a short table id such as 'positionsOpen'. */
type TableSortMap = Record<string, TableSortState>;

/** The kinds of value a column can be sorted on. null/undefined means "this cell is empty". */
type SortValue = string | number | null | undefined;

/**
 * The text comparer, built once and reused — the same lesson as PRICE_FORMATTERS above.
 *
 * WHY NOT JUST localeCompare: `a.localeCompare(b, undefined, {...})` builds a fresh
 * Intl.Collator on EVERY comparison, and a sort makes thousands of them. Measured on the
 * 280-row cash Statement: 21ms of collator construction per sort, versus 0.8ms reusing
 * one — so sorting that table by Date cost ~37ms of every single repaint, which is more
 * than two dropped frames each time anything on the page changed. Same ordering either
 * way (verified identical on the real data before and after).
 *
 * numeric: true sorts "Item 2" before "Item 10" instead of lexically; sensitivity: 'base'
 * makes it case- and accent-insensitive, so "DBS" and "dbs" sit together rather than in
 * two separate blocks. ISO dates (YYYY-MM-DD) sort chronologically as plain text.
 */
const SORT_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Work out the next sort state for a column, following the three-click cycle above.
 *
 * `firstDir` is what the FIRST click should do: 'desc' for numbers (biggest first,
 * which is what you want from a PnL or Weight column) and 'asc' for words and dates
 * (A-Z and oldest-first, which is what anyone expects from a name column).
 */
const nextTableSort = (current: TableSortState, col: string, firstDir: 'asc' | 'desc'): TableSortState => {
  // A different column than the one currently sorted: start its cycle from the beginning.
  if (!current || current.col !== col) return { col, dir: firstDir };
  // Same column, still showing the first direction: click two flips it.
  if (current.dir === firstDir) return { col, dir: firstDir === 'desc' ? 'asc' : 'desc' };
  // Same column, already reversed: click three clears the sort entirely.
  return null;
};

/**
 * Return a re-ordered COPY of `rows` according to `sort`. Returns the original array
 * untouched when nothing is sorted, so an unsorted table costs nothing.
 *
 * `accessors` maps a column id to a function that pulls the sortable value out of a row,
 * so the number the table displays and the number it sorts on can never drift apart.
 *
 * Two behaviours worth knowing about:
 *  - Empty cells (null, undefined, '', NaN) always sink to the bottom, whichever
 *    direction you sort in. A position with no XIRR does not have "the smallest XIRR";
 *    it has no answer, and parking it at the top of a descending sort would be a lie.
 *  - Ties keep their original relative order (a "stable" sort), so sorting by a column
 *    full of repeats - an account name, say - leaves the rest of the order alone.
 */
function sortTableRows<T>(rows: T[], sort: TableSortState, accessors: Record<string, (row: T) => SortValue>): T[] {
  if (!sort) return rows;
  const read = accessors[sort.col];
  if (!read) return rows;                       // unknown column id: leave the table alone
  const sign = sort.dir === 'asc' ? 1 : -1;
  const isEmpty = (v: SortValue) =>
    v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v));
  // Decorate each row with its original position, so ties can fall back to it.
  return rows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => {
      const va = read(a.row);
      const vb = read(b.row);
      const aEmpty = isEmpty(va);
      const bEmpty = isEmpty(vb);
      if (aEmpty || bEmpty) return aEmpty && bEmpty ? a.idx - b.idx : aEmpty ? 1 : -1;
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : SORT_COLLATOR.compare(String(va), String(vb));   // see SORT_COLLATOR for why not localeCompare
      return cmp !== 0 ? cmp * sign : a.idx - b.idx;
    })
    .map(entry => entry.row);
}

/**
 * A clickable table heading.
 *
 * It sits exactly where the plain <th> it replaces sat, with the same light-grey fill and
 * the same padding. The only additions are a pointer cursor, a darker grey fill while that
 * column is the one doing the sorting, and a small arrow saying which way round it is.
 * An unsorted column shows a faint double arrow, which is the hint that the header is
 * clickable at all.
 */
const SortableTh = ({
  col, sort, onSort, align = 'right', numeric = true, style, title, children, className = '',
}: {
  col: string;                                          // this column's id, matching its accessor
  sort: TableSortState;                                 // the whole table's current sort
  onSort: (col: string, firstDir: 'asc' | 'desc') => void;
  align?: 'left' | 'right';                             // must match the body cells' alignment
  numeric?: boolean;                                    // false for words and dates
  style?: React.CSSProperties;
  title?: string;
  children: React.ReactNode;
  className?: string;                                   // extra classes, e.g. "max-md:hidden" for a column phones skip
}) => {
  const active = sort?.col === col;
  // Numbers start biggest-first; words and dates start A-Z / oldest-first.
  const firstDir: 'asc' | 'desc' = numeric ? 'desc' : 'asc';
  return (
    <th
      onClick={() => onSort(col, firstDir)}
      // Keyboard equivalent of the click, plus aria-sort so a screen reader announces
      // "sorted descending" rather than reading a heading that silently reorders the
      // table under it. Space would otherwise scroll the page, hence preventDefault.
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(col, firstDir); }
      }}
      aria-sort={active ? (sort!.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
      style={style}
      title={title}
      className={`relative ${align === 'left' ? 'text-left' : 'text-right'} py-2 px-2 cursor-pointer select-none transition-colors ${
        // A <th> is already bold by default, so the active state is a darker fill and a darker
        // ink — adding a font weight here would actually make it LIGHTER than its neighbours.
        active ? 'bg-gray-200 text-slate-900' : 'bg-gray-100 hover:bg-gray-200'
      } ${className}`}
    >
      {/* The label is plain text, free to wrap onto a second line exactly as the original
          headers did ("Total / Invested").
          The arrow is deliberately taken OUT of the layout: it sits absolutely in the 8px of
          right-hand padding every header already has, so it costs zero width. The first
          version put it beside the label and stopped the label wrapping, which added up to
          12px to seven columns of Open Positions — 221px in all — and pushed a table that
          used to fit its card exactly into scrolling sideways. At 8px the glyph is 7px wide,
          which leaves at least 1px of clearance from the text in the tightest column.
          aria-hidden because aria-sort on the <th> already tells a screen reader the state;
          otherwise it would also read out "up down arrow" on every heading. */}
      {children}
      <span
        aria-hidden="true"
        className={`absolute right-0 top-1/2 -translate-y-1/2 ${active ? 'text-slate-700' : 'text-gray-300'}`}
        style={{ fontSize: 8, lineHeight: 1 }}
      >
        {active ? (sort!.dir === 'desc' ? '▼' : '▲') : '⇅'}
      </span>
    </th>
  );
};

// ============================================
// TYPE DEFINITIONS
// ============================================
// TypeScript interfaces describe the "shape" of our data.
// Think of them as blueprints that ensure we use data correctly.

// ============================================
// MAIN COMPONENT
// ============================================

// ---------------------------------------------------------------------------
// FX DATA SANITY CHECK
// ---------------------------------------------------------------------------
// The price sheet stores some exchange rates TWICE over. SGD/USD, for instance, is
// there as its own SGDUSD column and also implicitly as SGDPLN / USDPLN, because
// every conversion routes through PLN. Two roads to the same number means the sheet
// can be checked against itself: where the two roads disagree by more than rounding
// noise, one of those columns is wrong, and every value converted with it is junk.
//
// This matters because a bad FX column is invisible in the UI — the numbers still
// look like numbers. It shows up as a currency "move" that never happened.
//
// Each entry names a direct column and the two xxxPLN columns that should reproduce
// it. Add a row here if the sheet ever gains another redundant pair.
const FX_CROSS_CHECKS: { direct: string; numerator: string; denominator: string }[] = [
  { direct: 'SGDUSD', numerator: 'SGDPLN', denominator: 'USDPLN' },
];

// The published CSV carries rates as DISPLAYED in the sheet, i.e. rounded to 2
// decimals. On a number like 0.75 a single step is ~1.3%, so small gaps are normal
// and expected; only a gap well clear of that means the data is genuinely wrong.
//
// Why 3% and not something tighter: the check divides three separately sourced
// numbers, and each can sit ~1% away from another provider's rate purely because of
// when in the day it was sampled. Those differences compound, so the honest noise
// floor is around 2%. Verified against the NBP official fixing on 2026-08-02: at 2%
// this flagged two 2011-2012 rows whose columns were each within 1.6% of NBP — real
// data, false alarm. A permanently-lit warning is worse than none, because you learn
// to ignore it. 3% still catches genuine corruption by a mile (the SGDPLN column was
// out by 5-9% at year-ends, and up to 28.7% on individual rows).
const FX_CROSS_CHECK_TOLERANCE = 3; // percent

// A per-row tolerance alone isn't enough, because a single volatile day can breach any
// threshold honestly: on 2012-06-29 the zloty rallied hard through the afternoon, so a
// closing rate legitimately sits 1.6% from NBP's 11:00 fixing, and three such columns
// compound past 3%. Raising the tolerance until that goes quiet would just blind the
// check. Instead, only report failures that look SYSTEMATIC (a pattern across rows) or
// SEVERE (one row so far out it can't be a timing difference). Corrupt data trips both
// — the 12-month-shifted SGDPLN column failed 140 rows and peaked at 28.7%.
const FX_MIN_BAD_ROWS = 3;      // isolated one-off days are timing noise, not corruption
const FX_SEVERE_GAP = 10;       // percent — no sampling difference explains this

interface FxDataIssue {
  label: string;      // e.g. "SGDPLN / USDPLN vs SGDUSD"
  rows: number;       // how many rows disagree
  total: number;      // how many rows could be checked at all
  firstDate: string;  // first disagreeing row
  lastDate: string;   // last disagreeing row
  worstPct: number;   // largest disagreement seen, in %
}

/**
 * Runs every FX_CROSS_CHECKS entry over the price data and reports the failures.
 * A pure function of the data — no UI, no side effects — so it is easy to reason
 * about and cheap to re-run whenever the sheet reloads.
 *
 * Note it deliberately does NOT guess which of the two columns is at fault: the
 * sheet can only tell us they contradict each other, not which one is lying.
 */
const findFxDataIssues = (rows: AssetRow[] | null): FxDataIssue[] => {
  if (!rows || rows.length === 0) return [];
  const issues: FxDataIssue[] = [];

  for (const check of FX_CROSS_CHECKS) {
    let bad = 0, total = 0, worst = 0;
    let first = '', last = '';

    for (const row of rows) {
      const direct = Number(row[check.direct]);
      const numerator = Number(row[check.numerator]);
      const denominator = Number(row[check.denominator]);
      // Skip rows where any of the three is missing — a gap is not a contradiction
      if (!(direct > 0) || !(numerator > 0) || !(denominator > 0)) continue;
      total++;

      const gap = Math.abs((numerator / denominator) / direct - 1) * 100;
      if (gap > FX_CROSS_CHECK_TOLERANCE) {
        bad++;
        if (!first) first = row.date;
        last = row.date;
        if (gap > worst) worst = gap;
      }
    }

    // Only raise it if the failures are systematic or severe (see the constants above)
    if (bad >= FX_MIN_BAD_ROWS || worst > FX_SEVERE_GAP) {
      issues.push({
        label: `${check.numerator} / ${check.denominator} vs ${check.direct}`,
        rows: bad,
        total,
        firstDate: first,
        lastDate: last,
        worstPct: worst,
      });
    }
  }

  return issues;
};




const PortfolioBacktester = () => {
  // ----------------------------------------
  // STATE VARIABLES
  // ----------------------------------------
  // State = data that can change over time. When state changes, React re-renders the UI.

  // Data loading states
  const [isConnected, setIsConnected] = useState(false);      // Do we have data loaded?
  const [isLoading, setIsLoading] = useState(true);           // Are we currently loading?
  const [loadingMessage, setLoadingMessage] = useState('');   // Status message to show user
  // When the app last finished pulling the sheet successfully (shown at the bottom of the menu)
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);

  // The actual data
  const [assetData, setAssetData] = useState<AssetRow[] | null>(null);  // Historical price data
  const [availableAssets, setAvailableAssets] = useState<string[]>([]); // List of asset names
  const [presetPortfolios, setPresetPortfolios] = useState<PresetPortfolio[]>([]); // Ready-made portfolios (Portfolios sheet)
  // EDO bonds (EDO sheet): every series' terms and value grid. null until loaded, or if the tab failed.
  const [edoData, setEdoData] = useState<EdoData | null>(null);
  const [assetLookup, setAssetLookup] = useState<AssetLookup[]>([]);    // Lookup table (ticker -> name)

  // ---- The one place that knows some assets have no single price history ----
  // EDO's path depends on WHEN you buy it (lib/edo.ts): a window starting in 2015 holds the bond
  // sold then, not a slice of one chain begun in 2009. Every window calculation asks these instead
  // of special-casing EDO, so a new start-dependent asset — or a new window view — only needs
  // wiring here.
  //   isStartDependent(t)        does this ticker's price path depend on the window's start?
  //   windowPrices(t, start, end) the start/end prices of a window bought fresh at `start`, and
  //                               its return in % (use `ret`, not endPrice ÷ startPrice: the
  //                               division drifts in floating point, so 6.75 would print as 6.7):
  //                               undefined = an ordinary ticker (read its column as usual),
  //                               null = no price for that window.
  //   rowsForWindow(rows, tickers, start)  price rows with any start-dependent column among
  //                               `tickers` re-drawn from `start` (other rows/columns untouched).
  const isStartDependent = (ticker: string): boolean => ticker === EDO_TICKER && !!edoData;
  const windowPrices = (ticker: string, start: string, end: string): { startPrice: number; endPrice: number; ret: number } | null | undefined => {
    if (!isStartDependent(ticker)) return undefined;
    const r = edoWindowReturn(edoData!, start, end);
    return r === null ? null : { startPrice: 100, endPrice: 100 + r, ret: r };
  };
  const rowsForWindow = (rows: AssetRow[], tickers: string[], start: string): AssetRow[] =>
    (edoData && tickers.some(isStartDependent) ? withEdoColumn(rows, edoData, start) : rows);

  // Cross-check the sheet's FX columns against each other. Recomputed only when the
  // data actually reloads, not on every re-render (it walks every row).
  const fxDataIssues = useMemo(() => findFxDataIssues(assetData), [assetData]);
  // The months a table or chart can end at ("End month" on the Monthly and Graphs tabs): the last
  // date of each month in the data, newest first, labelled "Oct26"; "" = Latest. Shared by the
  // desktop dropdowns and the phone boxes, and worked out once per data load.
  const endMonthChoices = useMemo(() => {
    const monthMap = new Map<string, string>();
    for (const row of assetData ?? []) {
      const d = new Date(row.date);
      if (isNaN(d.getTime())) continue;
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      monthMap.set(ym, row.date); // last date wins (data is chronological)
    }
    return [{ value: '', label: 'Latest' }, ...Array.from(monthMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([, date]) => {
        const d = new Date(date);
        return { value: date, label: `${MONTH_ABBR[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(-2)}` };
      })];
  }, [assetData]);
  const [fxWarningDismissed, setFxWarningDismissed] = useState(false);  // hide the banner for this session

  // Portfolio configurations - start with one empty portfolio
  const [portfolios, setPortfolios] = useState<Portfolio[]>([
    { id: 1, name: 'Portfolio 1', assets: [], color: BLACK, nameManuallyEdited: false, inflationAdj: '', baseCurrency: '' }
  ]);

  // Raw text the user is currently typing into the weight / cost boxes, keyed by "portfolioId:assetIndex:field".
  // WHY THIS EXISTS: those boxes are "controlled" — React overwrites them with the stored number on every
  // keystroke. The instant you type a lone "-" (or "1." ), that isn't a valid number yet, so it would snap
  // back to 0 and you could never finish typing "-100". Keeping the raw text here lets the half-typed value
  // sit on screen while the parsed number goes into the portfolio. Cleared when the box loses focus.
  const [numDrafts, setNumDrafts] = useState<{ [key: string]: string }>({});

  // Backtest parameters
  const [startingCapital, setStartingCapital] = useState(1000000);      // How much $ to start with
  const [rebalanceFreq, setRebalanceFreq] = useState('yearly');         // How often to rebalance
  const [withdrawalRate, setWithdrawalRate] = useState('4');             // Annual withdrawal rate %
  const [inflationRate, setInflationRate] = useState('0');               // Annual inflation rate % (compounds withdrawal upward each year)
  const [dateRange, setDateRange] = useState<DateRange>({ start: '', end: '' });  // Full data range
  const [selectedStartDate, setSelectedStartDate] = useState('');       // User-selected start
  const [selectedEndDate, setSelectedEndDate] = useState('');           // User-selected end

  // Results after running backtest
  const [backtestResults, setBacktestResults] = useState<BacktestResult[] | null>(null);

  // Which page is open (the left menu, NAV_VIEWS, lists them in order):
  // 'backtest' = show the portfolio configuration and backtest results
  // 'markets' = market boards from the Lookup tab's Snapshot columns, plus the EDO, Country and Holdings pages
  // 'portfolio' = your real portfolio: Daily NAV, returns by year, profit breakdown
  // 'positions' = Open and Closed positions from the Transactions ledger, plus cash balances
  // 'monthlyPrices' = show monthly price heatmap with SMA signals
  // 'annualReturns' = show a table of yearly returns for all assets in the lookup table
  // 'bestToWorst' = assets ranked by return for a selected year (Ranking), or across years (Return Map)
  // 'graphs' = a grid of price charts, one per asset
  // 'trendFollowing' = compare Buy & Hold vs 10-month SMA trend following strategy
  // 'correlationMatrix' = correlation matrix, head-to-head pairs and the risk/return scatter
  const [activeView, setActiveView] = useState<'backtest' | 'markets' | 'annualReturns' | 'bestToWorst' | 'monthlyPrices' | 'graphs' | 'trendFollowing' | 'correlationMatrix' | 'portfolio' | 'positions'>('backtest');
  // Narrow screens only: is the slide-in navigation drawer open? (Wide screens show the sidebar.)
  const [navOpen, setNavOpen] = useState(false);
  // Phones only: is the slide-up list of the open page's sections open? (Tapping the page's name
  // at the top, "Markets · Equities ▾", opens it.)
  const [sectionSheetOpen, setSectionSheetOpen] = useState(false);
  // Dark mode on/off. Starts as light; the real value is read from <html> once the page is in the
  // browser (app/layout.tsx may already have switched it to dark from the saved choice).
  const [darkMode, setDarkMode] = useState(false);
  useEffect(() => { setDarkMode(isDarkTheme()); setPhoneBarColours(isDarkTheme()); }, []);
  // The left-panel button: flip the class on <html> (which switches app/dark.css on or off),
  // remember the choice for next time, and re-render so the computed heatmap colours update too.
  // Reads the current mode from <html> itself, not from the state above, so a click right after
  // loading (before the state has caught up) still goes the right way.
  const toggleDarkMode = () => {
    const next = !isDarkTheme();
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch { /* private window: just don't remember */ }
    setPhoneBarColours(next);
    setDarkMode(next);
  };
  // Escape closes the drawer, as it would any pop-over. The listener only exists while it's open.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

  // The year selected for the "Best To Worst" ranking view
  // Defaults to null, and will be set to the most recent year when data loads
  const [selectedRankingYear, setSelectedRankingYear] = useState<number | null>(null);

  // Sort column for Assets Annual Returns table
  // Can be a year number, 'Period', 'CAGR', 'CurrDD', '1Y', '2Y', '3Y', '4Y', '5Y', or null (default order)
  const [annualReturnsSortColumn, setAnnualReturnsSortColumn] = useState<string | number | null>(null);
  // Toggle between showing annual returns (%) or end-of-year prices in the Annual tab
  const [annualViewMode, setAnnualViewMode] = useState<'returns' | 'prices'>('returns');

  // Best To Worst view mode: 'year' for annual returns, or a number (1-5) for period returns
  // When null or 'year', the year dropdown is used. When 1-5, shows period returns.
  const [bestToWorstMode, setBestToWorstMode] = useState<'year' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10>('year');

  // Best To Worst "Return Map" — years laid side by side, each column ranked best (top) to worst (bottom).
  // layout: 'ranking' = the original single-year table, 'map' = the multi-year return map
  const [bestToWorstLayout, setBestToWorstLayout] = useState<'ranking' | 'map'>('ranking');
  // How many of the most recent years the map shows
  const [returnMapWindow, setReturnMapWindow] = useState<5 | 10 | 'all'>(10);
  // Which currency the returns are measured in ('native' = each asset's own currency) — also drives the ranking
  const [returnMapCurrency, setReturnMapCurrency] = useState<'native' | 'PLN' | 'USD' | 'EUR' | 'CHF' | 'SGD'>('native');
  // What the cell colour means: one colour per asset, per asset class, or green/red by size of return
  const [returnMapHighlight, setReturnMapHighlight] = useState<'asset' | 'class' | 'return'>('asset');
  // Tickers the user clicked to follow across years (all other cells fade out)
  const [returnMapTracked, setReturnMapTracked] = useState<string[]>([]);

  // Trend Following tab state
  // Selected asset ticker for trend following analysis
  const [selectedTrendAsset, setSelectedTrendAsset] = useState<string>('');
  // Risk-free rate used when out of market (earning cash) and for Sharpe Ratio
  const [trendRiskFreeRate, setTrendRiskFreeRate] = useState(0.02);       // 2% default
  // Commission applied on each signal change (buy or sell)
  const [trendCommission, setTrendCommission] = useState(0.002);          // 0.2% default

  // Correlation Matrix tab state
  // How many years of data to use when calculating correlations (default 3 years)
  const [correlationPeriod, setCorrelationPeriod] = useState(3);

  // Portfolio tab state
  // Annual portfolio summary data from the "Years" sheet in Google Sheets
  const [yearsData, setYearsData] = useState<YearsRow[]>([]);
  // Which currency to display monetary values in (Charts 1 & 2)
  const [portfolioCurrency, setPortfolioCurrency] = useState<'PLN' | 'USD' | 'EUR' | 'CHF' | 'SGD'>('PLN');

  // Markets tab state: which currency the returns are shown in, and which period the bar
  // chart and the summary tiles focus on. Separate from the Portfolio tab's currency on
  // purpose, so switching one tab never quietly changes the other.
  const [marketsCurrency, setMarketsCurrency] = useState<MarketsCurrency>('USD');
  // Markets "Country" page: which country (as its currency code) is shown. Poland by default.
  const [marketsCountry, setMarketsCountry] = useState<Exclude<MarketsCurrency, 'Native'>>('PLN');
  // Which SnapshotCategory the table shows ("Assets", "Factor", ...). '' = the first one in the sheet.
  const [marketsCategory, setMarketsCategory] = useState<string>('');
  // Markets "EDO" page: the series shown in the chart ('' = the oldest still running), which
  // lines it draws (value, inflation since purchase, value after tax), and the table filter.
  const [edoSelected, setEdoSelected] = useState<string>('');
  const [edoLines, setEdoLines] = useState<{ value: boolean; cpi: boolean; tax: boolean }>({ value: true, cpi: false, tax: false });
  const [edoStatusFilter, setEdoStatusFilter] = useState<'all' | 'running' | 'matured'>('all');
  // The "Matured series" section: outcomes after tax or before, and real (after inflation) or nominal.
  const [edoMaturedTax, setEdoMaturedTax] = useState(false);
  const [edoMaturedReal, setEdoMaturedReal] = useState(true);
  const [marketsPeriod, setMarketsPeriod] = useState<MarketsPeriod>('YTD');
  // How many years the trend sparkline covers. Follows the period button for 1Y/3Y/5Y/10Y; the
  // shorter periods (YTD/1M/3M/6M) are too short for a trend, so they leave it where it was.
  const [marketsTrendPeriod, setMarketsTrendPeriod] = useState<'1Y' | '3Y' | '5Y' | '10Y' | 'Max'>('5Y');
  // Markets "Returns" (period returns, the default) or "Stats" (CAGR, Vol, Sharpe, drawdowns and
  // stress-year returns for the selected period) for the asset sections.
  const [marketsView, setMarketsView] = useState<'returns' | 'stats'>('returns');
  // How much history the Macro / Country rate & inflation charts show (shared by all of them).
  const [marketsChartRange, setMarketsChartRange] = useState<'1Y' | '3Y' | '5Y' | '10Y' | 'Max'>('Max');
  // Each view remembers its own period: Stats opens on 5Y (a year or more is what its CAGR / Vol /
  // Sharpe need), Returns keeps whatever was last chosen there. Switching view swaps them over.
  const marketsSavedPeriod = useRef<Record<'returns' | 'stats', MarketsPeriod>>({ returns: 'YTD', stats: '5Y' });
  // Markets "Holdings" page: the one currency every money figure on it is converted into.
  // Its own setting (USD by default), so it never moves the Positions tab's currency.
  const [holdingsCurrency, setHoldingsCurrency] = useState<HoldingsCurrency>('USD');
  // Which year the "Profit Breakdown by Asset" table shows.
  // null = default to the latest available year in yearsData (computed at render time).
  const [breakdownYear, setBreakdownYear] = useState<number | null>(null);
  // Is that table expanded? Collapsed by default: it runs to dozens of rows, and it sits
  // above Statistics and everything below it, so leaving it open means scrolling past a
  // worksheet you only occasionally want to read. The heading and its Show button stay
  // visible, so it is still obvious the detail is there.
  const [breakdownExpanded, setBreakdownExpanded] = useState(false);
  // Which currencies are shown in Charts 3 & 4 (Returns/Growth by Year)
  // PLN selected by default; user can toggle individual currencies on/off
  const [selectedReturnCurrencies, setSelectedReturnCurrencies] = useState<string[]>(['PLN']);

  // Asset filtering state (shared across Annual Returns, Best To Worst, Monthly Prices tabs)
  // These filters let users narrow down which assets are displayed in the tables
  const [selectedAssetTickers, setSelectedAssetTickers] = useState<string[]>([]);
  const [selectedAssetClasses, setSelectedAssetClasses] = useState<string[]>([]);
  const [selectedCurrencies, setSelectedCurrencies] = useState<string[]>([]);
  const [selectedAssetSubcategories, setSelectedAssetSubcategories] = useState<string[]>([]);
  // Tracks which filter dropdown is currently open (null = all closed)
  const [openFilterDropdown, setOpenFilterDropdown] = useState<'assets' | 'assetClass' | 'currency' | 'assetSubcategory' | null>(null);
  // Years to display in the Annual Returns tab (null = all years shown, [] = none selected)
  const [selectedYears, setSelectedYears] = useState<number[] | null>(null);
  // Separate dropdown state for the Years filter (lives outside AssetFilterControls)
  const [yearsDropdownOpen, setYearsDropdownOpen] = useState(false);
  // Ref for click-outside detection on the Years dropdown
  const yearsDropdownRef = useRef<HTMLDivElement>(null);

  // Which portfolio's withdrawal detail table to show (index into backtestResults)
  const [selectedDetailPortfolio, setSelectedDetailPortfolio] = useState(0);
  // Which portfolio's rebalancing table to show (index into backtestResults)
  const [selectedRebalancingPortfolio, setSelectedRebalancingPortfolio] = useState(0);

  // ---- Closed Positions tab state ----
  // Closed round trips, rebuilt from the Transactions ledger by lib/positions.ts (the old
  // "Closed"/"Exit" sheet tabs are gone). "Closed tab" below = the Closed half of Positions.
  const [closedData, setClosedData] = useState<ClosedPositionRow[]>([]);
  // Which asset the user drilled into (empty string = showing summary list)
  const [closedSelectedTicker, setClosedSelectedTicker] = useState<string>('');
  // "Invested Into" comparison: which other asset to compare against
  const [closedInvestedInto, setClosedInvestedInto] = useState<string>('');
  // "Invested From": which sale date to use as the normalization starting point
  const [closedInvestedFrom, setClosedInvestedFrom] = useState<string>('');
  // Chart toggle: start the chart from the first buy date instead of first available price.
  // On by default — the years before you owned the asset are rarely what you came to look at.
  const [closedSinceInvested, setClosedSinceInvested] = useState(true);
  // Chart toggle: end the chart at the last sale date instead of latest available price
  const [closedUntilSold, setClosedUntilSold] = useState(false);
  // Chart toggle: show the all-time high/low price markers. Off by default — they're occasionally
  // useful but they crowd the line, and the labels sit on top of the data.
  const [closedShowMinMax, setClosedShowMinMax] = useState(false);
  // "Graph Ends": optional end date for the price chart (from last sale to last available month)
  const [closedGraphEnds, setClosedGraphEnds] = useState<string>('');
  // "Graph Starts": optional start date for the price chart (from first available data to first buy)
  const [closedGraphStarts, setClosedGraphStarts] = useState<string>('');
  // Toggle: show/hide the average buy price line on the price chart (default: on)
  const [closedShowAvgBuy, setClosedShowAvgBuy] = useState(true);
  // Toggle: show/hide the average sell price line on the price chart (default: on)
  const [closedShowAvgSell, setClosedShowAvgSell] = useState(true);
  // Set of transaction indices that are currently included (checked) in stats/chart.
  // null means "all included" (default) — avoids rebuilding a Set every time you switch assets.
  const [closedIncludedTxns, setClosedIncludedTxns] = useState<Set<number> | null>(null);
  // Ref for the "select all" checkbox so we can set the indeterminate DOM property
  const closedSelectAllRef = useRef<HTMLInputElement>(null);

  // ---- Positions currency conversion ----
  // Currency to convert all position values into (PLN default, '' = no conversion)
  const [positionsCurrency, setPositionsCurrency] = useState<string>('PLN');

  // ---- Open Positions state ----
  // Raw transaction data from the "Data" sheet (purchases, dividends, sales for all assets)
  const [transactionData, setTransactionData] = useState<TransactionRow[]>([]);
  // Open positions, round trips and warnings, replayed from the Transactions ledger once
  // at load. `transactionData` and `closedData` above are filled from this in the shapes
  // the Positions and Portfolio screens already expect, so those tabs needed a new source
  // rather than a rewrite. The raw ledger rows are deliberately NOT kept in state — once
  // the model is built nothing reads them, and holding 1,100+ rows for nothing is waste.
  const [positionsModel, setPositionsModel] = useState<PositionsModel | null>(null);
  const [ledgerWarningDismissed, setLedgerWarningDismissed] = useState(false);  // hide for this session
  // ---- Daily NAV chart state ----
  const [dailyData, setDailyData] = useState<DailyNavRow[]>([]);
  const [dailyNavCurrency, setDailyNavCurrency] = useState<'PLN' | 'USD' | 'SGD' | 'CHF'>('PLN');
  const [dailyNavPeriod, setDailyNavPeriod] = useState<'1Y' | '3Y' | '5Y' | 'Max'>('Max');
  // Which benchmark line is overlaid on the Daily NAV chart ('' = none, the default)
  const [dailyNavBenchmark, setDailyNavBenchmark] = useState<'' | '60/40' | 'World' | 'EQ-MF' | 'EQ-GLD' | '40/FI/MF/GLD'>('');
  // ---- Daily NAV Drawdowns chart state ----
  // Which currencies are shown on the drawdown chart (multi-select; CHF starts off so the
  // chart opens exactly as it did before CHF was added)
  const [ddSelectedCurrencies, setDdSelectedCurrencies] = useState<('PLN' | 'USD' | 'SGD' | 'CHF')[]>(['PLN', 'USD', 'SGD']);
  const [ddPeriod, setDdPeriod] = useState<'1Y' | '3Y' | '5Y' | 'Max'>('Max');
  // Which open-position asset the user drilled into (empty string = showing summary list)
  const [openSelectedTicker, setOpenSelectedTicker] = useState<string>('');
  // Set of purchase transaction indices that are currently included (checked).
  // null = all included (default). Dividends are always included in calculations.
  const [openIncludedTxns, setOpenIncludedTxns] = useState<Set<number> | null>(null);
  // Chart toggle: start the chart from the first buy date. On by default, same reasoning as the
  // closed-position equivalent above.
  const [openSinceInvested, setOpenSinceInvested] = useState(true);
  // Chart toggle: show the all-time high/low price markers. Off by default.
  const [openShowMinMax, setOpenShowMinMax] = useState(false);
  // Toggle: show/hide the avg buy price line (dividend-adjusted) on the price chart
  const [openShowAvgBuy, setOpenShowAvgBuy] = useState(true);
  // "Invested Into" comparison: which other asset to compare against
  const [openInvestedInto, setOpenInvestedInto] = useState<string>('');
  // "Invested From": which buy date to use as the normalization starting point
  const [openInvestedFrom, setOpenInvestedFrom] = useState<string>('');
  // Chart date range controls for open position price chart
  const [openGraphStarts, setOpenGraphStarts] = useState<string>('');
  const [openGraphEnds, setOpenGraphEnds] = useState<string>('');
  // Asset class filter: clicking a row/slice in the breakdown filters Open Positions
  const [openAssetClassFilter, setOpenAssetClassFilter] = useState<string | null>(null);
  // Currency filter: clicking a bar in the currency breakdown filters Asset Class + Open Positions
  const [openCurrencyFilter, setOpenCurrencyFilter] = useState<string | null>(null);
  // Account filter: clicking a bar in the By Account breakdown filters Asset Class, By Currency, and Open Positions
  const [openAccountFilter, setOpenAccountFilter] = useState<string | null>(null);
  // Toggle: when true, each asset is shown under its PortfolioClass from the Lookup tab (blank =
  // its Asset Class; see portfolioClassOf in lib/holdings.ts), so gold, silver and crypto sit
  // together under "Metals & Crypto" — and those are pulled out of their fiat currency bucket
  // into a "M&C" pseudo-currency.
  const [groupMetalsCrypto, setGroupMetalsCrypto] = useState(true);
  // Ref for the "select all" checkbox in open position detail view
  const openSelectAllRef = useRef<HTMLInputElement>(null);

  // ---- Cash section state ----
  // How much money is sitting in each account, in each currency. Built from the same
  // Transactions ledger as the positions above, but answering a different question:
  // not "what do I own?" but "what cash is parked where?". See lib/cash.ts.
  const [cashAccounts, setCashAccounts] = useState<CashAccountBalance[]>([]);
  // Which cash balance the user drilled into, keyed "account|currency".
  // Empty string = showing the summary list, mirroring openSelectedTicker above.
  const [cashSelected, setCashSelected] = useState<string>('');
  // Which row of the drill-down's "Inflows & Outflows by Type" table is expanded
  // (e.g. 'Dividends'). Empty string = none. Cleared whenever a different balance is
  // opened, so you never land on a page showing a category from the previous account.
  const [cashCategory, setCashCategory] = useState<string>('');

  // ---- Positions tab: click-to-sort state ----
  // One entry per table, keyed by a short table id ('positionsOpen', 'cashStatement', ...).
  // A missing key simply means "that table is not sorted", which is why this starts empty
  // and why every table shows its own natural order until you click something.
  // The three-click cycle itself lives in nextTableSort() up at the top of the file.
  const [tableSort, setTableSort] = useState<TableSortMap>({});
  // Advance one table through the cycle: sort descending, sort ascending, then off again.
  const toggleTableSort = (tableId: string, col: string, firstDir: 'asc' | 'desc') => {
    setTableSort(prev => ({ ...prev, [tableId]: nextTableSort(prev[tableId] ?? null, col, firstDir) }));
  };
  // Small convenience so a table only has to name itself once in its JSX: hands back the
  // pair of props (current sort + click handler) that every SortableTh in it needs.
  const sortPropsFor = (tableId: string) => ({
    sort: tableSort[tableId] ?? null,
    onSort: (col: string, firstDir: 'asc' | 'desc') => toggleTableSort(tableId, col, firstDir),
  });

  // ---- Monthly Prices chart state ----
  // Which asset's row is currently selected for chart display (empty = no chart)
  const [monthlySelectedTicker, setMonthlySelectedTicker] = useState<string>('');
  // How many years of data to show in the monthly charts (default: show everything)
  const [monthlyChartPeriod, setMonthlyChartPeriod] = useState<MonthlyChartPeriod>('max');
  // What the main price chart shows:
  //  'sma'       = price + the 10-month moving average (the original, default view)
  //  'drawdown'  = price + the high water mark, with the underwater stretches shaded pink
  //  'vsMarket'  = this asset against world equities, both rebased to 100 at the window start
  //  'price'     = the price line on its own, no overlay — for macro series (interest rates,
  //                GDP) where a 10-month moving average is meaningless
  const [monthlyPriceChartMode, setMonthlyPriceChartMode] =
    useState<'price' | 'sma' | 'drawdown' | 'drawdownReal' | 'vsMarket' | 'inflation'>('sma');
  // Linear (default) or logarithmic Y axis on that same chart. Log is what makes the early
  // years of a big winner readable — see niceLogAxisScale for why.
  const [monthlyPriceChartLog, setMonthlyPriceChartLog] = useState(false);
  // Which currency the selected asset's detail subsection is displayed in.
  // Defaults to the asset's own native currency (set when an asset is clicked),
  // so by default everything shows in the asset's original currency (no conversion).
  // The user can switch to PLN / USD / EUR / CHF / SGD to re-express all stats,
  // charts, and tables below in that currency using the app's FX data.
  const [monthlyDisplayCurrency, setMonthlyDisplayCurrency] = useState<string>('');
  // Which year the "During stress" chart is showing. 2022 by default — the rate shock,
  // the deepest full-year equity drawdown in this data. Deliberately NOT reset when you
  // switch asset, so you can hold a year fixed and click down the list comparing how
  // each holding behaved in it.
  const [stressYear, setStressYear] = useState<number>(2022);
  // Which return period to show in the periodic returns bar chart
  // (Monthly/Quarterly/Annual, or one of the rolling-CAGR views — see ReturnsChartPeriod)
  const [returnsChartPeriod, setReturnsChartPeriod] = useState<ReturnsChartPeriod>('quarterly');
  // Monthly tab statistics table: false = show only the selected asset's row, hiding the
  // IWDA and 50/50 reference rows. Expanded by default, so nothing changes until you click.
  const [monthlyStatsExpanded, setMonthlyStatsExpanded] = useState(true);
  // Which period the BACKTEST tab's returns bar chart shows. Kept separate from
  // returnsChartPeriod above so the two charts don't yank each other around. Defaults to
  // 'annual' — the only view this chart had before it gained the buttons.
  const [backtestReturnsPeriod, setBacktestReturnsPeriod] = useState<ReturnsChartPeriod>('annual');
  // The head-to-head chart sits directly under that one and READS THE SAME PERIOD — one row
  // of buttons drives both, so the two charts can never be showing different periods while
  // stacked on top of each other. Only the pair being compared is its own state.
  // Note the rolling views measure a different quantity to the calendar ones there: the gap
  // between two ANNUALISED returns over one window, so percentage points PER YEAR rather
  // than per period. Its axis, tooltip and footnote all say so rather than leaving it implied.
  const [deltaPortfolioA, setDeltaPortfolioA] = useState(0);
  const [deltaPortfolioB, setDeltaPortfolioB] = useState(1);
  // The Head to Head chart has TWO views behind one toggle. 'gap' is the original
  // difference bars — who won each period. 'correlation' swaps in a rolling-correlation
  // line, which answers the other question: were the two moving together at all?
  // Defaults to 'gap', so the section looks and behaves exactly as it did before.
  const [deltaChartView, setDeltaChartView] = useState<'gap' | 'correlation'>('gap');
  // How many months of history each correlation point looks back over.
  const [correlationWindow, setCorrelationWindow] = useState(12);
  // Period selector for the Graphs tab (separate from Monthly Prices so they don't interfere)
  const [graphsPeriod, setGraphsPeriod] = useState<'1Y' | '2Y' | '3Y' | '4Y' | '5Y' | '10Y' | '15Y' | 'max'>('2Y');
  // End date for the Graphs tab ('' = most recent month in data)
  const [graphsEndDate, setGraphsEndDate] = useState('');
  // Toggle for showing 10-month SMA overlay on all Graphs tab charts
  const [graphsShowSMA, setGraphsShowSMA] = useState(false);

  // PHONES: OPEN WHERE YOU LEFT OFF. An app reopens on the page you last used, with the same
  // choices, instead of starting from the first page every time. So on a phone the open page and
  // its main choices (section, currency, period) are kept in the browser's small storage
  // (localStorage) after every change, and put back when the app opens. Desktop neither saves nor
  // restores anything, so it still always opens on Backtest with the defaults.
  // A saved value that no longer makes sense (a Markets section the sheet dropped, say) is
  // harmless: each page already falls back to its default for a value it doesn't recognise.
  // PHONES: WORKS WITH NO SIGNAL. Installs the service worker (public/sw.js), which keeps the app's
  // own files on the phone so it opens at once, even offline; the data then comes from the saved
  // copy (lib/savedSheet.ts). A phone here = narrow screen AND a touch screen, so a desktop window
  // that happens to be narrow never gets it, and anywhere else it is removed if it was ever there.
  // Only in the published app: on the local dev server it would keep serving yesterday's code.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const phone = isPhoneScreen() && window.matchMedia('(pointer: coarse)').matches;
    if (phone && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* not installed: the app works as before */ });
    } else if (!phone) {
      navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(() => {});
    }
  }, []);

  const phoneMemoryFirstSave = useRef(true);
  // The page an app-icon shortcut asked for ("/?view=positions"), read once when the app opens
  const shortcutView = useRef(typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('view'));
  useEffect(() => {
    // The remembered choices are a phone thing; the shortcut below works at any width (a phone held
    // sideways is wider than a "phone", and a desktop install shows the shortcuts too)
    if (isPhoneScreen()) try {
      const saved = JSON.parse(localStorage.getItem('phoneState') ?? 'null');
      if (saved && typeof saved === 'object') {
        if (saved.view) setActiveView(saved.view);
        if (typeof saved.marketsCategory === 'string') setMarketsCategory(saved.marketsCategory);
        if (saved.marketsCurrency) setMarketsCurrency(saved.marketsCurrency);
        if (saved.marketsView && saved.marketsPeriod) {
          setMarketsView(saved.marketsView);
          setMarketsPeriod(saved.marketsPeriod);
          // Markets parks each view's period here when you switch view, so keep it in step
          marketsSavedPeriod.current[saved.marketsView as 'returns' | 'stats'] = saved.marketsPeriod;
        }
        if (saved.marketsTrendPeriod) setMarketsTrendPeriod(saved.marketsTrendPeriod);
        if (saved.bestToWorstLayout) setBestToWorstLayout(saved.bestToWorstLayout);
        if (saved.portfolioCurrency) setPortfolioCurrency(saved.portfolioCurrency);
        if (saved.positionsCurrency) setPositionsCurrency(saved.positionsCurrency);
        if (saved.holdingsCurrency) setHoldingsCurrency(saved.holdingsCurrency);
        if (saved.dailyNavCurrency) setDailyNavCurrency(saved.dailyNavCurrency);
        if (saved.dailyNavPeriod) setDailyNavPeriod(saved.dailyNavPeriod);
        if (saved.graphsPeriod) setGraphsPeriod(saved.graphsPeriod);
      }
    } catch { /* nothing saved, or storage blocked: open on the defaults */ }
    // Opened from a shortcut on the app icon (press and hold the icon: Portfolio, Positions...,
    // listed in public/manifest.webmanifest as "/?view=portfolio" etc.): that page wins over the
    // remembered one. The "?view=..." is then taken off the address, so it doesn't stick around
    // (it was read once, into shortcutView, so running this again still finds it).
    const fromShortcut = shortcutView.current;
    if (fromShortcut) {
      if (NAV_VIEWS.some(v => v.view === fromShortcut)) {
        setActiveView(fromShortcut as typeof activeView);
        if (fromShortcut === 'bestToWorst') setBestToWorstLayout('ranking');
      }
      window.history.replaceState(null, '', '/');
    }
    // Runs once, when the app opens. NAV_VIEWS is a fixed list, so leaving it out changes nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // Skip the very first run: it happens before the restore above has taken effect, so it would
    // save the defaults over the remembered choices
    if (phoneMemoryFirstSave.current) { phoneMemoryFirstSave.current = false; return; }
    if (!isPhoneScreen()) return;
    try {
      localStorage.setItem('phoneState', JSON.stringify({
        view: activeView, marketsCategory, marketsCurrency, marketsView, marketsPeriod, marketsTrendPeriod,
        bestToWorstLayout, portfolioCurrency, positionsCurrency, holdingsCurrency,
        dailyNavCurrency, dailyNavPeriod, graphsPeriod,
      }));
    } catch { /* private window: just don't remember */ }
  }, [activeView, marketsCategory, marketsCurrency, marketsView, marketsPeriod, marketsTrendPeriod,
      bestToWorstLayout, portfolioCurrency, positionsCurrency, holdingsCurrency,
      dailyNavCurrency, dailyNavPeriod, graphsPeriod]);

  // PHONES: EACH PAGE KEEPS ITS PLACE. Scroll halfway down Positions, look at Markets, come back,
  // and Positions is where you left it, as in other apps (a page not visited yet opens at its top).
  // How: while you scroll, the position is noted against the open page; when another page opens,
  // it is scrolled to the position noted for it. Only kept while the app is open.
  // Desktop doesn't note or move anything.
  const scrollByView = useRef<Partial<Record<typeof activeView, number>>>({});
  const scrollView = useRef(activeView);   // the page the noted positions currently belong to
  useEffect(() => {
    if (!isPhoneScreen()) return;
    const onScroll = () => { scrollByView.current[scrollView.current] = window.scrollY; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // A layout effect runs after the new page is in place but before it is shown, so it opens
  // straight at its spot instead of flashing its top first
  useLayoutEffect(() => {
    if (scrollView.current === activeView) return;
    scrollView.current = activeView;
    if (!isPhoneScreen()) return;
    const target = scrollByView.current[activeView] ?? 0;
    // Charts draw themselves a moment later, so the page may not be tall enough yet to reach the
    // spot: try again a few times over about a third of a second
    let tries = 0;
    const scrollToSpot = () => {
      // 'instant': globals.css makes scrolling smooth by default, which would visibly slide there
      window.scrollTo({ top: target, behavior: 'instant' });
      if (Math.abs(window.scrollY - target) > 2 && ++tries < 6) setTimeout(scrollToSpot, 60);
    };
    scrollToSpot();
  }, [activeView]);
  // Monthly Prices tab: toggle between price view and monthly return (%) view
  const [monthlyViewMode, setMonthlyViewMode] = useState<'prices' | 'returns'>('prices');
  // Monthly Prices tab: end date filter ('' = latest month in data)
  const [monthlyEndDate, setMonthlyEndDate] = useState('');
  // Monthly Prices tab: which column is currently sorted (null = default lookup-table order)
  // Values: 'name', 'month-0'..'month-12', 'sma10', 'signal', 'ticker', 'ret12m', 'dd12m'
  const [monthlySortColumn, setMonthlySortColumn] = useState<string | null>(null);
  // Monthly Prices tab: seasonality screen — selected calendar month (0=Jan..11=Dec, null = off).
  // When set, a ranking card appears sorting the filtered assets by their loss rate in that month.
  const [seasonMonth, setSeasonMonth] = useState<number | null>(null);

  // Close Years dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // A tap inside the phone's slide-up panel isn't "outside": the panel lives elsewhere on the page
      if ((event.target as Element).closest?.('[role="dialog"]')) return;
      if (yearsDropdownRef.current && !yearsDropdownRef.current.contains(event.target as Node)) {
        setYearsDropdownOpen(false);
      }
    };
    if (yearsDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [yearsDropdownOpen]);

  // Manage the "indeterminate" state of the select-all checkbox in the Closed tab.
  // HTML checkbox has three visual states: checked, unchecked, and indeterminate (dash icon).
  // React can't set indeterminate via props — it's a DOM property, so we use a ref.
  useEffect(() => {
    if (closedSelectAllRef.current && closedSelectedTicker) {
      const total = getClosedTransactions(closedSelectedTicker).length;
      const included = closedIncludedTxns === null ? total : closedIncludedTxns.size;
      closedSelectAllRef.current.indeterminate = included > 0 && included < total;
    }
    // closedData is what getClosedTransactions reads: listed so the box also updates after
    // Refresh Data. (The function itself is defined further down, so it can't be listed here.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedIncludedTxns, closedSelectedTicker, closedData]);

  // Same indeterminate checkbox management for the Open positions detail view
  useEffect(() => {
    if (openSelectAllRef.current && openSelectedTicker) {
      const total = getOpenPurchases(openSelectedTicker).length;
      const included = openIncludedTxns === null ? total : openIncludedTxns.size;
      openSelectAllRef.current.indeterminate = included > 0 && included < total;
    }
    // positionsModel is what getOpenPurchases reads: listed so the box also updates after
    // Refresh Data. (The function itself is defined further down, so it can't be listed here.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIncludedTxns, openSelectedTicker, positionsModel]);

  // ----------------------------------------
  // AUTO-LOAD DATA ON MOUNT
  // ----------------------------------------
  // useEffect runs code when the component first appears ("mounts").
  //
  // The ref guard matters: next.config.js sets reactStrictMode, which makes React
  // deliberately run mount effects TWICE in development to surface bugs. Without the
  // guard that fired two full loads, so every sheet was downloaded twice — and Google
  // throttles parallel requests to the same document, so the duplicates did not just
  // waste bandwidth, they slowed the real ones down. Production only mounts once, but
  // there is no reason to do the work twice in development either.
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    loadDataFromSheet();
    // Deliberately runs once, on opening (see above); Refresh Data calls it again by hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------------------
  // DATA LOADING FUNCTIONS
  // ----------------------------------------

  /**
   * Puts one download of the sheet into the app: works out positions and cash from it and stores
   * everything the pages read. Used for every fresh download and, on a phone, for the copy saved
   * on the phone last time (see loadDataFromSheet below).
   * resetSelections: also select every asset, class and currency again (what a load has always
   * done). Off only when a phone swaps its saved copy for the fresh download of the same assets,
   * so a filter tapped in the meantime isn't undone a few seconds later.
   */
  const applySheetData = (parsed: ParsedData, resetSelections: boolean) => {
      const { data, assets, lookup, yearsData: fetchedYearsData, dailyData: fetchedDailyData, ledgerData: fetchedLedgerData, presetPortfolios: fetchedPresets, edo: fetchedEdo } = parsed;

      // ---- Derive positions from the ledger -------------------------------
      // Replay the Transactions tab to work out what is still held, what was sold,
      // and which dividends belong to which shares. Only tickers in the lookup table
      // are reported — anything left out of it is deliberately not an investment we
      // want to see. This is the single source now: the old Open/Exit tabs are gone.
      const allowedTickers = new Set(lookup.map(a => a.ticker));
      const model = buildPositions(fetchedLedgerData, allowedTickers);
      const effectiveTransactions = toTransactionRows(fetchedLedgerData, allowedTickers);
      const effectiveClosed = toClosedPositionRows(model);

      // ---- Derive cash balances from the same ledger ------------------------
      // The Transactions tab is double-entry: every row names the account the money
      // LEFT and the account it ARRIVED at. Replaying that gives a bank statement,
      // and therefore a balance, for each account and currency. `selectVisibleCash`
      // drops accounts closed years ago at zero.
      //
      // Unlike positionsModel above, this DOES keep per-row detail in state: ~1,250
      // movements, about 230 KB. That is deliberate rather than an oversight — the
      // drill-down page renders the statement line by line, so the alternative is
      // holding the raw ledger and recomputing, which costs the same memory and more
      // work. Building it takes well under a millisecond, so it happens once here
      // rather than on render.
      const cash = selectVisibleCash(buildCashAccounts(fetchedLedgerData));

      if (fetchedLedgerData.length === 0) {
        console.warn('Ledger is empty — the Positions tab will have nothing to show');
      } else {
        console.log(`Ledger: ${model.open.length} open, ${closedTickersFrom(model).length} closed, `
          + `${model.roundTrips.length} round trips, ${model.warnings.length} warning(s), `
          + `${cash.length} cash balance(s)`);
      }

      // Update all our state with the new data
      setAssetData(data);
      setAvailableAssets(assets);
      setAssetLookup(lookup);
      setYearsData(fetchedYearsData);
      setPositionsModel(model);
      setCashAccounts(cash);
      setClosedData(effectiveClosed);
      setTransactionData(effectiveTransactions);
      setDailyData(fetchedDailyData);
      setPresetPortfolios(fetchedPresets);
      setEdoData(fetchedEdo);
      setIsConnected(true);

      if (resetSelections) {
        // Initialize filters to "all selected" when data loads
        // This ensures all assets are visible by default
        setSelectedAssetTickers(lookup.map(a => a.ticker));
        setSelectedAssetClasses(Array.from(new Set(lookup.map(a => a.assetClass).filter(Boolean))));
        setSelectedCurrencies(Array.from(new Set(lookup.map(a => a.currency).filter(Boolean))));
        setSelectedAssetSubcategories(['Basic']);
      }

      // Set the date range based on the data
      if (data.length > 0) {
        setDateRange({
          start: data[0].date,
          end: data[data.length - 1].date
        });
      }

  };

  // Phones only: has this visit already looked for the copy saved on the phone? (Only the first
  // load does; pressing Refresh later just downloads.)
  const triedSavedSheetRef = useRef(false);
  // "30 Oct 21:14", the same style as the "Fetched" line in the menu
  const fmtStamp = (d: Date) =>
    `${d.getDate()} ${MONTH_LABELS[d.getMonth()]} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

  /**
   * Fetches fresh data from the Google Sheet.
   * Called automatically on page load and when user clicks "Refresh Data"
   *
   * On a phone, the first load also shows the copy saved on the phone last time while the download
   * runs ("Saved copy from ... · updating..."), then swaps in the fresh data and saves that for
   * next time. If the download fails, the saved copy stays on screen with the error above it.
   * Desktop does exactly what it always did: wait for the download, then show it.
   */
  const loadDataFromSheet = async () => {
    setIsLoading(true);
    setLoadingMessage('Fetching data from Google Sheets...');

    const phone = isPhoneScreen();
    // Start the download first, so reading the saved copy doesn't hold it up
    const freshRequest = fetchSheetData();
    let freshSettled = false;
    // (The second handler also stops the browser warning about a failure nobody is waiting for yet;
    // the failure itself is still caught below.)
    freshRequest.then(() => { freshSettled = true; }, () => { freshSettled = true; });

    let savedShown: { data: ParsedData; savedAt: Date } | null = null;
    if (phone && !triedSavedSheetRef.current) {
      triedSavedSheetRef.current = true;
      const saved = await readSavedSheet();
      // Skip it if the download already beat it (it never should, but stale must not win)
      if (saved && !freshSettled) {
        try {
          applySheetData(saved.data, true);
          setLastFetchedAt(saved.savedAt);
          setLoadingMessage(`Saved copy from ${fmtStamp(saved.savedAt)} · updating…`);
          savedShown = saved;
        } catch (err) {
          // A saved copy the current code can't read: ignore it and wait for the download
          console.warn('Saved copy of the sheet could not be shown:', err);
        }
      }
    }

    try {
      const parsed = await freshRequest;
      const { data, assets, edo: fetchedEdo } = parsed;
      // Swapping the saved copy for fresh data of the SAME assets: keep the selections as they are
      const sameAssets = savedShown !== null
        && savedShown.data.lookup.map(a => a.ticker).join('|') === parsed.lookup.map(a => a.ticker).join('|');
      applySheetData(parsed, !sameAssets);

      // A failed EDO tab is not fatal, but it must not be silent: it also takes away the price of
      // any EDO bond held in Positions / Holdings. (Shown as a third status line.)
      setLoadingMessage(`Loaded ${assets.length} assets, ${data.length} data points${fetchedEdo ? '' : ', EDO tab missing: Refresh'}`);
      setLastFetchedAt(new Date());
      if (phone) saveSheet(parsed); // in the background; nothing waits for it
    } catch (error) {
      console.error('Failed to load data:', error);
      // Phones: no signal at all is not an error in the app, so it gets a calm grey "Offline"
      // line instead of a red error (the status line turns red only when it says "Error"), and
      // the data comes back by itself once the phone is online again (see the effect below).
      // "No signal" = the phone says it's offline, or the sheet never answered at all (lib/fetchData.ts
      // gives up with a SheetUnreachableError whose noAnswer is true, e.g. Wi-Fi connected but no
      // internet); anything else, e.g. Google answering with a server fault, is an error.
      const offline = phone && (!navigator.onLine || error instanceof TypeError
        || (error instanceof SheetUnreachableError && error.noAnswer));
      if (savedShown) {
        // Keep the saved copy on screen rather than an empty page, and say plainly it is old
        setLoadingMessage(offline
          ? `Offline · saved copy from ${fmtStamp(savedShown.savedAt)}`
          : `Error updating, showing the copy saved ${fmtStamp(savedShown.savedAt)}`);
      } else if (phone && assetData && lastFetchedAt) {
        // Phone, pulled down to refresh with no signal: keep what's on screen (desktop still
        // clears the page on a failed refresh, as it always has)
        setLoadingMessage(offline
          ? `Offline · data from ${fmtStamp(lastFetchedAt)}`
          : `Error updating, showing data from ${fmtStamp(lastFetchedAt)}`);
      } else {
        // (Phone with no signal and nothing to show yet, e.g. the very first opening: "Offline"
        // too, so the data still arrives by itself once there is a signal. Pulling down can't be
        // used then, as there is no page to pull.)
        setLoadingMessage(offline
          ? 'Offline · the data will load when there is a signal'
          : `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        setIsConnected(false);
      }
    }

    setIsLoading(false);
  };

  // PHONES: PULL DOWN TO REFRESH. At the top of a page, drag down and let go: a round arrow follows
  // your finger down from the top edge, and once it has come far enough, letting go fetches fresh
  // data (the arrow spins until it's in). Letting go sooner just slides it back.
  // The arrow is moved by setting its style directly rather than through React state: this
  // component is very large, and redrawing all of it on every finger movement would stutter.
  // The browser's own pull-to-refresh (which reloads the whole page) is switched off in globals.css.
  const pullIndicatorRef = useRef<HTMLDivElement>(null);
  const pullSpinningRef = useRef(false);
  // The latest versions of these, for the touch handlers below (set up once, so they'd otherwise
  // keep seeing the values from the very first render)
  const pullRefreshRef = useRef<() => void>(() => {});
  pullRefreshRef.current = () => { if (!isLoading) loadDataFromSheet(); };

  // PHONE TURNED SIDEWAYS: every chart grows to the screen's height (the ResponsiveContainer
  // stand-in at the top of this file), which moves
  // everything on the page, so turning the phone would lose the chart you were reading. So: each
  // time the page comes to rest after scrolling, note the chart nearest the middle of the screen
  // (only then, not on every scrolled frame: measuring every chart, 32 of them on Graphs, while the
  // page moves is wasted work); when the phone turns, bring that chart back to the middle once the
  // page has settled into its new shape. Turning back upright does the same. Phones only (a touch
  // screen whose short side is a phone's).
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches || Math.min(window.screen.width, window.screen.height) >= 768) return;
    let focus: Element | null = null;
    let frozenUntil = 0; // after a turn, the page jumps about for a moment: don't re-pick then
    let wasLandscape = window.innerWidth > window.innerHeight;
    const pick = () => {
      if (Date.now() < frozenUntil) return;
      const mid = window.innerHeight / 2;
      let best: Element | null = null, bestDist = Infinity;
      document.querySelectorAll('.recharts-responsive-container').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.height === 0 || r.bottom < 0 || r.top > window.innerHeight) return;
        const dist = Math.abs((r.top + r.bottom) / 2 - mid);
        if (dist < bestDist) { bestDist = dist; best = el; }
      });
      focus = best;
    };
    // Pick once the scrolling has paused for 150 ms
    let restTimer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(restTimer);
      restTimer = setTimeout(pick, 150);
    };
    // "resize" comes before the scrolling the turn causes, so `focus` is still the chart from before
    const onResize = () => {
      const landscape = window.innerWidth > window.innerHeight;
      if (landscape === wasLandscape) return;
      wasLandscape = landscape;
      const el = focus;
      frozenUntil = Date.now() + 700;
      if (el) setTimeout(() => { if (el.isConnected) el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }); }, 350);
    };
    pick();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(restTimer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // PHONES: BACK ONLINE = FRESH DATA. While the status line says "Offline", the moment the phone
  // gets a signal again the data is fetched by itself, without having to pull the page down.
  const offlineRef = useRef(false);
  offlineRef.current = loadingMessage.startsWith('Offline');
  useEffect(() => {
    if (!isPhoneScreen()) return;
    const onOnline = () => { if (offlineRef.current) pullRefreshRef.current(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);
  const pullBlockedRef = useRef(false);
  pullBlockedRef.current = navOpen || !isConnected;
  useEffect(() => {
    if (!isPhoneScreen()) return;
    const PULL_TO_REFRESH = 64; // how far (in px) the arrow must come down before letting go refreshes
    let startX = 0, startY = 0, pulling = false, distance = 0;
    // Place the arrow: "distance" px down from just above the screen, turning as it comes
    const place = (d: number, animate: boolean) => {
      const el = pullIndicatorRef.current;
      if (!el) return;
      el.style.transition = animate ? 'transform 0.2s, opacity 0.2s' : 'none';
      el.style.transform = `translateY(${d}px)`;
      el.style.opacity = String(Math.min(1, d / PULL_TO_REFRESH));
      const icon = el.querySelector('svg');
      if (icon && !pullSpinningRef.current) icon.style.transform = `rotate(${d * 4}deg)`;
    };
    const onStart = (e: TouchEvent) => {
      // Only a one-finger drag that starts with the page scrolled right to the top
      // (and not while a slide-up choice panel is open: components/PhoneSheet.tsx sets the flag)
      pulling = window.scrollY <= 0 && e.touches.length === 1 && !pullBlockedRef.current && !pullSpinningRef.current
        && !document.body.dataset.sheetOpen;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      distance = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      // A sideways swipe (a table or a row of buttons scrolling) or a scroll up is not a pull
      if (distance === 0 && (dy <= 0 || Math.abs(dx) > dy)) { pulling = false; return; }
      distance = Math.max(0, Math.min(dy * 0.5, 100)); // the arrow moves at half the finger's speed
      place(distance, false);
    };
    const onEnd = () => {
      if (!pulling) return;
      pulling = false;
      if (distance >= PULL_TO_REFRESH) {
        // Park it in view and spin until the data is in (see the effect below)
        pullSpinningRef.current = true;
        const icon = pullIndicatorRef.current?.querySelector('svg');
        if (icon) { icon.style.transform = ''; icon.classList.add('animate-spin'); }
        place(PULL_TO_REFRESH, true);
        pullRefreshRef.current();
      } else {
        place(0, true);
      }
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);
  // Once the refresh has finished, stop the arrow spinning and slide it away
  useEffect(() => {
    if (isLoading || !pullSpinningRef.current) return;
    pullSpinningRef.current = false;
    const el = pullIndicatorRef.current;
    if (!el) return;
    el.querySelector('svg')?.classList.remove('animate-spin');
    el.style.transition = 'transform 0.2s, opacity 0.2s';
    el.style.transform = 'translateY(0px)';
    el.style.opacity = '0';
  }, [isLoading]);

  // ----------------------------------------
  // COMPUTED VALUES
  // ----------------------------------------

  // The actual date range to use (user selection or full range)
  const selectedDateRange = {
    start: selectedStartDate || dateRange.start,
    end: selectedEndDate || dateRange.end
  };

  /**
   * Filters available assets to only those that:
   * 1. Are in the lookup table (user-defined list of allowed assets)
   * 2. Have data at the selected start date
   * This prevents users from selecting assets that aren't in the lookup or didn't exist yet.
   */
  /**
   * Returns ALL assets from the lookup table, regardless of date range.
   * Assets are no longer filtered by date — instead, the start date auto-adjusts
   * to the shortest history among selected portfolio assets.
   */
  const getAvailableAssetsForDateRange = (): string[] => {
    const lookupTickers = assetLookup.map(l => l.ticker);
    // Use lookup table order (not availableAssets order) so dropdown matches the sheet
    return lookupTickers.length > 0
      ? lookupTickers.filter(ticker => availableAssets.includes(ticker))
      : availableAssets;
  };

  const availableAssetsFiltered = getAvailableAssetsForDateRange();

  /**
   * Finds the first date where an asset has valid (non-zero) price data.
   * Used to determine the earliest possible start date for a portfolio containing this asset.
   */
  const getAssetFirstAvailableDate = (ticker: string): string | null => {
    if (!assetData || !ticker) return null;
    // assetData is sorted chronologically, so the first match is the earliest date
    for (const row of assetData) {
      if (row[ticker] && Number(row[ticker]) > 0) return row.date;
    }
    return null;
  };

  /**
   * Looks at ALL assets selected across ALL portfolios and finds the one with
   * the shortest history (latest first-available date). Returns the limiting
   * asset's name and its first date, so we can auto-set the start date and
   * show which asset is the bottleneck.
   */
  const getLimitingAsset = (): { date: string; assetName: string } | null => {
    if (!assetData || assetData.length === 0) return null;

    let latestFirstDate = '';
    let limitingTicker = '';

    // Check every asset in every portfolio
    for (const portfolio of portfolios) {
      for (const pa of portfolio.assets) {
        if (!pa.asset) continue;
        const firstDate = getAssetFirstAvailableDate(pa.asset);
        if (firstDate && firstDate > latestFirstDate) {
          latestFirstDate = firstDate;
          limitingTicker = pa.asset;
        }
      }
    }

    if (!limitingTicker) return null;

    const assetInfo = assetLookup.find(a => a.ticker === limitingTicker);
    return { date: latestFirstDate, assetName: assetInfo?.name || limitingTicker };
  };

  /**
   * Auto-adjusts the start date to match the shortest history among all
   * selected portfolio assets. Called whenever assets are added/changed/removed.
   */
  const autoAdjustStartDate = (updatedPortfolios: Portfolio[]) => {
    if (!assetData || assetData.length === 0) return;

    let latestFirstDate = '';

    for (const portfolio of updatedPortfolios) {
      for (const pa of portfolio.assets) {
        if (!pa.asset) continue;
        const firstDate = getAssetFirstAvailableDate(pa.asset);
        if (firstDate && firstDate > latestFirstDate) {
          latestFirstDate = firstDate;
        }
      }
    }

    // If we found a limiting date, update the start date
    if (latestFirstDate) {
      setSelectedStartDate(latestFirstDate);
    }
  };

  /**
   * Gets the friendly display name for a ticker from the lookup table.
   * Returns "TICKER - Asset Name" format, or just the ticker if not found.
   */
  const getAssetDisplayName = (ticker: string): string => {
    const lookup = assetLookup.find(l => l.ticker === ticker);
    return lookup ? `${ticker} - ${lookup.name}` : ticker;
  };

  // ----------------------------------------
  // ASSET FILTERING FUNCTIONS
  // ----------------------------------------
  // These functions support the multi-select filters in Annual Returns, Best To Worst, and Monthly Prices tabs

  /**
   * Gets unique asset classes from the lookup table (sorted alphabetically).
   * Used to populate the Asset Class filter dropdown.
   */
  const getUniqueAssetClasses = (): string[] => {
    return Array.from(new Set(assetLookup.map(a => a.assetClass).filter(Boolean))).sort();
  };

  /**
   * Gets unique currencies from the lookup table (sorted alphabetically).
   * Used to populate the Currency filter dropdown.
   */
  const getUniqueCurrencies = (): string[] => {
    return Array.from(new Set(assetLookup.map(a => a.currency).filter(Boolean))).sort();
  };

  /**
   * Gets unique asset subcategories from the lookup table (sorted alphabetically).
   * Used to populate the Subcategory filter dropdown.
   */
  const getUniqueAssetSubcategories = (): string[] => {
    return Array.from(new Set(assetLookup.map(a => a.assetSubcategory).filter(Boolean))).sort();
  };

  /**
   * Filters assetLookup based on selected assets, asset classes, currencies, and subcategories.
   * Returns only assets that match ALL selected criteria (AND logic).
   * Empty asset class, currency, or subcategory fields are treated as matching any selection.
   */
  const getFilteredAssetLookup = (): typeof assetLookup => {
    return assetLookup.filter(asset =>
      selectedAssetTickers.includes(asset.ticker) &&
      (asset.assetClass === '' || selectedAssetClasses.includes(asset.assetClass)) &&
      (asset.currency === '' || selectedCurrencies.includes(asset.currency)) &&
      (asset.assetSubcategory === '' || selectedAssetSubcategories.includes(asset.assetSubcategory))
    );
  };

  /**
   * Selects or deselects all assets at once.
   * Called when user clicks "Select All" / "Deselect All" button.
   */
  const toggleAllAssets = (selectAll: boolean) => {
    setSelectedAssetTickers(selectAll ? assetLookup.map(a => a.ticker) : []);
  };

  /**
   * Selects or deselects all asset classes at once.
   */
  const toggleAllAssetClasses = (selectAll: boolean) => {
    setSelectedAssetClasses(selectAll ? getUniqueAssetClasses() : []);
  };

  /**
   * Selects or deselects all currencies at once.
   */
  const toggleAllCurrencies = (selectAll: boolean) => {
    setSelectedCurrencies(selectAll ? getUniqueCurrencies() : []);
  };

  /**
   * Selects or deselects all asset subcategories at once.
   */
  const toggleAllAssetSubcategories = (selectAll: boolean) => {
    setSelectedAssetSubcategories(selectAll ? getUniqueAssetSubcategories() : []);
  };

  // ----------------------------------------
  // CLOSED POSITIONS TAB HELPER FUNCTIONS
  // ----------------------------------------
  // These support the Closed tab: filtering, transactions, XIRR, chart data, and dashboard stats

  /**
   * Returns assets that exist in BOTH the lookup table AND the closed positions data.
   * This ensures the Closed tab only shows assets we have full info for.
   */
  const getClosedTabLookup = (): AssetLookup[] => {
    const closedTickers = new Set(closedData.map(row => row.ticker));
    return assetLookup.filter(asset => closedTickers.has(asset.ticker));
  };


  /** Returns all closed position rows for a specific ticker. */
  const getClosedTransactions = (ticker: string): ClosedPositionRow[] => {
    return closedData.filter(row => row.ticker === ticker);
  };

  /**
   * Returns only the INCLUDED (checked) closed transactions for a ticker.
   * When closedIncludedTxns is null, all transactions are included (default).
   * When it's a Set, only transactions at those indices are returned.
   * Used by stats and chart functions so they only reflect checked rows.
   */
  const getFilteredClosedTransactions = (ticker: string): ClosedPositionRow[] => {
    const all = getClosedTransactions(ticker);
    if (closedIncludedTxns === null) return all;
    return all.filter((_, idx) => closedIncludedTxns.has(idx));
  };

  /**
   * XIRR (Extended Internal Rate of Return) — same concept as Excel's XIRR formula.
   *
   * Think of it like this: if you made multiple investments and withdrawals at different
   * dates, XIRR tells you the single annual interest rate that would produce the same result.
   *
   * Uses Newton-Raphson iteration (a mathematical technique to find where a function equals zero).
   * Cash flows: negative = money going out (buying), positive = money coming back (selling).
   *
   * @returns Annual rate as a percentage, or null if calculation fails
   */
  const calculateXIRR = (cashFlows: { date: Date; amount: number }[]): number | null => {
    if (cashFlows.length < 2) return null;

    const d0 = cashFlows[0].date.getTime();
    const MS_PER_YEAR = 365.25 * 86400000; // milliseconds in a year

    // Held for LESS THAN A YEAR: report the plain total return instead of annualising it.
    // Annualising a few months blows small moves up into silly numbers (−5.8% over ten weeks
    // "becomes" −32% a year). Total return here = everything that came back (sale proceeds or
    // today's value, plus dividends) vs everything paid in — the same figure as the PnL %.
    // Measured from the first flow to the last: first buy -> today (open) or -> the sale (closed).
    // Every caller is on the Positions tab or the Markets Holdings page, so this applies to all.
    const spanMs = Math.max(...cashFlows.map(cf => cf.date.getTime())) - Math.min(...cashFlows.map(cf => cf.date.getTime()));
    if (spanMs < MS_PER_YEAR) {
      const paidIn = cashFlows.reduce((s, cf) => s + (cf.amount < 0 ? -cf.amount : 0), 0);
      const gotBack = cashFlows.reduce((s, cf) => s + (cf.amount > 0 ? cf.amount : 0), 0);
      return paidIn > 0 ? ((gotBack - paidIn) / paidIn) * 100 : null;
    }

    // NPV (Net Present Value) at a given rate
    // If NPV = 0, we found the correct rate (that's what XIRR solves for)
    const npv = (rate: number): number => {
      return cashFlows.reduce((sum, cf) => {
        const years = (cf.date.getTime() - d0) / MS_PER_YEAR;
        return sum + cf.amount / Math.pow(1 + rate, years);
      }, 0);
    };

    // Derivative of NPV (needed for Newton-Raphson to know which direction to adjust)
    const dnpv = (rate: number): number => {
      return cashFlows.reduce((sum, cf) => {
        const years = (cf.date.getTime() - d0) / MS_PER_YEAR;
        return sum - years * cf.amount / Math.pow(1 + rate, years + 1);
      }, 0);
    };

    // Newton-Raphson: start with a guess and iteratively improve
    let rate = 0.1; // Initial guess: 10% annual return
    for (let i = 0; i < 100; i++) {
      const f = npv(rate);
      const df = dnpv(rate);
      if (Math.abs(df) < 1e-10) return null; // derivative too small, can't converge
      const newRate = rate - f / df;
      if (isNaN(newRate) || !isFinite(newRate)) return null; // guard against NaN/Infinity
      if (Math.abs(newRate - rate) < 1e-7) return newRate * 100; // converged!
      rate = newRate;
      // Safety: if rate goes crazy, bail out
      if (rate < -0.99 || rate > 100) return null;
    }
    return rate * 100; // return best guess as percentage
  };

  /**
   * Computes all dashboard statistics for a given closed ticker.
   * Returns aggregate metrics across ALL transactions for that asset.
   */
  const getClosedDashboardStats = (ticker: string) => {
    const transactions = getFilteredClosedTransactions(ticker);
    if (transactions.length === 0) return null;

    // 1. Total Holding Time: from earliest buy to latest sale
    const buyDates = transactions.map(t => new Date(t.invDate)).sort((a, b) => a.getTime() - b.getTime());
    const saleDates = transactions.map(t => new Date(t.divDate)).sort((a, b) => a.getTime() - b.getTime());
    const firstBuy = buyDates[0];
    const lastSale = saleDates[saleDates.length - 1];
    const holdingDays = Math.round((lastSale.getTime() - firstBuy.getTime()) / 86400000);
    const holdingYears = holdingDays / 365.25;

    // 2. Total PnL (sum all costs vs sum all final values)
    const totalCost = transactions.reduce((sum, t) => sum + t.initialCost, 0);
    const totalFinalValue = transactions.reduce((sum, t) => sum + t.finalNetValue, 0);
    const totalPnL = totalFinalValue - totalCost;
    const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

    // 3. XIRR (annualized return across all buy/sell transactions)
    const cashFlows = transactions.flatMap(t => [
      { date: new Date(t.invDate), amount: -t.initialCost },   // money out (buying)
      { date: new Date(t.divDate), amount: t.finalNetValue }   // money back (selling + dividends)
    ]).sort((a, b) => a.date.getTime() - b.date.getTime());
    const xirr = calculateXIRR(cashFlows);

    // 4. "If Not Sold" — what the shares would be worth today at current market price
    const totalShares = transactions.reduce((sum, t) => sum + t.sharesSold, 0);
    const currentPrice = getCurrentPrice(ticker);
    const ifNotSold = currentPrice * totalShares;

    // 5. Current Price vs Sold Price (weighted average sell price)
    const weightedSellPrice = totalShares > 0
      ? transactions.reduce((sum, t) => sum + t.sellPrice * t.sharesSold, 0) / totalShares
      : 0;
    const priceVsSoldPct = weightedSellPrice > 0
      ? ((currentPrice - weightedSellPrice) / weightedSellPrice) * 100
      : 0;

    return {
      holdingDays, holdingYears, totalCost, totalFinalValue,
      totalPnL, totalPnLPct, xirr, ifNotSold,
      currentPrice, weightedSellPrice, priceVsSoldPct, totalShares,
      firstBuy, lastSale,
    };
  };

  /**
   * Flattens closed positions into a chronological list of INDIVIDUAL trades.
   *
   * WHY THIS EXISTS: a row in the closed-positions data is a round trip — one record holding
   * both the purchase and the matching sale ("bought 100 on this date, sold them on that one").
   * That's the right shape for measuring a completed investment, but it's the wrong shape for
   * answering "what did I actually do, in what order?". Here each round trip is split back into
   * the two real-world events it represents, and the whole lot is sorted by date.
   *
   * Commission in bps ("basis points", where 1 bp = 0.01%) is measured against the GROSS value
   * of that trade — price × quantity, before commission. That's the standard way brokers quote
   * it, and it makes a big trade and a small one directly comparable: 10 bps is 10 bps whether
   * you traded 1,000 or 1,000,000.
   */
  const roundTripToEvents = (t: ClosedPositionRow): TradeEvent[] => {
    const events: TradeEvent[] = [];
    // Units bought: what was sold plus anything given up to fees paid in units on the way
    // (no fees for almost every row, so this is just sharesSold)
    const boughtUnits = t.sharesSold + unitFeeQty(t.unitFees);
    {
      // The purchase leg. initialCost already includes the buy commission.
      // Gross traded value, derived from the CASH rather than from price × quantity. The two
      // should agree, but cost is what the rest of the app trusts, it stays correct even when a
      // price cell is mistyped (see the IWDA 2020-03-12 row), and it matches how the Transactions
      // table computes its basis points — so the two tables can never disagree.
      const buyGross = t.initialCost - t.buyCommission;
      events.push({
        date: t.invDate,
        type: 'buy',
        price: t.buyPrice,
        quantity: boughtUnits,
        commission: t.buyCommission,
        commissionBps: buyGross > 0 ? (t.buyCommission / buyGross) * 10000 : 0,
        amount: t.initialCost,
        // Derived from initialCost rather than the buyPrice column on purpose — it includes the
        // commission, and it stays right even if a price cell in the sheet is mistyped.
        costPerShare: boughtUnits > 0 ? t.initialCost / boughtUnits : t.buyPrice,
        cumQuantity: 0,
        cumAvgPrice: null,
        cumCost: 0,
        cumSold: 0,
        income: 0,
        cumIncome: 0,
        pnlBasis: 0,       // buying realises nothing — you've swapped cash for shares, not booked a result
        realisedPnl: null,
        cumRealisedPnl: 0,
        stillHeld: false,  // this lot was bought AND sold, so none of it remains
      });
      // (Fees these shares paid in units are added by the caller, merged by date across
      // every round trip, so one quarterly fee is one row rather than one per lot.)
      // The sale leg. valueAfterFee is the proceeds with the sell commission already deducted.
      const sellGross = t.valueAfterFee + t.sellCommission;   // proceeds before the fee came off
      events.push({
        date: t.divDate,
        type: 'sell',
        price: t.sellPrice,
        quantity: t.sharesSold,
        commission: t.sellCommission,
        commissionBps: sellGross > 0 ? (t.sellCommission / sellGross) * 10000 : 0,
        amount: t.valueAfterFee,
        costPerShare: 0,  // a sale doesn't have a cost basis of its own
        cumQuantity: 0,
        cumAvgPrice: null,
        cumCost: 0,
        cumSold: 0,
        // The part of this round trip's result that came from holding rather than from the price
        // moving: dividends and interest collected along the way, net of any tax paid on them.
        // Booked against the SALE because that's when the round trip settles — which is also why
        // finalNetValue (below) already contains it.
        income: t.cumDividend - t.totalTax,
        cumIncome: 0,
        // finalNetValue, not valueAfterFee: it also folds in dividends received and tax paid,
        // which is how profit is defined everywhere else in this app. Using it means the running
        // total lands exactly on the "Profit of +X" headline at the top of this section.
        // For the ~92% of rows with no dividends or tax the two figures are identical anyway.
        pnlBasis: t.finalNetValue,
        realisedPnl: null,
        cumRealisedPnl: 0,
        stillHeld: false,
      });
    }
    return events;
  };

  /**
   * Chronological order, with two tie-breaks for events sharing a date:
   *
   *  1. Buys before sells, matching the FIFO cost-basis ordering used everywhere else.
   *  2. Among buys, the part that was SOLD comes before the part still held.
   *
   * Rule 2 exists because one purchase can be split in two. MBHTR was bought 30,000 on
   * 2026-01-20; a later sale consumed 5,000 of it, so the table shows a sold 5,000 row
   * and a surviving 25,000 row on that same date. Listing the survivor first interleaves
   * them — sold, held, sold, held — and you have to read every row to see what you still
   * own. Sold-first groups them: sold, sold, held, held.
   *
   * The old comparator returned -1 for ANY two buys, which is not a valid ordering (it
   * claims a < b and b < a simultaneously), so which one landed first was arbitrary.
   */
  const sortTradeEvents = (events: TradeEvent[]) =>
    events.sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      // Same day: buys, then fees paid in units, then sells
      const rank = { buy: 0, fee: 1, sell: 2 };
      if (a.type !== b.type) return rank[a.type] - rank[b.type];
      if (a.type === 'buy') return Number(a.stillHeld) - Number(b.stillHeld);
      return 0;
    });

  /** Trade history for a CLOSED position: every round trip, split back into real events. */
  const getClosedTradeEvents = (ticker: string): TradeEvent[] => {
    const trips = getFilteredClosedTransactions(ticker);
    const events = [
      ...trips.flatMap(roundTripToEvents),
      // Fees paid in units along the way, one row per date (none for almost every asset)
      ...mergeUnitFees(trips.map(t => t.unitFees)).map(unitFeeToEvent),
    ];
    sortTradeEvents(events);
    applyFifoRunningTotals(events);
    return events;
  };

  /**
   * Trade history for an OPEN position: the shares you still hold PLUS every completed round
   * trip you have ever done in the same asset.
   *
   * WHY BOTH: the two live in different sheets. Shares you still hold sit in the transactions
   * sheet as purchases with no matching sale; anything bought and later sold has moved out into
   * the closed-positions sheet. Neither on its own is the story of the asset — you can hold
   * Ethereum today and also have traded it round-trip three years ago.
   *
   * They cannot double-count: a lot only appears in the closed sheet once it has been fully
   * sold, at which point it is no longer among your open purchases. Verified on the real data.
   */
  const getOpenTradeEvents = (ticker: string): TradeEvent[] => {
    // Past completed trades in this same asset — all of them. The open position's transaction
    // checkboxes filter your CURRENT holdings, not your history.
    const closedTrips = closedData.filter(r => r.ticker === ticker);
    const historical = closedTrips.flatMap(roundTripToEvents);
    const openPurchases = getFilteredOpenPurchases(ticker);
    // Fees paid in units, by sold and still-held shares alike, one row per date
    const fees = mergeUnitFees([...closedTrips.map(r => r.unitFees), ...openPurchases.map(t => t.unitFees)]).map(unitFeeToEvent);

    // Purchases still open. The transactions sheet has no price column, so derive it: `amount`
    // is the all-in cost, so stripping the commission back out gives the per-share price paid.
    // `qty` here is what was BOUGHT; any units later given up to fees are the fee rows.
    const current: TradeEvent[] = openPurchases.map(t => ({
      date: t.date,
      type: 'buy' as const,
      price: t.qty > 0 ? (t.amount - t.commAbs) / t.qty : 0,
      quantity: t.qty,
      commission: t.commAbs,
      commissionBps: t.commBps,   // the sheet reports this directly
      amount: t.amount,
      costPerShare: t.qty > 0 ? t.amount / t.qty : 0,
      cumQuantity: 0,
      cumAvgPrice: null,
      cumCost: 0,
      cumSold: 0,
      income: 0,
      cumIncome: 0,
      pnlBasis: 0,
      realisedPnl: null,
      cumRealisedPnl: 0,
      stillHeld: true,   // never sold — this is what you are holding right now
    }));

    const events = [...historical, ...current, ...fees];
    sortTradeEvents(events);
    applyFifoRunningTotals(events);
    return events;
  };

  /**
   * Builds chart data for the performance line chart in the Closed tab.
   * Uses monthly price data for the selected ticker and identifies buy/sell months.
   *
   * Returns:
   * - chartData: array of {date, price} for the LineChart
   * - buyDots: array of {date, price} for green buy markers
   * - sellDots: array of {date, price} for red sell markers
   */
  const getClosedChartData = (ticker: string) => {
    if (!assetData) return { chartData: [] as { date: string; price: number; avgBuyPrice?: number; avgSellPrice?: number; shares: number }[], buyDots: [] as TradeDot[], sellDots: [] as TradeDot[] };

    const transactions = getFilteredClosedTransactions(ticker);

    // Collect buy and sell months in YYYY-MM format for matching against monthly price data
    const buyMonths = new Set(transactions.map(t => toYM(new Date(t.invDate))));
    const sellMonths = new Set(transactions.map(t => toYM(new Date(t.divDate))));

    // The price you ACTUALLY paid / received, per transaction, bucketed by month.
    // The price line itself only knows month-END prices, but a trade almost never happens
    // on the last day of the month — so the real fill sits above or below the line. These
    // maps let each dot be drawn at its true price. A month can hold several trades, so the
    // value is a list, and each entry gets its own dot stacked at that month.
    const buyPricesByMonth = new Map<string, number[]>();
    const sellPricesByMonth = new Map<string, number[]>();
    for (const t of transactions) {
      // Sheet columns `Buy Price` / `Sell price` are already per-share and exclude commission,
      // which matches how the Transaction History table shows them.
      if (t.buyPrice > 0) pushTradePrice(buyPricesByMonth, toYM(new Date(t.invDate)), t.buyPrice);
      if (t.sellPrice > 0) pushTradePrice(sellPricesByMonth, toYM(new Date(t.divDate)), t.sellPrice);
    }

    // Determine date boundaries for "Since Invested" and "Until Sold" toggles
    const sortedBuyDates = transactions.map(t => t.invDate).sort();
    const sortedSaleDates = transactions.map(t => t.divDate).sort();
    const firstBuyDate = sortedBuyDates[0] || '';
    const lastSaleDate = sortedSaleDates[sortedSaleDates.length - 1] || '';

    // Convert to YYYY-MM for comparison with price data
    const firstBuyYM = firstBuyDate ? toYM(new Date(firstBuyDate)) : '';
    const lastSaleYM = lastSaleDate ? toYM(new Date(lastSaleDate)) : '';

    // ---- Build the FIFO average buy price line ----
    // This tracks the weighted average cost basis of shares still held over time.
    // When shares are bought, they go into a FIFO queue (first in, first out).
    // When shares are sold, the oldest lots are removed first, and the average
    // recalculates based on whatever lots remain.
    //
    // Events are: buys (invDate) and sells (divDate), sorted chronologically.
    // Between events, the average stays flat (horizontal line).

    type CostEvent = { date: string; ym: string; type: 'buy' | 'sell' | 'fee'; shares: number; price: number };
    const costEvents: CostEvent[] = [];
    for (const t of transactions) {
      const buyD = new Date(t.invDate);
      const sellD = new Date(t.divDate);
      // Units bought = sold + any given up to fees paid in units (almost always just sold)
      const boughtUnits = t.sharesSold + unitFeeQty(t.unitFees);
      // Use initialCost / shares as the per-share cost (includes buy commission).
      // If commission data is missing, initialCost = buyPrice × shares, so this still works.
      const costPerShare = boughtUnits > 0 ? t.initialCost / boughtUnits : t.buyPrice;
      costEvents.push({
        date: t.invDate,
        ym: toYM(buyD),
        type: 'buy',
        shares: boughtUnits,
        price: costPerShare,
      });
      costEvents.push({
        date: t.divDate,
        ym: toYM(sellD),
        type: 'sell',
        shares: t.sharesSold,
        price: 0, // sell price doesn't affect cost basis
      });
    }
    // Fees paid in units, one per date: shares leave, cost stays
    for (const f of mergeUnitFees(transactions.map(t => t.unitFees))) {
      costEvents.push({ date: f.date, ym: toYM(new Date(f.date)), type: 'fee', shares: f.qty, price: 0 });
    }
    // Sort chronologically; if same date, process buys first, then fees, then sells.
    // (Written so buy/sell pairs tie-break exactly as they always have.)
    costEvents.sort((a, b) => a.date.localeCompare(b.date)
      || (a.type === 'buy' ? -1 : b.type === 'buy' ? 1 : a.type === 'fee' && b.type === 'sell' ? -1 : 1));

    // FIFO queue: each lot is {shares, price}
    const fifoLots: { shares: number; price: number }[] = [];
    // Map of YYYY-MM → average buy price (only for months where we hold shares)
    const avgPriceByMonth = new Map<string, number>();
    // Map of YYYY-MM → how many shares were held after that month's events.
    // Kept separate from avgPriceByMonth because this one is recorded even when the
    // count is ZERO — a month where you sold everything is exactly the month the
    // "Shares Held" bar chart most needs to show dropping to the floor.
    const sharesByMonth = new Map<string, number>();
    // Map of YYYY-MM → cost basis of the lots still held (shares × their own buy price).
    // Same definition getClosedCapitalChartData uses, so the bar tooltip agrees with the
    // Invested Capital chart further down the page.
    const investedByMonth = new Map<string, number>();

    for (const evt of costEvents) {
      if (evt.type === 'buy') {
        // Add a new lot to the back of the queue
        fifoLots.push({ shares: evt.shares, price: evt.price });
      } else if (evt.type === 'fee') {
        applyUnitFeeToLots(fifoLots, evt.shares);
      } else {
        // Sell: remove shares from the FRONT of the queue (FIFO)
        let toSell = evt.shares;
        while (toSell > 0 && fifoLots.length > 0) {
          if (fifoLots[0].shares <= toSell) {
            toSell -= fifoLots[0].shares;
            fifoLots.shift(); // entire lot consumed
          } else {
            fifoLots[0].shares -= toSell;
            toSell = 0;
          }
        }
      }

      // After this event, compute the weighted average of remaining lots.
      // Use epsilon comparison to avoid floating-point dust (e.g. 1.77e-15 instead of 0)
      // that can accumulate from repeated subtraction of fractional share counts.
      const totalShares = fifoLots.reduce((s, lot) => s + lot.shares, 0);
      const totalInvested = fifoLots.reduce((s, lot) => s + lot.shares * lot.price, 0);
      if (totalShares > 1e-9) {
        avgPriceByMonth.set(evt.ym, totalInvested / totalShares);
      }
      // If totalShares is 0 (all sold), we stop — don't set a value for this month
      // Share count and cost basis ARE recorded unconditionally (snapped to a clean 0 below
      // the epsilon, so leftover floating-point dust doesn't render as a hairline bar).
      sharesByMonth.set(evt.ym, totalShares > 1e-9 ? totalShares : 0);
      investedByMonth.set(evt.ym, totalShares > 1e-9 ? totalInvested : 0);
    }

    // If all shares were sold in the final month, remove that month's avg price entry.
    // Without this, intermediate partial sells within the same month (e.g. selling 9 out of
    // 10 positions) would change the avg to reflect only the last remaining lot's price,
    // causing a misleading jump in the line right before it ends. By deleting the entry,
    // the chart carries forward the pre-sale avg price unchanged into the sale month.
    const finalRemainingShares = fifoLots.reduce((s, lot) => s + lot.shares, 0);
    if (finalRemainingShares < 1e-9 && lastSaleYM) {
      avgPriceByMonth.delete(lastSaleYM);
    }

    // ---- Build the cumulative average sell price line ----
    // Tracks the running weighted-average sale price across all sales to date.
    // Unlike the buy price (which uses FIFO lots), this is a simple running average:
    // cumulative proceeds / cumulative shares sold, updated after each sale event.
    const avgSellPriceByMonth = new Map<string, number>();
    {
      // Collect sell events sorted by date
      const sellEvents = transactions
        .map(t => ({
          ym: toYM(new Date(t.divDate)),
          date: t.divDate,
          shares: t.sharesSold,
          price: t.sellPrice, // raw sell price per share (matches "Sell Price" column)
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      let cumShares = 0;
      let cumProceeds = 0;
      for (const evt of sellEvents) {
        cumShares += evt.shares;
        cumProceeds += evt.shares * evt.price;
        if (cumShares > 1e-9) {
          avgSellPriceByMonth.set(evt.ym, cumProceeds / cumShares);
        }
      }
    }

    // First sale month (for showing the avg sell price line from this point onward).
    // Reuses sortedSaleDates (already computed above) instead of re-sorting.
    const firstSaleYM = sortedSaleDates.length > 0 ? toYM(new Date(sortedSaleDates[0])) : '';

    // Now build chart data, carrying the avg prices forward through months
    const chartData: { date: string; price: number; avgBuyPrice?: number; avgSellPrice?: number; shares: number; investedCapital: number }[] = [];
    const buyDots: TradeDot[] = [];
    const sellDots: TradeDot[] = [];

    let currentAvgPrice: number | undefined = undefined;
    let currentAvgSellPrice: number | undefined = undefined;
    // Shares held and cost basis, carried forward month to month. Both start at 0 so that
    // months shown BEFORE the first purchase (visible when "Since Invested" is off)
    // correctly read as "you owned none of this yet".
    let currentShares = 0;
    let currentInvested = 0;

    // Pre-compute filter boundaries once (instead of inside the loop)
    const graphStartsYM = closedGraphStarts ? toYM(new Date(closedGraphStarts)) : '';
    const graphEndsYM = closedGraphEnds ? toYM(new Date(closedGraphEnds)) : '';

    for (const row of assetData) {
      const price = Number(row[ticker]);
      if (!price || price <= 0) continue;

      // Extract YYYY-MM from the price data date
      const rowDate = new Date(row.date);
      if (isNaN(rowDate.getTime())) continue; // skip invalid dates
      const rowYM = toYM(rowDate);

      // Apply toggle filters (compare at month level)
      if (closedSinceInvested && firstBuyYM && rowYM < firstBuyYM) continue;
      if (closedUntilSold && lastSaleYM && rowYM > lastSaleYM) continue;
      // "Graph Starts" dropdown: if a specific start date is selected, cut off before it
      if (graphStartsYM && rowYM < graphStartsYM) continue;
      // "Graph Ends" dropdown: if a specific end date is selected, cut off after it
      if (graphEndsYM && rowYM > graphEndsYM) continue;

      // Update avg buy price if there's a buy/sell event this month
      if (avgPriceByMonth.has(rowYM)) {
        currentAvgPrice = avgPriceByMonth.get(rowYM);
      }
      // Update avg sell price if there's a sale event this month
      if (avgSellPriceByMonth.has(rowYM)) {
        currentAvgSellPrice = avgSellPriceByMonth.get(rowYM);
      }
      // Update the share count and cost basis if shares were bought or sold this month
      if (sharesByMonth.has(rowYM)) {
        currentShares = sharesByMonth.get(rowYM)!;
      }
      if (investedByMonth.has(rowYM)) {
        currentInvested = investedByMonth.get(rowYM)!;
      }

      // Only show avg buy price line between first buy and last sale
      const showAvgBuy = currentAvgPrice !== undefined && rowYM >= (firstBuyYM || '') && rowYM <= (lastSaleYM || '');
      // Show avg sell price line from first sale onward (continues to end of chart)
      const showAvgSell = currentAvgSellPrice !== undefined && rowYM >= (firstSaleYM || '');

      chartData.push({
        date: row.date,
        price,
        avgBuyPrice: showAvgBuy ? currentAvgPrice : undefined,
        avgSellPrice: showAvgSell ? currentAvgSellPrice : undefined,
        shares: currentShares,
        investedCapital: currentInvested,
      });

      // Mark buy/sell months with dots — one dot per transaction, each at its real fill price.
      // If the sheet has no usable price for a trade we fall back to the month-end price, which
      // is what these dots showed before, so such a dot simply sits on the line as it used to.
      if (buyMonths.has(rowYM)) {
        const fills = collapseTradePrices(buyPricesByMonth.get(rowYM) ?? []);
        if (fills.length > 0) fills.forEach(tp => buyDots.push({ date: row.date, price, tradePrice: tp }));
        else buyDots.push({ date: row.date, price, tradePrice: price });
      }
      if (sellMonths.has(rowYM)) {
        const fills = collapseTradePrices(sellPricesByMonth.get(rowYM) ?? []);
        if (fills.length > 0) fills.forEach(tp => sellDots.push({ date: row.date, price, tradePrice: tp }));
        else sellDots.push({ date: row.date, price, tradePrice: price });
      }
    }

    return { chartData, buyDots, sellDots };
  };

  /**
   * Builds data for the "Invested Capital" charts in the Closed tab detail view.
   *
   * Tracks how the invested capital and its market value changed over time using FIFO
   * lot accounting. For each month between first buy and last sale, computes:
   *   - investedCapital: total cost basis of shares currently held (goes up on buys, down on sales)
   *   - marketValue: shares currently held × current market price (fluctuates with the market)
   *   - pnl: marketValue - investedCapital (positive = profit, negative = loss)
   */
  const getClosedCapitalChartData = (ticker: string): { date: string; investedCapital: number; marketValue: number; pnl: number; shares: number }[] => {
    if (!assetData) return [];

    const transactions = getFilteredClosedTransactions(ticker);
    if (transactions.length === 0) return [];

    // Collect all buy and sell events from the checked transactions
    type CapitalEvent = { date: string; ym: string; type: 'buy' | 'sell' | 'fee'; shares: number; price: number };
    const events: CapitalEvent[] = [];
    for (const t of transactions) {
      const buyD = new Date(t.invDate);
      const sellD = new Date(t.divDate);
      // Units bought = sold + any given up to fees paid in units (almost always just sold)
      const boughtUnits = t.sharesSold + unitFeeQty(t.unitFees);
      const costPerShare = boughtUnits > 0 ? t.initialCost / boughtUnits : t.buyPrice;
      events.push({
        date: t.invDate,
        ym: toYM(buyD),
        type: 'buy',
        shares: boughtUnits,
        price: costPerShare,
      });
      events.push({
        date: t.divDate,
        ym: toYM(sellD),
        type: 'sell',
        shares: t.sharesSold,
        price: 0,
      });
    }
    // Fees paid in units, one per date: shares leave, cost stays
    for (const f of mergeUnitFees(transactions.map(t => t.unitFees))) {
      events.push({ date: f.date, ym: toYM(new Date(f.date)), type: 'fee', shares: f.qty, price: 0 });
    }
    // Sort: chronological; same date = buys, then fees, then sells.
    // (Written so buy/sell pairs tie-break exactly as they always have.)
    events.sort((a, b) => a.date.localeCompare(b.date)
      || (a.type === 'buy' ? -1 : b.type === 'buy' ? 1 : a.type === 'fee' && b.type === 'sell' ? -1 : 1));

    // FIFO lot queue — same pattern as avg buy price, but we also track total cost basis
    const lots: { shares: number; price: number }[] = [];
    // Map of YYYY-MM → {invested: total cost basis, shares: total shares held}
    const capitalByMonth = new Map<string, { invested: number; shares: number }>();

    // Determine first buy and last sale months for bounding the chart (computed early
    // so we can capture the pre-sale state during FIFO processing)
    const sortedBuyDates = transactions.map(t => t.invDate).sort();
    const sortedSaleDates = transactions.map(t => t.divDate).sort();
    const firstBuyYM = toYM(new Date(sortedBuyDates[0]));
    const lastSaleYM = toYM(new Date(sortedSaleDates[sortedSaleDates.length - 1]));

    // Track the cost basis just before the final sale(s) so the chart can end at the
    // actual sale values instead of dropping to zero
    let preFinalSaleInvested = 0;
    let capturedPreSaleState = false;

    for (const evt of events) {
      // Before the first sell in the final sale month, snapshot the current lots —
      // this is how much capital was at risk right before liquidation
      if (!capturedPreSaleState && evt.type === 'sell' && evt.ym === lastSaleYM) {
        preFinalSaleInvested = lots.reduce((s, lot) => s + lot.shares * lot.price, 0);
        capturedPreSaleState = true;
      }

      if (evt.type === 'buy') {
        lots.push({ shares: evt.shares, price: evt.price });
      } else if (evt.type === 'fee') {
        applyUnitFeeToLots(lots, evt.shares);
      } else {
        // FIFO: remove oldest lots first
        let toSell = evt.shares;
        while (toSell > 0 && lots.length > 0) {
          if (lots[0].shares <= toSell) {
            toSell -= lots[0].shares;
            lots.shift();
          } else {
            lots[0].shares -= toSell;
            toSell = 0;
          }
        }
      }

      // After this event, record the state of remaining lots
      const totalShares = lots.reduce((s, lot) => s + lot.shares, 0);
      const totalInvested = lots.reduce((s, lot) => s + lot.shares * lot.price, 0);
      capitalByMonth.set(evt.ym, { invested: totalInvested, shares: totalShares });
    }

    // Actual sale proceeds for the final month — sum of finalNetValue (includes fees/divs)
    // so the chart's final data point matches the summary line's "sold for" figure
    const finalSaleProceeds = transactions
      .filter(t => {
        const d = new Date(t.divDate);
        return toYM(d) === lastSaleYM;
      })
      .reduce((sum, t) => sum + t.finalNetValue, 0);

    // Iterate through monthly price data, carrying forward the capital state
    const result: { date: string; investedCapital: number; marketValue: number; pnl: number; shares: number }[] = [];
    let currentInvested = 0;
    let currentShares = 0;

    for (const row of assetData) {
      const price = Number(row[ticker]);
      if (!price || price <= 0) continue;

      const rowDate = new Date(row.date);
      if (isNaN(rowDate.getTime())) continue;
      const rowYM = toYM(rowDate);

      // Only show data between first buy and last sale
      if (rowYM < firstBuyYM || rowYM > lastSaleYM) continue;

      // Update capital state if there's an event this month
      if (capitalByMonth.has(rowYM)) {
        const state = capitalByMonth.get(rowYM)!;
        currentInvested = state.invested;
        currentShares = state.shares;
      }

      // Skip months where we don't hold anything yet (before first buy event is processed).
      // Use epsilon for floating-point dust from fractional share arithmetic.
      if (currentShares < 1e-9 && currentInvested < 1e-9 && result.length === 0) continue;

      const marketValue = currentShares * price;
      result.push({
        date: row.date,
        investedCapital: Math.round(currentInvested),
        marketValue: Math.round(marketValue),
        pnl: Math.round(marketValue - currentInvested),
        shares: currentShares,
      });
    }

    // After the final sale, investedCapital and marketValue both drop to 0 (no shares held).
    // Replace trailing zeros with the actual sale outcome so the chart ends at the real
    // sale proceeds — matching the summary line's "invested → sold for → profit" figures.
    // Pop the zero entries first, then append one final point with the true sale values.
    while (result.length > 0 && Math.abs(result[result.length - 1].investedCapital) < 1 && Math.abs(result[result.length - 1].marketValue) < 1) {
      result.pop();
    }
    // Append the sale month's actual outcome: cost basis before selling vs real sale proceeds
    if (preFinalSaleInvested > 0 || finalSaleProceeds > 0) {
      const lastSaleDate = sortedSaleDates[sortedSaleDates.length - 1];
      result.push({
        date: lastSaleDate,
        investedCapital: Math.round(preFinalSaleInvested),
        marketValue: Math.round(finalSaleProceeds),
        pnl: Math.round(finalSaleProceeds - preFinalSaleInvested),
        shares: 0, // all shares sold at this point
      });
    }

    return result;
  };

  /**
   * Builds normalized comparison data for the "Invested Into" overlay.
   *
   * How it works: If you sold Gold in Jan 2021 and bought Silver, this function
   * scales Silver's price so that it starts at the same value as Gold on that date.
   * This lets you visually compare "what if I had kept Gold" vs "how Silver did since then".
   *
   * @param baseTicker - The ticker of the asset you sold
   * @param compTicker - The ticker of the asset you invested into
   * @param fromDateStr - The sale date to normalize from (YYYY-MM-DD)
   * @returns Array of {date, normalizedPrice} for the comparison line
   */
  const getNormalizedComparisonData = (baseTicker: string, compTicker: string, fromDateStr: string) => {
    if (!assetData || !fromDateStr) return [];

    // Find both asset prices at the normalization date (match by month)
    const fromDate = new Date(fromDateStr);
    if (isNaN(fromDate.getTime())) return []; // invalid date guard
    const fromYM = toYM(fromDate);

    let basePriceAtDate = 0;
    let compPriceAtDate = 0;

    for (const row of assetData) {
      const rowDate = new Date(row.date);
      if (isNaN(rowDate.getTime())) continue; // skip invalid dates
      const rowYM = toYM(rowDate);
      if (rowYM === fromYM) {
        const bp = Number(row[baseTicker]);
        const cp = Number(row[compTicker]);
        if (bp > 0) basePriceAtDate = bp;
        if (cp > 0) compPriceAtDate = cp;
      }
    }

    if (compPriceAtDate === 0 || basePriceAtDate === 0) return [];

    // Scale the comparison asset so its value at the sale date equals the base asset's value
    const scaleFactor = basePriceAtDate / compPriceAtDate;

    const result: { date: string; normalizedPrice: number }[] = [];
    for (const row of assetData) {
      const rowDate = new Date(row.date);
      if (isNaN(rowDate.getTime())) continue; // skip invalid dates
      const rowYM = toYM(rowDate);
      if (rowYM < fromYM) continue; // Only show from the sale date onward
      const cp = Number(row[compTicker]);
      if (!cp || cp <= 0) continue;
      result.push({ date: row.date, normalizedPrice: cp * scaleFactor });
    }

    return result;
  };

  // ----------------------------------------
  // OPEN POSITIONS TAB HELPER FUNCTIONS
  // ----------------------------------------
  // These support the Open Positions section: identifying open tickers,
  // computing stats, building chart data — all from raw transaction data.

  /**
   * Returns tickers that are still "open" — shares are still held today.
   *
   * This comes from replaying every buy and sell, so a position that was only PARTLY
   * sold stays open for the shares that remain. The rule this replaced — "bought and
   * never sold" — got that wrong: selling a single share made the whole holding vanish
   * from Open Positions, which is what hid BCASH, MBHTR and ETHSGD.
   *
   * Empty until the ledger has loaded.
   */
  const getOpenTickers = (): string[] => positionsModel?.open.map(o => o.ticker) ?? [];

  /**
   * Returns the purchase rows that make up an open position, sorted by date.
   *
   * Two things this must get right, both of which broke when the ledger arrived:
   *
   *  1. These are the SURVIVING lots, not every purchase ever made. BCASH was bought
   *     4,054 units over time and 589 sold, so listing every purchase would claim
   *     4,054 are held when only 3,465 are.
   *  2. A ticker with nothing left open returns NOTHING. The ledger still holds the
   *     original buy rows of assets sold years ago; treating those as open lots
   *     resurrects sold holdings.
   *
   * Commission comes back with each lot. It is already inside `amount`, so it is there
   * to be displayed, never to be added on top.
   */
  const getOpenPurchases = (ticker: string): TransactionRow[] => {
    const pos = positionsModel?.open.find(o => o.ticker === ticker);
    if (!pos) return [];   // not open, or the ledger hasn't loaded yet
    return pos.lots.map(l => ({
      // What was BOUGHT (less anything sold), so amount / qty stays the real price paid.
      // Units later given up to fees paid in units travel alongside in `unitFees`; use
      // heldQty() for the units still held. For almost every lot the two are equal.
      date: l.date, fx: pos.currency, qty: l.qty + unitFeeQty(l.unitFees), unitFees: l.unitFees,
      commAbs: l.commission, commBps: l.commissionBps,
      amount: l.cost, asset: pos.asset, flow: FLOW_PURCHASE, ticker,
      // Each lot keeps the account it was actually bought in — ETHSGD spans
      // BinanceSG and Gemini, so a single per-position account would mislabel half.
      account: l.account,
      // ...and which cash account paid for it, which is a different account entirely
      // (shares land in "IB ETF"; the money left "Interactive Brokers").
      fundedFrom: l.fundedFrom,
    }));
  };

  /**
   * Returns the dividends the CURRENTLY HELD shares actually earned, sorted by date.
   *
   * This is not the asset's full payment history. If you bought MBHTR in 2021, sold
   * those shares, and bought again in 2025, the 2021 dividends belong to the shares you
   * no longer own — they went out with the round trips. Listing them against today's
   * holding would be meaningless and would double-count the income, since the Closed
   * section reports it too.
   *
   * The lot replay already tracked which payment reached which shares, so this simply
   * reads that back.
   */
  const getOpenDividends = (ticker: string): TransactionRow[] => {
    // Nothing open means no income belongs here — it all left with the round trips.
    // Reading the raw ledger instead would report a closed position's entire dividend
    // history a second time, on top of what those round trips already carry.
    const pos = positionsModel?.open.find(o => o.ticker === ticker);
    if (!pos) return [];
    return pos.incomeEvents.map(e => ({
      date: e.date, fx: pos.currency, qty: 0, commAbs: 0, commBps: 0,
      amount: e.amount, asset: pos.asset, flow: FLOW_DIVIDEND, ticker, account: '',
    }));
  };

  /**
   * Returns only the INCLUDED (checked) purchase transactions for an open ticker.
   * When openIncludedTxns is null, all purchases are included (default).
   */
  const getFilteredOpenPurchases = (ticker: string): TransactionRow[] => {
    const all = getOpenPurchases(ticker);
    if (openIncludedTxns === null) return all;
    return all.filter((_, idx) => openIncludedTxns.has(idx));
  };

  /**
   * Walks backwards through price data to find the most recent price for a ticker.
   * Reusable helper extracted from getClosedDashboardStats logic.
   */
  const getCurrentPrice = (ticker: string): number => {
    if (!assetData || assetData.length === 0) return 0;
    for (let i = assetData.length - 1; i >= 0; i--) {
      const p = Number(assetData[i][ticker]);
      if (p && p > 0) return p;
    }
    return 0;
  };

  /**
   * Computes all dashboard statistics for a given open position ticker.
   * Includes dividend-adjusted avg buy price, XIRR with dividends, and current valuation.
   */
  const getOpenDashboardStats = (ticker: string) => {
    const purchases = getFilteredOpenPurchases(ticker);
    const dividends = getOpenDividends(ticker);
    if (purchases.length === 0) return null;

    // Total shares = units still held: purchases less any units given up to fees
    const totalShares = purchases.reduce((sum, t) => sum + heldQty(t), 0);
    // Total invested = sum of all purchase amounts (total cost including commission)
    const totalInvested = purchases.reduce((sum, t) => sum + t.amount, 0);
    // Total dividends received
    const totalDividends = dividends.reduce((sum, t) => sum + t.amount, 0);
    // Total buy commission
    const totalBuyComm = purchases.reduce((sum, t) => sum + t.commAbs, 0);

    // Current market valuation
    const currentPrice = getCurrentPrice(ticker);
    const currentValue = currentPrice * totalShares;

    // PnL = Current Value + Total Dividends - Total Invested (unrealized)
    const totalPnL = currentValue + totalDividends - totalInvested;
    const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

    // Time held from first buy to today
    const firstBuyDate = purchases[0].date;
    const holdingDays = Math.round((Date.now() - new Date(firstBuyDate).getTime()) / 86400000);
    const holdingYears = holdingDays / 365.25;

    // Dividend-adjusted average buy price: (Total Invested - Total Dividends) / Total Shares
    // If you bought for 100 and got 10 in dividends, your effective cost was 90
    const adjAvgBuyPrice = totalShares > 0 ? (totalInvested - totalDividends) / totalShares : 0;
    // Raw weighted average buy price (without dividend adjustment)
    const rawAvgBuyPrice = totalShares > 0 ? totalInvested / totalShares : 0;

    // XIRR: purchases (negative), dividends (positive), current valuation (positive, today)
    const cashFlows: { date: Date; amount: number }[] = [
      ...purchases.map(t => ({ date: new Date(t.date), amount: -t.amount })),
      ...dividends.map(t => ({ date: new Date(t.date), amount: t.amount })),
      { date: new Date(), amount: currentValue },
    ].sort((a, b) => a.date.getTime() - b.date.getTime());
    const xirr = calculateXIRR(cashFlows);

    return {
      totalShares, totalInvested, totalDividends, totalBuyComm,
      currentPrice, currentValue, totalPnL, totalPnLPct,
      holdingDays, holdingYears, adjAvgBuyPrice, rawAvgBuyPrice,
      xirr, firstBuyDate,
    };
  };

  /**
   * Builds chart data for the price history chart in the open position detail view.
   * Similar to getClosedChartData but:
   * - No sell events (position is open)
   * - Avg buy line is dividend-adjusted: (cumulative cost - cumulative dividends) / shares held
   * - Chart extends to the latest available data month (no "Until Sold" cutoff)
   */
  const getOpenChartData = (ticker: string) => {
    if (!assetData) return { chartData: [] as { date: string; price: number; avgBuyPrice?: number; shares: number }[], buyDots: [] as TradeDot[] };

    const purchases = getFilteredOpenPurchases(ticker);
    const dividends = getOpenDividends(ticker);

    // Collect buy months for green dot markers
    const buyMonths = new Set(purchases.map(t => toYM(new Date(t.date))));

    // The price actually paid per share, per purchase, bucketed by month — so each dot can be
    // drawn at its true fill rather than on the month-end price line. The transactions sheet
    // has no price column, so we derive it the same way the Transaction History table does:
    // `amount` is the all-in cost, so stripping the commission back out leaves the share price.
    const buyPricesByMonth = new Map<string, number[]>();
    for (const t of purchases) {
      if (t.qty > 0) pushTradePrice(buyPricesByMonth, toYM(new Date(t.date)), (t.amount - t.commAbs) / t.qty);
    }

    // The asset's FULL trade history — shares still held plus any round trips completed years
    // ago — exactly the list the Transaction History table renders. The Shares Held bars are
    // driven from this so the chart and the table tell the same story rather than two.
    const tradeEvents = getOpenTradeEvents(ticker);
    const firstEverBuy = tradeEvents.find(e => e.type === 'buy');
    // "Since Invested" now means since the FIRST time you ever bought this asset, not just the
    // oldest lot you happen to still hold — otherwise the toggle would crop the history away.
    const firstBuyYM = firstEverBuy ? toYM(new Date(firstEverBuy.date)) : '';

    // Build events: purchases increase cost+shares, dividends reduce effective cost
    // A fee paid in units removes shares but no cost, so the average per share rises.
    type OpenCostEvent = { date: string; ym: string; type: 'buy' | 'div' | 'fee'; shares: number; amount: number };
    const costEvents: OpenCostEvent[] = [
      ...purchases.map(t => ({ date: t.date, ym: toYM(new Date(t.date)), type: 'buy' as const, shares: t.qty, amount: t.amount })),
      ...dividends.map(t => ({ date: t.date, ym: toYM(new Date(t.date)), type: 'div' as const, shares: 0, amount: t.amount })),
      ...mergeUnitFees(purchases.map(t => t.unitFees)).map(f => ({ date: f.date, ym: toYM(new Date(f.date)), type: 'fee' as const, shares: f.qty, amount: 0 })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    // Track cumulative cost, dividends, and shares to compute dividend-adjusted avg buy
    let cumCost = 0;
    let cumDividends = 0;
    let cumShares = 0;
    const adjAvgByMonth = new Map<string, number>();

    for (const evt of costEvents) {
      if (evt.type === 'buy') {
        cumCost += evt.amount;
        cumShares += evt.shares;
      } else if (evt.type === 'fee') {
        cumShares -= evt.shares;   // units gone, cost unchanged
      } else {
        // Dividends reduce the effective cost basis
        cumDividends += evt.amount;
      }
      if (cumShares > 1e-9) {
        adjAvgByMonth.set(evt.ym, (cumCost - cumDividends) / cumShares);
      }
    }

    // Month-end state of the FULL history, taken straight from the same FIFO pass the table
    // uses. Because the events are already chronological, a later event in the same month
    // simply overwrites an earlier one, leaving the month's closing position.
    const sharesByMonth = new Map<string, number>();
    const investedByMonth = new Map<string, number>();
    const fifoAvgByMonth = new Map<string, number | null>();
    for (const e of tradeEvents) {
      const ym = toYM(new Date(e.date));
      sharesByMonth.set(ym, e.cumQuantity);
      investedByMonth.set(ym, e.cumCost);
      fifoAvgByMonth.set(ym, e.cumAvgPrice);
    }

    // Build chart data, carrying the avg price forward through months
    const chartData: { date: string; price: number; avgBuyPrice?: number; shares: number; investedCapital: number; fifoAvgPrice?: number | null }[] = [];
    const buyDots: TradeDot[] = [];
    let currentAvg: number | undefined = undefined;
    // Shares held and capital invested, carried forward. Both start at 0 so months before the
    // first purchase read as zero.
    let currentShares = 0;
    let currentInvested = 0;
    // The FIFO cost-basis average, for the Shares Held tooltip. Kept separate from currentAvg
    // (which is dividend-adjusted and drives the dashed line on the price chart) so the tooltip
    // agrees with the Cum. Avg Price column in the table rather than with the line.
    let currentFifoAvg: number | null = null;

    const graphStartsYM = openGraphStarts ? toYM(new Date(openGraphStarts)) : '';
    const graphEndsYM = openGraphEnds ? toYM(new Date(openGraphEnds)) : '';

    for (const row of assetData) {
      const price = Number(row[ticker]);
      if (!price || price <= 0) continue;
      const rowDate = new Date(row.date);
      if (isNaN(rowDate.getTime())) continue;
      const rowYM = toYM(rowDate);

      // Apply toggle filters
      if (openSinceInvested && firstBuyYM && rowYM < firstBuyYM) continue;
      if (graphStartsYM && rowYM < graphStartsYM) continue;
      if (graphEndsYM && rowYM > graphEndsYM) continue;

      // Update avg buy price if there's an event this month
      if (adjAvgByMonth.has(rowYM)) {
        currentAvg = adjAvgByMonth.get(rowYM);
      }
      // Update the share count and invested capital if shares were bought this month
      if (sharesByMonth.has(rowYM)) {
        currentShares = sharesByMonth.get(rowYM)!;
      }
      if (investedByMonth.has(rowYM)) {
        currentInvested = investedByMonth.get(rowYM)!;
      }
      if (fifoAvgByMonth.has(rowYM)) {
        currentFifoAvg = fifoAvgByMonth.get(rowYM)!;
      }

      // Only show avg buy price line from first buy onward
      const showAvg = currentAvg !== undefined && rowYM >= firstBuyYM;

      chartData.push({
        date: row.date,
        price,
        avgBuyPrice: showAvg ? currentAvg : undefined,
        shares: currentShares,
        investedCapital: currentInvested,
        fifoAvgPrice: currentFifoAvg,
      });

      // Mark buy months with dots — one per purchase, each at its real fill price. Falls back
      // to the month-end price if a purchase has no usable price, i.e. the old behaviour.
      if (buyMonths.has(rowYM)) {
        const fills = collapseTradePrices(buyPricesByMonth.get(rowYM) ?? []);
        if (fills.length > 0) fills.forEach(tp => buyDots.push({ date: row.date, price, tradePrice: tp }));
        else buyDots.push({ date: row.date, price, tradePrice: price });
      }
    }

    return { chartData, buyDots };
  };

  /**
   * Builds data for the Invested Capital and PnL charts for open positions.
   * Same concept as getClosedCapitalChartData but:
   * - Only buy events (no sell events)
   * - Extends to the latest available data month (no sale endpoint)
   */
  const getOpenCapitalChartData = (ticker: string): { date: string; investedCapital: number; marketValue: number; pnl: number; shares: number }[] => {
    if (!assetData) return [];

    const purchases = getFilteredOpenPurchases(ticker);
    if (purchases.length === 0) return [];
    const dividends = getOpenDividends(ticker);

    // Build buy events sorted by date
    // Fees paid in units ride along as negative shares with no cost: from their month on,
    // the holding is worth less while the money put in stays the same.
    const buyEvents = [
      ...purchases.map(t => ({
        date: t.date,
        ym: toYM(new Date(t.date)),
        shares: t.qty,
        cost: t.amount,
      })),
      ...mergeUnitFees(purchases.map(t => t.unitFees)).map(f => ({
        date: f.date, ym: toYM(new Date(f.date)), shares: -f.qty, cost: 0,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    // Build dividend events by month (cumulative)
    const divEvents = dividends.map(t => ({
      ym: toYM(new Date(t.date)),
      amount: t.amount,
    }));

    const firstBuyYM = toYM(new Date(buyEvents[0].date));

    // Track cumulative capital state at each event month
    let cumShares = 0;
    let cumInvested = 0;
    const capitalByMonth = new Map<string, { invested: number; shares: number }>();

    for (const evt of buyEvents) {
      cumShares += evt.shares;
      cumInvested += evt.cost;
      capitalByMonth.set(evt.ym, { invested: cumInvested, shares: cumShares });
    }

    // Track cumulative dividends by month
    let cumDividends = 0;
    const dividendsByMonth = new Map<string, number>();
    for (const evt of divEvents) {
      cumDividends += evt.amount;
      dividendsByMonth.set(evt.ym, cumDividends);
    }

    // Walk through monthly price data, carrying forward capital state
    const result: { date: string; investedCapital: number; marketValue: number; pnl: number; shares: number }[] = [];
    let currentInvested = 0;
    let currentShares = 0;
    let currentDividends = 0;

    for (const row of assetData) {
      const price = Number(row[ticker]);
      if (!price || price <= 0) continue;
      const rowDate = new Date(row.date);
      if (isNaN(rowDate.getTime())) continue;
      const rowYM = toYM(rowDate);

      // Only show data from first buy onward
      if (rowYM < firstBuyYM) continue;

      // Update capital state if there's a buy event this month
      if (capitalByMonth.has(rowYM)) {
        const state = capitalByMonth.get(rowYM)!;
        currentInvested = state.invested;
        currentShares = state.shares;
      }

      // Update cumulative dividends if there's a dividend this month
      if (dividendsByMonth.has(rowYM)) {
        currentDividends = dividendsByMonth.get(rowYM)!;
      }

      // Skip months before first buy event is processed
      if (currentShares < 1e-9 && result.length === 0) continue;

      const marketValue = currentShares * price;
      // Market value + cumulative dividends = total value of position
      const totalValue = marketValue + currentDividends;
      result.push({
        date: row.date,
        investedCapital: Math.round(currentInvested),
        marketValue: Math.round(totalValue),
        pnl: Math.round(totalValue - currentInvested),
        shares: currentShares,
      });
    }

    return result;
  };

  // ----------------------------------------
  // PORTFOLIO MANAGEMENT FUNCTIONS
  // ----------------------------------------

  /**
   * Generates a portfolio name from its assets.
   * e.g., [SPY 60%, BND 40%] -> "SPY60-BND40"
   */
  const generatePortfolioName = (assets: PortfolioAsset[], inflationAdj?: string, baseCurrency?: string, presetName?: string): string => {
    // Include shorts (negative weights) in the name too — only a zero weight is "not in the portfolio"
    const validAssets = assets.filter(a => a.asset && a.weight !== 0);
    if (validAssets.length === 0) return 'Portfolio';
    // If any leg is short, join with " / " instead of "-", otherwise "CSPX200-IB01-100" is unreadable
    // (you can't tell the separator from the minus sign). All-long portfolios keep the original "-" style.
    const hasShort = validAssets.some(a => a.weight < 0);
    // A card still holding an unedited preset is named after the preset ("Global 60/40")
    const baseName = presetName || validAssets.map(a => `${a.asset}${Math.round(a.weight)}`).join(hasShort ? ' / ' : '-');
    // Build suffixes: currency (if set) and inflation adjustment (if set)
    const suffixes: string[] = [];
    if (baseCurrency) suffixes.push(baseCurrency);
    if (inflationAdj) {
      const cpiLabel = CPI_OPTIONS.find(o => o.value === inflationAdj)?.label || 'CPI';
      suffixes.push(`Real ${cpiLabel}`);
    }
    if (suffixes.length > 0) return `${baseName} (${suffixes.join(', ')})`;
    return baseName;
  };

  /**
   * The preset a card is still showing, or undefined once it has been edited.
   *
   * A card remembers which preset was loaded into it (presetName), but it only still
   * "is" that preset while its assets and weights match the sheet exactly, in the same
   * order and with no carry costs added. Checking that here, instead of clearing the
   * flag in every function that edits an asset, means no existing edit code had to
   * change: edit a weight and the card simply stops matching.
   */
  const matchingPreset = (p: Portfolio): PresetPortfolio | undefined => {
    if (!p.presetName) return undefined;
    const preset = presetPortfolios.find(pp => pp.name === p.presetName);
    if (!preset || preset.assets.length !== p.assets.length) return undefined;
    const same = preset.assets.every((a, i) =>
      p.assets[i].asset === a.asset && p.assets[i].weight === a.weight && !p.assets[i].costPct);
    return same ? preset : undefined;
  };

  /**
   * Loads a preset (from the Portfolios sheet) into a card: its assets and weights replace
   * the card's, while the card's currency and inflation choices are kept.
   */
  const applyPreset = (portfolioId: number, presetName: string) => {
    const preset = presetPortfolios.find(pp => pp.name === presetName);
    if (!preset) return;
    setNumDrafts({});   // half-typed numbers belong to the old rows — same reason as removeAsset
    const updatedPortfolios = portfolios.map(p => {
      if (p.id !== portfolioId) return p;
      const newAssets: PortfolioAsset[] = preset.assets.map(a => ({ asset: a.asset, weight: a.weight }));
      return {
        ...p,
        assets: newAssets,
        presetName: preset.name,
        nameManuallyEdited: false,   // picking a preset is a fresh start for the name too
        name: generatePortfolioName(newAssets, p.inflationAdj, p.baseCurrency, preset.name),
      };
    });
    setPortfolios(updatedPortfolios);
    autoAdjustStartDate(updatedPortfolios);   // same as adding assets by hand
  };

  /**
   * Handles when user manually types a portfolio name
   */
  const handlePortfolioNameChange = (id: number, name: string) => {
    setPortfolios(portfolios.map(p =>
      p.id === id ? { ...p, name, nameManuallyEdited: true } : p
    ));
  };

  /**
   * Adds a new empty portfolio
   */
  const addPortfolio = () => {
    // Cycle through these colors for different portfolios
    const colors = SERIES_COLORS;
    const newId = Math.max(...portfolios.map(p => p.id), 0) + 1;

    setPortfolios([...portfolios, {
      id: newId,
      name: `Portfolio ${newId}`,
      assets: [],
      color: colors[portfolios.length % colors.length],
      nameManuallyEdited: false,
      inflationAdj: '',  // Default: no inflation adjustment (nominal values)
      baseCurrency: ''   // Default: no currency conversion (assets stay in native currencies)
    }]);
  };

  /**
   * Removes a portfolio by ID
   */
  const removePortfolio = (id: number) => {
    const updatedPortfolios = portfolios.filter(p => p.id !== id);
    setPortfolios(updatedPortfolios);
    autoAdjustStartDate(updatedPortfolios);
  };

  /**
   * Adds a new asset slot to a portfolio
   */
  const addAssetToPortfolio = (portfolioId: number) => {
    const firstAvailableAsset = availableAssetsFiltered[0] || '';
    setNumDrafts({});  // row indices shift when the list grows — see removeAsset

    const updatedPortfolios = portfolios.map(p => {
      if (p.id === portfolioId) {
        // First asset starts at 100%, subsequent assets start at 0%
        const isFirstAsset = p.assets.length === 0;
        const newAssets = [...p.assets, {
          asset: firstAvailableAsset,
          weight: isFirstAsset ? 100 : 0,
        }];
        const newName = p.nameManuallyEdited ? p.name : generatePortfolioName(newAssets, p.inflationAdj, p.baseCurrency);
        return { ...p, assets: newAssets, name: newName };
      }
      return p;
    });
    setPortfolios(updatedPortfolios);
    autoAdjustStartDate(updatedPortfolios);
  };

  /**
   * Auto-adjusts the first asset's weight to make total = 100%
   * This is a convenience feature - when you change other assets,
   * the first asset automatically adjusts to balance things out.
   */
  const autoAdjustFirstAsset = (assets: PortfolioAsset[]): PortfolioAsset[] => {
    if (assets.length < 2) return assets;

    // Sum up weights of all assets except the first one
    const otherAssetsWeight = assets.slice(1).reduce((sum, a) => sum + (a.weight || 0), 0);
    // NOTE: no longer clamped at 0 — with shorting enabled the balancing asset is allowed to go
    // negative (e.g. type 200% into slot 2 and slot 1 becomes -100%, i.e. the financing leg).
    const firstAssetWeight = 100 - otherAssetsWeight;

    const newAssets = [...assets];
    newAssets[0] = { ...newAssets[0], weight: firstAssetWeight };
    return newAssets;
  };

  /**
   * Looks up an asset's native currency from the lookup table.
   * e.g., "CSPX" → "USD", "WIG20" → "PLN", "ES3" → "SGD"
   */
  const getAssetCurrency = (assetTicker: string): string => {
    const entry = assetLookup.find(a => a.ticker === assetTicker);
    return entry?.currency || 'PLN';  // Default to PLN if not found
  };

  /**
   * Sets the start date based on a preset period (YTD, 1Y, 3Y, 5Y).
   * Keeps the end date unchanged and calculates the new start date.
   * Finds the closest available date in the data if exact date doesn't exist.
   */
  const setDatePreset = (preset: DatePreset) => {
    const start = presetStartDate(preset);
    if (start) setSelectedStartDate(start);
  };

  /**
   * The start date a quick preset (YTD, 1Y … 10Y, Max) would set, without setting it. Used by
   * setDatePreset above, and to light up the preset button that matches the dates on screen.
   * `limiting` is the shortest asset history; checking all twelve presets passes it in, so that
   * search runs once rather than once per preset.
   */
  const presetStartDate = (preset: DatePreset, limiting = getLimitingAsset()): string | null => {
    if (!assetData || assetData.length === 0) return null;

    if (preset === 'Max') {
      // Use the limiting asset's first date (shortest history), or the first date in the dataset
      return limiting ? limiting.date : assetData[0].date;
    }

    // Dates are "YYYY-MM-DD" strings. new Date() reads them as midnight UTC, so every step below
    // stays in UTC: mixing in the computer's own time zone (getFullYear, a local new Date(y, 0, 1))
    // made the answer depend on where the browser is — YTD began at the December month-end in
    // Singapore but skipped January west of London.
    const endDate = new Date(selectedDateRange.end);
    let targetDateStr: string;

    if (preset === 'YTD') {
      // Year to date: from the last day of the previous year, so the first row on or after it is
      // the year-end price the year's return is measured from
      targetDateStr = `${endDate.getUTCFullYear() - 1}-12-31`;
    } else {
      // 1Y, 2Y, 3Y, 4Y, 5Y: subtract years from end date
      const years = parseInt(preset);  // "1Y" -> 1, "2Y" -> 2, etc.
      const targetStartDate = new Date(endDate);
      targetStartDate.setUTCFullYear(endDate.getUTCFullYear() - years);
      targetDateStr = targetStartDate.toISOString().split('T')[0];
    }

    // Enforce: can't go earlier than the limiting asset's first available date
    if (limiting && targetDateStr < limiting.date) {
      targetDateStr = limiting.date;
    }

    // Find first date >= target date; if there is none after the target, the first available date
    const closestDate = assetData.find(row => row.date >= targetDateStr);
    return closestDate ? closestDate.date : assetData[0].date;
  };

  /**
   * Which quick preset the dates on screen match (undefined if none: dates picked by hand).
   * When the shortest asset history cuts several presets to the same start (say 9Y, 10Y and Max
   * all begin at its first month) the longest one wins, since that is what "Max" means.
   */
  const activeDatePreset = (): DatePreset | undefined => {
    const limiting = getLimitingAsset();
    return [...DATE_PRESETS].reverse().find(p => presetStartDate(p, limiting) === selectedDateRange.start);
  };

  /**
   * Updates a specific field of an asset in a portfolio
   */
  const updateAsset = (portfolioId: number, assetIndex: number, field: 'asset' | 'weight' | 'costPct', value: string | number) => {
    const updatedPortfolios = portfolios.map(p => {
      if (p.id === portfolioId) {
        let newAssets = [...p.assets];
        newAssets[assetIndex] = { ...newAssets[assetIndex], [field]: value };

        // Auto-adjust first asset if we changed weight of another asset
        if (field === 'weight' && assetIndex > 0) {
          newAssets = autoAdjustFirstAsset(newAssets);
        }

        const newName = p.nameManuallyEdited ? p.name : generatePortfolioName(newAssets, p.inflationAdj, p.baseCurrency);
        return { ...p, assets: newAssets, name: newName };
      }
      return p;
    });
    setPortfolios(updatedPortfolios);
    // Auto-adjust start date when an asset ticker is changed (not when weight changes)
    if (field === 'asset') {
      autoAdjustStartDate(updatedPortfolios);
    }
  };

  /**
   * Handles typing in the Weight / Cost boxes, which have to accept negative numbers.
   *
   * Two things happen on every keystroke:
   *  1. The raw text is stashed in `numDrafts` so a half-finished entry like "-" or "1." stays on
   *     screen instead of being snapped back to a number (see the numDrafts comment above).
   *  2. The parsed number is written into the portfolio, so the backtest always has a valid value.
   */
  const handleNumericAssetInput = (
    portfolioId: number,
    assetIndex: number,
    field: 'weight' | 'costPct',
    raw: string
  ) => {
    setNumDrafts(prev => ({ ...prev, [`${portfolioId}:${assetIndex}:${field}`]: raw }));
    const parsed = parseFloat(raw);
    // Number.isFinite (not !isNaN) — it rejects Infinity as well as NaN. Typing something like
    // "1e400" parses to Infinity, which sails past the liquidation guard (Infinity is not <= 0)
    // and then turns the whole backtest into NaN when the long and short legs cancel. Anything
    // that isn't a real number becomes 0, i.e. "no adjustment".
    updateAsset(portfolioId, assetIndex, field, Number.isFinite(parsed) ? parsed : 0);
  };

  /** Drops the draft when a box loses focus, so it goes back to showing the tidy stored number. */
  const clearNumDraft = (portfolioId: number, assetIndex: number, field: 'weight' | 'costPct') => {
    setNumDrafts(prev => {
      const next = { ...prev };
      delete next[`${portfolioId}:${assetIndex}:${field}`];
      return next;
    });
  };

  /**
   * Removes an asset from a portfolio
   */
  const removeAsset = (portfolioId: number, assetIndex: number) => {
    // Drafts are keyed by row index, so removing a row would make them point at the wrong asset.
    // Simplest correct fix: throw them all away — the stored numbers are the source of truth anyway.
    setNumDrafts({});
    const updatedPortfolios = portfolios.map(p => {
      if (p.id === portfolioId) {
        let newAssets = p.assets.filter((_, i) => i !== assetIndex);

        // If we removed an asset other than first, auto-adjust first asset
        if (assetIndex > 0 && newAssets.length > 0) {
          newAssets = autoAdjustFirstAsset(newAssets);
        }

        const newName = p.nameManuallyEdited ? p.name : generatePortfolioName(newAssets, p.inflationAdj, p.baseCurrency);
        return { ...p, assets: newAssets, name: newName };
      }
      return p;
    });
    setPortfolios(updatedPortfolios);
    autoAdjustStartDate(updatedPortfolios);
  };

  /**
   * Calculates the total weight of all assets in a portfolio
   * Should equal 100% for a valid portfolio
   */
  const getTotalWeight = (portfolio: Portfolio): number => {
    return portfolio.assets.reduce((sum, a) => sum + (a.weight || 0), 0);
  };

  /** True if any leg of this portfolio carries a financing/expense adjustment. */
  const hasCostLeg = (portfolio: Portfolio): boolean => {
    return portfolio.assets.some(a => !!a.costPct);
  };

  // ----------------------------------------
  // BACKTEST CALCULATIONS (the engine itself is in lib/backtest.ts)
  // ----------------------------------------

  // The Backtest tab's settings, as the engine takes them. Only the Monthly tab's "vs market"
  // rows pass overrides: they need this very engine over a different span, and a second, parallel
  // implementation there would eventually disagree with the Backtest tab, which is precisely the
  // thing those rows exist to rule out.
  const backtestSettings = (overrides?: { start?: string; end?: string; rebalanceFreq?: string }): BacktestSettings => ({
    start: overrides?.start ?? selectedDateRange.start,
    end: overrides?.end ?? selectedDateRange.end,
    rebalanceFreq: overrides?.rebalanceFreq ?? rebalanceFreq,
    startingCapital,
    currencyOf: getAssetCurrency,
    prepareRows: rowsForWindow,
  });

  /** A portfolio's value line and drawdown over the selected window (null if it can't run). */
  const calculatePortfolioReturns = (
    portfolio: Portfolio,
    data: AssetRow[],
    overrides?: { start?: string; end?: string; rebalanceFreq?: string },
  ): ReturnPoint[] | null => portfolioReturns(portfolio, data, backtestSettings(overrides));

  /** The month-by-month Rebalancing table: the same simulation the chart line comes from. */
  const getRebalancingDetails = (result: BacktestResult): RebalancingRow[] =>
    (assetData ? simulatePortfolio(result.portfolio, assetData, backtestSettings()) : []);

  /**
   * Builds chart data for the Annual Returns bar chart.
   *
   * Creates an array where each element represents one year, with annual returns
   * for each portfolio. The structure is designed for Recharts grouped bar chart:
   *
   * Example output:
   * [
   *   { year: "2022", "Portfolio 1": 10.5, "Portfolio 2": -5.2 },
   *   { year: "2023", "Portfolio 1": 15.3, "Portfolio 2": 8.7 },
   *   ...
   * ]
   *
   * @param results - Array of backtest results containing portfolio returns
   * @returns Array of chart data points sorted by year (oldest to newest)
   */
  const getAnnualReturnsChartData = (
    results: BacktestResult[],
    startDate: string  // Used to filter out start year when start month is December
  ): Array<{ year: string; [portfolioName: string]: string | number }> => {
    if (!results || results.length === 0) return [];

    // Collect all years from all portfolios and their annual returns
    const yearData: { [year: string]: { [portfolioName: string]: number } } = {};

    results.forEach(result => {
      // Calculate monthly returns to get the FY (full year) returns
      const monthlyReturns = calculateMonthlyReturns(result.returns);

      // Extract each year's full-year return
      Object.keys(monthlyReturns).forEach(year => {
        if (!yearData[year]) {
          yearData[year] = {};
        }
        yearData[year][result.portfolio.name] = monthlyReturns[year].fy;
      });
    });

    // Determine if we should skip the start year (when start month is December)
    // When starting in December, that year only has one data point and shows 0% return
    const startDateObj = new Date(startDate);
    const startMonth = startDateObj.getMonth(); // 0-11, December = 11
    const startYear = startDateObj.getFullYear().toString();
    const skipStartYear = startMonth === 11; // December

    // Convert to array format for Recharts, sorted by year (oldest to newest)
    // Filter out start year if December (it would show 0% with only one data point)
    const chartData = Object.keys(yearData)
      .filter(year => !(skipStartYear && year === startYear))
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map(year => ({
        year,
        ...yearData[year]
      }));

    return chartData;
  };

  /**
   * Best and worst CALENDAR YEAR for each portfolio, keyed by portfolio name.
   *
   * Deliberately read off the very same getAnnualReturnsChartData() that feeds the
   * Annual Returns chart and its table further down the page, rather than worked out
   * again here. The Best Year figure has to be the tallest bar in that chart — anyone
   * reading the page will check exactly that — and reusing the numbers makes it true
   * by construction instead of by two pieces of arithmetic happening to agree.
   *
   * Note this inherits that helper's definition of a year, which includes a partial
   * first year (when the backtest starts mid-year) and the partial current year. The
   * year itself is returned so the cell can name it on hover.
   */
  const getBestWorstYears = (
    results: BacktestResult[],
    startDate: string,
  ): Record<string, { best: number; bestYear: string; worst: number; worstYear: string }> => {
    const out: Record<string, { best: number; bestYear: string; worst: number; worstYear: string }> = {};
    if (!results || results.length === 0) return out;
    const rows = getAnnualReturnsChartData(results, startDate);

    results.forEach(result => {
      const name = result.portfolio.name;
      let best: { v: number; year: string } | null = null;
      let worst: { v: number; year: string } | null = null;
      for (const row of rows) {
        const v = row[name];
        if (typeof v !== 'number') continue;   // portfolio has no data for that year
        const year = String(row.year);
        if (!best || v > best.v) best = { v, year };
        if (!worst || v < worst.v) worst = { v, year };
      }
      if (best && worst) {
        out[name] = { best: best.v, bestYear: best.year, worst: worst.v, worstYear: worst.year };
      }
    });

    return out;
  };

  /**
   * Builds the Backtest tab's returns bar chart data at ANY period — calendar
   * months, quarters, years, or one of the rolling-CAGR windows. It is the
   * grouped, multi-portfolio counterpart of the Monthly tab's computeReturnsData.
   *
   * Example output (quarterly, two portfolios):
   * [
   *   { key: '2023-Q1', label: '1Q\n2023', 'Portfolio 1': 4.2, 'Portfolio 2': -1.1 },
   *   ...
   * ]
   *
   * The 'annual' case DELEGATES to getAnnualReturnsChartData rather than working the
   * numbers out again, so the default view is guaranteed to keep showing exactly what
   * it showed before this chart gained its buttons — including that helper's rule
   * about dropping a December start year (one data point, would read as 0%).
   *
   * @param results - the backtested portfolios
   * @param startDate - backtest start, only used by the annual path above
   * @param period - which view the buttons have selected
   * @returns one row per bar, sorted oldest to newest
   */
  const getPeriodicReturnsChartData = (
    results: BacktestResult[],
    startDate: string,
    period: ReturnsChartPeriod,
  ): PeriodicReturnsRow[] => {
    if (!results || results.length === 0) return [];

    if (period === 'annual') {
      return getAnnualReturnsChartData(results, startDate)
        .map(row => ({ ...row, key: String(row.year), label: String(row.year) }));
    }

    const rolling = ROLLING_RETURN_YEARS.find(r => r.period === period);
    const streak = STREAK_VIEWS.find(s => s.period === period);

    // Portfolios are merged into shared rows so a bar group lines up on one X value.
    // A portfolio missing that period simply has no entry, and Recharts draws no bar.
    const rowsByKey = new Map<string, PeriodicReturnsRow>();
    const rowFor = (key: string, label: string, range?: string): PeriodicReturnsRow => {
      let row = rowsByKey.get(key);
      if (!row) {
        row = range ? { key, label, range } : { key, label };
        rowsByKey.set(key, row);
      }
      return row;
    };
    const fmtMonth = (d: Date) => `${MONTH_ABBR[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;

    results.forEach(result => {
      const name = result.portfolio.name;

      // Last value per calendar month, oldest first. The engine already emits one point
      // per month; going through a map keeps this true even if that ever changes.
      const byMonth = new Map<string, { date: string; value: number }>();
      for (const p of result.returns) byMonth.set(toYM(new Date(p.date)), { date: p.date, value: p.value });
      const months = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));

      if (streak) {
        // Same counters as the Monthly tab, run on portfolio VALUE instead of price.
        // The high-water mark starts at the first month of the backtest, so that month
        // counts as a high — the same convention the drawdown figures use.
        let peak = -Infinity;
        let run = 0;
        for (let i = 0; i < months.length; i++) {
          const value = months[i][1].value;
          let onRun: boolean;
          if (period === 'athStreak') {
            onRun = value >= peak;              // at the mark counts, matching drawdown == 0
            if (value > peak) peak = value;
          } else {
            onRun = i > 0 && value > months[i - 1][1].value;   // strictly up on last month
          }
          run = onRun ? run + 1 : 0;
          const row = rowFor(months[i][0], fmtMonth(new Date(months[i][1].date)));
          row[name] = run;
        }
        return;
      }

      if (rolling) {
        // Same method as the Monthly tab: look the window's end month up BY NAME rather
        // than counting 12*N slots forward, so a bar is either exactly N years or absent.
        const idxByMonth = new Map<string, number>();
        months.forEach(([ym], i) => idxByMonth.set(ym, i));
        for (let i = 0; i < months.length; i++) {
          const startD = new Date(months[i][1].date);
          const endKey = `${startD.getFullYear() + rolling.years}-${String(startD.getMonth() + 1).padStart(2, '0')}`;
          const endIdx = idxByMonth.get(endKey);
          if (endIdx === undefined) continue;   // window runs past the end of the backtest
          const startValue = months[i][1].value;
          const endValue = months[endIdx][1].value;
          if (!(startValue > 0) || !(endValue > 0)) continue;
          const cagr = (Math.pow(endValue / startValue, 1 / rolling.years) - 1) * 100;
          const endD = new Date(months[endIdx][1].date);
          const row = rowFor(months[i][0], fmtMonth(startD), `${fmtMonth(startD)} → ${fmtMonth(endD)}`);
          row[name] = parseFloat(cagr.toFixed(1));
          // The two portfolio values behind the CAGR, so the tooltip can show its
          // working the way the Monthly tab's shows the two prices.
          row[`${name}__start`] = startValue;
          row[`${name}__end`] = endValue;
        }
        return;
      }

      if (period === 'monthly') {
        for (let i = 1; i < months.length; i++) {
          const prev = months[i - 1][1].value;
          const curr = months[i][1].value;
          if (!(prev > 0)) continue;
          const row = rowFor(months[i][0], fmtMonth(new Date(months[i][1].date)));
          row[name] = parseFloat((((curr - prev) / prev) * 100).toFixed(1));
        }
        return;
      }

      // Quarterly: last value in each calendar quarter, then quarter over quarter.
      const byQuarter = new Map<string, number>();
      for (const [, p] of months) {
        const d = new Date(p.date);
        byQuarter.set(`${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`, p.value);
      }
      const quarters = Array.from(byQuarter.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      for (let i = 1; i < quarters.length; i++) {
        const prev = quarters[i - 1][1];
        const curr = quarters[i][1];
        if (!(prev > 0)) continue;
        const [yr, qPart] = quarters[i][0].split('-');
        const row = rowFor(quarters[i][0], `${qPart.replace('Q', '')}Q\n${yr}`);
        row[name] = parseFloat((((curr - prev) / prev) * 100).toFixed(1));
      }
    });

    return Array.from(rowsByKey.values()).sort((a, b) => a.key.localeCompare(b.key));
  };

  // ----------------------------------------
  // HEAD TO HEAD CORRELATION FUNCTIONS
  // ----------------------------------------
  //
  // Correlation answers a different question to the difference bars above it: not
  // "which portfolio won", but "did the two move together at all". Everything below
  // runs on MONTHLY returns whatever period the Returns buttons happen to be showing.
  // Two reasons: monthly is the convention everywhere else in finance, and the
  // rolling-CAGR views overlap each other heavily — correlating overlapping windows
  // would count the same months over and over and quietly drag the number toward 1.

  // ----------------------------------------
  // ASSETS ANNUAL RETURNS FUNCTIONS
  // ----------------------------------------

  /**
   * Calculates annual returns for ALL assets in the lookup table.
   *
   * For each asset and each year:
   * - Start price = last available price from the PRIOR year (e.g., Dec 31 of previous year)
   * - End price = last available price in THAT year (e.g., Dec 31 of current year)
   * - Calculate: ((endPrice / startPrice) - 1) * 100 = annual return %
   *
   * Example: 2023 return = Dec 31 2023 price vs Dec 31 2022 price
   * For current year (e.g., 2026): latest available price vs Dec 31 2025
   *
   * This measures true calendar-year performance from year-end to year-end.
   */
  const calculateAssetsAnnualReturns = (): AssetsAnnualReturns => {
    const result: AssetsAnnualReturns = {};

    // Only calculate for assets in the lookup table
    if (!assetData || assetLookup.length === 0) return result;

    // Get all tickers from the lookup table
    const tickers = assetLookup.map(l => l.ticker);

    // Get the range of years in the data
    const allDates = assetData.map(row => new Date(row.date));
    const minYear = Math.min(...allDates.map(d => d.getFullYear()));
    const maxYear = Math.max(...allDates.map(d => d.getFullYear()));

    // Helper function: get the last available price for a ticker in a given year
    const getLastPriceInYear = (ticker: string, year: number): { date: string; price: number } | null => {
      // Filter to data points in this year with valid prices for this ticker
      const yearData = assetData.filter(row => {
        const rowYear = new Date(row.date).getFullYear();
        const price = Number(row[ticker]);
        return rowYear === year && price && price > 0;
      });

      if (yearData.length === 0) return null;

      // Get the last data point of the year
      const lastRow = yearData[yearData.length - 1];
      return {
        date: lastRow.date,
        price: Number(lastRow[ticker])
      };
    };

    // For each ticker, calculate annual returns for each year
    tickers.forEach(ticker => {
      result[ticker] = {};

      for (let year = minYear; year <= maxYear; year++) {
        // Get end of current year price
        const endYearData = getLastPriceInYear(ticker, year);
        if (!endYearData) continue;  // No data for this year

        // Get end of prior year price (this is our starting point)
        const priorYearData = getLastPriceInYear(ticker, year - 1);
        if (!priorYearData) continue;  // No prior year data = can't calculate return

        // EDO: a calendar year is a FRESH purchase at the prior year-end (see lib/edo.ts), not a
        // slice of one long chain — so 2022 is the bond sold in January 2022, held to Dec 2022.
        const fresh = windowPrices(ticker, priorYearData.date, endYearData.date);
        if (fresh !== undefined) {
          if (fresh === null) continue;
          result[ticker][year] = {
            return: fresh.ret,
            startDate: priorYearData.date, startPrice: fresh.startPrice,
            endDate: endYearData.date, endPrice: fresh.endPrice,
          };
          continue;
        }

        // Calculate annual return: ((endPrice / startPrice) - 1) * 100
        const annualReturn = ((endYearData.price / priorYearData.price) - 1) * 100;

        result[ticker][year] = {
          return: annualReturn,
          startDate: priorYearData.date,    // Last day of prior year
          startPrice: priorYearData.price,
          endDate: endYearData.date,         // Last day of current year
          endPrice: endYearData.price
        };
      }
    });

    return result;
  };

  // Memoized annual returns — only recalculated when assetData or assetLookup changes,
  // NOT when toggling between Returns/Prices view or changing other UI state.
  // Checked 2026-11-13: these three are everything the function reads (edoData via windowPrices).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoizedAnnualReturns = useMemo(() => calculateAssetsAnnualReturns(), [assetData, assetLookup, edoData]);

  // Markets tab: the whole Return matrix for the selected currency (see lib/markets.ts).
  // Recomputed only when the data or the currency changes — switching the period button just
  // re-reads it, because every period's figure is already in there.
  // The Category buttons come straight from the sheet, so a new category needs no code change.
  // If the remembered choice disappears from the sheet (renamed or removed), fall back to the first.
  // "Country" is always added at the end: it isn't a SnapshotCategory but a page built from the
  // SnapshotCountry column (see buildCountryMatrix).
  // (A sheet category that happens to be called "Country" is skipped, so it can't clash with it.)
  // "Holdings" follows Country the same way: a page of what you own, built from the
  // Transactions ledger rather than from the Lookup tab (see lib/holdings.ts).
  // "EDO" (the Polish savings-bond page, built from the EDO tab — see lib/edo.ts) goes right
  // after Equities, or before Country if the sheet has no Equities category; only once the
  // EDO tab has loaded.
  const marketsCategories = useMemo(
    () => {
      const fromSheet = snapshotCategories(assetLookup)
        .filter(c => ![MARKETS_COUNTRY, MARKETS_HOLDINGS, MARKETS_EDO].some(x => x.toLowerCase() === c.toLowerCase()));
      if (edoData) {
        const eq = fromSheet.findIndex(c => c.toLowerCase() === 'equities');
        fromSheet.splice(eq >= 0 ? eq + 1 : fromSheet.length, 0, MARKETS_EDO);
      }
      return [...fromSheet, MARKETS_COUNTRY, MARKETS_HOLDINGS];
    },
    [assetLookup, edoData],
  );
  const activeMarketsCategory =
    marketsCategories.find(c => c.toLowerCase() === marketsCategory.toLowerCase()) ?? marketsCategories[0] ?? 'Assets';
  const marketsIsCountry = activeMarketsCategory === MARKETS_COUNTRY;
  const marketsIsHoldings = activeMarketsCategory === MARKETS_HOLDINGS;
  const marketsIsEdo = activeMarketsCategory === MARKETS_EDO;
  // EDO has no single price history (lib/edo.ts), so the Return matrix re-draws its column from
  // each period's own start: the "3Y" cell is the bond bought three years ago.
  // (Just the re-priced numbers: lib/markets.ts scales the column, no rows are copied.)
  const edoReanchor = useMemo(
    () => (edoData
      // (isStartDependent(ticker) spelled out: edoData is already known to be loaded here)
      ? (ticker: string, startDate: string, rows: AssetRow[]) => (ticker === EDO_TICKER ? edoChainOnRows(rows, edoData, startDate) : null)
      : undefined),
    [edoData],
  );
  const marketsMatrix = useMemo(
    () => (marketsIsHoldings || marketsIsEdo ? null : marketsIsCountry
      ? buildCountryMatrix(assetData, assetLookup, marketsCountry, edoReanchor)
      : buildReturnMatrix(assetData, assetLookup, marketsCurrency, activeMarketsCategory, edoReanchor)),
    [assetData, assetLookup, marketsCurrency, activeMarketsCategory, marketsIsCountry, marketsIsHoldings, marketsIsEdo, marketsCountry, edoReanchor],
  );
  // Markets "Holdings" page: open positions + cash in one currency. Only worked out while that
  // page is on screen; the arithmetic is in lib/holdings.ts.
  const holdingsModel = useMemo(
    () => (activeView === 'markets' && marketsIsHoldings && assetData && positionsModel
      ? buildHoldings({
          open: positionsModel.open, lookup: assetLookup, data: assetData, cash: cashAccounts,
          currency: holdingsCurrency, fxTickerMap: FX_TICKER_MAP, xirr: calculateXIRR,
        })
      : null),
    [activeView, marketsIsHoldings, assetData, positionsModel, assetLookup, cashAccounts, holdingsCurrency],
  );

  // Calendar-year returns of the xxxPLN exchange rates, for the Return Map's currency buttons.
  // Same method as calculateAssetsAnnualReturns (last price of the year vs last price of the prior
  // year), but done in one pass over the data and for FX pairs even if they aren't in the lookup table.
  // Shape: { USDPLN: { 2023: -9.8, 2024: 7.1, ... }, EURPLN: {...}, ... } in percent.
  const fxAnnualReturns = useMemo(() => {
    const result: Record<string, Record<number, number>> = {};
    if (!assetData) return result;
    const pairs = new Set([...Object.values(FX_TICKER_MAP), ...assetLookup.map(a => a.fx)].filter(Boolean));
    pairs.forEach(pair => {
      // Rows are in date order, so the last price written for a year is that year's closing price
      const yearEnd: Record<number, number> = {};
      assetData.forEach(row => {
        const price = Number(row[pair]);
        if (price > 0) yearEnd[new Date(row.date).getFullYear()] = price;
      });
      result[pair] = {};
      Object.keys(yearEnd).forEach(y => {
        const year = Number(y);
        if (yearEnd[year - 1]) result[pair][year] = (yearEnd[year] / yearEnd[year - 1] - 1) * 100;
      });
    });
    return result;
  }, [assetData, assetLookup]);

  /**
   * Calculates total return for a ticker over a specific number of years.
   * Returns: current price vs price X years ago.
   * Used for the 1Y, 2Y, 3Y, 4Y, 5Y columns in Assets Annual Returns.
   */
  const getPeriodReturn = (ticker: string, years: number): {
    return: number;
    startDate: string;
    startPrice: number;
    endDate: string;
    endPrice: number;
  } | null => {
    if (!assetData || assetData.length === 0) return null;

    // Find the latest price for this ticker
    let endRow = null;
    for (let i = assetData.length - 1; i >= 0; i--) {
      const price = Number(assetData[i][ticker]);
      if (price && price > 0) {
        endRow = assetData[i];
        break;
      }
    }
    if (!endRow) return null;

    const endDate = new Date(endRow.date);
    const endPrice = Number(endRow[ticker]);

    // Calculate target start date (X years ago)
    const targetStartDate = new Date(endDate);
    targetStartDate.setFullYear(endDate.getFullYear() - years);
    const targetDateStr = targetStartDate.toISOString().split('T')[0];

    // Find the closest date on or after target date with valid price
    let startRow = null;
    for (const row of assetData) {
      if (row.date >= targetDateStr) {
        const price = Number(row[ticker]);
        if (price && price > 0) {
          startRow = row;
          break;
        }
      }
    }
    if (!startRow) return null;

    // Reject if the actual start date is more than ~3 months from the target.
    // This means the asset doesn't have data going back the full requested period,
    // so it should be excluded rather than showing a shorter return mislabelled as e.g. "10Y".
    const actualStartMs = new Date(startRow.date).getTime();
    const targetStartMs = new Date(targetDateStr).getTime();
    if (actualStartMs - targetStartMs > 93 * 24 * 60 * 60 * 1000) return null;

    // EDO: "3Y" is the bond BOUGHT three years ago and held (rolled at maturity) — a fresh
    // purchase at the window's start, not a slice of one long chain (see lib/edo.ts).
    const fresh = windowPrices(ticker, startRow.date, endRow.date);
    if (fresh !== undefined) {
      if (fresh === null) return null;
      return {
        return: fresh.ret,
        startDate: startRow.date, startPrice: fresh.startPrice, endDate: endRow.date, endPrice: fresh.endPrice,
      };
    }

    const startPrice = Number(startRow[ticker]);
    const totalReturn = ((endPrice / startPrice) - 1) * 100;

    return {
      return: totalReturn,
      startDate: startRow.date,
      startPrice,
      endDate: endRow.date,
      endPrice
    };
  };

  // The chart data for one ticker (components/charts.tsx), on this screen's price table
  const getMonthlyChartData = (...args: ChartArgs) => monthlyChartData(assetData, getAssetCurrency, ...args);

  const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];


  // ============================================
  // PORTFOLIO TAB HELPER FUNCTIONS
  // ============================================

  // Use the module-level CURRENCY_SYMBOLS constant for display (e.g., "3.96M zl" or "$1.2M")

  /**
   * Per-year portfolio figures in `cur`, computed the VALUE-CONSISTENT way (shared by
   * both portfolio charts and the breakdown table's total, so they always agree):
   *   endValue     = year-end portfolio value        (endAmount ÷ period-END rate)
   *   startValue   = previous year-end value          (continuity)
   *   contributions= contributions ÷ AVERAGE rate     (a flow)
   *   profit       = (endValue − startValue) − contributions   ← the residual
   * Deriving profit as a residual (rather than PLN-profit ÷ average rate) is the only
   * self-consistent choice in a non-PLN currency, because portfolio VALUE converts at the
   * period-end rate — so growth (= contributions + profit) always equals the real change
   * in value. In PLN every rate is 1, so this reduces to the raw Years-sheet numbers.
   */
  const getYearlyValueSeries = (cur: string) => {
    const out: { year: string; endValue: number; startValue: number; contributions: number; profit: number }[] = [];
    let prevEndValue: number | null = null;
    for (const row of yearsData) {
      const er = yearsRowRate(row, cur, 'end'), ar = yearsRowRate(row, cur, 'avg');
      if (!er || !ar) { prevEndValue = null; continue; } // skip if FX missing for this currency
      const endValue = row.endAmount / er;
      const startValue = prevEndValue != null ? prevEndValue : row.startAmount / er; // 1st year: own start
      const contributions = row.contributions / ar;
      const profit = (endValue - startValue) - contributions;
      const year = row.date.includes('-') ? row.date.split('-')[0] : row.date;
      out.push({ year, endValue, startValue, contributions, profit });
      prevEndValue = endValue;
    }
    return out;
  };

  /**
   * ============================================================
   * PROFIT BREAKDOWN BY ASSET — for a single calendar year
   * ============================================================
   *
   * Goal: take one year's total portfolio profit (the bar in the chart above)
   * and show, for each asset, a transparent worksheet of HOW that profit was
   * made — quantity, the price it started the year at, the price it ended at,
   * and the resulting profit — so you can eyeball that
   *      shares × (end price − start price) ≈ profit.
   *
   * To make that arithmetic tie out, each asset is broken into clean SEGMENTS,
   * because a single asset can have several stories in one year:
   *   • "Held from start"          — shares owned on 1 Jan and still held at year-end
   *                                  (start = last-Dec price, end = this-Dec price)
   *   • "Held from start · sold"   — shares owned on 1 Jan but sold during the year
   *                                  (start = last-Dec price, end = your sell price)
   *   • "Bought in <year>"         — shares bought this year and still held
   *                                  (start = your buy price, end = this-Dec price)
   *   • "Bought & sold <year>"     — bought and sold within the year
   *                                  (start = buy price, end = sell price)
   *   • "Income (div/interest)"    — dividends/interest earned that year (no price)
   *
   * WHY THE SEGMENTS ARE EXACT: every SALE in the data is already paired with its
   * exact BUY in the "Closed" sheet (one row = one complete buy→sell lot), and
   * shares still held are buy-only rows in the "Data" sheet. So each lot slots
   * cleanly into exactly one segment with no guesswork about which shares sold.
   *
   * CURRENCY: prices are shown in each asset's NATIVE currency (SGD, USD, PLN…),
   * so "shares × price change" ties out in that currency (the "Profit (native)"
   * column). The final "Profit (<selected>)" column converts each boundary at the
   * exchange rate of its own month — so it also captures the currency gain/loss.
   * The gap between the two columns IS the FX effect (mirrors the Positions tab).
   *
   * SCALE GUARD: a few legacy lots were traded on a different price scale than
   * their price-history column (e.g. an old cash line). We detect this per lot —
   * if the price feed at the buy month disagrees with the actual price paid by
   * more than ~3× — and drop that lot into "Other" rather than show a distorted
   * mark-to-market.
   *
   * OTHER = (total year profit) − (sum of all itemised assets). It absorbs
   * unpriced assets, cash, fees, and the guarded lots, and guarantees the table
   * reconciles exactly to the bar in the chart above. Undated dividends from
   * already-sold lots are spread evenly across the months held (chosen setting).
   */
  const getYearlyProfitBreakdown = (
    year: number,
    currency: string,
  ): YearlyProfitBreakdown => {   // the shape is defined beside the tab that shows it
    if (!assetData || assetData.length === 0 || yearsData.length === 0) {
      return { assets: [], other: 0, total: 0 };
    }

    // --- small local helpers (kept inside so the diff stays self-contained) ---

    // The monthly price row that best represents the END of calendar year `y`.
    // assetData is sorted oldest→newest, so the LAST row whose date starts with
    // "y-" is December of that year (or the latest available month for the
    // current, not-yet-finished year).
    const yearEndRow = (y: number): AssetRow | null => {
      let found: AssetRow | null = null;
      for (const row of assetData) {
        if (row.date.startsWith(`${y}-`)) found = row;
      }
      return found;
    };

    // The monthly price row for a given "YYYY-MM" month (used to grab the FX rate
    // in the month a buy/sell/dividend happened). Falls back to the most recent
    // earlier month if that exact month is missing.
    const rowForYM = (ym: string): AssetRow | null => {
      let carry: AssetRow | null = null;
      for (const row of assetData) {
        const rym = toYM(new Date(row.date));
        if (rym === ym) return row;
        if (rym < ym) carry = row;
      }
      return carry;
    };

    // Does the price feed contain any price for this ticker at all? If not, the
    // asset is "not in quotes" and everything about it flows into "Other".
    const isPriced = (ticker: string): boolean => {
      for (const row of assetData) {
        const p = Number(row[ticker]);
        if (p && p > 0) return true;
      }
      return false;
    };

    // List of "YYYY-MM" months between two dates, inclusive — used to spread the
    // lifetime dividends of a closed lot evenly across the months it was held.
    const monthsInclusive = (startDate: string, endDate: string): string[] => {
      const s = new Date(startDate);
      const e = new Date(endDate);
      if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) return [];
      const out: string[] = [];
      let y = s.getFullYear();
      let m = s.getMonth();
      const ey = e.getFullYear();
      const em = e.getMonth();
      while (y < ey || (y === ey && m <= em)) {
        out.push(`${y}-${String(m + 1).padStart(2, '0')}`);
        m++;
        if (m > 11) { m = 0; y++; }
      }
      return out;
    };

    // The native price of `ticker` in the monthly row for month `ym` (0 if none).
    const priceAtYM = (ticker: string, ym: string): number => {
      const row = rowForYM(ym);
      if (!row) return 0;
      const p = Number(row[ticker]);
      return p > 0 ? p : 0;
    };

    // Convert a native-currency cash amount to `currency` using the FX rate that
    // applied in month `ym` (falls back to year-end FX if the month is missing).
    const cashAt = (ym: string, native: string, amount: number): number => {
      const row = rowForYM(ym) || thisYearEndRow || prevYearEndRow;
      if (!row) return amount;
      return amount * getConversionRate(row, native, currency);
    };

    const prevYearEndRow = yearEndRow(year - 1); // ≈ 31 Dec of the previous year
    const thisYearEndRow = yearEndRow(year);     // end of this year (or latest month)
    const divConvRow = thisYearEndRow || prevYearEndRow; // FX used for spread dividends

    // Collect every ticker that had any purchase or closed-lot activity.
    const tickerSet = new Set<string>();
    for (const t of transactionData) if (t.flow === FLOW_PURCHASE && t.ticker) tickerSet.add(t.ticker);
    for (const c of closedData) if (c.ticker) tickerSet.add(c.ticker);

    const assets: {
      ticker: string; name: string; nativeCurrency: string;
      totalNative: number; totalConverted: number; totalFx: number;
      retNative: number | null; retConverted: number | null;
      startValue: number; endValue: number;
      segments: {
        label: string; shares: number | null;
        startPrice: number | null; startTag: string;
        endPrice: number | null; endTag: string;
        startValue: number | null; endValue: number | null;
        profitNative: number; profitConverted: number;
        fxEffect: number;
        retNative: number | null; retConverted: number | null;
      }[];
    }[] = [];

    for (const ticker of Array.from(tickerSet)) {
      if (!isPriced(ticker)) continue; // unpriced assets → left for "Other"

      const native = getAssetCurrency(ticker);
      // Only lots that are STILL HELD. Anything sold is accounted for by closedLots
      // below, which knows the sale year and drops the lot from years after it. Reading
      // raw purchase rows here instead would book a 2020 purchase of a holding sold in
      // 2025 as "held from start" of 2026 — an asset that contributed nothing that year.
      const openLots = getOpenPurchases(ticker);
      const closedLots = closedData.filter(c => c.ticker === ticker);
      // Income on the shares still held. Payments that belonged to sold shares travel
      // with their round trip and are spread over the holding period further down, so
      // taking every dividend row here would count them twice.
      const dividends = getOpenDividends(ticker);

      // Native prices + FX at the two year boundaries.
      const pPrev = prevYearEndRow ? Number(prevYearEndRow[ticker]) || 0 : 0; // 31 Dec Y−1
      const pEnd = thisYearEndRow ? Number(thisYearEndRow[ticker]) || 0 : 0;  // 31 Dec Y / latest
      const fxPrev = prevYearEndRow ? getConversionRate(prevYearEndRow, native, currency) : 1;
      const fxEnd = thisYearEndRow ? getConversionRate(thisYearEndRow, native, currency) : 1;

      // Scale guard: is a lot's traded per-share price consistent with the price
      // feed at its buy month? (Guards against legacy scale mismatches.)
      const consistent = (perShare: number, buyYM: string): boolean => {
        const p = priceAtYM(ticker, buyYM);
        if (!p || !perShare) return false;
        const r = p / perShare;
        return r >= 1 / 3 && r <= 3;
      };

      // Segment accumulators (all in native currency; *C = converted to `currency`).
      const A = { sh: 0 };                                          // held from start, still held
      const B = { sh: 0, procN: 0, procC: 0 };                      // held from start, sold in year
      const C = { sh: 0, costN: 0, costC: 0 };                      // bought in year, still held
      const D = { sh: 0, costN: 0, costC: 0, procN: 0, procC: 0 };  // bought & sold in year
      let incN = 0, incC = 0;                                       // income (dividends/interest)
      // Units that shares held from the start of the year gave up to fees paid in units
      // during it (Endowus). They were worth pPrev each on 1 Jan and are gone by 31 Dec,
      // so they cost the year exactly that. Shares BOUGHT this year need no such line:
      // their cost is already counted in full and only the survivors are valued at the end.
      const F = { sh: 0 };
      // Fee cut-offs: a fee taken by 31 Dec has happened in this year's picture
      const yStartIso = `${year - 1}-12-31`, yEndIso = `${year}-12-31`;

      // --- Open lots (still held, buy-only) ---
      for (const lot of openLots) {
        const buyD = new Date(lot.date);
        if (isNaN(buyD.getTime())) continue;
        const buyYear = buyD.getFullYear();
        if (buyYear > year) continue; // not bought yet
        const perShare = lot.qty > 0 ? lot.amount / lot.qty : 0;
        if (!consistent(perShare, toYM(buyD))) continue; // guarded → Other
        // Shares count as held on 31 Dec of this year: what was bought, less any units given
        // up to fees by then (equal to lot.qty for almost every lot)
        if (buyYear < year) {
          A.sh += heldQty(lot, yEndIso);
          F.sh += unitFeeQty(lot.unitFees, yEndIso) - unitFeeQty(lot.unitFees, yStartIso);
        } else {
          C.sh += heldQty(lot, yEndIso);
          C.costN += lot.amount;
          C.costC += lot.amount * getConversionRate(rowForYM(toYM(buyD)) || thisYearEndRow!, native, currency);
        }
      }

      // --- Closed lots (complete buy→sell records) ---
      for (const c of closedLots) {
        const buyD = new Date(c.invDate);
        const sellD = new Date(c.divDate);
        if (isNaN(buyD.getTime()) || isNaN(sellD.getTime())) continue;
        const buyYear = buyD.getFullYear();
        const sellYear = sellD.getFullYear();
        const perShare = c.sharesSold > 0 ? c.initialCost / c.sharesSold : 0;
        const ok = consistent(perShare, toYM(buyD));

        // Capital contribution to year Y (only if the lot was alive in Y and passes the guard).
        if (ok && !(sellYear < year || buyYear > year)) {
          // Units this lot still gave up to fees paid in units AFTER 31 Dec of this year: it
          // held them on that date, on top of what it finally sold (0 for almost every lot)
          const feeUnitsAfterYear = unitFeeQty(c.unitFees) - unitFeeQty(c.unitFees, yEndIso);
          // ...and the ones it gave up during this year, if it was held from the start
          if (buyYear < year) F.sh += unitFeeQty(c.unitFees, yEndIso) - unitFeeQty(c.unitFees, yStartIso);
          if (buyYear < year && sellYear > year) {
            A.sh += c.sharesSold + feeUnitsAfterYear;                 // held all year
          } else if (buyYear < year && sellYear === year) {
            B.sh += c.sharesSold;                                     // opening, sold this year
            B.procN += c.valueAfterFee;
            B.procC += c.valueAfterFee * getConversionRate(rowForYM(toYM(sellD)) || thisYearEndRow!, native, currency);
          } else if (buyYear === year && sellYear > year) {
            C.sh += c.sharesSold + feeUnitsAfterYear;                 // bought this year, still held
            C.costN += c.initialCost;
            C.costC += c.initialCost * getConversionRate(rowForYM(toYM(buyD)) || thisYearEndRow!, native, currency);
          } else if (buyYear === year && sellYear === year) {
            D.sh += c.sharesSold;                                     // bought & sold this year
            D.costN += c.initialCost;
            D.costC += c.initialCost * getConversionRate(rowForYM(toYM(buyD)) || thisYearEndRow!, native, currency);
            D.procN += c.valueAfterFee;
            D.procC += c.valueAfterFee * getConversionRate(rowForYM(toYM(sellD)) || thisYearEndRow!, native, currency);
          }
        }

        // Dividends/interest for this sold lot.
        // Preferred: the actual payments, on the dates they were actually paid — the
        // ledger records them, so year Y gets exactly what year Y received.
        // Fallback (legacy Exit tab, which only stored a lifetime total): spread that
        // total evenly across the months held and take year Y's share. That estimate
        // is why 2023 used to read 935 for ES3TR when the real figure was 1,064.
        if (c.incomeEvents) {
          for (const e of c.incomeEvents) {
            if (!e.date.startsWith(`${year}-`)) continue;
            incN += e.amount;
            incC += cashAt(e.date.slice(0, 7), native, e.amount);
          }
        } else if (c.cumDividend) {
          const months = monthsInclusive(c.invDate, c.divDate);
          if (months.length > 0) {
            const k = months.filter(ym => ym.startsWith(`${year}-`)).length;
            if (k > 0) {
              const divNativeY = (c.cumDividend * k) / months.length;
              incN += divNativeY;
              incC += divConvRow ? divNativeY * getConversionRate(divConvRow, native, currency) : divNativeY;
            }
          }
        }
      }

      // --- Dated dividends on current holdings (Data sheet) ---
      for (const d of dividends) {
        const dD = new Date(d.date);
        if (isNaN(dD.getTime()) || dD.getFullYear() !== year) continue;
        incN += d.amount;
        incC += cashAt(toYM(dD), native, d.amount);
      }

      // --- Build the segment rows from the accumulators ---
      // Helper: assemble one segment, deriving its % returns and its FX slice.
      //  • baseNative / baseConverted = the capital that was "at work" for this
      //    segment (start value for held shares, cash cost for bought shares).
      //  • % return = profit ÷ that base, in each currency.
      //  • fxEffect = the part of the converted profit due to the exchange rate
      //    moving (converted profit − the native profit valued at the entry rate).
      type Seg = typeof assets[number]['segments'][number];
      const mkSeg = (
        label: string, shares: number | null,
        startPrice: number | null, startTag: string,
        endPrice: number | null, endTag: string,
        startValue: number | null, endValue: number | null,
        profitNative: number, profitConverted: number,
        baseNative: number, baseConverted: number,
        fxStartRate: number, // rate to value native profit "locally" (no FX move)
      ): Seg => ({
        label, shares, startPrice, startTag, endPrice, endTag, startValue, endValue,
        profitNative, profitConverted,
        fxEffect: profitConverted - profitNative * fxStartRate,
        retNative: Math.abs(baseNative) > 1e-9 ? (profitNative / baseNative) * 100 : null,
        retConverted: Math.abs(baseConverted) > 1e-9 ? (profitConverted / baseConverted) * 100 : null,
      });

      const segments: Seg[] = [];
      let baseNativeTot = 0, baseConvTot = 0; // capital base for the whole-asset % return
      if (A.sh > 1e-9) {
        const bN = A.sh * pPrev, bC = A.sh * pPrev * fxPrev;
        baseNativeTot += bN; baseConvTot += bC;
        segments.push(mkSeg('Held from start', A.sh, pPrev, `Dec ${year - 1}`, pEnd, `Dec ${year}`,
          A.sh * pPrev, A.sh * pEnd,
          A.sh * (pEnd - pPrev), A.sh * (pEnd * fxEnd - pPrev * fxPrev), bN, bC, fxPrev));
      }
      if (B.sh > 1e-9) {
        const bN = B.sh * pPrev, bC = B.sh * pPrev * fxPrev;
        baseNativeTot += bN; baseConvTot += bC;
        segments.push(mkSeg('Held from start · sold', B.sh, pPrev, `Dec ${year - 1}`, B.procN / B.sh, 'sold',
          B.sh * pPrev, B.procN,
          B.procN - B.sh * pPrev, B.procC - B.sh * pPrev * fxPrev, bN, bC, fxPrev));
      }
      if (C.sh > 1e-9) {
        const bN = C.costN, bC = C.costC;
        baseNativeTot += bN; baseConvTot += bC;
        segments.push(mkSeg(`Bought in ${year}`, C.sh, C.costN / C.sh, 'buy', pEnd, `Dec ${year}`,
          C.costN, C.sh * pEnd,
          C.sh * pEnd - C.costN, C.sh * pEnd * fxEnd - C.costC, bN, bC, C.costN > 0 ? C.costC / C.costN : fxEnd));
      }
      if (D.sh > 1e-9) {
        const bN = D.costN, bC = D.costC;
        baseNativeTot += bN; baseConvTot += bC;
        segments.push(mkSeg(`Bought & sold ${year}`, D.sh, D.costN / D.sh, 'buy', D.procN / D.sh, 'sold',
          D.costN, D.procN,
          D.procN - D.costN, D.procC - D.costC, bN, bC, D.costN > 0 ? D.costC / D.costN : fxEnd));
      }
      if (F.sh > 1e-9) {
        // Fees paid in units by shares held since 1 Jan: worth pPrev each then, gone now.
        // Their start value counts in the capital base, like any other share held on 1 Jan.
        const bN = F.sh * pPrev, bC = F.sh * pPrev * fxPrev;
        baseNativeTot += bN; baseConvTot += bC;
        segments.push(mkSeg('Fees paid in units', F.sh, pPrev, `Dec ${year - 1}`, null, 'fee',
          F.sh * pPrev, 0,
          -bN, -bC, bN, bC, fxPrev));
      }
      if (Math.abs(incN) > 0.005 || Math.abs(incC) > 0.005) {
        // Income has no capital base of its own (it's a yield on the holding), so
        // leave its % and value blank; value it locally at the start-of-year rate for FX.
        segments.push(mkSeg('Income (div/interest)', null, null, '', null, '', null, null, incN, incC, 0, 0, fxPrev));
      }

      if (segments.length === 0) continue;

      const totalNative = segments.reduce((s, x) => s + x.profitNative, 0);
      const totalConverted = segments.reduce((s, x) => s + x.profitConverted, 0);
      const totalFx = segments.reduce((s, x) => s + x.fxEffect, 0);
      const startValue = segments.reduce((s, x) => s + (x.startValue ?? 0), 0);
      const endValue = segments.reduce((s, x) => s + (x.endValue ?? 0), 0);
      const name = assetLookup.find(a => a.ticker === ticker)?.name || ticker;
      assets.push({
        ticker, name, nativeCurrency: native,
        totalNative, totalConverted, totalFx,
        retNative: Math.abs(baseNativeTot) > 1e-9 ? (totalNative / baseNativeTot) * 100 : null,
        retConverted: Math.abs(baseConvTot) > 1e-9 ? (totalConverted / baseConvTot) * 100 : null,
        startValue, endValue,
        segments,
      });
    }

    // Biggest contributor first (losers sink to the bottom).
    assets.sort((a, b) => b.totalConverted - a.totalConverted);

    const sumConverted = assets.reduce((s, a) => s + a.totalConverted, 0);

    // Value-consistent total profit in the selected currency — taken straight from the
    // shared per-year series, so it's identical to the "Contributions and Profit by Year"
    // chart's bar for this year. (profit = end value − start value − contributions; in PLN
    // that's exactly the Years-sheet profit.) This replaces the old "PLN profit ÷ average
    // rate" total, which mixed conversion methods and made "Other" implausible in non-PLN.
    const total = getYearlyValueSeries(currency).find(s => s.year === `${year}`)?.profit ?? 0;

    // Everything not itemised (unpriced/guarded assets, cash, fees, timing) = the residual.
    const other = total - sumConverted;

    return { assets, other, total };
  };

  // The years the breakdown table can show (newest first), and the resolved selection
  // (the user's pick, else the latest year). Cheap, but memoised so the value below is stable.
  const breakdownYears = useMemo(
    () => Array.from(new Set(
      yearsData.map(r => parseInt(r.date.slice(0, 4), 10)).filter(y => !isNaN(y))
    )).sort((a, b) => b - a),
    [yearsData],
  );
  const resolvedBreakdownYear = (breakdownYear != null && breakdownYears.includes(breakdownYear))
    ? breakdownYear
    : (breakdownYears[0] ?? null);

  // getYearlyProfitBreakdown is the heaviest per-render computation (per-asset lot walk over
  // the transaction + closed sheets). Memoise it on its real inputs so it only recomputes when
  // the data, the selected year, or the currency actually change — not on every re-render.
  const breakdownData = useMemo(
    () => (resolvedBreakdownYear == null
      ? { assets: [] as ReturnType<typeof getYearlyProfitBreakdown>['assets'], other: 0, total: 0 }
      : getYearlyProfitBreakdown(resolvedBreakdownYear, portfolioCurrency)),
    // Everything the function reads (checked 2026-11-13). positionsModel was missing: it feeds
    // the open purchases and dividends, and only worked because it changes alongside transactionData.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedBreakdownYear, portfolioCurrency, yearsData, assetData, transactionData, closedData, assetLookup, positionsModel],
  );

  // formatPrice now lives at module scope (see the top of this file) so the shared
  // Positions components can reach it too, and there is exactly one price rule.

  /**
   * Runs the backtest for all configured portfolios
   */
  const runBacktest = () => {
    if (!assetData) {
      alert('Please wait for data to load');
      return;
    }

    // Calculate returns for each portfolio
    const results = portfolios.map(portfolio => {
      const returns = calculatePortfolioReturns(portfolio, assetData);
      const stats = calculateStatistics(returns, portfolio);
      // A value of zero can only come from the liquidation guard in calculatePortfolioReturns
      // (a normal portfolio always has some value left), so the first zero is the wipeout date.
      const wipedOutDate = returns?.find(r => r.value <= 0)?.date ?? null;
      return { portfolio, returns: returns!, stats: stats!, wipedOutDate };
    }).filter(r => r.returns !== null);  // Filter out invalid portfolios

    if (results.length === 0) {
      alert('No valid portfolios. Make sure weights sum to 100%');
      return;
    }

    setBacktestResults(results);
  };

  // ----------------------------------------
  // BACKTEST X-AXIS CONFIGURATION
  // ----------------------------------------
  // Dynamically adjusts X-axis ticks and label format based on the selected period length:
  //   > 9 years  → one tick per year,  label = "YYYY"
  //   3–9 years  → two ticks per year, label = "YYYY" + "MMM" (two lines)
  //   1–3 years  → four ticks per year, label = "YYYY" + "MMM" (two lines)
  //   ≤ 1 year   → every month,        label = "MmmYY"

  const backtestXAxisConfig = useMemo(() => {
    if (!backtestResults || backtestResults.length === 0) return { ticks: undefined as string[] | undefined, periodYears: 0 };

    // Grab dates from the first portfolio's returns (all portfolios share the same date range)
    const dates = backtestResults[0].returns.map(r => r.date);
    if (dates.length < 2) return { ticks: undefined as string[] | undefined, periodYears: 0 };

    const startDate = new Date(dates[0]);
    const endDate = new Date(dates[dates.length - 1]);
    const periodYears = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

    // Pick which dates to show as tick marks
    const tickDates: string[] = [];

    if (periodYears > 9) {
      // One tick per year — pick the first available date in each calendar year
      const seenYears = new Set<number>();
      for (const d of dates) {
        const year = new Date(d).getUTCFullYear();
        if (!seenYears.has(year)) {
          seenYears.add(year);
          tickDates.push(d);
        }
      }
    } else if (periodYears > 3) {
      // Two ticks per year — first available date in each half-year (Jan–Jun, Jul–Dec)
      const seen = new Set<string>();
      for (const d of dates) {
        const dt = new Date(d);
        const half = dt.getUTCMonth() < 6 ? 'H1' : 'H2';
        const key = `${dt.getUTCFullYear()}-${half}`;
        if (!seen.has(key)) {
          seen.add(key);
          tickDates.push(d);
        }
      }
    } else if (periodYears > 1) {
      // Four ticks per year — first available date in each quarter
      const seen = new Set<string>();
      for (const d of dates) {
        const dt = new Date(d);
        const quarter = Math.floor(dt.getUTCMonth() / 3);
        const key = `${dt.getUTCFullYear()}-Q${quarter}`;
        if (!seen.has(key)) {
          seen.add(key);
          tickDates.push(d);
        }
      }
    } else {
      // Every month
      const seen = new Set<string>();
      for (const d of dates) {
        const dt = new Date(d);
        const key = `${dt.getUTCFullYear()}-${dt.getUTCMonth()}`;
        if (!seen.has(key)) {
          seen.add(key);
          tickDates.push(d);
        }
      }
    }

    return { ticks: tickDates, periodYears };
  }, [backtestResults]);

  // Custom tick renderer for the three backtest line charts.
  // Format changes based on the period length computed above.
  const BacktestDateTick = useMemo(() => {
    const py = backtestXAxisConfig.periodYears;
    return ({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => {
      const d = new Date(payload.value);
      if (isNaN(d.getTime())) {
        return <text x={x} y={y} textAnchor="middle" fontSize={9} fill={MUTED}>{payload.value}</text>;
      }
      if (py > 9) {
        // Long period — just the four-digit year
        return (
          <text x={x} y={y} textAnchor="middle" fontSize={9} fill={MUTED}>
            <tspan x={x} dy="0.8em">{d.getUTCFullYear()}</tspan>
          </text>
        );
      }
      if (py <= 1) {
        // Short period — compact "Jan26" format
        const yy = String(d.getUTCFullYear()).slice(-2);
        return (
          <text x={x} y={y} textAnchor="middle" fontSize={9} fill={MUTED}>
            <tspan x={x} dy="0.8em">{MONTH_ABBR[d.getUTCMonth()]}{yy}</tspan>
          </text>
        );
      }
      // Medium period (1–9 years) — year on top, month abbreviation below
      return (
        <text x={x} y={y} textAnchor="middle" fontSize={9} fill={MUTED}>
          <tspan x={x} dy="0.5em">{d.getUTCFullYear()}</tspan>
          <tspan x={x} dy="1.2em">{MONTH_ABBR[d.getUTCMonth()]}</tspan>
        </text>
      );
    };
  }, [backtestXAxisConfig.periodYears]);

  // ----------------------------------------
  // ASSET FILTER CONTROLS COMPONENT
  // ----------------------------------------
  // This is a reusable component that renders three compact collapsible filter dropdowns
  // (Assets, Asset Class, Currency) used in Annual Returns, Best To Worst, and Monthly Prices tabs

  const AssetFilterControls = ({ children }: { children?: React.ReactNode }) => {
    // Ref for click-outside detection
    const filterRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        // A tap inside the phone's slide-up panel isn't "outside": the panel lives elsewhere on the page
        if ((event.target as Element).closest?.('[role="dialog"]')) return;
        if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
          setOpenFilterDropdown(null);
        }
      };

      // Only add listener when a dropdown is open
      if (openFilterDropdown) {
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
      }
      // The checker calls this dependency pointless because AssetFilterControls is defined inside
      // the main component (it is rebuilt on every render). Kept until it moves into its own file.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openFilterDropdown]);

    // Get the unique values for each dropdown
    const assetClasses = getUniqueAssetClasses();
    const currencies = getUniqueCurrencies();
    const assetSubcategories = getUniqueAssetSubcategories();

    // Check if all items are selected (to show "Deselect All" vs "Select All")
    const allAssetsSelected = selectedAssetTickers.length === assetLookup.length;
    const allClassesSelected = selectedAssetClasses.length === assetClasses.length;
    const allCurrenciesSelected = selectedCurrencies.length === currencies.length;
    const allSubcategoriesSelected = selectedAssetSubcategories.length === assetSubcategories.length;

    // Helper to get display text for the dropdown button
    const getSelectionText = (selected: number, total: number, label: string) => {
      if (selected === total) return 'All';
      if (selected === 0) return `No ${label}`;
      return `${selected} of ${total}`;
    };

    // PHONES: the four filter buttons become two-line boxes on a 2×2 grid, like the other choice
    // boxes on a phone ("phone-filter-grid" / "phone-filter-box" in globals.css). Their checkbox
    // lists are hidden there ("max-md:hidden"): a phone gets the same list as a slide-up panel
    // instead, like every other choice (drawn next to <PhoneSelectSheets /> at the bottom).
    // On desktop the grid wrapper is "contents": it vanishes and the buttons sit in the row as before.
    return (
      <div ref={filterRef} className="flex flex-wrap gap-2 mb-4">
        <div className="contents phone-filter-grid">
        {/* Assets Dropdown */}
        <div className="relative">
          <button
            onClick={() => setOpenFilterDropdown(openFilterDropdown === 'assets' ? null : 'assets')}
            className={`phone-filter-box h-8 px-3 text-xs border rounded-lg flex items-center gap-2 max-md:h-auto max-md:py-1.5 max-md:text-sm ${
              openFilterDropdown === 'assets' ? 'border-slate-400 bg-gray-100' : 'border-gray-300 bg-white hover:bg-gray-50'
            }`}
          >
            <span className="font-medium">Assets<span className="max-md:hidden">:</span></span>
            <span className="text-gray-600">{getSelectionText(selectedAssetTickers.length, assetLookup.length, 'assets')}</span>
            <svg className={`w-4 h-4 transition-transform ${openFilterDropdown === 'assets' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openFilterDropdown === 'assets' && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-300 rounded-lg shadow-lg min-w-[280px] max-md:hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                <span className="text-sm font-medium text-gray-700">Select Assets</span>
                <button
                  onClick={() => toggleAllAssets(!allAssetsSelected)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {allAssetsSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto p-2">
                {assetLookup.map(asset => (
                  <label key={asset.ticker} className="flex items-center gap-2 py-1 px-2 text-sm cursor-pointer hover:bg-gray-100 rounded">
                    <input
                      type="checkbox"
                      checked={selectedAssetTickers.includes(asset.ticker)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedAssetTickers([...selectedAssetTickers, asset.ticker]);
                        } else {
                          setSelectedAssetTickers(selectedAssetTickers.filter(t => t !== asset.ticker));
                        }
                      }}
                    />
                    <span>{asset.ticker} - {asset.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Asset Class Dropdown */}
        <div className="relative">
          <button
            onClick={() => setOpenFilterDropdown(openFilterDropdown === 'assetClass' ? null : 'assetClass')}
            className={`phone-filter-box h-8 px-3 text-xs border rounded-lg flex items-center gap-2 max-md:h-auto max-md:py-1.5 max-md:text-sm ${
              openFilterDropdown === 'assetClass' ? 'border-slate-400 bg-gray-100' : 'border-gray-300 bg-white hover:bg-gray-50'
            }`}
          >
            <span className="font-medium">Class<span className="max-md:hidden">:</span></span>
            <span className="text-gray-600">{getSelectionText(selectedAssetClasses.length, assetClasses.length, 'classes')}</span>
            <svg className={`w-4 h-4 transition-transform ${openFilterDropdown === 'assetClass' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openFilterDropdown === 'assetClass' && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-300 rounded-lg shadow-lg min-w-[200px] max-md:hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                <span className="text-sm font-medium text-gray-700">Select Classes</span>
                <button
                  onClick={() => toggleAllAssetClasses(!allClassesSelected)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {allClassesSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto p-2">
                {assetClasses.map(assetClass => (
                  <label key={assetClass} className="flex items-center gap-2 py-1 px-2 text-sm cursor-pointer hover:bg-gray-100 rounded">
                    <input
                      type="checkbox"
                      checked={selectedAssetClasses.includes(assetClass)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedAssetClasses([...selectedAssetClasses, assetClass]);
                        } else {
                          setSelectedAssetClasses(selectedAssetClasses.filter(c => c !== assetClass));
                        }
                      }}
                    />
                    <span>{assetClass}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Currency Dropdown */}
        <div className="relative">
          <button
            onClick={() => setOpenFilterDropdown(openFilterDropdown === 'currency' ? null : 'currency')}
            className={`phone-filter-box h-8 px-3 text-xs border rounded-lg flex items-center gap-2 max-md:h-auto max-md:py-1.5 max-md:text-sm ${
              openFilterDropdown === 'currency' ? 'border-slate-400 bg-gray-100' : 'border-gray-300 bg-white hover:bg-gray-50'
            }`}
          >
            <span className="font-medium">Currency<span className="max-md:hidden">:</span></span>
            <span className="text-gray-600">{getSelectionText(selectedCurrencies.length, currencies.length, 'currencies')}</span>
            <svg className={`w-4 h-4 transition-transform ${openFilterDropdown === 'currency' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openFilterDropdown === 'currency' && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-300 rounded-lg shadow-lg min-w-[160px] max-md:hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                <span className="text-sm font-medium text-gray-700">Select Currencies</span>
                <button
                  onClick={() => toggleAllCurrencies(!allCurrenciesSelected)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {allCurrenciesSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto p-2">
                {currencies.map(currency => (
                  <label key={currency} className="flex items-center gap-2 py-1 px-2 text-sm cursor-pointer hover:bg-gray-100 rounded">
                    <input
                      type="checkbox"
                      checked={selectedCurrencies.includes(currency)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedCurrencies([...selectedCurrencies, currency]);
                        } else {
                          setSelectedCurrencies(selectedCurrencies.filter(c => c !== currency));
                        }
                      }}
                    />
                    <span>{currency}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* Asset Subcategory Dropdown */}
        {assetSubcategories.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setOpenFilterDropdown(openFilterDropdown === 'assetSubcategory' ? null : 'assetSubcategory')}
              className={`phone-filter-box h-8 px-3 text-xs border rounded-lg flex items-center gap-2 max-md:h-auto max-md:py-1.5 max-md:text-sm ${
                openFilterDropdown === 'assetSubcategory' ? 'border-slate-400 bg-gray-100' : 'border-gray-300 bg-white hover:bg-gray-50'
              }`}
            >
              <span className="font-medium">Subcategory<span className="max-md:hidden">:</span></span>
              <span className="text-gray-600">{getSelectionText(selectedAssetSubcategories.length, assetSubcategories.length, 'subcategories')}</span>
              <svg className={`w-4 h-4 transition-transform ${openFilterDropdown === 'assetSubcategory' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {openFilterDropdown === 'assetSubcategory' && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-300 rounded-lg shadow-lg min-w-[220px] max-md:hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                  <span className="text-sm font-medium text-gray-700">Select Subcategories</span>
                  <button
                    onClick={() => toggleAllAssetSubcategories(!allSubcategoriesSelected)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {allSubcategoriesSelected ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto p-2">
                  {assetSubcategories.map(subcategory => (
                    <label key={subcategory} className="flex items-center gap-2 py-1 px-2 text-sm cursor-pointer hover:bg-gray-100 rounded">
                      <input
                        type="checkbox"
                        checked={selectedAssetSubcategories.includes(subcategory)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedAssetSubcategories([...selectedAssetSubcategories, subcategory]);
                          } else {
                            setSelectedAssetSubcategories(selectedAssetSubcategories.filter(s => s !== subcategory));
                          }
                        }}
                      />
                      <span>{subcategory}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        </div>

        {/* Extra controls passed in as children (e.g., Years filter) — rendered after Subcategory */}
        {children}
      </div>
    );
  };

  // ----------------------------------------
  // RENDER THE UI
  // ----------------------------------------



  // EDO bonds held (Lookup tickers named like a series, e.g. "EDO0734") get their price from the
  // EDO tab. If that tab failed to load, say so on the pages that value them, rather than letting
  // the holding quietly show no price.
  const heldEdoTickers = assetLookup.map(a => a.ticker).filter(t => /^EDO\d{4}$/.test(t));
  const edoMissingBanner = !edoData && heldEdoTickers.length > 0 ? (
    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      The EDO tab didn&apos;t load, so {heldEdoTickers.join(', ')} {heldEdoTickers.length === 1 ? 'has' : 'have'} no price
      below. Press Refresh Data to try again.
    </div>
  ) : null;

  // Every view, in menu order. The sidebar (wide screens) and the slide-in drawer (narrow
  // screens) are both drawn from this one list, so they can never disagree.
  // Each has a small icon drawn to the left of its label.
  const NAV_VIEWS: { view: typeof activeView; label: string; icon: React.ElementType }[] = [
    { view: 'backtest', label: 'Backtest', icon: FlaskConical },
    { view: 'markets', label: 'Markets', icon: Globe },
    { view: 'portfolio', label: 'Portfolio', icon: Briefcase },
    { view: 'positions', label: 'Positions', icon: Layers },
    { view: 'monthlyPrices', label: 'Monthly', icon: CalendarDays },
    { view: 'annualReturns', label: 'Annual', icon: CalendarRange },
    { view: 'bestToWorst', label: 'Best To Worst', icon: ArrowDownWideNarrow },
    { view: 'graphs', label: 'Graphs', icon: LineChartIcon },
    { view: 'trendFollowing', label: 'Trend Following', icon: TrendingUp },
    { view: 'correlationMatrix', label: 'Correlations', icon: Grid3x3 },
  ];
  // Sections INSIDE a view, always listed indented under it in the left panel (clicking one
  // opens that view at that section): the left panel is for moving between pages and sections,
  // the top of each page for filtering what is on it. To give another view sections, add a case here.
  //   Markets      — its categories, straight from the sheet's SnapshotCategory column
  //   Best To Worst — the one-year Ranking table or the multi-year Return Map
  const navSections = (view: typeof activeView): { items: { key: string; label: string }[]; active: string; select: (key: string) => void } | null => {
    if (view === 'markets') {
      return {
        items: marketsCategories.map(c => ({ key: c, label: c })),
        active: activeMarketsCategory,
        select: setMarketsCategory,
      };
    }
    if (view === 'bestToWorst') {
      return {
        items: [{ key: 'ranking', label: 'Ranking' }, { key: 'map', label: 'Return Map' }],
        active: bestToWorstLayout,
        select: key => setBestToWorstLayout(key as 'ranking' | 'map'),
      };
    }
    return null;
  };

  // The list of view buttons, shared by the sidebar and the drawer. Choosing one also closes
  // the drawer (harmless on wide screens, where it is never open).
  // Dark panel look: the open view is a white "pill" with dark text; the others are light grey
  // text that brightens on hover. A section counts as selected only while its own view is open.
  const navList = (
    <div className="flex flex-col gap-1">
      {NAV_VIEWS.map(({ view, label, icon: Icon }) => {
        const sections = navSections(view);
        const isActive = activeView === view;
        return (
          <React.Fragment key={view}>
            <button
              type="button"
              onClick={() => { setActiveView(view); setNavOpen(false); }}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center gap-2 text-left px-2.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-slate-700' : 'text-slate-400'}`} />
              {label}
            </button>
            {sections && sections.items.length > 0 && (
              <div className="flex flex-col gap-0.5 ml-[18px] pl-2 border-l border-white/10 mb-1">
                {sections.items.map(s => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => { setActiveView(view); sections.select(s.key); setNavOpen(false); }}
                    aria-current={isActive && sections.active === s.key ? 'true' : undefined}
                    // Markets' names come from the sheet, so a long one is cut with "…" (full name on hover)
                    // rather than pushing past the edge of the narrow panel.
                    title={s.label}
                    className={`w-full text-left px-2 py-1 rounded-md text-sm font-medium truncate transition-colors ${
                      isActive && sections.active === s.key
                        ? 'bg-white/10 text-white'
                        : 'text-slate-400 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );

  // Dark / light mode switch: a small icon-only button. Sits beside Refresh Data in the sidebar and
  // beside the close button in the narrow-screen drawer, and beside the title of the phone's page
  // menu (className gives each spot its own look).
  // The icon shows the mode it switches TO (moon = go dark, sun = go light).
  // Both icons are always there and the "dark:" classes show the right one straight from the class
  // on <html>, so a reload in dark mode shows the sun from the very first frame (no moon flicker
  // while React catches up). For screen readers it's an on/off switch with a fixed name: "Dark
  // mode, pressed" means dark mode is on.
  const themeToggle = (className: string) => (
    <button
      type="button"
      onClick={toggleDarkMode}
      aria-pressed={darkMode}
      aria-label="Dark mode"
      title="Dark mode"
      className={`shrink-0 rounded-lg transition-colors ${className}`}
    >
      <Moon className="w-4 h-4 dark:hidden" />
      <Sun className="w-4 h-4 hidden dark:block" />
    </button>
  );

  // Footer card at the bottom of the menu: how fresh the data is.
  //   "Data as of" — the last row of the Daily sheet, so a sheet that stopped updating shows up
  //                  here even after a fresh fetch. (Its pre-filled future rows are already
  //                  dropped when it is read, in lib/fetchData.ts.) If the Daily tab failed, the
  //                  price sheet's last row instead — capped at today, because that row is labelled
  //                  with the current month's END date while holding month-to-date prices.
  //   "Fetched"    — when the app last pulled from Google. Always with its date, so a page left
  //                  open overnight can't pass yesterday's fetch off as today's.
  const fmtNavDate = (iso: string) => {
    // Built from the "YYYY-MM-DD" parts directly, so no timezone can shift it by a day
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${MONTH_LABELS[m - 1]} ${y}`;
  };
  const navToday = localTodayIso();
  const lastPriceDate = assetData && assetData.length > 0 ? assetData[assetData.length - 1].date : '';
  const latestDataDate = dailyData.length > 0
    ? dailyData[dailyData.length - 1].date
    : lastPriceDate && lastPriceDate > navToday ? navToday : lastPriceDate;
  const fetchedLabel = lastFetchedAt
    ? `${lastFetchedAt.getDate()} ${MONTH_LABELS[lastFetchedAt.getMonth()]} `
      + lastFetchedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '';
  const navFooter = latestDataDate ? (
    <div className="mt-2 shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">Data as of</div>
      <div className="text-lg leading-tight text-white whitespace-nowrap">{fmtNavDate(latestDataDate)}</div>
      {fetchedLabel && <div className="mt-0.5 text-[11px] text-slate-400 whitespace-nowrap">Fetched {fetchedLabel}</div>}
    </div>
  ) : null;

  // Refresh button + load status. Lives at the top of the sidebar on wide screens; narrow
  // screens keep the original "Data" bar above the page instead (they have no sidebar).
  // (Colours chosen to read on the dark sidebar.)
  const loadStatusClass =
    loadingMessage.includes('Error') ? 'text-red-400' : 'text-slate-400';

  // Page background: flat, neutral light grey so the white cards stand out cleanly.
  //
  // LAYOUT (desktop): the same width rule as Cash Flow Tracker, so both apps fill a laptop screen
  // the same way. The page stretches with the window (20px of grey at each side) up to a block
  // 1,656px wide; only on wider screens than that does grey margin appear around it, centred.
  // (It used to be a fixed 1,268px content column, which left ~95px of empty grey each side on a
  // 1,707px-wide laptop window.)
  // From 1,520px of window width the 192px sidebar + 8px gap sits to the left of the content and
  // the content takes all the remaining width (at 1,520px that is still ~1,263px, so wide tables
  // keep the room they were sized for). Below 1,520px the sidebar disappears and a "Menu" button
  // opens the drawer instead, so the content never gives up width to navigation.
  // (The sidebar was 168px; it grew to 192px so the dark-mode icon fits beside Refresh Data.)
  //
  // The sidebar is a dark panel exactly one window tall (minus the 16px margin top and bottom),
  // pinned in place while the page scrolls, so its rounded corners always stay on screen and the
  // panel itself never moves. Inside: Refresh at the top, the menu in the middle (scrolls on its
  // own if the window is too short), the "Data as of" card at the bottom.
  //
  // PHONES (below 768px): 16px of grey page edge + 16px of card padding used up 64px of a ~375px
  // screen, so both are thinner there; the extra bottom padding keeps the last rows clear of the
  // tab bar along the bottom (56px, plus the iPhone home bar's strip when there is one).
  return (
    <div className="min-h-screen bg-page p-4 md:px-5 max-md:p-2 max-md:pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-[1656px] min-[1520px]:flex min-[1520px]:items-start min-[1520px]:gap-2">
      <nav aria-label="Pages" className="hidden min-[1520px]:block w-[192px] shrink-0 sticky top-4 h-[calc(100vh-2rem)] rounded-xl bg-gradient-to-b from-slate-900 to-black shadow-sm">
        <div className="h-full flex flex-col p-2">
          {/* Data controls: Refresh button with the dark-mode icon beside it, then the load status in small print */}
          <div className="flex gap-1.5 shrink-0">
            <button
              type="button"
              onClick={loadDataFromSheet}
              disabled={isLoading}
              className="flex-1 min-w-0 px-3 py-2 bg-white/10 text-white border border-white/10 rounded-lg hover:bg-white/15 font-semibold flex items-center justify-center gap-2 disabled:opacity-50 text-sm whitespace-nowrap"
            >
              <RefreshCw className={`w-4 h-4 shrink-0 ${isLoading ? 'animate-spin' : ''}`} />
              {isLoading ? 'Loading...' : 'Refresh Data'}
            </button>
            {themeToggle('px-2.5 bg-white/10 text-slate-300 border border-white/10 hover:bg-white/15 hover:text-white')}
          </div>
          <div className={`px-1 pt-1.5 pb-2 text-[11px] leading-snug text-center shrink-0 ${loadStatusClass}`}>
            {/* Too long for one line at this width, so break it deliberately after the first comma
                ("Loaded 128 assets" / "203 data points") instead of wherever the text happens to wrap.
                Other messages (loading, errors) have no comma and show as they are. */}
            {(loadingMessage || 'Ready').split(/,\s*/).map((part, i) => <div key={i}>{part}</div>)}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto border-t border-white/10 pt-2 [scrollbar-width:thin] [scrollbar-color:#334155_transparent]">
            {isConnected && assetData
              ? navList
              : <div className="px-3 py-2 text-xs text-slate-500">Loading data…</div>}
          </div>
          {navFooter}
        </div>
      </nav>
      <div className="min-w-0 min-[1520px]:flex-1">
        {/* Desktop only: a grey strip pinned to the top 16px of the window, so while scrolling the
            white card never shows above the top of the dark sidebar (see .page-top-mask in globals.css) */}
        <div aria-hidden="true" className="page-top-mask" />
        {/* Main card: soft rounded corners, hairline border and a very light shadow (elegant, not heavy).
            On wide screens no bottom margin, so it ends level with the dark sidebar beside it. */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4 min-[1520px]:mb-0 max-md:p-3">

          {/* Phones only: one slim line instead of the Data box and Menu button below (together they
              took about a quarter of the first screen): the page's name with the load status in
              small print under it. Pages are switched from the tab bar at the bottom, and the data
              is refreshed by pulling the page down, as in other apps. */}
          <div className="hidden max-md:flex items-center justify-between gap-3 mb-3">
            <div className="min-w-0">
              {isConnected && assetData
                ? (() => {
                    // Page name, plus the open section where the page has some ("Markets · Equities").
                    // A page with several sections: the name is a button (with ▾) that opens a
                    // slide-up list of them, so you can switch section without going through More.
                    const label = NAV_VIEWS.find(v => v.view === activeView)?.label;
                    const sections = navSections(activeView);
                    const section = sections?.items.find(s => s.key === sections.active)?.label;
                    const text = section ? `${label} · ${section}` : label;
                    if (!sections || sections.items.length < 2) {
                      return <div className="text-base font-semibold text-gray-900 truncate">{text}</div>;
                    }
                    return (
                      <>
                        <button
                          type="button"
                          onClick={() => setSectionSheetOpen(true)}
                          className="max-w-full flex items-center gap-1 text-base font-semibold text-gray-900 text-left"
                        >
                          <span className="truncate">{text}</span>
                          <ChevronDown className="w-4 h-4 shrink-0 text-gray-500" />
                        </button>
                        {sectionSheetOpen && (
                          <BottomSheet
                            title={label ?? ''}
                            options={sections.items.map(s => ({ value: s.key, label: s.label }))}
                            selected={sections.active}
                            onPick={key => sections.select(key)}
                            onClose={() => setSectionSheetOpen(false)}
                          />
                        )}
                      </>
                    );
                  })()
                : <div className="text-base font-semibold text-gray-900 truncate">Portfolio Backtester</div>}
              <div className={`text-[11px] leading-snug ${loadingMessage.includes('Error') ? 'text-red-600' : 'text-gray-500'}`}>
                {loadingMessage || 'Ready'}
              </div>
            </div>
          </div>

          {/* Data Status Section - compact single row. Narrow screens only: wide screens show
              the same Refresh button and status at the top of the sidebar instead.
              (Phones show the slim line above instead.) */}
          <div className="mb-4 px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-between min-[1520px]:hidden max-md:hidden">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-700">Data</h2>
              <span className={`text-sm ${
                loadingMessage.includes('Loaded') ? 'text-gray-900' :
                loadingMessage.includes('Error') ? 'text-red-600' :
                'text-gray-600'
              }`}>
                {loadingMessage || 'Ready'}
              </span>
            </div>
            <button
              onClick={loadDataFromSheet}
              disabled={isLoading}
              className={BTN_MAIN}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              {isLoading ? 'Loading...' : 'Refresh Data'}
            </button>
          </div>

          {/* FX data warning — raised when the sheet's exchange-rate columns contradict
              each other. Amber, not red: the app still works, but any figure converted
              through the named columns in that date range can't be trusted. */}
          {fxDataIssues.length > 0 && !fxWarningDismissed && (
            <div className="mb-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-start justify-between gap-3">
              <div className="text-xs text-amber-900">
                <span className="font-semibold">FX data check</span>
                {fxDataIssues.map(issue => (
                  <div key={issue.label} className="mt-1">
                    <span className="font-mono">{issue.label}</span> disagree in{' '}
                    <span className="font-semibold">{issue.rows} of {issue.total}</span> rows
                    {' '}({issue.firstDate} to {issue.lastDate}, worst {issue.worstPct.toFixed(1)}%).
                    {' '}One of those columns is wrong in the source sheet, so values converted
                    to or from that currency in this period are unreliable.
                  </div>
                ))}
              </div>
              <button
                onClick={() => setFxWarningDismissed(true)}
                className="text-amber-700 hover:text-amber-900 text-xs font-semibold shrink-0"
                title="Hide this warning until the page is reloaded"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Ledger warnings — rows the position replay could not honour, so the shares were
              left where they were rather than guessed at. Shown for the same reason as the FX
              banner above: a silently skipped sale looks exactly like a position you still
              hold, and nothing else on screen would tell you the difference. */}
          {positionsModel && positionsModel.warnings.length > 0 && !ledgerWarningDismissed && (
            <div className="mb-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-start justify-between gap-3">
              <div className="text-xs text-amber-900">
                <span className="font-semibold">Transactions check</span>
                {positionsModel.warnings.map(w => (
                  <div key={`${w.ticker}-${w.date}`} className="mt-1">
                    <span className="font-mono">{w.ticker}</span> {w.date} — {w.reason}.
                    {' '}The sale was skipped and the position left open, so its size and P&amp;L
                    are wrong until the row is corrected in the sheet.
                  </div>
                ))}
              </div>
              <button
                onClick={() => setLedgerWarningDismissed(true)}
                className="text-amber-700 hover:text-amber-900 text-xs font-semibold shrink-0"
                title="Hide this warning until the page is reloaded"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Navigation on narrow screens. Wide screens (1,392px+) get the sidebar on the left
              instead, so this button hides there. Tapping it slides the same list in from the
              left (see the drawer at the bottom of the page). Phones use the floating button instead. */}
          {isConnected && assetData && (
            <div className="mb-6 min-[1520px]:hidden max-md:hidden">
              <button
                type="button"
                onClick={() => setNavOpen(true)}
                className={BTN_SECOND}
                aria-label="Open navigation"
              >
                <Menu className="w-4 h-4" />
                Menu
                <span className="text-gray-400">·</span>
                <span className="text-gray-900">{NAV_VIEWS.find(v => v.view === activeView)?.label}</span>
              </button>
            </div>
          )}

          {/* Show the rest of the UI only when data is loaded */}
          {isConnected && assetData && activeView === 'backtest' && (
            <BacktestSetup
              assetData={assetData} selectedDateRange={selectedDateRange}
              setSelectedStartDate={setSelectedStartDate} setSelectedEndDate={setSelectedEndDate}
              activeDatePreset={activeDatePreset} setDatePreset={setDatePreset} getLimitingAsset={getLimitingAsset}
              startingCapital={startingCapital} setStartingCapital={setStartingCapital}
              rebalanceFreq={rebalanceFreq} setRebalanceFreq={setRebalanceFreq}
              withdrawalRate={withdrawalRate} setWithdrawalRate={setWithdrawalRate}
              inflationRate={inflationRate} setInflationRate={setInflationRate}
              portfolios={portfolios} setPortfolios={setPortfolios} presetPortfolios={presetPortfolios}
              numDrafts={numDrafts} availableAssetsFiltered={availableAssetsFiltered}
              getAssetCurrency={getAssetCurrency} getAssetDisplayName={getAssetDisplayName}
              getTotalWeight={getTotalWeight} matchingPreset={matchingPreset} generatePortfolioName={generatePortfolioName}
              applyPreset={applyPreset} addPortfolio={addPortfolio} removePortfolio={removePortfolio}
              handlePortfolioNameChange={handlePortfolioNameChange} addAssetToPortfolio={addAssetToPortfolio}
              updateAsset={updateAsset} handleNumericAssetInput={handleNumericAssetInput}
              clearNumDraft={clearNumDraft} removeAsset={removeAsset} runBacktest={runBacktest}
            />
          )}

          {/* Results Section - Only shown after running backtest AND when in backtest view */}
          {backtestResults && activeView === 'backtest' && (
            <BacktestResults
              backtestResults={backtestResults} portfolios={portfolios} selectedDateRange={selectedDateRange}
              withdrawalRate={withdrawalRate} inflationRate={inflationRate}
              backtestXAxisConfig={backtestXAxisConfig} BacktestDateTick={BacktestDateTick}
              getAnnualReturnsChartData={getAnnualReturnsChartData} getBestWorstYears={getBestWorstYears}
              getPeriodicReturnsChartData={getPeriodicReturnsChartData} getRebalancingDetails={getRebalancingDetails}
              hasCostLeg={hasCostLeg}
              backtestReturnsPeriod={backtestReturnsPeriod} setBacktestReturnsPeriod={setBacktestReturnsPeriod}
              correlationWindow={correlationWindow} setCorrelationWindow={setCorrelationWindow}
              deltaChartView={deltaChartView} setDeltaChartView={setDeltaChartView}
              deltaPortfolioA={deltaPortfolioA} setDeltaPortfolioA={setDeltaPortfolioA}
              deltaPortfolioB={deltaPortfolioB} setDeltaPortfolioB={setDeltaPortfolioB}
              selectedDetailPortfolio={selectedDetailPortfolio} setSelectedDetailPortfolio={setSelectedDetailPortfolio}
              selectedRebalancingPortfolio={selectedRebalancingPortfolio} setSelectedRebalancingPortfolio={setSelectedRebalancingPortfolio}
            />
          )}

          {/* Assets Annual Returns Section - Shown when in annualReturns view */}
          {/* This table shows yearly returns for ALL assets in the lookup table */}
          {isConnected && assetData && activeView === 'annualReturns' && (
            <AnnualReturnsTab
              assetData={assetData} assetLookup={assetLookup} filteredAssets={getFilteredAssetLookup()}
              memoizedAnnualReturns={memoizedAnnualReturns} getPeriodReturn={getPeriodReturn}
              annualViewMode={annualViewMode} setAnnualViewMode={setAnnualViewMode}
              annualReturnsSortColumn={annualReturnsSortColumn} setAnnualReturnsSortColumn={setAnnualReturnsSortColumn}
              selectedYears={selectedYears} setSelectedYears={setSelectedYears}
              yearsDropdownOpen={yearsDropdownOpen} setYearsDropdownOpen={setYearsDropdownOpen}
              yearsDropdownRef={yearsDropdownRef}
              renderFilters={extra => <AssetFilterControls>{extra}</AssetFilterControls>}
            />
          )}

          {/* Best To Worst Section - assets ranked by return for a selected year (Ranking), or */}
          {/* several years side by side (Return Map); the left panel switches between the two */}
          {isConnected && assetData && activeView === 'bestToWorst' && (
            <BestToWorstTab
              assetLookup={assetLookup} filteredAssets={getFilteredAssetLookup()}
              memoizedAnnualReturns={memoizedAnnualReturns} fxAnnualReturns={fxAnnualReturns}
              getPeriodReturn={getPeriodReturn} bestToWorstLayout={bestToWorstLayout}
              bestToWorstMode={bestToWorstMode} setBestToWorstMode={setBestToWorstMode}
              selectedRankingYear={selectedRankingYear} setSelectedRankingYear={setSelectedRankingYear}
              returnMapWindow={returnMapWindow} setReturnMapWindow={setReturnMapWindow}
              returnMapCurrency={returnMapCurrency} setReturnMapCurrency={setReturnMapCurrency}
              returnMapHighlight={returnMapHighlight} setReturnMapHighlight={setReturnMapHighlight}
              returnMapTracked={returnMapTracked} setReturnMapTracked={setReturnMapTracked}
              renderFilters={extra => <AssetFilterControls>{extra}</AssetFilterControls>}
            />
          )}

          {/* Markets tab — a one-screen overview: the Return matrix for the category chosen in the */}
          {/* left panel (Assets, Equities, Macro... from the sheet's SnapshotCategory column, plus the */}
          {/* Country page), in Returns or Stats view. All the arithmetic is in lib/markets.ts. */}
          {/* (The Holdings and EDO pages are drawn by their own blocks below, so this one stands aside for them.) */}
          {isConnected && assetData && activeView === 'markets' && !marketsIsHoldings && !marketsIsEdo && (
            <MarketsTab
              assetLookup={assetLookup} getAssetCurrency={getAssetCurrency}
              activeMarketsCategory={activeMarketsCategory} marketsIsCountry={marketsIsCountry} marketsMatrix={marketsMatrix}
              marketsView={marketsView} setMarketsView={setMarketsView}
              marketsPeriod={marketsPeriod} setMarketsPeriod={setMarketsPeriod} marketsSavedPeriod={marketsSavedPeriod}
              marketsCurrency={marketsCurrency} setMarketsCurrency={setMarketsCurrency}
              marketsCountry={marketsCountry} setMarketsCountry={setMarketsCountry}
              marketsTrendPeriod={marketsTrendPeriod} setMarketsTrendPeriod={setMarketsTrendPeriod}
              marketsChartRange={marketsChartRange} setMarketsChartRange={setMarketsChartRange}
              setActiveView={setActiveView} setMonthlySelectedTicker={setMonthlySelectedTicker}
              setMonthlyDisplayCurrency={setMonthlyDisplayCurrency} setSelectedAssetTickers={setSelectedAssetTickers}
              setSelectedAssetClasses={setSelectedAssetClasses} setSelectedCurrencies={setSelectedCurrencies}
              setSelectedAssetSubcategories={setSelectedAssetSubcategories}
            />
          )}

          {/* Markets tab, Holdings page — what you own today, in the Markets look: open positions */}
          {/* (shares still held, as in Positions › Open Positions) plus cash, grouped by asset class, */}
          {/* every money figure in one currency. The arithmetic is in lib/holdings.ts. */}
          {isConnected && assetData && activeView === 'markets' && marketsIsHoldings && (
            <HoldingsTab
              holdingsModel={holdingsModel} positionsModel={positionsModel} edoMissingBanner={edoMissingBanner}
              holdingsCurrency={holdingsCurrency} setHoldingsCurrency={setHoldingsCurrency} setActiveView={setActiveView}
              setOpenSelectedTicker={setOpenSelectedTicker} setClosedSelectedTicker={setClosedSelectedTicker}
              setCashCategory={setCashCategory} setCashSelected={setCashSelected} setOpenIncludedTxns={setOpenIncludedTxns}
              setOpenSinceInvested={setOpenSinceInvested} setOpenShowMinMax={setOpenShowMinMax}
              setOpenShowAvgBuy={setOpenShowAvgBuy} setOpenInvestedFrom={setOpenInvestedFrom}
              setOpenInvestedInto={setOpenInvestedInto} setOpenGraphStarts={setOpenGraphStarts}
              setOpenGraphEnds={setOpenGraphEnds}
            />
          )}

          {/* Markets "EDO" page — Polish 10-year inflation-linked savings bonds, from the sheet's */}
          {/* EDO tab: the rates and margins every series was sold on, one series' value since */}
          {/* purchase against inflation and after tax, and the full series list. Arithmetic in lib/edo.ts. */}
          {isConnected && assetData && activeView === 'markets' && marketsIsEdo && (
            <EdoTab
              assetData={assetData} edoData={edoData} edoSelected={edoSelected} setEdoSelected={setEdoSelected}
              edoLines={edoLines} setEdoLines={setEdoLines}
              edoStatusFilter={edoStatusFilter} setEdoStatusFilter={setEdoStatusFilter}
              edoMaturedTax={edoMaturedTax} setEdoMaturedTax={setEdoMaturedTax}
              edoMaturedReal={edoMaturedReal} setEdoMaturedReal={setEdoMaturedReal}
            />
          )}

          {/* Monthly Prices Section - Shows 13 months of raw prices with heatmap and signals */}
          {isConnected && assetData && activeView === 'monthlyPrices' && (
            <MonthlyTab
              assetData={assetData} assetLookup={assetLookup} filteredAssets={getFilteredAssetLookup()}
              getAssetCurrency={getAssetCurrency} calculatePortfolioReturns={calculatePortfolioReturns}
              isStartDependent={isStartDependent} windowPrices={windowPrices} endMonthChoices={endMonthChoices}
              selectedEndDate={selectedEndDate} rebalanceFreq={rebalanceFreq}
              monthlyChartPeriod={monthlyChartPeriod} setMonthlyChartPeriod={setMonthlyChartPeriod}
              monthlyDisplayCurrency={monthlyDisplayCurrency} setMonthlyDisplayCurrency={setMonthlyDisplayCurrency}
              monthlyEndDate={monthlyEndDate} setMonthlyEndDate={setMonthlyEndDate}
              monthlyPriceChartLog={monthlyPriceChartLog} setMonthlyPriceChartLog={setMonthlyPriceChartLog}
              monthlyPriceChartMode={monthlyPriceChartMode} setMonthlyPriceChartMode={setMonthlyPriceChartMode}
              monthlySelectedTicker={monthlySelectedTicker} setMonthlySelectedTicker={setMonthlySelectedTicker}
              monthlySortColumn={monthlySortColumn} setMonthlySortColumn={setMonthlySortColumn}
              monthlyStatsExpanded={monthlyStatsExpanded} setMonthlyStatsExpanded={setMonthlyStatsExpanded}
              monthlyViewMode={monthlyViewMode} setMonthlyViewMode={setMonthlyViewMode}
              returnsChartPeriod={returnsChartPeriod} setReturnsChartPeriod={setReturnsChartPeriod}
              seasonMonth={seasonMonth} setSeasonMonth={setSeasonMonth}
              stressYear={stressYear} setStressYear={setStressYear}
              renderFilters={extra => <AssetFilterControls>{extra}</AssetFilterControls>}
            />
          )}

          {/* ============================================
              GRAPHS TAB
              ============================================
              A responsive grid of small line charts — one per asset.
              Each chart shows monthly prices over a selectable period,
              with the ticker and period return in the title. */}
          {isConnected && assetData && activeView === 'graphs' && (
            <GraphsTab
              filteredAssets={getFilteredAssetLookup()} getMonthlyChartData={getMonthlyChartData}
              endMonthChoices={endMonthChoices}
              graphsPeriod={graphsPeriod} setGraphsPeriod={setGraphsPeriod}
              graphsEndDate={graphsEndDate} setGraphsEndDate={setGraphsEndDate}
              graphsShowSMA={graphsShowSMA} setGraphsShowSMA={setGraphsShowSMA}
              renderFilters={smaToggle => <AssetFilterControls>{smaToggle}</AssetFilterControls>}
            />
          )}

          {/* Trend Following Section - Compares Buy & Hold vs 10-month SMA strategy */}
          {isConnected && assetData && activeView === 'trendFollowing' && (
            <TrendFollowingTab
              assetData={assetData} assetLookup={assetLookup} selectedDateRange={selectedDateRange}
              setSelectedStartDate={setSelectedStartDate} setSelectedEndDate={setSelectedEndDate}
              selectedTrendAsset={selectedTrendAsset} setSelectedTrendAsset={setSelectedTrendAsset}
              trendRiskFreeRate={trendRiskFreeRate} setTrendRiskFreeRate={setTrendRiskFreeRate}
              trendCommission={trendCommission} setTrendCommission={setTrendCommission}
            />
          )}

          {/* ============================================ */}
          {/* CORRELATION MATRIX TAB */}
          {/* ============================================ */}
          {/* Shows how different assets move together (or apart). */}
          {/* A correlation of +1 means they move in lockstep (bad for diversification). */}
          {/* A correlation of -1 means they move in opposite directions (great for diversification). */}
          {/* 0 means no relationship at all. */}
          {isConnected && assetData && activeView === 'correlationMatrix' && (
            <CorrelationsTab
              assetData={assetData} assetLookup={assetLookup} filteredAssets={getFilteredAssetLookup()}
              correlationPeriod={correlationPeriod} setCorrelationPeriod={setCorrelationPeriod}
              renderFilters={periodControl => <AssetFilterControls>{periodControl}</AssetFilterControls>}
            />
          )}

          {/* ============================================ */}
          {/* PORTFOLIO TAB                                */}
          {/* Shows annual portfolio data from the Years sheet: */}
          {/* Chart 1: Portfolio Value (stacked bar)        */}
          {/* Chart 2: Contributions & Profit (stacked + growth label) */}
          {/* Chart 3: Returns by Year (grouped bars)       */}
          {/* ============================================ */}
          {isConnected && activeView === 'portfolio' && (
            <PortfolioTab
              assetData={assetData} yearsData={yearsData} dailyData={dailyData}
              getAssetCurrency={getAssetCurrency} getAssetFirstAvailableDate={getAssetFirstAvailableDate}
              getYearlyValueSeries={getYearlyValueSeries}
              breakdownData={breakdownData} breakdownYears={breakdownYears}
              resolvedBreakdownYear={resolvedBreakdownYear} setBreakdownYear={setBreakdownYear}
              breakdownExpanded={breakdownExpanded} setBreakdownExpanded={setBreakdownExpanded}
              portfolioCurrency={portfolioCurrency} setPortfolioCurrency={setPortfolioCurrency}
              selectedReturnCurrencies={selectedReturnCurrencies} setSelectedReturnCurrencies={setSelectedReturnCurrencies}
              dailyNavCurrency={dailyNavCurrency} setDailyNavCurrency={setDailyNavCurrency}
              dailyNavPeriod={dailyNavPeriod} setDailyNavPeriod={setDailyNavPeriod}
              dailyNavBenchmark={dailyNavBenchmark} setDailyNavBenchmark={setDailyNavBenchmark}
              ddPeriod={ddPeriod} setDdPeriod={setDdPeriod}
              ddSelectedCurrencies={ddSelectedCurrencies} setDdSelectedCurrencies={setDdSelectedCurrencies}
            />
          )}

          {/* ============================================ */}
          {/* POSITIONS TAB (Open + Closed)               */}
          {/* ============================================ */}
          {isConnected && assetData && activeView === 'positions' && (
            <div className="mt-2">
              {edoMissingBanner}

              {/* --- Positions Tab Controls (Open and Closed alike) ---
                  No Assets filter: every position is always shown (removed 2026-11-05).
                  Currency: buttons on desktop AND phones — only four choices, so they fit on a
                  phone's width and a slide-up panel would just be an extra tap. "Native" = no
                  conversion, each position in its own currency. */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4 max-md:gap-x-2">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500 mr-1 max-md:hidden" title="Convert all position values to this currency for comparison">Currency:</span>
                  <span className={SEG}>
                    {CURRENCY_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setPositionsCurrency(opt.value)}
                        // Phones: a little less padding, so this row and Group M&C fit on one line
                        // even on a 360px-wide phone
                        className={`${segBtn(positionsCurrency === opt.value)} max-md:!px-2.5`}
                        title={opt.value === '' ? 'No conversion: each position in its own currency' : `Convert invested / value / PnL to ${opt.label}`}
                      >{opt.value === '' ? 'Native' : opt.label}</button>
                    ))}
                  </span>
                </div>

                {/* "Group M&C" toggle — when on, classes come from the Lookup tab's PortfolioClass
                    column, so gold, silver and crypto become "Metals & Crypto" as both an asset
                    class and a separate currency bar, keeping fiat bars pure.
                    An on/off switch: a strip of one, slate while on. */}
                <span className={SEG}>
                <button
                  onClick={() => {
                    setGroupMetalsCrypto(prev => !prev);
                    // Clear any active filter whose label only exists in one mode
                    setOpenAssetClassFilter(null);
                    setOpenCurrencyFilter(null);
                  }}
                  className={`${segBtn(groupMetalsCrypto)} max-md:!px-2`}
                  title={groupMetalsCrypto
                    ? 'Showing the Lookup tab\'s PortfolioClass (blank = Asset Class); Metals & Crypto also get their own currency bar — click for the standard Asset Class'
                    : 'Showing the standard Asset Class from the Lookup tab — click to use PortfolioClass (e.g. Metals & Crypto)'}
                >
                  Group M&amp;C
                </button>
                </span>
              </div>

              {/* --- SUMMARY VIEW (when no specific asset or cash balance is drilled into) --- */}
              {!closedSelectedTicker && !openSelectedTicker && !cashSelected && (() => {
                // Every position, open and closed. The Lookup tab decides what can be shown: a ticker
                // missing from it stays hidden. Open tickers come from the ledger replay, which keeps
                // a position open when it was only PARTLY sold.
                const filteredAssets = getClosedTabLookup();
                const lookupTickers = new Set(assetLookup.map(a => a.ticker));
                const openTickers = getOpenTickers().filter(t => lookupTickers.has(t));

                if (filteredAssets.length === 0 && openTickers.length === 0) {
                  return (
                    <div className="bg-white p-8 rounded-lg shadow text-center text-gray-500">
                      <p className="text-lg mb-2">No positions yet</p>
                      <p className="text-sm">Positions appear here once the Transactions tab of the sheet has purchases.</p>
                    </div>
                  );
                }

                // --- Build Open Positions summary data ---
                const today = new Date().toISOString().split('T')[0];
                // Helper: find the FX rate for a given date by matching the same month's data row.
                // Data is month-end, so a mid-month transaction (e.g., Jan 15) should use
                // that month's rate (Jan 31), not the previous month's (Dec 31).
                const getFxRateForDate = (fxTicker: string, dateStr: string): number => {
                  if (!fxTicker || !assetData) return 1;
                  // Find the first row whose date >= the transaction date (same month's month-end)
                  const matchRow = assetData.find(row => row.date >= dateStr);
                  return matchRow ? getFxRate(matchRow, fxTicker) : (assetData.length > 0 ? getFxRate(assetData[assetData.length - 1], fxTicker) : 1);
                };

                // Helper: convert from an asset's native currency to the target positions currency
                // Uses PLN as a hub: nativeValue → PLN (via native FX rate) → target (÷ target FX rate)
                const getPositionConversionForDate = (nativeCurrency: string, dateStr: string): number => {
                  if (!positionsCurrency || nativeCurrency === positionsCurrency) return 1;
                  const nativeFxTicker = FX_TICKER_MAP[nativeCurrency] || '';
                  const toPLN = nativeCurrency === 'PLN' ? 1 : getFxRateForDate(nativeFxTicker, dateStr);
                  const targetFxTicker = FX_TICKER_MAP[positionsCurrency] || '';
                  const targetToPLN = positionsCurrency === 'PLN' ? 1 : getFxRateForDate(targetFxTicker, dateStr);
                  if (targetToPLN === 0) return toPLN;
                  return toPLN / targetToPLN;
                };

                // Latest FX rates from the most recent data row
                const latestRow = assetData && assetData.length > 0 ? assetData[assetData.length - 1] : null;

                // Helper: conversion rate at latest date for current values
                const getLatestConversion = (nativeCurrency: string): number => {
                  if (!positionsCurrency || nativeCurrency === positionsCurrency) return 1;
                  const nativeFxTicker = FX_TICKER_MAP[nativeCurrency] || '';
                  const toPLN = nativeCurrency === 'PLN' ? 1 : (latestRow ? getFxRate(latestRow, nativeFxTicker) : 1);
                  const targetFxTicker = FX_TICKER_MAP[positionsCurrency] || '';
                  const targetToPLN = positionsCurrency === 'PLN' ? 1 : (latestRow ? getFxRate(latestRow, targetFxTicker) : 1);
                  if (targetToPLN === 0) return toPLN;
                  return toPLN / targetToPLN;
                };

                // Currency label for converted columns (e.g., "PLN", "USD", or hidden when empty)
                const posCcySym = CURRENCY_SYMBOLS[positionsCurrency] || '';
                const posCcyLabel = positionsCurrency || '';

                const openSummaryData = openTickers.map(ticker => {
                  const purchases = getOpenPurchases(ticker);
                  const dividends = getOpenDividends(ticker);
                  const assetInfo = assetLookup.find(a => a.ticker === ticker);
                  const nativeCurrency = assetInfo?.currency || 'PLN';
                  // Units still held (purchases less any units given up to fees)
                  const totalShares = purchases.reduce((sum, t) => sum + heldQty(t), 0);
                  const totalInvested = purchases.reduce((sum, t) => sum + t.amount, 0);
                  const totalDividends = dividends.reduce((sum, t) => sum + t.amount, 0);
                  const currentPrice = getCurrentPrice(ticker);
                  const currentValue = currentPrice * totalShares;
                  const totalPnL = currentValue + totalDividends - totalInvested;
                  const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
                  const firstBuyDate = purchases.length > 0 ? purchases[0].date : '';
                  const timeHeldYears = firstBuyDate ? (Date.now() - new Date(firstBuyDate).getTime()) / (365.25 * 86400000) : 0;
                  const cashFlows = [
                    ...purchases.map(t => ({ date: new Date(t.date), amount: -t.amount })),
                    ...dividends.map(t => ({ date: new Date(t.date), amount: t.amount })),
                    { date: new Date(), amount: currentValue },
                  ].sort((a, b) => a.date.getTime() - b.date.getTime());
                  const xirr = calculateXIRR(cashFlows);

                  // Convert to target currency: each transaction at its historical FX rate
                  const investedConverted = purchases.reduce((sum, t) => sum + t.amount * getPositionConversionForDate(nativeCurrency, t.date), 0);
                  const dividendsConverted = dividends.reduce((sum, t) => sum + t.amount * getPositionConversionForDate(nativeCurrency, t.date), 0);
                  const latestConversion = getLatestConversion(nativeCurrency);
                  const currentValueConverted = currentValue * latestConversion;
                  const totalPnLConverted = currentValueConverted + dividendsConverted - investedConverted;

                  const avgBuyPrice = totalShares > 0 ? (totalInvested - totalDividends) / totalShares : 0;

                  return {
                    ticker, name: assetInfo?.name || '', assetClass: assetInfo?.assetClass || '',
                    portfolioClass: assetInfo?.portfolioClass || '', // used while "Group M&C" is on
                    nativeCurrency,
                    numTransactions: purchases.length,
                    firstBuyDate, lastValuation: today, timeHeldYears,
                    avgBuyPrice, currentPrice, totalShares,
                    totalInvested, currentValue, totalPnL, totalPnLPct, xirr,
                    investedConverted, currentValueConverted, totalPnLConverted,
                  };
                });

                // Sort open positions by asset class: Fixed Income → M&C → Alternatives → Equities
                const assetClassOrder: Record<string, number> = {
                  // Cash sorts first: it is the least risky thing you hold, and the list runs
                  // from safest to riskiest.
                  'Cash': -1,
                  'Fixed Income': 0, 'Crypto': 1, 'Other': 1, 'Metals & Crypto': 1, 'Alternatives': 2, 'Equities': 3,
                };
                // (The sort itself runs below, once effectiveClass exists: rows are ordered by the
                // class they are SHOWN under, which follows the "Group M&C" toggle.)

                // --- Shared display helpers ---
                // When no Ccy filter is active, default all breakdown values to PLN.
                const effectiveCcy = positionsCurrency || 'PLN';
                // Helper: convert a native currency amount to PLN using the latest available FX rate
                const toPLNLatest = (nativeCcy: string): number => {
                  if (nativeCcy === 'PLN') return 1;
                  return latestRow ? getFxRate(latestRow, FX_TICKER_MAP[nativeCcy] || '') : 1;
                };

                // Helpers for the "Group Metals & Crypto" toggle:
                // effectiveClass — toggle ON: the Lookup tab's PortfolioClass (blank = Asset Class), the
                //   same rule as the Markets Holdings page (portfolioClassOf in lib/holdings.ts).
                //   Toggle OFF: the standard Asset Class. Missing either way = 'Other'.
                const effectiveClass = (row: { assetClass: string; portfolioClass: string }): string =>
                  (groupMetalsCrypto ? portfolioClassOf(row) : (row.assetClass || 'Other'));
                // effectiveCurrency — when toggle is on, M&C assets get a pseudo-currency 'M&C' so
                //   their value is excluded from real fiat bars (e.g. USD) in the By Currency chart.
                const effectiveCurrency = (row: { nativeCurrency: string; assetClass: string; portfolioClass: string }): string =>
                  (groupMetalsCrypto && portfolioClassOf(row) === METALS_CRYPTO_LABEL ? METALS_CRYPTO_CCY : row.nativeCurrency);

                // Sort open positions by the class each is shown under (Cash → Fixed Income → M&C →
                // Alternatives → Equities): with "Group M&C" on that is the PortfolioClass column, so
                // gold and crypto sit together under Metals & Crypto rather than among Alternatives.
                openSummaryData.sort((a, b) => (assetClassOrder[effectiveClass(a)] ?? 99) - (assetClassOrder[effectiveClass(b)] ?? 99));

                // --- Build a map of ticker → set of accounts (from Purchase of Asset transactions only) ---
                // Used to filter the portfolio by account — a ticker is "in" an account if it has
                // at least one purchase from that account.
                //
                // The account used here is the one that PAID (`fundedFrom`), not the one the shares
                // landed in. Otherwise a broker splits into two bars that are really one place:
                // holdings under "IB ETF" and the cash that buys them under "Interactive Brokers".
                // Grouping on the payer puts both on the same bar. `account` remains the fallback
                // for any row without a recorded payer.
                const purchaseAccountOf = (t: TransactionRow): string => t.fundedFrom || t.account || 'Unknown';
                const tickerPurchaseAccounts: Record<string, Set<string>> = {};
                for (const t of transactionData) {
                  if (t.flow !== 'Purchase of Asset') continue;
                  if (!tickerPurchaseAccounts[t.ticker]) tickerPurchaseAccounts[t.ticker] = new Set();
                  tickerPurchaseAccounts[t.ticker].add(purchaseAccountOf(t));
                }

                // --- Cash, expressed the same way the position rollups are ---
                // Cash is not an investment, so it has no cost basis and no profit: a dollar cost a
                // dollar and is still worth a dollar. That is why `invested` equals `currentValue`
                // and `pnl` is zero below — not a placeholder, but the truth about cash, and the
                // reason including it drags the portfolio's overall return down slightly.
                //
                // CASH_CLASS is its own asset class rather than being folded into Fixed Income:
                // idle cash earns nothing and carries no duration, so mixing the two would flatter
                // the bond sleeve's return and hide how much powder is dry.
                const CASH_CLASS = 'Cash';
                const cashRows = cashAccounts.map(c => ({
                  account: c.account,
                  currency: c.currency,
                  // Converted with the latest rate, matching how position CURRENT values are
                  // converted in these breakdowns.
                  value: c.balance * (positionsCurrency ? getLatestConversion(c.currency) : toPLNLatest(c.currency)),
                }));
                // Cash obeys the same three filters as everything else on this screen, so the
                // sections stay in sync when a bar is clicked. It is never "Metals & Crypto", so
                // an M&C class filter excludes it entirely.
                //
                // Each section deliberately ignores its OWN filter — otherwise clicking one bar
                // would hide every other bar in the same chart, leaving nothing to click back on.
                // That is why this takes flags rather than applying all three: it mirrors what the
                // position rollups below already do.
                const cashPasses = (account: string, currency: string, applyCcy: boolean, applyAccount: boolean, applyClass: boolean) =>
                  (!applyCcy     || !openCurrencyFilter   || openCurrencyFilter === currency) &&
                  (!applyAccount || !openAccountFilter    || openAccountFilter === account) &&
                  (!applyClass   || !openAssetClassFilter || openAssetClassFilter === CASH_CLASS);
                const cashMatching = (applyCcy: boolean, applyAccount: boolean, applyClass: boolean) =>
                  cashRows.filter(c => cashPasses(c.account, c.currency, applyCcy, applyAccount, applyClass));

                // --- Currency filter + Account filter: both narrow the data driving Asset Class + Open Positions ---
                const currencyFilteredData = openSummaryData.filter(row => {
                  if (openCurrencyFilter && effectiveCurrency(row) !== openCurrencyFilter) return false;
                  if (openAccountFilter && !tickerPurchaseAccounts[row.ticker]?.has(openAccountFilter)) return false;
                  return true;
                });

                // --- Currency rollup (always from full openSummaryData — bar chart shows every currency) ---
                // When account filter is active, show only that account's tickers in the bar chart.
                // Uses effectiveCurrency so M&C assets appear as 'M&C' instead of their fiat currency.
                const ccyRollupSource = openAccountFilter
                  ? openSummaryData.filter(row => tickerPurchaseAccounts[row.ticker]?.has(openAccountFilter))
                  : openSummaryData;
                const ccyRollupMap: Record<string, number> = {};
                for (const row of ccyRollupSource) {
                  const ccy = effectiveCurrency(row);
                  // For fiat currencies use toPLNLatest; for M&C use the row's own native currency for conversion
                  const nativeCcyForConv = ccy === METALS_CRYPTO_CCY ? (row.nativeCurrency || 'PLN') : ccy;
                  const cvEff = positionsCurrency ? row.currentValueConverted : row.currentValue * toPLNLatest(nativeCcyForConv);
                  ccyRollupMap[ccy] = (ccyRollupMap[ccy] || 0) + cvEff;
                }
                // Cash lands in its real currency bar: USD cash swells the USD bar, and so on.
                // Filtered by account only, matching ccyRollupSource above — the currency filter
                // is this chart's own, and the class filter is handled by activeCurrencyData.
                for (const c of cashMatching(false, true, false)) {
                  ccyRollupMap[c.currency] = (ccyRollupMap[c.currency] || 0) + c.value;
                }
                // Sort by value descending so the largest bar appears at the top
                const currencyRollup = Object.entries(ccyRollupMap)
                  .map(([currency, currentValue]) => ({ currency, currentValue }))
                  .sort((a, b) => b.currentValue - a.currentValue);
                // Largest value = 100% bar width; others scale proportionally
                const maxCurrencyValue = Math.max(...currencyRollup.map(r => r.currentValue), 0.01);

                // --- Asset class breakdown (uses currencyFilteredData so it syncs with currency filter) ---
                // When positionsCurrency is set, openSummaryData already has historically-accurate
                // converted values — use them directly. When not set, apply latest PLN rate to the
                // native totals stored on each row (avoids re-fetching transactions).
                const acRollupMap: Record<string, { invested: number; currentValue: number; pnl: number }> = {};
                for (const row of currencyFilteredData) {
                  const cls = effectiveClass(row); // remaps 'Other' → 'Metals & Crypto' when toggle is on
                  if (!acRollupMap[cls]) acRollupMap[cls] = { invested: 0, currentValue: 0, pnl: 0 };
                  let investedEff: number, currentValueEff: number, pnlEff: number;
                  if (positionsCurrency) {
                    // Already converted per-transaction at historical FX rates
                    investedEff = row.investedConverted;
                    currentValueEff = row.currentValueConverted;
                    pnlEff = row.totalPnLConverted;
                  } else {
                    // Convert native currency to PLN at the latest rate (summary-level approximation)
                    const conv = toPLNLatest(row.nativeCurrency);
                    investedEff = row.totalInvested * conv;
                    currentValueEff = row.currentValue * conv;
                    pnlEff = row.totalPnL * conv;
                  }
                  acRollupMap[cls].invested += investedEff;
                  acRollupMap[cls].currentValue += currentValueEff;
                  acRollupMap[cls].pnl += pnlEff;
                }
                // Cash joins as its own class. Filtered by currency + account, matching
                // currencyFilteredData above; the class filter is this table's own.
                const acCashTotal = cashMatching(true, true, false).reduce((s, c) => s + c.value, 0);
                if (Math.abs(acCashTotal) > 0.005) {
                  // Accumulate, never assign. Nothing in the lookup table is classed "Cash"
                  // today, but if a holding ever were, a plain assignment here would wipe it
                  // off this table with no error — the worst kind of bug, because the total
                  // would still look plausible. Adding to whatever is there cannot lose data.
                  if (!acRollupMap[CASH_CLASS]) acRollupMap[CASH_CLASS] = { invested: 0, currentValue: 0, pnl: 0 };
                  acRollupMap[CASH_CLASS].invested += acCashTotal;
                  acRollupMap[CASH_CLASS].currentValue += acCashTotal;
                }
                const totalEffectivePV = Object.values(acRollupMap).reduce((sum, v) => sum + v.currentValue, 0);
                const assetClassRollup = Object.entries(acRollupMap)
                  .map(([cls, vals]) => ({
                    assetClass: cls, ...vals,
                    weight: totalEffectivePV > 0 ? (vals.currentValue / totalEffectivePV) * 100 : 0,
                  }))
                  .sort((a, b) => (assetClassOrder[a.assetClass] ?? 99) - (assetClassOrder[b.assetClass] ?? 99));

                // --- Currency drill-down per asset class ---
                // When an asset class row is clicked (openAssetClassFilter is set) we show sub-rows
                // underneath it revealing how that class is split by native currency.
                // Clicking a sub-row also sets openCurrencyFilter so all three sections sync.
                const acCurrencyBreakdown: Record<string, Record<string, { invested: number; currentValue: number; pnl: number }>> = {};
                for (const row of currencyFilteredData) {
                  const cls = effectiveClass(row);   // e.g. 'Other' → 'Metals & Crypto'
                  const ccy = effectiveCurrency(row);            // e.g. 'USD' → 'M&C' for gold/crypto
                  if (!acCurrencyBreakdown[cls]) acCurrencyBreakdown[cls] = {};
                  if (!acCurrencyBreakdown[cls][ccy]) acCurrencyBreakdown[cls][ccy] = { invested: 0, currentValue: 0, pnl: 0 };
                  if (positionsCurrency) {
                    acCurrencyBreakdown[cls][ccy].invested += row.investedConverted;
                    acCurrencyBreakdown[cls][ccy].currentValue += row.currentValueConverted;
                    acCurrencyBreakdown[cls][ccy].pnl += row.totalPnLConverted;
                  } else {
                    const conv = toPLNLatest(row.nativeCurrency);
                    acCurrencyBreakdown[cls][ccy].invested += row.totalInvested * conv;
                    acCurrencyBreakdown[cls][ccy].currentValue += row.currentValue * conv;
                    acCurrencyBreakdown[cls][ccy].pnl += row.totalPnL * conv;
                  }
                }
                // ...and the same split for Cash, so clicking the Cash row reveals how much sits
                // in each currency, exactly as clicking Equities reveals its currency mix.
                for (const c of cashMatching(true, true, false)) {
                  if (!acCurrencyBreakdown[CASH_CLASS]) acCurrencyBreakdown[CASH_CLASS] = {};
                  if (!acCurrencyBreakdown[CASH_CLASS][c.currency]) acCurrencyBreakdown[CASH_CLASS][c.currency] = { invested: 0, currentValue: 0, pnl: 0 };
                  acCurrencyBreakdown[CASH_CLASS][c.currency].invested += c.value;
                  acCurrencyBreakdown[CASH_CLASS][c.currency].currentValue += c.value;
                }

                // --- Active currency data for the By Currency bar chart ---
                // When an asset class is selected, the bar chart shows only that class's currencies.
                // When no asset class is selected, it shows the full portfolio currency breakdown.
                const activeCurrencyData: { currency: string; currentValue: number }[] =
                  openAssetClassFilter && acCurrencyBreakdown[openAssetClassFilter]
                    ? Object.entries(acCurrencyBreakdown[openAssetClassFilter])
                        .map(([currency, vals]) => ({ currency, currentValue: vals.currentValue }))
                        .sort((a, b) => b.currentValue - a.currentValue)
                    : currencyRollup;
                const maxActiveCurrencyValue = Math.max(...activeCurrencyData.map(r => r.currentValue), 0.01);
                const totalActiveCurrencyValue = activeCurrencyData.reduce((sum, r) => sum + r.currentValue, 0);

                // --- Compute portfolio weights for open positions ---
                // Weight = each position's current value / total portfolio value (uses converted currency when available)
                const totalPortfolioValue = openSummaryData.reduce((sum, r) => sum + (positionsCurrency ? r.currentValueConverted : r.currentValue), 0);
                const openWeights = openSummaryData.map(r => {
                  const posValue = positionsCurrency ? r.currentValueConverted : r.currentValue;
                  return totalPortfolioValue > 0 ? (posValue / totalPortfolioValue) * 100 : 0;
                });
                // Max weight is used to scale bar widths (largest weight = full bar width)
                const maxWeight = Math.max(...openWeights, 0.01); // avoid division by zero

                // --- Build Closed Positions summary data ---
                const closedSummaryData = filteredAssets.length === 0 ? [] : filteredAssets.map(asset => {
                  const transactions = getClosedTransactions(asset.ticker);
                  const totalCost = transactions.reduce((sum, t) => sum + t.initialCost, 0);
                  const totalFinalValue = transactions.reduce((sum, t) => sum + t.finalNetValue, 0);
                  const totalPnL = totalFinalValue - totalCost;
                  const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;
                  const sortedBuyDates = transactions.map(t => t.invDate).sort();
                  const sortedSaleDates = transactions.map(t => t.divDate).sort();
                  const firstBuyDate = sortedBuyDates[0] || '';
                  const lastSaleDate = sortedSaleDates[sortedSaleDates.length - 1] || '';
                  const cashFlows = transactions.flatMap(t => [
                    { date: new Date(t.invDate), amount: -t.initialCost },
                    { date: new Date(t.divDate), amount: t.finalNetValue }
                  ]).sort((a, b) => a.date.getTime() - b.date.getTime());
                  const xirr = calculateXIRR(cashFlows);
                  const timeHeldYears = firstBuyDate && lastSaleDate
                    ? (new Date(lastSaleDate).getTime() - new Date(firstBuyDate).getTime()) / (365.25 * 86400000)
                    : 0;
                  return {
                    ticker: asset.ticker, name: asset.name, numTransactions: transactions.length,
                    firstBuyDate, lastSaleDate, timeHeldYears,
                    totalInvested: totalCost, totalFinalValue, totalPnL, totalPnLPct, xirr,
                  };
                });

                // Merge weights into each row so we can filter without losing the index.
                // Apply currency filter AND asset class filter together (AND logic — both must match).
                // Uses effectiveCurrency/effectiveClass so the M&C grouping is respected.
                const filteredOpenData = openSummaryData
                  .map((row, idx) => ({ ...row, _weight: openWeights[idx] }))
                  .filter(row =>
                    (!openCurrencyFilter  || effectiveCurrency(row) === openCurrencyFilter) &&
                    (!openAssetClassFilter || effectiveClass(row) === openAssetClassFilter) &&
                    (!openAccountFilter   || tickerPurchaseAccounts[row.ticker]?.has(openAccountFilter))
                  );

                if (openSummaryData.length === 0 && closedSummaryData.length === 0) {
                  return (
                    <div className="bg-white p-8 rounded-lg shadow text-center text-gray-500">
                      <p>No positions match the current filters.</p>
                    </div>
                  );
                }

                return (
                  <>
                    {/* === Asset Class Breakdown === */}
                    {openSummaryData.length > 0 && (
                      <div className="bg-white p-4 rounded-lg shadow mb-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                          By Asset Class
                          {openCurrencyFilter && (
                            <span className="text-xs font-normal text-amber-600">— {openCurrencyFilter} positions only</span>
                          )}
                        </h4>
                        {/* Phones: the table above, the pie centred under it (side by side there is no
                            room - the table was squeezed to a sliver) */}
                        <div className="flex gap-6 items-start max-md:flex-col max-md:items-stretch max-md:gap-3">
                          <div className="overflow-x-auto flex-1">
                            <table className="w-full text-xs border-collapse">
                              <thead>
                                <tr className="border-b border-gray-200">
                                  {/* Phones skip Invested and Return % ("max-md:hidden"); the
                                      return is shown small under each PnL there instead */}
                                  <SortableTh col="assetClass" align="left" numeric={false} {...sortPropsFor('positionsAssetClass')}>Asset Class</SortableTh>
                                  <SortableTh col="invested" className="max-md:hidden" {...sortPropsFor('positionsAssetClass')}>Invested {effectiveCcy}</SortableTh>
                                  <SortableTh col="currentValue" {...sortPropsFor('positionsAssetClass')}>Current Value {effectiveCcy}</SortableTh>
                                  <SortableTh col="pnl" {...sortPropsFor('positionsAssetClass')}>Total PnL {effectiveCcy}</SortableTh>
                                  <SortableTh col="returnPct" className="max-md:hidden" {...sortPropsFor('positionsAssetClass')}>Return %</SortableTh>
                                  <SortableTh col="weight" {...sortPropsFor('positionsAssetClass')}>Weight</SortableTh>
                                </tr>
                              </thead>
                              <tbody>
                                {/* Sorting only re-orders what the table shows — the pie chart beside it
                                    and the totals row below both keep reading the original array, because
                                    a pie has no order to speak of and a sum is the same whatever order
                                    you add it up in. Cash sorts as "empty" on the two PnL columns, since
                                    those cells show a dash rather than a number. */}
                                {sortTableRows(assetClassRollup, tableSort['positionsAssetClass'] ?? null, {
                                  assetClass:   r => r.assetClass,
                                  invested:     r => r.invested,
                                  currentValue: r => r.currentValue,
                                  pnl:          r => r.assetClass === CASH_CLASS ? null : r.pnl,
                                  returnPct:    r => r.assetClass === CASH_CLASS || r.invested <= 0 ? null : (r.pnl / r.invested) * 100,
                                  weight:       r => r.weight,
                                }).map((row, idx) => (
                                  <tr
                                    key={row.assetClass}
                                    className={`border-b border-gray-50 cursor-pointer transition-colors ${
                                      openAssetClassFilter === row.assetClass
                                        ? 'bg-blue-50 outline outline-1 outline-blue-300'
                                        : openAssetClassFilter
                                        ? 'opacity-40'
                                        : idx % 2 === 0 ? 'hover:bg-blue-50' : 'bg-gray-25 hover:bg-blue-50'
                                    }`}
                                    onClick={() => setOpenAssetClassFilter(prev => prev === row.assetClass ? null : row.assetClass)}
                                  >
                                    <td className="py-2 px-2 text-gray-700">
                                      <div className="flex items-center gap-2">
                                        <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: ASSET_CLASS_COLORS[row.assetClass] || '#9ca3af' }} />
                                        {row.assetClass}
                                      </div>
                                    </td>
                                    <td className="text-right py-2 px-2 font-mono max-md:hidden">{row.invested.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                    <td className="text-right py-2 px-2 font-mono">{row.currentValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                    {/* Cash shows a dash, not "+0". A zero would read as "this
                                        broke even", when in fact profit and loss simply do not
                                        apply — cash was never bought at a price. The totals row
                                        still counts it, which is the point: idle cash drags the
                                        portfolio's overall return. */}
                                    <td className={`text-right py-2 px-2 font-mono font-medium ${row.assetClass === CASH_CLASS ? 'text-gray-400' : row.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {row.assetClass === CASH_CLASS ? '—'
                                        : `${row.pnl >= 0 ? '+' : ''}${row.pnl.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                                      {row.assetClass !== CASH_CLASS && row.invested > 0 && (
                                        <div className="hidden max-md:block text-[10px] opacity-80">
                                          {row.pnl >= 0 ? '+' : ''}{((row.pnl / row.invested) * 100).toFixed(1)}%
                                        </div>
                                      )}
                                    </td>
                                    <td className={`text-right py-2 px-2 font-mono font-medium max-md:hidden ${row.assetClass === CASH_CLASS ? 'text-gray-400' : row.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {row.assetClass === CASH_CLASS ? '—'
                                        : row.invested > 0 ? `${row.pnl >= 0 ? '+' : ''}${((row.pnl / row.invested) * 100).toFixed(1)}%` : '—'}
                                    </td>
                                    <td className="text-right py-2 px-2 font-mono">{row.weight.toFixed(1)}%</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                {(() => {
                                  const totalInv = assetClassRollup.reduce((s, r) => s + r.invested, 0);
                                  const totalCur = assetClassRollup.reduce((s, r) => s + r.currentValue, 0);
                                  const totalPnL = assetClassRollup.reduce((s, r) => s + r.pnl, 0);
                                  // Totals row: same light grey as the header - the thick top
                                  // border and bold text are what make it stand out, not a darker fill
                                  return (
                                    <tr className="border-t-2 border-gray-300 font-semibold bg-gray-100">
                                      <td className="py-2 px-2 text-gray-700 font-mono">{assetClassRollup.length} Classes</td>
                                      <td className="text-right py-2 px-2 font-mono max-md:hidden">{totalInv.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                      <td className="text-right py-2 px-2 font-mono">{totalCur.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                      <td className={`text-right py-2 px-2 font-mono ${totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {totalPnL >= 0 ? '+' : ''}{totalPnL.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                        {totalInv > 0 && (
                                          <div className="hidden max-md:block text-[10px] opacity-80">
                                            {totalPnL >= 0 ? '+' : ''}{((totalPnL / totalInv) * 100).toFixed(1)}%
                                          </div>
                                        )}
                                      </td>
                                      <td className={`text-right py-2 px-2 font-mono max-md:hidden ${totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {totalInv > 0 ? `${totalPnL >= 0 ? '+' : ''}${((totalPnL / totalInv) * 100).toFixed(1)}%` : '—'}
                                      </td>
                                      <td className="text-right py-2 px-2 font-mono">100.0%</td>
                                    </tr>
                                  );
                                })()}
                              </tfoot>
                            </table>
                          </div>
                          <div className="max-md:self-center" style={{ width: 220, height: 200, flexShrink: 0 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                {/* isAnimationActive={false} = draw instantly instead of sweeping in on tab open */}
                                <Pie
                                  isAnimationActive={false}
                                  data={assetClassRollup}
                                  dataKey="weight"
                                  nameKey="assetClass"
                                  cx="50%"
                                  cy="50%"
                                  outerRadius={75}
                                  innerRadius={35}
                                  paddingAngle={2}
                                  labelLine={false}
                                  label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }: { cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number }) => {
                                    if (percent < 0.05) return null;
                                    const RAD = Math.PI / 180;
                                    const r = innerRadius + (outerRadius - innerRadius) * 0.5;
                                    return (
                                      <text x={cx + r * Math.cos(-midAngle * RAD)} y={cy + r * Math.sin(-midAngle * RAD)} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight="bold">
                                        {`${(percent * 100).toFixed(1)}%`}
                                      </text>
                                    );
                                  }}
                                >
                                  {assetClassRollup.map((row) => (
                                    <Cell
                                      key={row.assetClass}
                                      fill={ASSET_CLASS_COLORS[row.assetClass] || '#9ca3af'}
                                      style={{ cursor: 'pointer', opacity: !openAssetClassFilter || openAssetClassFilter === row.assetClass ? 1 : 0.3 }}
                                      onClick={() => setOpenAssetClassFilter(prev => prev === row.assetClass ? null : row.assetClass)}
                                    />
                                  ))}
                                </Pie>
                                <Tooltip formatter={(value: number) => [`${value.toFixed(1)}%`, 'Weight']} />
                                <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* === Currency Breakdown (horizontal bar chart) === */}
                    {openSummaryData.length > 0 && (
                      <div className="bg-white p-4 rounded-lg shadow mb-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                          By Currency
                          {openAssetClassFilter && (
                            <span className="text-xs font-normal text-blue-600">— {openAssetClassFilter} only</span>
                          )}
                        </h4>
                        {/* flex gap-6 mirrors the Asset Class layout: bars take flex-1, spacer = 220px for visual alignment */}
                        <div className="flex gap-6 items-start max-md:flex-col max-md:items-stretch max-md:gap-3">
                          <div className="flex-1 space-y-2">
                            {activeCurrencyData.map(ccyRow => {
                              const isSelected = openCurrencyFilter === ccyRow.currency;
                              const isFiltered = !!openCurrencyFilter && !isSelected;
                              // Bar width as a % of the largest currency in the active dataset
                              const barPct = maxActiveCurrencyValue > 0 ? (ccyRow.currentValue / maxActiveCurrencyValue) * 100 : 0;
                              const color = CURRENCY_COLORS[ccyRow.currency] || MUTED;
                              return (
                                <div
                                  key={ccyRow.currency}
                                  className={`flex items-center gap-2 cursor-pointer px-1 py-0.5 rounded transition-colors ${
                                    isSelected
                                      ? 'bg-amber-50 outline outline-1 outline-amber-400'
                                      : isFiltered
                                      ? 'opacity-30'
                                      : 'hover:bg-gray-50'
                                  }`}
                                  onClick={() => setOpenCurrencyFilter(prev => prev === ccyRow.currency ? null : ccyRow.currency)}
                                >
                                  {/* Currency label (fixed width, right-aligned for clean column) */}
                                  <span className="text-xs font-mono text-gray-600 w-8 text-right flex-shrink-0">{ccyRow.currency}</span>
                                  <div className="relative flex-1 h-5 bg-gray-100 rounded">
                                    <div
                                      className="h-full rounded flex items-center pl-1.5"
                                      style={{ width: `${barPct}%`, backgroundColor: color }}
                                    >
                                      <span className="font-mono whitespace-nowrap" style={{ fontSize: 10, color: barPct >= 10 ? (color === SLATE ? ON_BLACK : 'white') : color }}>
                                        {ccyRow.currentValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                      </span>
                                    </div>
                                  </div>
                                  {/* % of total (sum of all bars in the active dataset) to the right */}
                                  <span className="text-xs font-mono text-gray-600 w-12 text-right flex-shrink-0">
                                    {totalActiveCurrencyValue > 0
                                      ? `${(ccyRow.currentValue / totalActiveCurrencyValue * 100).toFixed(1)}%`
                                      : '—'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          {/* Pie chart — same dimensions as By Asset Class, colors match the bars */}
                          <div className="max-md:self-center" style={{ width: 220, height: 200, flexShrink: 0 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                {/* isAnimationActive={false} = draw instantly instead of sweeping in on tab open */}
                                <Pie
                                  isAnimationActive={false}
                                  data={activeCurrencyData}
                                  dataKey="currentValue"
                                  nameKey="currency"
                                  cx="50%"
                                  cy="50%"
                                  outerRadius={75}
                                  innerRadius={35}
                                  paddingAngle={2}
                                  labelLine={false}
                                  label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }: { cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number }) => {
                                    if (percent < 0.05) return null;
                                    const RAD = Math.PI / 180;
                                    const r = innerRadius + (outerRadius - innerRadius) * 0.5;
                                    return (
                                      <text x={cx + r * Math.cos(-midAngle * RAD)} y={cy + r * Math.sin(-midAngle * RAD)} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight="bold">
                                        {`${(percent * 100).toFixed(1)}%`}
                                      </text>
                                    );
                                  }}
                                >
                                  {activeCurrencyData.map((row) => (
                                    <Cell
                                      key={row.currency}
                                      fill={CURRENCY_COLORS[row.currency] || MUTED}
                                      style={{ cursor: 'pointer', opacity: !openCurrencyFilter || openCurrencyFilter === row.currency ? 1 : 0.3 }}
                                      onClick={() => setOpenCurrencyFilter(prev => prev === row.currency ? null : row.currency)}
                                    />
                                  ))}
                                </Pie>
                                <Tooltip formatter={(value: number) => [value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }), 'Value']} />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* === By Account Breakdown (horizontal bar chart) === */}
                    {openSummaryData.length > 0 && (() => {
                      // Build the account rollup from data already filtered by currency + asset class filters.
                      // currencyFilteredData already accounts for both openCurrencyFilter and openAccountFilter,
                      // but here we want the source for the bars to be filtered by currency + asset class only
                      // (not by account itself — otherwise clicking an account would hide the other bars).
                      const acctBarSource = openSummaryData.filter(row =>
                        (!openCurrencyFilter  || effectiveCurrency(row) === openCurrencyFilter) &&
                        (!openAssetClassFilter || effectiveClass(row) === openAssetClassFilter)
                      );

                      // For each ticker in the filtered set, allocate its current value to each account
                      // in proportion to how much was purchased from that account (Purchase of Asset only).
                      const acctRollupMap: Record<string, number> = {};
                      for (const row of acctBarSource) {
                        const purchases = getOpenPurchases(row.ticker);
                        const purchaseOnly = purchases.filter(t => t.flow === 'Purchase of Asset');
                        const tickerTotalInvested = purchaseOnly.reduce((s, t) => s + t.amount, 0);
                        if (tickerTotalInvested === 0) continue;
                        const acctInvested: Record<string, number> = {};
                        for (const t of purchaseOnly) {
                          // Group on the account that PAID, so a broker's holdings sit on the same
                          // bar as its cash. See purchaseAccountOf above.
                          const acct = purchaseAccountOf(t);
                          acctInvested[acct] = (acctInvested[acct] || 0) + t.amount;
                        }
                        const nativeCcyForConv = effectiveCurrency(row) === METALS_CRYPTO_CCY ? (row.nativeCurrency || 'PLN') : effectiveCurrency(row);
                        const cvEff = positionsCurrency ? row.currentValueConverted : row.currentValue * toPLNLatest(nativeCcyForConv);
                        for (const [acct, invested] of Object.entries(acctInvested)) {
                          acctRollupMap[acct] = (acctRollupMap[acct] || 0) + cvEff * (invested / tickerTotalInvested);
                        }
                      }
                      // Cash sits on the bar for the account actually holding it. Because holdings
                      // are now grouped by their paying account too, an account's bar is its whole
                      // balance sheet: what it owns plus what it still has to spend.
                      // Filtered by currency + class, matching acctBarSource — the account filter
                      // is this chart's own.
                      for (const c of cashMatching(true, false, true)) {
                        acctRollupMap[c.account] = (acctRollupMap[c.account] || 0) + c.value;
                      }
                      const accountRollup = Object.entries(acctRollupMap)
                        .map(([account, currentValue]) => ({ account, currentValue }))
                        .sort((a, b) => b.currentValue - a.currentValue);
                      const maxAccountValue = Math.max(...accountRollup.map(r => r.currentValue), 0.01);
                      const totalAccountValue = accountRollup.reduce((s, r) => s + r.currentValue, 0);

                      // Same shared palette as the asset-class / currency charts, in the
                      // order that keeps neighbouring accounts easiest to tell apart.
                      const ACCOUNT_COLORS = [
                        CHART_PALETTE.blue, CHART_PALETTE.terracotta, CHART_PALETTE.teal, CHART_PALETTE.gold,
                        CHART_PALETTE.rose, CHART_PALETTE.olive, CHART_PALETTE.violet, CHART_PALETTE.wine,
                      ];
                      // Colour is pinned to the ACCOUNT, not to a position in an array. The pie
                      // below omits accounts in debit, so indexing it positionally would only line
                      // up with the bars by luck — true today because negatives sort last, and
                      // silently wrong the moment that ordering changes.
                      const accountColor = new Map(accountRollup.map((r, i) => [r.account, ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]]));

                      return (
                        <div className="bg-white p-4 rounded-lg shadow mb-4">
                          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                            By Account
                            {openAssetClassFilter && (
                              <span className="text-xs font-normal text-blue-600">— {openAssetClassFilter} only</span>
                            )}
                            {openCurrencyFilter && (
                              <span className="text-xs font-normal text-amber-600">— {openCurrencyFilter} positions only</span>
                            )}
                          </h4>
                          <div className="flex gap-6 items-start max-md:flex-col max-md:items-stretch max-md:gap-3">
                            <div className="flex-1 space-y-2">
                              {accountRollup.map((acctRow, idx) => {
                                const isSelected = openAccountFilter === acctRow.account;
                                const isFiltered = !!openAccountFilter && !isSelected;
                                // Clamped at zero because an account CAN now be negative (a cash
                                // balance in debit). A negative percentage is invalid CSS, so the
                                // browser drops the width entirely and the div falls back to auto —
                                // which rendered a -6,959 balance as a FULL-WIDTH bar, wider than
                                // the 2.8m one above it. A debit contributes nothing to what you
                                // hold, so it draws no bar; the figure and its % still show beside
                                // it, exactly as they do for a very small positive balance.
                                const barPct = maxAccountValue > 0
                                  ? Math.max(0, (acctRow.currentValue / maxAccountValue) * 100)
                                  : 0;
                                const color = accountColor.get(acctRow.account)!;
                                return (
                                  <div
                                    key={acctRow.account}
                                    className={`flex items-center gap-2 cursor-pointer px-1 py-0.5 rounded transition-colors ${
                                      isSelected
                                        ? 'bg-green-50 outline outline-1 outline-green-400'
                                        : isFiltered
                                        ? 'opacity-30'
                                        : 'hover:bg-gray-50'
                                    }`}
                                    onClick={() => setOpenAccountFilter(prev => prev === acctRow.account ? null : acctRow.account)}
                                  >
                                    {/* Name column 160px wide (96px on a phone, so the bar keeps some room) */}
                                    <span className="text-xs font-mono text-gray-600 text-right flex-shrink-0 min-w-[160px] max-md:min-w-[96px]">{acctRow.account}</span>
                                    <div className="relative flex-1 h-5 bg-gray-100 rounded">
                                      <div
                                        className="h-full rounded flex items-center pl-1.5"
                                        style={{ width: `${barPct}%`, backgroundColor: color }}
                                      >
                                        <span className="font-mono whitespace-nowrap" style={{ fontSize: 10, color: barPct >= 10 ? 'white' : color }}>
                                          {acctRow.currentValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                        </span>
                                      </div>
                                    </div>
                                    <span className="text-xs font-mono text-gray-600 w-12 text-right flex-shrink-0">
                                      {totalAccountValue > 0
                                        ? `${(acctRow.currentValue / totalAccountValue * 100).toFixed(1)}%`
                                        : '—'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            {/* Pie chart — colors match the account bars by index */}
                            <div className="max-md:self-center" style={{ width: 220, height: 200, flexShrink: 0 }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  {/* isAnimationActive={false} = draw instantly instead of sweeping in on tab open */}
                                  <Pie
                                    isAnimationActive={false}
                                    // Only positive values: a pie shows each part's share of a
                                    // whole, and a negative balance has no share of anything. The
                                    // bars beside it still list every account, including debits.
                                    data={accountRollup.filter(r => r.currentValue > 0)}
                                    dataKey="currentValue"
                                    nameKey="account"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={75}
                                    innerRadius={35}
                                    paddingAngle={2}
                                    labelLine={false}
                                    label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }: { cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number }) => {
                                      if (percent < 0.05) return null;
                                      const RAD = Math.PI / 180;
                                      const r = innerRadius + (outerRadius - innerRadius) * 0.5;
                                      return (
                                        <text x={cx + r * Math.cos(-midAngle * RAD)} y={cy + r * Math.sin(-midAngle * RAD)} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight="bold">
                                          {`${(percent * 100).toFixed(1)}%`}
                                        </text>
                                      );
                                    }}
                                  >
                                    {accountRollup.filter(r => r.currentValue > 0).map(row => (
                                      <Cell
                                        key={row.account}
                                        fill={accountColor.get(row.account)}
                                        style={{ cursor: 'pointer', opacity: !openAccountFilter || openAccountFilter === row.account ? 1 : 0.3 }}
                                        onClick={() => setOpenAccountFilter(prev => prev === row.account ? null : row.account)}
                                      />
                                    ))}
                                  </Pie>
                                  <Tooltip formatter={(value: number) => [value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }), 'Value']} />
                                </PieChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* === Cash Table === */}
                    {/* Sits above Open Positions because it answers the prior question:
                        before "what do I own?" comes "what money is sitting where, ready
                        to buy something?". Rows are grouped by account so an account's
                        currencies read together — Interactive Brokers' USD, PLN and SGD
                        lines belong side by side, not scattered by size across the table. */}
                    {cashAccounts.length > 0 && (() => {
                      // Convert each balance into the tab's chosen display currency, using
                      // today's FX. Cash has no purchase history to value against, so unlike
                      // a position there is only one sensible rate: the latest one.
                      //
                      // Obeys all three breakdown filters, so clicking a currency bar or an
                      // account bar narrows this table the same way it narrows Open Positions
                      // below. Clicking an asset class other than Cash empties it, which is the
                      // honest answer to "show me only the Equities part of my cash".
                      const rows = cashAccounts
                        .filter(c => cashPasses(c.account, c.currency, true, true, true))
                        .map(c => ({
                          ...c,
                          key: `${c.account}|${c.currency}`,
                          converted: c.balance * (positionsCurrency ? getLatestConversion(c.currency) : toPLNLatest(c.currency)),
                        }));
                      if (rows.length === 0) return null;

                      // Order accounts by how much cash they hold in total, then each
                      // account's currencies by size within it.
                      const totalByAccount = new Map<string, number>();
                      rows.forEach(r => totalByAccount.set(r.account, (totalByAccount.get(r.account) || 0) + r.converted));
                      rows.sort((a, b) =>
                        (totalByAccount.get(b.account)! - totalByAccount.get(a.account)!)
                        || (b.converted - a.converted)
                        || a.currency.localeCompare(b.currency));

                      const grandTotal = rows.reduce((s, r) => s + r.converted, 0);
                      // Weight bars are scaled against the largest balance, matching the
                      // Open Positions table's treatment of the same column.
                      const maxConverted = Math.max(...rows.map(r => Math.abs(r.converted)), 1);
                      // True when a row starts a new account block — drives the divider
                      // line and stops the account name repeating down the group.
                      const startsGroup = (i: number) => i === 0 || rows[i - 1].account !== rows[i].account;

                      // Click-to-sort. The account grouping above and a user-chosen sort are
                      // mutually exclusive by nature: you cannot keep Interactive Brokers' three
                      // currencies together AND order every row by balance. So while a sort is
                      // active the grouping stands down — the account name prints on every row
                      // and the divider lines disappear — and it comes straight back when the
                      // third click clears the sort.
                      const cashSort = tableSort['positionsCash'] ?? null;
                      const sortedCashRows = sortTableRows(rows, cashSort, {
                        account:   r => r.account,
                        currency:  r => r.currency,
                        balance:   r => r.balance,
                        totalIn:   r => r.totalIn,
                        totalOut:  r => r.totalOut,
                        movements: r => r.movements.length,
                        lastDate:  r => r.lastDate,
                        // Weight and the converted balance column are the same underlying number,
                        // one shown as a share of the total and one in the display currency. Weight
                        // is always on screen; the converted balance column only appears when a
                        // display currency is chosen, so its accessor comes and goes with it —
                        // same reasoning as the Open Positions table above.
                        weight:    r => r.converted,
                        ...(positionsCurrency ? {
                          converted: (r: typeof rows[number]) => r.converted,
                        } : {}),
                      });

                      return (
                        <div className="bg-white p-4 rounded-lg shadow mb-4">
                          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                            Cash
                            <span className="font-normal text-gray-500">
                              — uninvested balances, rebuilt from every movement in the ledger
                            </span>
                            {/* Same colour language as the breakdowns above: amber for a currency
                                filter, green for an account one, so it is obvious why rows vanished */}
                            {openCurrencyFilter && (
                              <span className="text-xs font-normal text-amber-600">— {openCurrencyFilter} only</span>
                            )}
                            {openAccountFilter && (
                              <span className="text-xs font-normal text-green-600">— {openAccountFilter} only</span>
                            )}
                          </h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs border-collapse">
                              <thead>
                                <tr className="border-b border-gray-200">
                                  <SortableTh col="account" align="left" numeric={false} {...sortPropsFor('positionsCash')}>Account</SortableTh>
                                  <SortableTh col="currency" align="left" numeric={false} {...sortPropsFor('positionsCash')}>Currency</SortableTh>
                                  <SortableTh col="balance" {...sortPropsFor('positionsCash')}>Balance</SortableTh>
                                  {/* Phones keep Account, Currency, Balance and the converted balance;
                                      the other columns are "max-md:hidden" (tap a row for the detail) */}
                                  <SortableTh col="totalIn" className="max-md:hidden" {...sortPropsFor('positionsCash')} title="Every credit this account has ever received, in this currency">Total In</SortableTh>
                                  <SortableTh col="totalOut" className="max-md:hidden" {...sortPropsFor('positionsCash')} title="Every debit this account has ever paid out, in this currency">Total Out</SortableTh>
                                  <SortableTh col="movements" className="max-md:hidden" {...sortPropsFor('positionsCash')} title="How many individual movements make up the balance">Movements</SortableTh>
                                  <SortableTh col="lastDate" className="max-md:hidden" numeric={false} {...sortPropsFor('positionsCash')}>Last Activity</SortableTh>
                                  <SortableTh col="weight" className="max-md:hidden" {...sortPropsFor('positionsCash')} style={{ width: 70 }} title="Share of total cash held">Weight</SortableTh>
                                  {positionsCurrency && <SortableTh col="converted" {...sortPropsFor('positionsCash')}>Balance {posCcyLabel}</SortableTh>}
                                </tr>
                              </thead>
                              <tbody>
                                {sortedCashRows.map((row, idx) => (
                                  <tr
                                    key={row.key}
                                    className={`cursor-pointer hover:bg-blue-50 transition-colors ${
                                      !cashSort && startsGroup(idx) ? 'border-t border-gray-200' : ''
                                    } border-b border-gray-50`}
                                    onClick={() => { setCashSelected(row.key); setCashCategory(''); }}
                                    title={`Click to see every inflow and outflow for ${row.account} in ${row.currency}`}
                                  >
                                    <td className="py-2 px-2 text-gray-700">{cashSort || startsGroup(idx) ? row.account : ''}</td>
                                    <td className="py-2 px-2 text-gray-500 font-mono">{row.currency}</td>
                                    <td className={`text-right py-2 px-2 font-mono font-medium ${row.balance < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                                      {row.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="text-right py-2 px-2 font-mono text-gray-500 max-md:hidden">{row.totalIn.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                                    <td className="text-right py-2 px-2 font-mono text-gray-500 max-md:hidden">{row.totalOut.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                                    <td className="text-right py-2 px-2 font-mono text-gray-500 max-md:hidden">{row.movements.length}</td>
                                    <td className="text-right py-2 px-2 font-mono text-gray-500 max-md:hidden" title={`First movement: ${row.firstDate}`}>{row.lastDate}</td>
                                    {/* Weight cell with inline bar chart — same treatment as Open Positions */}
                                    <td className="py-2 px-2 font-mono max-md:hidden" style={{ position: 'relative', overflow: 'hidden' }}>
                                      <div style={{
                                        position: 'absolute', left: 0, top: 0, bottom: 0,
                                        width: `${(Math.abs(row.converted) / maxConverted) * 100}%`,
                                        backgroundColor: WEIGHT_BAR,
                                        borderRadius: '0 2px 2px 0',
                                      }} />
                                      <span style={{ position: 'relative' }} className="text-right block">
                                        {grandTotal !== 0 ? ((row.converted / grandTotal) * 100).toFixed(1) : '0.0'}%
                                      </span>
                                    </td>
                                    {positionsCurrency && (
                                      <td className="text-right py-2 px-2 font-mono">
                                        {row.converted.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2 border-gray-300 font-semibold bg-gray-100">
                                  <td className="py-2 px-2 text-gray-700 font-mono">{rows.length} Balances</td>
                                  {/* The gap under the columns between: 6 on desktop, 2 on phones
                                      (Currency, Balance), so the converted total stays under its column */}
                                  <td colSpan={6} className="max-md:hidden"></td>
                                  <td colSpan={2} className="hidden max-md:table-cell"></td>
                                  <td className="text-right py-2 px-2 font-mono max-md:hidden">100.0%</td>
                                  {positionsCurrency && (
                                    <td className="text-right py-2 px-2 font-mono">
                                      {grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </td>
                                  )}
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                          {/* An honest caveat rather than a silently misleading number: the
                              ledger records money moving in and out of investments, so a
                              brokerage balance is complete, but an everyday bank account
                              only shows the part of it that this spreadsheet tracks. */}
                          <p className="text-xs text-gray-400 mt-3">
                            Brokerage and SRS balances are complete. Everyday bank accounts show only the
                            money this ledger tracks — spending outside it is not recorded, so their real
                            balance may be higher.
                          </p>
                        </div>
                      );
                    })()}

                    {/* === Open Positions Table === */}
                    {openSummaryData.length > 0 && (
                      <div className="bg-white p-4 rounded-lg shadow mb-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                          Open Positions
                          {/* Currency filter badge (amber) — cleared by clicking ✕ */}
                          {openCurrencyFilter && (
                            <span className="flex items-center gap-1 text-xs font-normal bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                              {openCurrencyFilter}
                              <button onClick={(e) => { e.stopPropagation(); setOpenCurrencyFilter(null); }} className="hover:text-amber-900 leading-none">✕</button>
                            </span>
                          )}
                          {/* Asset class filter badge (blue) — cleared by clicking ✕ */}
                          {openAssetClassFilter && (
                            <span className="flex items-center gap-1 text-xs font-normal bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                              {openAssetClassFilter}
                              <button onClick={(e) => { e.stopPropagation(); setOpenAssetClassFilter(null); }} className="hover:text-blue-900 leading-none">✕</button>
                            </span>
                          )}
                          {/* Account filter badge (green) — cleared by clicking ✕ */}
                          {openAccountFilter && (
                            <span className="flex items-center gap-1 text-xs font-normal bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                              {openAccountFilter}
                              <button onClick={(e) => { e.stopPropagation(); setOpenAccountFilter(null); }} className="hover:text-green-900 leading-none">✕</button>
                            </span>
                          )}
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-gray-200">
                                <SortableTh col="name" align="left" numeric={false} {...sortPropsFor('positionsOpen')}>Asset Name</SortableTh>
                                {/* Phones: just Value, PnL % and Weight after the name (time held goes
                                    under the name). These three cells exist only there ("hidden
                                    max-md:table-cell"), in the order a phone wants; every desktop
                                    column after the name is "max-md:hidden". Value is in the chosen
                                    currency, or each position's own when none is chosen. Tap a row
                                    for everything else. */}
                                <SortableTh col={positionsCurrency ? 'currentConverted' : 'currentValue'} className="hidden max-md:table-cell" {...sortPropsFor('positionsOpen')}>Value{positionsCurrency ? ` ${posCcyLabel}` : ''}</SortableTh>
                                <SortableTh col="pnlPct" className="hidden max-md:table-cell" {...sortPropsFor('positionsOpen')}>PnL %</SortableTh>
                                <SortableTh col="weight" className="hidden max-md:table-cell" {...sortPropsFor('positionsOpen')}>Weight</SortableTh>
                                <SortableTh col="timeHeld" className="max-md:hidden" {...sortPropsFor('positionsOpen')}>Time Held</SortableTh>
                                <SortableTh col="avgBuy" className="max-md:hidden" {...sortPropsFor('positionsOpen')}>Avg Buy</SortableTh>
                                <SortableTh col="price" className="max-md:hidden" {...sortPropsFor('positionsOpen')}>Price</SortableTh>
                                <SortableTh col="pnlPct" className="max-md:hidden" {...sortPropsFor('positionsOpen')}>PnL %</SortableTh>
                                <SortableTh col="qty" className="max-md:hidden" {...sortPropsFor('positionsOpen')}>Qty</SortableTh>
                                <SortableTh col="invested" className="max-md:hidden" {...sortPropsFor('positionsOpen')}>Total Invested</SortableTh>
                                <SortableTh col="currentValue" className="max-md:hidden" {...sortPropsFor('positionsOpen')}>Current Value</SortableTh>
                                <SortableTh col="pnl" className="max-md:hidden" {...sortPropsFor('positionsOpen')}>Total PnL</SortableTh>
                                <SortableTh col="xirr" className="max-md:hidden" {...sortPropsFor('positionsOpen')} title={XIRR_HINT}>XIRR</SortableTh>
                                <SortableTh col="weight" className="max-md:hidden" {...sortPropsFor('positionsOpen')} style={{ width: 70 }}>Weight</SortableTh>
                                {positionsCurrency && <SortableTh col="investedConverted" className="max-md:hidden" {...sortPropsFor('positionsOpen')}>Invested {posCcyLabel}</SortableTh>}
                                {positionsCurrency && <SortableTh col="currentConverted" className="max-md:hidden" {...sortPropsFor('positionsOpen')}>Current {posCcyLabel}</SortableTh>}
                                {positionsCurrency && <SortableTh col="pnlConverted" className="max-md:hidden" {...sortPropsFor('positionsOpen')}>PnL {posCcyLabel}</SortableTh>}
                              </tr>
                            </thead>
                            <tbody>
                              {/* Sorting re-orders the rows only. The weight bars still scale against
                                  maxWeight and the totals row still sums filteredOpenData, so neither
                                  changes when you click a heading. A position with no XIRR (shown as
                                  "N/A") sorts to the bottom either way rather than pretending to be zero. */}
                              {sortTableRows(filteredOpenData, tableSort['positionsOpen'] ?? null, {
                                name:              r => r.name,
                                timeHeld:          r => r.timeHeldYears,
                                avgBuy:            r => r.avgBuyPrice,
                                price:             r => r.currentPrice,
                                pnlPct:            r => r.totalPnLPct,
                                qty:               r => r.totalShares,
                                invested:          r => r.totalInvested,
                                currentValue:      r => r.currentValue,
                                pnl:               r => r.totalPnL,
                                xirr:              r => r.xirr,
                                weight:            r => r._weight,
                                // The three converted columns only exist while a display currency is
                                // chosen, so their accessors come and go with them. Without this, turning
                                // the conversion off would leave the table sorted by a column you can no
                                // longer see, with no arrow anywhere and no way to click it off. An
                                // accessor that isn't there means sortTableRows leaves the order alone —
                                // and the sort comes back if you switch the currency back on.
                                ...(positionsCurrency ? {
                                  investedConverted: (r: typeof filteredOpenData[number]) => r.investedConverted,
                                  currentConverted:  (r: typeof filteredOpenData[number]) => r.currentValueConverted,
                                  pnlConverted:      (r: typeof filteredOpenData[number]) => r.totalPnLConverted,
                                } : {}),
                              }).map((row, idx) => (
                                <tr
                                  key={row.ticker}
                                  className={`border-b border-gray-50 cursor-pointer hover:bg-blue-50 transition-colors ${idx % 2 === 0 ? '' : 'bg-gray-25'}`}
                                  onClick={() => {
                                    setOpenSelectedTicker(row.ticker);
                                    setClosedSelectedTicker(''); // clear closed detail
                                    setOpenIncludedTxns(null);
                                    setOpenInvestedInto('');
                                    setOpenInvestedFrom('');
                                    setOpenGraphStarts('');
                                    setOpenGraphEnds('');
                                    // Opening a position resets the chart to its default view. These
                                    // must mirror the useState defaults above — this is what actually
                                    // decides what you see, since you always arrive here by clicking.
                                    setOpenSinceInvested(true);
                                    setOpenShowAvgBuy(true);
                                    setOpenShowMinMax(false);
                                  }}
                                >
                                  <td className="py-2 px-2 text-gray-700">
                                    {row.name}
                                    <div className="hidden max-md:block text-[10px] text-gray-400 font-mono">{row.timeHeldYears.toFixed(1)}y</div>
                                  </td>
                                  {/* Phones only: Value, PnL %, Weight (see the header) */}
                                  <td className="hidden max-md:table-cell text-right py-2 px-2 font-mono">
                                    {(positionsCurrency ? row.currentValueConverted : row.currentValue).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                  </td>
                                  <td className={`hidden max-md:table-cell text-right py-2 px-2 font-mono font-medium ${row.totalPnLPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {row.totalPnLPct >= 0 ? '+' : ''}{row.totalPnLPct.toFixed(1)}%
                                  </td>
                                  <td className="hidden max-md:table-cell text-right py-2 px-2 font-mono">{row._weight.toFixed(1)}%</td>
                                  <td className="text-right py-2 px-2 font-mono max-md:hidden" title={`First Buy: ${row.firstBuyDate}\nLast Valuation: ${row.lastValuation}`}>{row.timeHeldYears.toFixed(1)}y</td>
                                  <td className="text-right py-2 px-2 font-mono max-md:hidden">{formatPrice(row.avgBuyPrice)}</td>
                                  <td className="text-right py-2 px-2 font-mono max-md:hidden">{formatPrice(row.currentPrice)}</td>
                                  <td className={`text-right py-2 px-2 font-mono font-medium max-md:hidden ${row.totalPnLPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {row.totalPnLPct >= 0 ? '+' : ''}{row.totalPnLPct.toFixed(1)}%
                                  </td>
                                  <td className="text-right py-2 px-2 font-mono max-md:hidden">{row.totalShares.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</td>
                                  <td className="text-right py-2 px-2 font-mono max-md:hidden">{row.totalInvested.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className="text-right py-2 px-2 font-mono max-md:hidden">{row.currentValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className={`text-right py-2 px-2 font-mono font-medium max-md:hidden ${row.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {row.totalPnL >= 0 ? '+' : ''}{row.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                  </td>
                                  <td className={`text-right py-2 px-2 font-mono font-medium max-md:hidden ${(row.xirr ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {row.xirr !== null ? `${row.xirr >= 0 ? '+' : ''}${row.xirr.toFixed(1)}%` : 'N/A'}
                                  </td>
                                  {/* Weight cell with inline bar chart */}
                                  <td className="py-2 px-2 font-mono max-md:hidden" style={{ position: 'relative', overflow: 'hidden' }}>
                                    <div style={{
                                      position: 'absolute', left: 0, top: 0, bottom: 0,
                                      width: `${(row._weight / maxWeight) * 100}%`,
                                      backgroundColor: WEIGHT_BAR,
                                      borderRadius: '0 2px 2px 0',
                                    }} />
                                    <span style={{ position: 'relative' }} className="text-right block">
                                      {row._weight.toFixed(1)}%
                                    </span>
                                  </td>
                                  {positionsCurrency && <td className="text-right py-2 px-2 font-mono max-md:hidden">{row.investedConverted.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>}
                                  {positionsCurrency && <td className="text-right py-2 px-2 font-mono max-md:hidden">{row.currentValueConverted.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>}
                                  {positionsCurrency && <td className={`text-right py-2 px-2 font-mono font-medium max-md:hidden ${row.totalPnLConverted >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {row.totalPnLConverted >= 0 ? '+' : ''}{row.totalPnLConverted.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                  </td>}
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              {(() => {
                                const totalInvestedCcy = filteredOpenData.reduce((sum, r) => sum + r.investedConverted, 0);
                                const totalCurrentCcy = filteredOpenData.reduce((sum, r) => sum + r.currentValueConverted, 0);
                                const totalPnLCcy = filteredOpenData.reduce((sum, r) => sum + r.totalPnLConverted, 0);
                                // Totals row: same light grey as the header - the thick top
                                // border and bold text are what make it stand out, not a darker fill
                                return (
                                  <tr className="border-t-2 border-gray-300 font-semibold bg-gray-100">
                                    <td className="py-2 px-2 text-gray-700 font-mono">{filteredOpenData.length} Holdings</td>
                                    {/* Phones: the total value (in the chosen currency; positions in
                                        their own currencies can't be added up) and its return */}
                                    <td className="hidden max-md:table-cell text-right py-2 px-2 font-mono">
                                      {positionsCurrency ? totalCurrentCcy.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : ''}
                                    </td>
                                    <td className={`hidden max-md:table-cell text-right py-2 px-2 font-mono ${totalPnLCcy >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {positionsCurrency && totalInvestedCcy > 0 ? `${totalPnLCcy >= 0 ? '+' : ''}${((totalPnLCcy / totalInvestedCcy) * 100).toFixed(1)}%` : ''}
                                    </td>
                                    <td className="hidden max-md:table-cell text-right py-2 px-2 font-mono">100%</td>
                                    <td colSpan={10} className="max-md:hidden"></td>
                                    {positionsCurrency && <td className="text-right py-2 px-2 font-mono max-md:hidden">{totalInvestedCcy.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>}
                                    {positionsCurrency && <td className="text-right py-2 px-2 font-mono max-md:hidden">{totalCurrentCcy.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>}
                                    {positionsCurrency && <td className={`text-right py-2 px-2 font-mono max-md:hidden ${totalPnLCcy >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {totalPnLCcy >= 0 ? '+' : ''}{totalPnLCcy.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    </td>}
                                  </tr>
                                );
                              })()}
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* === Closed Positions Table === */}
                    {closedSummaryData.length > 0 && (
                      <div className="bg-white p-4 rounded-lg shadow">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">Closed Positions</h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-gray-200">
                                <SortableTh col="name" align="left" numeric={false} {...sortPropsFor('positionsClosed')}>Asset Name</SortableTh>
                                {/* Phones: Invested, PnL (with its % under it) and XIRR after the
                                    name, time held under the name; the rest is "max-md:hidden" */}
                                <SortableTh col="numTransactions" className="max-md:hidden" {...sortPropsFor('positionsClosed')}># Txns</SortableTh>
                                <SortableTh col="firstBuyDate" className="max-md:hidden" numeric={false} {...sortPropsFor('positionsClosed')}>First Buy</SortableTh>
                                <SortableTh col="lastSaleDate" className="max-md:hidden" numeric={false} {...sortPropsFor('positionsClosed')}>Last Sale</SortableTh>
                                <SortableTh col="timeHeld" className="max-md:hidden" {...sortPropsFor('positionsClosed')}>Time Held</SortableTh>
                                <SortableTh col="invested" {...sortPropsFor('positionsClosed')}>Total Invested</SortableTh>
                                <SortableTh col="finalValue" className="max-md:hidden" {...sortPropsFor('positionsClosed')}>Total Final Value</SortableTh>
                                <SortableTh col="pnl" {...sortPropsFor('positionsClosed')}>Total PnL</SortableTh>
                                <SortableTh col="pnlPct" className="max-md:hidden" {...sortPropsFor('positionsClosed')}>PnL %</SortableTh>
                                <SortableTh col="xirr" {...sortPropsFor('positionsClosed')} title={XIRR_HINT}>XIRR</SortableTh>
                              </tr>
                            </thead>
                            <tbody>
                              {sortTableRows(closedSummaryData, tableSort['positionsClosed'] ?? null, {
                                name:            r => r.name,
                                numTransactions: r => r.numTransactions,
                                firstBuyDate:    r => r.firstBuyDate,
                                lastSaleDate:    r => r.lastSaleDate,
                                timeHeld:        r => r.timeHeldYears,
                                invested:        r => r.totalInvested,
                                finalValue:      r => r.totalFinalValue,
                                pnl:             r => r.totalPnL,
                                pnlPct:          r => r.totalPnLPct,
                                xirr:            r => r.xirr,
                              }).map((row, idx) => (
                                <tr
                                  key={row.ticker}
                                  className={`border-b border-gray-50 cursor-pointer hover:bg-blue-50 transition-colors ${idx % 2 === 0 ? '' : 'bg-gray-25'}`}
                                  onClick={() => {
                                    setClosedSelectedTicker(row.ticker);
                                    setOpenSelectedTicker(''); // clear open detail
                                    setClosedIncludedTxns(null);
                                    setClosedInvestedInto('');
                                    setClosedInvestedFrom('');
                                    setClosedGraphEnds('');
                                    setClosedGraphStarts('');
                                    // Opening a position resets the chart to its default view. These
                                    // must mirror the useState defaults above — this is what actually
                                    // decides what you see, since you always arrive here by clicking.
                                    setClosedSinceInvested(true);
                                    setClosedUntilSold(false);
                                    setClosedShowAvgBuy(true);
                                    setClosedShowAvgSell(true);
                                    setClosedShowMinMax(false);
                                  }}
                                >
                                  <td className="py-2 px-2 text-gray-700">
                                    {row.name}
                                    <div className="hidden max-md:block text-[10px] text-gray-400 font-mono">{row.timeHeldYears.toFixed(1)}y</div>
                                  </td>
                                  <td className="text-right py-2 px-2 max-md:hidden">{row.numTransactions}</td>
                                  <td className="text-right py-2 px-2 font-mono max-md:hidden">{row.firstBuyDate}</td>
                                  <td className="text-right py-2 px-2 font-mono max-md:hidden">{row.lastSaleDate}</td>
                                  <td className="text-right py-2 px-2 font-mono max-md:hidden">{row.timeHeldYears.toFixed(1)}y</td>
                                  <td className="text-right py-2 px-2 font-mono">{row.totalInvested.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className="text-right py-2 px-2 font-mono max-md:hidden">{row.totalFinalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className={`text-right py-2 px-2 font-mono font-medium ${row.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {row.totalPnL >= 0 ? '+' : ''}{row.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    <div className="hidden max-md:block text-[10px] opacity-80">{row.totalPnLPct >= 0 ? '+' : ''}{row.totalPnLPct.toFixed(1)}%</div>
                                  </td>
                                  <td className={`text-right py-2 px-2 font-mono font-medium max-md:hidden ${row.totalPnLPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {row.totalPnLPct >= 0 ? '+' : ''}{row.totalPnLPct.toFixed(1)}%
                                  </td>
                                  <td className={`text-right py-2 px-2 font-mono font-medium ${(row.xirr ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {row.xirr !== null ? `${row.xirr >= 0 ? '+' : ''}${row.xirr.toFixed(1)}%` : 'N/A'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-gray-400 mt-3">Click a row to see detailed transactions, chart, and statistics.</p>
                  </>
                );
              })()}

              {/* --- CASH DETAIL VIEW --- */}
              {/* The bank statement behind one balance. An open position's detail page asks
                  "what did I pay and what is it worth now?"; a cash balance has no price, so
                  the interesting questions are different: where did this money come from,
                  where did it go, and what was the balance along the way. */}
              {cashSelected && (() => {
                const cashRow = cashAccounts.find(c => `${c.account}|${c.currency}` === cashSelected);
                // The selected balance can genuinely vanish underneath us: hit Refresh while
                // this page is open and the sheet no longer has that account (renamed, or its
                // last money moved out so it fell below the visibility threshold). Returning
                // null here would render an empty tab — the summary above is suppressed while
                // cashSelected is set — leaving no way back except switching tabs. So offer
                // the way back explicitly rather than silently rendering nothing.
                if (!cashRow) {
                  return (
                    <div className="bg-white p-8 rounded-lg shadow text-center text-gray-500">
                      <p className="mb-3">That cash balance is no longer in the data — it may have changed in the sheet.</p>
                      <button
                        onClick={() => { setCashSelected(''); setCashCategory(''); }}
                        className={BTN_SECOND}
                      >
                        Back to list
                      </button>
                    </div>
                  );
                }

                const { movements } = cashRow;
                const fmt = (n: number, dp = 2) => n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

                // --- Breakdown: group the movements by what kind of event they were, so
                // "where did 1.5m dollars of inflow come from?" has an answer at a glance.
                const byCategory = new Map<string, { inflow: number; outflow: number; count: number }>();
                for (const m of movements) {
                  const c = byCategory.get(m.category) || { inflow: 0, outflow: 0, count: 0 };
                  if (m.direction === 'in') c.inflow += m.amount; else c.outflow += m.amount;
                  c.count++;
                  byCategory.set(m.category, c);
                }
                const categories = Array.from(byCategory.entries())
                  .map(([category, v]) => ({ category, ...v, net: v.inflow - v.outflow }))
                  .sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow));

                // A few headline numbers worth pulling out of the categories above
                const interestEarned = (byCategory.get('Interest')?.inflow || 0) + (byCategory.get('Dividends')?.inflow || 0);
                const feesPaid = byCategory.get('Fees & commissions')?.outflow || 0;

                // --- Balance-over-time chart. One point per movement is honest (the balance
                // really did step at each one) but 278 points with duplicate dates render
                // badly, so same-day movements collapse to the day's CLOSING balance —
                // which is what a bank statement shows anyway.
                const balanceByDate = new Map<string, number>();
                for (const m of movements) balanceByDate.set(m.date, m.balance);
                const chartData = Array.from(balanceByDate.entries()).map(([date, balance]) => ({ date, balance }));

                // Newest first: the recent movements are the ones you came here to read.
                const statement = movements.slice().reverse();

                return (
                  <>
                    <div className="flex items-center gap-3 mb-4">
                      <button
                        onClick={() => { setCashSelected(''); setCashCategory(''); }}
                        className={`${BTN_SECOND} max-md:shrink-0 max-md:pl-2`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        {/* Phones: just "Back", so the button stays one line beside the title */}
                        Back<span className="max-md:hidden"> to list</span>
                      </button>
                      <h3 className="text-lg font-semibold text-gray-800 max-md:text-base max-md:leading-snug">
                        {cashRow.account} — {cashRow.currency} cash
                      </h3>
                    </div>

                    {/* --- Stat cards --- */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
                      {[
                        { label: 'Current Balance', value: fmt(cashRow.balance), tone: cashRow.balance < 0 ? 'text-red-600' : 'text-gray-800',
                          hint: `Every credit less every debit, as of ${cashRow.lastDate}` },
                        { label: 'Total In', value: fmt(cashRow.totalIn, 0), tone: 'text-green-600',
                          hint: 'Everything that ever arrived in this account, in this currency' },
                        { label: 'Total Out', value: fmt(cashRow.totalOut, 0), tone: 'text-red-600',
                          hint: 'Everything that ever left' },
                        { label: 'Income Earned', value: fmt(interestEarned), tone: 'text-green-600',
                          hint: 'Interest and dividends credited straight to this cash account' },
                        { label: 'Fees Paid', value: fmt(feesPaid), tone: feesPaid > 0 ? 'text-red-600' : 'text-gray-400',
                          hint: 'Commissions and charges booked directly against this account. Trading commissions are already inside each purchase and sale amount, so they are not counted again here.' },
                        { label: 'Movements', value: String(movements.length), tone: 'text-gray-800',
                          hint: `From ${cashRow.firstDate} to ${cashRow.lastDate}` },
                      ].map(card => (
                        <div key={card.label} className="bg-white p-3 rounded-lg shadow" title={card.hint}>
                          <div className="text-xs text-gray-500 mb-1">{card.label}</div>
                          <div className={`text-lg font-semibold font-mono ${card.tone}`}>{card.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* --- Where the money came from and went --- */}
                    <div className="bg-white p-4 rounded-lg shadow mb-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                        Inflows &amp; Outflows by Type
                        <span className="font-normal text-gray-500">(all figures in {cashRow.currency})</span>
                        {cashCategory && (
                          <span className="flex items-center gap-1 text-xs font-normal bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                            {cashCategory}
                            <button onClick={() => setCashCategory('')} className="hover:text-blue-900 leading-none">✕</button>
                          </span>
                        )}
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <SortableTh col="category" align="left" numeric={false} {...sortPropsFor('cashCategories')}>Type</SortableTh>
                              <SortableTh col="inflow" {...sortPropsFor('cashCategories')}>In</SortableTh>
                              <SortableTh col="outflow" {...sortPropsFor('cashCategories')}>Out</SortableTh>
                              <SortableTh col="net" {...sortPropsFor('cashCategories')}>Net</SortableTh>
                              <SortableTh col="count" {...sortPropsFor('cashCategories')}># Movements</SortableTh>
                            </tr>
                          </thead>
                          <tbody>
                            {sortTableRows(categories, tableSort['cashCategories'] ?? null, {
                              category: c => c.category,
                              inflow:   c => c.inflow,
                              outflow:  c => c.outflow,
                              net:      c => c.net,
                              count:    c => c.count,
                            }).map((c, idx) => (
                              <tr
                                key={c.category}
                                className={`border-b border-gray-50 cursor-pointer transition-colors ${
                                  cashCategory === c.category
                                    ? 'bg-blue-50 outline outline-1 outline-blue-300'
                                    : cashCategory
                                    ? 'opacity-40 hover:opacity-100'
                                    : idx % 2 === 0 ? 'hover:bg-blue-50' : 'bg-gray-25 hover:bg-blue-50'
                                }`}
                                onClick={() => setCashCategory(prev => prev === c.category ? '' : c.category)}
                                title={`Click to list the ${c.count} ${c.category.toLowerCase()} movements`}
                              >
                                <td className="py-2 px-2 text-gray-700">{c.category}</td>
                                <td className="text-right py-2 px-2 font-mono text-green-600">{c.inflow > 0 ? fmt(c.inflow) : ''}</td>
                                <td className="text-right py-2 px-2 font-mono text-red-600">{c.outflow > 0 ? fmt(c.outflow) : ''}</td>
                                <td className={`text-right py-2 px-2 font-mono font-medium ${c.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {c.net >= 0 ? '+' : ''}{fmt(c.net)}
                                </td>
                                <td className="text-right py-2 px-2 font-mono text-gray-500">{c.count}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-gray-300 font-semibold bg-gray-100">
                              <td className="py-2 px-2 text-gray-700">Balance</td>
                              <td className="text-right py-2 px-2 font-mono text-green-600">{fmt(cashRow.totalIn)}</td>
                              <td className="text-right py-2 px-2 font-mono text-red-600">{fmt(cashRow.totalOut)}</td>
                              <td className={`text-right py-2 px-2 font-mono ${cashRow.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(cashRow.balance)}</td>
                              <td className="text-right py-2 px-2 font-mono">{movements.length}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>

                      {/* --- Drill-down: every movement in the clicked category --- */}
                      {/* Lives inside the same card as the breakdown it expands, so the link
                          between the row you clicked and the list below is obvious. The Asset
                          column is the reason this exists: "4,549.35 of dividends" is a number,
                          "1,204.42 from Vanguard FTSE All-World on 2026-03-24" is an answer. */}
                      {cashCategory && (() => {
                        const inCategory = movements.filter(m => m.category === cashCategory);
                        if (inCategory.length === 0) return null;
                        const catIn = inCategory.filter(m => m.direction === 'in').reduce((s, m) => s + m.amount, 0);
                        const catOut = inCategory.filter(m => m.direction === 'out').reduce((s, m) => s + m.amount, 0);
                        // Newest first, matching the Statement below
                        const listed = inCategory.slice().reverse();
                        // Some categories are pure cash movements with no asset behind them
                        // (deposits, FX, transfers). Dropping the column there keeps the table
                        // honest rather than printing "Cash" forty times.
                        const showAsset = inCategory.some(m => m.asset && m.asset !== 'Cash');

                        // --- Monthly totals for the bar chart ---
                        // A table tells you the numbers; bars tell you the RHYTHM — that interest
                        // arrives every month but dividends only quarterly, that FX conversions
                        // cluster before big purchases. That is what this is for.
                        //
                        // Months with no activity are filled in with zeros rather than skipped.
                        // Without them the axis would silently compress a quiet year into the same
                        // width as a busy one, which is exactly the pattern you are looking for.
                        const monthlyData = (() => {
                          const byMonth = new Map<string, { inflow: number; outflow: number; count: number }>();
                          for (const m of inCategory) {
                            const key = m.date.slice(0, 7);          // "2026-03"
                            const e = byMonth.get(key) || { inflow: 0, outflow: 0, count: 0 };
                            if (m.direction === 'in') e.inflow += m.amount; else e.outflow += m.amount;
                            e.count++;
                            byMonth.set(key, e);
                          }
                          const keys = Array.from(byMonth.keys()).sort();
                          if (keys.length === 0) return [];
                          const out: { month: string; inflow: number; outflow: number; count: number }[] = [];
                          // Walk month by month from the first to the last, so the gaps are real gaps
                          const [startY, startM] = keys[0].split('-').map(Number);
                          const last = keys[keys.length - 1];
                          const cursor = new Date(Date.UTC(startY, startM - 1, 1));
                          for (let guard = 0; guard < 1200; guard++) {
                            const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
                            const e = byMonth.get(key);
                            out.push({ month: key, inflow: e?.inflow ?? 0, outflow: e?.outflow ?? 0, count: e?.count ?? 0 });
                            if (key >= last) break;
                            cursor.setUTCMonth(cursor.getUTCMonth() + 1);
                          }
                          return out;
                        })();
                        // Only draw a series that actually has something in it, so a one-directional
                        // category (interest, dividends) gets one clean set of bars rather than a
                        // legend promising an "Out" series that is flat zero.
                        const hasIn = catIn > 0, hasOut = catOut > 0;

                        return (
                          <div className="mt-4 pt-4 border-t border-gray-200">
                            <h5 className="text-xs font-semibold text-gray-700 mb-2">
                              {cashCategory}
                              <span className="font-normal text-gray-500">
                                {' '}— {inCategory.length} movement{inCategory.length === 1 ? '' : 's'} in {cashRow.currency}
                              </span>
                            </h5>

                            {/* --- Monthly bars for the selected category --- */}
                            {monthlyData.length > 0 && (
                              <div className="mb-4">
                                <div className="text-xs text-gray-500 mb-1">
                                  Monthly total{hasIn && hasOut ? 's' : ''} · {monthlyData.length} month{monthlyData.length === 1 ? '' : 's'} from {monthlyData[0].month} to {monthlyData[monthlyData.length - 1].month}
                                </div>
                                <ResponsiveContainer width="100%" height={180}>
                                  <BarChart data={monthlyData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
                                    {/* minTickGap thins the labels automatically, so 86 months of
                                        history stays readable without hand-tuning an interval */}
                                    <XAxis dataKey="month" tick={{ fontSize: 9 }} minTickGap={24} />
                                    <YAxis tick={{ fontSize: 9 }} width={52}
                                           tickFormatter={(v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
                                    <Tooltip
                                      cursor={{ fill: 'rgba(0,0,0,0.06)' }}
                                      formatter={(value: number, name: string) => [`${fmt(value)} ${cashRow.currency}`, name]}
                                      labelFormatter={(label: string) => {
                                        const row = monthlyData.find(d => d.month === label);
                                        return `${label} — ${row?.count ?? 0} movement${row?.count === 1 ? '' : 's'}`;
                                      }}
                                    />
                                    {/* Both series shown only when the category really moves both
                                        ways (FX conversions, transfers). Green in, red out — the
                                        same language as the In/Out columns in the table below. */}
                                    {hasIn && <Bar dataKey="inflow" name="In" fill={GAIN} isAnimationActive={false} />}
                                    {hasOut && <Bar dataKey="outflow" name="Out" fill={LOSS} isAnimationActive={false} />}
                                    {hasIn && hasOut && <Legend wrapperStyle={{ fontSize: 11 }} />}
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            )}

                            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                              <table className="w-full text-xs border-collapse">
                                <thead className="sticky top-0">
                                  <tr className="border-b border-gray-200">
                                    <SortableTh col="date" align="left" numeric={false} {...sortPropsFor('cashCategoryList')}>Date</SortableTh>
                                    {showAsset && <SortableTh col="asset" align="left" numeric={false} {...sortPropsFor('cashCategoryList')}>Asset</SortableTh>}
                                    <SortableTh col="counterparty" align="left" numeric={false} {...sortPropsFor('cashCategoryList')} title="The account at the other end of this movement">Counterparty</SortableTh>
                                    <SortableTh col="remarks" align="left" numeric={false} {...sortPropsFor('cashCategoryList')}>Remarks</SortableTh>
                                    <SortableTh col="in" {...sortPropsFor('cashCategoryList')}>In</SortableTh>
                                    <SortableTh col="out" {...sortPropsFor('cashCategoryList')}>Out</SortableTh>
                                    <SortableTh col="balance" {...sortPropsFor('cashCategoryList')} title="The account's running balance immediately after this movement">Balance</SortableTh>
                                  </tr>
                                </thead>
                                <tbody>
                                  {/* The In and Out columns are two halves of one amount: a movement
                                      is either a credit or a debit, never both. Sorting by In there-
                                      fore ranks the credits and leaves every debit row (an empty In
                                      cell) at the bottom, which is exactly what you want from it. */}
                                  {sortTableRows(listed, tableSort['cashCategoryList'] ?? null, {
                                    date:         m => m.date,
                                    asset:        m => m.asset,
                                    counterparty: m => m.counterparty,
                                    remarks:      m => m.remarks,
                                    in:           m => m.direction === 'in' ? m.amount : null,
                                    out:          m => m.direction === 'out' ? m.amount : null,
                                    balance:      m => m.balance,
                                  }).map((m, idx) => (
                                    <tr key={`${cashCategory}-${m.date}-${idx}`} className={`border-b border-gray-50 ${idx % 2 === 0 ? '' : 'bg-gray-25'}`}>
                                      <td className="py-1.5 px-2 font-mono whitespace-nowrap text-gray-600">{m.date}</td>
                                      {showAsset && (
                                        <td className="py-1.5 px-2 text-gray-700">
                                          {m.asset && m.asset !== 'Cash' ? m.asset : <span className="text-gray-400">—</span>}
                                          {m.ticker && <span className="text-gray-400"> ({m.ticker})</span>}
                                        </td>
                                      )}
                                      <td className="py-1.5 px-2 text-gray-500">{m.counterparty}</td>
                                      <td className="py-1.5 px-2 text-gray-500" title={m.remarks}>{m.remarks}</td>
                                      <td className="text-right py-1.5 px-2 font-mono text-green-600">{m.direction === 'in' ? fmt(m.amount) : ''}</td>
                                      <td className="text-right py-1.5 px-2 font-mono text-red-600">{m.direction === 'out' ? fmt(m.amount) : ''}</td>
                                      <td className={`text-right py-1.5 px-2 font-mono ${m.balance < 0 ? 'text-red-600' : 'text-gray-700'}`}>{fmt(m.balance)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t-2 border-gray-300 font-semibold bg-gray-100">
                                    <td className="py-2 px-2 text-gray-700 font-mono">Total</td>
                                    {showAsset && <td></td>}
                                    <td colSpan={2}></td>
                                    <td className="text-right py-2 px-2 font-mono text-green-600">{catIn > 0 ? fmt(catIn) : ''}</td>
                                    <td className="text-right py-2 px-2 font-mono text-red-600">{catOut > 0 ? fmt(catOut) : ''}</td>
                                    {/* The running-balance column has no meaningful total, so it
                                        shows the category's NET effect on the account instead. */}
                                    <td className={`text-right py-2 px-2 font-mono ${catIn - catOut >= 0 ? 'text-green-600' : 'text-red-600'}`}
                                        title="Net effect of this category on the balance">
                                      {catIn - catOut >= 0 ? '+' : ''}{fmt(catIn - catOut)}
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* --- Balance over time --- */}
                    {chartData.length > 1 && (
                      <div className="bg-white p-4 rounded-lg shadow mb-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">
                          Balance Over Time
                          <span className="font-normal text-gray-500"> (closing balance on each day with activity)</span>
                        </h4>
                        <ResponsiveContainer width="100%" height={260}>
                          <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={LINE} />
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
                            <Tooltip
                              formatter={(value: number) => [`${fmt(value)} ${cashRow.currency}`, 'Balance']}
                              labelFormatter={(label: string) => label}
                            />
                            {/* Zero line makes an overdrawn stretch obvious at a glance */}
                            <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={1} />
                            <Area type="stepAfter" dataKey="balance" stroke={CHART_PALETTE.blue} fill={CHART_PALETTE.blue} fillOpacity={0.15} strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* --- The statement itself --- */}
                    <div className="bg-white p-4 rounded-lg shadow">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">
                        Statement
                        <span className="font-normal text-gray-500"> (newest first — {movements.length} movements in {cashRow.currency})</span>
                      </h4>
                      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead className="sticky top-0">
                            <tr className="border-b border-gray-200">
                              <SortableTh col="date" align="left" numeric={false} {...sortPropsFor('cashStatement')}>Date</SortableTh>
                              <SortableTh col="category" align="left" numeric={false} {...sortPropsFor('cashStatement')}>Type</SortableTh>
                              <SortableTh col="counterparty" align="left" numeric={false} {...sortPropsFor('cashStatement')} title="The account at the other end of this movement">Counterparty</SortableTh>
                              <SortableTh col="details" align="left" numeric={false} {...sortPropsFor('cashStatement')}>Details</SortableTh>
                              <SortableTh col="in" {...sortPropsFor('cashStatement')}>In</SortableTh>
                              <SortableTh col="out" {...sortPropsFor('cashStatement')}>Out</SortableTh>
                              <SortableTh col="balance" {...sortPropsFor('cashStatement')} title="The balance immediately after this movement">Balance</SortableTh>
                            </tr>
                          </thead>
                          <tbody>
                            {/* Natural order here is newest-first, so clicking Date once (oldest
                                first) and again (newest first) is the round trip back to how the
                                statement already reads. The Details column sorts on the same text
                                the cell shows — asset name if there is one, otherwise the remark. */}
                            {sortTableRows(statement, tableSort['cashStatement'] ?? null, {
                              date:         m => m.date,
                              category:     m => m.category,
                              counterparty: m => m.counterparty,
                              details:      m => (m.asset && m.asset !== 'Cash' ? m.asset : m.remarks),
                              in:           m => m.direction === 'in' ? m.amount : null,
                              out:          m => m.direction === 'out' ? m.amount : null,
                              balance:      m => m.balance,
                            }).map((m, idx) => (
                              <tr key={`${m.date}-${idx}`} className={`border-b border-gray-50 ${m.direction === 'in' ? 'bg-green-50/30' : ''}`}>
                                <td className="py-1.5 px-2 font-mono whitespace-nowrap text-gray-600">{m.date}</td>
                                <td className="py-1.5 px-2 text-gray-700 whitespace-nowrap">{m.category}</td>
                                <td className="py-1.5 px-2 text-gray-500">{m.counterparty}</td>
                                {/* The asset name is the useful label on a trade or dividend; on a pure
                                    cash move it is just the word "Cash", so the remark is better. */}
                                <td className="py-1.5 px-2 text-gray-500" title={m.remarks}>
                                  {m.asset && m.asset !== 'Cash' ? m.asset : m.remarks}
                                </td>
                                <td className="text-right py-1.5 px-2 font-mono text-green-600">{m.direction === 'in' ? fmt(m.amount) : ''}</td>
                                <td className="text-right py-1.5 px-2 font-mono text-red-600">{m.direction === 'out' ? fmt(m.amount) : ''}</td>
                                <td className={`text-right py-1.5 px-2 font-mono font-medium ${m.balance < 0 ? 'text-red-600' : 'text-gray-700'}`}>{fmt(m.balance)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* --- OPEN POSITION DETAIL VIEW --- */}
              {openSelectedTicker && (() => {
                const allPurchases = getOpenPurchases(openSelectedTicker);
                const filteredPurchases = getFilteredOpenPurchases(openSelectedTicker);
                const allDividends = getOpenDividends(openSelectedTicker);
                const assetInfo = assetLookup.find(a => a.ticker === openSelectedTicker);
                const stats = getOpenDashboardStats(openSelectedTicker);
                const { chartData, buyDots } = getOpenChartData(openSelectedTicker);
                const capitalChartData = getOpenCapitalChartData(openSelectedTicker);
                // Full trade history for this asset: shares still held PLUS any completed round
                // trips in the same asset from years past. See getOpenTradeEvents.
                const tradeEvents = getOpenTradeEvents(openSelectedTicker);
                const currentPrice = getCurrentPrice(openSelectedTicker);
                const todayStr = new Date().toISOString().split('T')[0];

                // Build merged chronological list of purchases and dividends for the table
                // Fees paid in units (Endowus) get their own row, so the Shares column still adds
                // up: units bought, less units given up, equals the Summary's units held.
                type DisplayRow =
                  | { type: 'purchase'; index: number; data: TransactionRow }
                  | { type: 'dividend'; data: TransactionRow }
                  | { type: 'fee'; data: UnitFee };
                const displayRows: DisplayRow[] = [
                  ...allPurchases.map((t, i) => ({ type: 'purchase' as const, index: i, data: t })),
                  ...allDividends.map(t => ({ type: 'dividend' as const, data: t })),
                  ...mergeUnitFees(allPurchases.map(t => t.unitFees)).map(f => ({ type: 'fee' as const, data: f })),
                ].sort((a, b) => a.data.date.localeCompare(b.data.date));

                // Buy dates for the "Invested From" dropdown
                const buyDates = Array.from(new Set(filteredPurchases.map(t => t.date))).sort();

                // PnL zero-crossing fraction for the gradient (same pattern as closed)
                const pnlZeroFraction = computePnlZeroFraction(capitalChartData);

                // Graph Starts options: all data months up to first buy
                const graphStartsOptions: string[] = (() => {
                  if (!assetData || buyDates.length === 0) return [];
                  const firstBuyD = new Date(buyDates[0]);
                  if (isNaN(firstBuyD.getTime())) return [];
                  const firstBuyYMStr = toYM(firstBuyD);
                  const monthSet = new Set<string>();
                  for (const row of assetData) {
                    const d = new Date(row.date);
                    if (isNaN(d.getTime())) continue;
                    if (toYM(d) <= firstBuyYMStr) monthSet.add(row.date);
                  }
                  return Array.from(monthSet).sort();
                })();

                // Graph Ends options: all data months from latest buy onward
                const graphEndsOptions: string[] = (() => {
                  if (!assetData || buyDates.length === 0) return [];
                  const lastBuyD = new Date(buyDates[buyDates.length - 1]);
                  if (isNaN(lastBuyD.getTime())) return [];
                  const lastBuyYMStr = toYM(lastBuyD);
                  const monthSet = new Set<string>();
                  for (const row of assetData) {
                    const d = new Date(row.date);
                    if (isNaN(d.getTime())) continue;
                    if (toYM(d) >= lastBuyYMStr) monthSet.add(row.date);
                  }
                  return Array.from(monthSet).sort();
                })();

                // Build comparison data if "Invested Into" is selected
                const comparisonDataRaw = openInvestedInto && openInvestedFrom
                  ? getNormalizedComparisonData(openSelectedTicker, openInvestedInto, openInvestedFrom)
                  : [];
                const compGraphStartsYM = openGraphStarts ? toYM(new Date(openGraphStarts)) : '';
                const compGraphEndsYM = openGraphEnds ? toYM(new Date(openGraphEnds)) : '';
                const comparisonData = (compGraphStartsYM || compGraphEndsYM)
                  ? comparisonDataRaw.filter(c => {
                      const d = new Date(c.date);
                      if (isNaN(d.getTime())) return false;
                      const ym = toYM(d);
                      if (compGraphStartsYM && ym < compGraphStartsYM) return false;
                      if (compGraphEndsYM && ym > compGraphEndsYM) return false;
                      return true;
                    })
                  : comparisonDataRaw;

                // Merge comparison data into chart data (uses Map for O(N+M) instead of O(N*M))
                const mergedChartData = mergeComparisonData(chartData, comparisonData);

                // Comparison stats
                let compGainBase: number | null = null;
                let compGainInvested: number | null = null;
                if (openInvestedInto && openInvestedFrom && assetData) {
                  const fromDate = new Date(openInvestedFrom);
                  const fromYM = toYM(fromDate);
                  let basePriceAtBuy = 0, compPriceAtBuy = 0;
                  let baseCurrentPrice = 0, compCurrentPrice = 0;
                  for (const row of assetData) {
                    const rowYM = toYM(new Date(row.date));
                    const bp = Number(row[openSelectedTicker]);
                    const cp = Number(row[openInvestedInto]);
                    if (rowYM === fromYM) {
                      if (bp > 0) basePriceAtBuy = bp;
                      if (cp > 0) compPriceAtBuy = cp;
                    }
                    if (bp > 0) baseCurrentPrice = bp;
                    if (cp > 0) compCurrentPrice = cp;
                  }
                  if (basePriceAtBuy > 0) compGainBase = ((baseCurrentPrice - basePriceAtBuy) / basePriceAtBuy) * 100;
                  if (compPriceAtBuy > 0) compGainInvested = ((compCurrentPrice - compPriceAtBuy) / compPriceAtBuy) * 100;
                }
                const compAssetInfo = openInvestedInto ? assetLookup.find(a => a.ticker === openInvestedInto) : null;

                return (
                  <div>
                    {/* Back button and asset header */}
                    <div className="flex items-center gap-3 mb-4">
                      <button
                        onClick={() => { setOpenSelectedTicker(''); setOpenIncludedTxns(null); }}
                        className={`${BTN_SECOND} max-md:shrink-0 max-md:pl-2`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        {/* Phones: just "Back", so the button stays one line beside the title */}
                        Back<span className="max-md:hidden"> to list</span>
                      </button>
                      <h3 className="text-lg font-semibold text-gray-800 max-md:text-base max-md:leading-snug">
                        {openSelectedTicker} — {assetInfo?.name || 'Unknown'}
                      </h3>
                    </div>

                    {/* --- Transactions Table --- */}
                    <div className="bg-white p-4 rounded-lg shadow mb-4">
                      {/* The valuation price and date are identical on every row — the asset's latest
                          price, as of today. They belong in the heading, said once, rather than as
                          two columns repeating the same pair of values down the whole table. */}
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">
                        Transactions
                        <span className="font-normal text-gray-500">
                          {' '}(current price of {formatPrice(currentPrice)} as of {todayStr})
                        </span>
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <th className="text-center py-1.5 px-2 bg-gray-50 w-8">
                                <input
                                  ref={openSelectAllRef}
                                  type="checkbox"
                                  checked={openIncludedTxns === null || openIncludedTxns.size === allPurchases.length}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setOpenIncludedTxns(null);
                                    } else {
                                      setOpenIncludedTxns(new Set());
                                    }
                                  }}
                                  className="rounded border-gray-300 cursor-pointer"
                                  title="Include/exclude all purchase transactions from stats and chart"
                                />
                              </th>
                              <th className="text-left py-1.5 px-2 bg-gray-50">Type</th>
                              <th className="text-left py-1.5 px-2 bg-gray-50 whitespace-nowrap">Inv Date</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50" title="How long the position has been held: days, with the same span in years in brackets.">Holding</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Shares</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Buy Price</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50" title="Commission paid to buy, with its size in basis points of the gross purchase value. 1 bp = 0.01%.">Buy Comm.</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Initial Cost</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Current Value</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Cum. Div</th>
                              <th className="text-right py-1.5 px-2 bg-gray-100">Total Return</th>
                              <th className="text-right py-1.5 px-2 bg-gray-100">Return %</th>
                              <th className="text-right py-1.5 px-2 bg-gray-100 cursor-help" title={CAGR_LOT_HINT}>CAGR</th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayRows.map((row, rowIdx) => {
                              if (row.type === 'dividend') {
                                // Dividend row — show date, shares held, and amount
                                return (
                                  <tr key={`div-${rowIdx}`} className="border-b border-gray-50 bg-amber-50/40">
                                    <td className="py-1.5 px-2"></td>
                                    <td className="py-1.5 px-2 text-amber-700 font-medium">Dividend</td>
                                    <td className="py-1.5 px-2 font-mono whitespace-nowrap">{row.data.date}</td>
                                    {/* Holding — not meaningful for a dividend */}
                                    <td className="py-1.5 px-2"></td>
                                    <td className="text-right py-1.5 px-2 text-gray-400 font-mono">{row.data.qty.toLocaleString()}</td>
                                    <td className="py-1.5 px-2"></td>
                                    <td className="py-1.5 px-2"></td>
                                    <td className="py-1.5 px-2"></td>
                                    <td className="py-1.5 px-2"></td>
                                    <td className="text-right py-1.5 px-2 font-mono text-green-600 font-medium">+{row.data.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="py-1.5 px-2"></td>
                                    <td className="py-1.5 px-2"></td>
                                    <td className="py-1.5 px-2"></td>
                                  </tr>
                                );
                              }
                              if (row.type === 'fee') {
                                // Fee paid in units — the units that left and what they were worth.
                                // Not a purchase, so no checkbox and no return figures of its own:
                                // its cost already shows as the smaller Current Value of the purchase.
                                const f = row.data;
                                return (
                                  <tr key={`fee-${rowIdx}`} className="border-b border-gray-50 bg-gray-50">
                                    <td className="py-1.5 px-2"></td>
                                    <td
                                      className="py-1.5 px-2 text-gray-500 font-medium whitespace-nowrap"
                                      title="A fee paid by giving up units instead of cash. Units leave, the cost stays, so the holding is worth a little less."
                                    >
                                      Fee (units)
                                    </td>
                                    <td className="py-1.5 px-2 font-mono whitespace-nowrap">{f.date}</td>
                                    <td className="py-1.5 px-2"></td>
                                    <td className="text-right py-1.5 px-2 text-gray-500">−{f.qty.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                                    {/* The price the units went at, in the Buy Price column */}
                                    <td className="text-right py-1.5 px-2 font-mono text-gray-500">{formatPrice(f.qty > 0 ? f.amount / f.qty : 0)}</td>
                                    <td colSpan={7} className="py-1.5 px-2 text-gray-500 whitespace-nowrap">
                                      fee of {f.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, paid by selling units
                                    </td>
                                  </tr>
                                );
                              }
                              // Purchase row — compute valuation stats
                              const t = row.data;
                              const purchaseIdx = row.index;
                              const isIncluded = openIncludedTxns === null || openIncludedTxns.has(purchaseIdx);
                              const holdDays = Math.round((Date.now() - new Date(t.date).getTime()) / 86400000);
                              const holdYears = holdDays / 365.25;
                              const buyPrice = t.qty > 0 ? (t.amount - t.commAbs) / t.qty : 0;
                              // Valued on the units still held: Shares shows what was bought, and
                              // any units since given up to fees are the Fee rows below it
                              const currentVal = heldQty(t) * currentPrice;
                              const totalReturn = currentVal - t.amount;
                              const returnPct = t.amount > 0 ? (totalReturn / t.amount) * 100 : 0;
                              // Held less than a year: the plain Return % instead of annualising it
                              // (a few months blown up to a yearly rate gives silly numbers) — the
                              // same rule as XIRR, see calculateXIRR.
                              const cagr = holdYears < 1 ? returnPct
                                : t.amount > 0 && currentVal > 0
                                  ? (Math.pow(currentVal / t.amount, 1 / holdYears) - 1) * 100
                                  : 0;

                              return (
                                <tr key={`buy-${purchaseIdx}`} className={`border-b border-gray-50 ${!isIncluded ? 'opacity-40' : purchaseIdx % 2 === 0 ? '' : 'bg-gray-25'}`}>
                                  <td className="text-center py-1.5 px-2">
                                    <input
                                      type="checkbox"
                                      checked={isIncluded}
                                      onChange={(e) => {
                                        if (openIncludedTxns === null) {
                                          const allIndices = new Set(allPurchases.map((_, i) => i));
                                          allIndices.delete(purchaseIdx);
                                          setOpenIncludedTxns(allIndices);
                                        } else {
                                          const next = new Set(openIncludedTxns);
                                          if (e.target.checked) {
                                            next.add(purchaseIdx);
                                            setOpenIncludedTxns(next.size === allPurchases.length ? null : next);
                                          } else {
                                            next.delete(purchaseIdx);
                                            setOpenIncludedTxns(next);
                                          }
                                        }
                                      }}
                                      className="rounded border-gray-300 cursor-pointer"
                                    />
                                  </td>
                                  <td className="py-1.5 px-2 text-green-700 font-medium">Purchase</td>
                                  <td className="py-1.5 px-2 font-mono whitespace-nowrap">{t.date}</td>
                                  {/* Holding period: days with years in brackets, e.g. "607 (1.7y)" */}
                                  <td className="text-right py-1.5 px-2 font-mono whitespace-nowrap">
                                    {holdDays.toLocaleString()}
                                    <span className="text-gray-500"> ({holdYears.toFixed(1)}y)</span>
                                  </td>
                                  <td className="text-right py-1.5 px-2">{t.qty.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                                  <td className="text-right py-1.5 px-2 font-mono">{formatPrice(buyPrice)}</td>
                                  {/* Commission with its size in bps of the gross purchase value */}
                                  <td className="text-right py-1.5 px-2 font-mono whitespace-nowrap">
                                    {t.commAbs.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    {(t.amount - t.commAbs) > 0 && (
                                      <span className="text-gray-500"> ({Math.round(t.commAbs / (t.amount - t.commAbs) * 10000)}bps)</span>
                                    )}
                                  </td>
                                  <td className="text-right py-1.5 px-2 font-mono">{t.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className="text-right py-1.5 px-2 font-mono">{currentVal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className="text-right py-1.5 px-2 font-mono">—</td>
                                  <td className={`text-right py-1.5 px-2 font-mono font-medium ${totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {totalReturn >= 0 ? '+' : ''}{totalReturn.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                  </td>
                                  <td className={`text-right py-1.5 px-2 font-mono font-medium ${returnPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(1)}%
                                  </td>
                                  <td className={`text-right py-1.5 px-2 font-mono font-medium ${cagr >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {cagr >= 0 ? '+' : ''}{cagr.toFixed(1)}%
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          {/* --- Summary Row --- */}
                          {stats && (() => {
                            const sumShares = stats.totalShares;
                            const sumCost = stats.totalInvested;
                            const sumBuyComm = stats.totalBuyComm;
                            const sumDividends = stats.totalDividends;
                            const sumCurrentVal = stats.currentValue;
                            const sumReturn = sumCurrentVal + sumDividends - sumCost;
                            const sumReturnPct = sumCost > 0 ? (sumReturn / sumCost) * 100 : 0;
                            const maxDays = stats.holdingDays;
                            const maxYears = stats.holdingYears;

                            return (
                              <tfoot>
                                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                                  <td className="py-2 px-2"></td>
                                  <td className="py-2 px-2 text-left text-gray-700" colSpan={2}>Summary</td>
                                  {/* Holding — longest span, days with years in brackets */}
                                  <td className="text-right py-2 px-2 font-mono whitespace-nowrap">
                                    {maxDays.toLocaleString()}
                                    <span className="text-gray-500 font-normal"> ({maxYears.toFixed(1)}y)</span>
                                  </td>
                                  <td className="text-right py-2 px-2 font-mono">{sumShares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                                  <td className="text-right py-2 px-2 font-mono">{formatPrice(stats.adjAvgBuyPrice)}</td>
                                  <td className="text-right py-2 px-2 font-mono">
                                    {sumBuyComm.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    {(sumCost - sumBuyComm) > 0 && <span className="text-gray-500 font-normal"> ({Math.round(sumBuyComm / (sumCost - sumBuyComm) * 10000)}bps)</span>}
                                  </td>
                                  <td className="text-right py-2 px-2 font-mono">{sumCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className="text-right py-2 px-2 font-mono">{sumCurrentVal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className="text-right py-2 px-2 font-mono">{sumDividends.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  <td className={`text-right py-2 px-2 font-mono ${sumReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {sumReturn >= 0 ? '+' : ''}{sumReturn.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                  </td>
                                  <td className={`text-right py-2 px-2 font-mono ${sumReturnPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {sumReturnPct >= 0 ? '+' : ''}{sumReturnPct.toFixed(1)}%
                                  </td>
                                  <td className={`text-right py-2 px-2 font-mono ${stats.xirr !== null && stats.xirr >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {stats.xirr !== null ? `${stats.xirr >= 0 ? '+' : ''}${stats.xirr.toFixed(1)}%` : '—'}
                                  </td>
                                </tr>
                              </tfoot>
                            );
                          })()}
                        </table>
                      </div>
                    </div>

                    {/* --- Price History Chart --- */}
                    <div className="bg-white px-2 py-4 rounded-lg shadow mb-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3 px-2">Price History</h4>

                      {/* Chart controls ("phone-chart-controls": a tidy grid on phones, see globals.css) */}
                      <div className="flex flex-wrap items-end gap-4 mb-4 px-2 phone-chart-controls">
                        {/* On/off switches in one strip; each is slate while on. The green dot is
                            the Avg Buy line's colour in the chart. */}
                        <span className={SEG}>
                        <button
                          onClick={() => setOpenSinceInvested(!openSinceInvested)}
                          className={segBtn(openSinceInvested)}
                        >
                          Since Invested
                        </button>

                        <button
                          onClick={() => setOpenShowAvgBuy(!openShowAvgBuy)}
                          className={segBtn(openShowAvgBuy)}
                        >
                          <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5 align-middle -mt-px" />
                          Avg Buy (Div Adj)
                        </button>

                        {/* Shows the all-time high/low markers on the price line. Off by default. */}
                        <button
                          onClick={() => setOpenShowMinMax(!openShowMinMax)}
                          className={segBtn(openShowMinMax)}
                          title="Show or hide the highest and lowest price markers on the chart"
                        >
                          Min/Max
                        </button>
                        </span>

                        <div className="border-l border-gray-300 h-6 mx-1" />

                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">Invested Into</label>
                          <select
                            value={openInvestedInto}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              setOpenInvestedInto(newValue);
                              if (newValue && buyDates.length > 0) {
                                setOpenInvestedFrom(buyDates[0]); // default to first buy
                              } else {
                                setOpenInvestedFrom('');
                              }
                            }}
                            className={`${FIELD} max-w-[130px]`}
                          >
                            <option value="">— None —</option>
                            {assetLookup
                              .filter(a => a.ticker !== openSelectedTicker)
                              .map(a => <option key={a.ticker} value={a.ticker}>{a.ticker}</option>)}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">Invested From</label>
                          <select
                            value={openInvestedFrom}
                            onChange={(e) => setOpenInvestedFrom(e.target.value)}
                            disabled={!openInvestedInto}
                            className={`${FIELD} min-w-[130px] disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed`}
                          >
                            {buyDates.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>

                        <div className="border-l border-gray-300 h-6 mx-1" />

                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">Graph Starts</label>
                          <select
                            value={openGraphStarts}
                            onChange={(e) => setOpenGraphStarts(e.target.value)}
                            className={`${FIELD} min-w-[130px]`}
                          >
                            <option value="">— All —</option>
                            {graphStartsOptions.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">Graph Ends</label>
                          <select
                            value={openGraphEnds}
                            onChange={(e) => setOpenGraphEnds(e.target.value)}
                            className={`${FIELD} min-w-[130px]`}
                          >
                            <option value="">— All —</option>
                            {graphEndsOptions.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Dashboard Stats Tiles */}
                      {stats && (
                        <div className="flex flex-wrap gap-3 mb-4 px-2">
                          <div className="flex-1 min-w-[180px] p-2 bg-gray-50 rounded-lg">
                            <div className="text-[11px] text-gray-500 mb-0.5">Holding & Return</div>
                            <div className="text-sm font-semibold text-gray-800">
                              {stats.holdingYears.toFixed(1)} yrs ({stats.holdingDays.toLocaleString()} days)
                              <span className="text-gray-300 mx-1">&middot;</span>
                              <span className={`cursor-help ${(stats.xirr ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`} title={XIRR_HINT}>
                                {stats.xirr !== null ? `XIRR ${stats.xirr >= 0 ? '+' : ''}${stats.xirr.toFixed(1)}%` : 'XIRR N/A'}
                              </span>
                            </div>
                          </div>

                          <div className="flex-1 min-w-[180px] p-2 bg-gray-50 rounded-lg">
                            <div className="text-[11px] text-gray-500 mb-0.5">Unrealized PnL</div>
                            <div className={`text-sm font-semibold ${stats.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {stats.totalPnL >= 0 ? '+' : ''}
                              {stats.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              {' '}({stats.totalPnLPct >= 0 ? '+' : ''}{stats.totalPnLPct.toFixed(1)}%)
                            </div>
                            <div className="text-[11px] text-gray-400">
                              {stats.totalInvested.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              {' → '}
                              {stats.currentValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              {stats.totalDividends > 0 && ` (+${stats.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} div)`}
                            </div>
                          </div>

                          {stats.currentPrice > 0 && (
                            <div className="flex-1 min-w-[180px] p-2 bg-gray-50 rounded-lg">
                              <div className="text-[11px] text-gray-500 mb-0.5">Current Position</div>
                              <div className="text-sm font-semibold text-gray-800">
                                {formatPrice(stats.currentPrice)} × {stats.totalShares.toLocaleString()} shares
                              </div>
                              <div className="text-[11px] text-gray-400">
                                Value: {stats.currentValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                <span className="mx-1">·</span>
                                Adj Buy: {formatPrice(stats.adjAvgBuyPrice)}
                              </div>
                            </div>
                          )}

                          {openInvestedInto && compGainBase !== null && compGainInvested !== null && (
                            <div className="flex-1 min-w-[200px] p-2 bg-gray-50 rounded-lg">
                              <div className="text-[11px] text-gray-500 mb-0.5">
                                {openSelectedTicker} vs {openInvestedInto}
                              </div>
                              <div className="text-sm font-semibold text-gray-800">
                                <span className={compGainBase >= 0 ? 'text-green-600' : 'text-red-600'}>
                                  {openSelectedTicker}: {compGainBase >= 0 ? '+' : ''}{compGainBase.toFixed(1)}%
                                </span>
                                {' vs '}
                                <span className={compGainInvested >= 0 ? 'text-green-600' : 'text-red-600'}>
                                  {openInvestedInto}: {compGainInvested >= 0 ? '+' : ''}{compGainInvested.toFixed(1)}%
                                </span>
                              </div>
                              <div className="text-[11px] text-gray-400">
                                {(() => {
                                  const diff = compGainInvested - compGainBase;
                                  if (diff > 0) return `${compAssetInfo?.name || openInvestedInto} outperformed by ${diff.toFixed(1)}pp`;
                                  if (diff < 0) return `${assetInfo?.name || openSelectedTicker} outperformed by ${Math.abs(diff).toFixed(1)}pp`;
                                  return 'Same performance';
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* The Price History chart */}
                      {chartData.length > 0 ? (
                        (() => {
                          const validPriceData = chartData.filter(d => d.price > 0);
                          const maxPricePoint = validPriceData.length > 0
                            ? validPriceData.reduce((best, d) => d.price > best.price ? d : best, validPriceData[0]) : null;
                          const minPricePoint = validPriceData.length > 0
                            ? validPriceData.reduce((worst, d) => d.price < worst.price ? d : worst, validPriceData[0]) : null;

                          let lastPrice: number | null = null;
                          let lastAvgBuyPrice: number | null = null;
                          let lastCompPrice: number | null = null;
                          const hasComp = !!(openInvestedInto && comparisonData.length > 0);
                          for (let i = mergedChartData.length - 1; i >= 0; i--) {
                            const d = mergedChartData[i];
                            if (lastPrice === null && d.price != null && d.price > 0) lastPrice = d.price;
                            if (lastAvgBuyPrice === null && d.avgBuyPrice != null && d.avgBuyPrice > 0) lastAvgBuyPrice = d.avgBuyPrice;
                            if (lastCompPrice === null && d.compPrice != null && d.compPrice > 0) lastCompPrice = d.compPrice;
                            if (lastPrice !== null && (lastAvgBuyPrice !== null || !openShowAvgBuy) && (lastCompPrice !== null || !hasComp)) break;
                          }

                          const priceBubbleDefs: BubbleDef[] = [];
                          if (lastPrice != null) priceBubbleDefs.push({ value: lastPrice, color: BLACK, label: formatPrice(lastPrice) });
                          if (lastCompPrice != null && openInvestedInto) priceBubbleDefs.push({ value: lastCompPrice, color: CHART_PALETTE.gold, label: formatPrice(lastCompPrice) });
                          if (lastAvgBuyPrice != null && openShowAvgBuy) priceBubbleDefs.push({ value: lastAvgBuyPrice, color: GAIN, label: formatPrice(lastAvgBuyPrice) });
                          const OpenPriceBubbles = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, priceBubbleDefs);

                          return (
                            <ResponsiveContainer width="100%" height={350}>
                              <LineChart data={mergedChartData} margin={{ top: 20, right: 70, left: -5, bottom: 15 }}>
                                {/* No CartesianGrid on purpose: the position detail charts are gridless, like the Monthly tab. The axis labels carry the levels. */}
                                <XAxis dataKey="date" tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />} height={35} />
                                <YAxis tick={{ fontSize: 9 }} width={40} domain={['auto', 'auto']} />
                                <Tooltip formatter={(value: number, name: string) => value != null ? [formatPrice(value), name] : ['-', name]} />
                                <Legend />
                                <Customized component={OpenPriceBubbles} />
                                <Line type="monotone" dataKey="price" name={openSelectedTicker} stroke={BLACK} strokeWidth={2} dot={false} connectNulls />
                                {openInvestedInto && comparisonData.length > 0 && (
                                  <Line type="monotone" dataKey="compPrice" name={openInvestedInto} stroke={CHART_PALETTE.gold} strokeWidth={2} dot={false} strokeDasharray="5 3" connectNulls />
                                )}
                                {openShowAvgBuy && (
                                  <Line type="stepAfter" dataKey="avgBuyPrice" name="Avg Buy (Div Adj)" stroke={CHART_PALETTE.olive} strokeWidth={1.5} dot={false} strokeDasharray="6 3" connectNulls />
                                )}
                                {/* Faint stems tying each floating buy dot back to the price line in
                                    its own month. Drawn before the dots so they pass underneath them.
                                    ifOverflow="extendDomain" on the dots stretches the Y axis to fit any
                                    fill outside the plotted price range — without it Recharts silently
                                    discards a dot that falls off the top or bottom of the chart. */}
                                {buyDots.map((dot, i) => (
                                  <ReferenceLine key={`buy-stem-${i}`} ifOverflow="extendDomain" stroke={CHART_PALETTE.olive} strokeOpacity={0.45} strokeWidth={1}
                                    segment={[{ x: dot.date, y: dot.price }, { x: dot.date, y: dot.tradePrice }]} />
                                ))}
                                {openShowMinMax && maxPricePoint && (
                                  <ReferenceDot x={maxPricePoint.date} y={maxPricePoint.price} r={9} fill={CHART_PALETTE.blue} stroke={HALO} strokeWidth={2}
                                    label={{ value: formatPrice(maxPricePoint.price), position: 'left', fontSize: 12, fill: INK, fontWeight: 600 }} />
                                )}
                                {openShowMinMax && minPricePoint && (
                                  <ReferenceDot x={minPricePoint.date} y={minPricePoint.price} r={9} fill={CHART_PALETTE.rose} stroke={HALO} strokeWidth={2}
                                    label={{ value: formatPrice(minPricePoint.price), position: 'left', fontSize: 12, fill: INK, fontWeight: 600 }} />
                                )}
                                {buyDots.map((dot, i) => (
                                  <ReferenceDot key={`buy-${i}`} x={dot.date} y={dot.tradePrice} r={6} fill={CHART_PALETTE.olive} stroke={HALO} strokeWidth={2}
                                    ifOverflow="extendDomain"
                                    label={{ value: formatPrice(dot.tradePrice), position: 'top', fontSize: 11, fill: OLIVE_LABEL, fontWeight: 600 }} />
                                ))}
                              </LineChart>
                            </ResponsiveContainer>
                          );
                        })()
                      ) : (
                        <div className="text-center py-8 text-gray-400 text-sm">
                          No price data available for {openSelectedTicker} in the monthly prices sheet.
                        </div>
                      )}

                      <div className="mt-2 flex gap-4 text-xs text-gray-600">
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-full bg-green-500"></div>
                          <span>Buy month</span>
                        </div>
                        {openShowMinMax && (
                          <>
                            <div className="flex items-center gap-1">
                              {/* The same colours as the chart's high / low markers */}
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHART_PALETTE.blue }}></div>
                              <span>Max price</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHART_PALETTE.rose }}></div>
                              <span>Min price</span>
                            </div>
                          </>
                        )}
                      </div>

                      {/* --- Shares Held bar chart ---
                         Fed mergedChartData — the EXACT array the price line above plots — so it
                         inherits every filter (Since Invested, Graph Starts/Ends, transaction
                         checkboxes) and its X axis cannot drift out of step with the line.
                         It must be mergedChartData and not chartData: when a comparison asset is
                         selected, merging can ADD months that the base asset doesn't have, and
                         feeding the raw chartData here would leave the bars short of the line.
                         Those extra months carry no `shares` value, so no bar is drawn for them —
                         which is right, since they're months outside this position's own history.
                         Margins and YAxis width are copied from the line chart so each bar sits
                         directly under its matching point on the price line. */}
                      {chartData.length > 0 && (
                        <div className="mt-4">
                          <h5 className="text-xs font-semibold text-gray-600 mb-1 px-2">Shares Held</h5>
                          <ResponsiveContainer width="100%" height={150}>
                            <BarChart data={mergedChartData} margin={{ top: 5, right: 70, left: -5, bottom: 15 }}>
                              {/* No CartesianGrid on purpose: the position detail charts are gridless, like the Monthly tab. The axis labels carry the levels. */}
                              <XAxis dataKey="date" tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />} height={35} />
                              <YAxis tick={{ fontSize: 9 }} width={40} domain={[0, 'auto']} />
                              <Tooltip content={<SharesHeldTooltip />} cursor={{ fill: 'rgba(0,0,0,0.06)' }} />
                              <Bar dataKey="shares" name="Shares" fill={BLACK} isAnimationActive={false} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* --- Transaction History table ---
                         Same shared component as the Closed view, but fed the asset's FULL history:
                         the shares you still hold AND any round trips you completed in it years ago.
                         Rows you still hold carry a black outline, so what's live stands apart from
                         what's already finished. */}
                      {tradeEvents.length > 0 && (
                        <>
                          <TradeHistoryTable events={tradeEvents} />
                          {/* Only real closed trades earn this caption. A fee row has no outline
                              either, but it isn't a closed trade. */}
                          {tradeEvents.some(e => e.type !== 'fee' && !e.stillHeld) && (
                            <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 px-2">
                              <span className="inline-block w-4 h-3 bg-green-50 border border-black"></span>
                              <span>Outlined rows are shares you still hold; the rest are closed trades in this asset.</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* --- Invested Capital Charts --- */}
                    {capitalChartData.length > 0 && stats && (
                      <div className="bg-white px-2 py-4 rounded-lg shadow mb-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-1 px-2">Invested Capital</h4>
                        <div className="text-sm text-gray-500 mb-3 px-2">
                          {stats.totalInvested.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} invested → now worth {stats.currentValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          {stats.totalDividends > 0 && ` (+${stats.totalDividends.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} div)`}
                          <span className="mx-1">·</span>
                          <span className={stats.totalPnL >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                            Unrealized {stats.totalPnL >= 0 ? 'Profit' : 'Loss'} of {stats.totalPnL >= 0 ? '+' : ''}{stats.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ({stats.totalPnLPct.toFixed(1)}%)
                          </span>
                        </div>

                        {(() => {
                          const allData = capitalChartData;
                          const maxMVPoint = allData.length > 0
                            ? allData.reduce((best, d) => d.marketValue > best.marketValue ? d : best, allData[0]) : null;
                          const sameSharesData = maxMVPoint
                            ? allData.filter(d => Math.abs(d.shares - maxMVPoint.shares) < 1e-9) : [];
                          const minMVPoint = sameSharesData.length > 0
                            ? sameSharesData.reduce((worst, d) => d.marketValue < worst.marketValue ? d : worst, sameSharesData[0]) : null;

                          const lastCapRow = capitalChartData[capitalChartData.length - 1];
                          const capitalBubbleDefs: BubbleDef[] = [];
                          if (lastCapRow) {
                            capitalBubbleDefs.push({ value: lastCapRow.marketValue, color: CHART_PALETTE.blue, label: lastCapRow.marketValue.toLocaleString() });
                            capitalBubbleDefs.push({ value: lastCapRow.investedCapital, color: BLACK, label: lastCapRow.investedCapital.toLocaleString() });
                          }
                          const OpenCapitalBubbles = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, capitalBubbleDefs);

                          return (
                            <ResponsiveContainer width="100%" height={250}>
                              <AreaChart data={capitalChartData} margin={{ top: 20, right: 70, left: -5, bottom: 15 }}>
                                {/* No CartesianGrid on purpose: the position detail charts are gridless, like the Monthly tab. The axis labels carry the levels. */}
                                <XAxis dataKey="date" tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />} height={35} />
                                <YAxis tick={{ fontSize: 9 }} width={40} />
                                <Tooltip formatter={(value: number, name: string) => value != null ? [value.toLocaleString(), name] : ['-', name]} />
                                <Legend />
                                <Customized component={OpenCapitalBubbles} />
                                <Area type="stepAfter" dataKey="investedCapital" name="Invested" stroke={BLACK} fill={BLACK} fillOpacity={0.08} strokeWidth={1.5} strokeDasharray="6 3" />
                                <Area type="monotone" dataKey="marketValue" name="Market Value" stroke={CHART_PALETTE.blue} fill={CHART_PALETTE.blue} fillOpacity={0.2} strokeWidth={2} />
                                {maxMVPoint && (
                                  <ReferenceDot x={maxMVPoint.date} y={maxMVPoint.marketValue} r={6} fill={GAIN} stroke={HALO} strokeWidth={2}
                                    label={{ value: maxMVPoint.marketValue.toLocaleString(), position: 'left', fontSize: 12, fill: INK, fontWeight: 600 }} />
                                )}
                                {minMVPoint && (
                                  <ReferenceDot x={minMVPoint.date} y={minMVPoint.marketValue} r={6} fill={LOSS} stroke={HALO} strokeWidth={2}
                                    label={{ value: minMVPoint.marketValue.toLocaleString(), position: 'left', fontSize: 12, fill: INK, fontWeight: 600 }} />
                                )}
                              </AreaChart>
                            </ResponsiveContainer>
                          );
                        })()}

                        {/* PnL chart */}
                        {(() => {
                          const pnlData = capitalChartData;
                          const maxPnLPoint = pnlData.length > 0 ? pnlData.reduce((best, d) => d.pnl > best.pnl ? d : best, pnlData[0]) : null;
                          const minPnLPoint = pnlData.length > 0 ? pnlData.reduce((worst, d) => d.pnl < worst.pnl ? d : worst, pnlData[0]) : null;
                          const maxPnLPct = maxPnLPoint && maxPnLPoint.investedCapital > 0 ? (maxPnLPoint.pnl / maxPnLPoint.investedCapital * 100) : null;
                          const minPnLPct = minPnLPoint && minPnLPoint.investedCapital > 0 ? (minPnLPoint.pnl / minPnLPoint.investedCapital * 100) : null;

                          const lastPnLRow = capitalChartData[capitalChartData.length - 1];
                          const lastPnL = lastPnLRow?.pnl ?? null;
                          const pnlBubbleDefs: BubbleDef[] = [];
                          if (lastPnL != null) {
                            pnlBubbleDefs.push({ value: lastPnL, color: lastPnL >= 0 ? GAIN : LOSS, label: `${lastPnL >= 0 ? '+' : ''}${lastPnL.toLocaleString()}` });
                          }
                          const OpenPnLBubble = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, pnlBubbleDefs);

                          return (
                            <>
                              <h4 className="text-sm font-semibold text-gray-700 mt-4 mb-1 px-2">Unrealized Profit / Loss Over Time</h4>
                              <div className="text-sm text-gray-500 mb-3 px-2">
                                {minPnLPoint && (
                                  <span className="text-red-500 font-medium">
                                    Min {minPnLPoint.pnl >= 0 ? '+' : ''}{minPnLPoint.pnl.toLocaleString()}
                                    {minPnLPct !== null && ` (${minPnLPct >= 0 ? '+' : ''}${minPnLPct.toFixed(1)}%)`}
                                  </span>
                                )}
                                {minPnLPoint && maxPnLPoint && <span className="mx-1">·</span>}
                                {maxPnLPoint && (
                                  <span className="text-green-600 font-medium">
                                    Max {maxPnLPoint.pnl >= 0 ? '+' : ''}{maxPnLPoint.pnl.toLocaleString()}
                                    {maxPnLPct !== null && ` (${maxPnLPct >= 0 ? '+' : ''}${maxPnLPct.toFixed(1)}%)`}
                                  </span>
                                )}
                              </div>
                              <ResponsiveContainer width="100%" height={200}>
                                <AreaChart data={capitalChartData} margin={{ top: 5, right: 70, left: -5, bottom: 15 }}>
                                  <defs>
                                    <linearGradient id="openPnlGradient" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor={GAIN} stopOpacity={0.4} />
                                      <stop offset={`${(pnlZeroFraction * 100).toFixed(1)}%`} stopColor={GAIN} stopOpacity={0.05} />
                                      <stop offset={`${(pnlZeroFraction * 100).toFixed(1)}%`} stopColor={LOSS} stopOpacity={0.05} />
                                      <stop offset="100%" stopColor={LOSS} stopOpacity={0.4} />
                                    </linearGradient>
                                    <linearGradient id="openPnlStrokeGradient" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor={GAIN} />
                                      <stop offset={`${(pnlZeroFraction * 100).toFixed(1)}%`} stopColor={GAIN} />
                                      <stop offset={`${(pnlZeroFraction * 100).toFixed(1)}%`} stopColor={LOSS} />
                                      <stop offset="100%" stopColor={LOSS} />
                                    </linearGradient>
                                  </defs>
                                  {/* No CartesianGrid on purpose: the position detail charts are gridless, like the Monthly tab. The axis labels carry the levels. */}
                                  <XAxis dataKey="date" tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />} height={35} />
                                  <YAxis tick={{ fontSize: 9 }} width={40} />
                                  <Tooltip formatter={(value: number) => value != null ? [`${value >= 0 ? '+' : ''}${value.toLocaleString()}`, 'PnL'] : ['-', 'PnL']} />
                                  <Customized component={OpenPnLBubble} />
                                  <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" strokeWidth={1} />
                                  <Area type="monotone" dataKey="pnl" name="PnL" stroke="url(#openPnlStrokeGradient)" fill="url(#openPnlGradient)" strokeWidth={2} />
                                  {maxPnLPoint && (
                                    <ReferenceDot x={maxPnLPoint.date} y={maxPnLPoint.pnl} r={6} fill={GAIN} stroke={HALO} strokeWidth={2}
                                      label={{ value: `${maxPnLPoint.pnl >= 0 ? '+' : ''}${maxPnLPoint.pnl.toLocaleString()}`, position: 'left', fontSize: 12, fill: INK, fontWeight: 600 }} />
                                  )}
                                  {minPnLPoint && (
                                    <ReferenceDot x={minPnLPoint.date} y={minPnLPoint.pnl} r={6} fill={LOSS} stroke={HALO} strokeWidth={2}
                                      label={{ value: `${minPnLPoint.pnl >= 0 ? '+' : ''}${minPnLPoint.pnl.toLocaleString()}`, position: 'left', fontSize: 12, fill: INK, fontWeight: 600 }} />
                                  )}
                                </AreaChart>
                              </ResponsiveContainer>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* --- CLOSED POSITION DETAIL VIEW (when a specific closed asset is drilled into) --- */}
              {closedSelectedTicker && (() => {
                // allTransactions = every row for this ticker (used by the table to show all rows)
                // filteredTransactions = only checked rows (used for sale dates dropdown)
                const allTransactions = getClosedTransactions(closedSelectedTicker);
                const filteredTransactions = getFilteredClosedTransactions(closedSelectedTicker);
                const assetInfo = assetLookup.find(a => a.ticker === closedSelectedTicker);
                const stats = getClosedDashboardStats(closedSelectedTicker);
                const { chartData, buyDots, sellDots } = getClosedChartData(closedSelectedTicker);
                const capitalChartData = getClosedCapitalChartData(closedSelectedTicker);
                // Individual buy/sell events in date order, for the Transaction History table.
                // Uses the FILTERED transactions, so it stays in step with the charts above it
                // when rows are unchecked in the Transactions table.
                const tradeEvents = getClosedTradeEvents(closedSelectedTicker);

                // Pre-compute the zero-crossing fraction for the PnL gradient once,
                // rather than computing it twice inline within the SVG gradient defs.
                // zeroFraction = how far down from the chart's top the y=0 line sits (0 = top, 1 = bottom).
                const pnlZeroFraction = computePnlZeroFraction(capitalChartData);

                // Get sale dates from FILTERED transactions only (so dropdown matches checked rows)
                const saleDates = Array.from(new Set(filteredTransactions.map(t => t.divDate))).sort();

                // Build monthly date options for the "Graph Ends" dropdown:
                // from the last sale date through the last available data month
                const graphEndsOptions: string[] = (() => {
                  if (!assetData || saleDates.length === 0) return [];
                  const lastSale = saleDates[saleDates.length - 1];
                  const lastSaleD = new Date(lastSale);
                  if (isNaN(lastSaleD.getTime())) return [];
                  // Find all data months from the last sale onward
                  const lastSaleYMStr = toYM(lastSaleD);
                  const monthSet = new Set<string>();
                  for (const row of assetData) {
                    const d = new Date(row.date);
                    if (isNaN(d.getTime())) continue;
                    const ym = toYM(d);
                    if (ym >= lastSaleYMStr) monthSet.add(row.date);
                  }
                  return Array.from(monthSet).sort();
                })();

                // Build monthly date options for the "Graph Starts" dropdown:
                // from the first available data month up to (and including) the first buy date
                // Uses filtered transactions so it respects checkboxes
                const buyDates = Array.from(new Set(filteredTransactions.map(t => t.invDate))).sort();
                const graphStartsOptions: string[] = (() => {
                  if (!assetData || buyDates.length === 0) return [];
                  const firstBuy = buyDates[0];
                  const firstBuyD = new Date(firstBuy);
                  if (isNaN(firstBuyD.getTime())) return [];
                  const firstBuyYMStr = toYM(firstBuyD);
                  const monthSet = new Set<string>();
                  for (const row of assetData) {
                    const d = new Date(row.date);
                    if (isNaN(d.getTime())) continue;
                    const ym = toYM(d);
                    if (ym <= firstBuyYMStr) monthSet.add(row.date);
                  }
                  return Array.from(monthSet).sort();
                })();

                // Build comparison data if "Invested Into" is selected,
                // then filter it by the "Invested To" cutoff so both lines end at the same date
                const comparisonDataRaw = closedInvestedInto && closedInvestedFrom
                  ? getNormalizedComparisonData(closedSelectedTicker, closedInvestedInto, closedInvestedFrom)
                  : [];
                // Filter comparison data to respect both Graph Starts and Graph Ends
                const compGraphStartsYM = closedGraphStarts ? toYM(new Date(closedGraphStarts)) : '';
                const compGraphEndsYM = closedGraphEnds ? toYM(new Date(closedGraphEnds)) : '';
                const comparisonData = (compGraphStartsYM || compGraphEndsYM)
                  ? comparisonDataRaw.filter(c => {
                      const d = new Date(c.date);
                      if (isNaN(d.getTime())) return false;
                      const ym = toYM(d);
                      if (compGraphStartsYM && ym < compGraphStartsYM) return false;
                      if (compGraphEndsYM && ym > compGraphEndsYM) return false;
                      return true;
                    })
                  : comparisonDataRaw;

                // Merge chart data with comparison data for the LineChart (uses Map for O(N+M) instead of O(N*M))
                const mergedChartData = mergeComparisonData(chartData, comparisonData);

                // Compute comparison stats (how much each asset gained since the sale)
                let compGainBase: number | null = null;
                let compGainInvested: number | null = null;
                if (closedInvestedInto && closedInvestedFrom && assetData) {
                  const fromDate = new Date(closedInvestedFrom);
                  const fromYM = toYM(fromDate);
                  let basePriceAtSale = 0;
                  let compPriceAtSale = 0;
                  let baseCurrentPrice = 0;
                  let compCurrentPrice = 0;

                  for (const row of assetData) {
                    const rowDate = new Date(row.date);
                    const rowYM = toYM(rowDate);
                    const bp = Number(row[closedSelectedTicker]);
                    const cp = Number(row[closedInvestedInto]);
                    if (rowYM === fromYM) {
                      if (bp > 0) basePriceAtSale = bp;
                      if (cp > 0) compPriceAtSale = cp;
                    }
                    if (bp > 0) baseCurrentPrice = bp;
                    if (cp > 0) compCurrentPrice = cp;
                  }

                  if (basePriceAtSale > 0) compGainBase = ((baseCurrentPrice - basePriceAtSale) / basePriceAtSale) * 100;
                  if (compPriceAtSale > 0) compGainInvested = ((compCurrentPrice - compPriceAtSale) / compPriceAtSale) * 100;
                }

                const compAssetInfo = closedInvestedInto ? assetLookup.find(a => a.ticker === closedInvestedInto) : null;

                return (
                  <div>
                    {/* Back button and asset header */}
                    <div className="flex items-center gap-3 mb-4">
                      <button
                        onClick={() => { setClosedSelectedTicker(''); setClosedIncludedTxns(null); }}
                        className={`${BTN_SECOND} max-md:shrink-0 max-md:pl-2`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        {/* Phones: just "Back", so the button stays one line beside the title */}
                        Back<span className="max-md:hidden"> to list</span>
                      </button>
                      <h3 className="text-lg font-semibold text-gray-800 max-md:text-base max-md:leading-snug">
                        {closedSelectedTicker} — {assetInfo?.name || 'Unknown'}
                      </h3>
                    </div>

                    {/* --- Transaction Table --- */}
                    <div className="bg-white p-4 rounded-lg shadow mb-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">Transactions</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <th className="text-center py-1.5 px-2 bg-gray-50 w-8">
                                <input
                                  ref={closedSelectAllRef}
                                  type="checkbox"
                                  checked={closedIncludedTxns === null || closedIncludedTxns.size === allTransactions.length}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setClosedIncludedTxns(null); // all included
                                    } else {
                                      setClosedIncludedTxns(new Set()); // none included
                                    }
                                  }}
                                  className="rounded border-gray-300 cursor-pointer"
                                  title="Include/exclude all transactions from stats and chart"
                                />
                              </th>
                              <th className="text-left py-1.5 px-2 bg-gray-50">Inv Date</th>
                              <th className="text-left py-1.5 px-2 bg-gray-50">Div Date</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50" title="How long the position was held: days, with the same span in years in brackets.">Holding</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Shares</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Buy Price</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50" title="Commission paid to buy, with its size in basis points of the gross purchase value. 1 bp = 0.01%.">Buy Comm.</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Initial Cost</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Sell Price</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50" title="Commission paid to sell, with its size in basis points of the gross sale proceeds. 1 bp = 0.01%.">Sell Comm.</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Value After Fee</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Cum. Div</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Tax</th>
                              <th className="text-right py-1.5 px-2 bg-gray-50">Final Net Value</th>
                              <th className="text-right py-1.5 px-2 bg-gray-100">Total Return</th>
                              <th className="text-right py-1.5 px-2 bg-gray-100">Return %</th>
                              <th className="text-right py-1.5 px-2 bg-gray-100 cursor-help" title={CAGR_LOT_HINT}>CAGR</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allTransactions.map((t, idx) => (
                              <tr key={idx} className={`border-b border-gray-50 ${closedIncludedTxns !== null && !closedIncludedTxns.has(idx) ? 'opacity-40' : idx % 2 === 0 ? '' : 'bg-gray-25'}`}>
                                <td className="text-center py-1.5 px-2">
                                  <input
                                    type="checkbox"
                                    checked={closedIncludedTxns === null || closedIncludedTxns.has(idx)}
                                    onChange={(e) => {
                                      if (closedIncludedTxns === null) {
                                        // Transitioning from "all included" (null) to explicit set:
                                        // Build a set with all indices, then remove the unchecked one
                                        const allIndices = new Set(allTransactions.map((_, i) => i));
                                        allIndices.delete(idx);
                                        setClosedIncludedTxns(allIndices);
                                      } else {
                                        const next = new Set(closedIncludedTxns);
                                        if (e.target.checked) {
                                          next.add(idx);
                                          // If all are now included, collapse back to null for simplicity
                                          setClosedIncludedTxns(next.size === allTransactions.length ? null : next);
                                        } else {
                                          next.delete(idx);
                                          setClosedIncludedTxns(next);
                                        }
                                      }
                                    }}
                                    className="rounded border-gray-300 cursor-pointer"
                                  />
                                </td>
                                <td className="py-1.5 px-2 font-mono">{t.invDate}</td>
                                <td className="py-1.5 px-2 font-mono">{t.divDate}</td>
                                {/* Holding period: days with years in brackets, e.g. "607 (1.7y)" */}
                                <td className="text-right py-1.5 px-2 font-mono whitespace-nowrap">
                                  {t.holdingPeriodDays.toLocaleString()}
                                  <span className="text-gray-500"> ({t.holdingPeriodYears.toFixed(1)}y)</span>
                                </td>
                                <td className="text-right py-1.5 px-2">{t.sharesSold.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                                <td className="text-right py-1.5 px-2 font-mono">{formatPrice(t.buyPrice)}</td>
                                {/* Commission with its size in bps of the gross traded value, matching
                                    the Transaction History table and the summary row below. */}
                                <td className="text-right py-1.5 px-2 font-mono whitespace-nowrap">
                                  {t.buyCommission.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                  {(t.initialCost - t.buyCommission) > 0 && (
                                    <span className="text-gray-500"> ({Math.round(t.buyCommission / (t.initialCost - t.buyCommission) * 10000)}bps)</span>
                                  )}
                                </td>
                                <td className="text-right py-1.5 px-2 font-mono">{t.initialCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                <td className="text-right py-1.5 px-2 font-mono">{formatPrice(t.sellPrice)}</td>
                                <td className="text-right py-1.5 px-2 font-mono whitespace-nowrap">
                                  {t.sellCommission.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                  {(t.valueAfterFee + t.sellCommission) > 0 && (
                                    <span className="text-gray-500"> ({Math.round(t.sellCommission / (t.valueAfterFee + t.sellCommission) * 10000)}bps)</span>
                                  )}
                                </td>
                                <td className="text-right py-1.5 px-2 font-mono">{t.valueAfterFee.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                <td className="text-right py-1.5 px-2 font-mono">{t.cumDividend.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                <td className="text-right py-1.5 px-2 font-mono">{t.totalTax.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                <td className="text-right py-1.5 px-2 font-mono">{t.finalNetValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                <td className={`text-right py-1.5 px-2 font-mono font-medium ${t.totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {t.totalReturn >= 0 ? '+' : ''}{t.totalReturn.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </td>
                                <td className={`text-right py-1.5 px-2 font-mono font-medium ${t.totalReturnPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {t.totalReturnPct >= 0 ? '+' : ''}{t.totalReturnPct.toFixed(1)}%
                                </td>
                                <td className={`text-right py-1.5 px-2 font-mono font-medium ${t.cagr >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {t.cagr >= 0 ? '+' : ''}{t.cagr.toFixed(1)}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          {/* --- Summary Row (uses only checked/filtered transactions) --- */}
                          {filteredTransactions.length > 0 && (() => {
                            // Compute summary stats from the checked transactions only
                            const sumShares = filteredTransactions.reduce((s, t) => s + t.sharesSold, 0);
                            const sumCost = filteredTransactions.reduce((s, t) => s + t.initialCost, 0);
                            const sumBuyComm = filteredTransactions.reduce((s, t) => s + t.buyCommission, 0);
                            const sumSellComm = filteredTransactions.reduce((s, t) => s + t.sellCommission, 0);
                            const sumValueAfterFee = filteredTransactions.reduce((s, t) => s + t.valueAfterFee, 0);
                            const sumCumDiv = filteredTransactions.reduce((s, t) => s + t.cumDividend, 0);
                            const sumTax = filteredTransactions.reduce((s, t) => s + t.totalTax, 0);
                            const sumFinalNet = filteredTransactions.reduce((s, t) => s + t.finalNetValue, 0);
                            const sumReturn = sumFinalNet - sumCost;
                            const sumReturnPct = sumCost > 0 ? (sumReturn / sumCost) * 100 : 0;
                            // Weighted average buy price (includes commission = true cost basis per share)
                            const wAvgBuy = sumShares > 0 ? sumCost / sumShares : 0;
                            // Weighted average sell price (weighted by shares in each transaction)
                            const wAvgSell = sumShares > 0
                              ? filteredTransactions.reduce((s, t) => s + t.sellPrice * t.sharesSold, 0) / sumShares
                              : 0;
                            // Max holding days/years across the checked transactions
                            const maxDays = Math.max(...filteredTransactions.map(t => t.holdingPeriodDays));
                            const maxYears = maxDays / 365.25;
                            // XIRR across all checked transactions (cumulative CAGR)
                            const cashFlows = filteredTransactions.flatMap(t => [
                              { date: new Date(t.invDate), amount: -t.initialCost },
                              { date: new Date(t.divDate), amount: t.finalNetValue },
                            ]).sort((a, b) => a.date.getTime() - b.date.getTime());
                            const xirr = calculateXIRR(cashFlows);

                            return (
                              <tfoot>
                                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                                  {/* Checkbox column — empty */}
                                  <td className="py-2 px-2"></td>
                                  {/* Inv Date — label */}
                                  <td className="py-2 px-2 text-left text-gray-700" colSpan={2}>Summary</td>
                                  {/* Holding — longest span among the checked rows, days with years in brackets */}
                                  <td className="text-right py-2 px-2 font-mono whitespace-nowrap">
                                    {maxDays.toLocaleString()}
                                    <span className="text-gray-500 font-normal"> ({maxYears.toFixed(1)}y)</span>
                                  </td>
                                  {/* Shares — cumulative */}
                                  <td className="text-right py-2 px-2 font-mono">{sumShares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                                  {/* Buy Price — weighted avg */}
                                  <td className="text-right py-2 px-2 font-mono">{formatPrice(wAvgBuy)}</td>
                                  {/* Buy Comm. — cumulative + basis points vs invested amount (shares × buyPrice, excl. commission) */}
                                  <td className="text-right py-2 px-2 font-mono">
                                    {sumBuyComm.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    {(sumCost - sumBuyComm) > 0 && <span className="text-gray-500 font-normal"> ({Math.round(sumBuyComm / (sumCost - sumBuyComm) * 10000)}bps)</span>}
                                  </td>
                                  {/* Initial Cost — cumulative */}
                                  <td className="text-right py-2 px-2 font-mono">{sumCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  {/* Sell Price — weighted avg */}
                                  <td className="text-right py-2 px-2 font-mono">{formatPrice(wAvgSell)}</td>
                                  {/* Sell Comm. — cumulative + basis points vs gross sale proceeds */}
                                  <td className="text-right py-2 px-2 font-mono">
                                    {sumSellComm.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    {(sumValueAfterFee + sumSellComm) > 0 && <span className="text-gray-500 font-normal"> ({Math.round(sumSellComm / (sumValueAfterFee + sumSellComm) * 10000)}bps)</span>}
                                  </td>
                                  {/* Value After Fee — cumulative */}
                                  <td className="text-right py-2 px-2 font-mono">{sumValueAfterFee.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  {/* Cum. Div — cumulative */}
                                  <td className="text-right py-2 px-2 font-mono">{sumCumDiv.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  {/* Tax — cumulative */}
                                  <td className="text-right py-2 px-2 font-mono">{sumTax.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  {/* Final Net Value — cumulative */}
                                  <td className="text-right py-2 px-2 font-mono">{sumFinalNet.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                  {/* Total Return — cumulative */}
                                  <td className={`text-right py-2 px-2 font-mono ${sumReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {sumReturn >= 0 ? '+' : ''}{sumReturn.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                  </td>
                                  {/* Return % — cumulative */}
                                  <td className={`text-right py-2 px-2 font-mono ${sumReturnPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {sumReturnPct >= 0 ? '+' : ''}{sumReturnPct.toFixed(1)}%
                                  </td>
                                  {/* CAGR — XIRR */}
                                  <td className={`text-right py-2 px-2 font-mono ${xirr !== null && xirr >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {xirr !== null ? `${xirr >= 0 ? '+' : ''}${xirr.toFixed(1)}%` : '—'}
                                  </td>
                                </tr>
                              </tfoot>
                            );
                          })()}
                        </table>
                      </div>
                    </div>

                    {/* --- Performance Chart --- */}
                    <div className="bg-white px-2 py-4 rounded-lg shadow mb-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3 px-2">Price History</h4>

                      {/* Chart controls: toggles and Invested Into / From
                          ("phone-chart-controls": a tidy grid on phones, see globals.css) */}
                      <div className="flex flex-wrap items-end gap-4 mb-4 px-2 phone-chart-controls">
                        {/* On/off switches in one strip; each is slate while on. The dots are the
                            Avg Buy (green) and Avg Sell (red) lines' colours in the chart. */}
                        <span className={SEG}>
                        {/* Since Invested toggle */}
                        <button
                          onClick={() => setClosedSinceInvested(!closedSinceInvested)}
                          className={segBtn(closedSinceInvested)}
                        >
                          Since Invested
                        </button>

                        {/* Until Sold toggle */}
                        <button
                          onClick={() => setClosedUntilSold(!closedUntilSold)}
                          className={segBtn(closedUntilSold)}
                        >
                          Until Sold
                        </button>

                        {/* Shows the all-time high/low markers on the price line. Off by default. */}
                        <button
                          onClick={() => setClosedShowMinMax(!closedShowMinMax)}
                          className={segBtn(closedShowMinMax)}
                          title="Show or hide the highest and lowest price markers on the chart"
                        >
                          Min/Max
                        </button>

                        {/* Avg Buy Price toggle — shows/hides the green dashed avg buy line */}
                        <button
                          onClick={() => setClosedShowAvgBuy(!closedShowAvgBuy)}
                          className={segBtn(closedShowAvgBuy)}
                        >
                          <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5 align-middle -mt-px" />
                          Avg Buy
                        </button>

                        {/* Avg Sell Price toggle — shows/hides the red dashed avg sell line */}
                        <button
                          onClick={() => setClosedShowAvgSell(!closedShowAvgSell)}
                          className={segBtn(closedShowAvgSell)}
                        >
                          <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5 align-middle -mt-px" />
                          Avg Sell
                        </button>
                        </span>

                        <div className="border-l border-gray-300 h-6 mx-1" />

                        {/* Invested Into dropdown */}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">Invested Into</label>
                          <select
                            value={closedInvestedInto}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              setClosedInvestedInto(newValue);
                              // Auto-set "Invested From" to last sale date when a comparison is selected
                              if (newValue && saleDates.length > 0) {
                                setClosedInvestedFrom(saleDates[saleDates.length - 1]);
                              } else {
                                setClosedInvestedFrom('');
                              }
                            }}
                            className={`${FIELD} max-w-[130px]`}
                          >
                            <option value="">— None —</option>
                            {assetLookup
                              .filter(a => a.ticker !== closedSelectedTicker)
                              .map(a => (
                                <option key={a.ticker} value={a.ticker}>{a.ticker}</option>
                              ))}
                          </select>
                        </div>

                        {/* Asset 2 Invested From dropdown (only enabled when Invested Into is selected) */}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">Asset 2 Invested From</label>
                          <select
                            value={closedInvestedFrom}
                            onChange={(e) => setClosedInvestedFrom(e.target.value)}
                            disabled={!closedInvestedInto}
                            className={`${FIELD} min-w-[130px] disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed`}
                          >
                            {saleDates.map(d => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        </div>

                        <div className="border-l border-gray-300 h-6 mx-1" />

                        {/* Graph Starts dropdown: pick a start date from first available data up to first buy */}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">Graph Starts</label>
                          <select
                            value={closedGraphStarts}
                            onChange={(e) => setClosedGraphStarts(e.target.value)}
                            className={`${FIELD} min-w-[130px]`}
                          >
                            <option value="">— All —</option>
                            {graphStartsOptions.map(d => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        </div>

                        {/* Graph Ends dropdown: pick an end date from last sale onward */}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">Graph Ends</label>
                          <select
                            value={closedGraphEnds}
                            onChange={(e) => setClosedGraphEnds(e.target.value)}
                            className={`${FIELD} min-w-[130px]`}
                          >
                            <option value="">— All —</option>
                            {graphEndsOptions.map(d => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* --- Compact Summary Statistics (inline above chart) --- */}
                      {stats && (
                        <div className="flex flex-wrap gap-3 mb-4 px-2">

                          {/* Tile 1: Holding Time + XIRR — how long and what annualized return */}
                          <div className="flex-1 min-w-[180px] p-2 bg-gray-50 rounded-lg">
                            <div className="text-[11px] text-gray-500 mb-0.5">Holding & Return</div>
                            <div className="text-sm font-semibold text-gray-800">
                              {stats.holdingYears.toFixed(1)} yrs ({stats.holdingDays.toLocaleString()} days)
                              <span className="text-gray-300 mx-1">&middot;</span>
                              <span className={`cursor-help ${(stats.xirr ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`} title={XIRR_HINT}>
                                {stats.xirr !== null
                                  ? `XIRR ${stats.xirr >= 0 ? '+' : ''}${stats.xirr.toFixed(1)}%`
                                  : 'XIRR N/A'}
                              </span>
                            </div>
                          </div>

                          {/* Tile 2: Total PnL — profit/loss with invested → sold breakdown */}
                          <div className="flex-1 min-w-[180px] p-2 bg-gray-50 rounded-lg">
                            <div className="text-[11px] text-gray-500 mb-0.5">Total PnL</div>
                            <div className={`text-sm font-semibold ${stats.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {stats.totalPnL >= 0 ? '+' : ''}
                              {stats.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              {' '}({stats.totalPnLPct >= 0 ? '+' : ''}{stats.totalPnLPct.toFixed(1)}%)
                            </div>
                            <div className="text-[11px] text-gray-400">
                              {stats.totalCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              {' → '}
                              {stats.totalFinalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </div>
                          </div>

                          {/* Tile 3: Current vs Sold + If Not Sold — price comparison & unrealized */}
                          {stats.currentPrice > 0 && (
                            <div className="flex-1 min-w-[220px] p-2 bg-gray-50 rounded-lg">
                              <div className="text-[11px] text-gray-500 mb-0.5">Current vs Sold</div>
                              <div className="text-sm font-semibold text-gray-800">
                                Now {formatPrice(stats.currentPrice)} vs avg {formatPrice(stats.weightedSellPrice)}
                                <span className="text-gray-300 mx-1">&middot;</span>
                                <span className={stats.priceVsSoldPct >= 0 ? 'text-red-600' : 'text-green-600'}>
                                  {stats.priceVsSoldPct >= 0 ? '+' : ''}{stats.priceVsSoldPct.toFixed(1)}%
                                </span>
                              </div>
                              <div className="text-[11px] text-gray-400">
                                {stats.ifNotSold.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                {' vs '}
                                {stats.totalFinalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                {' sold '}
                                {(() => {
                                  const unrealized = stats.ifNotSold - stats.totalFinalValue;
                                  return (
                                    <span className={unrealized >= 0 ? 'text-red-500' : 'text-green-500'}>
                                      ({unrealized >= 0 ? '+' : ''}
                                      {unrealized.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                      {' unrealized'})
                                    </span>
                                  );
                                })()}
                              </div>
                            </div>
                          )}

                          {/* Tile 4: Asset vs comparison asset (only when "Invested Into" is active) */}
                          {closedInvestedInto && compGainBase !== null && compGainInvested !== null && (
                            <div className="flex-1 min-w-[200px] p-2 bg-gray-50 rounded-lg">
                              <div className="text-[11px] text-gray-500 mb-0.5">
                                {closedSelectedTicker} vs {closedInvestedInto}
                              </div>
                              <div className="text-sm font-semibold text-gray-800">
                                <span className={compGainBase >= 0 ? 'text-green-600' : 'text-red-600'}>
                                  {closedSelectedTicker}: {compGainBase >= 0 ? '+' : ''}{compGainBase.toFixed(1)}%
                                </span>
                                {' vs '}
                                <span className={compGainInvested >= 0 ? 'text-green-600' : 'text-red-600'}>
                                  {closedInvestedInto}: {compGainInvested >= 0 ? '+' : ''}{compGainInvested.toFixed(1)}%
                                </span>
                              </div>
                              <div className="text-[11px] text-gray-400">
                                {(() => {
                                  const diff = compGainInvested - compGainBase;
                                  if (diff > 0) return `${compAssetInfo?.name || closedInvestedInto} outperformed by ${diff.toFixed(1)}pp`;
                                  if (diff < 0) return `${assetInfo?.name || closedSelectedTicker} would have outperformed by ${Math.abs(diff).toFixed(1)}pp`;
                                  return 'Same performance';
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* The chart itself */}
                      {chartData.length > 0 ? (
                        (() => {
                          // Compute highest and lowest price points from the filtered chart data
                          const validPriceData = chartData.filter(d => d.price > 0);
                          const maxPricePoint = validPriceData.length > 0
                            ? validPriceData.reduce((best, d) => d.price > best.price ? d : best, validPriceData[0])
                            : null;
                          const minPricePoint = validPriceData.length > 0
                            ? validPriceData.reduce((worst, d) => d.price < worst.price ? d : worst, validPriceData[0])
                            : null;

                          // Find the last valid values by walking backwards. The last entry may
                          // be a comparison-only point (no price), so we can't just grab the
                          // last element. A backward loop avoids creating temporary array copies.
                          // We track which values we still need so we can break early even when
                          // some data series don't exist (e.g. no comparison asset selected).
                          let lastPrice: number | null = null;
                          let lastAvgBuyPrice: number | null = null;
                          let lastAvgSellPrice: number | null = null;
                          let lastCompPrice: number | null = null;
                          const hasComp = !!(closedInvestedInto && comparisonData.length > 0);
                          for (let i = mergedChartData.length - 1; i >= 0; i--) {
                            const d = mergedChartData[i];
                            if (lastPrice === null && d.price != null && d.price > 0) lastPrice = d.price;
                            if (lastAvgBuyPrice === null && d.avgBuyPrice != null && d.avgBuyPrice > 0) lastAvgBuyPrice = d.avgBuyPrice;
                            if (lastAvgSellPrice === null && d.avgSellPrice != null && d.avgSellPrice > 0) lastAvgSellPrice = d.avgSellPrice;
                            if (lastCompPrice === null && d.compPrice != null && d.compPrice > 0) lastCompPrice = d.compPrice;
                            // Break early once we've found all values that can possibly exist
                            if (lastPrice !== null
                              && (lastAvgBuyPrice !== null || !closedShowAvgBuy)
                              && (lastAvgSellPrice !== null || !closedShowAvgSell)
                              && (lastCompPrice !== null || !hasComp)) break;
                          }

                          /* Bubble definitions for the Price History chart. Defined here (inside
                             the IIFE) so we can close over the last-value variables. Recharts'
                             Customized doesn't support custom props, so closure is the cleanest
                             approach. All rendering is delegated to the shared renderEdgeBubbles. */
                          const priceBubbleDefs: BubbleDef[] = [];
                          if (lastPrice != null) priceBubbleDefs.push({ value: lastPrice, color: BLACK, label: formatPrice(lastPrice) });
                          // Only show comparison bubble when the comparison line is actually visible
                          if (lastCompPrice != null && closedInvestedInto) priceBubbleDefs.push({ value: lastCompPrice, color: CHART_PALETTE.gold, label: formatPrice(lastCompPrice) });
                          if (lastAvgBuyPrice != null && closedShowAvgBuy) priceBubbleDefs.push({ value: lastAvgBuyPrice, color: GAIN, label: formatPrice(lastAvgBuyPrice) });
                          if (lastAvgSellPrice != null && closedShowAvgSell) priceBubbleDefs.push({ value: lastAvgSellPrice, color: LOSS, label: formatPrice(lastAvgSellPrice) });
                          const PriceBubbles = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, priceBubbleDefs);

                          return (
                        <ResponsiveContainer width="100%" height={350}>
                          {/* Right margin widened to 70 to make room for the right-edge bubbles */}
                          <LineChart data={mergedChartData} margin={{ top: 20, right: 70, left: -5, bottom: 15 }}>
                            {/* No CartesianGrid on purpose: the position detail charts are gridless, like the Monthly tab. The axis labels carry the levels. */}
                            <XAxis dataKey="date" tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />} height={35} />
                            <YAxis tick={{ fontSize: 9 }} width={40} domain={['auto', 'auto']} />
                            <Tooltip
                              formatter={(value: number, name: string) => {
                                if (value === undefined || value === null) return ['-', name];
                                return [formatPrice(value), name];
                              }}
                            />
                            <Legend />
                            {/* Bubbles at the right edge showing latest price, comparison, avg buy & avg sell */}
                            <Customized component={PriceBubbles} />
                            {/* Main asset price line (black) */}
                            <Line
                              type="monotone"
                              dataKey="price"
                              name={closedSelectedTicker}
                              stroke={BLACK}
                              strokeWidth={2}
                              dot={false}
                              connectNulls
                            />
                            {/* Comparison asset line (only when "Invested Into" is active) */}
                            {closedInvestedInto && comparisonData.length > 0 && (
                              <Line
                                type="monotone"
                                dataKey="compPrice"
                                name={closedInvestedInto}
                                stroke={CHART_PALETTE.gold}
                                strokeWidth={2}
                                dot={false}
                                strokeDasharray="5 3"
                                connectNulls
                              />
                            )}
                            {/* Dashed olive line showing FIFO average buy price over time.
                                Steps up/down when new shares are bought or old ones sold.
                                Stops at last sale date. Only shown when toggle is enabled. */}
                            {closedShowAvgBuy && (
                              <Line
                                type="stepAfter"
                                dataKey="avgBuyPrice"
                                name="Avg Buy Price"
                                stroke={CHART_PALETTE.olive}
                                strokeWidth={1.5}
                                dot={false}
                                strokeDasharray="6 3"
                                connectNulls
                              />
                            )}
                            {/* Dashed wine line showing cumulative weighted avg sell price.
                                Starts at first sale date and continues to end of chart.
                                Only shown when toggle is enabled. */}
                            {closedShowAvgSell && (
                              <Line
                                type="stepAfter"
                                dataKey="avgSellPrice"
                                name="Avg Sell Price"
                                stroke={CHART_PALETTE.wine}
                                strokeWidth={1.5}
                                dot={false}
                                strokeDasharray="6 3"
                                connectNulls
                              />
                            )}
                            {/* Faint stems tying each floating buy/sell dot back to the price line
                               in its own month. Drawn first so they pass under every dot.
                               ifOverflow="extendDomain" on the dots stretches the Y axis to fit a
                               fill outside the plotted price range — without it Recharts silently
                               discards any dot that falls off the top or bottom of the chart. */}
                            {buyDots.map((dot, i) => (
                              <ReferenceLine key={`buy-stem-${i}`} ifOverflow="extendDomain" stroke={CHART_PALETTE.olive} strokeOpacity={0.45} strokeWidth={1}
                                segment={[{ x: dot.date, y: dot.price }, { x: dot.date, y: dot.tradePrice }]} />
                            ))}
                            {sellDots.map((dot, i) => (
                              <ReferenceLine key={`sell-stem-${i}`} ifOverflow="extendDomain" stroke={CHART_PALETTE.wine} strokeOpacity={0.45} strokeWidth={1}
                                segment={[{ x: dot.date, y: dot.price }, { x: dot.date, y: dot.tradePrice }]} />
                            ))}
                            {/* Max/min price dots render FIRST (behind) so buy/sell dots
                               appear on top when they overlap. Larger radius (r=9) creates
                               a visible ring around any overlapping buy/sell dot (r=6). */}
                            {/* Steel-blue dot at highest price */}
                            {closedShowMinMax && maxPricePoint && (
                              <ReferenceDot
                                x={maxPricePoint.date}
                                y={maxPricePoint.price}
                                r={9}
                                fill={CHART_PALETTE.blue}
                                stroke={HALO}
                                strokeWidth={2}
                                label={{
                                  value: formatPrice(maxPricePoint.price),
                                  position: 'left',
                                  fontSize: 12,
                                  fill: INK,
                                  fontWeight: 600,
                                }}
                              />
                            )}
                            {/* Dusty-rose dot at lowest price */}
                            {closedShowMinMax && minPricePoint && (
                              <ReferenceDot
                                x={minPricePoint.date}
                                y={minPricePoint.price}
                                r={9}
                                fill={CHART_PALETTE.rose}
                                stroke={HALO}
                                strokeWidth={2}
                                label={{
                                  value: formatPrice(minPricePoint.price),
                                  position: 'left',
                                  fontSize: 12,
                                  fill: INK,
                                  fontWeight: 600,
                                }}
                              />
                            )}
                            {/* Buy dots (on top of max/min) — olive, matching the Avg Buy line.
                               Placed at the price actually PAID, labelled with it, so a dot can
                               sit off the line while still standing in its own month. */}
                            {buyDots.map((dot, i) => (
                              <ReferenceDot
                                key={`buy-${i}`}
                                x={dot.date}
                                y={dot.tradePrice}
                                r={6}
                                fill={CHART_PALETTE.olive}
                                stroke={HALO}
                                strokeWidth={2}
                                ifOverflow="extendDomain"
                                label={{ value: formatPrice(dot.tradePrice), position: 'top', fontSize: 11, fill: OLIVE_LABEL, fontWeight: 600 }}
                              />
                            ))}
                            {/* Sell dots (on top of max/min) — wine, matching the Avg Sell line.
                               Same idea: drawn at the price actually RECEIVED. */}
                            {sellDots.map((dot, i) => (
                              <ReferenceDot
                                key={`sell-${i}`}
                                x={dot.date}
                                y={dot.tradePrice}
                                r={6}
                                fill={CHART_PALETTE.wine}
                                stroke={HALO}
                                strokeWidth={2}
                                ifOverflow="extendDomain"
                                label={{ value: formatPrice(dot.tradePrice), position: 'top', fontSize: 11, fill: WINE_LABEL, fontWeight: 600 }}
                              />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                          );
                        })()
                      ) : (
                        <div className="text-center py-8 text-gray-400 text-sm">
                          No price data available for {closedSelectedTicker} in the monthly prices sheet.
                        </div>
                      )}

                      {/* Chart legend for dots */}
                      <div className="mt-2 flex gap-4 text-xs text-gray-600">
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-full bg-green-500"></div>
                          <span>Buy month</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-full bg-red-500"></div>
                          <span>Sell month</span>
                        </div>
                        {closedShowMinMax && (
                          <>
                            <div className="flex items-center gap-1">
                              {/* The same colours as the chart's high / low markers */}
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHART_PALETTE.blue }}></div>
                              <span>Max price</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHART_PALETTE.rose }}></div>
                              <span>Min price</span>
                            </div>
                          </>
                        )}
                      </div>

                      {/* --- Shares Held bar chart ---
                         Fed mergedChartData — the EXACT array the price line above plots — so the X
                         axis is shared by construction and every filter (Since Invested, Until Sold,
                         Graph Starts/Ends, transaction checkboxes) applies to both at once.
                         It must be mergedChartData and not chartData: with "Until Sold" on AND a
                         comparison asset selected, the comparison line runs past the sale date, so
                         merging adds months that chartData lacks — feeding chartData here left the
                         bars 10 months short of the line. Those extra months carry no `shares`
                         value so no bar is drawn, which is correct: you held nothing after selling.
                         For a closed position the bars step up on purchases and fall to zero in the
                         month the last shares were sold. */}
                      {chartData.length > 0 && (
                        <div className="mt-4">
                          <h5 className="text-xs font-semibold text-gray-600 mb-1 px-2">Shares Held</h5>
                          <ResponsiveContainer width="100%" height={150}>
                            <BarChart data={mergedChartData} margin={{ top: 5, right: 70, left: -5, bottom: 15 }}>
                              {/* No CartesianGrid on purpose: the position detail charts are gridless, like the Monthly tab. The axis labels carry the levels. */}
                              <XAxis dataKey="date" tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />} height={35} />
                              <YAxis tick={{ fontSize: 9 }} width={40} domain={[0, 'auto']} />
                              <Tooltip content={<SharesHeldTooltip />} cursor={{ fill: 'rgba(0,0,0,0.06)' }} />
                              <Bar dataKey="shares" name="Shares" fill={BLACK} isAnimationActive={false} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* --- Transaction History table ---
                         The bars above show the shape of the position; this shows the individual
                         trades that created each step. Rendered by the shared TradeHistoryTable so
                         the Open and Closed views can never drift apart. */}
                      {tradeEvents.length > 0 && <TradeHistoryTable events={tradeEvents} />}
                    </div>

                    {/* --- Invested Capital Charts --- */}
                    {capitalChartData.length > 0 && stats && (
                      <div className="bg-white px-2 py-4 rounded-lg shadow mb-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-1 px-2">Invested Capital</h4>
                        <div className="text-sm text-gray-500 mb-3 px-2">
                          {stats.totalCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} invested → sold for {stats.totalFinalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          <span className="mx-1">·</span>
                          <span className={stats.totalPnL >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                            {stats.totalPnL >= 0 ? 'Profit' : 'Loss'} of {stats.totalPnL >= 0 ? '+' : ''}{stats.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ({stats.totalPnLPct >= 0 ? '+' : ''}{stats.totalPnLPct.toFixed(1)}%)
                          </span>
                        </div>

                        {/* --- Compute green (max) and red (min) market value dots ---
                           Green dot: the month with the highest market value.
                           Red dot: the month with the LOWEST market value, but only among
                           months where we held the same number of shares as the max-value month.
                           This avoids showing a misleading "min" from early on when we held
                           fewer shares (e.g. 100 shares vs 500 shares later). */}
                        {(() => {
                          // Include ALL data points (including the final sale month where shares=0)
                          // so that sale proceeds are considered for max/min market value
                          const allData = capitalChartData;
                          // Find the data point with the highest market value
                          const maxMVPoint = allData.length > 0
                            ? allData.reduce((best, d) => d.marketValue > best.marketValue ? d : best, allData[0])
                            : null;
                          // Among data points with the same share count as the max, find the lowest market value.
                          // This avoids showing a misleading "min" from early on when we held fewer shares.
                          const sameSharesData = maxMVPoint
                            ? allData.filter(d => Math.abs(d.shares - maxMVPoint.shares) < 1e-9)
                            : [];
                          const minMVPoint = sameSharesData.length > 0
                            ? sameSharesData.reduce((worst, d) => d.marketValue < worst.marketValue ? d : worst, sameSharesData[0])
                            : null;

                          // Last values for right-edge bubbles (all rows guaranteed numeric by getClosedCapitalChartData)
                          const lastCapRow = capitalChartData.length > 0 ? capitalChartData[capitalChartData.length - 1] : null;
                          const lastMV = lastCapRow?.marketValue ?? null;
                          const lastInvested = lastCapRow?.investedCapital ?? null;

                          // Build bubble defs and delegate to shared renderer
                          const capitalBubbleDefs: BubbleDef[] = [];
                          if (lastMV != null) capitalBubbleDefs.push({ value: lastMV, color: CHART_PALETTE.blue, label: lastMV.toLocaleString() });
                          if (lastInvested != null) capitalBubbleDefs.push({ value: lastInvested, color: BLACK, label: lastInvested.toLocaleString() });
                          const CapitalBubbles = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, capitalBubbleDefs);

                          return (
                        <ResponsiveContainer width="100%" height={250}>
                          <AreaChart data={capitalChartData} margin={{ top: 20, right: 70, left: -5, bottom: 15 }}>
                            {/* No CartesianGrid on purpose: the position detail charts are gridless, like the Monthly tab. The axis labels carry the levels. */}
                            <XAxis dataKey="date" tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />} height={35} />
                            <YAxis tick={{ fontSize: 9 }} width={40} />
                            <Tooltip
                              formatter={(value: number, name: string) => {
                                if (value === undefined || value === null) return ['-', name];
                                return [value.toLocaleString(), name];
                              }}
                            />
                            <Legend />
                            <Customized component={CapitalBubbles} />
                            <Area
                              type="stepAfter"
                              dataKey="investedCapital"
                              name="Invested"
                              stroke={BLACK}
                              fill={BLACK}
                              fillOpacity={0.08}
                              strokeWidth={1.5}
                              strokeDasharray="6 3"
                            />
                            <Area
                              type="monotone"
                              dataKey="marketValue"
                              name="Market Value"
                              stroke={CHART_PALETTE.blue}
                              fill={CHART_PALETTE.blue}
                              fillOpacity={0.2}
                              strokeWidth={2}
                            />
                            {/* Green dot at maximum market value */}
                            {maxMVPoint && (
                              <ReferenceDot
                                x={maxMVPoint.date}
                                y={maxMVPoint.marketValue}
                                r={6}
                                fill={GAIN}
                                stroke={HALO}
                                strokeWidth={2}
                                label={{
                                  value: maxMVPoint.marketValue.toLocaleString(),
                                  position: 'left',
                                  fontSize: 12,
                                  fill: INK,
                                  fontWeight: 600,
                                }}
                              />
                            )}
                            {/* Red dot at minimum market value (same share count as max) */}
                            {minMVPoint && (
                              <ReferenceDot
                                x={minMVPoint.date}
                                y={minMVPoint.marketValue}
                                r={6}
                                fill={LOSS}
                                stroke={HALO}
                                strokeWidth={2}
                                label={{
                                  value: minMVPoint.marketValue.toLocaleString(),
                                  position: 'left',
                                  fontSize: 12,
                                  fill: INK,
                                  fontWeight: 600,
                                }}
                              />
                            )}
                          </AreaChart>
                        </ResponsiveContainer>
                          );
                        })()}

                        {/* Chart 2: Cumulative PnL (green above 0, red below 0) */}
                        {/* --- Compute green (max profit) and red (max loss) dots for PnL chart ---
                           Green dot: the month with the highest profit (biggest positive PnL).
                           Red dot: the month with the biggest loss (most negative PnL).
                           No share-count filtering here — we show the actual best/worst PnL moments. */}
                        {(() => {
                          // Include ALL data points (including the final sale month)
                          // so that actual sale profit/loss is considered for max/min
                          const pnlData = capitalChartData;
                          // Find the point with the highest profit
                          const maxPnLPoint = pnlData.length > 0
                            ? pnlData.reduce((best, d) => d.pnl > best.pnl ? d : best, pnlData[0])
                            : null;
                          // Find the point with the biggest loss (lowest PnL)
                          const minPnLPoint = pnlData.length > 0
                            ? pnlData.reduce((worst, d) => d.pnl < worst.pnl ? d : worst, pnlData[0])
                            : null;
                          // Compute % return for max and min points (PnL / invested capital)
                          const maxPnLPct = maxPnLPoint && maxPnLPoint.investedCapital > 0
                            ? (maxPnLPoint.pnl / maxPnLPoint.investedCapital * 100)
                            : null;
                          const minPnLPct = minPnLPoint && minPnLPoint.investedCapital > 0
                            ? (minPnLPoint.pnl / minPnLPoint.investedCapital * 100)
                            : null;

                          // Last PnL value for right-edge bubble. Green if positive, red if negative.
                          const lastPnLRow = capitalChartData.length > 0 ? capitalChartData[capitalChartData.length - 1] : null;
                          const lastPnL = lastPnLRow?.pnl ?? null;

                          // Build bubble def and delegate to shared renderer
                          const pnlBubbleDefs: BubbleDef[] = [];
                          if (lastPnL != null) {
                            const color = lastPnL >= 0 ? GAIN : LOSS;
                            pnlBubbleDefs.push({ value: lastPnL, color, label: `${lastPnL >= 0 ? '+' : ''}${lastPnL.toLocaleString()}` });
                          }
                          const PnLBubble = (props: RechartsCustomizedProps) => renderEdgeBubbles(props, pnlBubbleDefs);

                          return (
                        <>
                        <h4 className="text-sm font-semibold text-gray-700 mt-4 mb-1 px-2">Unrealized Profit / Loss Over Time</h4>
                        <div className="text-sm text-gray-500 mb-3 px-2">
                          {/* Show max profit (green) and min/loss (red) aligned with the dot labels */}
                          {minPnLPoint && (
                            <span>
                              <span className="text-red-500 font-medium">
                                Min {minPnLPoint.pnl >= 0 ? '+' : ''}{minPnLPoint.pnl.toLocaleString()}
                                {minPnLPct !== null && ` (${minPnLPct >= 0 ? '+' : ''}${minPnLPct.toFixed(1)}%)`}
                              </span>
                            </span>
                          )}
                          {minPnLPoint && maxPnLPoint && <span className="mx-1">·</span>}
                          {maxPnLPoint && (
                            <span>
                              <span className="text-green-600 font-medium">
                                Max {maxPnLPoint.pnl >= 0 ? '+' : ''}{maxPnLPoint.pnl.toLocaleString()}
                                {maxPnLPct !== null && ` (${maxPnLPct >= 0 ? '+' : ''}${maxPnLPct.toFixed(1)}%)`}
                              </span>
                            </span>
                          )}
                        </div>
                        <ResponsiveContainer width="100%" height={200}>
                          <AreaChart data={capitalChartData} margin={{ top: 5, right: 70, left: -5, bottom: 15 }}>
                            <defs>
                              {/* Fill gradient: green above zero, red below zero (semi-transparent) */}
                              <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={GAIN} stopOpacity={0.4} />
                                <stop offset={`${(pnlZeroFraction * 100).toFixed(1)}%`} stopColor={GAIN} stopOpacity={0.05} />
                                <stop offset={`${(pnlZeroFraction * 100).toFixed(1)}%`} stopColor={LOSS} stopOpacity={0.05} />
                                <stop offset="100%" stopColor={LOSS} stopOpacity={0.4} />
                              </linearGradient>
                              {/* Stroke gradient: green above zero, red below zero (solid line) */}
                              <linearGradient id="pnlStrokeGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={GAIN} />
                                <stop offset={`${(pnlZeroFraction * 100).toFixed(1)}%`} stopColor={GAIN} />
                                <stop offset={`${(pnlZeroFraction * 100).toFixed(1)}%`} stopColor={LOSS} />
                                <stop offset="100%" stopColor={LOSS} />
                              </linearGradient>
                            </defs>
                            {/* No CartesianGrid on purpose: the position detail charts are gridless, like the Monthly tab. The axis labels carry the levels. */}
                            <XAxis dataKey="date" tick={<DateAxisTick x={0} y={0} payload={{ value: '' }} />} height={35} />
                            <YAxis tick={{ fontSize: 9 }} width={40} />
                            <Tooltip
                              formatter={(value: number) => {
                                if (value === undefined || value === null) return ['-', 'PnL'];
                                return [`${value >= 0 ? '+' : ''}${value.toLocaleString()}`, 'PnL'];
                              }}
                            />
                            <Customized component={PnLBubble} />
                            <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" strokeWidth={1} />
                            <Area
                              type="monotone"
                              dataKey="pnl"
                              name="PnL"
                              stroke="url(#pnlStrokeGradient)"
                              fill="url(#pnlGradient)"
                              strokeWidth={2}
                            />
                            {/* Green dot at highest profit */}
                            {maxPnLPoint && (
                              <ReferenceDot
                                x={maxPnLPoint.date}
                                y={maxPnLPoint.pnl}
                                r={6}
                                fill={GAIN}
                                stroke={HALO}
                                strokeWidth={2}
                                label={{
                                  value: `${maxPnLPoint.pnl >= 0 ? '+' : ''}${maxPnLPoint.pnl.toLocaleString()}`,
                                  position: 'left',
                                  fontSize: 12,
                                  fill: INK,
                                  fontWeight: 600,
                                }}
                              />
                            )}
                            {/* Red dot at biggest loss */}
                            {minPnLPoint && (
                              <ReferenceDot
                                x={minPnLPoint.date}
                                y={minPnLPoint.pnl}
                                r={6}
                                fill={LOSS}
                                stroke={HALO}
                                strokeWidth={2}
                                label={{
                                  value: `${minPnLPoint.pnl >= 0 ? '+' : ''}${minPnLPoint.pnl.toLocaleString()}`,
                                  position: 'left',
                                  fontSize: 12,
                                  fill: INK,
                                  fontWeight: 600,
                                }}
                              />
                            )}
                          </AreaChart>
                        </ResponsiveContainer>
                        </>
                          );
                        })()}
                      </div>
                    )}

                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Phones: "More" in the tab bar opens the page menu as a slide-up panel, like every other
          choice on a phone: each page with its icon, the sections of Markets and Best To Worst
          indented under it, a tick on the one that's open. The dark-mode button sits beside the
          title, and how fresh the data is fits on one line at the bottom. */}
      {navOpen && isPhoneScreen() && (
        <BottomSheet
          title="Pages"
          options={NAV_VIEWS.flatMap(({ view, label, icon }) => [
            { value: `v:${view}`, label, icon },
            ...(navSections(view)?.items ?? []).map(s => ({ value: `s:${view}:${s.key}`, label: s.label, indent: true })),
          ])}
          selected={(() => {
            const sections = navSections(activeView);
            return sections && sections.items.length > 0 ? `s:${activeView}:${sections.active}` : `v:${activeView}`;
          })()}
          onPick={value => {
            // "v:markets" = a page; "s:markets:Equities" = a section of it (a name may contain ":")
            const [kind, view, ...rest] = value.split(':');
            setActiveView(view as typeof activeView);
            if (kind === 's') navSections(view as typeof activeView)?.select(rest.join(':'));
          }}
          onClose={() => setNavOpen(false)}
          headerExtra={themeToggle('p-2 text-gray-600 bg-gray-100 border border-gray-200 [&_svg]:w-5 [&_svg]:h-5')}
          footer={latestDataDate ? (
            <div className="text-xs text-gray-500 truncate">
              Data as of <span className="font-medium text-gray-900">{fmtNavDate(latestDataDate)}</span>
              {fetchedLabel && ` · Fetched ${fetchedLabel}`}
            </div>
          ) : undefined}
        />
      )}

      {/* Slide-in navigation drawer (narrow screens other than phones), opened by the "Menu" button.
          Tapping the dimmed backdrop, the close button, or any view closes it. */}
      {navOpen && !isPhoneScreen() && (
        <div className="fixed inset-0 z-50 min-[1520px]:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/30" onClick={() => setNavOpen(false)} />
          {/* Same dark look as the wide-screen sidebar: menu scrolls, "Data as of" card stays at the bottom. */}
          <nav aria-label="Pages" className="absolute left-0 top-0 bottom-0 w-64 max-w-[80vw] bg-gradient-to-b from-slate-900 to-black shadow-xl p-3 flex flex-col">
            <div className="flex items-center justify-between mb-2 px-1 shrink-0">
              <span className="text-sm font-semibold text-slate-300">Views</span>
              <div className="flex items-center gap-1">
              {themeToggle('p-1.5 text-slate-400 hover:bg-white/10 hover:text-white')}
              <button
                type="button"
                onClick={() => setNavOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
                aria-label="Close navigation"
              >
                <X className="w-4 h-4" />
              </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">{navList}</div>
            {navFooter}
          </nav>
        </div>
      )}

      {/* Phones only: every dropdown opens a slide-up panel instead of the browser's list */}
      <PhoneSelectSheets />

      {/* Phones: the tick lists of the shared asset filters (AssetFilterControls, on Ranking,
          Graphs, Monthly...) and of the Positions tab's Assets filter, as slide-up panels like
          every other choice; their drop-down lists are hidden on phones. Drawn here rather than
          inside AssetFilterControls, which is rebuilt from scratch on every tick (it's defined
          inside this component) and would replay the panel's slide-in each time. */}
      {openFilterDropdown && isPhoneScreen() && (() => {
        const lists = {
          assets: { title: 'Assets', options: assetLookup.map(a => ({ value: a.ticker, label: a.ticker, hint: a.name })),
            checked: selectedAssetTickers, set: setSelectedAssetTickers, setAll: toggleAllAssets },
          assetClass: { title: 'Class', options: getUniqueAssetClasses().map(v => ({ value: v, label: v })),
            checked: selectedAssetClasses, set: setSelectedAssetClasses, setAll: toggleAllAssetClasses },
          currency: { title: 'Currency', options: getUniqueCurrencies().map(v => ({ value: v, label: v })),
            checked: selectedCurrencies, set: setSelectedCurrencies, setAll: toggleAllCurrencies },
          assetSubcategory: { title: 'Subcategory', options: getUniqueAssetSubcategories().map(v => ({ value: v, label: v })),
            checked: selectedAssetSubcategories, set: setSelectedAssetSubcategories, setAll: toggleAllAssetSubcategories },
        };
        const list = lists[openFilterDropdown];
        return (
          <PhoneCheckSheet
            title={list.title}
            options={list.options}
            checked={list.checked}
            onToggle={v => list.set(list.checked.includes(v) ? list.checked.filter(x => x !== v) : [...list.checked, v])}
            onSetAll={list.setAll}
            onClose={() => setOpenFilterDropdown(null)}
          />
        );
      })()}

      {/* Phones only: the pull-to-refresh arrow. It waits just above the top edge, invisible, and
          is moved into view by the touch handlers next to loadDataFromSheet. */}
      <div
        ref={pullIndicatorRef}
        aria-hidden="true"
        className="hidden max-md:flex fixed left-1/2 -ml-5 -top-11 z-50 w-10 h-10 rounded-full bg-white border border-gray-200 shadow-md text-gray-700 items-center justify-center pointer-events-none"
        style={{ opacity: 0 }}
      >
        <RefreshCw className="w-5 h-5" />
      </div>

      {/* Phones only: the tab bar along the bottom, like most phone apps. The four most-used pages
          are one tap away; "More" opens the full menu (the drawer) for the rest, and is the one
          lit up while you're on one of those other pages. Each page reopens where you left it;
          tapping the page you're already on scrolls back to its top, as apps do.
          env(safe-area-inset-bottom) keeps it above the iPhone's home bar when the app runs full
          screen. (Its aria-label is deliberately not "Pages": app/dark.css styles that one.) */}
      {isConnected && assetData && (() => {
        const tabs: { label: string; icon: React.ElementType; active: boolean; go: () => void }[] = [
          { label: 'Portfolio', icon: Briefcase, active: activeView === 'portfolio', go: () => setActiveView('portfolio') },
          { label: 'Positions', icon: Layers, active: activeView === 'positions', go: () => setActiveView('positions') },
          { label: 'Markets', icon: Globe, active: activeView === 'markets', go: () => setActiveView('markets') },
          {
            label: 'Ranking', icon: ArrowDownWideNarrow,
            active: activeView === 'bestToWorst' && bestToWorstLayout === 'ranking',
            go: () => { setActiveView('bestToWorst'); setBestToWorstLayout('ranking'); },
          },
        ];
        const onOtherPage = !tabs.some(t => t.active);
        return (
          <nav
            aria-label="Main pages"
            className="hidden max-md:grid grid-cols-5 fixed inset-x-0 bottom-0 z-40 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]"
          >
            {[...tabs, { label: 'More', icon: Menu, active: onOtherPage, go: () => setNavOpen(true) }].map(({ label, icon: Icon, active, go }) => (
              <button
                key={label}
                type="button"
                // (The page that opens goes back to where it was scrolled last time: see
                // "EACH PAGE KEEPS ITS PLACE")
                onClick={() => {
                  if (active && label !== 'More') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
                  go();
                }}
                aria-current={active && label !== 'More' ? 'page' : undefined}
                className={`h-14 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? 'text-slate-900' : 'text-gray-500'}`}
              >
                {/* The open page's icon sits in a soft grey pill */}
                <span className={`px-4 py-0.5 rounded-full ${active ? 'bg-gray-100' : ''}`}>
                  <Icon className="w-5 h-5" />
                </span>
                {label}
              </button>
            ))}
          </nav>
        );
      })()}
    </div>
  );
};

export default PortfolioBacktester;
