/*
  DATA FETCHING UTILITY

  This file handles fetching CSV data from your published Google Sheet.

  HOW IT WORKS:
  1. Google Sheets can "publish" a spreadsheet as a CSV file (a simple text format)
  2. We fetch that CSV file from the published URL
  3. We parse (convert) the CSV text into JavaScript objects we can work with

  Think of it like downloading an Excel file and reading its contents,
  but all happening automatically in the browser!
*/

// The base URL for your published Google Sheet
const SHEET_BASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ1Q5jNM3Qq52UZwmQyRQrG_YER6-RNnagk2GG9Os65kFPtkNTpNtZywaoMEV8w_xDDuu0eRdEoPWgn/pub';

// URLs for each tab (sheet) in the spreadsheet
// gid=0 is the first tab (raw price data), gid=166035960 is the lookup table
// gid=2044431115 is the Years tab (annual portfolio summary data)
const DATA_SHEET_URL = `${SHEET_BASE_URL}?gid=0&output=csv`;
const LOOKUP_SHEET_URL = `${SHEET_BASE_URL}?gid=166035960&output=csv`;
const YEARS_SHEET_URL = `${SHEET_BASE_URL}?gid=2044431115&output=csv`;
// NOTE: the old "Open" (gid=1760382748) and "Exit" (gid=2134130819) tabs were deleted
// in Aug 2026. Open positions and closed round trips are now DERIVED from the full
// ledger below by lib/positions.ts. Do not re-add fetches for them: a deleted tab
// answers 400 on every request, which cost ~800ms each and used up two of the six
// connections the browser will open to a single host.
// gid=882618775 is the Daily tab (daily portfolio NAV + inflation indices per currency)
const DAILY_SHEET_URL = `${SHEET_BASE_URL}?gid=882618775&output=csv`;
// gid=378728363 is the Transactions tab — the COMPLETE ledger: every buy, sell, dividend,
// interest payment, cash inflow and transfer since 2014. This is what the Positions tab is
// built from now; open positions and closed round trips are DERIVED from it rather than
// read from the hand-maintained Open/Exit tabs.
const LEDGER_SHEET_URL = `${SHEET_BASE_URL}?gid=378728363&output=csv`;

// Type definitions - these describe the shape of our data
// (TypeScript uses these to catch errors and provide autocomplete)

// ---- Shared CSV parsing helpers ----
// These are used by all three sheet parsers (Years, Closed, Transactions)
// to read values from CSV rows by column name.
type ColIndex = { [key: string]: number };

/** Build a column-name → index map from CSV headers */
function buildColIndex(headers: string[]): ColIndex {
  const idx: ColIndex = {};
  headers.forEach((h, i) => { idx[h] = i; });
  return idx;
}

