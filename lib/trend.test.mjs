// Tests for lib/trend.ts (Trend Following vs Buy & Hold), on small made-up price series.
// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trendFollowingAnalysis, calculateTrendMonthlyReturns, calculateSuccessRate, getTrendAnnualReturnsChartData } from './trend.ts';

const close = (actual, expected, digits = 9) =>
  assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} is not ≈ ${expected}`);

// Month-end rows of one asset "X", starting Jan 2020
const rows = prices => prices.map((p, i) => ({ date: new Date(Date.UTC(2020, i + 1, 0)).toISOString().slice(0, 10), X: p }));
const run = (prices, rf = 0, fee = 0) => {
  const r = rows(prices);
  return trendFollowingAnalysis(r, 'X', r[0].date, r[r.length - 1].date, rf, fee);
};

test('fewer than 12 months of prices: no analysis', () => {
  assert.equal(run([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), null);
});

test('a steady rise stays invested, so the strategy matches Buy & Hold', () => {
  const a = run(Array.from({ length: 24 }, (_, i) => 100 + i * 5));
  assert.equal(a.signalChanges.length, 1);                 // just the opening BUY
  assert.equal(a.chartData[0].buyHoldValue, 1);            // both start at $1
  close(a.chartData.at(-1).trendFollowingValue, a.chartData.at(-1).buyHoldValue);
  close(a.chartData.at(-1).buyHoldValue, 215 / 145);       // price went 145 → 215 from month 10
});

test('below the moving average it sits in cash, earning the cash rate, and pays commission to switch', () => {
  // 10 months rising, then a crash: the first crash month turns the signal to SELL
  const prices = [100, 101, 102, 103, 104, 105, 106, 107, 108, 120, 60, 59, 58];
  const a = run(prices, 0.12, 0.01);
  assert.equal(a.chartData[1].signal, 'SELL');
  // Month 11: still invested during the crash (the signal acts from next month), then pays 1%
  close(a.chartData[1].trendFollowingValue, (60 / 120) * 0.99);
  // Month 12: in cash, earning 12% a year compounded monthly
  close(a.chartData[2].trendFollowingValue, (60 / 120) * 0.99 * Math.pow(1.12, 1 / 12));
  close(a.chartData[2].buyHoldValue, 59 / 120);
});

test('success rate counts round-trips that bought back cheaper', () => {
  const s = calculateSuccessRate([
    { date: 'a', newSignal: 'BUY', price: 10, value: 1 },
    { date: 'b', newSignal: 'SELL', price: 12, value: 1 },
    { date: 'c', newSignal: 'BUY', price: 11, value: 1 },   // bought back cheaper: success
    { date: 'd', newSignal: 'SELL', price: 11, value: 1 },
    { date: 'e', newSignal: 'BUY', price: 13, value: 1 },   // dearer: not a success
  ]);
  assert.deepEqual(s, { rate: 50, successful: 1, total: 2 });
});

test('monthly table skips a start year that begins in December', () => {
  const pts = [
    { date: '2020-12-31', price: 1, buyHoldValue: 1, trendFollowingValue: 1, sma10: 1, signal: 'BUY' },
    { date: '2021-01-31', price: 1, buyHoldValue: 1.1, trendFollowingValue: 1.05, sma10: 1, signal: 'BUY' },
  ];
  const m = calculateTrendMonthlyReturns(pts, '2020-12-31');
  assert.deepEqual(Object.keys(m), ['2021']);
  close(m['2021'].buyHold[0], 10);
  close(m['2021'].trendFollowingFY, 5);
  assert.deepEqual(getTrendAnnualReturnsChartData(m).map(r => r.year), ['2021']);
});
