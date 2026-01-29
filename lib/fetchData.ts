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

// The URL to your published Google Sheet (exports as CSV format)
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ1Q5jNM3Qq52UZwmQyRQrG_YER6-RNnagk2GG9Os65kFPtkNTpNtZywaoMEV8w_xDDuu0eRdEoPWgn/pub?output=csv';

// Type definitions - these describe the shape of our data
// (TypeScript uses these to catch errors and provide autocomplete)

export interface AssetRow {
  date: string;                    // e.g., "2020-01-31"
  [assetName: string]: number | string;  // e.g., { "SPY": 320.45, "BND": 85.23 }
}

export interface ParsedData {
  data: AssetRow[];      // Array of rows, each with date and asset prices
  assets: string[];      // List of asset names found in the CSV
}

/**
 * Fetches and parses CSV data from the Google Sheet.
 *
 * @returns Promise containing the parsed data and list of assets
 * @throws Error if fetch fails or data is invalid
 */
export async function fetchSheetData(): Promise<ParsedData> {
  // Step 1: Fetch the raw CSV text from Google Sheets
  // The 'no-cache' option ensures we always get fresh data
  const response = await fetch(SHEET_URL, {
    cache: 'no-cache'  // Don't use cached version - always get latest
  });

  // Check if the fetch was successful
  if (!response.ok) {
    throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
  }

  // Get the CSV as plain text
  const csvText = await response.text();

  // Step 2: Parse the CSV into structured data
  return parseSheetData(csvText);
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
function parseSheetData(csvText: string): ParsedData {
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
