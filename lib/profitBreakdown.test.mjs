// Tests for lib/profitBreakdown.ts with real positions, so every segment of the table is
// itemised and checked by hand. (The empty "everything is Other" case lives in
// lib/portfolioYears.test.mjs.) Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getYearlyProfitBreakdown } from './profitBreakdown.ts';

const close = (actual, expected, digits = 6) =>
  assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} is not ≈ ${expected}`);

// One Years-sheet row for 2023: the portfolio made 100 PLN that year (1,500 − 1,300 − 100)
const yearsData = [{
  date: '2023', contributions: 100, profit: 100, contrCumulative: 0, profitCumulative: 0,
  endAmount: 1500, startAmount: 1300, startUsdPln: 4, startSgdPln: 3, startEurPln: 4.3, startChfPln: 4.5,
  avgUsdPln: 4.5, endUsdPln: 5, avgEurPln: 4.3, endEurPln: 4.3, avgChfPln: 4.5, endChfPln: 4.5,
  avgSgdPln: 3, endSgdPln: 3, returnPln: 0, returnUsd: 0, returnSgd: 0,
}];

// Monthly prices of asset X (and the USD rate, used by the FX test)
const assetData = [
  { date: '2022-06-30', X: 80, USDPLN: 4 },
  { date: '2022-12-31', X: 100, USDPLN: 4 },  // start of 2023
  { date: '2023-03-31', X: 90, USDPLN: 4.5 },
  { date: '2023-12-31', X: 110, USDPLN: 5 },  // end of 2023
];

const buy = (date, qty, amount) => ({ ticker: 'X', flow: 'Purchase of Asset', date, qty, amount });
const closed = (invDate, divDate, sharesSold, initialCost, valueAfterFee) => ({
  ticker: 'X', invDate, divDate, sharesSold, initialCost, valueAfterFee, cumDividend: 0,
});

const inputsFor = ({ open = [], closedLots = [], dividends = [], currency = 'PLN' }) => ({
  assetData, yearsData,
  assetLookup: [{ ticker: 'X', name: 'Asset X' }],
  closedData: closedLots,
  transactionData: [...open, ...closedLots.map(c => buy(c.invDate, c.sharesSold, c.initialCost))],
  getOpenPurchases: t => (t === 'X' ? open : []),
  getOpenDividends: t => (t === 'X' ? dividends : []),
  getAssetCurrency: () => currency,
});

const seg = (asset, label) => {
  const s = asset.segments.find(x => x.label === label);
  assert.ok(s, `no "${label}" segment; got ${asset.segments.map(x => x.label).join(', ')}`);
  return s;
};

test('profit breakdown: each kind of lot lands in its own segment, and "Other" closes the gap', () => {
  const b = getYearlyProfitBreakdown(inputsFor({
    open: [
      buy('2022-06-15', 10, 800),    // held all year: 10 × (110 − 100) = +100
      buy('2023-03-10', 5, 450),     // bought in 2023: 5 × 110 − 450 = +100
    ],
    closedLots: [
      closed('2022-06-01', '2023-03-15', 2, 160, 190),  // held from 1 Jan, sold: 190 − 2 × 100 = −10
      closed('2021-01-01', '2022-09-01', 3, 240, 300),  // sold BEFORE 2023: no part of this year
    ],
    dividends: [{ ticker: 'X', date: '2023-05-01', amount: 7 }, { ticker: 'X', date: '2022-05-01', amount: 99 }],
  }), 2023, 'PLN');

  assert.equal(b.assets.length, 1);
  const x = b.assets[0];
  assert.equal(x.name, 'Asset X');

  const held = seg(x, 'Held from start');
  close(held.shares, 10);
  close(held.startPrice, 100);
  close(held.endPrice, 110);
  close(held.profitNative, 100);
  close(held.retNative, 10);               // 100 on a 1,000 start value

  const bought = seg(x, 'Bought in 2023');
  close(bought.shares, 5);
  close(bought.startPrice, 90);            // the price actually paid, 450 ÷ 5
  close(bought.profitNative, 100);

  const sold = seg(x, 'Held from start · sold');
  close(sold.shares, 2);
  close(sold.profitNative, -10);

  close(seg(x, 'Income (div/interest)').profitNative, 7);   // only the 2023 payment

  close(x.totalNative, 197);
  close(b.total, 100);
  close(b.other, 100 - 197);               // the table always adds up to the year's bar
  close(b.other + b.assets.reduce((s, a) => s + a.totalConverted, 0), b.total);
});

test('profit breakdown: a lot traded on a different price scale is left to "Other"', () => {
  // Paid 1,000 a share when the feed said 80: more than 3× apart, so not marked to market
  const b = getYearlyProfitBreakdown(inputsFor({ open: [buy('2022-06-20', 1, 1000)] }), 2023, 'PLN');
  assert.equal(b.assets.length, 0);
  close(b.other, 100);
});

test('profit breakdown: in another currency, the FX slice is the gap between the two profits', () => {
  // X priced in USD, viewed in PLN: USD/PLN went 4 → 5 over the year
  const b = getYearlyProfitBreakdown(inputsFor({ open: [buy('2022-06-15', 10, 800)], currency: 'USD' }), 2023, 'PLN');
  const held = seg(b.assets[0], 'Held from start');
  close(held.profitNative, 100);                        // $10 × 10 shares
  close(held.profitConverted, 10 * (110 * 5 - 100 * 4)); // 1,500 PLN at each boundary's rate
  close(held.fxEffect, 1500 - 100 * 4);                  // what the dollar's rise added
});
