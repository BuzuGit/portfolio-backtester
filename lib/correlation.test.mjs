// Tests for lib/correlation.ts. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pearsonCorrelation, getPairedMonthlyReturns, getRollingCorrelationData, correlationMatrix } from './correlation.ts';

const close = (actual, expected, digits = 9) =>
  assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} is not ≈ ${expected}`);
const monthEnd = i => new Date(Date.UTC(2020, i + 1, 0)).toISOString().slice(0, 10);

test('Pearson: lockstep is +1, mirror image is -1, size does not matter', () => {
  close(pearsonCorrelation([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  close(pearsonCorrelation([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.equal(pearsonCorrelation([1, 2], [1, 2]), null);          // too few points
  assert.equal(pearsonCorrelation([1, 2, 3], [5, 5, 5]), null);    // a flat series has nothing to correlate
});

test('pairing joins by month, so a missing month is dropped rather than shifting the series', () => {
  const a = { returns: [100, 110, 99, 120].map((value, i) => ({ date: monthEnd(i), value, drawdown: 0 })) };
  const b = { returns: [100, 105, 120].map((value, i) => ({ date: monthEnd([0, 1, 3][i]), value, drawdown: 0 })) };
  const paired = getPairedMonthlyReturns(a, b);
  // Returns start in each series' second month. B has no March price, so its April return spans
  // Feb→Apr, and A's March return has no partner: it is dropped, not paired with B's April.
  assert.deepEqual(paired.map(p => p.ym), ['2020-02', '2020-04']);
  close(paired[1].b, 120 / 105 - 1);
});

test('rolling correlation: one point per window, labelled by the month it ends', () => {
  const paired = [0.01, 0.02, -0.01, 0.03, 0.00].map((r, i) => ({ ym: '', date: monthEnd(i), a: r, b: r * 2 }));
  const roll = getRollingCorrelationData(paired, 3);
  assert.equal(roll.length, 3);
  assert.equal(roll[0].label, 'Mar 20');
  assert.equal(roll[0].range, 'Jan 20 to Mar 20');
  assert.equal(roll[0].corr, 1);
});

test('the matrix is symmetric with 1 on the diagonal, and uses the last N years only', () => {
  // A and C have mirror-image monthly returns; B wobbles; D has no price for 20 months, then is flat
  const swings = Array.from({ length: 30 }, (_, i) => [0.03, -0.02, 0.01, -0.04, 0.05][i % 5]);
  let a = 100, c = 100;
  const data = swings.map((s, i) => {
    a *= 1 + s; c *= 1 - s;
    return { date: monthEnd(i), A: a, B: 100 + (i % 3) * 7, C: c, D: i < 20 ? 0 : 50 };
  });
  const { tickers, matrix } = correlationMatrix(data, ['A', 'B', 'C', 'D'], 1);
  assert.deepEqual(tickers, ['A', 'B', 'C', 'D']);
  for (let i = 0; i < 4; i++) {
    assert.equal(matrix[i][i], 1);
    for (let j = 0; j < 4; j++) assert.ok(Object.is(matrix[i][j], matrix[j][i]));
  }
  assert.ok(matrix[0][2] < -0.99);                  // A rises as C falls
  assert.ok(matrix[0][3] === 0);                    // D is flat for the months it has: shown as 0
  assert.deepEqual(correlationMatrix(data, [], 1), { tickers: [], matrix: [] });
});
