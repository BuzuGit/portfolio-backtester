// Tests for lib/ledgerAllocation.ts. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerMonthEnds } from './ledgerAllocation.ts';
import { periodStartIso } from './dates.ts';

test('period buttons: "<n>Y" is n years back to the day, Max is everything', () => {
  const today = new Date(2026, 10, 20);   // 20 Nov 2026, local time
  assert.equal(periodStartIso('1Y', today), '2025-11-20');
  assert.equal(periodStartIso('10Y', today), '2016-11-20');
  assert.equal(periodStartIso('Max', today), '');
});

const close = (a, b, tol = 1e-6, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b}`);
const lot = (date, qty, cost, unitFees = []) => ({ date, qty, cost, commission: 0, commissionBps: 0, account: 'IB', fundedFrom: 'IB', unitFees });

// Price sheet: three month-ends. USDPLN 4 then 5 then 4. EDO has no price until March.
const rows = [
  { date: '2024-01-31', AAA: 10, USDPLN: 4 },
  { date: '2024-02-29', AAA: 12, USDPLN: 5 },
  { date: '2024-03-31', AAA: 11, USDPLN: 4, EDO: 104 },
];
const lookup = [
  { ticker: 'AAA', currency: 'USD' },
  { ticker: 'EDO', currency: 'PLN' },
  { ticker: 'FEE', currency: 'PLN' },
];
const model = {
  open: [
    // 100 AAA bought in January, still held
    { ticker: 'AAA', currency: 'USD', lots: [lot('2024-01-10', 100, 1000)] },
    // FEE: bought 10 units in January, 1 unit taken as a fee in March: holds 9 now, held 10 in Feb
    { ticker: 'FEE', currency: 'PLN', lots: [lot('2024-01-05', 9, 1000, [{ date: '2024-03-15', qty: 1, amount: 100 }])] },
  ],
  roundTrips: [
    // 50 more AAA bought in January and sold on 15 Feb: held at the January month-end only
    { ticker: 'AAA', currency: 'USD', buyDate: '2024-01-12', sellDate: '2024-02-15', qty: 50, cost: 500, proceeds: 600, unitFees: [] },
    // An EDO bond held 1 Jan -> 31 Mar with NO price before March: grows 100 -> 121 at a steady rate
    { ticker: 'EDO', currency: 'PLN', buyDate: '2024-01-01', sellDate: '2024-03-31', qty: 10, cost: 1000, proceeds: 1210, unitFees: [] },
  ],
  warnings: [],
};
const cash = [{
  account: 'IB', currency: 'USD',
  movements: [
    { date: '2024-01-02', balance: 1000 },
    { date: '2024-02-20', balance: 250 },
    { date: '2024-04-02', balance: 9999 },   // after the last month-end: never seen
  ],
}, {
  account: 'Old bank', currency: 'PLN',
  movements: [{ date: '2023-06-01', balance: 500 }, { date: '2024-02-01', balance: 0 }],   // closed in Feb
}];

const months = ledgerMonthEnds(model, cash, lookup, rows);
const at = d => months.find(m => m.date === d);
const h = (m, t) => m.holdings.find(x => x.ticker === t);

test('one entry per month-end from the first purchase', () => {
  assert.deepEqual(months.map(m => m.date), ['2024-01-31', '2024-02-29', '2024-03-31']);
});

test('units held: open lots from their buy date, sold lots only until the sale', () => {
  assert.equal(h(at('2024-01-31'), 'AAA').qty, 150);
  assert.equal(h(at('2024-02-29'), 'AAA').qty, 100);
  close(h(at('2024-02-29'), 'AAA').valuePln, 100 * 12 * 5, 1e-6, 'AAA Feb in PLN');
});

test('a fee paid in units counts as held until it is taken', () => {
  assert.equal(h(at('2024-02-29'), 'FEE').qty, 10);
  assert.equal(h(at('2024-03-31'), 'FEE').qty, 9);
});

test('a sold lot with no price grows from its buy price to its sale price', () => {
  const jan = h(at('2024-01-31'), 'EDO');
  assert.equal(jan.estimated, true);
  // 30 of the 90 days: 100 x 1.21^(1/3)
  close(jan.valuePln, 10 * 100 * 1.21 ** (30 / 90), 1e-6, 'EDO Jan');
  // The March row has a price but the bond was sold that day, so it is gone
  assert.equal(h(at('2024-03-31'), 'EDO'), undefined);
});

test('a lot still held with no price stays at cost', () => {
  // FEE has no price column at all: 1000 for 10 units = 100 each
  const feb = h(at('2024-02-29'), 'FEE');
  assert.equal(feb.estimated, true);
  close(feb.valuePln, 1000);
});

test('a month that skips a price or a rate uses the last one before it', () => {
  // AAA's February price and the February USD rate are blank: they carry on at January's
  const gapRows = [
    { date: '2024-01-31', AAA: 10, USDPLN: 4 },
    { date: '2024-02-29', AAA: '', USDPLN: '' },
  ];
  const gapModel = { open: [{ ticker: 'AAA', currency: 'USD', lots: [lot('2024-01-10', 100, 1000)] }], roundTrips: [], warnings: [] };
  const usdCash = [{ account: 'IB', currency: 'USD', movements: [{ date: '2024-01-02', balance: 50 }] }];
  const feb = ledgerMonthEnds(gapModel, usdCash, lookup, gapRows)[1];
  const aaa = feb.holdings.find(x => x.ticker === 'AAA');
  assert.equal(aaa.estimated, false);
  close(aaa.valuePln, 100 * 10 * 4, 1e-6, 'AAA at last price and rate');
  close(feb.cash[0].valuePln, 200, 1e-6, 'USD cash at last rate');
});

test('a currency the price sheet has no rate for is left unconverted (null), never counted as zloty', () => {
  const hkd = [{ account: 'HK bank', currency: 'HKD', movements: [{ date: '2024-01-02', balance: 1000 }] }];
  const jan = ledgerMonthEnds(model, hkd, lookup, rows)[0];
  assert.equal(jan.cash[0].valuePln, null);
});

test('cash: the balance after the last movement on or before the date, closed accounts drop out', () => {
  const jan = at('2024-01-31').cash, feb = at('2024-02-29').cash;
  assert.deepEqual(jan.map(c => [c.account, c.balance, c.valuePln]), [['IB', 1000, 4000], ['Old bank', 500, 500]]);
  assert.deepEqual(feb.map(c => [c.account, c.balance, c.valuePln]), [['IB', 250, 1250]]);
});
