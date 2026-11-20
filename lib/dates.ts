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
/**
 * The date N months before a YYYY-MM-DD date: monthsBeforeIso('2026-11-20', 3) = '2026-08-20'.
 * When that month is shorter, the day is pulled back to its last day, so one month before
 * 31 March is 28/29 February (JavaScript's own setMonth would overshoot to 3 March).
 * Used by the Ranking tab's 1M / 3M / 6M buttons.
 */
export function monthsBeforeIso(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const total = y * 12 + (m - 1) - months;            // months counted from year 0
  const year = Math.floor(total / 12), month = total % 12;   // month is 0 = January
  const lastDay = new Date(year, month + 1, 0).getDate();    // day 0 of next month = last day of this one
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month + 1)}-${pad(Math.min(d, lastDay))}`;
}

export function periodStartIso(period: string, today: Date = new Date()): string {
  const m = /^(\d+)Y$/.exec(period);
  if (!m) return '';
  const d = new Date(today.getFullYear() - Number(m[1]), today.getMonth(), today.getDate());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
