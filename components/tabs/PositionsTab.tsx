/*
  THE POSITIONS TAB

  Everything about the positions actually held or once held: the open positions overview (by asset,
  class, currency, account, with Metals & Crypto grouping), cash accounts, and for a selected
  position its dashboard, price chart with buys and sells, invested capital and P/L, shares held,
  trade history and per-purchase table; the same for closed positions.

  The sixteen helpers only this tab uses moved here word for word. The ledger data, the four helpers
  other parts of the app also use (XIRR, open purchases and dividends, closed trades) and every
  choice on this tab live in the main screen and are passed in, so they survive switching tabs.
*/
import React from 'react';
import {
  LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Area, ReferenceDot,
  ReferenceLine, AreaChart, Customized, PieChart, Pie,
} from 'recharts';
import type { AssetLookup, AssetRow, ClosedPositionRow, TransactionRow, UnitFee } from '@/lib/fetchData';
import { unitFeeQty } from '@/lib/fetchData';
import type { PositionsModel } from '@/lib/positions';
import type { CashAccountBalance } from '@/lib/cash';
import { portfolioClassOf } from '@/lib/holdings';
import { FX_TICKER_MAP, getFxRate } from '@/lib/backtest';
import { toYM } from '@/lib/dates';
import { isAnnualisable } from '@/lib/stats';
import { CURRENCY_OPTIONS, CURRENCY_SYMBOLS } from '@/components/options';
import {
  ASSET_CLASS_COLORS, BLACK, BTN_SECOND, CAGR_LOT_HINT, CHART_PALETTE, CURRENCY_COLORS, FIELD, GAIN, HALO, INK, LINE,
  LOSS, METALS_CRYPTO_CCY, METALS_CRYPTO_LABEL, MUTED, OLIVE_LABEL, ON_BLACK, ResponsiveContainer, SEG, SLATE,
  WEIGHT_BAR, WINE_LABEL, XIRR_HINT, formatPrice, segBtn,
} from '@/components/ui';
import {
  DateAxisTick, collapseTradePrices, computePnlZeroFraction, mergeComparisonData, pushTradePrice, renderEdgeBubbles,
  type BubbleDef, type RechartsCustomizedProps, type TradeDot,
} from '@/components/charts';
import {
  SharesHeldTooltip, TradeHistoryTable, SortableTh, applyFifoRunningTotals, applyUnitFeeToLots, heldQty,
  mergeUnitFees, sortTableRows, unitFeeToEvent, type TableSortMap, type TableSortState, type TradeEvent,
} from '@/components/positionsParts';

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

