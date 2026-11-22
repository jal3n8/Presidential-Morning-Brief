# WOI Equity security report (pre-deployment)

**Status: NOT APPROVED FOR PRODUCTION YET.** The checks below pass in development and CI. Several protections can only be confirmed on the real Hostinger account and the real Auth0 tenant (section 7). The site must not go live, and paid subscribers must not be enabled, until:
- the section 7 checks pass, and
- the independent Codex review (CODEX_SECURITY_REVIEW.md) is complete with no unresolved critical or high findings.

Prepared 2026-11-22. This report describes what was built and tested; it does not claim the application is secure.

---

## 1. Implemented protections

### Application security

| Requirement | Implementation | Where |
|---|---|---|
| Enforce HTTPS | 301 redirect for any non-HTTPS request. HSTS (1 year). Every API endpoint refuses plain HTTP with 403. | `public/.htaccess`, `woi_require_https()` |
| Security headers / CSP | CSP `default-src 'self'` with: <br>• `script-src 'self'` (no inline scripts, no `unsafe-inline` or `unsafe-eval`) <br>• `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'` <br>• `connect-src` limited to the site and the sign-in provider <br>Plus X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy and COOP. API responses carry `default-src 'none'` and `no-store`. | `public/.htaccess`, `woi_json()` |
| XSS | React escapes all text. There is no `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` anywhere (enforced by a test). Data links must be `http(s)`, so `javascript:` and `data:` URLs are rejected by both the browser and server schemas. External links use `noopener`. | `src/lib/schema.ts` (`safeUrl`), `tests/security-static.test.ts` |
| Injection | There is no SQL and no shell. All output is JSON-encoded. Status fields are limited to a safe character set, so HTML in a status field is rejected. | schema |
| Path traversal / file access | Snapshot ids must match `^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,79}$`; `..` is refused. File paths are never built from user input otherwise. <br>Live data is stored **outside** `public_html`. The server library, vendor code, schema and seed are denied by two layers of `.htaccess`. <br>Dotfiles, config, lock, log and markdown files are blocked. Directory listing is off. | `store.php`, `.htaccess` files |
| Strict JSON validation | One Zod schema (strict objects, size limits, http(s)-only links) is exported to JSON Schema and enforced again on the server by `opis/json-schema`. A test fails if the two drift apart. <br>`__proto__`, `constructor` and `prototype` keys are refused at any depth. <br>Bodies are limited to 2 MB and 64 nesting levels, with `Content-Type: application/json` required. | `schema.ts`, `validate.ts`, `_lib/validate.php`, `snapshot.schema.json` |
| Rate limiting | Per-client fixed windows, counted by a hash of the IP address: <br>• public 120/min <br>• data 240/min <br>• admin writes 30/h <br>• ingest 60/h <br>• bad automation tokens: 10/h, then 429 lockout | `woi_rate_limit()` |
| No stack traces | `display_errors` is off. Uncaught errors return `{"error":"Internal error","ref":"…"}`. Details go only to `woi-storage/private/error.log`. | `bootstrap.php` |

### Authentication and authorization

| Requirement | Implementation |
|---|---|
| Established provider, no custom passwords | Auth0, using OpenID Connect Authorization Code + PKCE through `oidc-client-ts`. WOI Equity never receives a password. |
| Protect private routes and APIs | The whole terminal (`/dashboard`) shows a sign-in or locked screen unless the **server** confirms a subscriber or admin role (`/api/me.php`). All research data is served only by `/api/data.php`, which requires a verified token. There are no data files in the public web folder. |
| Roles | **Public**: homepage and the public market summary (`/api/public.php`). <br>**Subscriber**: the full terminal and data. <br>**Admin**: also import/publish, rollback and the audit log. <br>Roles come from Auth0 RBAC permissions `woi:subscriber` and `woi:admin`. |
| Server-side checks on every request | `woi_require_role()` verifies on every call: <br>• the RS256 signature against the provider's JWKS <br>• algorithm pinned to RS256 <br>• exact issuer and audience <br>• required `exp` and `sub` <br>• `nbf` and `iat`, with 60 s leeway <br>The browser's own view of the role only chooses which screens to draw. |
| Deny by default | No auth configuration means protected endpoints return 503 and the terminal is locked. No token means the caller is public. An invalid token returns 401; it is never downgraded to public access. A valid token with no permission returns 403. |
| Machine ingestion | The automation job uses a separate random token. The server stores only its SHA-256, compares it in constant time, rate-limits failures and audits them. User tokens and the machine token cannot be used in each other's place (tested). |

