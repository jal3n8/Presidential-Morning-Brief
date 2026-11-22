# WOI Equity: website and research terminal

Nontechnical setup: **[START_HERE.md](START_HERE.md)**. Automation: **[AUTOMATION_PLAN.md](AUTOMATION_PLAN.md)**.

## For developers and reviewers

React 18, TypeScript, Vite 8, Tailwind 3, Zod 4 and oidc-client-ts (Auth0). PHP 8.1+ endpoints (firebase/php-jwt, opis/json-schema) for Hostinger. Vitest 5. Security: **[SECURITY.md](SECURITY.md)**, **[RECOVERY.md](RECOVERY.md)**, **[CODEX_SECURITY_REVIEW.md](CODEX_SECURITY_REVIEW.md)**.

```
composer install --working-dir=public/api/_lib
npm ci
npm run dev            # http://localhost:5173 (site at /, terminal at /dashboard/, dev-only preview without sign-in)
npm test               # 118 tests; the PHP security suite runs when php + vendor/ are present
npm run build          # exports the JSON Schema, typechecks, builds dist/ (what Hostinger serves)
npm run security:check # scans dist/ for secrets, dev-only code and exposed data
npm run security:audit # npm audit + composer audit
npm run validate -- file.json
npm run make-secret    # new automation token + hash for woi-config.php
npm run automation:check
```

### Layout

| Path | Purpose |
|---|---|
| `index.html`, `src/site/` | Public homepage (`/`) |
| `dashboard/index.html`, `src/main.tsx`, `src/App.tsx`, `src/views/` | Terminal (`/dashboard/`, hash routes) |
| `src/lib/schema.ts` | Zod data contract (schemaVersion 2.x), shared by UI, ingester and automation |
| `src/lib/validate.ts` | Schema, then consistency checks that recompute every derived figure |
| `src/lib/auth.tsx` | OIDC sign-in (Authorization Code + PKCE); role confirmed by `/api/me.php`; dev-only preview |
| `src/lib/dataSource.ts` | `HttpDataSource` (`/api/data.php` with Bearer token) in production; dev-only `StaticJsonDataSource` |
| `src/lib/dataClient.ts` | Loads, validates and polls; never replaces good data with bad |
| `src/lib/snapshotOrder.ts`, `src/lib/ingestCore.ts` | Snapshot ids, chronological order, idempotent ingest planning |
| `src/lib/calendar.ts` | Rule-based NYSE calendar (holidays, early closes), DST-aware time-zone conversion |
| `src/lib/regime.ts`, `washout.ts`, `diff.ts`, `ledger.ts` | Three Horsemen, configurable washout scoring, snapshot diff, evidence ledger |
| `public/api/` | `public.php` (anonymous summary), `me.php`, `data.php` (subscriber), `ingest.php` + `automation.php` (machine token), `admin/{publish,rollback,audit}.php` (admin) |
| `public/api/_lib/` | bootstrap (errors, HTTPS, rate limits, audit), auth (JWT/JWKS), validate (JSON Schema), store, seed, vendor; web access denied |
| `public/.htaccess` | HTTPS redirect, HSTS, CSP, security headers, deny rules, Authorization pass-through |
| `scripts/` | `export-schema.ts`, `security-check.ts`, `make-secret.ts`, `validate-file.ts` |
| `automation/` | Phase 2 job: schedule gate, snapshot builder, provider adapters |
| `reference/` | Original supplied JSON and prompt, unmodified |
| `../.github/workflows/woi-*.yml` | Checks + gated deploy; scheduled automation |

### Invariants (each has tests)

- Nulls are never converted to 0, false, or an estimate. A missing value renders as a dash plus the reason from the data.
- Blocked signal fields (`validation.blockedFromAutomatedTradeSignals`) are never displayed as signals, and ingest **rejects** a snapshot that sets them.
- The Three Horsemen label is recomputed from close and SMA200. A missing input gives INDETERMINATE.
- No 200-session SMA is computed from fewer than 200 sessions. SPCX has 113 sessions through 2026-11-20 and reaches session 200 on 2027-03-31.
- S&P 500 year-over-year uses ^GSPC against ^GSPC. BTC uses a UTC candle, labelled as such.
- Charts and trends draw only from archived points. With fewer than 2 points they show a note instead.
- Ingest order is: archive, then index, then latest (atomic, forward-only). A duplicate is a no-op; a conflict is refused without `replace`.
- No secret exists in client code or the repo. The server stores only the SHA-256 of the machine token (in `woi-config.php`, outside the web root).
- Every protected endpoint verifies the bearer token and role on the server; protected content is denied by default.

### Data modes

- **SAMPLE:** hand-built baseline (`lastSuccessfulAutomatedRunUtc` null).
- **AUTOMATED:** written by the pipeline.
- **LIVE:** automated and `isLive: true`.
- **STALE:** NYSE sessions have completed since the snapshot date. It is shown alongside the mode above.
