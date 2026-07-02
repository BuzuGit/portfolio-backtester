# Portfolio Backtester - Learning Guide

Welcome! This document explains everything about this project in plain language. Think of it as a friendly tour guide through the code.

---

## What Does This App Do?

Imagine you're a time traveler with a financial mission: "If I had invested $10,000 back in 2010, putting 60% in stocks and 40% in bonds, how much would I have today?"

That's exactly what a **backtester** does. It takes historical price data and simulates what would have happened if you'd followed a specific investment strategy. No actual time travel required!

**Key features:**
- Load historical price data from a Google Sheet
- Create multiple portfolio configurations (e.g., "60% stocks, 40% bonds")
- Run simulations to see how those portfolios would have performed
- View beautiful charts and detailed statistics
- See monthly returns broken down by year
- Analyze closed positions with XIRR, "what if I kept it?" analysis, and comparison to alternative investments

---

## How the System is Designed (Architecture)

Think of this app like a restaurant:

```
┌─────────────────────────────────────────────────────────┐
│                    YOUR BROWSER                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Next.js App                          │    │
│  │  ┌─────────┐    ┌─────────────────────────────┐  │    │
│  │  │  page   │───▶│   PortfolioBacktester       │  │    │
│  │  │  .tsx   │    │   Component                 │  │    │
│  │  └─────────┘    │                             │  │    │
│  │                 │  ┌─────────┐  ┌──────────┐  │  │    │
│  │                 │  │ Charts  │  │ Tables   │  │  │    │
│  │                 │  │(Recharts)│  │          │  │  │    │
│  │                 │  └─────────┘  └──────────┘  │  │    │
│  │                 └─────────────────────────────┘  │    │
│  │                           │                       │    │
│  │                           ▼                       │    │
│  │                 ┌─────────────────────┐          │    │
│  │                 │   fetchData.ts      │          │    │
│  │                 │   (Data Fetching)   │          │    │
│  │                 └─────────────────────┘          │    │
│  └─────────────────────────────────────────────────┘    │
│                           │                              │
└───────────────────────────│──────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │      Google Sheets          │
              │   (Your Published CSV)      │
              └─────────────────────────────┘
```

**The Flow:**
1. User opens the app
2. App automatically fetches data from Google Sheets
3. User configures portfolios and runs backtest
4. App calculates returns and displays results

---

## Codebase Structure

Here's what each file does:

```
portfolio-backtester/
│
├── app/                          # Next.js App Router folder
│   ├── layout.tsx               # The "wrapper" - sets up HTML structure
│   ├── page.tsx                 # Home page - loads the backtester
│   └── globals.css              # Global styles (Tailwind imports)
│
├── components/
│   └── PortfolioBacktester.tsx  # THE MAIN EVENT - all the backtest logic
│
├── lib/
│   └── fetchData.ts             # Handles fetching & parsing CSV from Google
│
├── package.json                 # Project dependencies (like a shopping list)
├── next.config.js               # Next.js settings
├── tailwind.config.js           # Tailwind CSS settings
├── tsconfig.json                # TypeScript settings
└── LEARN.md                     # You are here!
```

### Key Files Explained

**`components/PortfolioBacktester.tsx`** - This is the heart of the app. It's a large component (~6,200 lines) that breaks down into clear sections:
- State management (tracking what data we have, user selections)
- Data loading (fetching from Google Sheets)
- Portfolio management (adding/removing assets)
- Backtest calculations (the math that simulates investing)
- Closed positions analysis (XIRR, comparison charts, dashboard stats)
- UI rendering (displaying forms, charts, tables across 8 tabs)

**`lib/fetchData.ts`** - A helper that:
- Fetches CSV text from your Google Sheet URL (4 sheets in parallel: prices, years, lookup, closed positions)
- Parses the CSV (handling tricky cases like commas inside quoted fields, and multiline headers)
- Returns clean, structured data including computed fields like CAGR and total returns

---

## Technologies Used

### Next.js (The Framework)
Think of Next.js as a pre-built house structure. Instead of building everything from scratch (walls, plumbing, electrical), you get a solid foundation and focus on decorating.

**Why we chose it:**
- Easy deployment to Vercel (one command!)
- Built-in routing (just create files in `app/` folder)
- Great developer experience
- Industry standard for React apps