### Secrets and API security

- **No secrets in frontend code, the repository, or any downloadable JSON:**
  - the source tree is scanned for key and token patterns by tests
  - the built site is scanned by `npm run security:check`
  - Auth0 client id, authority and audience are public identifiers, by design
- **Where secrets live:**
  - server: `woi-config.php` above `public_html`, holding only a hash of the machine token, plus Auth0 settings
  - automation: GitHub Actions encrypted secrets (`WOI_INGEST_TOKEN`, later `GEMINI_API_KEY` and `MARKET_DATA_API_KEY`)
- **AI output is untrusted data:**
  - Gemini output is parsed as JSON, validated against the strict schema, and stored as **unverified** unless its exact quote is found on sec.gov or the company's own domain
  - it is never executed, never turns into an instruction, and never sets a signal
  - verification fetches only `https` URLs on an allowlist of hosts
- **Minimum permissions:** see section 4.

### Financial research safety

- **Data vs. analysis:** verified market data and AI-written research are separate fields, labelled differently. Scenarios are shown as "Analysis, not data".
- **Sources:** every figure carries a source link and retrieval date.
- **Stale and missing data:** stale data shows **STALE** against the NYSE calendar. Missing values show a dash and the reason, never 0 or an estimate. Conflicting reported vs. recomputed values raise validation warnings.
- **No fabricated signals:** `washout.score` and `club3030.triggered` stay **RULE NOT DEFINED**. The server rejects any snapshot that sets a blocked signal (tested).
- **No trading:** there are no brokerage connections, order placement or trade execution anywhere in the code.

### Monitoring and recovery

- **Audit log:** append-only `woi-storage/private/audit.jsonl`, visible to admins in the dashboard. It records publishes (added, duplicate, conflict, replaced, rejected), rollbacks and failed automation logins.
  - Stored: provider user id, role and a hashed client address.
  - Never stored: tokens, emails or raw IPs (tested).
- **Update log:** `status.json`, with the last 50 runs. The dashboard shows "Update failed" with the reason.
- **Backups and rollback:**
  - every snapshot is archived immutably, and replaced versions are kept in `archive/revisions/`
  - admins can roll back "latest" from the dashboard
  - code rollback is a git revert
  - full procedure: RECOVERY.md
- **Dependency scanning:**
  - `npm audit` and `composer audit` run in CI and block deployment
  - Dependabot opens weekly update PRs for npm, Composer and GitHub Actions

---

## 2. Tests performed and results

All run locally on 2026-11-22. CI repeats them on every pull request and push.

| Suite | Tests | Result |
|---|---:|---|
| `security-server` (real PHP endpoints, real RS256 tokens) | 58 | **58 passed** |
| `security-static` (secrets, dangerous patterns, strict schema, schema sync, server hardening) | 17 | **17 passed** |
| `validation`, `derived`, `missing-spcx`, `calendar-stale`, `ordering-ingest`, `automation` | 43 | **43 passed** |
| **Total** | **118** | **118 passed, 0 failed** |
| `npm audit` | | 0 vulnerabilities (after upgrading zod 3→4, vite 5→8, vitest 2→5) |
| `composer audit` | | 0 advisories (after upgrading php-jwt 6→7 for CVE-2025-45769) |
| `npm run security:check` on the production build | | Passed |
| TypeScript strict typecheck | | Passed |

**Authentication bypass attempts, all rejected with 401** unless noted:
- no token, a garbage token, `alg: none`
- HS256 signed with the RSA public key (key confusion)
- an attacker key reusing the provider's `kid`, an unknown `kid`, a tampered payload
- wrong issuer, wrong audience, expired, not-yet-valid, missing `exp`, missing `sub`
- Basic auth, an oversized header
- a valid token with no permission: rejected with **403**

**Authorization matrix:**
- a subscriber is refused on every admin endpoint (403)
- a user token is refused on the automation endpoints (401)
- the machine token is refused on user and admin endpoints (401)
- wrong HTTP methods are refused (405)

