# WOI Equity automation plan (Phase 2)

Goal: the site updates itself after the open and after the close on trading days. No Claude session is needed for that: Claude built the software, and the running software reads new data.

## 1. The flow

```
GitHub Actions (scheduled, free)
  ├─ market prices ........ provider API (key: MARKET_DATA_API_KEY)      NOT CHOSEN YET
  ├─ 2-year Treasury ...... home.treasury.gov CSV (public, no key)       built
  ├─ research ............. Gemini API with Google Search (GEMINI_API_KEY) built, untested without key
  ├─ verification ......... item kept as "verified" only if its quote is found
  │                         on the company's own site or sec.gov          built
  ├─ build snapshot ....... indicators computed from real series           built and tested
  ├─ full validation ...... same rules as the dashboard                    built and tested
  └─ POST /api/ingest.php . Bearer token (WOI_INGEST_TOKEN)               built and tested
         │
         ▼
Hostinger (outside public_html):  woi-storage/
  archive/<id>.json (written first) → archive/index.json → latest.json (moved last, forward only)
         │
         ▼
Dashboard reads /api/data.php every 5 min (or Refresh) and shows the newest valid snapshot.
```

Google Drive and Sheets are an optional **copy**, not the source the website reads. A browser must never read a private Drive file directly. See step 5.

## 2. Schedule

- **Workflow:** `.github/workflows/woi-automation.yml` wakes every 30 minutes on weekdays between 13:10 and 22:40 UTC.
- **Calendar:** the job runs only on NYSE trading days. The calendar handles holidays, early closes and daylight saving, and is computed from exchange rules (`src/lib/calendar.ts`, tested).
- **Opening job:** after 09:40 New York time.
- **Closing job:** after 16:15 New York time, or 13:15 on early-close days such as Nov 27 and Dec 24, 2026.
- **Window and retries:** each job runs once per day inside a 90-minute window, so a delayed or failed wake-up is retried automatically.
- **Off switch:** the workflow stays off until you add the repository variable `WOI_AUTOMATION_ENABLED` = `true`.

## 3. Market-price provider (the one decision needed)

The job needs daily closes, with at least 200 sessions of history, for:
- SPY, QQQ, IWM
- the S&P 500 index (^GSPC)
- VIX (^VIX)
- BTC-USD daily candles
- SPCX, NVDA, TSLA, GOOGL

Indices (^GSPC, ^VIX) are often on a higher plan than stocks, so check that a provider covers them before paying. I have not verified any provider's current prices or plan limits, so check each provider's pricing page for that.

Until a provider is chosen, the job stops safely before publishing, and the dashboard keeps the last good data.

**To connect a provider:**
1. Pick a provider.
2. Add its key as the GitHub secret `MARKET_DATA_API_KEY`.
3. Set the repository variable `MARKET_DATA_PROVIDER` to the provider's name.
4. Have your developer (or Claude/Codex) write the small adapter in `automation/providers.ts`, using the `MarketDataProvider` interface: about 40 lines.

The SMA method (adjusted or unadjusted closes) is recorded in every snapshot under `technicalIndicators.method`.

## 4. Gemini research

- **Key:** create one at aistudio.google.com, then add it as the GitHub secret `GEMINI_API_KEY`. Check current free-tier limits and paid pricing at ai.google.dev/pricing; I have not verified them.
- **Model:** set the repository variable `GEMINI_MODEL` to the model you want. If it is not set, the code uses `gemini-2.5-pro`.
- **Status of AI items:** everything Gemini returns starts as **unverified**. An item becomes **verified** only if two things hold:
  - its URL is on sec.gov or the company's own site
  - the exact quoted sentence is found on that page
- **AI summaries:** these are not published as research until reviewed (`summary` stays null).
- **SEC contact header:** set the variable `SEC_USER_AGENT` to `WOI Equity your-email@example.com`. SEC asks automated visitors to identify themselves.

## 5. Google Drive / Sheets (optional)

Recommended order: get the website updating first, then add a Drive or Sheets copy if you want it.

- The GitHub archive (`public/data/archive`) and the server archive (`woi-storage/archive`) already keep every snapshot.
- **Google Sheets:** a Google Cloud service account can append a row per run to a Sheet you share with it. Needs a Google Cloud project; free at this volume.
- **Google Drive files:** your account is a personal Gmail account, and service accounts cannot store files in a personal "My Drive". Uploading JSON copies to Drive therefore needs an OAuth refresh token from your own Google account. Setting that up is fiddly; ask for it when you want it.

Neither is built yet. Both run in the GitHub job, never in the browser.

## 6. Authentication for paid content (decide before launch)

| Option | Effort | Cost | Notes |
|---|---|---|---|
| hPanel "Password Protect Directories" | 5 minutes | Included | One shared password. Testing only. |
| PHP sessions + MySQL on Hostinger | Medium | Included | Accounts live on your server; we must build password reset, rate limiting and payment checks. |
| Hosted sign-in (Clerk, Auth0, Supabase Auth, Firebase Auth) | Low to medium | Free tiers exist; check current pricing | Least security code to own. `api/data.php` verifies the user's token on the server. |
| Payments (Stripe) | Medium | Per-transaction fees | Pairs with any of the above. |

Whichever you choose, the check goes in `public/api/data.php` (marked `AUTH HOOK`). The browser never holds a secret.

## 7. Fail-safes already in place

- **Validation before publishing:** a file that fails validation is never published (GitHub inbox and server endpoint both check).
- **Write order:** the archive is written first, the index second, and `latest.json` last, using atomic replace (a temporary file, then rename).
- **Latest only moves forward:** an older session is archived but never becomes "latest".
- **Duplicates:** the same snapshot twice is a no-op. A different file with the same id is refused unless you ask to replace it, and the old file is kept in `archive/revisions/`.
- **Undefined signals:** a snapshot that sets `washout.score`, Club 30/30 `triggered`, or any other blocked field is **rejected**.
- **Failures are visible:**
  - each failed run is recorded in `status.json`, so the dashboard shows "Update failed" with the reason
  - GitHub emails you when a run fails
  - the server log is `woi-storage/private/ingest-log.jsonl`
- **Missing data:** a missing value stays null with a reason. Old values are never carried forward as if current.

## 8. Credentials checklist

| Name | Where | Needed for |
|---|---|---|
| `woi-config.php` with `ingest_token` | Hostinger, folder above `public_html` | Server accepts uploads |
| `WOI_INGEST_TOKEN` (same value) | GitHub secret | Automation can upload |
| `WOI_SITE_URL` = `https://woiequity.com` | GitHub variable | Automation knows where to upload |
| `WOI_AUTOMATION_ENABLED` = `true` | GitHub variable | Turns the schedule on |
| `MARKET_DATA_PROVIDER` + `MARKET_DATA_API_KEY` | GitHub variable + secret | Prices (provider not chosen) |
| `GEMINI_API_KEY` (+ optional `GEMINI_MODEL`) | GitHub secret (+ variable) | Research |
| `SEC_USER_AGENT` | GitHub variable | Polite SEC access |

To see what the job can see, run `npm run automation:check`. It lists each setting as set or missing and never prints values.