### React (The UI Library)
React lets you build UIs from "components" - reusable building blocks. Like LEGO for websites.

**Key concepts used:**
- `useState` - Remember things (like "what portfolios did the user create?")
- `useEffect` - Do something when the page loads (like "fetch data")
- Components - Reusable UI pieces

### TypeScript (The Safety Net)
JavaScript with "training wheels" that catch mistakes before they become bugs.

```typescript
// TypeScript knows this is wrong and warns you:
const price: number = "one hundred"; // Error! Can't assign string to number
```

### Tailwind CSS (The Styling)
Instead of writing CSS files, you add classes directly to elements:

```html
<!-- Traditional CSS approach -->
<div class="my-button">Click me</div>
/* In a separate CSS file */
.my-button { padding: 1rem; background: blue; border-radius: 0.5rem; }

<!-- Tailwind approach - everything inline -->
<div class="p-4 bg-blue-500 rounded-lg">Click me</div>
```

**Why it's great:** No context switching between files. See styling right where you see the element.

### Recharts (The Charts)
A React library for drawing charts. We use:
- `LineChart` - Shows portfolio value over time
- `BarChart` / `ComposedChart` - Annual returns, portfolio breakdowns
- `ScatterChart` / `Scatter` - Risk/Return scatter plot on the Correlations tab
- `ReferenceLine` - Horizontal/vertical marker lines (e.g., the red zero line)
- `ResponsiveContainer` - Makes charts resize on different screens

---

## Decision Log

### Why fetch from Google Sheets instead of a database?

**Decision:** Use a published Google Sheet as the data source.

**Why:**
- Zero cost (no database hosting fees)
- Easy to update (just edit the spreadsheet)
- No backend needed (the app is purely frontend)
- Google handles the heavy lifting

**Tradeoff:** Limited to ~5MB of data. For larger datasets, you'd need a proper backend.

### Why remove localStorage persistence?

**Decision:** Don't cache data locally, always fetch fresh.

**Why:**
- Data always comes from the source of truth (your Google Sheet)
- No stale data issues
- Simpler code (no sync logic)
- Users clicking "Refresh" actually refreshes

### Why does the Closed tab have separate filter state?

**Decision:** Give the Closed tab its own independent filter state (`closedSelectedTickers`, `closedSelectedClasses`, `closedSelectedCurrencies`) instead of sharing with the Monthly Prices tab.

**Why:**
- The Closed tab only shows assets that appear in BOTH the lookup table and the closed positions data — a much smaller set than all assets
- Default behavior differs: other tabs start with everything selected, but Closed starts with nothing selected (you choose what to analyze)
- Prevents confusing crosstalk: switching between tabs shouldn't reset your filters

### Why normalize comparison prices instead of showing raw prices?

**Decision:** When comparing "what if I invested in CSPX instead of selling IWDA?", normalize the comparison asset's price to match the sold asset's price at the sale date.

**Why:**
- Raw prices are meaningless to compare (IWDA at $106 vs CSPX at $500 — apples and oranges)
- Normalizing makes the chart visually intuitive: both lines start at the same point on the sale date, and you can immediately see which grew more
- The math: `normalizedPrice = comparisonPrice × (baseAssetPriceAtSaleDate / comparisonPriceAtSaleDate)`

### Why use 'use client' for the main component?

**Decision:** Mark PortfolioBacktester as a client component.

**Why:**
- Charts need the browser's canvas (can't run on server)
- We use useState/useEffect (need browser)
- All the interactivity happens in browser

This is a fundamental Next.js concept: some things must run in the browser, others can run on the server.

---

## Lessons Learned

### 1. CSV Parsing is Trickier Than It Looks

**The Bug:** Early version broke when asset prices had commas (e.g., "1,234.56").

**The Fix:** Created a proper CSV parser that:
- Handles quoted fields
- Removes commas from numbers
- Deals with escaped quotes

**Lesson:** Never assume data is clean. Always handle edge cases.

### 2. TypeScript Catches Real Bugs

**The Bug:** Tried to call `.toFixed(2)` on `undefined` when an asset had no data.

**TypeScript's Warning:** "Object is possibly 'undefined'"

**The Fix:** Added null checks before calculations.

**Lesson:** Those TypeScript errors are friends, not enemies.