**Malicious JSON, all refused:**
- invalid JSON, 200-level nesting, an array instead of an object
- unknown keys at the top level and nested
- `javascript:` and `data:` URLs, `__proto__` and `constructor` keys
- a price sent as text, oversized text, HTML in a status code
- path traversal in `snapshotId`
- a fabricated washout score, a Club 30/30 trigger without a rule
- an empty watchlist, a wrong schema version
- the wrong content type (415), a body over 2 MB (413)

After all these, nothing was written to storage.

**Other server tests:**
- **Path traversal on reads:** six variants refused.
- **Rate limits:** a 429 lockout after repeated bad automation tokens, and a 429 with `Retry-After` on public bursts.
- **Deny-by-default:** with no configuration, protected endpoints return 503. The HTTPS-only setting refuses plain HTTP.
- **Error hiding:** a forced storage failure returns only "Internal error" and a reference id, with no paths, class names or stack traces.
- **Store integrity:** duplicate uploads are no-ops, conflicts are refused, replace keeps a revision, an older snapshot never moves "latest" back, rollback works and is audited.

**Findings fixed during testing:**
- **npm advisories:**
  - zod memory exhaustion (high)
  - vitest and tinypool remote code execution in the development server (critical)
  - a vite path traversal in the development server (high)
- **php-jwt advisory:** CVE-2025-45769 (low).
- **Browser validator:** it silently dropped a `__proto__` key instead of rejecting the file. Now rejected, matching the server.
- **Workflow injection:** a GitHub workflow input was interpolated directly into a shell command. Now passed via an environment variable and allowlisted.

---

## 3. Remaining vulnerabilities and weaknesses (known)

| # | Issue | Severity | Mitigation / action |
|---|---|---|---|
| 1 | Login flow, CSP and token refresh are **untested against a real Auth0 tenant**. Server token checks are tested with locally minted RS256 tokens that follow the same standard. | High until verified | Section 7 checklist after Auth0 setup. |
| 2 | `.htaccess` behaviour on Hostinger's LiteSpeed is **unverified**: HSTS `env=HTTPS`, `Require all denied`, header directives. | High until verified | Section 7: check headers and confirm `/api/_lib/…` returns 403. |
| 3 | Access tokens live in `sessionStorage`; a successful XSS could read them. | Medium | Strict CSP, no inline scripts, React escaping, no third-party scripts. Keep Auth0 access-token lifetime at 1 hour or less. |
| 4 | Rate limits are per IP and file-based; they do not stop distributed attacks and are not DDoS protection. | Medium | Optionally put Cloudflare (free plan) in front later. Rate limiting would then need `CF-Connecting-IP` handling, which is not built. |
| 5 | The automation token is a long-lived shared secret. | Medium | Stored hashed on the server, failures locked out and audited. Rotate every 90 days with `npm run make-secret`. Turn on 2FA on GitHub. |
| 6 | Audit and error logs sit on the same server as the app and have no rotation. Someone with server file access could edit them. | Low | Hostinger backups. Download logs periodically. Add log rotation later. |
| 7 | GitHub Actions are pinned to major tags, not commit SHAs. | Low | Dependabot updates them. Pin to SHAs before enabling paid features. |
| 8 | Google Fonts CSS and fonts are fetched from Google on every page. | Low (privacy / supply chain) | Self-host the fonts later to remove the dependency. |
| 9 | A role removed in Auth0 stays effective until the current access token expires. | Low | Set the token lifetime to 1 hour or less. |
| 10 | Gemini, the market-data provider and Google Drive/Sheets are **not connected**, so their code paths are untested with real services. | n/a until connected | Each must get its own review before it is switched on. |

---

## 4. Third-party services and permissions

