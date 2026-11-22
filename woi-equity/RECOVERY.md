# WOI Equity: backups and rollback

## What is backed up where

| Thing | Primary copy | Backup |
|---|---|---|
| Code | GitHub (full history) | Every commit; the `hostinger-deploy` branch keeps every build |
| Published snapshots | `woi-storage/archive/` on Hostinger (immutable, one file per session) | Superseded versions kept in `archive/revisions/`; Hostinger account backups; your monthly download |
| Audit and update logs | `woi-storage/private/audit.jsonl`, `woi-storage/status.json` | Hostinger backups; monthly download |
| Secrets | `woi-config.php` (Hostinger), GitHub secrets | Your password manager (store the machine token there when you create it) |
| User accounts and roles | Auth0 | Managed by Auth0 |

**Monthly backup** (5 minutes):
1. In hPanel → **File Manager**, go to the folder above `public_html`.
2. Right-click `woi-storage` → **Compress**.
3. Download the zip.
4. Keep it somewhere private.

Before relying on Hostinger's backups, check under hPanel → **Files → Backups** that they include that folder.

## Roll back bad data (most common)

1. Sign in to the dashboard as an admin.
2. Go to **Admin → Roll back the published snapshot**.
3. Choose the last good snapshot.
4. Type its id to confirm, then click **Roll back**.

Subscribers see the change on their next refresh, within 5 minutes. The bad file stays archived for investigation, and the rollback appears in the audit log.

## Roll back a bad website release

1. On github.com, open the commit that caused the problem.
2. Click **Revert**, which creates a pull request that undoes it.
3. Merge that pull request.

The checks run, then the site redeploys automatically, in about 3 minutes.

**Emergency, before a revert finishes:**
1. In hPanel → **GIT**, check the deployment list for the previous good build.
2. Redeploy it, if your Hostinger panel offers that option.
3. If not, set the GitHub variable `WOI_DEPLOY_ENABLED` to `false`. This stops further deploys while you revert.

## A secret may have leaked

**The automation token:**
1. Run `npm run make-secret`.
2. Replace the GitHub secret `WOI_INGEST_TOKEN` with the new token.
3. Replace `ingest_token_sha256` in `woi-config.php` with the new hash.

The old token stops working immediately. Check the audit log for `ingest.auth_failed` and unexpected publishes.

**An Auth0 admin account:**
1. In Auth0, block the user and remove the `Admin` role.
2. Reset MFA for that account.
3. Review the audit log for that user's id.
4. Roll back data if needed.

## Restore after server loss

1. Re-create `woi-config.php` from your password manager (START_HERE step 7).
2. Upload the latest `woi-storage` zip to the folder above `public_html` and extract it.
3. In hPanel → **GIT**, deploy `hostinger-deploy` again.
4. Run the SECURITY.md section 7 checklist.
