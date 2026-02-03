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
const DATA_SHEET_URL = `${SHEET_BASE_URL}?gid=0&output=csv`;
const LOOKUP_SHEET_URL = `${SHEET_BASE_URL}?gid=166035960&output=csv`;

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
}

export interface ParsedData {
  data: AssetRow[];           // Array of rows, each with date and asset prices
  assets: string[];           // List of asset names found in the CSV
  lookup: AssetLookup[];      // Lookup table with ticker-to-name mappings
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
  // Fetch both sheets in parallel for speed
  const [dataResponse, lookupResponse] = await Promise.all([
    fetch(DATA_SHEET_URL, { cache: 'no-cache' }),
    fetch(LOOKUP_SHEET_URL, { cache: 'no-cache' })
  ]);

  // Check if both fetches were successful
  if (!dataResponse.ok) {
    throw new Error(`Failed to fetch price data: ${dataResponse.status} ${dataResponse.statusText}`);
  }
  if (!lookupResponse.ok) {
    throw new Error(`Failed to fetch lookup table: ${lookupResponse.status} ${lookupResponse.statusText}`);
  }

  // Get CSV text from both responses
  const [dataCsvText, lookupCsvText] = await Promise.all([
    dataResponse.text(),
    lookupResponse.text()
  ]);

  // Parse both CSVs
  const { data, assets } = parseSheetData(dataCsvText);
  const lookup = parseLookupTable(lookupCsvText);

  console.log(`Lookup table has ${lookup.length} assets: ${lookup.map(l => l.ticker).join(', ')}`);

  return { data, assets, lookup };
}

/**
 * Parses the lookup table CSV (ticker -> asset name, currency, FX ticker).
 * Expects four columns: Ticker, Asset Name, Currency, FX
 *
 * Column 1: Ticker (e.g., "SPY")
 * Column 2: Asset Name (e.g., "S&P 500 ETF")
 * Column 3: Currency (e.g., "USD", "SGD", "PLN")
 * Column 4: FX (e.g., "USDPLN", "SGDPLN", or empty for PLN assets)
 *
 * @param csvText - The raw CSV file content
 * @returns Array of ticker-to-name-currency-fx mappings
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

    if (ticker && name) {
      lookup.push({ ticker, name, currency, fx });
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
