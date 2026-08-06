/*
  POSITION RECONSTRUCTION

  The Transactions tab is a plain diary: "on this date I bought 100 of X", "on that
  date I received a dividend", "later I sold 40". Nothing in it says which positions
  are still open, which are finished, or which dividend belongs to which purchase.
  This file works all of that out by replaying the diary in date order.

  The mental model is a queue of LOTS. Every purchase pushes a lot onto the back of
  the queue (how many shares, what they cost). Every sale takes shares off the FRONT
  of the queue — oldest first, which is called FIFO. Whatever is still in the queue at
  the end is your open position; every (lot, sale) pairing that came off it is a
  completed round trip.

  Why FIFO and not average cost: it is what the spreadsheet already does. Replaying
  the ledger this way reproduces the sheet's own "Cost Basis" column on 60 of the 64
  sale rows that have one, to within 1%. The four that differ are crypto rows where
  the quantity units are inconsistent, and those are flagged rather than guessed.
*/

import {
  LedgerRow, LEDGER_PURCHASE, LEDGER_SALE, LEDGER_DIVIDEND, LEDGER_INTEREST, LEDGER_INFLOW,
  TransactionRow, ClosedPositionRow, FlowType, FLOW_PURCHASE, FLOW_SALE, FLOW_DIVIDEND,
} from './fetchData';

/** A holding that still has shares left in the lot queue. */
export interface OpenPosition {
  ticker: string;
  asset: string;
  currency: string;
  qty: number;            // shares still held
  cost: number;           // what those specific shares cost, in `currency`
  income: number;         // dividends + interest earned by the shares still held
  firstBuyDate: string;   // when the position was opened
  lastBuyDate: string;    // most recent top-up
  partiallySold: boolean; // true if some shares were sold along the way
  // The lots still in the queue, oldest first. These are what you ACTUALLY still own:
  // for a partially sold holding they are the leftovers after FIFO took the oldest
  // shares away, so summing them gives the real position rather than everything ever
  // bought. The Positions tab lists these as its purchase rows.
  // `account` is per lot, not per position: BTCSGD was accumulated across Coinhako,
  // BinanceSG, Crypto.com and Gemini, and ETHSGD across two of them.
  lots: { date: string; qty: number; cost: number; commission: number; commissionBps: number; account: string; fundedFrom: string }[];
  // The dividend payments the SURVIVING shares actually received, oldest first. A
  // payment made before these particular shares were bought is absent, because those
  // shares earned none of it.
  incomeEvents: { date: string; amount: number }[];
}

/** One completed buy->sell pairing. A single sale that eats three lots makes three of these. */
export interface RoundTrip {
  ticker: string;
  asset: string;
  currency: string;
  buyDate: string;
  sellDate: string;
  qty: number;
  cost: number;        // cost of just these shares (commission already included)
  proceeds: number;    // cash received for just these shares (commission already deducted)
  buyCommission: number;     // reported for information only — already inside `cost`
  sellCommission: number;    // likewise already inside `proceeds`
  buyCommissionBps: number;
  sellCommissionBps: number;
  dividends: number;   // income these shares earned while held
  // The individual payments making up `dividends`, with the dates they were actually
  // paid. Needed so a year-by-year view can ask "what did this contribute in 2023?"
  // and get the truth instead of a lifetime total smeared evenly over the holding.
  incomeEvents: { date: string; amount: number }[];
  pnl: number;         // proceeds - cost + dividends
  holdingDays: number;
}

/** A row the replay could not honour. The position is left open and untouched. */
export interface LedgerWarning {
  ticker: string;
  asset: string;
  date: string;
  reason: string;
}

export interface PositionsModel {
  open: OpenPosition[];
  roundTrips: RoundTrip[];
  warnings: LedgerWarning[];
}

// Shares left over below this fraction of everything ever bought are rounding dust,
// not a position. The sheet quotes quantities to 4 decimals, so buying 0.69 BTC and
// selling 0.69 BTC can leave ~0.0001 behind — which would otherwise show up as an
// open holding worth a few dollars that you cannot sell because it does not exist.
const DUST_FRACTION = 1e-3;
const EPS = 1e-6;

