/*
  ASSET ALLOCATION OVER TIME (from the Daily sheet)

  The Daily sheet keeps, for every day, how much money sits in each "bucket" (PLN Cash, USD EQ,
  Gold...), each in its own currency. This file turns those buckets into the share of net worth
  held in each asset class (or each currency) on each day — the numbers behind the Portfolio
  tab's "Asset Allocation" chart.

  Think of it as sorting the contents of every account into a handful of jars, converting every
  jar to zloty at that day's exchange rate, and asking what fraction of the total each jar holds.
  Percentages come out the same whatever currency you convert to, because every jar is converted
  at the same rate on the same day; the chosen currency only matters for the amounts shown.

  Checked on 2026-11-20 against the sheet's own "Net Worth PLN": the buckets below add up to it
  on all 1,790 days to within 0.001%.

  TRAP: "USD DM", "USD Mom" and "USD EM" are NOT listed here on purpose. They split "USD EQ" into
  its parts (they add up to it), so counting them as well would count that money twice — up to
  26% too much net worth in 2021-22.
*/

// The classes, in the order they are stacked from the bottom of the chart up. Equities and
// Metals & Crypto go first so the top edge of the M&C band IS the risk-on line.
export const ALLOC_CLASSES = [
  'Equities', 'Metals & Crypto', 'Alternatives', 'Real estate', 'Multi-asset', 'Fixed Income', 'Cash',
] as const;
export type AllocClass = typeof ALLOC_CLASSES[number];

// The user's definition of "risk-on" (chosen 2026-11-20): equities plus metals & crypto.
// Alternatives are deliberately left out.
export const RISK_ON_CLASSES: readonly AllocClass[] = ['Equities', 'Metals & Crypto'];

// The currency view. Gold and crypto get their own band rather than counting as zloty (their
// sheet columns sit in the PLN group), the same way the Positions tab's by-currency chart does.
export const ALLOC_CURRENCIES = ['PLN', 'USD', 'SGD', 'CHF', 'M&C'] as const;
export type AllocCurrency = typeof ALLOC_CURRENCIES[number];

// Every bucket column of the Daily sheet: the currency its amount is written in, the class it
// counts as, and the band it goes to in the currency view.
export interface DailyBucket { col: string; ccy: 'PLN' | 'USD' | 'SGD' | 'CHF'; cls: AllocClass; band: AllocCurrency }
export const DAILY_BUCKETS: readonly DailyBucket[] = [
  { col: 'PLN Cash',  ccy: 'PLN', cls: 'Cash',            band: 'PLN' },
  { col: 'PLN FI',    ccy: 'PLN', cls: 'Fixed Income',    band: 'PLN' },
  { col: 'PLN RE',    ccy: 'PLN', cls: 'Real estate',     band: 'PLN' },
  { col: 'PLN EQ',    ccy: 'PLN', cls: 'Equities',        band: 'PLN' },
  { col: 'Gold',      ccy: 'PLN', cls: 'Metals & Crypto', band: 'M&C' },
  { col: 'Crypto',    ccy: 'PLN', cls: 'Metals & Crypto', band: 'M&C' },
  { col: 'Skandia',   ccy: 'PLN', cls: 'Multi-asset',     band: 'PLN' },  // held Dec 2019 – Jun 2022
  { col: 'SGD Cash',  ccy: 'SGD', cls: 'Cash',            band: 'SGD' },
  { col: 'SGD FI',    ccy: 'SGD', cls: 'Fixed Income',    band: 'SGD' },
  { col: 'SGD EQ',    ccy: 'SGD', cls: 'Equities',        band: 'SGD' },
  { col: 'SGD Stash', ccy: 'SGD', cls: 'Multi-asset',     band: 'SGD' },  // StashAway, Jul 2021 – Dec 2024
  { col: 'USD Cash',  ccy: 'USD', cls: 'Cash',            band: 'USD' },
  { col: 'USD FI',    ccy: 'USD', cls: 'Fixed Income',    band: 'USD' },
  { col: 'Alt',       ccy: 'USD', cls: 'Alternatives',    band: 'USD' },
  { col: 'USD EQ',    ccy: 'USD', cls: 'Equities',        band: 'USD' },
  { col: 'CHF EQ',    ccy: 'CHF', cls: 'Equities',        band: 'CHF' },  // held until Feb 2023
];

// What the sheet reader keeps for each day: the bucket amounts (column name -> amount in that
// bucket's own currency) and the three zloty exchange rates. 0 = blank in the sheet.
export interface DailyAllocInput {
  date: string;
  buckets: Record<string, number>;
  usdPln: number;
  sgdPln: number;
  chfPln: number;
}

// One day of the chart. Amounts are in PLN; the rates come along so the tooltip can show them in
// another currency.
export interface AllocPoint {
  date: string;
  totalPln: number;
  byClass: Record<AllocClass, number>;
  byCurrency: Record<AllocCurrency, number>;
  usdPln: number;
  sgdPln: number;
  chfPln: number;
}

const zeroes = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map(k => [k, 0])) as Record<K, number>;

/**
 * Sort each day's buckets into classes and currency bands, in PLN. A day is skipped when the
 * total is not positive, or when it holds money in a currency whose rate is blank that day —
 * leaving that money out would make every other class look bigger than it was.
 */
export function dailyAllocation(rows: readonly DailyAllocInput[]): AllocPoint[] {
  const out: AllocPoint[] = [];
  for (const r of rows) {
    const rate = { PLN: 1, USD: r.usdPln, SGD: r.sgdPln, CHF: r.chfPln };
    const byClass = zeroes(ALLOC_CLASSES);
    const byCurrency = zeroes(ALLOC_CURRENCIES);
    let total = 0;
    let missingRate = false;
    for (const b of DAILY_BUCKETS) {
      const amount = r.buckets[b.col] || 0;
      if (amount === 0) continue;
      if (!(rate[b.ccy] > 0)) { missingRate = true; break; }
      const pln = amount * rate[b.ccy];
      byClass[b.cls] += pln;
      byCurrency[b.band] += pln;
      total += pln;
    }
    if (missingRate || !(total > 0)) continue;
    out.push({ date: r.date, totalPln: total, byClass, byCurrency, usdPln: r.usdPln, sgdPln: r.sgdPln, chfPln: r.chfPln });
  }
  return out;
}

/** Each part as a % of the whole (the parts of one day always add up to 100). */
export function sharesPct<K extends string>(parts: Record<K, number>, total: number): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of Object.keys(parts) as K[]) out[k] = total > 0 ? (parts[k] / total) * 100 : 0;
  return out;
}

/** The share of the day's net worth in the risk-on classes, in %. */
export const riskOnPct = (p: AllocPoint): number =>
  p.totalPln > 0 ? (RISK_ON_CLASSES.reduce((s, c) => s + p.byClass[c], 0) / p.totalPln) * 100 : 0;

/** A PLN amount in another currency at that day's rate (null when the sheet has no rate). */
export function plnTo(p: AllocPoint, pln: number, ccy: 'PLN' | 'USD' | 'SGD' | 'CHF'): number | null {
  if (ccy === 'PLN') return pln;
  const rate = ccy === 'USD' ? p.usdPln : ccy === 'SGD' ? p.sgdPln : p.chfPln;
  return rate > 0 ? pln / rate : null;
}
