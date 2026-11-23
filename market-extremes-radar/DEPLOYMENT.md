# Deploying to Hostinger (woiequity.com/dashboard)

The Radar is a **static website**: plain HTML, JavaScript and data files. It has no database, no PHP, no server code and no secrets, so it runs on Hostinger Business without any special setup.

> Nothing in this guide buys a service, changes DNS or publishes anything until you do it yourself.

---

## Before you start

- The domain `woiequity.com` must already point at your Hostinger account, with SSL (the padlock) **active**. Check in **hPanel → Websites → woiequity.com → Security → SSL**.
- You have run the app locally at least once (see README.md).

---

## 1. Refresh the data (on your computer)

```
npm run data:update
```

This downloads the latest closes and rebuilds `public/data/verified/`. Read the last lines it prints:

- `Wrote 7 series ... (last market date YYYY-MM-DD)`: good.
- `ERROR: core S&P 500 and VIX series are required`: the download failed. Try again later. The app will fall back to the labelled demo data.

## 2. Run the tests

```
npm run test:all
```

Every line should end in **passed** or **OK**. Don't deploy if anything fails.

## 3. Build the site

```
npm run build
```

This creates a `dist` folder containing `index.html`, `.htaccess`, `assets/` and `data/`.

> `.htaccess` starts with a dot, so your computer may hide it. On a Mac, press **Cmd + Shift + .** in Finder to show hidden files. On Windows, use **File Explorer → View → Show → Hidden items**.

## 4. Check the build before uploading (optional but recommended)

```
npm run preview
```

Open http://127.0.0.1:4173 and check the header. It should show **Source-backed** and the right market date, unless you intend to publish demo data. Press **Ctrl + C** to stop.

## 5. Upload (first time)

1. In **hPanel → Websites → woiequity.com → Files → File Manager**, open `public_html`.
2. Create a folder named `dashboard`.
3. Open `dashboard` and upload **everything inside** `dist`: `index.html`, `.htaccess`, and the `assets` and `data` folders. Upload the contents, not the `dist` folder itself.
   - The easiest way is to zip the *contents* of `dist` on your computer, upload the zip, then right-click it in File Manager → **Extract**, and delete the zip.
4. Visit **https://woiequity.com/dashboard/**.

## 6. Make it private (recommended for private research)

Without this step, anyone who guesses the address can see the page. Real market data from Yahoo, S&P and Cboe is licensed for personal use, so keep it private.

1. **hPanel → Websites → woiequity.com → Advanced → Password Protect Directories**.
2. Choose the folder `public_html/dashboard`, set a username and a strong password, and save.
3. Open https://woiequity.com/dashboard/ in a **private/incognito window**. The browser should ask for the username and password.

This is real server-side protection (HTTP authentication over HTTPS). The app deliberately has no login screen of its own, because a login form in a static page could not actually protect anything.

## 7. Updating later

1. Run steps 1–3 again on your computer.
2. In File Manager, open `public_html/dashboard` and replace **only** `index.html`, `assets` and `data`. Delete the old `assets` folder first, so outdated files don't accumulate.
3. **Do not overwrite `.htaccess`.** Hostinger stored your password protection in it. If you do overwrite it, repeat step 6.
4. Re-check in a private window that the password prompt still appears.

---

## What the `.htaccess` file does

- Forces HTTPS.
- Turns off directory listings and blocks hidden files and source maps.
- Adds security headers: a Content Security Policy that only allows the site's own scripts, anti-framing, no-sniff, no referrer, and no camera/microphone/location access.
- Asks search engines not to index the page (`noindex`). That is a request, not protection, so step 6 is still needed.
- Makes browsers re-check the data on every visit, so updates appear immediately.

The built `index.html` also contains a Content Security Policy, so the core protection still applies if `.htaccess` is missing.

## Security checklist

- [ ] No API keys anywhere. The MVP needs none (`.env.example` lists optional future settings only).
- [ ] No analytics or trackers. None are included.
- [ ] No admin pages, PHP or upload endpoints. The site is static.
- [ ] Password protection is on and checked in a private window.
- [ ] The header shows the expected data label (Source-backed or Demo) and market date.

## Moving to a public newsletter companion later

Before making any page public:

1. **License the data.** Yahoo's terms don't allow republishing, and S&P 500 and VIX values belong to S&P Dow Jones Indices and Cboe. Options include a paid market-data API whose licence covers display, or publishing only your own derived commentary without the raw series.
2. Decide what's public (for example, the weekly brief text) versus private (the full terminal).
3. Add a scheduled server-side job to refresh data, storing any API key on the server, never in the website files.