/** Read a numeric value from a CSV row by column name (handles commas, %, negatives) */
function csvReadNum(colIndex: ColIndex, values: string[], colName: string): number {
  const idx = colIndex[colName];
  if (idx === undefined || idx >= values.length) return 0;
  const raw = values[idx].trim();
  if (!raw) return 0;
  const clean = raw.replace(/,/g, '').replace(/%/g, '');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

/** Read a string value from a CSV row by column name */
function csvReadStr(colIndex: ColIndex, values: string[], colName: string): string {
  const idx = colIndex[colName];
  if (idx === undefined || idx >= values.length) return '';
  return values[idx].trim();
}

export interface AssetRow {
  date: string;                    // e.g., "2020-01-31"
  [assetName: string]: number | string;  // e.g., { "SPY": 320.45, "BND": 85.23 }
}

// Lookup table entry - maps ticker symbol to friendly name plus currency info
export interface AssetLookup {
  ticker: string;           // e.g., "SPY"
  name: string;             // e.g., "S&P 500 ETF"
  currency: string;         // e.g., "USD", "SGD", "PLN"
  fx: string;               // e.g., "USDPLN", "SGDPLN", "" for PLN assets
  assetClass: string;       // e.g., "Equities", "Fixed Income", "Alternatives"
  assetSubcategory: string; // e.g., "US Stocks", "Emerging Markets", "Gold" — finer grouping within asset class
}

// Annual portfolio summary data from the "Years" sheet
// Contains contributions, profits, cumulative values, FX rates, and returns per year
// Column names from the actual spreadsheet:
//   Date, Month, Year, Start Amount, Contributions, Profit, End Amount,
//   Contr Cumulative, Profit Cumulative,
//   USD End Period, USD AVG, USD Start Period,
//   SGD End Period, SGD AVG, SGD Start Period,
//   CHF End Period, CHF AVG, EUR End Period, EUR AVG, EUR Start Period,
//   Return PLN, Return USD, Return SGD
export interface YearsRow {
  date: string;              // Year label (e.g., "2019")
  contributions: number;     // Amount contributed that year (PLN)
  profit: number;            // Profit/loss that year (PLN) — can be negative
  contrCumulative: number;   // Total contributions to date (PLN)
  profitCumulative: number;  // Total profit to date (PLN) — can be negative
  endAmount: number;         // End-of-year portfolio value (PLN)
  startAmount: number;       // Start-of-year portfolio value (PLN)
  startUsdPln: number;       // Start-of-period USD/PLN rate
  startSgdPln: number;       // Start-of-period SGD/PLN rate
  startEurPln: number;       // Start-of-period EUR/PLN rate
  avgUsdPln: number;         // Average USD/PLN exchange rate for the year
  endUsdPln: number;         // End-of-period USD/PLN rate
  avgEurPln: number;         // Average EUR/PLN exchange rate
  endEurPln: number;         // End-of-period EUR/PLN rate
  avgChfPln: number;         // Average CHF/PLN exchange rate
  endChfPln: number;         // End-of-period CHF/PLN rate
  avgSgdPln: number;         // Average SGD/PLN exchange rate
  endSgdPln: number;         // End-of-period SGD/PLN rate
  returnPln: number;         // Annual return in PLN (%) — can be negative
  returnUsd: number;         // Annual return in USD (%) — can be negative
  returnSgd: number;         // Annual return in SGD (%) — can be negative
}

// Closed position (buy/sell transaction) from the "Closed" sheet
// Each row represents one buy-sell cycle for a particular asset
// The same ticker can appear multiple times (multiple buy/sell transactions)
// Column names from the actual spreadsheet:
//   Inv Date, Div date, Holding Period (D), Holding Period (Y), Ticker, Asset,
//   Total #shares bought, Total #shares sold, # Shares Sold, Buy Price, Buy Comm.,
//   Initial Cost, Sell price, Sell Comm., Value after fee, Cum. Dividend, Total tax,
//   Proceeds from Sale, Final Net Value incl Div
export interface ClosedPositionRow {
  invDate: string;              // Investment (buy) date
  divDate: string;              // Divestment (sale) date
  holdingPeriodDays: number;    // How many days the position was held
  holdingPeriodYears: number;   // How many years the position was held (decimal)
  ticker: string;               // Ticker symbol (e.g., "GLD")
  asset: string;                // Asset name (e.g., "Gold ETF")
  totalSharesBought: number;    // Total shares bought across all transactions for this asset
  totalSharesSold: number;      // Total shares sold across all transactions for this asset
  sharesSold: number;           // Shares sold in THIS specific transaction
  buyPrice: number;             // Price per share at purchase
  buyCommission: number;        // Commission paid on the buy
  initialCost: number;          // Total cost of the purchase (price × shares + commission)
  sellPrice: number;            // Price per share at sale
  sellCommission: number;       // Commission paid on the sell
  valueAfterFee: number;        // Sale proceeds minus sell commission
  cumDividend: number;          // Cumulative dividends received during holding
  totalTax: number;             // Total tax paid on the transaction
  proceedsFromSale: number;     // Net proceeds from sale after tax
  finalNetValue: number;        // Final net value including dividends
  // When the rows come from the ledger, the individual dividend payments behind
  // `cumDividend`, with their real dates. The old Exit tab could not supply these —
  // it only stored a lifetime total — which is why year-by-year views had to smear
  // that total evenly across the holding period. Left undefined by the legacy parser
  // so those views can fall back to smearing.
  incomeEvents?: { date: string; amount: number }[];
  // Computed fields (calculated during parsing):
  totalReturn: number;          // finalNetValue - initialCost (profit/loss in currency)
  totalReturnPct: number;       // (totalReturn / initialCost) × 100
  cagr: number;                 // Compound annual growth rate (%)
}

// Flow type constants — the three kinds of transactions in the "Data" sheet
export const FLOW_PURCHASE = 'Purchase of Asset';
export const FLOW_SALE = 'Proceeds from Sale';
export const FLOW_DIVIDEND = 'Dividend';
export type FlowType = typeof FLOW_PURCHASE | typeof FLOW_SALE | typeof FLOW_DIVIDEND;

// Raw transaction row from the "Data" sheet (gid=1857187976)
// Contains every purchase, dividend, and sale for all assets
// The same ticker can appear many times — one row per event
export interface TransactionRow {
  date: string;       // Transaction date (normalized to YYYY-MM-DD)
  fx: string;         // Currency code (e.g., "SGD", "USD")
  qty: number;        // Number of shares (fractional values supported)
  commAbs: number;    // Commission in absolute currency (from "Comm/adj" column)
  commBps: number;    // Commission in basis points (from "Comm (bps)" column)
  amount: number;     // Total cost (purchases), dividend received (dividends), or sale proceeds (sales)
  asset: string;      // Asset name (e.g., "Nikko AM-STC Asia REIT")
  flow: FlowType;     // "Purchase of Asset", "Dividend", or "Proceeds from Sale"
  ticker: string;     // Ticker symbol (e.g., "CFATR")
  account: string;    // Brokerage/bank account where the asset was held (e.g., "Saxo", "mBank")
}

// Daily NAV row from the "Daily" sheet (gid=882618775)
// Contains one entry per calendar day with portfolio NAV per share in three currencies
// and a cumulative inflation index (base 100 at 2019-12-16) for each currency.
export interface DailyNavRow {
  date: string;     // e.g., "2019-12-16"
  navPln: number;   // "NW Price"  — NAV per share in PLN  (starts at ~100)
  navUsd: number;   // "Price USD" — NAV per share in USD
  navSgd: number;   // "Price SGD" — NAV per share in SGD
  inflPln: number;  // "InflPLN"   — cumulative inflation index, base 100
  inflUsd: number;  // "InflUSD"   — cumulative inflation index, base 100
  inflSgd: number;  // "InflSGD"   — cumulative inflation index, base 100
  ddPln: number;    // "NW DD"     — daily drawdown in PLN (0 to -100)
  ddUsd: number;    // "DD USD"    — daily drawdown in USD (0 to -100)
  ddSgd: number;    // "DD SGD"    — daily drawdown in SGD (0 to -100)
}

// ---------------------------------------------------------------------------
// THE LEDGER (Transactions tab)
// ---------------------------------------------------------------------------
// One row per event. Unlike the old Open/Exit tabs, nothing here is pre-computed:
// whether a position is open, closed or half-sold has to be worked out by walking
// the rows in date order. See lib/positions.ts for that.
export interface LedgerRow {
  date: string;        // normalized to YYYY-MM-DD (the sheet writes YYYY/MM/DD)
  currency: string;    // "SGD", "USD", "PLN"
  qty: number;         // share/unit count (0 when the sheet leaves it blank)
  price: number;       // per-unit price
  amount: number;      // cash value of the event, in `currency`.
                       // NOTE: commission is ALREADY inside this figure — a purchase's
                       // Amount is qty x price PLUS commission, a sale's is qty x price
                       // MINUS it. Never add or subtract `commission` from this again.
  commission: number;  // "Comm /adj" — absolute commission paid, in `currency`
  commissionBps: number; // "Comm (bps)" — the sheet's own bps figure
  costBasis: number;   // the sheet's own cost basis for a sale (0 when absent)
  asset: string;       // full asset name — the reliable grouping key
  ticker: string;      // may be blank; "UST T-Bill" is reused by two different bills
  flow: string;        // see LEDGER_FLOW_* below
  account: string;     // "Flow to account:"
  remarks: string;
}

// Flow types seen in the ledger. Only the first four touch a position; the rest are
// cash bookkeeping (moving money between accounts, contributions, fees).
export const LEDGER_PURCHASE = 'Purchase of Asset';
export const LEDGER_SALE     = 'Proceeds from Sale';
export const LEDGER_DIVIDEND = 'Dividend';
export const LEDGER_INTEREST = 'Interest';   // coupon on savings bonds — income, like a dividend
export const LEDGER_INFLOW   = 'Inflow';     // usually cash, but ALSO how some holdings were acquired

export interface ParsedData {
  data: AssetRow[];           // Array of rows, each with date and asset prices
  assets: string[];           // List of asset names found in the CSV
  lookup: AssetLookup[];      // Lookup table with ticker-to-name mappings
  yearsData: YearsRow[];      // Annual portfolio summary (from Years sheet)
  dailyData: DailyNavRow[];   // Daily NAV + inflation data (from Daily sheet)
  ledgerData: LedgerRow[];    // Full transaction ledger (from Transactions sheet)
}

/**
 * The CSV reader for this app: turns raw text straight into rows of fields.
 *
 * Several sheets have column headers containing line breaks ("Price\nValue",
 * "Inv\nDate"), so a header can span three physical lines. Splitting the file on "\n"
 * first would shred those. This walks the text character by character instead,
 * tracking whether it is inside quotes, so a newline only ends a row when it is
 * genuinely outside a quoted field.
 *
 * Blank rows are dropped, matching what the sheets actually contain. A row of bare
 * delimiters (",,,,") is NOT blank — it survives, because the trailing summary blocks
 * some sheets carry look like that and the callers filter them out themselves.
 *
 * @param csvText   the entire file
 * @param delimiter usually a comma; Google occasionally exports tab-separated
 */
function parseCSVRows(csvText: string, delimiter: string = ','): string[][] {
  const text = csvText.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [], cur = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // A doubled quote inside a quoted field is a literal quote character
      if (inQuotes && text[i + 1] === '"') { cur += '"'; i++; } else inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      row.push(cur); cur = '';
    } else if (ch === '\n' && !inQuotes) {
      row.push(cur); rows.push(row); row = []; cur = '';
    } else {
      cur += ch;
    }
  }
  row.push(cur);
  rows.push(row);
  return rows.filter(r => r.length > 1 || r[0].trim() !== '');
}

