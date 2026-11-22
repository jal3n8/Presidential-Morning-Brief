# WOI Equity: start here

This folder holds two things:

- **The public website**, which appears at `woiequity.com`.
- **The research terminal**, which appears at `woiequity.com/dashboard`.

Both run on the Hostinger Business plan you already pay for. Nothing here needs a new paid service.

The site currently shows your hand-verified baseline for the **November 20, 2026** close. The site labels it **SAMPLE** because it is not a live feed.

---

## What works today, and what is not connected yet

| Works now | Not connected yet (needs your accounts or keys) |
|---|---|
| Homepage, with the latest snapshot and watchlist | Automatic price updates (needs a market-data provider, see AUTOMATION_PLAN.md) |
| Dashboard on iPhone and desktop: Command Center, Watchlist, stock pages, Three Horsemen, Washout, Club 30/30, Macro, Sources, History, Audit | Gemini research updates (needs a Gemini API key) |
| Every number shown with its source link, and missing values shown as missing | Google Drive or Sheets copies (optional) |
| SAMPLE, STALE and LIVE labels; checks for new data every 5 minutes; Refresh button; Auto on/off switch | The live data store on Hostinger (turns on after step 6) |
| Three Horsemen recomputed from the prices (shows DEFENSIVE) | Member sign-in for paid content (not built yet; see "Private content" below) |
| Washout score and Club 30/30 locked as **RULE NOT DEFINED** | |
| Manual JSON import: check a file, preview it, keep it in your browser | |
| Publishing a new JSON by uploading it to GitHub | |
| Secure upload endpoint on the server (`/api/ingest.php`), locked behind a secret | |
| 55 automated tests | |

---

## 1. Look at it on your own computer (optional)

You need **Node.js** once. Download the "LTS" version from nodejs.org and install it like any other app.

1. Open **Terminal** (Mac) or **PowerShell** (Windows).
2. Go to this folder. Type `cd`, then a space, then drag the `woi-equity` folder into the window, and press Enter.
3. Type `npm install` and press Enter. Wait until it finishes, which takes about a minute.
4. Type `npm run dev` and press Enter.
5. Open the address it prints, normally `http://localhost:5173`.
   - The website is at `/`.
   - The dashboard is at `/dashboard/`.
6. To stop it, click the Terminal window and press `Ctrl` + `C`.

Other commands:

- `npm test` runs all the checks.
- `npm run build` makes the finished website in `dist/`.

---

## 2. Where the JSON lives

| File | What it is |
|---|---|
| `reference/woi_equity_verified_2026-11-20.json` | Your original file, never modified |
| `public/data/latest.json` | What the site shows when the server has no newer data |
| `public/data/archive/2026-11-20.json` | Permanent archive copy |
| `public/data/archive/index.json` | List of archived snapshots |

**To check a new file without publishing it:**

1. Open the dashboard.
2. Tap **Import** in the menu.
3. Drag the file in.
4. You'll see either **Valid** or **Rejected**, with the reasons.
5. **Preview in dashboard** shows the whole terminal using that file. Only you see it.

**To publish a new file for everyone:**

1. On github.com, open your repository.
2. Go to the folder `woi-equity/inbox`.
3. Click **Add file → Upload files**.
4. Drop in the JSON file.
5. Click **Commit changes**.

Within about two minutes, GitHub checks the file, archives it and updates the website. A bad file is moved to `inbox/rejected/` with a note explaining why, the site keeps showing the last good data, and GitHub emails you that the run failed.

To deliberately replace an existing snapshot for the same date, name the file ending in `.replace.json`.

---

## 3. GitHub (one-time setup)

Your code is in the GitHub repository `jal3n8/Presidential-Morning-Brief`, in the `woi-equity` folder. That repository is **public**: anyone can read the code and the published JSON. No secrets are ever stored in it.

The work is on a branch named `claude/sharp-wright-6lazqp`. To make it live:

1. Open the repository on github.com.
2. Click **Pull requests → New pull request**.
3. Set **base: main** and **compare: claude/sharp-wright-6lazqp**.
4. Click **Create pull request**, then **Merge pull request**.

After the merge, open the **Actions** tab. You'll see **WOI Equity deploy** running. When it shows a green check, GitHub has created a branch called `hostinger-deploy` containing the finished website.

If GitHub asks you to approve workflows, go to **Settings → Actions → General** and choose **Allow all actions**. In the same screen, under **Workflow permissions**, choose **Read and write permissions** and click **Save**.

---

## 4. Point woiequity.com at Hostinger (Namecheap)

