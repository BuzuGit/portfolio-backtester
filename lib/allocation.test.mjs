// Tests for lib/allocation.ts. Run with `npm test`.
// The three days below are copied from the real Daily sheet; each must add up to that day's own
// "Net Worth PLN" column, which is the proof that the bucket list is complete and counts nothing twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyAllocation, sharesPct, riskOnPct, plnTo, ALLOC_CLASSES } from './allocation.ts';

const near = (actual, expected, tolPct, what) =>
  assert.ok(Math.abs(actual / expected - 1) * 100 <= tolPct, `${what}: ${actual} vs ${expected}`);

const day = (date, b, usdPln, sgdPln, chfPln) => ({ date, buckets: b, usdPln, sgdPln, chfPln });

const first = day('2019-12-16', {
  'PLN Cash': 14935, 'PLN FI': 100000, 'PLN RE': 180050, 'PLN EQ': 95000, 'Gold': 32623, 'Skandia': 8840,
  'SGD Cash': 80351, 'SGD FI': 36645, 'SGD EQ': 18554, 'USD Cash': 174, 'USD FI': 15755, 'USD EQ': 5764, 'CHF EQ': 6199,
}, 3.8225, 2.8195, 3.8877);                                         // Net Worth PLN 920,659
// 2022-10-20: USD EQ 122,517 is ALSO split into DM 54,748 + Mom 52,736 + EM 15,034 in the sheet.
// Those parts are not in the bucket list, so passing them in must change nothing.
const midSplit = day('2022-10-20', {
  'PLN Cash': 14113, 'PLN FI': 113740, 'PLN RE': 282474, 'PLN EQ': 260204, 'Gold': 107261, 'Crypto': 52753,
  'SGD Cash': 90114, 'SGD FI': 37312, 'SGD EQ': 68636, 'SGD Stash': 22265,
  'USD Cash': 38, 'USD EQ': 122517, 'USD DM': 54748, 'USD Mom': 52736, 'USD EM': 15034, 'CHF EQ': 18593,
}, 4.8835, 3.4271, 4.8638);                                         // Net Worth PLN 2,267,693
const latest = day('2026-11-20', {
  'PLN Cash': 2308, 'PLN FI': 735349, 'PLN RE': 494018, 'Gold': 308630, 'Crypto': 227717,
  'SGD Cash': 30289, 'SGD FI': 130711, 'SGD EQ': 187542, 'USD Cash': 50222, 'USD FI': 83913, 'Alt': 335010, 'USD EQ': 198981,
}, 4.0458, 3.1316, 4.7933);                                         // Net Worth PLN 5,562,610

test('buckets add up to the sheet\'s own net worth on real days', () => {
  const [a, b, c] = dailyAllocation([first, midSplit, latest]);
  near(a.totalPln, 920659, 0.01, '2019-12-16');
  near(b.totalPln, 2267693, 0.01, '2022-10-20 (USD EQ sub-split must not be added)');
  near(c.totalPln, 5562610, 0.01, '2026-11-20');
});

test('class and currency views each split the whole total', () => {
  for (const p of dailyAllocation([first, midSplit, latest])) {
    const cls = Object.values(sharesPct(p.byClass, p.totalPln)).reduce((s, v) => s + v, 0);
    const ccy = Object.values(sharesPct(p.byCurrency, p.totalPln)).reduce((s, v) => s + v, 0);
    near(cls, 100, 1e-9, `${p.date} classes`);
    near(ccy, 100, 1e-9, `${p.date} currencies`);
    assert.equal(Object.keys(p.byClass).length, ALLOC_CLASSES.length);
  }
});

test('today\'s mix and the risk-on share (Equities + Metals & Crypto)', () => {
  const [p] = dailyAllocation([latest]);
  const s = sharesPct(p.byClass, p.totalPln);
  near(s['Equities'], 25.03, 0.1, 'Equities');
  near(s['Alternatives'], 24.37, 0.1, 'Alternatives');
  near(s['Metals & Crypto'], 9.64, 0.1, 'M&C');
  near(riskOnPct(p), s['Equities'] + s['Metals & Crypto'], 1e-9, 'risk-on');
  // Gold and crypto are their own band in the currency view, not zloty
  near(p.byCurrency['M&C'], 308630 + 227717, 1e-9, 'M&C band');
  near(p.byCurrency['PLN'], 2308 + 735349 + 494018, 1e-9, 'PLN band');
});

test('a day with money in a currency whose rate is blank is skipped, not distorted', () => {
  const noUsdRate = day('2020-01-01', { 'PLN FI': 100, 'USD EQ': 100 }, 0, 3, 4);
  const onlyPln = day('2020-01-02', { 'PLN FI': 100 }, 0, 0, 0);   // no foreign money: rates not needed
  const empty = day('2020-01-03', {}, 4, 3, 4);
  const out = dailyAllocation([noUsdRate, onlyPln, empty]);
  assert.deepEqual(out.map(p => p.date), ['2020-01-02']);
});

test('amounts convert at the day\'s own rate', () => {
  const [p] = dailyAllocation([latest]);
  near(plnTo(p, 4045.8, 'USD'), 1000, 1e-9, 'USD');
  assert.equal(plnTo(p, 100, 'PLN'), 100);
  assert.equal(plnTo({ ...p, chfPln: 0 }, 100, 'CHF'), null);
});