/**
 * Parses the Transactions tab into LedgerRow objects.
 *
 * Only rows with a real YYYY/MM/DD date are kept — the sheet ends with a few
 * summary/total rows that would otherwise parse as garbage.
 *
 * Numbers arrive formatted for humans ("20,359.00"), so commas and spaces are
 * stripped before parsing.
 */
export function parseLedger(csvText: string): LedgerRow[] {
  const rows = parseCSVRows(csvText);
  if (rows.length < 2) {
    console.warn('Transactions sheet is empty or has no data rows');
    return [];
  }

  // Collapse whitespace in headers so "Price\nValue" matches as "Price\ Value"
  const headers = rows[0].map(h => (h || '').replace(/\s+/g, ' ').trim());
  const col = (name: string) => headers.findIndex(h => h.toLowerCase().startsWith(name.toLowerCase()));
  const iDate = col('Date'), iCurr = col('Curr'), iQty = col('Qty'), iPrice = col('Price'),
        iAmount = col('Amount'), iCost = col('Cost Basis'), iAsset = col('Asset'),
        iComm = col('Comm /'), iCommBps = col('Comm ('),
        iFlow = col('Flow'), iTicker = col('Ticker'), iTo = col('Flow to account'),
        iRemarks = col('Remarks');

  const num = (v: string | undefined): number => {
    const x = parseFloat((v || '').replace(/[",\s]/g, ''));
    return isFinite(x) ? x : 0;
  };
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] || '').trim() : '');

  const out: LedgerRow[] = [];
  for (const r of rows.slice(1)) {
    const rawDate = cell(r, iDate);
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(rawDate)) continue;  // skips the trailing summary block
    out.push({
      date: rawDate.replace(/\//g, '-'),
      currency: cell(r, iCurr),
      qty: num(r[iQty]),
      price: num(r[iPrice]),
      amount: num(r[iAmount]),
      commission: num(r[iComm]),
      // The sheet quotes commission in bps of the gross trade (qty x price). Where it
      // left the column blank but a commission exists, work it out the same way so the
      // two agree — 17.04 on a 4,545 trade is 37.49 bps either way.
      commissionBps: num(r[iCommBps]) || (num(r[iComm]) && num(r[iQty]) * num(r[iPrice])
        ? (num(r[iComm]) / (num(r[iQty]) * num(r[iPrice]))) * 10000 : 0),
      costBasis: num(r[iCost]),
      asset: cell(r, iAsset),
      ticker: cell(r, iTicker),
      flow: cell(r, iFlow),
      account: cell(r, iTo),
      remarks: cell(r, iRemarks),
    });
  }
  return out;
}