/**
 * A purchase is normally flow "Purchase of Asset", but some holdings were accumulated
 * through "Inflow" rows instead — the UBS employee share plan books 24 monthly inflows
 * with a share count and a cost. Those are purchases in everything but name.
 *
 * The one Inflow that must NOT count is 2016-12-01 "Proceeds from PZU equity sale":
 * it is tagged with Asset=PZU but records cash ARRIVING from a sale. It has no Amount,
 * so requiring a positive amount excludes it.
 */
const isPurchase = (r: LedgerRow): boolean =>
  r.flow === LEDGER_PURCHASE || (r.flow === LEDGER_INFLOW && !!r.asset && r.asset !== 'Cash' && r.amount > 0);

const isSale = (r: LedgerRow): boolean => r.flow === LEDGER_SALE;

/** Dividends and savings-bond coupons both count as income earned by the shares. */
const isIncome = (r: LedgerRow): boolean =>
  (r.flow === LEDGER_DIVIDEND || r.flow === LEDGER_INTEREST) && !!r.asset && r.asset !== 'Cash';

const daysBetween = (a: string, b: string): number =>
  Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));

/** One lot sitting in the FIFO queue. */
interface Lot {
  date: string;
  qty: number;
  unitCost: number;
  commission: number;    // commission paid to buy the shares STILL in this lot
  commissionBps: number; // as quoted on the original purchase
  account: string;       // where these particular shares were bought
  fundedFrom: string;    // which cash account paid for them (the ledger's "from")
  dividends: number;     // income this lot has accumulated while held
  // The individual income payments this lot received, so an open position can list the
  // dividends its own shares actually earned. A lot bought in 2025 gets nothing from a
  // 2021 payment — it did not exist yet — which is why old dividends must not appear
  // against currently-held shares.
  incomeEvents: { date: string; amount: number }[];
}

/**
 * Replays the ledger and returns open positions, completed round trips and any rows
 * that could not be honoured.
 *
 * @param ledger        every row from the Transactions tab
 * @param allowedTickers only these tickers are reported. Holdings deliberately left
 *                       out of the lookup table (the flat, savings bonds, cash funds)
 *                       are not investments the Positions tab should show.
 */
