# WOI Equity · Market Extremes Radar

A private research terminal that spots unusual stress or euphoria in the US stock market, explains each signal with its raw numbers and rules, and shows what happened after similar moments in the past.

> **Research only, not investment advice.** No orders are placed and there is no brokerage connection. Labels come from fixed, published rules. Nothing in the app is a forecast or a probability.

---

## What's inside (six connected modules)

| Screen | What it does |
|---|---|
| **Overview** | S&P 500 level, daily and month-to-date change, 20/50/200-day averages, RSI(14), 50-day z-score, VIX and its historical percentile, drawdowns, a rule-based condition label (Normal, Elevated Stress, Extreme Stress, Recovery Watch or Upside Extension), charts, source and timestamps. |
| **Scanner** | Every time a rule switched on (oversold, overbought, VIX spike or complacency, sharp 5-day moves, combinations), with the date, raw values, threshold, formula, source, and whether earlier history can validate it. |
| **Analog Lab** | Choose today's event or build your own rule, then see past matches: forward returns over 1/5/10/20/60 sessions, mean and median, % positive, best and worst, max adverse move, a histogram, the average path and a sortable table. Filters: dates, RSI, z-score, VIX regime, 200-day trend. Overlapping events are grouped and disclosed. |
| **Watchlist** | SPY, QQQ, NVDA, TSLA and GOOGL to start; add or remove any symbol. Price, returns, trend, RSI and relative strength vs SPY. The S&P 500 index (not tradable) is shown separately from the ETFs and stocks (tradable). |
| **Journal** | Paper-trading and research notes: thesis, hypothesis, hypothetical entry and exit, invalidation, risk, result, lessons. Export to CSV or JSON, and import JSON backups. Stored only in your browser. |
| **Weekly Brief** | A rule-based summary covering the current condition, biggest changes, new historical matches, signals that failed, watchlist notes and research questions. Copy it as Markdown or plain text for a newsletter draft. |
| **Data & Method** | Which data is loaded and where it came from, cross-check results, validation notes, CSV import, and every formula and threshold. |

---

## Demo data vs real data (important)

This repository is **public**, so it must not contain licensed market data. It therefore ships with two kinds of data:

- **DEMO (committed):** synthetic, computer-generated series. The app shows a red **DEMO DATA** banner on every page. The demo index starts at 100 in 1990 and ends on 31 Dec 2025, so it can't be mistaken for the real S&P 500.
- **Real, source-backed data (your computer only):** one command downloads the S&P 500 (since 1950), VIX (since 1990) and the watchlist from Yahoo Finance. It then cross-checks the S&P 500 and VIX against the Federal Reserve's FRED database. The result is saved in `public/data/verified/`, which git ignores, so it is never published to GitHub.

When real data exists, the app uses it automatically. Otherwise it falls back to the demo data and says so. You can also import your own CSV files on the **Data & Method** page.

---

## How to run it on your computer

You need **Node.js** (choose the "LTS" version at nodejs.org) and **Python 3.9 or newer** (python.org). Both are free.

1. Open **Terminal** (Mac) or **PowerShell** (Windows).
2. Go to this folder: type `cd ` (with a space), drag the `market-extremes-radar` folder into the window, and press **Enter**.
3. Install the parts the app needs (first time only):
   ```
   npm install
   ```
4. Download real market data (optional, about one minute; repeat whenever you want fresh closes):
   ```
   npm run data:update
   ```
5. Start the app:
   ```
   npm run dev
   ```
6. Open **http://127.0.0.1:5173** in your browser.

To stop the app, click the Terminal window and press **Ctrl + C**. To start it again later, repeat steps 1, 2 and 5.

> **On Windows,** if `npm run data:update` says Python isn't found, install Python from python.org and tick **"Add python.exe to PATH"** during installation.

### Other commands