/**
 * Fetches and parses CSV data from both Google Sheet tabs.
 * - Tab 1: Raw price data
 * - Tab 2: Lookup table (ticker -> asset name)
 *
 * @returns Promise containing the parsed data, list of assets, and lookup table
 * @throws Error if fetch fails or data is invalid
 */
export async function fetchSheetData(): Promise<ParsedData> {
  // Fetch all seven sheets in parallel for speed
  const [dataResponse, lookupResponse, yearsResponse, dailyResponse, ledgerResponse] = await Promise.all([
    fetch(DATA_SHEET_URL, { cache: 'no-cache' }),
    fetch(LOOKUP_SHEET_URL, { cache: 'no-cache' }),
    fetch(YEARS_SHEET_URL, { cache: 'no-cache' }).catch(() => null), // Years sheet is optional — don't break the app if it fails
    fetch(DAILY_SHEET_URL, { cache: 'no-cache' }).catch(() => null),  // Daily NAV sheet is optional too
    fetch(LEDGER_SHEET_URL, { cache: 'no-cache' }).catch(() => null), // Full ledger — powers the Positions tab
  ]);

  // Check if core fetches were successful
  if (!dataResponse.ok) {
    throw new Error(`Failed to fetch price data: ${dataResponse.status} ${dataResponse.statusText}`);
  }
  if (!lookupResponse.ok) {
    throw new Error(`Failed to fetch lookup table: ${lookupResponse.status} ${lookupResponse.statusText}`);
  }

  // Get CSV text from responses
  const [dataCsvText, lookupCsvText] = await Promise.all([
    dataResponse.text(),
    lookupResponse.text()
  ]);

  // Parse core CSVs
  const { data, assets } = parseSheetData(dataCsvText);
  const lookup = parseLookupTable(lookupCsvText);

  // Parse Years sheet if it loaded successfully (wrapped in try/catch so it can't break the app)
  let yearsData: YearsRow[] = [];
  try {
    if (yearsResponse && yearsResponse.ok) {
      const yearsCsvText = await yearsResponse.text();
      yearsData = parseYearsData(yearsCsvText);
      console.log(`Years sheet: parsed ${yearsData.length} rows`);
    }
  } catch (err) {
    console.warn('Failed to parse Years sheet (non-fatal):', err);
  }

  // Parse Daily NAV sheet if it loaded successfully
  let dailyData: DailyNavRow[] = [];
  try {
    if (!dailyResponse) {
      console.warn('Daily sheet fetch threw (returned null) — retrying once...');
      // Retry once since it might have been throttled during the parallel fetch
      const retryDaily = await fetch(DAILY_SHEET_URL, { cache: 'no-cache' }).catch(() => null);
      if (retryDaily && retryDaily.ok) {
        const dailyCsvText = await retryDaily.text();
        dailyData = parseDailyData(dailyCsvText);
        console.log(`Daily sheet (retry): parsed ${dailyData.length} rows`);
      } else {
        console.warn('Daily sheet retry also failed:', retryDaily?.status);
      }
    } else if (!dailyResponse.ok) {
      console.warn('Daily sheet non-OK status:', dailyResponse.status);
    } else {
      const dailyCsvText = await dailyResponse.text();
      dailyData = parseDailyData(dailyCsvText);
      console.log(`Daily sheet: parsed ${dailyData.length} rows`);
    }
  } catch (err) {
    console.warn('Failed to parse Daily sheet (non-fatal):', err);
  }

  // Parse the full ledger (Transactions tab). Same optional + retry pattern as the
  // others: Google sometimes answers "Loading..." when several tabs are pulled at once.
  let ledgerData: LedgerRow[] = [];
  try {
    let ledgerCsv = '';
    if (ledgerResponse && ledgerResponse.ok) ledgerCsv = await ledgerResponse.text();
    let retries = 0;
    while ((!ledgerCsv || ledgerCsv.trim() === 'Loading...' || ledgerCsv.trim().length < 50) && retries < 3) {
      retries++;
      console.log(`Transactions (ledger) sheet returned "${ledgerCsv.trim().substring(0, 20)}", retrying (${retries}/3)...`);
      await new Promise(r => setTimeout(r, 1000 * retries));
      const retry = await fetch(LEDGER_SHEET_URL, { cache: 'no-cache' }).catch(() => null);
      if (retry && retry.ok) ledgerCsv = await retry.text();
    }
    if (ledgerCsv && ledgerCsv.trim() !== 'Loading...' && ledgerCsv.trim().length >= 50) {
      ledgerData = parseLedger(ledgerCsv);
      console.log(`Transactions (ledger) sheet: parsed ${ledgerData.length} rows`);
    } else {
      console.warn('Transactions (ledger) sheet still empty after retries');
    }
  } catch (err) {
    console.warn('Failed to parse Transactions (ledger) sheet (non-fatal):', err);
  }

  console.log(`Lookup table has ${lookup.length} assets: ${lookup.map(l => l.ticker).join(', ')}`);

  return { data, assets, lookup, yearsData, dailyData, ledgerData };
}

