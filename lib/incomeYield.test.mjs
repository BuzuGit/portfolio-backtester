// Tests for lib/incomeYield.ts. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentYields } from './incomeYield.ts';

const row = (date, flow, qty, price, amount, ticker = 'REIT', currency = 'SGD') =>
  ({ date, flow, qty, price, amount, ticker, currency, commission: 0, commissionBps: 0, costBasis: 0, asset: ticker, account: 'IB', from: 'IB', remarks: '' });
const same = (_t, amount) => amount;   // every amount already in the asset's currency
const close = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);

test('market yield = payment / (shares x prior month-end price); on cost uses average cost', () => {
  const rows = [
    row('2024-01-10', 'Purchase of Asset', 1000, 1.0, 1000),
    row('2024-02-10', 'Purchase of Asset', 1000, 0.8, 800),    // a top-up at a lower price
    row('2024-03-05', 'Dividend', 2000, 0.012, 24),            // 1.2c per unit on 2,000 units
  ];
  const prices = { '2024-02': 0.9 };
  const [p] = paymentYields(rows, (_t, ym) => (ym === '2024-03' ? prices['2024-02'] : null), same);
  close(p.marketPct, (24 / (2000 * 0.9)) * 100, 'market');     // 1.333%
  close(p.onCostPct, (24 / 1800) * 100, 'on cost');            // average cost 0.90 -> 1.333%
});

test('a sale leaves the average cost alone; a placeholder quantity falls back to shares held', () => {
  const rows = [
    row('2024-01-10', 'Purchase of Asset', 1, 300000, 300000, 'FLAT', 'PLN'),   // one flat
    row('2024-06-05', 'Dividend', 15000, 1, 15000, 'FLAT', 'PLN'),              // rent: qty = amount at price 1
    row('2025-01-10', 'Purchase of Asset', 100, 10, 1000),
    row('2025-02-10', 'Purchase of Asset', 100, 20, 2000),
    row('2025-03-10', 'Proceeds from Sale', 100, 25, 2500),
    row('2025-04-10', 'Dividend', 100, 0.3, 30),
  ];
  const out = paymentYields(rows, t => (t === 'FLAT' ? 500000 : 30), same);
  close(out[0].marketPct, (15000 / 500000) * 100, 'rent vs value');   // 3%, not 15000 / (15000 x price)
  close(out[0].onCostPct, 5, 'rent on cost');                          // 15,000 / 300,000
  close(out[1].onCostPct, (30 / (100 * 15)) * 100, 'on cost after sale');   // avg cost stays 15
});

test('no price before the payment = no market yield (on cost still works)', () => {
  const rows = [row('2024-01-10', 'Purchase of Asset', 10, 5, 50), row('2024-01-20', 'Dividend', 10, 0.1, 1)];
  const [p] = paymentYields(rows, () => null, same);
  assert.equal(p.marketPct, null);
  close(p.onCostPct, 2, 'on cost');
});
