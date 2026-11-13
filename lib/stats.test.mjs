// Tests for lib/stats.ts. Run with `npm test` (the publish script runs them before every publish).
// Node 22.18+ reads the .ts file directly by stripping its type labels, so there is no build step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  yearsBetween, isAnnualisable, totalReturnPct, cagrPct, periodReturns,
  annualisedVolPct, sharpeRatio, drawdownsPct, maxDrawdownPct, longestUnderwater,
} from './stats.ts';

const close = (actual, expected, digits = 9) =>
  assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} is not ≈ ${expected}`);

test('a one-year window counts as a full year, even at 365 days or a few days short', () => {
  assert.equal(isAnnualisable(yearsBetween('2025-01-31', '2026-01-31')), true);  // 365 days
  assert.equal(isAnnualisable(yearsBetween('2025-01-31', '2026-01-30')), true);  // last trading day
  assert.equal(isAnnualisable(yearsBetween('2025-01-31', '2025-12-31')), false); // 11 months
});

test('CAGR annualises a multi-year period', () => {
  close(cagrPct(100, 121, 2), 10);          // 100 → 121 over 2 years is 10% a year
  close(cagrPct(100, 100, 5), 0);
});

test('CAGR never annualises under a year: it returns the plain total return', () => {
  close(cagrPct(100, 103, 2 / 12), 3);      // NOT ~19.4% "a year"
  close(cagrPct(100, 97, 0.5), -3);
  close(totalReturnPct(100, 112), 12);
});

test('period returns skip steps that start from zero', () => {
  assert.deepEqual(periodReturns([100, 110, 0, 50]), [0.1, -1]);
});

test('volatility is the annualised population standard deviation', () => {
  // Returns of +1% and -1%: standard deviation 1%, times √12 for monthly data.
  close(annualisedVolPct([0.01, -0.01], 12), Math.sqrt(12));
  assert.equal(annualisedVolPct([], 12), 0);
});

test('Sharpe is a dash under a year and subtracts the risk-free rate when given', () => {
  assert.equal(sharpeRatio(10, 20, 0.5), null);
  close(sharpeRatio(10, 20, 3), 0.5);
  close(sharpeRatio(10, 20, 3, 2), 0.4);    // (10 − 2) / 20
  assert.equal(sharpeRatio(10, 0, 3), 0);
});

test('drawdowns, the deepest one, and the longest time underwater', () => {
  const dd = drawdownsPct([100, 120, 90, 108, 130, 117]);
  assert.deepEqual(dd.map(d => Math.round(d)), [0, 0, -25, -10, 0, -10]);
  close(maxDrawdownPct(dd), -25);
  assert.equal(longestUnderwater(dd), 2);
  assert.equal(longestUnderwater([0, -1, -1, -1]), 3);   // an unfinished run counts
  assert.equal(maxDrawdownPct([0, 0]), 0);
});