/**
 * Parses the lookup table CSV (ticker -> asset name, currency, FX ticker, asset class, subcategory).
 * Expects six columns: Ticker, Asset Name, Currency, FX, Asset Class, Asset Subcategory
 *
 * Column 1: Ticker (e.g., "SPY")
 * Column 2: Asset Name (e.g., "S&P 500 ETF")
 * Column 3: Currency (e.g., "USD", "SGD", "PLN")
 * Column 4: FX (e.g., "USDPLN", "SGDPLN", or empty for PLN assets)
 * Column 5: Asset Class (e.g., "Equities", "Fixed Income", "Alternatives")
 * Column 6: Asset Subcategory (e.g., "US Stocks", "Emerging Markets", "Gold")
 *
 * @param csvText - The raw CSV file content
 * @returns Array of ticker-to-name-currency-fx-assetClass-assetSubcategory mappings
 */
function parseLookupTable(csvText: string): AssetLookup[] {
  const lines = csvText.trim().split('\n');

  if (lines.length < 2) {
    console.warn('Lookup table is empty or has no data rows');
    return [];
  }

  // Auto-detect delimiter
  const delimiter = lines[0].includes('\t') ? '\t' : ',';

  const lookup: AssetLookup[] = [];

  // Skip header row (line 0), parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line, delimiter);
    if (values.length < 2) continue;

    const ticker = values[0].trim();
    const name = values[1].trim();
    // Currency defaults to "PLN" if not specified (column 3)
    const currency = values.length > 2 ? values[2].trim() : 'PLN';
    // FX ticker defaults to empty string if not specified (column 4)
    const fx = values.length > 3 ? values[3].trim() : '';
    // Asset class defaults to empty string if not specified (column 5)
    const assetClass = values.length > 4 ? values[4].trim() : '';
    // Asset subcategory defaults to empty string if not specified (column 6)
    const assetSubcategory = values.length > 5 ? values[5].trim() : '';

    if (ticker && name) {
      lookup.push({ ticker, name, currency, fx, assetClass, assetSubcategory });
    }
  }

  return lookup;
}

