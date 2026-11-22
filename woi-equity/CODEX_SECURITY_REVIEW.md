# Independent security review brief (for Codex)

Paste everything below the line into Codex, with this repository open. Codex should review and test independently; it should not trust the claims in SECURITY.md.

---

You are an independent application-security reviewer. Review the `woi-equity/` project in this repository: a React/Vite website and research terminal with PHP 8.2 endpoints deployed to Hostinger shared hosting. It uses Auth0 (OIDC Authorization Code + PKCE) for sign-in. Do not modify code until you have reported findings. For each finding give: severity (critical/high/medium/low), file and line, a reproduction, and a fix.

**Threat model**
- Anonymous internet users.
- Signed-in users without a subscription.
- Subscribers trying to reach admin functions.
- Someone holding a stolen or forged token.
- A compromised or malicious research source (AI output, web pages).
- A malicious JSON upload.

**Assets**
- Subscriber-only research data (`/api/data.php`).
- The ability to publish or roll back what subscribers see (`/api/admin/*`, `/api/ingest.php`).
- The machine token.
- Audit integrity.

**Run first**
```
cd woi-equity
composer install --working-dir=public/api/_lib
npm ci
npm test
npm run build && npm run security:check
npm audit
composer audit --working-dir=public/api/_lib
```

**Review in particular**
1. **Token verification:** `public/api/_lib/auth.php`.
   - RS256 pinning, key confusion, `kid` handling, JWKS caching and refresh.
   - Issuer and audience checks, clock leeway, permission-to-role mapping.
   - Can any path return protected data without `woi_require_role`?
2. **Authorization coverage:** every endpoint in `public/api/*.php` and `public/api/admin/*.php`.
3. **Path handling:** `woi_valid_id`, `woi_archive_file`, the rollback id. Check for symlink and Windows-style traversal, and null bytes.
4. **Validation parity:** `src/lib/schema.ts` → `scripts/export-schema.ts` → `public/api/_lib/snapshot.schema.json` → `_lib/validate.php`.
   - Find a payload one side accepts and the other rejects.
   - Find payloads that cause excessive CPU or memory in opis/json-schema or zod.
5. **Store concurrency:** locking, atomic rename and forward-only latest in `store.php`.
   - Can two simultaneous publishes corrupt `index.json` or move latest backwards?
6. **Rate limiting:** `woi_rate_limit`. Bypasses, file-exhaustion of the rate-limit folder, and behaviour behind a proxy.
7. **Web server rules:** `public/.htaccess` and `public/api/.htaccess` on LiteSpeed.
   - Can `_lib`, vendor, the seed or dotfiles be fetched?
   - Is the CSP sufficient? Is HSTS set?
8. **Frontend:**
   - token storage (`oidc-client-ts`, sessionStorage)
   - CSP compatibility with the Auth0 flows
   - any HTML injection sink
   - link-scheme enforcement
   - the development-only preview: confirm it is absent from `dist/`
9. **Error handling:** can any input produce PHP warnings, paths or stack traces in a response?
10. **Logging:** confirm no tokens, emails or raw IPs reach `audit.jsonl`, `status.json` or `error.log`.
11. **Automation:** `automation/*.ts`.
    - Prompt-injection impact from Gemini output.
    - SSRF in `verifyItem`.
    - Secret exposure in GitHub Actions logs.
    - Workflow permissions and injection in `.github/workflows/woi-*.yml`.
12. **Financial safety:** confirm no code path can publish a non-null `washout.score`, `club3030.triggered` or any blocked signal, or fabricate a price or indicator.

Finish with:
- a findings table
- what you tested and how
- what you could not test (for example the real Auth0 tenant and the Hostinger server)
- a go / no-go recommendation for production
