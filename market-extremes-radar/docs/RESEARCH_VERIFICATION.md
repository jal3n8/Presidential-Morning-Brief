# Research verification log

The build brief asked me to read the research in `docs/` first: the Gemini research, methodology, data sources and build handoff. It also asked me to treat research claims as unverified until supported by source data, and to record and resolve any conflicts.

## 1. Missing documents

**No `docs/` folder or research documents existed** in the repository on any branch when this build started (checked 2026-11-23). The repository contained only the unrelated `index.html` ("Presidential Morning Brief"), plus an earlier WOI Equity build on branch `claude/sharp-wright-6lazqp`.

The only research artefact found was on that branch: `woi-equity/reference/woi_equity_verified_2026-11-20.json`, a hand-compiled snapshot for 20 Nov 2026 with cited sources. I treated its values as **claims to verify**. The methodology in this project was therefore written from first principles and is documented in `METHODOLOGY.md`.

**Action for the owner:** if the Gemini research or handoff documents exist elsewhere, add them to `market-extremes-radar/docs/`, and any claims in them can be checked the same way.

## 2. Reference claims vs. primary data (S&P 500, 20 Nov 2026)

Primary data: Yahoo Finance ^GSPC daily closes 1950–2026, cross-checked against FRED SP500. The engine values come from this project's own calculations. The automated test "Reference values for 2026-11-20" re-checks all of them whenever real data is present.

| Claim (reference JSON) | Claimed | Engine / primary data | Result |
|---|---|---|---|
| ^GSPC close | 6,910.39 | 6,910.39 | ✅ matches |
| 200-session SMA | 7,348.58 | 7,348.58 | ✅ matches |
| RSI(14) | 24.69 | 24.69 (Wilder) | ✅ matches |
| Previous highest close | 7,818.93 | 7,818.93 (2026-10-06) | ✅ matches |
| Drawdown from closing peak | −11.62% | −11.62% | ✅ matches |
| Close one year earlier (2025-11-20) | 6,538.76 | 6,538.76 | ✅ matches |
| Year-over-year price return | +5.68% | +5.68% | ✅ matches |
| VIX close | 35.89 | 35.89 | ✅ matches |
| SPY / QQQ closes | 689.81 / 608.45 | 689.81 / 608.45 | ✅ matches |
| NVDA / TSLA / GOOGL closes | 125.53 / 345.82 / 265.29 | 125.53 / 345.82 / 265.29 | ✅ matches |
| "Washout score 4", "Club 30/30 triggered" | — | not used | ⚠️ The reference itself marks these unverified (no formula). The Radar does not use them; its labels follow the published rules in METHODOLOGY.md. |

## 3. Conflicts between primary sources and how they were resolved

The two independent sources agreed on almost every date. Where they disagreed beyond tolerance, I used the **FRED value**, because FRED republishes the index owner's official close, and logged the replacement. These corrections are stored in the dataset manifest and listed on the Data & Method page.

| Series | Date | Yahoo | FRED (used) | Gap |
|---|---|---|---|---|
| ^GSPC | 2021-08-11 | 4,442.41 | 4,447.70 | 0.12% |
| ^VIX | 2008-11-28 | 55.28 | 55.84 | 1.0% |
| ^VIX | 2014-08-29 | 12.09 | 11.98 | 0.9% |
| ^VIX | 2014-10-15 | 25.27 | 26.25 | 3.7% |
| ^VIX | 2014-12-01 | 14.16 | 14.29 | 0.9% |
| ^VIX | 2014-12-05 | 11.89 | 11.82 | 0.6% |
| ^VIX | 2014-12-09 | 15.35 | 14.89 | 3.1% |
| ^VIX | 2021-08-11 | 16.17 | 16.06 | 0.7% |
| ^VIX | 2026-02-06 | 20.37 | 17.76 | 14.7% |

Overlap checked: ^GSPC 2,513 dates (FRED only publishes ~10 years), max other gap < 0.05%. ^VIX 9,287 dates. FRED has 34 VIX dates that Yahoo lacks; the app leaves those sessions blank rather than filling them.

**Open item:** the 2026-02-06 VIX difference is large. When the official Cboe history file (cdn-api.cboe.com) is reachable, it should be used as a third source to confirm which value is correct.

## 4. Other data notes

- NVDA has several one-day moves above 25% in 2000–2016. They were reviewed and kept, because they are genuine historical moves on split-adjusted data, not errors. They are listed as warnings in the manifest.
- S&P 500 history before 1950 was excluded, because Yahoo's early data includes six-day trading weeks and sparse records.