| Command | What it does |
|---|---|
| `npm test` | Runs the 71 automated app tests (indicators, look-ahead, CSV validation and more) |
| `npm run test:python` | Runs the 21 data-pipeline tests |
| `npm run test:all` | Runs both |
| `npm run build` | Creates the `dist/` folder to upload to Hostinger (see [DEPLOYMENT.md](DEPLOYMENT.md)) |
| `npm run data:update` | Downloads and validates real data |
| `npm run data:demo` | Regenerates the synthetic demo data |

### Adding a symbol permanently

1. Add a line to `pipeline/symbols.json`. Copy an existing line and change the symbol and name.
2. Run `npm run data:update`.

For a one-off, add it on the Watchlist screen and import a CSV on the **Data & Method** page.

---

## How the project is organised

```
market-extremes-radar/
├─ pipeline/                 Python (standard library only): data ingestion
│  ├─ fetch_data.py          download raw files -> data/raw/ (git-ignored)
│  ├─ build_dataset.py       validate, align dates, cross-check, write public/data/verified/
│  ├─ make_demo.py           synthetic demo data -> public/data/demo/
│  ├─ common.py              calendar, parsing, validation, cross-check, reconciliation
│  └─ tests/                 Python unit tests
├─ public/data/demo/         committed synthetic dataset (+ SHA-256 checksums)
├─ public/.htaccess          HTTPS, security headers, no directory listing (Hostinger)
├─ src/lib/                  calculations (no UI code)
│  ├─ indicators.ts          SMA, Wilder RSI, z-score, drawdown, percentiles
│  ├─ market.ts              date alignment + the market "frame"
│  ├─ rules.ts               every threshold and label rule
│  ├─ scanner.ts             signal onsets + point-in-time validation counts
│  ├─ analogs.ts             historical analog engine (clusters, forward returns)
│  ├─ brief.ts               weekly brief generator
│  ├─ csv.ts, data.ts        CSV import/export, dataset loading & checksum checks
│  └─ calendar.ts, format.ts NYSE calendar, freshness, display of dates and sources
├─ src/views/                one file per screen
├─ tests/                    automated tests (Vitest)
└─ docs/                     methodology, data sources, research verification
```

More detail: [docs/METHODOLOGY.md](docs/METHODOLOGY.md) · [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) · [docs/RESEARCH_VERIFICATION.md](docs/RESEARCH_VERIFICATION.md)

---

## What works now, and what is not finished

**Working and tested**
- All six modules and the Data & Method page, on phone and desktop.
- Real S&P 500, VIX and watchlist history, downloaded by one command and cross-checked against FRED.
- The engine reproduces the independently cited reference values for 20 Nov 2026: S&P 500 close 6,910.39, 200-day average 7,348.58, RSI 24.69, VIX 35.89, drawdown −11.62% and year-over-year +5.68%.
- Labelled demo data, CSV import with validation, freshness and staleness warnings, provenance on every number block.

**Not finished / known limits**
- **Not live.** Data is end of day and is only as fresh as your last `npm run data:update`. There is no automatic refresh on the server yet.
- **Watchlist data is single-source** (Yahoo only). The S&P 500 and VIX are cross-checked against FRED.
- **Licensing:** Yahoo, S&P and Cboe data is fine for private research but **not for public redistribution**. A public newsletter version needs a licensed data feed (see DATA_SOURCES.md).
- **Close-to-close only:** "max adverse movement" uses closing prices, because intraday highs and lows aren't stored.
- The NYSE calendar covers regular holidays, not one-off closures (for example national days of mourning). Real trading dates always come from the data itself.
- The journal, watchlist and imports live in **this browser only**. Export a backup regularly; clearing browser data deletes them.
- The research documents named in the brief (Gemini research, methodology, data sources, build handoff) were **not in the repository**. See RESEARCH_VERIFICATION.md.
- The app has no built-in login. For private use, protect the folder on Hostinger with a password (DEPLOYMENT.md, step 6). There is deliberately no fake login screen.
