# WOI Equity: start here

This project holds two things:
- **The public website**, at `woiequity.com`.
- **The private research terminal**, at `woiequity.com/dashboard`. Only subscribers and admins can use it.

Both run on your existing Hostinger Business plan.

> **Before going live, read SECURITY.md.** The site is built and tested, but several protections can only be confirmed once your real Auth0 and Hostinger accounts are connected (SECURITY.md, section 7). Deployment stays switched off until you turn it on in step 9.

---

## What each visitor sees

| Visitor | Sees |
|---|---|
| Anyone | The homepage, with the latest public market summary (closes, S&P 500, VIX, regime) and sources |
| Signed in, no subscription | A polite "your account doesn't include the terminal" page |
| Subscriber | The full research terminal |
| Admin (you) | The terminal, plus **Import & publish**, **Rollback** and the **Audit log** |

The server checks these roles on every request, not just the web page.

---

## 1. Preview on your own computer (optional)

1. Install **Node.js** (the "LTS" version) from nodejs.org.
2. Open **Terminal** (Mac) or **PowerShell** (Windows).
3. Type `cd ` (with a space), drag the `woi-equity` folder into the window, and press Enter.
4. Run `npm install`.
5. Run `npm run dev`.
6. Open `http://localhost:5173`. The dashboard is at `/dashboard/`.

The local preview shows the terminal **without** sign-in, using the Nov 20 baseline, and says **LOCAL PREVIEW** at the top. This mode exists only on your computer: the real website never includes it (an automated check enforces this).

---

## 2. Turn on two-factor sign-in everywhere (10 minutes)

Turn on 2FA for **GitHub**, **Hostinger**, **Namecheap**, and **Auth0** (step 4). These accounts control your whole site.

---

## 3. Point woiequity.com at Hostinger (Namecheap)

1. In **hPanel → Websites**, add `woiequity.com` if it isn't listed.
2. Note the two nameservers hPanel shows. They are usually `ns1.dns-parking.com` and `ns2.dns-parking.com`.
3. In **Namecheap → Domain List → Manage → Nameservers**, choose **Custom DNS**, enter the two nameservers, and click the green check.
4. **If you have email on woiequity.com**, copy its MX records first and re-add them in hPanel's DNS settings afterwards.

The change can take up to 24 hours.

---

## 4. Create the sign-in service (Auth0, free plan)

Auth0 handles passwords, password resets, two-factor and account security, so WOI Equity never stores a password. Its free plan is enough to start. Check auth0.com/pricing before you launch paid subscriptions.

1. **Sign up** at auth0.com. Choose a region near you and a tenant name such as `woiequity`.
2. **Create the application:** go to **Applications → Create Application**, name it `WOI Equity`, choose **Single Page Application**, and click **Create**. Then open its **Settings** and set:
   - **Allowed Callback URLs:** `https://woiequity.com/dashboard/`
   - **Allowed Logout URLs:** `https://woiequity.com/`
   - **Allowed Web Origins:** `https://woiequity.com`
   - Scroll down and click **Save**.
   - Copy the **Domain** (e.g. `woiequity.us.auth0.com`) and the **Client ID**.
3. **Turn on longer sessions:** in the same Settings page, under **Refresh Token Rotation**, turn on **Rotation** and click **Save**.
4. **Create the API:** go to **Applications → APIs → Create API**.
   - Name: `WOI Equity API`
   - Identifier: `https://woiequity.com/api`
   - Signing algorithm: **RS256**
   - Then, in its **Settings**:
     - set **Maximum Access Token Lifetime** to `3600`
     - turn on **Allow Offline Access**
     - under **RBAC Settings**, turn on **Enable RBAC** and **Add Permissions in the Access Token**
     - click **Save**
   - In its **Permissions** tab, add `woi:subscriber` and `woi:admin`.
5. **Create the roles:** go to **User Management → Roles**.
   - Create **Admin** and give it both permissions.
   - Create **Subscriber** and give it `woi:subscriber` only.
6. **Create your own account and make yourself admin:** go to **User Management → Users → Create User** and create yours. Open it, go to **Roles → Assign Roles**, and choose **Admin**.
7. **Lock it down until launch:**
   - **Authentication → Database → Username-Password-Authentication:** turn on **Disable Sign Ups**.
   - **Security → Multi-factor Auth:** turn it on.
   - **Security → Attack Protection:** turn on **Brute-force Protection** and **Breached Password Detection**.