| Service | Used for | Permissions WOI Equity needs | Secret, and where it is stored |
|---|---|---|---|
| **GitHub** | Code, CI, deployment branch, scheduled automation | Workflows default to `contents: read`. Only the deploy job gets `contents: write`, to push `hostinger-deploy`. | `WOI_INGEST_TOKEN` (and later Gemini and market keys) as encrypted Actions secrets |
| **Hostinger** (Business) | Hosting, PHP 8.2, free SSL, Git pull | Git pulls the public repository branch `hostinger-deploy` (read-only) | `woi-config.php` above `public_html` |
| **Namecheap** | Domain registration | DNS pointed to Hostinger | Account login; enable 2FA |
| **Auth0** | Sign-in, user accounts, roles | One SPA application (no client secret). One API with RBAC; permissions `woi:subscriber` and `woi:admin`. No Management API credentials anywhere. | None in code; client id and audience are public |
| **Google Fonts** | Typography | Public CSS and font files | None |
| **SEC EDGAR, US Treasury** (future, automation) | Filings, yields | Public read | None (SEC asks for a contact User-Agent) |
| **Gemini API** (future) | Research drafts | An API key restricted to the "Generative Language API" only, in a dedicated Google Cloud project, with a budget alert | GitHub secret only |
| **Market data provider** (future) | Prices | Read-only market-data key | GitHub secret only |
| **Google Drive / Sheets** (future, optional) | Archive copy / log | `drive.file` scope only (files the app created), or one Sheet shared with a service account. Never full-Drive access. | GitHub secret only |

---

## 5. Hosting compatibility (Hostinger Business)

| Need | Status |
|---|---|
| Static files + PHP 8.1+ | Supported. Choose PHP 8.2+ in hPanel. CI tests use PHP 8.2; local tests used 8.3. |
| `.htaccess` (rewrite, headers, `Require`) | Hostinger runs LiteSpeed, which reads `.htaccess`. **Verify on the real account** (section 7). |
| Writable folder outside `public_html` | Standard on Hostinger (home directory). Used for `woi-storage` and `woi-config.php`. |
| PHP `curl` and `openssl` extensions | Normally enabled. JWKS fetching falls back to `file_get_contents` if `curl` is missing. |
| No Node.js on the server | Correct. The site is built in GitHub Actions and Composer packages ship inside the build. |
| Git deployment and auto-deploy webhook | Supported (hPanel → Advanced → GIT). |
| Free SSL | Supported. **Enable it before deploying**, because the HTTPS redirect is on. |

---

## 6. Outstanding risks that need your attention

1. **Turn on 2FA** for GitHub, Hostinger, Namecheap and Auth0. In Auth0, require MFA for admins.
2. **Disable public sign-ups in Auth0** until subscriptions launch. Turn on Auth0's brute-force and breached-password protection.
3. **Set the Auth0 API access-token lifetime to 3600 seconds or less.**
4. **The GitHub repository is public:** never commit private research, subscriber data or `woi-config.php`. Consider making it private (Hostinger then needs a deploy key).
5. **Paid subscriptions need a payment integration** (for example Stripe) that grants or removes the `woi:subscriber` permission. Not built. It needs its own design and review before anyone is charged.
6. **Legal:** add a privacy policy and terms of service before collecting accounts. Make sure the research disclaimers meet your obligations as a financial publisher.
7. **Backups:** confirm Hostinger backups include the folder above `public_html` (`woi-storage`). Download `woi-storage` monthly.

---

## 7. Pre-production verification checklist (on the real site)

Complete every item. Do **not** set `WOI_DEPLOY_ENABLED=true` for paid users until all items pass.

- [ ] `http://woiequity.com` redirects to `https://`.
- [ ] Response headers include Strict-Transport-Security, Content-Security-Policy (with your Auth0 domain in `connect-src`) and X-Frame-Options DENY. Check with securityheaders.com.
- [ ] `https://woiequity.com/api/_lib/bootstrap.php`, `/api/_lib/composer.json` and `/api/_lib/seed/latest.json` each return **403**.
- [ ] `https://woiequity.com/api/data.php?file=latest` without signing in returns **401** (or 503 before Auth0 is configured).
- [ ] Signed in **without** a role: the terminal shows "doesn't include the terminal".
- [ ] Signed in as a **subscriber**: the terminal works; the Admin and Import pages are hidden; `/api/admin/audit.php` with that token returns 403.
- [ ] Signed in as **admin**: publishing a file works and appears in the audit log; rollback works.
- [ ] Sign out returns you to the homepage, and the terminal asks you to sign in again.
- [ ] Forcing an error shows only "Internal error" with a reference id.
- [ ] The Codex review is complete and its findings are fixed or accepted in writing.