export function buildPositions(ledger: LedgerRow[], allowedTickers: Set<string>): PositionsModel {
  // Group by ASSET, not ticker: the ticker column is blank on some rows, and
  // "UST T-Bill" is reused by two different bills that must not be merged.
  const byAsset = new Map<string, { ticker: string; currency: string; rows: LedgerRow[] }>();
  for (const r of ledger) {
    if (!isPurchase(r) && !isSale(r) && !isIncome(r)) continue;
    if (!r.asset || r.asset === 'Cash') continue;
    let entry = byAsset.get(r.asset);
    if (!entry) { entry = { ticker: '', currency: r.currency, rows: [] }; byAsset.set(r.asset, entry); }
    if (r.ticker) entry.ticker = r.ticker;   // fill in from whichever rows carry it
    entry.rows.push(r);
  }

  const open: OpenPosition[] = [];
  const roundTrips: RoundTrip[] = [];
  const warnings: LedgerWarning[] = [];

  byAsset.forEach((entry, asset) => {
    // Only report holdings the lookup table knows about
    if (!entry.ticker || !allowedTickers.has(entry.ticker)) return;

    const rows = entry.rows.slice().sort((a, b) => a.date.localeCompare(b.date));
    // If any purchase has no quantity, share accounting is impossible for this asset
    const qtyUsable = rows.filter(isPurchase).every(r => r.qty > 0);

    const lots: Lot[] = [];
    let totalBought = 0, soldAny = false;
    let firstBuyDate = '', lastBuyDate = '';

    for (const r of rows) {
      if (isIncome(r)) {
        // A dividend belongs to the shares that were held on the day it was paid.
        // Spread it across the open lots in proportion to their size, so when part of
        // a lot is sold later, the income it earned travels with the round trip.
        const held = lots.reduce((s, l) => s + l.qty, 0);
        if (held > 0) for (const l of lots) {
          const share = r.amount * (l.qty / held);
          l.dividends += share;
          l.incomeEvents.push({ date: r.date, amount: share });
        }
        continue;
      }

      if (isPurchase(r)) {
        totalBought += r.qty;
        if (!firstBuyDate) firstBuyDate = r.date;
        lastBuyDate = r.date;
        if (qtyUsable) lots.push({
          date: r.date, qty: r.qty, unitCost: r.amount / r.qty,
          commission: r.commission, commissionBps: r.commissionBps, account: r.account,
          fundedFrom: r.from,
          dividends: 0, incomeEvents: [],
        });
        continue;
      }

      // ---- a sale ----
      const held = lots.reduce((s, l) => s + l.qty, 0);
      let remaining = r.qty;

      // Two shapes of unusable sale row, both left alone rather than guessed at:
      //  (a) it sells more than is held (StashAway books a 1-unit buy and a 30,000-unit sale)
      //  (b) the quantity is a placeholder "1" standing for "the whole position", which
      //      gives itself away by the price being the entire amount (UBS: 1 @ 34,939.13)
      const placeholder = r.qty === 1 && r.price === r.amount && held > 1;
      if (!qtyUsable || remaining > held + Math.max(EPS, held * 1e-9) || placeholder) {
        warnings.push({
          ticker: entry.ticker, asset, date: r.date,
          reason: placeholder
            ? `quantity 1 looks like a placeholder for the whole ${held.toFixed(2)}-share position`
            : !qtyUsable ? 'purchases for this asset have no quantity, so shares cannot be matched'
            : `sale of ${r.qty} exceeds the ${held.toFixed(4)} held`,
        });
        continue;
      }

      soldAny = true;
      const unitProceeds = r.qty > 0 ? r.amount / r.qty : 0;
      while (remaining > EPS && lots.length > 0) {
        const lot = lots[0];
        const take = Math.min(remaining, lot.qty);
        const fraction = take / lot.qty;          // how much of this lot is leaving
        const divShare = lot.dividends * fraction;
        const buyCommShare = lot.commission * fraction;
        // The sale's own commission, split across however many lots this sale consumes
        const sellCommShare = r.qty > 0 ? r.commission * (take / r.qty) : 0;

        roundTrips.push({
          ticker: entry.ticker, asset, currency: r.currency,
          buyDate: lot.date, sellDate: r.date,
          qty: take,
          // Cost and proceeds are left exactly as the ledger recorded them: commission
          // is already inside both figures, so it is reported alongside, never re-applied.
          cost: take * lot.unitCost,
          proceeds: take * unitProceeds,
          buyCommission: buyCommShare,
          sellCommission: sellCommShare,
          buyCommissionBps: lot.commissionBps,
          sellCommissionBps: r.commissionBps,
          dividends: divShare,
          // The sold shares take their slice of each payment, dates intact
          incomeEvents: lot.incomeEvents
            .map(e => ({ date: e.date, amount: e.amount * fraction }))
            .filter(e => Math.abs(e.amount) > 0.005),
          pnl: take * unitProceeds - take * lot.unitCost + divShare,
          holdingDays: daysBetween(lot.date, r.date),
        });

        lot.dividends -= divShare;
        lot.commission -= buyCommShare;
        // Shrink this lot's income history by the same fraction, so what remains is the
        // income belonging to the shares that are still held
        lot.incomeEvents = lot.incomeEvents.map(e => ({ date: e.date, amount: e.amount * (1 - fraction) }));
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= EPS) lots.shift();
      }
    }

    const qty = lots.reduce((s, l) => s + l.qty, 0);
    if (qtyUsable && qty > Math.max(EPS, totalBought * DUST_FRACTION)) {
      open.push({
        ticker: entry.ticker, asset, currency: entry.currency,
        qty,
        cost: lots.reduce((s, l) => s + l.qty * l.unitCost, 0),
        income: lots.reduce((s, l) => s + l.dividends, 0),
        firstBuyDate, lastBuyDate,
        partiallySold: soldAny,
        lots: lots.map(l => ({
          date: l.date, qty: l.qty, cost: l.qty * l.unitCost,
          commission: l.commission, commissionBps: l.commissionBps, account: l.account,
          fundedFrom: l.fundedFrom,
        })),
        // Merge the surviving lots' income histories, combining same-day payments
        incomeEvents: (() => {
          const byDate = new Map<string, number>();
          for (const l of lots) for (const e of l.incomeEvents) {
            byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount);
          }
          return Array.from(byDate.entries())
            .filter(([, amount]) => Math.abs(amount) > 0.005)   // drop payments scaled to nothing
            .map(([date, amount]) => ({ date, amount }))
            .sort((a, b) => a.date.localeCompare(b.date));
        })(),
      });
    }
  });

  open.sort((a, b) => a.ticker.localeCompare(b.ticker));
  roundTrips.sort((a, b) => a.sellDate.localeCompare(b.sellDate) || a.ticker.localeCompare(b.ticker));
  return { open, roundTrips, warnings };
}