8. **Logout:** under **Settings → Advanced**, make sure **RP-Initiated Logout End Session Endpoint Discovery** is on, if Auth0 shows it.

---

## 5. Tell GitHub the sign-in settings (public identifiers, not secrets)

Go to the repository's **Settings → Secrets and variables → Actions → Variables → New repository variable** and add:

| Name | Value |
|---|---|
| `WOI_AUTH_AUTHORITY` | `https://YOUR-DOMAIN/`, using the Auth0 Domain with `https://` and a final `/` |
| `WOI_AUTH_CLIENT_ID` | the Client ID |
| `WOI_AUTH_AUDIENCE` | `https://woiequity.com/api` |

Also go to **Settings → Actions → General** and choose **Allow all actions**.

---

## 6. Merge the code

1. On github.com, open **Pull requests → New pull request**.
2. Set base **main** and compare **claude/sharp-wright-6lazqp**.
3. Click **Create pull request**.
4. The **WOI Equity checks** run automatically: dependency scans, 118 tests and a security check. Wait for a green check.
5. Click **Merge**.

Nothing deploys yet, because deployment is still switched off.

---

## 7. Set up the server (Hostinger)

1. **PHP:** in hPanel → your site → **Advanced → PHP Configuration**, choose **PHP 8.2** or newer and click **Save**.
2. **SSL first:** go to **Security → SSL**, install the free certificate, and wait until it shows **Active**. The site forces HTTPS, so do this before deploying.
3. **Make the automation secret:** on your computer, in the `woi-equity` folder, run `npm run make-secret`. It prints:
   - a **token**: put it in GitHub only, under **Secrets → New repository secret**, named `WOI_INGEST_TOKEN`
   - two lines for the server config
   - Also save the token in your password manager, then close the window.
4. **Create the config file:**
   1. In **File Manager**, open `public_html`, then go **up one folder**.
   2. Create a new file named `woi-config.php`.
   3. Paste in the contents of `server/woi-config.sample.php`.
   4. Fill it in: the two lines from `make-secret`, and the Auth0 domain and audience in the `auth` section.
   5. Save.

   This file never goes in `public_html` or GitHub.

---

## 8. Connect Hostinger to GitHub

1. In **File Manager**, empty `public_html`: delete the default files Hostinger put there.
2. Go to **hPanel → Advanced → GIT** and fill in:
   - Repository: `https://github.com/jal3n8/Presidential-Morning-Brief.git`
   - Branch: `hostinger-deploy`
   - Directory: leave empty
   - Click **Create**.
3. In **GIT → Auto Deployment**, copy the webhook URL.
4. On GitHub, go to **Settings → Webhooks → Add webhook**, paste it as the **Payload URL**, and click **Add webhook**.

---

## 9. Switch deployment on (only after reading SECURITY.md)

1. In GitHub, go to **Settings → Environments → New environment** and name it `production`.
   - Under **Deployment protection rules**, tick **Required reviewers** and add yourself.
   - Now every deploy waits for your click.
2. Add the repository **variable** `WOI_DEPLOY_ENABLED` = `true`.
3. Go to **Actions → WOI Equity checks and deploy → Run workflow**. When it asks, approve the deployment.
4. In hPanel → **GIT**, click **Deploy** the first time.
5. Work through **SECURITY.md, section 7** on the live site. Fix anything that fails before inviting anyone.

---

## 10. Everyday tasks

- **Publish a new snapshot by hand:**
  1. Open the dashboard and go to **Import & publish**.
  2. Drop in the JSON. It is checked on your device first.
  3. Click **Publish to server**. The server checks it again, archives it and records it in the audit log.
- **Undo a bad update:** go to **Admin → Roll back**. See RECOVERY.md.
- **Give someone access:**
  1. In Auth0 → **Users**, create the user or let them sign up once sign-ups are enabled.
  2. Assign the **Subscriber** role.
  3. To remove access, remove the role. It takes effect within an hour.
- **Monthly:** download a backup of `woi-storage` (RECOVERY.md) and merge Dependabot's update pull requests once their checks pass.

---

## What is not connected yet

- **Automatic market updates:** needs a market-data provider and keys (AUTOMATION_PLAN.md).
- **Gemini research:** needs a key restricted to the Gemini API.
- **Google Drive / Sheets copies:** optional.
- **Paid subscriptions:** need a payment service (for example Stripe) that assigns the Subscriber role automatically. **Do not charge anyone** until that is built and reviewed, and until you have a privacy policy and terms of service.
