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
// gid=2134130819 is the Closed tab (buy/sell transactions for closed positions)
const CLOSED_SHEET_URL = `${SHEET_BASE_URL}?gid=2134130819&output=csv`;
// gid=1857187976 is the Data tab (raw transactions: purchases, dividends, sales)
const TRANSACTIONS_SHEET_URL = `${SHEET_BASE_URL}?gid=1760382748&output=csv`;
// gid=882618775 is the Daily tab (daily portfolio NAV + inflation indices per currency)
const DAILY_SHEET_URL = `${SHEET_BASE_URL}?gid=882618775&output=csv`;

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
}

export interface ParsedData {
  data: AssetRow[];           // Array of rows, each with date and asset prices
  assets: string[];           // List of asset names found in the CSV
  lookup: AssetLookup[];      // Lookup table with ticker-to-name mappings
  yearsData: YearsRow[];      // Annual portfolio summary (from Years sheet)
  closedData: ClosedPositionRow[];  // Closed position transactions (from Closed sheet)
  transactionData: TransactionRow[];  // Raw transactions from the Data sheet (purchases, dividends, sales)
  dailyData: DailyNavRow[];   // Daily NAV + inflation data (from Daily sheet)
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
  // Fetch all six sheets in parallel for speed
  const [dataResponse, lookupResponse, yearsResponse, closedResponse, txnResponse, dailyResponse] = await Promise.all([
    fetch(DATA_SHEET_URL, { cache: 'no-cache' }),
    fetch(LOOKUP_SHEET_URL, { cache: 'no-cache' }),
    fetch(YEARS_SHEET_URL, { cache: 'no-cache' }).catch(() => null), // Years sheet is optional — don't break the app if it fails
    fetch(CLOSED_SHEET_URL, { cache: 'no-cache' }).catch(() => null), // Closed sheet is optional too
    fetch(TRANSACTIONS_SHEET_URL, { cache: 'no-cache' }).catch(() => null), // Transactions sheet is optional too
    fetch(DAILY_SHEET_URL, { cache: 'no-cache' }).catch(() => null),  // Daily NAV sheet is optional too
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

  // Parse Closed sheet if it loaded successfully (same non-fatal pattern as Years)
  let closedData: ClosedPositionRow[] = [];
  try {
    if (closedResponse && closedResponse.ok) {
      const closedCsvText = await closedResponse.text();
      closedData = parseClosedData(closedCsvText);
      console.log(`Closed sheet: parsed ${closedData.length} rows`);
    }
  } catch (err) {
    console.warn('Failed to parse Closed sheet (non-fatal):', err);
  }

  // Parse Transactions (Data) sheet if it loaded successfully (same non-fatal pattern)
  // Google Sheets sometimes returns "Loading..." instead of CSV data when too many
  // sheets are fetched in parallel. If that happens, retry up to 3 times with a delay.
  let transactionData: TransactionRow[] = [];
  try {
    let txnCsvText = '';
    if (txnResponse && txnResponse.ok) {
      txnCsvText = await txnResponse.text();
    }
    // Retry if we got "Loading..." or empty response
    let retries = 0;
    while ((!txnCsvText || txnCsvText.trim() === 'Loading...' || txnCsvText.trim().length < 50) && retries < 3) {
      retries++;
      console.log(`Transactions sheet returned "${txnCsvText.trim()}", retrying (${retries}/3)...`);
      await new Promise(r => setTimeout(r, 1000 * retries)); // wait 1s, 2s, 3s
      const retryResponse = await fetch(TRANSACTIONS_SHEET_URL, { cache: 'no-cache' }).catch(() => null);
      if (retryResponse && retryResponse.ok) {
        txnCsvText = await retryResponse.text();
      }
    }
    if (txnCsvText && txnCsvText.trim() !== 'Loading...' && txnCsvText.trim().length >= 50) {
      transactionData = parseTransactionData(txnCsvText);
      console.log(`Transactions sheet: parsed ${transactionData.length} rows`);
    } else {
      console.warn(`Transactions sheet still empty after retries: "${txnCsvText.trim().substring(0, 50)}"`);
    }
  } catch (err) {
    console.warn('Failed to parse Transactions sheet (non-fatal):', err);
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

  console.log(`Lookup table has ${lookup.length} assets: ${lookup.map(l => l.ticker).join(', ')}`);

  return { data, assets, lookup, yearsData, closedData, transactionData, dailyData };
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
 * Splits CSV text into logical rows, correctly handling quoted fields that
 * contain newlines. Standard split('\n') breaks when column headers or values
 * have line breaks inside quotes (e.g., "Inv\nDate").
 *
 * @param csvText - The entire CSV file as a string
 * @returns Array of logical row strings (each representing one CSV record)
 */
function splitCSVRows(csvText: string): string[] {
  const rows: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];

    if (char === '"') {
      // Handle escaped quotes (two double-quotes in a row)
      if (inQuotes && csvText[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += char;
      }
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      // End of a logical row (only when not inside quotes)
      if (char === '\r' && csvText[i + 1] === '\n') i++; // skip \r\n as one newline
      if (current.trim()) rows.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  // Don't forget the last row
  if (current.trim()) rows.push(current);

  return rows;
}

/**
 * Parses the "Closed" sheet CSV into ClosedPositionRow objects.
 *
 * This sheet contains buy/sell transaction data for closed positions.
 * Same ticker can appear multiple times (each row = one buy-sell cycle).
 *
 * IMPORTANT: The Closed sheet has column headers with embedded newlines
 * (e.g., "Inv\nDate"), so we use splitCSVRows() instead of split('\n').
 * Also, headers are normalized by collapsing whitespace (newlines → spaces)
 * so that "Inv\nDate" matches as "Inv Date".
 *
 * Also computes three derived fields per row:
 *   - totalReturn: profit/loss in currency
 *   - totalReturnPct: profit/loss as percentage
 *   - cagr: compound annual growth rate
 *
 * @param csvText - The raw CSV content from the Closed sheet
 * @returns Array of ClosedPositionRow objects
 */
function parseClosedData(csvText: string): ClosedPositionRow[] {
  // Use quote-aware row splitter (handles newlines inside quoted headers)
  const lines = splitCSVRows(csvText.trim());

  if (lines.length < 2) {
    console.warn('Closed sheet is empty or has no data rows');
    return [];
  }

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  // Parse header and normalize: collapse any whitespace (newlines, multiple spaces) into single space
  const headers = parseCSVLine(lines[0], delimiter).map(h => h.replace(/\s+/g, ' ').trim());

  console.log('Closed sheet headers:', headers.join(' | '));

  const colIndex = buildColIndex(headers);
  const readNum = (values: string[], colName: string) => csvReadNum(colIndex, values, colName);
  const readStr = (values: string[], colName: string) => csvReadStr(colIndex, values, colName);

  const rows: ClosedPositionRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line, delimiter);

    // Read all raw fields
    // Note: The spreadsheet has "Tciker" (typo) but we also check "Ticker" for safety
    const invDate = normalizeDate(readStr(values, 'Inv Date'));
    const divDate = normalizeDate(readStr(values, 'Div date'));
    const ticker = readStr(values, 'Tciker') || readStr(values, 'Ticker');

    // Skip rows without essential data (no dates — ticker can be empty for some legacy rows)
    if (!invDate || !divDate) continue;

    const holdingPeriodDays = readNum(values, 'Holding Period (D)');
    const holdingPeriodYears = readNum(values, 'Holding Period (Y)');
    const asset = readStr(values, 'Asset');
    const totalSharesBought = readNum(values, 'Total #shares bought');
    const totalSharesSold = readNum(values, 'Total #shares sold');
    const sharesSold = readNum(values, '# Shares Sold');
    const buyPrice = readNum(values, 'Buy Price');
    const buyCommission = readNum(values, 'Buy Comm.');
    const initialCost = readNum(values, 'Initial Cost');
    const sellPrice = readNum(values, 'Sell price');
    const sellCommission = readNum(values, 'Sell Comm.');
    const valueAfterFee = readNum(values, 'Value after fee');
    const cumDividend = readNum(values, 'Cum. Dividend');
    const totalTax = readNum(values, 'Total tax');
    const proceedsFromSale = readNum(values, 'Proceeds from Sale');
    const finalNetValue = readNum(values, 'Final Net Value incl Div');

    // Compute derived fields
    const totalReturn = finalNetValue - initialCost;
    const totalReturnPct = initialCost > 0 ? (totalReturn / initialCost) * 100 : 0;
    // CAGR = ((end / start) ^ (1 / years) - 1) × 100
    // Use exact days between dates (matching XIRR's time calculation) instead of
    // the spreadsheet's rounded holdingPeriodYears, so CAGR and XIRR agree
    // for single transactions.
    const exactYears = (invDate && divDate)
      ? (new Date(divDate).getTime() - new Date(invDate).getTime()) / (365.25 * 86400000)
      : holdingPeriodYears;
    const cagr = (exactYears > 0 && initialCost > 0 && finalNetValue > 0)
      ? (Math.pow(finalNetValue / initialCost, 1 / exactYears) - 1) * 100
      : 0;

    rows.push({
      invDate, divDate, holdingPeriodDays, holdingPeriodYears,
      ticker, asset, totalSharesBought, totalSharesSold, sharesSold,
      buyPrice, buyCommission, initialCost,
      sellPrice, sellCommission, valueAfterFee,
      cumDividend, totalTax, proceedsFromSale, finalNetValue,
      totalReturn, totalReturnPct, cagr,
    });
  }

  return rows;
}

/**
 * Parses the "Data" sheet CSV (gid=1857187976) into TransactionRow objects.
 *
 * This sheet contains every purchase, dividend payment, and sale for all assets.
 * Each row is one event:
 *   - "Purchase of Asset": buying shares (Qty = shares bought, Amount = total cost incl. commission)
 *   - "Dividend": dividend/interest received (Qty = shares held at that time, Amount = cash received)
 *   - "Proceeds from Sale": selling shares (Amount = sale proceeds)
 *
 * Columns: Date, FX, Qty, Price\Value, Comm/adj, Comm (bps), Amount, Asset, Flow, Ticker
 *
 * @param csvText - The raw CSV content from the Data sheet
 * @returns Array of TransactionRow objects
 */
function parseTransactionData(csvText: string): TransactionRow[] {
  // Use quote-aware row splitter (handles newlines inside quoted headers)
  const lines = splitCSVRows(csvText.trim());

  if (lines.length < 2) {
    console.warn('Transactions sheet is empty or has no data rows');
    return [];
  }

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  // Parse header and normalize: collapse any whitespace (newlines, multiple spaces) into single space
  const headers = parseCSVLine(lines[0], delimiter).map(h => h.replace(/\s+/g, ' ').trim());

  console.log('Transactions sheet headers:', headers.join(' | '));

  const colIndex = buildColIndex(headers);
  const readNum = (values: string[], colName: string) => csvReadNum(colIndex, values, colName);
  const readStr = (values: string[], colName: string) => csvReadStr(colIndex, values, colName);

  const rows: TransactionRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line, delimiter);

    const date = normalizeDate(readStr(values, 'Date'));
    if (!date) continue;

    const flowRaw = readStr(values, 'Flow');
    if (!flowRaw) continue; // Skip rows without a flow type
    // Validate that the flow type is one we recognize (Purchase, Sale, or Dividend)
    if (flowRaw !== FLOW_PURCHASE && flowRaw !== FLOW_SALE && flowRaw !== FLOW_DIVIDEND) continue;
    const flow: FlowType = flowRaw;

    const ticker = readStr(values, 'Ticker');
    if (!ticker) continue; // Skip rows without a ticker

    const qty = readNum(values, 'Qty');
    const commAbs = readNum(values, 'Comm /adj');
    const amount = readNum(values, 'Amount');

    rows.push({
      date,
      fx: readStr(values, 'FX'),
      qty,
      commAbs,
      // "Comm (bps)" column — commission in basis points
      commBps: readNum(values, 'Comm (bps)'),
      amount,
      asset: readStr(values, 'Asset'),
      flow,
      ticker,
    });
  }

  return rows;
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
 * This sheet has multiline column headers (e.g., "NW\nPrice"), so we use
 * splitCSVRows() + header normalization (collapse whitespace → single space),
 * exactly like parseClosedData and parseTransactionData.
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
  // Use quote-aware splitter because headers contain embedded newlines
  const lines = splitCSVRows(csvText.trim());

  if (lines.length < 2) {
    console.warn('Daily sheet is empty or has no data rows');
    return [];
  }

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  // Normalize headers: collapse any whitespace (newlines, extra spaces) to a single space
  const headers = parseCSVLine(lines[0], delimiter).map(h => h.replace(/\s+/g, ' ').trim());

  console.log('Daily sheet headers:', headers.join(' | '));

  const colIndex = buildColIndex(headers);
  const readNum = (values: string[], colName: string) => csvReadNum(colIndex, values, colName);
  const readStr = (values: string[], colName: string) => csvReadStr(colIndex, values, colName);

  const rows: DailyNavRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line, delimiter);

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
    });
  }

  return rows;
}
