/*
  SMALL DATE HELPERS shared by the screen and the calculation files in lib/.
*/

/** Convert a Date to "YYYY-MM" string (e.g. 2024-02). Used everywhere to compare
 *  transaction dates against monthly price data rows. */
export const toYM = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Month abbreviations for X-axis date labels. */
export const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * The first date (YYYY-MM-DD, local time) a period button covers: "3Y" on 20 Nov 2026 is
 * "2023-11-20". "Max" (or anything that isn't "<n>Y") gives "", which every date string is >= to,
 * so callers can always filter with `date >= periodStartIso(period)`.
 * Used by both asset-allocation charts so their period buttons follow one rule.
 */
export function periodStartIso(period: string, today: Date = new Date()): string {
  const m = /^(\d+)Y$/.exec(period);
  if (!m) return '';
  const d = new Date(today.getFullYear() - Number(m[1]), today.getMonth(), today.getDate());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
