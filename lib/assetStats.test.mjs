// Tests for lib/assetStats.ts, on a small made-up price table. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getYearsWithData, getAssetPriceRange, calculateCAGR, calculateAssetStats, getAssetCurrentDrawdown } from './assetStats.ts';

const close = (actual, expected, digits = 9) =>
  assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} is not ≈ ${expected}`);
const monthEnd = i => new Date(Date.UTC(2020, i + 1, 0)).toISOString().slice(0, 10);
// X: no price for two months, then 100, 120, 90, 110; Y: never priced
const rows = [0, 0, 100, 120, 90, 110].map((x, i) => ({ date: monthEnd(i), X: x, Y: 0 }));

test('the price range skips months without a price and counts the months between', () => {
  assert.deepEqual(getAssetPriceRange(rows, 'X'),
    { firstDate: '2020-03-31', firstPrice: 100, lastDate: '2020-06-30', lastPrice: 110, months: 3 });
  assert.equal(getAssetPriceRange(rows, 'Y'), null);
});

test('CAGR over months: under a year it is the plain return', () => {
  close(calculateCAGR(100, 110, 3), 10);
  close(calculateCAGR(100, 121, 24), 10);
  assert.equal(calculateCAGR(0, 110, 12), 0);
});

test('asset stats: drawdown and longest time underwater, within a date window', () => {
  const s = calculateAssetStats(rows, 'X');
  close(s.maxDrawdown, -25);            // 120 → 90
  assert.equal(s.longestDDMonths, 2);   // 90 and 110 are both below 120
  assert.ok(s.volatility > 0);
  assert.equal(calculateAssetStats(rows, 'X', '2020-06-01'), null);   // one price is not enough
});

test('current drawdown from the all-time high', () => {
  const d = getAssetCurrentDrawdown(rows, 'X');
  close(d.drawdown, (110 - 120) / 120 * 100);
  assert.equal(d.athDate, '2020-04-30');
  assert.equal(d.isAtATH, false);
});

test('years with data, oldest first', () => {
  assert.deepEqual(getYearsWithData({ A: { 2021: {}, 2019: {} }, B: { 2020: {} } }), [2019, 2020, 2021]);
});
