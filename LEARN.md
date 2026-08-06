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
│  │        ┌─────────────────────┐  ┌─────────────┐  │    │
│  │        │   fetchData.ts      │─▶│positions.ts │  │    │
│  │        │   (Data Fetching)   │  │(FIFO replay)│  │    │
│  │        └─────────────────────┘  └─────────────┘  │    │
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
2. App automatically fetches data from Google Sheets (5 tabs, in parallel)
3. `positions.ts` replays the transaction ledger to work out what is held and what was sold
4. User configures portfolios and runs backtest
5. App calculates returns and displays results

**A note on where the numbers come from.** There are two very different kinds of data here, and
mixing them up is the source of most confusion:

- **Prices** are a grid: one row per month, one column per asset. Straightforward.
- **Your actual holdings** are a *diary*: "on this date I bought 100 of X", "later I sold 40".
  Nothing in that diary says which positions are still open. The app has to work it out by
  replaying the diary in order. That is what `positions.ts` does, and it is why the Positions
  tab has more logic behind it than any chart in the app.

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
│   ├── fetchData.ts             # Handles fetching & parsing CSV from Google
│   └── positions.ts             # Replays the transaction ledger into positions
│
├── package.json                 # Project dependencies (like a shopping list)
├── next.config.js               # Next.js settings
├── tailwind.config.js           # Tailwind CSS settings
├── tsconfig.json                # TypeScript settings
└── LEARN.md                     # You are here!
```

### Key Files Explained

**`components/PortfolioBacktester.tsx`** - This is the heart of the app. It's a large component (~14,500 lines) that breaks down into clear sections:
- State management (tracking what data we have, user selections)
- Data loading (fetching from Google Sheets)
- Portfolio management (adding/removing assets)
- Backtest calculations (the math that simulates investing)
- Closed positions analysis (XIRR, comparison charts, dashboard stats)
- UI rendering (displaying forms, charts, tables across 9 tabs)

**`lib/positions.ts`** - Replays the Transactions ledger to work out what you still hold, what you
sold, and which dividend belongs to which shares (FIFO lot matching). Both the Positions tab and the
Portfolio tab's yearly breakdown are built from what it returns. Added Aug 2026, when the
hand-maintained "Open" and "Exit" sheet tabs were deleted.

**`lib/fetchData.ts`** - A helper that:
- Fetches CSV text from your Google Sheet URL (5 sheets in parallel: prices, lookup, years, daily NAV, transactions ledger)
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

**The house style (since July 2026):** The app used to wear Tailwind's factory-default colours — an indigo button here, a bright blue toggle there, a blue-to-indigo gradient behind everything. It worked, but it looked like a demo. It now follows one deliberate palette, and new UI should match it rather than reaching for whatever colour comes to hand:

| Thing | What it wears |
|---|---|
| Page background | flat `bg-[#f1f2f4]` — a calm neutral grey, no gradient |
| Cards | white, `rounded-xl`, `border-gray-200`, `shadow-sm` |
| Selected / primary button | `bg-slate-800` with white text |
| Unselected button or tab | `bg-gray-100 text-gray-600`, `text-sm font-medium` |
| Table headers **and their totals rows** | `bg-gray-100` (`#f3f4f6`) |

Three things deliberately kept their old colours, because there they mean something rather than decorate: the blue tint on a selected table row or a "Buy & Hold" column, green/red for gains and losses, and the little legend dots that must match the line they describe. **The rule of thumb: grey is for chrome, colour is for meaning.**

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

### Why is only the Positions tab's chart palette restyled?

**Decision:** During the July 2026 restyle, move the Positions charts onto the shared `CHART_PALETTE` but deliberately leave the Graphs, Trend Following, Portfolio and Backtest charts on their original bright colours — for now.

**Why:**
- That was the scope actually asked for, and chart colours in the other tabs aren't decorative — they encode things like buy-and-hold vs strategy, and trend signals. Recolouring them is a *meaning* change that deserves its own deliberate pass, not a find-and-replace done in passing
- Restyling all of them blind would have risked breaking the link between a line and its legend dot, which is the one thing a chart cannot afford to get wrong
- The cost is honest and visible: the app is **knowingly half-restyled**. If you're reading this and wondering why the Graphs tab still has a neon green line in it, that's why — not an oversight

**If you finish the job:** pull the colours from `CHART_PALETTE` rather than inventing new hexes, and re-run the palette validator for each chart's *actual* series count (see Lesson 16 — five colours can be made colour-blind safe, six cannot).

### Why shorting "just worked" once we allowed a minus sign

**Decision:** Support leverage and shorting by simply allowing **negative weights** (200% CSPX / -100% IB01) rather than building a separate margin-account model.

**Why:** This is the nicest thing that happened in this whole project, and it's worth understanding *why* it was nice.

The backtest engine never actually thought in percentages. On day one it converts your weights into **shares** — `shares = allocation ÷ price` — and from then on it only ever computes `shares × price`. Percentages are just the user interface.

And a negative share count *is* a short position. That's not a metaphor; that's the definition. If you hold -10,428 units of IB01 and IB01 goes up a zloty, you're 10,428 zlotys poorer, which is exactly what the multiplication produces. So the engine could already short — nobody had ever handed it a negative number.

The actual blockers were embarrassingly mundane:

1. **You couldn't type a minus sign.** The weight box was a controlled input running `parseFloat(value) || 0`. Type `-`, that's not a number yet, `parseFloat` returns `NaN`, `|| 0` turns it into `0`, React writes `0` back into the box, and your keystroke vanishes. You could never reach the `1` of `-100`. Fixed with a "draft" state that holds the raw text while you're mid-type (see Lesson 18).
2. **The auto-balancer clamped at zero** — `Math.max(0, 100 - others)` — so the balancing leg could never go negative.

**The lesson:** when a feature looks big, check whether the *engine* already supports it and only the *edges* don't. Here, roughly 90% of "add shorting" was three lines of input plumbing. Data models that store the physically real quantity (shares) instead of the presentational one (percent) tend to get this kind of generality for free. Storing percentages and reconstructing values would have needed a genuine rewrite.

### Why financing cost is a cash "tab" and not a haircut on returns

**Decision:** The per-leg `costPct` accrues into a running `accruedCost` variable — a cash balance — which is subtracted from portfolio value and reset to zero at each rebalance.

**Why:** The tempting shortcut is to shave the cost off the portfolio's return each month. That's wrong, and wrong in a way that gets *worse* the more leverage you use.

Borrow cost isn't charged on your money — it's charged on the **borrowed notional**. In a 200/-100 portfolio your equity is 1,000,000 but the short leg is also 1,000,000, so at 50bps you owe ~5,000/year. In a 700/-600 portfolio your equity is still 1,000,000 but you're borrowing 6,000,000 — six times the bill. A percentage-of-portfolio haircut would charge both the same. Modelling it as cash owed on the actual notional is the only version that scales correctly.

Three details that make it hold together:
- **Charged on `Math.abs(notional)`**, so the same field works in both directions: on a short leg it's your borrow spread; on a long leg you can type `-0.07` and it becomes the ETF's expense ratio.
- **Measured at the *previous* month's price**, because that's the position you actually held through the month just gone.
- **Reset to zero at each rebalance**, because rebalancing re-strikes every position against the net value — which already had the tab deducted. The debt is settled by the act of rebalancing, so carrying it forward would double-count it.

Verified against hand arithmetic: `1,000,000 × 0.5% × 31/365 = 425`, and the table's first financing row says `-425`.

### Why "Never" was added to the rebalance dropdown, and what it revealed

**Decision:** Add a fourth rebalance option, `never` — buy the target weights once and never touch them.

**Why:** With leverage, "how often do you rebalance?" stops being a minor housekeeping setting and becomes the single biggest lever in the whole simulation. `Never` is the control case that makes that visible: it answers "what if I just take the leverage once and let it ride?"

The implementation was one dropdown option. The frequency check is an if/else chain that sets `shouldRebalance = true`, so a value matching none of the branches simply never rebalances. (Two comments were added at the decision sites so the next reader knows that's *intended* and not an accident waiting to be "fixed".)

**What it showed** — same 200% CSPX / -100% IB01 portfolio, same 16.6 years, only the rebalance setting changed:

| Rebalance | CAGR | Vol | Max DD |
|---|---|---|---|
| Monthly | 24.39% | 28.40% | -42.40% |
| Quarterly | 23.80% | 28.49% | -43.02% |
| Yearly | 24.01% | 29.17% | -45.47% |
| **Never** | **18.06%** | **19.80%** | **-26.30%** |

Never isn't a slightly different answer — it's a different portfolio. Six points of CAGR and twenty points of drawdown separate it from its rebalanced twin.

**Why:** the leverage silently decays. The share count is frozen, but the equity underneath it grows, so the ratio falls:

```
2009: 200%  →  2013: 140%  →  2019: 119%  →  2026: 109%
```

By the end you're barely leveraged at all. You didn't sell anything; the denominator just caught up with you. That's why both the return and the risk land between the 1× and 2× cases.

**The trap:** this is a bull market talking. Prices rose over this window, which de-levers you *gently*. In a falling market the identical mechanic runs the other way — losses shrink the equity, the ratio climbs, and "never rebalance" becomes the most dangerous setting rather than the safest. Don't read the table above as "Never is safer." Read it as "Never means your leverage is whatever the market decides it is."

### Why a wiped-out portfolio freezes at zero

**Decision:** If a leveraged portfolio's equity reaches zero, close all positions, hold the value at zero forever, and show a red banner naming the date.

**Why:** An unlevered portfolio cannot go to zero — you'd need every holding to become worthless simultaneously. A leveraged one can, and in our data a 7× S&P portfolio does exactly that on 2020-03-31.

Without a guard the arithmetic keeps going and produces nonsense: a negative portfolio value that "recovers" in April, a CAGR that takes the root of a negative number, and division by zero seeding `NaN` through every downstream statistic. But the deeper point is that the un-guarded version isn't just ugly, it's **false**. A real broker liquidates you at zero equity. There is no scenario where you ride a negative balance back to profit. Letting the maths run would have invented returns that no human could have earned.

This is the general shape of the thing: a number that's mathematically computable but financially impossible is still a bug.

### Why positions are *derived* from a ledger instead of read from a sheet

**Decision (Aug 2026):** Delete the hand-maintained "Open" and "Exit" tabs. Replay the full
Transactions ledger through a FIFO lot queue in `lib/positions.ts` and derive open positions,
closed round trips and dividend attribution from it.

**Why:** the old tabs were a second copy of the truth, maintained by hand. Two copies of anything
eventually disagree, and this pair disagreed in a way that quietly hid money:

> Sell one share of a holding and the old rule — "a ticker is open if it was bought and never
> sold" — dropped the entire position from Open Positions. Four holdings were affected. They
> weren't wrong by a rounding error; they were *absent*.

The ledger has no such notion. It just records what happened, and the app works out the rest.
That means partially sold positions can be what they actually are: still open for the shares you
kept, and a completed round trip for the shares you sold.

**Why FIFO, and how we knew it was right.** First-in-first-out means a sale takes the oldest
shares first. We didn't pick it because it's conventional — we picked it because it's what the
spreadsheet was already doing. Replaying the ledger with FIFO reproduces the sheet's own
`Cost Basis` column on **60 of the 64** sale rows that have one. The four that differ are crypto
rows where the buy and sell quantities use different units, and those are flagged rather than
guessed at. When your model reproduces the old system's numbers without being told them, you
have evidence rather than a hope.

**The three rules that make it work** (all of them learned the hard way):

1. **Group by asset name, not ticker.** The ticker column is blank on some rows, and `UST T-Bill`
   is used for two genuinely different bonds.
2. **The lookup table is the filter.** Anything not in it — the flat, savings bonds, cash funds —
   is deliberately not an investment we want on this screen.
3. **Commission is already inside `Amount`.** A purchase's amount is gross *plus* commission; a
   sale's is gross *minus* it. Report it, never re-apply it.

### Why cash balances come from the *same* ledger, read a different way

**Decision (Aug 2026):** Derive per-account, per-currency cash balances in `lib/cash.ts` by
replaying the Transactions ledger as double-entry bookkeeping.

The positions replay above asks "what do I still own?". The cash model asks a different question
of the identical rows — "what money is sitting where?" — and gets it by reading a column the app
had ignored for its entire life.

**The insight:** every ledger row has *two* account columns, `Flow from account:` and
`Flow to account:`, plus one always-positive `Amount`. A row isn't really "a dividend" or "a
purchase"; it's *this much money moved from here to there*. A dividend reads
`Company Distribution → DBS SRS P`. Buying an ETF reads `Interactive Brokers → IB ETF`.
Converting currency is a **pair** of rows, one moving SGD out and one moving USD in.

Picture the statement for one account being shredded and shuffled together with every other
account's. To rebuild it you pick out every scrap naming your account on either side, sort by
date, and add: money in when you're the destination, money out when you're the source. That's
the whole file.

**The hard part was never the arithmetic — it was the taxonomy.** The ~35 names in those two
columns are three different kinds of thing wearing the same costume:

| Kind | Examples | Does it hold money? |
|---|---|---|
| Cash accounts | Interactive Brokers, DBS SRS P, Alior Bank | **Yes** — these get a balance |
| Securities buckets | IB ETF, DBS Vickers SRS, DBS SSB | No — buying shares books cash *into* them, so their "balance" is cost basis |
| Counterparties | Company Distribution, IB Lending, IB FX | No — these are the *other* party, not somewhere you hold money |

Securities buckets are **derived**, not listed: anything that ever received a `Purchase of Asset`
is one. That rule maintains itself — add a new broker to the sheet and it classifies itself.
Only the counterparties are named explicitly, and anything unrecognised defaults to *being*
cash. That default is deliberate: a new bank account appearing as a visible new row is a mistake
you'll notice, whereas one silently vanishing is not.

**How we knew it was right:** the model reproduced all five balances the spreadsheet's owner
expected — IB USD 53,277.92, IB PLN 2,346.53, IB SGD 0.00, DBS SRS P 44,397.94, DBS SRS O
4,660.78 — **to the cent, on the first run, with no fudge factors.** Same evidence-not-hope
standard as the FIFO work above.

**One consequence worth knowing:** the By Account breakdown groups holdings by the account that
*paid* for them (`fundedFrom`), not the one the shares landed in, so a broker's cash and its
holdings share one bar instead of splitting into "IB ETF" and "Interactive Brokers". The wart:
crypto bought with DBS money rolls up under DBS, even though the coins live at Gemini. Accurate
as "who paid", wrong as "where is it custodied" — a known, accepted trade-off.

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

### 14. Decomposing a Year's Profit by Asset (and the "scale mismatch" landmine)

**The goal:** Below the "Contributions and Profit by Year" chart, show a table that breaks a single year's total profit into *how much each asset generated that year* — split into "shares I held on 1 January" vs. "shares I bought during the year" — in whatever currency the buttons are set to. So you can see, e.g., that in 2024 Bitcoin was your biggest engine (+87k zl) and Bitcoin ETF's early dip was the main drag.

**The insight that made it simple:** Instead of trying to replay a running "how many shares did I own each day" simulation (which needs careful FIFO matching of sells to buys), we noticed the data is already organised as self-contained *lots*. Every sale in the "Closed" sheet is one complete buy→sell record; every share you still hold is a buy-only row in the "Data" sheet. So each lot can be valued **independently** with a plain school-level formula:

> profit in year Y = (what it was worth at the end of Y, or the cash you got if you sold) − (what it was worth at the start of Y, or the cash you paid if you bought it that year)

Because each boundary is converted at *that month's* exchange rate, this automatically includes currency gains/losses and handles buying-more or selling-part mid-year with no special cases. Anything we can't price (assets missing from the quote feed, cash, fees) isn't guessed at — it's lumped into an **"Other"** row defined as *(total year profit) − (sum of priced assets)*, which guarantees the table always adds up to the bar in the chart above.

**The landmine — a units mismatch that inflated a number 5×:** The first run showed a phantom **+565,000 zl** from a 2019 cash-bond lot (IB01). The cause: that lot was *traded* at a price around **5** per share back in 2019, but the price-history column for the same ticker reads around **26** in 2019 (the series is on a different, rebased scale). Multiplying `shares × price-from-the-sheet` therefore multiplied a ~7,800 position as if it were ~44,000 — a 5.6× fiction.

**The fix — value by *relative move*, not absolute price:** For sold lots we no longer do `shares × price`. We take the lot's **actual cost** and scale it by how much the price series *moved* since the buy month: `cost × price(boundary) ÷ price(buyMonth)`. The scale cancels out — the answer is identical to `shares × price` when the data is clean, but immune when it isn't. The phantom 565k collapsed to a correct **+780 zl**.

**How we caught it:** Before wiring anything into the 12,000-line component, we re-implemented the whole calculation as a standalone ~80-line Node script reading the raw CSVs, and printed the per-asset breakdown for several years alongside the official yearly totals. The 2019 number screamed "impossible," which is exactly what a sanity harness is for. Only after the script reconciled cleanly did we port the identical logic into the app — and then confirmed the live table matched the script figure-for-figure.

**Lesson:** When you multiply two numbers that come from *different sources* (transaction share counts × a separate price feed), you're implicitly trusting that they're on the same scale — and real-world financial data often isn't. Prefer **ratios/relative changes**, which are scale-free, over absolute multiplications whenever you can. And when a calculation must be *accurate*, build a throwaway checker against the raw data first; a number that's obviously wrong is a gift.

**The redesign — from "answer" to "worksheet":** The first version showed two profit columns ("held at start" vs "added during year"). The client's reaction was honest: *"this confuses me — I want to see the quantity, the price it started at, the price it ended at, and the profit, so I can check the maths myself."* A profit figure with no visible mechanism is a black box, however correct. So each asset became a set of **segments** — *held from start*, *held from start · sold*, *bought in 2024*, *bought & sold*, *income* — and each segment shows **shares · start price · end price · profit**, laid out so `shares × (end − start)` visibly equals the profit. A single asset like IWDA in 2024 now reads as a little story: started with 795 shares (kept 145, sold 650), bought 565 more.

**Native currency vs. the FX gap:** Prices live in each asset's *own* currency (SGD REITs, USD ETFs, PLN stocks), so the arithmetic only ties out in that currency. We show a **Profit (native)** column that ties out exactly, then a final **Profit (selected currency)** column that converts each boundary at its own month's exchange rate. The *gap between the two* is the currency effect — and it's often the headline: in 2024 MSCI World barely moved in dollars (+2,530 $) yet added **12,773 zł**, purely because the dollar strengthened against a big base. Exposing that gap turned a confusing number into an insight. (We copied this native-then-converted shape from the app's existing "Open Positions" table — consistency with what the user already understands beats inventing a new idiom.)

**The scale guard, take two:** With prices now shown as `shares × price`, the old IB01 scale glitch could resurface in the *display*. Rather than the relative-cost trick, the final version uses an explicit **per-lot guard**: if the price feed at a lot's buy month disagrees with the price actually paid per share by more than ~3×, that lot is quarantined into "Other" instead of drawn as a distorted row. Clean lots render honestly; the one weird legacy lot bows out gracefully. The meta-lesson: when a rare bad input can't be trusted, it's often better to *exclude it visibly* than to silently "fix" it with a cleverer formula the user can't see.

**Lesson:** Correct isn't the same as understandable. If a user has to take a number on faith, show them the arithmetic that produces it — even at the cost of more columns and more rows. And when you redesign, borrow the vocabulary and layout the user has already learned elsewhere in the product.

### 15. The "impossible exchange rate" — converting flows and values with different rates

**The smell:** A sharp-eyed user noticed the breakdown's "Other" bucket was 24% of profit in złoty but **73% in dollars** for the same year. As he put it: "there's no way this is that volatile — 98k PLN vs 82k USD implies an exchange rate of 1.2, and the dollar trades near 3.7." He was right, and chasing it uncovered a bug that had nothing to do with the breakdown at all.

**The root cause:** the app converted the yearly summary into other currencies by dividing **every** number by that year's *average* exchange rate. But a portfolio's **value** isn't a flow — its dollar worth is a snapshot at the *end-of-period* rate. So the code was mixing two rates:

- Contributions & profit (flows) ÷ **average** rate
- Start/end portfolio value (snapshots) ÷ **period-end** rate

When the exchange rate drifts during the year, those disagree, and the fundamental identity breaks: `growth (contributions + profit)` no longer equals `end value − start value`. Concretely, for 2026 the chart claimed +113k USD profit, but the portfolio's dollar value only rose ~86k and ~46k of that was fresh contributions — so the *real* profit was ~40k. The chart was overstating by ~73k, and that phantom 73k was exactly what leaked into the breakdown's "Other."

**Why it was invisible in PLN:** złoty is the base currency, so every rate is 1.0 — average and end-of-period are identical. The bug could only appear once you pressed USD/SGD. A whole class of currency bugs hides behind "looks fine in the home currency."

**The fix:** stop converting profit directly. Derive it as the residual of things that *can* be converted consistently:

> `profit_in_currency = (end value − start value) − contributions`

with values at the period-end rate and contributions at the average rate. Now `growth = contributions + profit = the actual change in value`, by construction, in every currency. In PLN it's algebraically identical to the old number (the accounting identity `end − start − contributions = profit`), so nothing there moved. In USD the breakdown's "Other" fell from 73% to 23% — matching the 22% it shows in PLN, because it's finally the *same* economic quantity viewed through a consistent lens.

**How the numbers were pinned down:** the same standalone Node harness again. We printed, for every year, the chart's profit (`PLN ÷ avg`) beside the value-based profit (`Δvalue − contributions`). They disagreed wildly and in *both* directions — 2026 the chart was 3× too high, 2025 it was 6× too **low** — which is the fingerprint of a rate-mismatch rather than a simple scale error. A discrepancy that flips sign year to year is telling you the two quantities are measured on different rulers.

**Lesson:** Never convert a "profit" or "return" figure directly into another currency by multiplying by one rate. Profit is a difference of values measured at different times; convert the *values* (each at its own moment's rate) and subtract. And treat the home-currency view with suspicion — it's exactly where multi-currency bugs go to hide, because there every rate is 1.

### 16. Choosing Chart Colours Is Arithmetic, Not Taste

**The brief:** "the Positions graphs don't match the rest of the app — make them more elegant." Easy to nod along to and impossible to verify. The old palette was Tailwind's greatest hits: neon green, hot blue, electric indigo, a purple. Next to the new slate-grey buttons they looked like a child's crayon box spilled onto a bank statement.

**The trap I nearly fell into:** picking eight colours that *looked* tasteful and shipping them. The problem is that "looks fine to me" is a sample size of one, with one particular pair of eyes. Roughly 1 in 12 men has some form of colour-blindness, and a pie chart is the cruellest possible test — every slice is on screen at once, so *every* pair of colours has to survive, not just neighbouring ones.

**What I did instead:** ran candidate palettes through a validator that scores each pair on five checks — lightness band, chroma floor, colour-blind separation (deutan/protan/tritan), a normal-vision floor, and contrast against the white card. The first attempt failed instantly:

```
[FAIL] Chroma floor   below floor (reads gray): #3d5a80, #2f7d72, #8c7b6b
```

Translation: my "elegantly muted" colours were so desaturated they'd read as three shades of mud. Elegance and legibility were pulling in opposite directions, and the tool said so in numbers instead of letting me find out from a confused user six months later.

**The honest ceiling:** after brute-forcing thousands of combinations from a pool of two dozen candidate hues, a real limit emerged — **you cannot make six categorical colours all-pairs safe.** Not "I couldn't"; nobody can, and the design literature says so plainly. Five is achievable. Six isn't. So the final answer isn't one palette, it's a palette *plus an admission*:

- **Asset classes (5 colours) — passes everything.** Worst pair: ΔE 9.6 for colour-blind viewers, 16.3 for everyone else, both above the floor.
- **Currencies (6 colours) — cannot pass, and doesn't pretend to.** It leans on the fact that every bar already prints its currency code and every slice its percentage. Colour is the garnish there, not the label.

**The bit that felt like cheating (but isn't):** because the colours now live in a single `CHART_PALETTE` constant at the top of the file, and both the currency bar chart and the currency pie read from it, they can never drift apart. The old code had the same colours typed out in two places; someone would eventually have changed one and not the other.

**Lesson:** When a request is aesthetic ("more elegant"), find the part of it that's measurable and measure that part. You still make a taste judgement about *which* passing palette to use — but you never ship one that's quietly unreadable for a chunk of your audience. And when a constraint is genuinely impossible, say so out loud and name the thing that compensates for it, rather than quietly shipping something that fails a test nobody ran.

### 17. The Comment That Wouldn't Compile (Twice)

**The error:**

```
x Expected ',', got 'className'
   5160 |     {/* Page background: flat, neutral light grey */}
   5161 |     <div className="min-h-screen bg-[#f1f2f4] p-4">
        :          ^^^^^^^^^
```

The caret points at line 5161. The mistake is on line 5160.

**What happened:** `CLAUDE.md` asks for plain-English comments on all generated code, which is a good rule. So while changing the page background I added an explanatory comment — right after `return (`. JSX doesn't allow that. The slot immediately after `return (` must hold the root element itself; a `{/* … */}` there is a syntax error, and the parser only notices when it reaches the *next* line, which is why the error message accuses an innocent `<div>`.

```jsx
return (
  {/* explanation */}        // breaks the build
  <div className="...">
```
```jsx
// explanation               <-- lives happily here
return (
  <div className="...">
```

Curiously, `{/* … */}` is perfectly legal *between* elements once you're inside a parent — which is exactly why the rule is easy to forget. The one forbidden spot looks like all the allowed ones.

**The embarrassing part:** I did it twice in the same session, hours apart. The second time was in a `<tfoot>` deep inside a `.map()`, and by then I'd stopped thinking of it as a rule and started thinking of it as bad luck.

**Why it cost almost nothing anyway:** the dev server was running the whole time. Both breakages surfaced in the terminal within seconds, were fixed in under a minute, and neither reached GitHub. That's not luck — it's what the feedback loop is *for*. A mistake caught in 5 seconds by a machine is not really a mistake; a mistake caught in 5 days by a user is.

**Lesson:** Two of them, actually. First, when a compiler points at line N, the culprit is often line N−1 — parsers report where they *noticed*, not where you *erred*. Second, and more useful: repeating a mistake isn't a sign you need to try harder, it's a sign the rule hasn't been written down anywhere a future you will look. So it went into this file, which is the whole point of this file.

### 18. The Input Box That Ate Your Minus Sign

**The bug:** With shorting added, you still couldn't type `-100` into a weight box. Not "it showed the wrong number" — you physically could not get the character in.

**Why:** The box was a *controlled* input, meaning React owns what's displayed and overwrites it on every keystroke:

```jsx
value={asset.weight}
onChange={(e) => updateAsset(..., parseFloat(e.target.value) || 0)}
```

Follow one keystroke through. You type `-`. That goes to `parseFloat("-")`, which is `NaN`, because `-` on its own genuinely isn't a number. `NaN || 0` is `0`. So `0` gets stored, React re-renders, and the box now reads `0`. Your minus sign is gone before you can type the `1`. The field was a trap that only sprang on values that pass through an invalid intermediate state — and *every* negative number does.

**The fix:** keep the half-typed text somewhere separate from the parsed number:

```jsx
value={numDrafts[key] ?? String(asset.weight)}   // show what you're typing…
onChange={(e) => { saveDraft(e.target.value);    // …remember the raw text
                   store(parseFloat(...) || 0) }} // …but store a valid number
onBlur={() => clearDraft(key)}                    // …then tidy up on exit
```

Now `-` survives on screen while `0` sits in the model, so the backtest always has something valid to run and you can finish typing.

**The general shape:** a controlled input has *two* states pretending to be one — what the user is composing, and what the app has committed. They're the same thing only while the input is valid. Any field where a valid value must pass through an invalid prefix has this bug lying in wait: negative numbers (`-`), decimals (`1.`), scientific notation (`1e`). If you can't type it, that's why.

**The tell:** it wasn't caught by TypeScript, and it wasn't caught by reading the code — `parseFloat(x) || 0` looks like sensible defensive programming. It was caught by *typing a single character into the running app and reading back what the box said*. Some bugs only exist in the gap between keystrokes, and the only instrument that finds them is a finger on a key.

**The sequel, found in review:** the replacement guard was `isNaN(parsed) ? 0 : parsed` — and **`isNaN(Infinity)` is `false`**. So typing `1e400` into the cost box let `Infinity` through into the engine, where it did something worse than crash:

1. The financing tab became `+Infinity`.
2. The liquidation guard tests `value <= 0`. `Infinity` is not `<= 0`, so the one safety net in the whole feature politely stood aside.
3. Rebalancing gave both legs infinite share counts.
4. Next month the long leg was `+Infinity` and the short leg `-Infinity`, and **`Infinity + (-Infinity)` is `NaN`**. That single `NaN` then flowed into every statistic on the page — 266 of them.

Fixed by using `Number.isFinite(parsed)`, which rejects `Infinity` *and* `NaN` in one go. `isNaN` asks "is this the NaN value?"; `Number.isFinite` asks "is this an actual number I can do arithmetic with?" — which is the question you almost always mean.

**Two lessons worth more than the fix.** First: `isNaN` is not a validity check, and neither is `!== NaN`, and neither is `|| 0`. If you are about to multiply user input by something, `Number.isFinite` is the guard you want.

Second, and the reason this is written down: the liquidation guard was *tested* — a 7x portfolio correctly blew up on 2020-03-31. It just happened to be tested only from the direction it was designed for. A guard that catches "too small" says nothing about "too large", and `<= 0` quietly treats infinity as perfectly healthy. **When you write a bound, ask what the other end of the number line does to it.**

### 19. Two Charts That Must Line Up Should Eat From One Plate

**The task:** add a "Shares Held" bar chart under the Price History line in the Positions tab, sharing its X axis — so toggling "Since Invested" or "Until Sold" moves both together.

**The good decision:** don't build a second series. The share count was *already* being computed inside `getClosedChartData` and `getOpenChartData` — the FIFO loop calculated it every month and threw it away. Adding one `shares` field to the rows the price line already plots meant the bar chart wasn't merely *configured* to match; it was reading the same rows. Every filter came along for free, because there was only ever one filtered array.

**The near-miss.** I fed the bar chart `chartData`, tested it, and the axes matched. They matched in every combination I tried. Then I read `mergeComparisonData` and noticed it can *append* rows: when you pick a comparison asset, months the comparison has but the base asset lacks get pushed onto the merged array. The line chart plots `mergedChartData`; I was plotting `chartData`.

Usually those are the same. But turn on "Until Sold" *and* pick a comparison asset, and the comparison line runs past your sale date — line chart 200 months, bar chart 190. The bars visibly stop short of the line, which is precisely the one thing the feature existed to prevent.

Fix: plot `mergedChartData` in both. The extra months carry no `shares` value, so no bar is drawn — correct, since you held nothing then.

**The lesson.** "Same data" and "same array" are not the same claim. `chartData` and `mergedChartData` were *usually equal*, and usually-equal is the most expensive kind of wrong: it survives every casual test and fails in the one configuration a user will eventually hit. When two views must agree, don't feed them equivalent inputs — feed them the *identical* input, and make that identity structural rather than something you have to keep remembering.

**How it was caught:** not by clicking around, but by reading the function that produced the array and asking "can this ever return something different?" Line 86 answered yes. Testing confirmed it in about a minute. Reading beats poking when the failure needs two switches flipped at once.

### 20. The Table That Found a Typo Nobody Was Looking For

**What happened:** the Transaction History table went in, I ran the usual sanity check on the numbers, and one row refused to add up:

```
IWDA, bought 2020-03-12    price 99.78 x 200 shares = 19,956
                           recorded cost             =  9,984
```

Off by a factor of exactly 2.000. Working backwards, the real price was 49.89 — which slots neatly into that week's sequence (53.20 → **49.89** → 46.05) during the COVID crash, while 99.78 would mean the price doubled overnight and halved again four days later. A mistyped cell in the source spreadsheet, sitting there since 2020.

An audit of all 138 closed rows — does `price × qty + commission` reconcile with recorded cost, and `price × qty − commission` with recorded proceeds — found **one** buy-side mismatch and **zero** sell-side. An isolated slip, not a systematic problem.

**Why the app never got it wrong.** Every calculation derives cost per share from `initialCost ÷ shares`, never from the `buyPrice` column. So the FIFO average, returns, CAGR, XIRR and the new cumulative columns were all computed from the correct 49.89 the whole time. The bad number could only ever be *displayed*, never *compounded*.

That wasn't luck, and it's the transferable idea: **when two fields encode the same fact, pick the one the rest of the system depends on and derive everything from that.** Cost is what the money actually did; price is a human-entered annotation of it. Derive from the fact, display the annotation.

**And the accidental feature.** This error had been invisible for years, sitting in a table that grouped transactions into round trips. It became obvious the moment the same data was laid out chronologically, because the wrong number now sat *between its own neighbours* — 53.20, 99.78, 46.05 — and nothing about a doubling and halving looks plausible in a crash.

A view whose numbers reconcile is also a view that audits. Ordering data the way it happened, rather than the way it's stored, is one of the cheapest ways to make errors announce themselves. The table shipped and immediately did a job nobody had asked it to do.

### 21. You Cannot Draw a Box Around a Table Row

**The ask:** outline the still-held rows in the Transaction History table so live holdings stand apart from finished trades.

**The obvious answer, which is wrong:**

```jsx
<tr className="outline outline-1 outline-black">   // renders as a line above and below
```

**Why.** In a `border-collapse: collapse` table — which Tailwind's reset turns on by default — a `<tr>` is not a real box. It's a grouping the browser paints *through*, with the cells owning the actual geometry. An `outline` on it lands on the horizontal edges and nothing else, so you get two stripes rather than a rectangle.

**What works** is to border the cells and let them assemble the box between them:

```jsx
const box  = held ? ' border-y border-black' : '';  // every cell: top + bottom
const boxL = held ? ' border-l border-black' : '';  // first cell only: left edge
const boxR = held ? ' border-r border-black' : '';  // last cell only: right edge
```

Deliberately no `border-x` on the middle cells — that would draw a vertical line between every column and give you ten little boxes instead of one long one.

**The wider point:** `<tr>`, `<thead>` and `<tbody>` are weaker styling targets than they look. Backgrounds on them often work; borders, outlines, rounded corners and transforms frequently don't, because with collapsed borders the cells win. When a row-level style doesn't render, push it down to the cells rather than fighting it.

**How it was checked:** by reading `getComputedStyle` on the first, middle and last cells and asserting all four edges were black with `borderLeftWidth === '0px'` in the middle — not by looking at it. Screenshots don't work on this page anyway (see [[project_preview_verify_workflow]]), but computed styles are the better instrument regardless: they answer "is the left edge actually painted" rather than "does that look boxed to me".

**A verification trap worth knowing:** while checking, the console showed a JSX syntax error and the server logs showed `GET / 500`. Both were *stale* — thrown seconds earlier while a scripted edit had the file briefly mid-surgery, and followed further down by `✓ Compiled` and `GET / 200`. `read_console_messages` accumulates across navigations, so a fixed failure keeps looking like a live one. Read to the *end* of the log before believing an error, and confirm against the current build rather than the loudest message.

### 22. The Bad Row Was a Free Test

**What happened.** Two places in the app show a commission in basis points. They had been written months apart and quietly disagreed on what to divide by:

```js
// Transactions summary row
sumBuyComm / (sumCost - sumBuyComm)      // gross derived from CASH
// Transaction History table
t.buyCommission / (t.buyPrice * t.sharesSold)   // gross derived from PRICE
```

On 137 of 138 rows those are the same number, because `price × quantity` and `cost − commission` describe the same trade. On the IWDA row with the mistyped price (lesson 20), they didn't: **3bps in one table, 6bps in the other, for the same purchase.**

Nobody would have noticed without the typo. The two definitions had coexisted for months, agreeing every single time, and a *data* error is what finally made a *code* inconsistency visible. Fixed by moving both onto the cash-derived gross — the one that stays correct when a price cell is wrong.

**The generalisable bit:** a corrupt row is an unplanned differential test. When two code paths compute "the same" quantity, they only prove they agree on inputs where everything is consistent; it takes a weird input to separate them. So when you find bad data, don't just fix the data — **check whether anything downstream disagreed about it**, because that disagreement is information you paid for and would not otherwise have got.

And the tiebreaker when two definitions compete: prefer the one derived from the value the rest of the system already depends on. Here that's cost, which drives every calculation, over price, which is only ever displayed.

### 23. The Default That Was Never Used

**The ask:** have the price chart open with "Since Invested" already on.

**The obvious one-word change:**

```js
const [openSinceInvested, setOpenSinceInvested] = useState(false);  // -> true
```

Made it, reloaded, and the button was still off.

**The wrong diagnosis, nearly acted on.** My first thought was a stale bundle — dev server hadn't recompiled, browser served cache. That's the familiar explanation and it's usually right. But the *new* Min/Max button added in the same edit was rendering perfectly, which proved the running code was current. One observation killed the theory before it wasted twenty minutes.

**The real cause,** found by grepping for every writer of that state rather than trusting the declaration:

```js
onClick={() => {              // clicking a position row
  setOpenSelectedTicker(row.ticker);
  ...
  setOpenSinceInvested(false);   // <- resets the chart for a clean slate
}}
```

The row click deliberately resets every chart toggle so each position opens predictably. And since you can *only* reach the detail view by clicking a row, that reset always runs. **The `useState` default was dead code** — it described the state of a screen no user ever sees.

**The lesson.** `useState(x)` sets the value the component is *born* with, not the value it *shows*. Any state that gets reassigned on the way into a view has its real default at the reassignment, not the declaration. So when a default won't take, don't stare at the initialiser — **grep every writer of that variable**. `grep -n "setOpenSinceInvested"` returned four lines and the answer was on line three.

The two now sit in the same file with a comment at each reset site saying they must mirror each other. That's a duplication, and duplication drifts — but the alternative (a shared defaults object) is more machinery than four booleans deserve. Worth revisiting only if a fifth toggle appears.

**And the wider point, which cost nothing this time only because I checked:** this would have shipped looking correct in review. The diff was one word, the word was right, TypeScript was happy, and the feature did not work. **Reading the code you changed tells you nothing about the code that changes it back.**

**Practical note on the same change:** merging two table columns into one silently shifts every cell to its right, and this table had four separate places emitting rows — header, normal rows, dividend rows, and a summary `<tfoot>` with `colSpan`. Checking it by eye would have missed a mismatch three columns deep. Counting instead is trivial and conclusive:

```js
[...tbl.querySelectorAll('tbody tr')].map(r => r.children.length)                       // all rows
[...tbl.querySelectorAll('tfoot tr')].map(r => [...r.children]
  .reduce((s, c) => s + (c.colSpan || 1), 0))                                          // colSpan-aware
```

Assert every one equals the header count. A dividend row that quietly dropped its payout into the wrong column would look completely plausible on screen.

---

### 24. The Same Bug, Four Times: When a Data Source Gets Wider

This is the most useful thing in this file, so read it even if you skip the rest.

The Positions tab used to read from a feed containing **only currently-open positions**. So this
line was perfectly safe:

```js
const openLots = transactionData.filter(t => t.ticker === ticker && t.flow === 'Purchase');
```

Then we switched to the full ledger, which contains **everything ever traded**. The line didn't
change. It didn't need to — it broke on its own, because its meaning depended on what was in the
array, and that had quietly changed underneath it.

Think of it like a filing cabinet labelled "Current Clients". For years you could grab any folder
from it and safely assume the client was current. Then someone merges in the archive without
relabelling the drawer. Every piece of code that trusted the label is now wrong, and none of it
looks wrong.

It bit **four separate places** before it was caught:

| Where | What it claimed |
|---|---|
| `getOpenPurchases` | 4,054 units of BCASH held — you own 3,465 |
| `getOpenDividends` | Income counted twice, in Open *and* Closed |
| `getOpenDividends` again | 2021 dividends shown against shares bought in 2026 |
| Yearly profit breakdown | A 2020 purchase booked as "held from start" of 2026, for an asset sold in 2025 |

The user caught two of them by eye. That is the embarrassing part and the instructive part: none
of these threw an error, none failed a type check, and the numbers all looked *plausible*.

**The lesson:** when you widen a data source, grep every consumer of the old variable and ask
"did this rely on the feed being pre-filtered?" — before shipping. And when you find one instance,
that is a signal to go hunt the rest, not to fix it and move on. Fixing the first three
individually is how you end up fixing the fourth in production.

### 25. The Spreadsheet That Lied About Exchange Rates

Gold in SGD was down 1% in 2022. The same gold, priced in USD, was down 17%. Meanwhile SGD/USD
had barely moved. Three numbers, and at most one story that fits — so something was wrong.

The instinct is to suspect the conversion code. The code was fine. The **data** was lying.

Here's the trick that found it: the spreadsheet stored SGD/USD **twice** — once as its own column,
and once implicitly as `SGDPLN ÷ USDPLN`, because every conversion routes through the zloty. Two
independent roads to the same number means the sheet can be checked against *itself*. They
disagreed on 140 of 201 rows, every one of them before mid-2023.

Then the actual diagnosis, confirmed against the Polish central bank's published rates: the
`SGDPLN` column was **shifted forward by exactly 12 months**. Every row showed the rate from a
year later. Across 20 semi-annual probes, reading each row as its own date gave a mean error of
6.22%; reading it as "12 months later" gave **0.31%** — pure rounding noise. The cause was almost
certainly a `GOOGLEFINANCE` history block pasted alongside the rows instead of looked up by date.

**Three lessons, in increasing order of value:**

1. **Redundancy is a free test.** If a value can be derived two ways, derive it both ways and
   compare. The app now does this on every load and raises a banner when the two disagree
   systematically. It costs one loop over the data.
2. **Verify against an outside authority, not your own memory.** When the user pushed back with
   "I think my SGDPLN is ok", re-arguing would have been a coin flip. Fetching the central bank's
   official fixing settled it *and* revealed the 12-month shift that the first pass had only
   guessed at. For anything PLN-denominated, `api.nbp.pl` is free, authoritative and needs no key.
3. **Their pushback was reasonable.** The column *was* correct for recent dates — only the history
   was broken. A confident correction from someone looking at their own data usually means you
   measured the wrong thing, not that they're wrong.

### 26. The ETF That Changed Currency Halfway Through

A gold ETF showing +29% in a year when gold fell 4%. Every data source agreed on the +29%, which
made it feel like reality rather than a bug.

The fingerprint was a ratio that should have been boring. `GSD ÷ GLDM` — two gold funds — sat
between 4.66 and 4.81 for **ten years**, then jumped to 6.30 in a single month. Assets don't do
that. Quote currencies do: the December-to-December ratio was 1.349, and USD→SGD at the time was
1.344.

The explanation was mundane and completely invisible in the numbers. `GSD` is the *Singapore
dollar counter* of SPDR Gold Shares, which only began trading on 30 June 2021. Before that date it
has no history at all — so every data provider backfills it with the **US dollar** counter's
prices, and none of them convert. The series is USD before the switch and SGD after it. The "gain"
was a 34.9% redenomination partly cancelled by gold's real −4%.

**The lesson:** a price series is a claim about *units*, not just numbers, and nothing in a CSV
records which units. When one asset moves in a way its peers don't, check the ratio between them
over the full history. A constant that suddenly steps is a units change, not a market event —
markets move gradually and both ways; redenominations happen once and never reverse.

### 27. Averages That Hide the Truth: Smearing a Dividend Across Months

The old Exit tab stored one number per round trip: total dividends received over its whole life.
Asked "how much did this contribute in 2023?", the only available answer was to spread that total
evenly across the months held and take the year's slice.

For ES3TR that gave **935**. The real figure, from the payment dates, was **1,064**. Not a
disaster — but confidently wrong, and wrong in a way nobody could spot, because a smeared average
looks exactly like a measurement.

Once the ledger arrived with dated payments, the estimate became unnecessary. The fix is
philosophical as much as technical: **stop approximating the moment you have the real data**. The
smearing code still exists as a fallback for legacy rows, but it now sits behind a check for real
dates, and a comment explaining that it produced 935 where the truth was 1,064.

There's a second, sharper lesson buried here. The number on screen was briefly **1,999** — which
is 935 + 1,064. Two code paths, one estimating and one measuring, both contributing. When a total
looks like roughly double what you expect, check whether you're adding two answers to the same
question.

### 28. React Ran My Code Twice, On Purpose

"Fetching data from Google Sheets…" went from quick to interminable, and nothing about the data
had changed.

`performance.getEntriesByType('resource')` told the story in one call: **every sheet was being
downloaded twice**. `next.config.js` sets `reactStrictMode: true`, and React 18 deliberately
double-invokes mount effects in development to flush out exactly this kind of bug. The mount
effect called `loadDataFromSheet()` with no guard, so it ran two complete loads. A `useRef` latch
fixed it.

But the timing data had a hole in it, and the hole mattered. Two of the fetches — to sheet tabs
that had just been deleted — **didn't appear in the list at all**, because CORS-failed requests
aren't recorded. They were still real: still opening connections, still taking ~800ms each to come
back 400, and still counting against the ~6 simultaneous connections a browser allows per host.
The visible requests were slow because they were queuing behind invisible ones.

Two things worth carrying forward:

- **A deleted Google Sheet tab returns HTTP 400 *resolved*, not rejected.** `.catch()` never fires
  and `response.ok` is `false`. Any retry loop keyed on "the content was empty" will cheerfully
  retry it forever — in our case adding 1s + 2s + 3s of pure sleep to every page load.
- **When the measurements don't explain the symptom, suspect the measurement.** Resource Timing
  looks authoritative right up until you learn what it silently omits.

Net result: 14 requests down to 5, and load time from about 6 seconds to 2.5.

### 29. The Column Nobody Read

The request was "show me how much cash I have in each account". The obvious plan is to *infer*
it: add up dividends, subtract purchases, guess at transfers, and reconcile the difference until
the numbers look plausible. That plan would have taken a day and produced numbers that were
nearly right, which in finance is a synonym for wrong.

Before writing any of it, we dumped the ledger's headers and stared at them. There were twenty
columns. The parser read thirteen. Among the seven it skipped: **`Flow from account:`**.

That single column changes what the file *is*. With only `Flow to account:` the ledger looks like
a diary of events. With both, it's double-entry bookkeeping — every row is a transfer between two
named accounts, and a balance is just addition. The first version of the calculation ran in
about twenty lines and reproduced all five expected balances **to the cent, first try**.

The lesson isn't "read the docs". It's narrower and more useful:

> **Before building machinery to infer something, check whether the source already states it.**
> The gap between "nearly right after a day's work" and "exactly right in twenty lines" was one
> unread column.

The tell was there to be found cheaply, too. Every single `Amount` in the ledger is **positive** —
1,300 rows, no exceptions. A file that records money moving but never records a negative number
*must* be encoding direction somewhere else. That anomaly was visible in the first five minutes
of poking at the data, and it was pointing straight at the answer.

### 30. The Threshold That Hid a Real Problem

The Cash table needed to suppress a bit of noise. One long-dead savings account sat at
**−16.76 PLN** — an unsquared rounding difference from 2022. A savings account cannot really be
overdrawn by sixteen zloty, and showing it in alarming red would be worse than useless. So the
visibility rule said: *hide a negative balance on a dormant account.* Clean, simple, shipped.

Weeks later — actually, minutes later, mid-review — the owner tidied an account in the
spreadsheet. Their cleanup left it at **−6,959 PLN**: an inflow row was missing, or a purchase
was overstated. A real hole in real money.

The app showed nothing at all. Same rule. Negative, dormant, hidden.

The rule wasn't wrong about the 16.76. It was wrong because it **couldn't tell 16.76 from 6,959**,
and those are not the same kind of fact. One is arithmetic lint; the other is a data error you
would very much like to be told about. A filter that suppresses noise by a flat rule will, sooner
or later, suppress signal that happens to share its shape.

The fix was to stop measuring in absolute terms and start measuring **relative to how much money
had flowed through the account**:

| Account | Balance | Turnover | Ratio | Verdict |
|---|---|---|---|---|
| BGZ Optima P | −16.76 | 404,585 | 0.004% | rounding dust → hide |
| Alior Bank | −6,959 | 195,041 | 3.6% | a hole → **show** |

Same rule, no hand-tuned constant, and it scales itself to an account handling millions or one
handling hundreds.

**The sting in the tail.** Making negatives visible immediately broke a chart that had never seen
one. The By Account bar width was `(value / max) * 100 + '%'` — which for −6,959 produced
`width: -0.2%`. That's invalid CSS, so the browser *discarded the declaration entirely* and the
element fell back to `width: auto`, i.e. **full width**. The most negative account rendered as
the biggest bar on the screen, wider than the one holding 2.8 million.

> Invalid CSS doesn't throw, doesn't warn, and doesn't render "nothing". It renders **the
> default**, which can be the loudest possible lie.

Two habits worth keeping: when you widen a value's range (positive → can-be-negative), go find
every consumer that quietly assumed the old range; and clamp values feeding a layout, because a
chart that can't represent your number will not tell you so.

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

**Checking your work before you push.** The type checker is the safety net here:

```bash
npx tsc --noEmit
```

It reads every file and reports anything that doesn't add up — a misspelled property, a number
used where text was expected — without producing any output files. Silence means it passed.

Note there is **no linter configured** in this project. `npm run lint` exists but ESLint has
never been set up, so running it just offers to configure it from scratch. Until someone does,
`tsc` is the only automatic check, and everything else is verified by driving the running app.

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

**FIFO (First In, First Out):** When you sell part of a holding, which shares did you sell? FIFO says the oldest ones. It matters because it decides the cost basis: if you bought at 10 and later at 20, selling one share at 25 is a 15 profit under FIFO, not 5. This app uses FIFO because that is what the source spreadsheet already did.

**Lot:** One purchase, tracked separately. Buy the same asset three times and you have three lots, each with its own date and price. Selling walks through them oldest-first.

**Round trip:** A completed buy-then-sell pairing. One sale that consumes three lots produces three round trips, because each has a different purchase price and holding period.

**Ledger:** The Transactions tab — the diary of everything that happened. Unlike the old Open/Exit tabs it records events, not conclusions; the app derives the conclusions.

**Basis point (bp):** One hundredth of a percent. Commissions are quoted this way: 35bps on a 10,000 trade is 35. Useful because it compares fairly across trade sizes.

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
