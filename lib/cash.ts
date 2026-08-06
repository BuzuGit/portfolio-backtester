/*
  CASH BALANCES

  The Transactions tab is written as DOUBLE-ENTRY bookkeeping, which is the key that
  unlocks this whole file. Every row has two account columns:

      "Flow from account:"   where the money LEFT
      "Flow to account:"     where the money ARRIVED

  and a single, always-positive Amount. So a row is not "a purchase" or "a dividend"
  so much as "this much money moved from here to there". A dividend row reads
  `Company Distribution -> DBS SRS P`; buying an ETF reads `Interactive Brokers ->
  IB ETF`; converting currency reads as a PAIR of rows, one moving SGD out and one
  moving USD in.

  Think of it as a bank statement that was shredded into individual movements and
  shuffled. To rebuild the statement for one account you pick out every movement that
  names it — on either side — sort them by date, and add them up. Money in when the
  account is the destination, money out when it is the source.

  That is literally all this file does. It reproduces every balance the spreadsheet
  owner expects to the cent (IB USD 53,277.92 / PLN 2,346.53 / SGD 0.00,
  DBS SRS P 44,397.94, DBS SRS O 4,660.78) with no fudge factors.

  THE ONE HARD PART is deciding which of the ~35 names in those two columns are real
  CASH accounts. They are a mix of three different things:

    1. Cash accounts       — money genuinely sits here. "Interactive Brokers",
                             "DBS SRS P", "Alior Bank". These are what we want.
    2. Securities buckets  — "IB ETF", "DBS Vickers SRS". Buying shares is booked as
                             cash leaving your cash account and "arriving" at one of
                             these. Their balance is therefore cost basis, not money;
                             what you actually hold there is shares, which the
                             Positions tab already reports.
    3. Counterparties      — "Company Distribution" (the company paying you a
                             dividend), "IB Lending" (Interactive Brokers paying you
                             interest), "IB FX" (the far side of a currency trade),
                             "Other" and blank (the outside world). These are the
                             OTHER party to a movement, not somewhere you hold money.

  Only category 1 gets a balance. See NON_CASH_ACCOUNTS below for how the other two
  are identified.
*/

import { LedgerRow } from './fetchData';

/** One line of the statement: a single movement of money in or out. */
export interface CashMovement {
  date: string;
  flow: string;            // the ledger's own Flow value, e.g. "Dividend", "FX Conversion"
  category: string;        // friendly grouping label, e.g. "Dividends", "FX conversions"
  direction: 'in' | 'out';
  amount: number;          // always positive; `direction` carries the sign
  counterparty: string;    // the account at the OTHER end of this movement
  asset: string;           // what the movement was about ("Cash" for pure cash moves)
  ticker: string;
  remarks: string;
  balance: number;         // running balance AFTER this movement
}

/** One account in one currency — i.e. one row of the Cash table. */
export interface CashAccountBalance {
  account: string;
  currency: string;
  balance: number;         // what is left today
  totalIn: number;
  totalOut: number;
  firstDate: string;
  lastDate: string;        // most recent movement, used by the visibility rule
  movements: CashMovement[];
}

/**
 * Names that are NOT cash accounts, beyond the ones worked out from the data.
 *
 * Securities buckets are mostly DERIVED (see below: anything that ever received a
 * "Purchase of Asset" is one), because that rule is self-maintaining — add a new
 * broker to the sheet and it classifies itself. But some accounts never receive a
 * purchase row and still are not cash, so they have to be named here:
 *
 *   Company Distribution — a company paying a dividend. Only ever a source.
 *   IB Lending           — Interactive Brokers paying share-lending interest. Ditto.
 *   IB FX                — the far leg of a currency conversion. Every FX trade books
 *                          two rows through it, so its "balance" is the sum of every
 *                          conversion ever made in that currency: +715,000 SGD and
 *                          -495,000 USD. Meaningless as money.
 *   Other / ""           — the outside world (salary, tax, anything untracked).
 *   TransferWise         — a pass-through used once to move PLN to SGD.
 *   Skandia, Equate Plus — investment wrappers fed by "Inflow" rows rather than
 *                          purchases, so the derived rule misses them.
 *   UBS                  — where UBS employee-plan dividends land; shares, not cash.
 *   Ledger Nano S,       — crypto wallets. Coins moved OUT of them are booked as
 *   Metamask               sales, so a naive balance is a large negative number.
 *   BGZ Optima Funds O   — a fund account, same shape as the wrappers above.
 *   ...Time Deposit      — two 2016 term deposits that only ever paid interest out.
 *
 * Anything NOT on this list and not a derived securities bucket is treated as cash.
 * That is the deliberate default: if a genuinely new bank account appears in the
 * sheet one day it shows up as a visible new row (easy to spot and correct) rather
 * than silently disappearing, which is the failure mode that would go unnoticed.
 */
