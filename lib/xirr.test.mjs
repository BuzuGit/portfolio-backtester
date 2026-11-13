// Tests for lib/xirr.ts. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateXIRR } from './xirr.ts';

const close = (actual, expected, digits = 4) =>
  assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} is not ≈ ${expected}`);
const d = s => new Date(`${s}T00:00:00Z`);

test('one buy and one sale two years apart: the steady annual rate', () => {
  // 100 → 121 over exactly two years (730.5 days) is 10% a year
  const start = d('2020-01-01');
  const end = new Date(start.getTime() + 2 * 365.25 * 86400000);
  close(calculateXIRR([{ date: start, amount: -100 }, { date: end, amount: 121 }]), 10);
});

test('several buys and a final value are weighted by how long each was invested', () => {
  const r = calculateXIRR([
    { date: d('2020-01-01'), amount: -1000 },
    { date: d('2021-01-01'), amount: -1000 },
    { date: d('2022-01-01'), amount: 2300 },
  ]);
  // 1,000·(1+r)² + 1,000·(1+r) = 2,300 gives r ≈ 9.7% (a touch lower here: 2020 had 366 days).
  // The second 1,000 was invested for one year only, so it is NOT 15% (2,300 vs 2,000 over 2 years).
  assert.ok(r > 9.5 && r < 9.8, `got ${r}`);
});

test('held under a year: the plain total return, not annualised', () => {
  // −5.8% over ten weeks stays −5.8% (annualised it would look like about −27% a year)
  close(calculateXIRR([{ date: d('2024-01-01'), amount: -1000 }, { date: d('2024-03-11'), amount: 942 }]), -5.8);
  // dividends count as money coming back
  close(calculateXIRR([
    { date: d('2024-01-01'), amount: -100 }, { date: d('2024-06-01'), amount: 2 }, { date: d('2024-09-01'), amount: 103 },
  ]), 5);
});

test('not enough cash flows: no answer', () => {
  assert.equal(calculateXIRR([]), null);
  assert.equal(calculateXIRR([{ date: d('2020-01-01'), amount: -100 }]), null);
});
