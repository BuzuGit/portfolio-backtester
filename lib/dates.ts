/*
  SMALL DATE HELPERS shared by the screen and the calculation files in lib/.
*/

/** Convert a Date to "YYYY-MM" string (e.g. 2024-02). Used everywhere to compare
 *  transaction dates against monthly price data rows. */
export const toYM = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Month abbreviations for X-axis date labels. */
export const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