/**
 * Parses a single line of CSV, handling quoted values correctly.
 *
 * CSV files can have commas INSIDE values if they're wrapped in quotes.
 * For example: "Company, Inc.",500
 * This function handles that complexity.
 *
 * @param line - A single line from the CSV file
 * @param delimiter - The separator character (usually comma)
 * @returns Array of values from that line
 */
function parseCSVLine(line: string, delimiter: string = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;  // Tracks if we're inside a quoted section

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Two quotes in a row = escaped quote (include one quote in output)
        current += '"';
        i++; // Skip the next quote
      } else {
        // Toggle whether we're inside quotes
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      // We hit a delimiter outside of quotes = end of this field
      result.push(current);
      current = '';
    } else {
      // Regular character, just add it
      current += char;
    }
  }

  // Don't forget the last field (after the last comma)
  result.push(current);

  return result;
}

/**
 * Parses the "Years" sheet CSV into YearsRow objects.
 *
 * This parser is different from parseSheetData because:
 * - It maps columns by header name (not position), so column order doesn't matter
 * - It allows NEGATIVE numbers (needed for Profit and Return columns)
 * - It handles percentage signs (e.g., "12.5%" → 12.5)
 *
 * @param csvText - The raw CSV content from the Years sheet
 * @returns Array of YearsRow objects, one per year
 */
