# Data sources and licensing

| Series | Primary source | Independent cross-check | History | Status in app |
|---|---|---|---|---|
| S&P 500 index (^GSPC) | Yahoo Finance chart API, daily bars | FRED `SP500` (S&P Dow Jones Indices via St. Louis Fed; last ~10 years) | from 1950-01-03 | **Cross-checked** |
| VIX (^VIX) | Yahoo Finance chart API | FRED `VIXCLS` (Cboe via St. Louis Fed) | from 1990-01-02 | **Cross-checked** |
| SPY, QQQ, NVDA, TSLA, GOOGL | Yahoo Finance chart API (close + adjusted close) | none | from listing | **Single source** |
| Demo series | `pipeline/make_demo.py` (seeded random) | n/a | 1990–2025 | **Synthetic demo** |
| Your CSV imports | you | none | your file | **User import (unverified)** |

No API keys are needed. Everything is downloaded by `pipeline/fetch_data.py` from public endpoints, with polite delays and retries.

## Verification levels

- **Cross-checked:** both sources were compared on every overlapping date. The tolerance is 0.05% for the S&P 500 and 0.5% for VIX. The series passes only if at most 1 date in 1,000 is outside tolerance. Dates outside tolerance are **replaced with the FRED value** and logged in the manifest; the Data & Method page lists each correction.
- **Single source:** taken from one provider and validated for format, ordering, positive prices and outlier moves, but not independently confirmed.
- **Cross-check failed:** too many disagreements. The data is still shown, with a red badge.
- **Synthetic demo / User import:** labelled as such everywhere.

## Integrity

- The pipeline writes a SHA-256 checksum for every series file into `manifest.json`. The app recomputes it in the browser and **refuses to load** a file that doesn't match.
- Every file and its manifest are validated against a strict schema (Zod) before use.
- Downloaded and imported content is parsed as JSON/CSV **data only**. Nothing in it is ever executed.

## Licensing (read before publishing anything)

- **Yahoo Finance** data is provided for personal use. Its terms do not permit redistribution.
- **S&P 500** index values are the property of S&P Dow Jones Indices, and **VIX** is the property of Cboe. FRED republishes them with permission; reuse beyond personal research generally needs a licence.
- For that reason, real data is written to `public/data/verified/`, which is **git-ignored** and never committed to this public repository.
- For a **public** newsletter companion, use a data feed whose licence covers public display, or publish only your own commentary and derived summaries. Confirm the terms with the provider.

## Raw files

`npm run data:update` keeps the untouched downloads in `data/raw/` (also git-ignored), plus `data/raw/fetch_log.json` with each URL and retrieval time. That makes every displayed value traceable to the exact file it came from.
