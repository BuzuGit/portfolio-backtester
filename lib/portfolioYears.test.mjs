// Tests for lib/portfolioYears.ts and the reconciliation rule of lib/profitBreakdown.ts. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getYearlyValueSeries } from './portfolioYears.ts';
import { getYearlyProfitBreakdown } from './profitBreakdown.ts';

const close = (actual, expected, digits = 6) =>
  assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} is not ≈ ${expected}`);

// Two years of the Years sheet (values in PLN, with USD rates)
const row = (date, startAmount, endAmount, contributions, startUsd, avgUsd, endUsd) => ({
  date, contributions, profit: endAmount - startAmount - contributions, contrCumulative: 0, profitCumulative: 0,
  endAmount, startAmount, startUsdPln: startUsd, startSgdPln: 3, startEurPln: 4.3, startChfPln: 4.5,
  avgUsdPln: avgUsd, endUsdPln: endUsd, avgEurPln: 4.3, endEurPln: 4.3, avgChfPln: 4.5, endChfPln: 4.5,
  avgSgdPln: 3, endSgdPln: 3, returnPln: 0, returnUsd: 0, returnSgd: 0,
});
const years = [row('2022', 1000, 1300, 200, 4, 4, 4), row('2023', 1300, 1500, 100, 4, 4.5, 5)];

test('in PLN the yearly figures are the sheet\'s own numbers', () => {
  const s = getYearlyValueSeries(years, 'PLN');
  assert.deepEqual(s.map(r => r.year), ['2022', '2023']);
  close(s[0].profit, 100);            // 1,300 − 1,000 − 200
  close(s[1].startValue, 1300);       // each year starts where the last one ended
  close(s[1].profit, 100);            // 1,500 − 1,300 − 100
});

test('in another currency, values use year-end rates, contributions the average, profit is the rest', () => {
  const s = getYearlyValueSeries(years, 'USD');
  close(s[1].endValue, 1500 / 5);
  close(s[1].startValue, 1300 / 4);   // last year's end, at last year's end rate
  close(s[1].contributions, 100 / 4.5);
  close(s[1].profit, 1500 / 5 - 1300 / 4 - 100 / 4.5);
  // growth always equals contributions + profit
  close(s[1].endValue - s[1].startValue, s[1].contributions + s[1].profit);
});

test('profit breakdown: with nothing to itemise, "Other" carries the whole year and the table reconciles', () => {
  const inputs = {
    assetData: [{ date: '2023-12-31' }], assetLookup: [], yearsData: years, closedData: [], transactionData: [],
    getOpenPurchases: () => [], getOpenDividends: () => [], getAssetCurrency: () => 'PLN',
  };
  const b = getYearlyProfitBreakdown(inputs, 2023, 'PLN');
  assert.equal(b.assets.length, 0);
  close(b.total, 100);
  close(b.other, 100);
  // no data at all: an empty table, not an error
  assert.deepEqual(getYearlyProfitBreakdown({ ...inputs, assetData: [] }, 2023, 'PLN'), { assets: [], other: 0, total: 0 });
});