const NON_CASH_ACCOUNTS = new Set<string>([
  '', 'Other', 'Company Distribution', 'IB Lending', 'IB FX', 'TransferWise',
  'Skandia', 'Equate Plus', 'UBS', 'Ledger Nano S', 'Metamask',
  'BGZ Optima Funds O', 'BGZ Optima P Time Deposit', 'BGZ Optima O Time Deposit',
]);

/** Ledger Flow value -> the label used in the drill-down's breakdown table. */
const FLOW_CATEGORY: { [flow: string]: string } = {
  'Inflow': 'Deposits',
  'Outflow': 'Withdrawals',
  'SRS Contribution': 'SRS contributions',
  'Transfer': 'Transfers',
  'FX Conversion': 'FX conversions',
  'Dividend': 'Dividends',
  'Interest': 'Interest',
  'Proceeds from Sale': 'Sales proceeds',
  'Purchase of Asset': 'Asset purchases',
  'Commision': 'Fees & commissions',   // the sheet's own spelling
};

/** Balances smaller than this are treated as zero — rounding dust, not money. */
const ZERO_EPS = 0.5;

/**
 * Rebuilds a bank statement for every account/currency pair in the ledger.
 *
 * @param ledger every row from the Transactions tab
 * @returns one entry per account-and-currency, movements sorted oldest first,
 *          sorted with the biggest balances at the top
 */
export function buildCashAccounts(ledger: LedgerRow[]): CashAccountBalance[] {
  // Step 1 — work out which account names are securities buckets rather than cash.
  // The giveaway is receiving a purchase: "Purchase of Asset" always moves money FROM
  // a cash account TO wherever the shares now live.
  const securities = new Set<string>();
  for (const r of ledger) {
    if (r.flow === 'Purchase of Asset' && r.account) securities.add(r.account);
  }
  const isCash = (name: string) => !!name && !securities.has(name) && !NON_CASH_ACCOUNTS.has(name);

  // Step 2 — deal every movement onto the statement(s) it belongs to. A single ledger
  // row can produce two movements (money out of one cash account, into another), one
  // (the other side is a counterparty or a securities bucket), or none.
  const byKey = new Map<string, CashAccountBalance>();
  const record = (account: string, r: LedgerRow, direction: 'in' | 'out', counterparty: string) => {
    if (!isCash(account)) return;
    const key = `${account}|${r.currency}`;
    let line = byKey.get(key);
    if (!line) {
      line = {
        account, currency: r.currency, balance: 0, totalIn: 0, totalOut: 0,
        firstDate: '', lastDate: '', movements: [],
      };
      byKey.set(key, line);
    }
    line.movements.push({
      date: r.date,
      flow: r.flow,
      category: FLOW_CATEGORY[r.flow] || r.flow,
      direction,
      amount: r.amount,
      // A blank on the other side means the outside world — a salary arriving, a fee
      // leaving. Naming it beats an empty cell in the statement.
      counterparty: counterparty || 'Outside',
      asset: r.asset,
      ticker: r.ticker,
      remarks: r.remarks,
      balance: 0,   // filled in below, once the movements are in date order
    });
  };

  for (const r of ledger) {
    if (!r.amount) continue;               // rows with no cash value move nothing
    record(r.account, r, 'in', r.from);    // money arrived here
    record(r.from, r, 'out', r.account);   // money left here
  }

  // Step 3 — sort each statement by date and run the balance down it.
  const lines = Array.from(byKey.values());
  for (const line of lines) {
    // Same-day movements are ordered by the ledger's own row order, which the stable
    // sort preserves. That matters for readability: an SRS contribution and the
    // purchase it funded on the same day read in the order they happened.
    line.movements.sort((a, b) => a.date.localeCompare(b.date));
    let balance = 0;
    for (const m of line.movements) {
      balance += m.direction === 'in' ? m.amount : -m.amount;
      m.balance = balance;
      if (m.direction === 'in') line.totalIn += m.amount; else line.totalOut += m.amount;
    }
    line.balance = balance;
    line.firstDate = line.movements[0]?.date ?? '';
    line.lastDate = line.movements[line.movements.length - 1]?.date ?? '';
  }

  return lines.sort((a, b) => b.balance - a.balance || a.account.localeCompare(b.account));
}