### 3. The Rebalancing Calculation Matters

**The Bug:** Initial version assumed "buy and hold" but users wanted periodic rebalancing.

**The Fix:** Added proper rebalancing logic that:
- Tracks shares owned (not just percentages)
- Checks if enough time has passed for rebalancing
- Recalculates share counts when rebalancing

**Lesson:** Investment math is nuanced. A 60/40 portfolio that never rebalances will drift far from 60/40 over time.

### 4. CORS and Fetch

**The Challenge:** Browsers block requests to other domains for security ("CORS").

**Why Google Sheets Works:** When you "publish" a Google Sheet, Google adds the right headers to allow browser requests.

**Lesson:** When fetching data in a browser, you need the server's permission.

### 5. Multiline CSV Headers Need Special Handling

**The Bug:** The Closed positions spreadsheet had column headers with line breaks inside quoted fields (e.g., `"Inv\nDate"`). The naive `split('\n')` approach tore the header row apart, so every column name was wrong and nothing parsed.

**The Fix:** Created a `splitCSVRows()` function that tracks whether it's inside a quoted field before splitting on newlines. Also normalized headers by collapsing whitespace: `"Inv\nDate"` becomes `"Inv Date"`.

**Lesson:** CSV parsing has more edge cases than you'd think. Quoted fields can contain newlines, commas, and even quotes themselves. Always test with real data, not just clean examples.

### 6. XIRR: When Simple Returns Lie

**The Concept:** If you bought stock in 5 separate batches over 3 years and sold all at once, what was your "real" return? A simple total return (money out minus money in) doesn't account for *when* you invested. Money invested earlier was at risk longer, so it should count more.

**XIRR (Extended Internal Rate of Return)** solves this. It's the annualized return that makes all your cash flows sum to zero when discounted. Think of it as: "What savings account interest rate would have given me the same result, considering my exact timing?"

**Implementation:** Uses the Newton-Raphson method — an iterative algorithm that starts with a guess and refines it until it converges. Each buy is a negative cash flow on its date; each sale is a positive cash flow on its date.

**Edge case:** Sometimes Newton-Raphson doesn't converge (e.g., very unusual cash flow patterns). The app shows "N/A" instead of crashing.

### 7. TypeScript's downlevelIteration Trap

**The Bug:** `[...new Set(dates)]` compiled fine but failed at runtime because TypeScript's default target (ES5) doesn't know how to spread Sets.

**The Fix:** Use `Array.from(new Set(dates))` instead. The `Array.from()` approach works at all TypeScript target levels.

**Lesson:** Just because TypeScript doesn't show an error doesn't mean it'll work at runtime. Know your `tsconfig.json` target.

### 8. Recharts Auto-Ticks Don't Guarantee Round Numbers

**The Bug:** Added a red dashed `ReferenceLine` at y=0 to mark the "zero return" boundary on the scatter plot. It visually appeared *slightly above* the "0%" tick label on the Y axis, making the chart look broken.

**Why it happened:** Recharts generates Y axis tick positions automatically based on the data range. It tries to pick "nice" intervals, but those auto-calculated ticks don't always land exactly on 0. So a tick might be placed at -0.4 (which the formatter rounds and displays as "0%"), while the `ReferenceLine` draws at the mathematically exact 0. Visually, they look different even though they represent the same value.

**The Fix:** Explicitly generate the tick values in code, making sure 0 is always in the list. Pass those to the `ticks` prop on `<YAxis>`. Also fixed the formatter to use `Math.round(v)` instead of `v.toFixed(0)` — the latter can produce the string "-0" for tiny negative numbers, which looks weird.

**Lesson:** Whenever you combine a `ReferenceLine` at a specific value (like 0) with an auto-ticked axis, Recharts may not place a tick exactly there. Always generate explicit ticks if exact alignment matters.

### 9. Column Names in CSVs Must Match Exactly — Including Punctuation

**The Bug:** Added a new "Account" column to the Google Sheet. The parser was told to look for a column called `Account`, but the actual column header in the sheet was `Flow to account:` (note the colon at the end). Every transaction came back with an empty account, so the "By Account" breakdown showed 100% "Unknown".

**The Fix:** Always log the actual parsed headers (`console.log('Sheet headers:', headers.join(' | '))`) and match what the spreadsheet actually says — character for character, including spaces, colons, and capitalisation.

