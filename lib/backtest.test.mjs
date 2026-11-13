// Tests for lib/backtest.ts, on small made-up price tables where the right answer can be worked
// out by hand. Run with `npm test` (the publish script runs them before every publish).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  portfolioReturns, simulatePortfolio, calculateStatistics, calculateMonthlyReturns,
  calculateWithdrawalReturns, getWithdrawalDetails, getConversionRate, formatPeriod,
} from './backtest.ts';

const close = (actual, expected, digits = 6) =>
  assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} is not ≈ ${expected}`);

// Month-end dates from Dec 2019 onwards
const monthEnds = n => Array.from({ length: n }, (_, i) =>
  new Date(Date.UTC(2020, i, 0)).toISOString().slice(0, 10));
// A price table: { A: [..], B: [..] } → rows of { date, A, B }
const table = cols => {
  const n = Object.values(cols)[0].length;
  return monthEnds(n).map((date, i) => Object.fromEntries([['date', date], ...Object.entries(cols).map(([k, v]) => [k, v[i]])]));
};
const portfolio = (assets, extra = {}) => ({
  id: 1, name: 'Test', color: '#000', nameManuallyEdited: false, inflationAdj: '', baseCurrency: '', assets, ...extra,
});
const settings = (rows, extra = {}) => ({
  start: rows[0].date, end: rows[rows.length - 1].date, rebalanceFreq: 'monthly',
  startingCapital: 1000, currencyOf: () => 'PLN', ...extra,
});

test('one asset at 100% simply follows its price', () => {
  const rows = table({ A: [10, 12, 9, 15] });
  const r = portfolioReturns(portfolio([{ asset: 'A', weight: 100 }]), rows, settings(rows));
  assert.deepEqual(r.map(p => p.value), [1000, 1200, 900, 1500]);
  close(r[2].drawdown, -25);                 // 900 vs the 1,200 peak
  assert.equal(r[3].drawdown, 0);            // new high
});

test('weights that do not add up to 100% give no result', () => {
  const rows = table({ A: [10, 11], B: [10, 11] });
  assert.equal(portfolioReturns(portfolio([{ asset: 'A', weight: 60 }, { asset: 'B', weight: 30 }]), rows, settings(rows)), null);
});

test('monthly rebalancing restores 50/50; never rebalancing lets it drift', () => {
  const rows = table({ A: [10, 20, 20], B: [10, 10, 10] });
  const p = portfolio([{ asset: 'A', weight: 50 }, { asset: 'B', weight: 50 }]);
  // Month 1: A doubles → 1,000 + 500 = 1,500 at 66.7/33.3, then rebalanced back to 750/750
  const monthly = simulatePortfolio(p, rows, settings(rows));
  close(monthly[1].portfolioValue, 1500);
  close(monthly[1].assetWeights.A, 200 / 3);
  assert.equal(monthly[1].isRebalanced, true);
  close(monthly[2].assetWeights.A, 50);       // flat month after the rebalance: still 50/50
  const never = simulatePortfolio(p, rows, settings(rows, { rebalanceFreq: 'never' }));
  close(never[2].assetWeights.A, 200 / 3);    // still drifted
  assert.equal(never.some(r => r.isRebalanced), false);
});

test('prices are converted into the base currency through PLN', () => {
  const rows = table({ US: [10, 10], USDPLN: [4, 5], SGDPLN: [3, 3] });
  close(getConversionRate(rows[0], 'USD', 'PLN'), 4);
  close(getConversionRate(rows[0], 'USD', 'SGD'), 4 / 3);
  assert.equal(getConversionRate(rows[0], 'USD', ''), 1);   // no conversion chosen
  // A USD asset that doesn't move, held in PLN, gains exactly what the dollar gained
  const r = portfolioReturns(portfolio([{ asset: 'US', weight: 100 }], { baseCurrency: 'PLN' }), rows,
    settings(rows, { currencyOf: () => 'USD' }));
  close(r[1].value, 1250);
});

test('the inflation adjustment divides by the CPI index since the start', () => {
  const rows = table({ A: [10, 12], CPI: [100, 120] });
  const r = portfolioReturns(portfolio([{ asset: 'A', weight: 100 }], { inflationAdj: 'CPI' }), rows, settings(rows));
  close(r[1].value, 1000);   // +20% price, +20% prices in the shops: no real gain
});

test('a leveraged portfolio that loses everything is closed out at zero and stays there', () => {
  const rows = table({ A: [10, 6, 20], B: [10, 10, 10] });
  // 300% A financed by -200% B: a 40% fall in A wipes out the equity
  const p = portfolio([{ asset: 'A', weight: 300 }, { asset: 'B', weight: -200 }]);
  const sim = simulatePortfolio(p, rows, settings(rows));
  assert.equal(sim[1].portfolioValue, 0);
  assert.equal(sim[1].isWipedOut, true);
  assert.equal(sim[2].portfolioValue, 0);    // A recovers, but the position is gone
  assert.deepEqual(portfolioReturns(p, rows, settings(rows)).map(r => r.value), [1000, 0, 0]);
});

test('a financing cost on a leg is charged on its notional for the days held', () => {
  const rows = table({ A: [10, 10], B: [10, 10] });
  // 200% A financed by -100% B with a 0.5% a year borrowing spread on the short leg
  const p = portfolio([{ asset: 'A', weight: 200 }, { asset: 'B', weight: -100, costPct: -0.5 }]);
  const sim = simulatePortfolio(p, rows, settings(rows));
  const days = 31;   // 31 Dec → 31 Jan
  close(sim[1].accruedCost, -1000 * 0.005 * days / 365);
  close(sim[1].portfolioValue, 1000 - 1000 * 0.005 * days / 365);
});

test('statistics: CAGR under a year is the plain return, and Sharpe is a dash', () => {
  const rows = table({ A: [100, 102, 101, 104] });
  const stats = calculateStatistics(portfolioReturns(portfolio([{ asset: 'A', weight: 100 }]), rows, settings(rows)), { name: 'x' });
  assert.equal(stats.totalReturn, '4.00');
  assert.equal(stats.cagr, '4.00');
  assert.equal(stats.sharpeRatio, '—');
  assert.equal(stats.longestDrawdown, '1m');
  assert.equal(stats.endingValue, '1040.00');
});

test('monthly returns table: each month against the previous month-end', () => {
  const m = calculateMonthlyReturns([
    { date: '2019-12-31', value: 100, drawdown: 0 },
    { date: '2020-01-31', value: 110, drawdown: 0 },
    { date: '2020-02-29', value: 99, drawdown: -10 },
  ]);
  close(m['2020'].monthly[0], 10);
  close(m['2020'].monthly[1], -10);
  close(m['2020'].fy, -1);
});

test('withdrawals take a fixed amount once a year, raised by inflation', () => {
  const flat = monthEnds(26).map(date => ({ date, value: 1000, drawdown: 0 }));
  const path = calculateWithdrawalReturns(flat, 4, 10);
  close(path[12].value, 960);                // first year: 4% of 1,000
  close(path[24].value, 960 - 44);           // second year: 40 raised by 10% inflation
  const details = getWithdrawalDetails(flat, 4, 10);
  assert.equal(details.length, 2);
  close(details[1].withdrawalAmount, 44);
});

test('formatPeriod writes months as years and months', () => {
  assert.equal(formatPeriod(8), '8m');
  assert.equal(formatPeriod(24), '2y');
  assert.equal(formatPeriod(15), '1y 3m');
});
