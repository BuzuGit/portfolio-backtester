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

// Type definitions - these describe the shape of our data
// (TypeScript uses these to catch errors and provide autocomplete)

export interface AssetRow {
  date: string;                    // e.g., "2020-01-31"
  [assetName: string]: number | string;  // e.g., { "SPY": 320.45, "BND": 85.23 }
}

// Lookup table entry - maps ticker symbol to friendly name plus currency info
export interface AssetLookup {
  ticker: string;     // e.g., "SPY"
  name: string;       // e.g., "S&P 500 ETF"
  currency: string;   // e.g., "USD", "SGD", "PLN"
  fx: string;         // e.g., "USDPLN", "SGDPLN", "" for PLN assets
  assetClass: string; // e.g., "Equities", "Fixed Income", "Alternatives"
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

export interface ParsedData {
  data: AssetRow[];           // Array of rows, each with date and asset prices
  assets: string[];           // List of asset names found in the CSV
  lookup: AssetLookup[];      // Lookup table with ticker-to-name mappings
  yearsData: YearsRow[];      // Annual portfolio summary (from Years sheet)
  closedData: ClosedPositionRow[];  // Closed position transactions (from Closed sheet)
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
  // Fetch all four sheets in parallel for speed
  const [dataResponse, lookupResponse, yearsResponse, closedResponse] = await Promise.all([
    fetch(DATA_SHEET_URL, { cache: 'no-cache' }),
    fetch(LOOKUP_SHEET_URL, { cache: 'no-cache' }),
    fetch(YEARS_SHEET_URL, { cache: 'no-cache' }).catch(() => null), // Years sheet is optional — don't break the app if it fails
    fetch(CLOSED_SHEET_URL, { cache: 'no-cache' }).catch(() => null) // Closed sheet is optional too
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

  console.log(`Lookup table has ${lookup.length} assets: ${lookup.map(l => l.ticker).join(', ')}`);

  return { data, assets, lookup, yearsData, closedData };
}

/**
 * Parses the lookup table CSV (ticker -> asset name, currency, FX ticker, asset class).
 * Expects five columns: Ticker, Asset Name, Currency, FX, Asset Class
 *
 * Column 1: Ticker (e.g., "SPY")
 * Column 2: Asset Name (e.g., "S&P 500 ETF")
 * Column 3: Currency (e.g., "USD", "SGD", "PLN")
 * Column 4: FX (e.g., "USDPLN", "SGDPLN", or empty for PLN assets)
 * Column 5: Asset Class (e.g., "Equities", "Fixed Income", "Alternatives")
 *
 * @param csvText - The raw CSV file content
 * @returns Array of ticker-to-name-currency-fx-assetClass mappings
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

    if (ticker && name) {
      lookup.push({ ticker, name, currency, fx, assetClass });
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

  // Build a map from column header name → column index
  // This way we're not dependent on column order in the spreadsheet
  const colIndex: { [key: string]: number } = {};
  headers.forEach((h, i) => { colIndex[h] = i; });

  // Helper: reads a numeric value from a row by column name
  // Handles commas, percentage signs, and negative numbers
  const readNum = (values: string[], colName: string): number => {
    const idx = colIndex[colName];
    if (idx === undefined || idx >= values.length) return 0;
    const raw = values[idx].trim();
    if (!raw) return 0;
    // Remove commas and percentage signs, keep minus sign
    const clean = raw.replace(/,/g, '').replace(/%/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  };

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

  // Build column name → index map (order-independent)
  const colIndex: { [key: string]: number } = {};
  headers.forEach((h, i) => { colIndex[h] = i; });

  // Helper: read a numeric value by column name (handles commas, %, negatives)
  const readNum = (values: string[], colName: string): number => {
    const idx = colIndex[colName];
    if (idx === undefined || idx >= values.length) return 0;
    const raw = values[idx].trim();
    if (!raw) return 0;
    const clean = raw.replace(/,/g, '').replace(/%/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  };

  // Helper: read a string value by column name
  const readStr = (values: string[], colName: string): string => {
    const idx = colIndex[colName];
    if (idx === undefined || idx >= values.length) return '';
    return values[idx].trim();
  };

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
    const cagr = (holdingPeriodYears > 0 && initialCost > 0 && finalNetValue > 0)
      ? (Math.pow(finalNetValue / initialCost, 1 / holdingPeriodYears) - 1) * 100
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