/**
 * Narrows the full list down to the accounts worth putting on screen.
 *
 * Two things are being filtered out, and they are different problems:
 *
 *   - Accounts closed years ago that ended at zero (BGZ Optima O, Idea Bank,
 *     Millenium Bank). Real history, but nothing is there now.
 *   - Tiny negative residues on long-dead accounts (BGZ Optima P sits at -16.76 PLN
 *     because a 2022 rounding difference was never squared off). A savings account
 *     cannot really be overdrawn by 16 zloty; showing it as a red balance would be
 *     more alarming than informative.
 *
 * WHAT MUST NEVER BE HIDDEN is a negative balance big enough to mean something. A
 * dormant account sitting at -6,959 is not rounding dust, it is a missing row in the
 * ledger — precisely the thing worth seeing. An earlier version of this function tested
 * only "is it negative and old?", which swallowed both cases alike and silently
 * concealed a real 6,959 PLN discrepancy on Alior Bank.
 *
 * So "dust" is judged RELATIVE to the money that has flowed through the account, not by
 * a flat cut-off. A rounding error is vanishingly small next to an account's turnover
 * (16.76 against 404,585 that passed through, 0.004%); a genuine hole is not (6,959
 * against 195,041, 3.6%). That scales itself: it needs no re-tuning for an account that
 * handles millions or one that handles hundreds.
 *
 * A line therefore "counts" if it holds real money, OR is still ACTIVE, OR is negative
 * by more than dust — the last two being the cases where you need to look.
 *
 * Then, crucially, every currency of a counting account comes along for the ride.
 * That is what puts "IB SGD 0.00" on screen next to IB's USD and PLN balances: the
 * zero is informative there ("I have swept all my SGD out"), whereas the same zero on
 * a bank closed in 2019 is just noise.
 *
 * @param lines everything buildCashAccounts returned
 * @param asOf  today, injectable so tests are not hostage to the calendar
 */
export function selectVisibleCash(lines: CashAccountBalance[], asOf: Date = new Date()): CashAccountBalance[] {
  const DORMANT_AFTER_MONTHS = 24;
  // A negative balance under this fraction of everything that ever came in is treated
  // as an unsquared rounding difference rather than a real shortfall.
  const DUST_FRACTION_OF_TURNOVER = 0.001;   // 0.1%
  const cutoff = new Date(asOf);
  cutoff.setMonth(cutoff.getMonth() - DORMANT_AFTER_MONTHS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const isDust = (l: CashAccountBalance) =>
    Math.abs(l.balance) < Math.max(ZERO_EPS, l.totalIn * DUST_FRACTION_OF_TURNOVER);

  const counts = (l: CashAccountBalance) =>
    Math.abs(l.balance) >= ZERO_EPS && (l.balance > 0 || l.lastDate >= cutoffStr || !isDust(l));

  const liveAccounts = new Set(lines.filter(counts).map(l => l.account));
  return lines.filter(l => liveAccounts.has(l.account));
}