export interface PositionsTabProps {
  assetData: AssetRow[];
  assetLookup: AssetLookup[];
  closedData: ClosedPositionRow[];
  transactionData: TransactionRow[];
  positionsModel: PositionsModel | null;
  cashAccounts: CashAccountBalance[];
  edoMissingBanner: React.ReactNode;                 // a warning when EDO bonds are held but their sheet is missing
  calculateXIRR: (cashFlows: { date: Date; amount: number }[]) => number | null;
  getClosedTransactions: (ticker: string) => ClosedPositionRow[];
  getOpenPurchases: (ticker: string) => TransactionRow[];
  getOpenDividends: (ticker: string) => TransactionRow[];
  tableSort: TableSortMap;
  sortPropsFor: (tableId: string) => { sort: TableSortState | null; onSort: (col: string, firstDir: 'asc' | 'desc') => void };
  closedSelectAllRef: React.RefObject<HTMLInputElement>;
  openSelectAllRef: React.RefObject<HTMLInputElement>;
  positionsCurrency: string; setPositionsCurrency: SetState<string>;
  groupMetalsCrypto: boolean; setGroupMetalsCrypto: SetState<boolean>;
  cashCategory: string; setCashCategory: SetState<string>;
  cashSelected: string; setCashSelected: SetState<string>;
  openAccountFilter: string | null; setOpenAccountFilter: SetState<string | null>;
  openAssetClassFilter: string | null; setOpenAssetClassFilter: SetState<string | null>;
  openCurrencyFilter: string | null; setOpenCurrencyFilter: SetState<string | null>;
  openSelectedTicker: string; setOpenSelectedTicker: SetState<string>;
  openIncludedTxns: Set<number> | null; setOpenIncludedTxns: SetState<Set<number> | null>;
  openSinceInvested: boolean; setOpenSinceInvested: SetState<boolean>;
  openShowMinMax: boolean; setOpenShowMinMax: SetState<boolean>;
  openShowAvgBuy: boolean; setOpenShowAvgBuy: SetState<boolean>;
  openInvestedFrom: string; setOpenInvestedFrom: SetState<string>;
  openInvestedInto: string; setOpenInvestedInto: SetState<string>;
  openGraphStarts: string; setOpenGraphStarts: SetState<string>;
  openGraphEnds: string; setOpenGraphEnds: SetState<string>;
  closedSelectedTicker: string; setClosedSelectedTicker: SetState<string>;
  closedIncludedTxns: Set<number> | null; setClosedIncludedTxns: SetState<Set<number> | null>;
  closedSinceInvested: boolean; setClosedSinceInvested: SetState<boolean>;
  closedUntilSold: boolean; setClosedUntilSold: SetState<boolean>;
  closedShowMinMax: boolean; setClosedShowMinMax: SetState<boolean>;
  closedShowAvgBuy: boolean; setClosedShowAvgBuy: SetState<boolean>;
  closedShowAvgSell: boolean; setClosedShowAvgSell: SetState<boolean>;
  closedInvestedFrom: string; setClosedInvestedFrom: SetState<string>;
  closedInvestedInto: string; setClosedInvestedInto: SetState<string>;
  closedGraphStarts: string; setClosedGraphStarts: SetState<string>;
  closedGraphEnds: string; setClosedGraphEnds: SetState<string>;
}

export default function PositionsTab({
  assetData, assetLookup, closedData, transactionData, positionsModel, cashAccounts, edoMissingBanner,
  calculateXIRR, getClosedTransactions, getOpenPurchases, getOpenDividends, tableSort, sortPropsFor,
  closedSelectAllRef, openSelectAllRef, positionsCurrency, setPositionsCurrency, groupMetalsCrypto,
  setGroupMetalsCrypto, cashCategory, setCashCategory, cashSelected, setCashSelected, openAccountFilter,
  setOpenAccountFilter, openAssetClassFilter, setOpenAssetClassFilter, openCurrencyFilter, setOpenCurrencyFilter,
  openSelectedTicker, setOpenSelectedTicker, openIncludedTxns, setOpenIncludedTxns, openSinceInvested,
  setOpenSinceInvested, openShowMinMax, setOpenShowMinMax, openShowAvgBuy, setOpenShowAvgBuy, openInvestedFrom,
  setOpenInvestedFrom, openInvestedInto, setOpenInvestedInto, openGraphStarts, setOpenGraphStarts, openGraphEnds,
  setOpenGraphEnds, closedSelectedTicker, setClosedSelectedTicker, closedIncludedTxns, setClosedIncludedTxns,
  closedSinceInvested, setClosedSinceInvested, closedUntilSold, setClosedUntilSold, closedShowMinMax,
  setClosedShowMinMax, closedShowAvgBuy, setClosedShowAvgBuy, closedShowAvgSell, setClosedShowAvgSell,
  closedInvestedFrom, setClosedInvestedFrom, closedInvestedInto, setClosedInvestedInto, closedGraphStarts,
  setClosedGraphStarts, closedGraphEnds, setClosedGraphEnds,
}: PositionsTabProps) {
  /**
   * Returns assets that exist in BOTH the lookup table AND the closed positions data.
   * This ensures the Closed tab only shows assets we have full info for.
   */
  const getClosedTabLookup = (): AssetLookup[] => {
    const closedTickers = new Set(closedData.map(row => row.ticker));
    return assetLookup.filter(asset => closedTickers.has(asset.ticker));
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

  return (
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
                      // same rule as XIRR: isAnnualisable in lib/stats.ts.
                      const cagr = !isAnnualisable(holdYears) ? returnPct
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
  );
}
