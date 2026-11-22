// Tests for the Lookup tab parser in lib/fetchData.ts. Run with `npm test`.
// Every column is read by its header name (case, spaces and punctuation ignored), with the usual
// position as a fallback that also raises a warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLookupTable } from './fetchData.ts';

// The real header row (Nov 2026), helper columns included
const REAL_HEADER = 'Ticker,Name,Currency,FX,Asset Class,Asset Subcategory,SnapshotCategory,SnapshotSubCategory,SnapshotSubCategoryOrder,SnapshotCountry,SnapshotCountryOrder,PortfolioClass,,Name #char,,,';
const VWRA = 'VWRA,FTSE All-World,USD,USDPLN,Equities,Basic,Assets,Equities,3,,,,,14,,,';
const GLDM = 'GLDM,GLDM,USD,USDPLN,Alternatives,Oth,"Assets, Metals","Metals, Gold","1, 2",USD,4,Metals & Crypto,,4,,,';

test('Lookup: the real header row reads every field, with no warnings', () => {
  const { lookup, warnings } = parseLookupTable([REAL_HEADER, VWRA, GLDM].join('\n'));
  assert.deepEqual(warnings, []);
  assert.equal(lookup.length, 2);
  const [v, g] = lookup;
  assert.equal(v.ticker, 'VWRA');
  assert.equal(v.name, 'FTSE All-World');   // "Name", not the "Name #char" helper column (14)
  assert.equal(v.currency, 'USD');
  assert.equal(v.fx, 'USDPLN');
  assert.equal(v.assetClass, 'Equities');
  assert.equal(v.assetSubcategory, 'Basic');
  assert.equal(v.portfolioClass, '');
  assert.deepEqual(g.snapshots, [{ category: 'Assets', subcategory: 'Metals', order: 1 }, { category: 'Metals', subcategory: 'Gold', order: 2 }]);
  assert.equal(g.snapshotCountry, 'USD');
  assert.equal(g.snapshotCountryOrder, 4);
  assert.equal(g.portfolioClass, 'Metals & Crypto');
});

test('Lookup: a column inserted in the middle and others moved still land in the right fields', () => {
  // Exposure inserted between Currency and Asset Class, FX moved to the end, Name moved after Asset Class
  const header = 'Ticker,Currency,Exposure,Asset Class,Name,Asset Subcategory,PortfolioClass,FX';
  const row = 'VWRA,USD,World,Equities,FTSE All-World,Basic,,USDPLN';
  const { lookup, warnings } = parseLookupTable([header, row].join('\n'));
  // The Snapshot columns are missing in this made-up sheet, so they warn; the six core ones don't
  assert.ok(warnings.every(w => /Snapshot/.test(w)), warnings.join(' | '));
  const [v] = lookup;
  assert.equal(v.exposure, 'World');
  assert.equal(v.name, 'FTSE All-World');
  assert.equal(v.currency, 'USD');
  assert.equal(v.fx, 'USDPLN');
  assert.equal(v.assetClass, 'Equities');
  assert.equal(v.assetSubcategory, 'Basic');
});

test('Lookup: headers match whatever the case, spaces or punctuation', () => {
  const header = 'TICKER,name,currency,fx,AssetClass,asset_subcategory,snapshot category,Snapshot Sub-Category,snapshotsubcategoryorder,Snapshot Country,SnapshotCountry Order,Portfolio Class';
  const row = 'VWRA,FTSE All-World,USD,USDPLN,Equities,Basic,Assets,Equities,3,USD,7,Metals & Crypto';
  const { lookup, warnings } = parseLookupTable([header, row].join('\n'));
  assert.deepEqual(warnings, []);
  assert.equal(lookup[0].assetClass, 'Equities');
  assert.equal(lookup[0].assetSubcategory, 'Basic');
  assert.equal(lookup[0].snapshotCountryOrder, 7);
  assert.equal(lookup[0].portfolioClass, 'Metals & Crypto');
});

test('Lookup: a renamed header falls back to its usual position AND says so', () => {
  const header = REAL_HEADER.replace('Asset Class', 'Klasa');   // renamed in the sheet
  const { lookup, warnings } = parseLookupTable([header, VWRA].join('\n'));
  assert.equal(lookup[0].assetClass, 'Equities');               // column E, as before
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /"Asset Class".*column E/);
});

test('Lookup: Exposure in column G (the sheet since Nov 2026) shifts nothing; "-" counts as blank', () => {
  const header = 'Ticker,Name,Currency,FX,Asset Class,Asset Subcategory,Exposure,SnapshotCategory,SnapshotSubCategory,SnapshotSubCategoryOrder,SnapshotCountry,SnapshotCountryOrder,PortfolioClass,,Name #char';
  const rows = [
    'BW20TR,WIG20TR,PLN,,Equities,Basic,Poland,"Assets, Equities","Equities, Countries","1, 1",PLN,1,,,7',
    'BTCSGD,Bitcoin SGD,SGD,SGDPLN,Crypto,Oth,-,Crypto,Crypto,7,,,Metals & Crypto,,11',
  ];
  const { lookup, warnings } = parseLookupTable([header, ...rows].join('\n'));
  assert.deepEqual(warnings, []);
  assert.equal(lookup[0].exposure, 'Poland');
  assert.equal(lookup[0].snapshotCountry, 'PLN');
  assert.equal(lookup[0].snapshotCountryOrder, 1);
  assert.equal(lookup[1].exposure, '');
  assert.equal(lookup[1].portfolioClass, 'Metals & Crypto');
});

test('Lookup: no PortfolioClass column is fine and silent (it is optional)', () => {
  const header = 'Ticker,Name,Currency,FX,Asset Class,Asset Subcategory,SnapshotCategory,SnapshotSubCategory,SnapshotSubCategoryOrder,SnapshotCountry,SnapshotCountryOrder';
  const { lookup, warnings } = parseLookupTable([header, 'VWRA,FTSE All-World,USD,USDPLN,Equities,Basic,,,,,'].join('\n'));
  assert.deepEqual(warnings, []);
  assert.equal(lookup[0].portfolioClass, '');
});