**Lesson:** When a new data field shows up as empty/unknown, the *first* thing to check is the raw CSV headers in the browser console. Don't guess the column name — read it.

### 10. `overflow-hidden` Hides Valuable Information on Small Bar Charts

**The Bug:** The By Currency and By Account horizontal bar charts used `overflow-hidden` on the bar container, so the value label was only shown if `barPct >= 15`. Small bars (under 15% of the largest bar) showed nothing — the user had no idea what the value was.

**The Fix:** Remove `overflow-hidden` from the bar container div, always render the label, and use `whitespace-nowrap` so it spills past the end of the colored bar. For very small bars (under ~10%) the text color is set to match the bar color (instead of white) so it stays readable against the gray background.

**Lesson:** Never hide data from the user just to keep the UI tidy. A number that overflows looks fine; a missing number is frustrating.

### 11. Proportional Allocation for Multi-Account Positions

**The Design Decision:** An asset can be purchased in multiple brokerage accounts over time. When computing "By Account" current value, you can't just say "CSPX belongs to Saxo" — it might be split across accounts.

**The Approach:** For each open position, look at all "Purchase of Asset" transactions grouped by account. Each account's share of the *invested* amount becomes its proportion of the *current market value*. For example, if 70% of CSPX purchases came from IB and 30% from Saxo, IB gets 70% of CSPX's current value in the rollup.

**Why this works:** The total "By Account" always equals the total "By Currency" because we're just re-slicing the same current values, not re-computing them. Proportional allocation is the fairest way to attribute market value to accounts without tracking individual lot ownership.

**Why dividends/interest are excluded:** Dividends don't tell you *where* an asset was bought — they're a return on the asset. Including them would distort the account breakdown. Only "Purchase of Asset" rows carry account ownership information.

### 12. Publishing to GitHub Without the gh CLI

**The situation:** The `gh` (GitHub CLI) tool wasn't installed on this machine, so the usual `gh pr create` command failed.

**The workaround:** Windows stores your GitHub login credentials in the **Credential Manager** (the built-in Windows password vault). We can extract the token from there using a small C# snippet in PowerShell, then call the GitHub REST API directly to create and merge pull requests.

The key steps:
1. Use `Add-Type` in PowerShell to load the Windows `advapi32.dll` credential API
2. Call `CredRead("git:https://github.com", ...)` to retrieve the stored token
3. Use `Invoke-RestMethod` to hit `https://api.github.com/repos/.../pulls` (create PR) and `.../pulls/1/merge` (merge)

**Lesson:** The `gh` CLI is just a convenience wrapper. Everything it does can be done via the GitHub REST API with a token. And on Windows, that token is often already saved in Credential Manager from when you first logged in with Git.

### 13. Convert Once at the Source, Not in Every Section

**The Feature:** The Monthly tab's asset-detail view (the panel that opens when you click an asset) now has five currency buttons — PLN / USD / EUR / CHF / SGD. Clicking one re-expresses *everything* below it (statistics, the price/drawdown/SMA charts, the returns bar chart, the Returns table, the Prices table) in that currency. By default the button matching the asset's own native currency is highlighted, so you see the "original" numbers unless you deliberately switch.

**The temptation:** Convert each section separately — loop over the stats and convert them, loop over the chart data and convert it, loop over each table and convert it. That's a lot of duplicated conversion code, and every new section you add later is one more place you can forget to convert.

**The better approach:** Every one of those sections is ultimately derived from *one thing* — the asset's monthly price series read straight from the sheet. So we convert the prices **once, at the point where they're read** (inside `getMonthlyChartData`, and in the `assetReturnPoints` array that feeds the two tables), and let all the downstream math recompute naturally. A drawdown computed from PLN prices is automatically a PLN drawdown; a return computed from PLN prices is automatically a PLN return. One conversion, everything follows.

**The elegant payoff — the correlation "just worked":** The special requirement was that Corr IWDA / Corr VDTA should always compare the asset (in the selected currency) against the benchmark **in its native USD** — the benchmark must *not* convert. Because the correlation function already reads the asset from the (now-converted) price series on one side and reads IWDA/VDTA raw from the sheet on the other, this fell out for free with zero special-casing. When we converted only the asset's prices at the source, the "benchmark stays in USD" behaviour came along automatically.