// ---------------------------------------------------------------------------
// ADAPTERS
// ---------------------------------------------------------------------------
// The Positions tab and the Portfolio tab's yearly breakdown were written against
// the old Open/Exit tabs. Rather than rewrite that (working, tested) display code,
// these two functions re-express the ledger in the shapes it already understands.
// The screens keep their logic; only where the numbers come from changes.

/**
 * Ledger -> TransactionRow[], the shape the old "Open" feed had.
 * Interest is mapped onto the Dividend flow because that is what it is economically:
 * income thrown off by a holding you still own.
 */
export function toTransactionRows(ledger: LedgerRow[], allowedTickers: Set<string>): TransactionRow[] {
  const out: TransactionRow[] = [];
  for (const r of ledger) {
    if (!r.ticker || !allowedTickers.has(r.ticker)) continue;
    let flow: FlowType;
    if (isPurchase(r)) flow = FLOW_PURCHASE;
    else if (isSale(r)) flow = FLOW_SALE;
    else if (isIncome(r)) flow = FLOW_DIVIDEND;
    else continue;
    out.push({
      date: r.date, fx: r.currency, qty: r.qty,
      // Reported as-is. `amount` already contains the commission, so these are for
      // display only — adding them to cost would charge you twice.
      commAbs: r.commission, commBps: r.commissionBps,
      amount: r.amount, asset: r.asset, flow, ticker: r.ticker, account: r.account,
      fundedFrom: r.from,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Round trips -> ClosedPositionRow[], the shape the old "Exit" tab had.
 *
 * Commissions come straight from the ledger. They are ALREADY inside `initialCost`
 * and `proceedsFromSale`, so they are reported beside those figures and never added
 * or subtracted again. Tax is the one thing the ledger does not record, so it stays
 * 0 — the old Exit tab carried 4.00 of tax across all 139 of its rows.
 */
export function toClosedPositionRows(model: PositionsModel): ClosedPositionRow[] {
  // Per-ticker totals, which the old sheet repeated on every row of a position
  const boughtByTicker = new Map<string, number>();
  const soldByTicker = new Map<string, number>();
  for (const t of model.roundTrips) {
    boughtByTicker.set(t.ticker, (boughtByTicker.get(t.ticker) || 0) + t.qty);
    soldByTicker.set(t.ticker, (soldByTicker.get(t.ticker) || 0) + t.qty);
  }
  for (const o of model.open) boughtByTicker.set(o.ticker, (boughtByTicker.get(o.ticker) || 0) + o.qty);

  return model.roundTrips.map(t => {
    const years = t.holdingDays / 365.25;
    const finalNetValue = t.proceeds + t.dividends;
    // CAGR is meaningless for a position held a few days, and explodes toward infinity
    // as the holding period approaches zero — so only compute it past one month.
    const cagr = years > 0.08 && t.cost > 0
      ? (Math.pow(finalNetValue / t.cost, 1 / years) - 1) * 100
      : 0;
    return {
      invDate: t.buyDate, divDate: t.sellDate,
      holdingPeriodDays: t.holdingDays, holdingPeriodYears: years,
      ticker: t.ticker, asset: t.asset,
      totalSharesBought: boughtByTicker.get(t.ticker) || 0,
      totalSharesSold: soldByTicker.get(t.ticker) || 0,
      sharesSold: t.qty,
      buyPrice: t.qty > 0 ? t.cost / t.qty : 0,
      buyCommission: t.buyCommission,
      initialCost: t.cost,
      sellPrice: t.qty > 0 ? t.proceeds / t.qty : 0,
      sellCommission: t.sellCommission,
      valueAfterFee: t.proceeds,
      cumDividend: t.dividends,
      incomeEvents: t.incomeEvents,
      totalTax: 0,
      proceedsFromSale: t.proceeds,
      finalNetValue,
      totalReturn: t.pnl,
      totalReturnPct: t.cost > 0 ? (t.pnl / t.cost) * 100 : 0,
      cagr,
    };
  });
}

/** Tickers that are fully exited: they have round trips but nothing left open. */
export function closedTickersFrom(model: PositionsModel): string[] {
  const openSet = new Set(model.open.map(o => o.ticker));
  return Array.from(new Set(model.roundTrips.map(t => t.ticker))).filter(t => !openSet.has(t)).sort();
}
