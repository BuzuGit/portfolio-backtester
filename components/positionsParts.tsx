/*
  POSITIONS PARTS

  The pieces the Positions tab is built from: the Shares Held chart tooltip, trade events and
  their FIFO running totals, the Trade History table, and the sortable table headers. Moved word
  for word from the one big PortfolioBacktester.tsx.
*/
import React from 'react';
import { unitFeeQty, type TransactionRow, type UnitFee } from '@/lib/fetchData';
import { formatPrice } from '@/components/ui';

/** One row of the Price History data, as far as the Shares Held tooltip cares about it. */
export type SharesTooltipRow = {
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
export const SharesHeldTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: SharesTooltipRow }[] }) => {
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
export type TradeEvent = {
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
export const applyUnitFeeToLots = (lots: { shares: number; price: number }[], units: number) => {
  const held = lots.reduce((s, l) => s + l.shares, 0);
  if (held <= 1e-9) return;
  const keep = Math.max(0, 1 - units / held);
  if (keep <= 1e-12) { lots.length = 0; return; }   // the fee took everything
  for (const l of lots) { l.shares *= keep; l.price /= keep; }
};

/** Fees paid in units from several lots, merged into one entry per date, oldest first. */
export const mergeUnitFees = (lists: (UnitFee[] | undefined)[]): UnitFee[] => {
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
export const heldQty = (t: TransactionRow, upTo?: string): number => t.qty - unitFeeQty(t.unitFees, upTo);

/** A fee paid in units as a Transaction History row; the FIFO pass fills in the rest. */
export const unitFeeToEvent = (f: UnitFee): TradeEvent => ({
  date: f.date, type: 'fee',
  price: f.qty > 0 ? f.amount / f.qty : 0,
  quantity: f.qty, commission: 0, commissionBps: 0, amount: f.amount, costPerShare: 0,
  cumQuantity: 0, cumAvgPrice: null, cumCost: 0, cumSold: 0, income: 0, cumIncome: 0,
  pnlBasis: 0, realisedPnl: null, cumRealisedPnl: 0, stillHeld: false,
});

export const applyFifoRunningTotals = (events: TradeEvent[]) => {
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
export const TradeHistoryTable = ({ events }: { events: TradeEvent[] }) => (
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
export type TableSortState = { col: string; dir: 'asc' | 'desc' } | null;

/** One sort state per table, looked up by a short table id such as 'positionsOpen'. */
export type TableSortMap = Record<string, TableSortState>;

/** The kinds of value a column can be sorted on. null/undefined means "this cell is empty". */
export type SortValue = string | number | null | undefined;

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
export const SORT_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Work out the next sort state for a column, following the three-click cycle above.
 *
 * `firstDir` is what the FIRST click should do: 'desc' for numbers (biggest first,
 * which is what you want from a PnL or Weight column) and 'asc' for words and dates
 * (A-Z and oldest-first, which is what anyone expects from a name column).
 */
export const nextTableSort = (current: TableSortState, col: string, firstDir: 'asc' | 'desc'): TableSortState => {
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
export function sortTableRows<T>(rows: T[], sort: TableSortState, accessors: Record<string, (row: T) => SortValue>): T[] {
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
export const SortableTh = ({
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