function parseYearsData(csvText: string): YearsRow[] {
  const lines = csvText.trim().split('\n');

  if (lines.length < 2) {
    console.warn('Years sheet is empty or has no data rows');
    return [];
  }

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = parseCSVLine(lines[0], delimiter).map(h => h.trim());

  const colIndex = buildColIndex(headers);
  const readNum = (values: string[], colName: string) => csvReadNum(colIndex, values, colName);

  const rows: YearsRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line, delimiter);

    // First column is the date/year
    const dateIdx = colIndex['Date'] ?? 0;
    const date = values[dateIdx]?.trim() || '';
    if (!date) continue;

    rows.push({
      date,
      contributions:    readNum(values, 'Contributions'),
      profit:           readNum(values, 'Profit'),
      contrCumulative:  readNum(values, 'Contr Cumulative'),
      profitCumulative: readNum(values, 'Profit Cumulative'),
      endAmount:        readNum(values, 'End Amount'),
      startAmount:      readNum(values, 'Start Amount'),
      startUsdPln:      readNum(values, 'USD Start Period'),
      startSgdPln:      readNum(values, 'SGD Start Period'),
      startEurPln:      readNum(values, 'EUR Start Period'),
      avgUsdPln:        readNum(values, 'USD AVG'),
      endUsdPln:        readNum(values, 'USD End Period'),
      avgEurPln:        readNum(values, 'EUR AVG'),
      endEurPln:        readNum(values, 'EUR End Period'),
      avgChfPln:        readNum(values, 'CHF AVG'),
      endChfPln:        readNum(values, 'CHF End Period'),
      avgSgdPln:        readNum(values, 'SGD AVG'),
      endSgdPln:        readNum(values, 'SGD End Period'),
      returnPln:        readNum(values, 'Return PLN'),
      returnUsd:        readNum(values, 'Return USD'),
      returnSgd:        readNum(values, 'Return SGD'),
    });
  }

  return rows;
}

/**
 * Normalizes various date formats (e.g., "1/15/2020", "2020-01-15", "01/15/2020")
 * into a consistent YYYY-MM-DD format that matches our price data.
 *
 * @param dateStr - A date string in any common format
 * @returns Normalized date string in YYYY-MM-DD format, or original if parsing fails
 */
function normalizeDate(dateStr: string): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();

  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // Try parsing with Date constructor (handles most formats)
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return trimmed; // Return as-is if we can't parse it
}

/**
 * Converts raw CSV text into structured data.
 *
 * @param csvText - The raw CSV file content
 * @returns Parsed data with array of rows and list of asset names
 */
