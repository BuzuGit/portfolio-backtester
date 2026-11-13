/*
  XIRR: the money-weighted annual return of a set of dated cash flows (as Excel's XIRR).
  Moved word for word from the main screen file; tests in lib/xirr.test.mjs.
*/

/**
 * XIRR (Extended Internal Rate of Return) — same concept as Excel's XIRR formula.
 *
 * Think of it like this: if you made multiple investments and withdrawals at different
 * dates, XIRR tells you the single annual interest rate that would produce the same result.
 *
 * Uses Newton-Raphson iteration (a mathematical technique to find where a function equals zero).
 * Cash flows: negative = money going out (buying), positive = money coming back (selling).
 *
 * @returns Annual rate as a percentage, or null if calculation fails
 */
export const calculateXIRR = (cashFlows: { date: Date; amount: number }[]): number | null => {
  if (cashFlows.length < 2) return null;

  const d0 = cashFlows[0].date.getTime();
  const MS_PER_YEAR = 365.25 * 86400000; // milliseconds in a year

  // Held for LESS THAN A YEAR: report the plain total return instead of annualising it.
  // Annualising a few months blows small moves up into silly numbers (−5.8% over ten weeks
  // "becomes" −32% a year). Total return here = everything that came back (sale proceeds or
  // today's value, plus dividends) vs everything paid in — the same figure as the PnL %.
  // Measured from the first flow to the last: first buy -> today (open) or -> the sale (closed).
  // Every caller is on the Positions tab or the Markets Holdings page, so this applies to all.
  const spanMs = Math.max(...cashFlows.map(cf => cf.date.getTime())) - Math.min(...cashFlows.map(cf => cf.date.getTime()));
  if (spanMs < MS_PER_YEAR) {
    const paidIn = cashFlows.reduce((s, cf) => s + (cf.amount < 0 ? -cf.amount : 0), 0);
    const gotBack = cashFlows.reduce((s, cf) => s + (cf.amount > 0 ? cf.amount : 0), 0);
    return paidIn > 0 ? ((gotBack - paidIn) / paidIn) * 100 : null;
  }

  // NPV (Net Present Value) at a given rate
  // If NPV = 0, we found the correct rate (that's what XIRR solves for)
  const npv = (rate: number): number => {
    return cashFlows.reduce((sum, cf) => {
      const years = (cf.date.getTime() - d0) / MS_PER_YEAR;
      return sum + cf.amount / Math.pow(1 + rate, years);
    }, 0);
  };

  // Derivative of NPV (needed for Newton-Raphson to know which direction to adjust)
  const dnpv = (rate: number): number => {
    return cashFlows.reduce((sum, cf) => {
      const years = (cf.date.getTime() - d0) / MS_PER_YEAR;
      return sum - years * cf.amount / Math.pow(1 + rate, years + 1);
    }, 0);
  };

  // Newton-Raphson: start with a guess and iteratively improve
  let rate = 0.1; // Initial guess: 10% annual return
  for (let i = 0; i < 100; i++) {
    const f = npv(rate);
    const df = dnpv(rate);
    if (Math.abs(df) < 1e-10) return null; // derivative too small, can't converge
    const newRate = rate - f / df;
    if (isNaN(newRate) || !isFinite(newRate)) return null; // guard against NaN/Infinity
    if (Math.abs(newRate - rate) < 1e-7) return newRate * 100; // converged!
    rate = newRate;
    // Safety: if rate goes crazy, bail out
    if (rate < -0.99 || rate > 100) return null;
  }
  return rate * 100; // return best guess as percentage
};
