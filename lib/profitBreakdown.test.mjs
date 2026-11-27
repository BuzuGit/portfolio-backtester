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

test('profit breakdown: a TR ticker is marked with its plain price, so dividends count once', () => {
  // XTR is a total-return series: back-adjusted, so it starts lower (95) than the plain X (100).
  // Marking with XTR AND adding the 7 of dividends would count those dividends twice.
  const trData = [
    { date: '2022-06-30', X: 80, XTR: 76 },
    { date: '2022-12-31', X: 100, XTR: 95 },
    { date: '2023-12-31', X: 110, XTR: 110 },
  ];
  const b = getYearlyProfitBreakdown({
    ...inputsFor({}), assetData: trData, assetLookup: [{ ticker: 'XTR', name: 'Asset X TR' }],
    transactionData: [{ ticker: 'XTR', flow: 'Purchase of Asset', date: '2022-06-15', qty: 10, amount: 800 }],
    getOpenPurchases: t => (t === 'XTR' ? [{ ticker: 'XTR', flow: 'Purchase of Asset', date: '2022-06-15', qty: 10, amount: 800 }] : []),
    getOpenDividends: t => (t === 'XTR' ? [{ ticker: 'XTR', date: '2023-05-01', amount: 7 }] : []),
  }, 2023, 'PLN');
  const held = seg(b.assets[0], 'Held from start');
  close(held.startPrice, 100);                 // the plain price, not the TR 95
  close(held.profitNative, 100);               // 10 × (110 − 100)
  close(b.assets[0].totalNative, 107);         // + 7 of dividends, counted once
});

test('profit breakdown: "Other" is split into named parts that add up to it exactly', () => {
  const ledgerRows = [
    // A bond with no price column: valued at what was paid, so only FX and its coupon move it
    { date: '2022-06-01', flow: 'Purchase of Asset', currency: 'USD', qty: 10, amount: 1000, asset: 'Bond B', ticker: 'BB', from: 'IBKR', account: 'IB ETF' },
    { date: '2023-03-01', flow: 'Interest', currency: 'USD', qty: 1, amount: 3, asset: 'Bond B', ticker: 'BB', from: 'IB ETF', account: 'IBKR' },
    // X has its own asset row, so its ledger rows must NOT be counted again here
    { date: '2022-06-15', flow: 'Purchase of Asset', currency: 'PLN', qty: 10, amount: 800, asset: 'Asset X', ticker: 'X', from: 'IBKR', account: 'IB ETF' },
  ];
  const cashAccounts = [
    // 100 USD held all year, plus 2 USD of bank interest: 102 × 5 − 100 × 4 = 110 PLN
    { account: 'IBKR', currency: 'USD', movements: [
      { date: '2022-11-01', flow: 'Inflow', direction: 'in', amount: 100, asset: 'Cash', balance: 100 },
      { date: '2023-03-15', flow: 'Interest', direction: 'in', amount: 2, asset: 'Cash', balance: 102 },
    ] },
    // An SRS account counts at 73%: 10 USD held all year → 10 × (5 − 4) × 0.73
    { account: 'DBS SRS P', currency: 'USD', movements: [
      { date: '2022-01-01', flow: 'Inflow', direction: 'in', amount: 10, asset: 'Cash', balance: 10 },
    ] },
  ];
  // The Years sheet closed 2022 at 1,300, but the Daily sheet had 1,320 that day: 20 of the
  // year's profit is that gap, not anything a holding earned
  const twoYears = [{ ...yearsData[0], date: '2022', endAmount: 1300 }, yearsData[0]];
  const dailyData = [{ date: '2022-12-31', nwPln: 1320 }, { date: '2023-12-31', nwPln: 1500 }];

  const b = getYearlyProfitBreakdown({
    ...inputsFor({ open: [buy('2022-06-15', 10, 800)] }),
    yearsData: twoYears, cashAccounts, ledgerRows, dailyData,
  }, 2023, 'PLN');
  const part = label => {
    const p = b.otherParts.find(x => x.label === label);
    assert.ok(p, `no "${label}" part; got ${b.otherParts.map(x => x.label).join(', ')}`);
    return p;
  };

  const usd = part('Cash (USD)');
  close(usd.amount, 110 + 10 * 0.73);
  close(usd.fx, 110 - 2 * 4 + 10 * 0.73);        // all of it but the interest is the dollar's rise
  assert.equal(usd.detail, 'IBKR, DBS SRS P');

  const bond = part('Holdings not in the price feed (USD)');
  close(bond.amount, 1000 * 5 - 1000 * 4 + 3 * 4.5);   // coupon converted in its own month
  assert.equal(bond.detail, 'Bond B');                 // not Asset X: that one has its own row

  close(part('Years sheet differs from Daily sheet').amount, 20);

  assert.equal(b.otherParts[b.otherParts.length - 1].label, 'Unexplained');
  close(b.otherParts.reduce((s, p) => s + p.amount, 0), b.other);   // always adds up exactly
});

test('profit breakdown: a guarded lot held all year is valued once, from its price column', () => {
  // Paid 1,000 when the feed said 80 (like the flat: gross price vs net-equity column), so it
  // gets no asset row. Held all year, the feed values it: 1 × (110 − 100) = 10. Its ledger row
  // must not ALSO be valued at cost under "Holdings not in the price feed".
  const ledgerRows = [{ date: '2022-06-20', flow: 'Purchase of Asset', currency: 'USD', qty: 1, amount: 1000, asset: 'Asset X', ticker: 'X', from: 'Other', account: 'Other' }];
  const b = getYearlyProfitBreakdown({
    ...inputsFor({ open: [buy('2022-06-20', 1, 1000)], currency: 'USD' }), ledgerRows,
  }, 2023, 'PLN');
  assert.equal(b.assets.length, 0);
  const held = b.otherParts.find(p => p.label === 'Held all year (no usable buy price)');
  close(held.amount, 110 * 5 - 100 * 4);             // valued in PLN at each year end's rate
  assert.equal(b.otherParts.some(p => p.label.startsWith('Holdings not in the price feed')), false);
});

test('profit breakdown: asset rows bought with SRS money are scaled to 73%, like net worth', () => {
  const srsBuy = { ...buy('2022-06-15', 10, 800), fundedFrom: 'DBS SRS P', account: 'DBS Vickers SRS' };
  const b = getYearlyProfitBreakdown({
    ...inputsFor({ open: [srsBuy] }), transactionData: [srsBuy],
  }, 2023, 'PLN');
  const srs = b.otherParts.find(p => p.label === 'SRS valued at 73%');
  close(srs.amount, -0.27 * b.assets[0].totalConverted);   // 27% of the row never reached net worth
  assert.equal(srs.detail, 'X');
});

test('profit breakdown: without the extra inputs, "Other" is one Unexplained part (or none if it is 0)', () => {
  // Nothing itemised: the year's whole 100 is unexplained
  const b = getYearlyProfitBreakdown(inputsFor({}), 2023, 'PLN');
  assert.equal(b.otherParts.length, 1);
  assert.equal(b.otherParts[0].label, 'Unexplained');
  close(b.otherParts[0].amount, b.other);
  // The asset explains the whole year (10 × (110 − 100) = 100): no "Unexplained 0" line
  const full = getYearlyProfitBreakdown(inputsFor({ open: [buy('2022-06-15', 10, 800)] }), 2023, 'PLN');
  close(full.other, 0);
  assert.equal(full.otherParts.length, 0);
});