function parseSheetData(csvText: string): { data: AssetRow[]; assets: string[] } {
  // Split the file into lines
  const lines = csvText.trim().split('\n');

  if (lines.length < 2) {
    throw new Error('Not enough data in CSV (need header + at least 1 data row)');
  }

  // Auto-detect if this is tab-separated or comma-separated
  const delimiter = lines[0].includes('\t') ? '\t' : ',';

  // Parse the header row (first line) to get column names
  const headerValues = parseCSVLine(lines[0], delimiter);
  const numColumns = headerValues.length;

  // Build list of asset columns (everything except the first "date" column)
  const assetColumns: string[] = [];
  const assetColumnIndices: { [key: string]: number } = {};

  for (let i = 1; i < headerValues.length; i++) {
    const header = headerValues[i].trim();
    if (header && header.length > 0) {
      assetColumns.push(header);
      assetColumnIndices[header] = i;  // Remember which column each asset is in
    }
  }

  if (assetColumns.length === 0) {
    throw new Error('No asset columns found in CSV. First column should be date, rest should be assets.');
  }

  console.log(`Found ${assetColumns.length} assets: ${assetColumns.join(', ')}`);

  // Parse each data row
  const data: AssetRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;  // Skip empty lines

    const values = parseCSVLine(line, delimiter);

    // Pad with empty strings if row is shorter than header
    while (values.length < numColumns) {
      values.push('');
    }

    if (values.length < 2) continue;  // Need at least date + 1 asset

    const dateStr = values[0].trim();
    if (!dateStr) continue;  // Skip rows without a date

    // Build the row object starting with the date
    const row: AssetRow = { date: dateStr };

    // Add each asset's value to the row
    assetColumns.forEach((asset) => {
      const colIndex = assetColumnIndices[asset];
      if (colIndex >= values.length) return;

      const rawValue = values[colIndex].trim();
      if (!rawValue) return;  // Skip empty values

      // Remove commas from numbers (e.g., "1,234.56" -> "1234.56")
      const cleanValue = rawValue.replace(/,/g, '');
      const value = parseFloat(cleanValue);

      // Only include valid positive numbers
      if (!isNaN(value) && value > 0) {
        row[asset] = value;
      }
    });

    // Only include rows that have at least one asset value
    if (Object.keys(row).length > 1) {
      data.push(row);
    }
  }

  if (data.length === 0) {
    throw new Error('No valid data rows found in CSV');
  }

  console.log(`Parsed ${data.length} rows of data`);

  return { data, assets: assetColumns };
}

/**
 * Parses the "Daily" sheet CSV (gid=882618775) into DailyNavRow objects.
 *
 * This sheet has multiline column headers (e.g., "NW\nPrice"), so it uses the
 * quote-aware parseCSVRows() plus header normalization (collapse whitespace into a
 * single space), the same way the ledger parser does.
 *
 * Relevant columns (after normalization):
 *   Date       — calendar date (YYYY-MM-DD)
 *   NW Price   — portfolio NAV per share in PLN (starts at 100.00)
 *   Price USD  — portfolio NAV per share in USD
 *   Price SGD  — portfolio NAV per share in SGD
 *   InflPLN    — cumulative inflation index for PLN (base 100)
 *   InflUSD    — cumulative inflation index for USD (base 100)
 *   InflSGD    — cumulative inflation index for SGD (base 100)
 *
 * @param csvText - Raw CSV content from the Daily sheet
 * @returns Array of DailyNavRow objects, one per calendar day
 */
function parseDailyData(csvText: string): DailyNavRow[] {
  // Quote-aware reader, because this sheet's headers contain embedded newlines.
  // Parse as comma-separated first; if that yields a single column the export was
  // tab-separated, so read it again that way.
  let lines = parseCSVRows(csvText.trim());
  if (lines.length > 0 && lines[0].length === 1 && lines[0][0].includes('\t')) {
    lines = parseCSVRows(csvText.trim(), '\t');
  }

  if (lines.length < 2) {
    console.warn('Daily sheet is empty or has no data rows');
    return [];
  }

  // Normalize headers: collapse any whitespace (newlines, extra spaces) to a single space
  const headers = lines[0].map(h => h.replace(/\s+/g, ' ').trim());

  console.log('Daily sheet headers:', headers.join(' | '));

  const colIndex = buildColIndex(headers);
  const readNum = (values: string[], colName: string) => csvReadNum(colIndex, values, colName);
  const readStr = (values: string[], colName: string) => csvReadStr(colIndex, values, colName);

  const rows: DailyNavRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i];

    const date = readStr(values, 'Date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue; // Skip non-date rows

    const navPln = readNum(values, 'NW Price');
    if (navPln <= 0) continue; // Skip rows with no valid PLN NAV

    rows.push({
      date,
      navPln,
      navUsd:  readNum(values, 'Price USD'),
      navSgd:  readNum(values, 'Price SGD'),
      inflPln: readNum(values, 'InflPLN'),
      inflUsd: readNum(values, 'InflUSD'),
      inflSgd: readNum(values, 'InflSGD'),
      ddPln:   readNum(values, 'NW DD'),
      ddUsd:   readNum(values, 'DD USD'),
      ddSgd:   readNum(values, 'DD SGD'),
    });
  }

  return rows;
}
