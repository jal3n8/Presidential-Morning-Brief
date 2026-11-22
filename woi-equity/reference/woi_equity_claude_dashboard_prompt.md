# CLAUDE CODE SUPER PROMPT — WOI EQUITY MARKET INTELLIGENCE v2.0

You are my senior full-stack engineer, data-platform architect, quantitative dashboard designer, and verification-focused research assistant. Build an actual runnable application — not a mockup or static one-off report.

## Input and scope

I have attached `woi_equity_verified_2026-11-20.json`. It is a verified-but-incomplete historical baseline. Read and validate it. **Do not change source values, invent null fields, or claim it is live.** Build a reusable dashboard for the four-stock watchlist:
- SpaceX (SPCX)
- NVIDIA (NVDA)
- Tesla (TSLA)
- Alphabet / Google Class A (GOOGL)

Also preserve the market regime indicators: Three Horsemen (SPY, QQQ, IWM vs 200-day SMA), S&P 500 washout, VIX, Club 30/30, macro/rates, Nasdaq breadth, and BTC.

## Outcome

A fast, professional WOI Equity research terminal that looks like a proprietary investment research desk: understated charcoal/ink base, muted ivory labels, restrained copper/gold accent, precise typography, compact information density, great spacing, no noisy gradients, no fake AI aesthetics. Responsive on iPhone and desktop. Never make fake price candles or charts.

## MVP technology

- Use React + TypeScript + Vite, with Tailwind and high-quality accessible components. Pick a lightweight charting package (e.g. Recharts). Use Zod for runtime data validation.
- Store the seed JSON at `/public/data/latest.json` and also save an immutable copy under `/public/data/archive/2026-11-20.json`. Write a `DataSource` interface and a local JSON adapter so the dashboard runs **immediately and offline as a sample**.
- Include a future `HttpDataSource` adapter that can read `latest.json` from a protected API. **Do not connect directly from browser code to private Google Drive files, and do not expose secrets in the client.**
- Provide unit tests for validation, derived metrics, stale-data handling, chronological sorting, duplicate ingestions, missing readings and newly listed SPCX lacking a 200-day average.

## Screens and components

1. **Command Center** — market date, last refreshed, STALE/LIVE/SAMPLE banner, regime label, SPX, VIX, Three Horsemen status, alert summary, and clean time-series placeholders until real historic points exist.
2. **Four-Stock Watchlist** — SPCX, NVDA, TSLA, GOOGL. Show verified regular-session close, 1-day percent change, price history (only if real data is supplied), research status, next catalyst *when sourced*, and one click to open a detailed stock page.
3. **Stock Detail** — overview, verified catalyst timeline, primary-source filings/earnings links, price trend and technical indicators, bull/bear scenarios clearly labeled as analysis, and an evidence ledger with publication date and source URL. If an item has no source, omit it or label as unverified.
4. **Market Regime** — cards/bars for SPY/QQQ/IWM vs their 200-day SMA, with exact rule displayed. Show `DEFENSIVE` because the three are below; this is **not** an automatic trade instruction.
5. **Washout & 30/30** — SPX RSI, drawdown, VIX, rate backdrop, plus a prominent `RULE NOT DEFINED`/`NOT VERIFIED` treatment for missing washout score and Club 30/30 trigger. Never turn null into 0 or false.
6. **Audit / Sources** — source URLs, dates, price-candle convention, provider and metric formulas, validation warnings, last good update, failed update log and snapshot history.

## Data model and correctness requirements

- Preserve `schemaVersion`, typed metric provenance, and distinction between historical market-close prices, calculated indicators, and AI-written research.
- Calculate derived percentage values only from compatible time series and matching dates. Lock the chosen SMA algorithm and adjustment conventions per ticker/provider. Do not compute 200-session SMA from fewer than 200 sessions; SPCX began public trading in June 2026.
- Ensure SPX year-over-year returns use the SPX prior-year close, **not SPY's** yearly return.
- BTC uses a UTC daily candle, separate from the 4 p.m. Eastern stock close. Clearly distinguish conventions in the UI.
- Allow missing and pending values, but show them as `Not available / Requires definition`, never as confirmed observations.
- Keep analyst/AI claims separate from market data; all news and earnings citations must carry source URL, publication time, effective event time and verification status.
- No autopilot execution, no buy/sell orders, no implied guarantees. Watchlist and research only.

## Refresh-loop architecture (Phase 2, after MVP works)

- Explain and scaffold the narrowest reliable approach for a nontechnical owner: Gemini research task and reliable market-price API -> validation/normalization job -> Google Drive (archive) and/or Google Sheet (latest) -> authenticated backend endpoint -> dashboard refresh.
- Provide a `POST /api/ingest` server-side endpoint with token authentication from server environment variables, JSON schema validation, idempotent snapshot IDs, archive-first write, safe atomic latest-pointer update and a failure log. Do NOT implement an insecure public writable endpoint.
- Define two trading-day-only scheduled jobs at **09:40 America/New_York** and **16:15 America/New_York**. Use an exchange calendar, including Thanksgiving/early closes, rather than fixed Arizona local time or naive weekdays. For an early-close day, schedule the close run after the actual special close.
- The client polls or checks the backend for newer snapshot versions; when the tab stays open, it updates the visible dashboard without a Claude session running. Include refresh button, auto-refresh toggle, source age, last success and failure badges.
- If an integration needs Gemini API access, Google OAuth, billing, cloud hosting, or an API provider, create a working stub plus a setup checklist. Explicitly say what cannot run until credentials are supplied. Do not pretend that connecting services is complete.
- No repeated Claude Code agent calls required just to refresh the numbers. Claude builds the code; running software reads changed data.

## Deliverables (build now, not just describe)

A. Runnable project source code; seeded four-stock dashboard with data from the attachment.
B. Fully functioning local JSON import and archive viewer; responsive design.
C. Tests and `npm run dev`/`npm test` commands.
D. README titled `START_HERE.md`, written for someone who is nontechnical: exact installation, where to drag the JSON, how to preview, how to deploy, and how to connect Google later.
E. A concise `AUTOMATION_PLAN.md`: recommended API/data source, scheduled jobs, Google storage option, authentication, rough ongoing service costs only where verified, and fail-safe steps.
F. A short checklist showing what works now versus what remains unconnected.

IMPORTANT: Begin by examining the attached JSON and the current project directory. Then IMPLEMENT and run the MVP. If you can run a visual preview, show it. Don't stop at a design proposal. Keep every chart truthful to the number of data points actually present. Ask me for credentials only when an integration step actually needs them.