Do this once. It can take up to 24 hours to take effect worldwide.

1. **In Hostinger (hPanel):**
   1. Go to **Websites**.
   2. If woiequity.com is not listed, click **Add website** and enter `woiequity.com`.
   3. Open the website's **Dashboard**.
   4. Find the **nameservers** Hostinger asks you to use. They are usually `ns1.dns-parking.com` and `ns2.dns-parking.com`. Use whatever hPanel shows you.
2. **In Namecheap:**
   1. Go to **Domain List** and click **Manage** next to woiequity.com.
   2. Find **Nameservers**, choose **Custom DNS**, and enter the two Hostinger nameservers.
   3. Click the green check mark.
3. **Email warning:** if you have email on woiequity.com (Namecheap Private Email, Google Workspace, and so on), copy its MX records first. After switching nameservers, add them in Hostinger under **Domains → DNS / Nameservers**, or your email will stop arriving.

---

## 5. Connect Hostinger to GitHub (automatic deploys)

1. **Choose PHP 8.2:** in hPanel, open woiequity.com → **Advanced → PHP Configuration**, choose **PHP 8.2** (or newer), and click **Save**.
2. **Empty the website folder:** go to **Files → File Manager → public_html** and delete what Hostinger placed there, such as `default.php`. Hostinger requires an empty folder for Git.
3. **Connect the repository:** go to **Advanced → GIT** and fill in:
   - **Repository:** `https://github.com/jal3n8/Presidential-Morning-Brief.git`
   - **Branch:** `hostinger-deploy`
   - **Directory:** leave empty (this means `public_html`)

   Click **Create**, then click **Deploy**.
4. **Turn on auto-deploy:**
   1. Still in **GIT**, click **Auto Deployment** and copy the **Webhook URL**.
   2. On github.com, open the repository's **Settings → Webhooks → Add webhook**.
   3. Paste the URL into **Payload URL**. Leave everything else as it is.
   4. Click **Add webhook**.

   From now on, every website update deploys by itself.
5. **Turn on HTTPS:**
   1. Go to **Security → SSL** and install the free SSL certificate for woiequity.com.
   2. Once it shows **Active**, switch on **Force HTTPS**.
6. **Check it worked:**
   - `https://woiequity.com` shows the homepage.
   - `https://woiequity.com/dashboard` shows the terminal.

---

## 6. Prepare the secure data store (needed for automation later)

This creates the secret that lets the automation job, and only the automation job, publish data.

1. **Make a secret:** on your computer, in the `woi-equity` folder, run:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   It prints a 64-character secret. Copy it.
2. **Create the config file:**
   1. In Hostinger **File Manager**, open `public_html`, then go **up one folder**. You should see `public_html` listed inside the folder you are in.
   2. Create a new file there named `woi-config.php`.
   3. Paste in the contents of `server/woi-config.sample.php` from this project.
   4. Replace `REPLACE_WITH_A_LONG_RANDOM_TOKEN` with your secret, and save.
3. **Store the same secret in GitHub:**
   1. Go to the repository's **Settings → Secrets and variables → Actions → New repository secret**.
   2. For **Name**, enter `WOI_INGEST_TOKEN`.
   3. For **Secret**, paste your secret.
4. **Never** paste the secret into chat, email, the website, or any file inside `public_html`.

The data store folder `woi-storage` (next to `woi-config.php`) is created automatically the first time data is published.

---

## 7. Private content and member sign-in

Everything on the site is currently public, but search engines are asked not to index the dashboard.

**Do not add paid or private research yet.**

- **Quick, temporary lock:** you can put a password on the dashboard today in hPanel: **Advanced → Password Protect Directories → `public_html/dashboard`**. This is a single shared password, fine for testing with a few people. It is not a subscriber system.
- **Real subscriber accounts:** these need proper sign-in (individual accounts, password reset, and payment status) checked on the server. `public/api/data.php` already has a marked place for that check. The browser never holds the secret, so turning it on later does not change the dashboard. Options and trade-offs are in AUTOMATION_PLAN.md, section 6. Choose one before launching paid content.

---

## 8. Something looks wrong?

- **The dashboard shows STALE:** no newer snapshot has been published since the date shown. That is expected until automation is connected.
- **The dashboard shows "Update failed":** open **Audit** in the dashboard. The update log explains the reason, and the last good data is still shown.
- **The site didn't update after an upload:**
  - Check the GitHub **Actions** tab for a red X.
  - Then check hPanel → **GIT** for the last deployment time.
