# WOI Equity: website and research terminal

Nontechnical setup: **[START_HERE.md](START_HERE.md)**. Automation: **[AUTOMATION_PLAN.md](AUTOMATION_PLAN.md)**.

## For developers and reviewers

React 18, TypeScript, Vite 5, Tailwind 3 and Zod. PHP 8.1+ endpoints for Hostinger. Vitest.

```
npm ci
npm run dev          # http://localhost:5173  (site at /, terminal at /dashboard/)
npm test             # 55 tests; PHP server tests run when `php` is installed
npm run build        # dist/ = exactly what Hostinger serves
npm run validate -- file.json
npm run ingest -- file.json [--replace]   # publish into public/data
npm run automation:check
```

### Layout

| Path | Purpose |
|---|---|
| `index.html`, `src/site/` | Public homepage (`/`) |
| `dashboard/index.html`, `src/main.tsx`, `src/App.tsx`, `src/views/` | Terminal (`/dashboard/`, hash routes) |
| `src/lib/schema.ts` | Zod data contract (schemaVersion 2.x), shared by UI, ingester and automation |
| `src/lib/validate.ts` | Schema, then consistency checks that recompute every derived figure |
| `src/lib/dataSource.ts` | `DataSource` interface: `HttpDataSource` (`/api/data.php`, the live store) and `StaticJsonDataSource` (`/data`, the bundled store) |
| `src/lib/dataClient.ts` | Loads every source, shows the newest *valid* snapshot, polls, never replaces good data with bad |
| `src/lib/snapshotOrder.ts`, `src/lib/ingestCore.ts` | Snapshot ids, chronological order, idempotent ingest planning |
| `src/lib/calendar.ts` | Rule-based NYSE calendar (holidays, early closes), DST-aware time-zone conversion |
| `src/lib/regime.ts`, `washout.ts`, `diff.ts`, `ledger.ts` | Three Horsemen, configurable washout scoring, snapshot diff, evidence ledger |
| `public/api/` | `data.php` (read), `ingest.php` (token-authenticated write), `_lib.php` |
| `public/.htaccess` | CSP and security headers, caching, `/dashboard` redirect, Authorization pass-through |
| `scripts/ingest.ts` | Command-line ingester used by the GitHub inbox workflow |
| `automation/` | Phase 2 job: schedule gate, snapshot builder, provider adapters |
| `reference/` | Original supplied JSON and prompt, unmodified |
| `../.github/workflows/woi-*.yml` | Deploy (test, build, push `hostinger-deploy`) and scheduled automation |

### Invariants (each has tests)

- Nulls are never converted to 0, false, or an estimate. A missing value renders as a dash plus the reason from the data.
- Blocked signal fields (`validation.blockedFromAutomatedTradeSignals`) are never displayed as signals, and ingest **rejects** a snapshot that sets them.
- The Three Horsemen label is recomputed from close and SMA200. A missing input gives INDETERMINATE.
- No 200-session SMA is computed from fewer than 200 sessions. SPCX has 113 sessions through 2026-11-20 and reaches session 200 on 2027-03-31.
- S&P 500 year-over-year uses ^GSPC against ^GSPC. BTC uses a UTC candle, labelled as such.
- Charts and trends draw only from archived points. With fewer than 2 points they show a note instead.
- Ingest order is: archive, then index, then latest (atomic, forward-only). A duplicate is a no-op; a conflict is refused without `replace`.
- No secret exists in client code. The ingest token lives in `woi-config.php` outside the web root and in a GitHub secret.

### Data modes

- **SAMPLE:** hand-built baseline (`lastSuccessfulAutomatedRunUtc` null).
- **AUTOMATED:** written by the pipeline.
- **LIVE:** automated and `isLive: true`.
- **STALE:** NYSE sessions have completed since the snapshot date. It is shown alongside the mode above.
