/*
  SETTINGS LISTS

  The fixed choices offered by the Backtest and Positions controls: quick date ranges, currency
  symbols and options, the CPI series, and the tooltip that spells out each FX conversion. Moved
  word for word from the one big PortfolioBacktester.tsx so the tab files can share them.
*/
import type { PortfolioAsset } from '@/lib/backtest';

// The Backtest tab's quick date ranges, shortest first. DatePreset is "one of these", so adding a
// range here is the only change the code needs.
export const DATE_PRESETS = ['YTD', '1Y', '2Y', '3Y', '4Y', '5Y', '6Y', '7Y', '8Y', '9Y', '10Y', 'Max'] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];




// Currency symbols for display formatting
export const CURRENCY_SYMBOLS: { [key: string]: string } = {
  PLN: 'zl', USD: '$', SGD: 'S$', EUR: '€', CHF: 'CHF', '': '$'
};

// Portfolio base currency options
// Empty = no conversion (assets stay in their native currencies)
export const CURRENCY_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '-' },
  { value: 'PLN', label: 'PLN' },
  { value: 'USD', label: 'USD' },
  { value: 'SGD', label: 'SGD' },
];

// ---------------------------------------------------------------------------
// BACKTEST TAB — per-portfolio base currency
// ---------------------------------------------------------------------------
// Kept separate from CURRENCY_OPTIONS above (which the Positions tab uses) so this
// list can grow without changing that tab.
//
// Why the odd "xxx" in the labels: this dropdown picks a TARGET currency, and the
// exact FX pair applied depends on each asset's OWN currency. Display everything in
// PLN and a USD asset is multiplied by USDPLN while an SGD asset is multiplied by
// SGDPLN — so no single pair name is true for the whole portfolio. "xxx" is the
// wildcard for "whatever the asset's own currency is", and the dropdown's tooltip
// (see describeFxConversion) resolves it for the assets actually held.
export const PORTFOLIO_CURRENCY_OPTIONS: { value: string; label: string }[] = [
  { value: '',    label: '-' },                 // no conversion — every asset keeps its native currency
  { value: 'PLN', label: 'PLN (←xxxPLN)' },     // e.g. USD asset × USDPLN, SGD asset × SGDPLN
  { value: 'USD', label: 'USD (←xxxUSD)' },     // e.g. SGD asset × SGDUSD, PLN asset ÷ USDPLN
  { value: 'EUR', label: 'EUR (←xxxEUR)' },     // uses EURPLN, which the price sheet carries back to 2009
  { value: 'CHF', label: 'CHF (←xxxCHF)' },     // uses CHFPLN, likewise
  { value: 'SGD', label: 'SGD (←xxxSGD)' },     // e.g. USD asset × USDSGD, PLN asset ÷ SGDPLN
];

/**
 * The FX operation a single asset undergoes when the portfolio is shown in `target`.
 *
 * Conversion always routes through PLN (see getConversionRate), which in plain terms means:
 *   SGD asset → PLN : × SGDPLN      (straight multiplication by the pair)
 *   PLN asset → USD : ÷ USDPLN      (the reverse direction — division, not multiplication)
 *   SGD asset → USD : × SGDUSD      (SGDPLN ÷ USDPLN IS the SGDUSD cross rate)
 * Returns a short human-readable string like "× USDPLN" for the tooltip.
 */
export const fxOperationLabel = (native: string, target: string): string => {
  if (!target || native === target) return '× 1';        // nothing to do
  if (target === 'PLN') return `× ${native}PLN`;          // into the hub currency
  if (native === 'PLN') return `÷ ${target}PLN`;          // out of the hub currency
  return `× ${native}${target}`;                          // cross rate, e.g. SGDUSD
};

/**
 * Builds the Ccy dropdown's tooltip: one line per native currency present in the
 * portfolio, spelling out the exact pair those assets are converted with.
 * Assets are grouped by currency (not listed one by one) so the tooltip stays short.
 *
 * @param assets    the portfolio's legs
 * @param target    the selected base currency ('' = no conversion)
 * @param nativeOf  looks up an asset's own currency (the component's getAssetCurrency)
 */
export const describeFxConversion = (
  assets: PortfolioAsset[],
  target: string,
  nativeOf: (ticker: string) => string
): string => {
  const header = target
    ? `Converts every asset to ${target}:`
    : 'No conversion — each asset stays in its own currency.';

  const tickers = assets.filter(a => a.asset).map(a => a.asset);
  if (tickers.length === 0 || !target) return header;

  // Group tickers by their native currency, preserving the order they appear in
  const byCcy = new Map<string, string[]>();
  for (const ticker of tickers) {
    const ccy = nativeOf(ticker);
    if (!byCcy.has(ccy)) byCcy.set(ccy, []);
    const list = byCcy.get(ccy)!;
    if (!list.includes(ticker)) list.push(ticker);  // same asset twice = list it once
  }

  const lines = Array.from(byCcy.entries()).map(([ccy, list]) => {
    // Cap the ticker list so a 12-asset portfolio doesn't produce a wall of text
    const shown = list.slice(0, 4).join(', ') + (list.length > 4 ? `, +${list.length - 4} more` : '');
    return `${shown} (${ccy}) ${fxOperationLabel(ccy, target)}`;
  });

  return [header, ...lines].join('\n');
};

// Available CPI tickers for inflation adjustment
// When selected, portfolio values are divided by the CPI index (normalized to start date)
// to show "real" purchasing power instead of nominal values
export const CPI_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '-' },          // No inflation adjustment (nominal values)
  { value: 'CPIMPL', label: 'PL' },   // Polish CPI
  { value: 'CPIMUS', label: 'US' },   // US CPI
  { value: 'CPIMSG', label: 'SG' },   // Singapore CPI
];
