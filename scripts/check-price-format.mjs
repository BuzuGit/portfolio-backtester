/*
  check-price-format.mjs — a guard rail for the one price-formatting rule.

  WHY THIS EXISTS
  ---------------
  Asset prices are printed by exactly one helper, `formatPrice` at the top of
  components/PortfolioBacktester.tsx:

      below 2   -> 3 decimals      2-99      -> 2 decimals
      100-999   -> 1 decimal       1000+     -> 0 decimals, with separators

  That is a CONVENTION, not something the compiler can enforce. Writing
  `newPrice.toFixed(2)` in a new tab compiles, typechecks and deploys perfectly
  happily — it just quietly disagrees with every other screen. That is exactly how
  the app ended up with five competing price formats before they were unified.

  So this script looks for the mistake instead. Run it before publishing:

      npm run check:prices

  WHAT IT FLAGS
  -------------
  Any expression whose NAME mentions "price" that is formatted by hand, i.e. with
  `.toFixed(n)` or a `toLocaleString` carrying explicit fraction digits, rather
  than being passed through `formatPrice`.

  It deliberately inspects the expression being formatted, NOT the whole line — a
  line may legitimately contain both a formatPrice call and a percentage, e.g.
      `($${formatPrice(p.startPrice)}) = ${data.return.toFixed(2)}%`
  and flagging that would train everyone to ignore the warnings.

  WHAT IT IGNORES, AND WHY
  ------------------------
  Not every number with "price" in its name is a per-share price:
    * ...Pct / ...Percent  — percentages (priceVsSoldPct), formatted as percentages
    * ...Idx               — rebased growth indices on the Monthly charts, not prices
    * priceDecimals(...)   — the helper's own internals
  Money totals (portfolio value, invested capital, P&L, commissions, cash balances)
  never match, because they aren't named "price".

  If this flags something that genuinely isn't a per-share price, widen IGNORE below
  rather than muting the whole check.
*/

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// The files worth scanning. Prices are only ever rendered in the UI layer.
const FILES = ['components/PortfolioBacktester.tsx'];

// An expression counts as a price if its name mentions "price"...
const LOOKS_LIKE_PRICE = /price/i;
// ...unless it is one of these, which merely borrow the word.
const IGNORE = [/Pct$/, /Percent$/, /Idx$/, /^priceDecimals$/];

// Hand-formatting we object to: `X.toFixed(2)` and `X.toLocaleString(... FractionDigits ...)`.
// The capture group is the expression being formatted.
const HAND_FORMATTED = [
  /([A-Za-z_$][\w$.[\]!]*)\.toFixed\(\s*\d+\s*\)/g,
  /([A-Za-z_$][\w$.[\]!]*)\.toLocaleString\(([^;]*?FractionDigits[^;]*?)\)/g,
];

/** The bit of `a.b.cPrice!` that names the value — the last path segment. */
const lastSegment = (expr) =>
  expr.replace(/[!\s]/g, '').split(/[.[\]]/).filter(Boolean).pop() ?? expr;

const findings = [];

for (const rel of FILES) {
  const lines = readFileSync(join(repoRoot, rel), 'utf8').split(/\r?\n/);

  lines.forEach((line, i) => {
    for (const pattern of HAND_FORMATTED) {
      pattern.lastIndex = 0;
      let hit;
      while ((hit = pattern.exec(line)) !== null) {
        const expr = hit[1];
        const name = lastSegment(expr);
        if (!LOOKS_LIKE_PRICE.test(name)) continue;
        if (IGNORE.some((re) => re.test(name))) continue;
        findings.push({ file: rel, line: i + 1, expr, text: line.trim() });
      }
    }
  });
}

if (findings.length === 0) {
  console.log('OK - every price render goes through formatPrice.');
  process.exit(0);
}

console.error(`Found ${findings.length} price value(s) formatted by hand instead of via formatPrice:\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`    ${f.expr} is a price - wrap it: formatPrice(${f.expr})`);
  console.error(`    ${f.text.slice(0, 120)}\n`);
}
console.error('Use formatPrice(...) so this price matches every other screen in the app.');
console.error('If one of these is not really a per-share price, add it to IGNORE in this script.');
process.exit(1);