**Reusing the existing FX engine:** We didn't write new currency math. The app already had `getConversionRate(row, fromCurrency, toCurrency)`, which routes any currency pair through PLN as a hub (all FX data is stored as `xxxPLN` columns — USDPLN, EURPLN, CHFPLN, SGDPLN). A nice safety property: converting a currency into itself returns a rate of `1`, so the default "native currency" view is a mathematical no-op — the numbers are guaranteed identical to before the feature existed.

**A subtle verification gotcha:** While testing in the live preview, I clicked a new asset and immediately read which currency button was highlighted — and got the *old* value. React hadn't re-rendered yet; a `.click()` fires the handler synchronously, but the DOM reflecting the new state only updates on the next tick. Reading again in a fresh step showed the correct, updated highlight. **Lesson within the lesson:** after triggering a state change in a React app, don't read the resulting DOM in the same synchronous breath — let the render flush first.

**Lesson:** When many outputs derive from one input, transform the input once rather than transforming each output. It's less code, it's impossible for sections to disagree with each other, and sometimes a tricky requirement (like "convert this side but not that side") solves itself.

---

## How Good Engineers Think

### 1. Separation of Concerns

Notice how `fetchData.ts` ONLY handles fetching data. It doesn't know about portfolios or backtests. This makes code:
- Easier to test
- Easier to change
- Easier to understand

### 2. Types as Documentation

The TypeScript interfaces at the top of the component (`Portfolio`, `BacktestResult`, etc.) serve as living documentation. Anyone can look at them to understand the data shapes.

### 3. Comments Explain "Why", Not "What"

Good comment:
```typescript
// Auto-adjust first asset if we changed weight of another asset
// This keeps total at 100% automatically for better UX
```

Bad comment:
```typescript
// Set newAssets[0].weight to 100 minus other weights
```

The code already shows WHAT. Comments should explain WHY.

### 4. Fail Gracefully

The app doesn't crash if Google Sheets is slow or unavailable. It shows a loading state, catches errors, and displays helpful messages.

---

## Running the App Locally

1. Open a terminal in the project folder

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open http://localhost:3000 in your browser

---

## Deploying to Vercel

The easiest deployment ever:

1. Push your code to GitHub

2. Go to [vercel.com](https://vercel.com)

3. Click "Import Project"

4. Select your GitHub repo

5. Click "Deploy"

That's it! Vercel automatically:
- Detects it's a Next.js project
- Installs dependencies
- Builds the app
- Deploys to a global CDN
- Gives you a URL

---

## Glossary

**CAGR (Compound Annual Growth Rate):** The smoothed annual return. If you invested $100 and ended with $200 after 10 years, CAGR tells you the equivalent yearly return that would get you there.

**Drawdown:** How far the portfolio has fallen from its peak. A -20% drawdown means you're 20% below your highest value.

**Sharpe Ratio:** Return divided by volatility. Higher is better - means more return per unit of risk.

**Volatility:** How much returns bounce around. High volatility = wild swings. Low volatility = steady growth.

**Rebalancing:** Periodically adjusting your portfolio back to target weights. If stocks grow faster than bonds, you sell some stocks and buy bonds to maintain your 60/40 split.

**CSV (Comma-Separated Values):** A simple text format for spreadsheet data. Each line is a row, commas separate columns.

**XIRR (Extended Internal Rate of Return):** The annualized return on an investment where money went in and out at different times. Unlike simple return (which just compares final value to initial value), XIRR accounts for the timing of each cash flow. If you invested $1,000 in January and another $1,000 in June, then sold everything in December, XIRR tells you the true annualized rate of return considering that the January money was invested for 12 months but the June money only for 6.

**Newton-Raphson Method:** An iterative algorithm for finding roots of equations. Start with a guess, calculate how far off you are, adjust the guess, repeat. Used in this app to compute XIRR, since there's no closed-form formula for it.

---

## Questions?

This app is designed to be hackable! Some ideas for extending it:

- Add more statistics (Sortino ratio, Calmar ratio)
- Add benchmarks (compare your portfolio to S&P 500)
- Add more chart types (bar chart of yearly returns)
- Support for contributions (monthly $500 additions)

Happy backtesting! 📈
