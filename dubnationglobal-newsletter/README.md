# DubNationGlobal · newsletter landing page

A one-page site for **DubNationGlobal.com** whose job is to earn email subscriptions and introduce the upcoming fan globe.

Built with React, TypeScript, Vite and Tailwind CSS. The globe is a lightweight 2D canvas (d3-geo), with no WebGL and no image textures.

> **Current state: demo mode.** No newsletter provider is connected yet, so the forms don't save anything, and the page says so wherever it matters. Follow "Connect a newsletter provider" below to switch on real signups.

---

## Run it

```bash
npm install
npm run dev        # http://127.0.0.1:5180
npm test           # 63 automated tests
npm run build      # production files in dist/
npm run preview    # serve dist/ at http://127.0.0.1:4180
```

**Edit content in one place:** `src/config/site.ts` holds the brand text, links, contact and social slots, social proof, newsletter settings, globe cities and example tip-off time. Page copy lives in `src/components/`, one file per section.

---

## Page structure

| # | Section | Anchor |
|---|---|---|
| 1 | Header: text wordmark, links to *Newsletter* and *Fan globe*, and a Subscribe button (tablet and desktop) | |
| 2 | Hero: "DubNation, everywhere.", primary signup form, glowing globe with gold Bay Area connections | `#top`, `#signup` |
| 3 | Three reasons to subscribe, with a live time-zone example | `#newsletter` |
| 4 | **Sample edition**: subject line, opening take, linked-story format, watch guide, "Around DubNation" glimpse | |
| 5 | Fan globe preview: **In development**, city selector, "Get project updates by email" | `#fan-globe` |
| 6 | About DubNationGlobal | `#about` |
| 7 | Final signup (kept in sync with the hero form) | `#join` |
| 8 | Footer: disclosure, privacy and unsubscribe note, contact and social slots | `#privacy` |

A "Skip to the signup form" link appears on the first press of Tab.

---

## Visual choices

- **Space, not stadium.** The page sits on near-black (`#05070D`) with a faint, static starfield. The globe floats there like a planet seen from orbit: a translucent, smoky deep-blue sphere with a soft rim light, faint coastlines and a barely-there grid.
- **Warriors-inspired, not copied.** Royal blue (`#1F4FA8`) carries the atmosphere and warm gold (`#F5B930`) is saved for things that matter: city lights, connection arcs, the subscribe button and section labels. No team logos or marks are used.
- **Type.** Barlow Condensed (uppercase, bold) is used only for headlines, labels and buttons; it reads like arena signage. DM Sans carries every paragraph at 15–18 px with generous line height. Both fonts are self-hosted, so the page makes no requests to Google.
- **Hierarchy.** The headline and form always win. On desktop the globe sits to the right, bleeding off the edge, behind a gradient that keeps the text crisp. On phones it glows behind the top of the hero and fades out before the form. On a 390 px phone the Join button is fully visible on the first screen; on a 320 × 640 phone it sits just below the fold.
- **Motion with a purpose.** The globe turns slowly (about 2.5 minutes per revolution). A gold pulse travels from the Bay Area along each arc, and lights twinkle faintly. Headings rise in once. Everything stops under *Reduce motion*, and the globe pauses when it's off-screen or the tab is hidden.
- **Large targets.** Every link and button is at least 44 px tall; inputs and buttons are 52 px.

## The globe: what actually works

| Interaction | Status in this prototype |
|---|---|
| Slow auto-rotation, gold arcs from the Bay Area to Tokyo, Manila, São Paulo and Paris, travelling pulses, twinkling lights (hero) | **Working**, decorative |
| City selector (Bay Area, Tokyo, Manila, São Paulo): the globe turns to the city, its arc highlights, and the panel shows the city name, its **real** current local time and an example 7 p.m. Pacific tip-off converted to local time | **Working**: click, tap or arrow keys |
| Drag or swipe the preview globe to spin it (vertical page scrolling still works on phones) | **Working** |
| Fan counts, "see who's watching", city pages, check-ins, fan stories | **Not built**. Shown only as the planned experience, marked *In development* |

City lights are real city locations but **purely decorative**. They don't represent subscribers, fans or any data, and the page says so next to both globes.

**Resilience.**
- Before the canvas draws, or if canvas is unavailable, a CSS-only sphere holds the same space, so nothing jumps.
- If the coastline file (`public/geo/land-110m.json`, 55 KB) fails to load, the globe still renders its sphere, lights and arcs.
- The signup forms never depend on the globe.

---

## Signup behaviour

Both forms share one state: the same email field value, one pending lock and one result. Whichever form is used, both show the same outcome. Only the form you used makes screen-reader announcements, so nothing is read out twice.

| Situation | What the visitor sees |
|---|---|
| Empty or malformed address | An inline message on that form only (for example "Check the part after the @…"); the field is flagged and focused; nothing is sent |
| While sending | The button reads "Joining…" and is marked busy; extra clicks or presses of Enter on **either** form are ignored |
| Success, double opt-in (default) | "Check your inbox." explains that a confirmation link was sent |
| Success, single opt-in | "You're on the list." |
| Already subscribed | "You're already on the list." (and, with double opt-in, a reminder to look for the original confirmation) |
| Failure (network, timeout, provider error, rate limit) | "That didn't go through. Nothing was saved." The email **stays in the box** for a retry |
| Same address submitted again in the same visit | Not re-sent; the earlier result is shown with a note |
| **Demo mode (now)** | "Demo only: not saved." Test addresses `duplicate@example.com` and `fail@example.com` preview the other states |

Only the email address is collected. A hidden, empty "website" honeypot field catches bots; it isn't data about the visitor. Adding fields such as a city or a first name is a deliberate future option. If you add them, update the privacy note at the same time.

---

## Demo behaviour vs production dependencies

**Demo (what's live in this build)**
- `VITE_NEWSLETTER_MODE=demo` (the default). `subscribe()` waits about 1 second and returns a demo result. **Nothing is sent or stored**, and both the form and the footer privacy note say so.
- The sample edition, the "Around DubNation" feature and the globe markers are illustrative and labelled that way.
- Social proof, contact link and social links are **hidden** because none are configured.

**Needed for production**
1. **A newsletter provider account** (for example Buttondown, Kit, beehiiv or Mailchimp), with double opt-in set the way you want.
2. Either **an API key plus a host that runs a small server function** (recommended), or the provider's **public embed-form URL**.
3. Your **provider's name and privacy-policy link** for the privacy note, and optionally your own privacy-policy page.
4. Optionally: a contact address, social URLs and verified social proof in `src/config/site.ts`.
5. A schedule decision. The copy deliberately avoids promising a frequency.

---

## Connect a newsletter provider

All signup code goes through **one function**, `subscribe()` in `src/newsletter/subscribe.ts`. Choose one of two modes.

### Option A: `endpoint` mode (recommended: full success, duplicate and error states)

The browser posts `{ email }` to **your own** `/api/subscribe`. That server function (`server/handler.ts`) holds the provider's API key and calls the provider. It validates input, checks the origin, limits size, never logs or stores addresses, and never echoes provider replies. It's **provider-neutral**: you describe your provider's "create subscriber" API with environment variables.

1. In your provider's API documentation, find:
   - the **create-subscriber URL**;
   - the **auth header and prefix** (for example `Authorization: Bearer …` or `Authorization: Token …`);
   - the **email field name** (for example `email` or `email_address`);
   - how it reports an **already-subscribed** address (an HTTP status such as `409`, or text such as `already`).
2. Set these **server-side** variables in your host's dashboard (never in the code, never in git):
   ```
   NEWSLETTER_API_URL          = <create-subscriber URL from the docs>
   NEWSLETTER_API_KEY          = <your secret key>            (mark it as a Secret)
   NEWSLETTER_AUTH_HEADER      = Authorization                (if different)
   NEWSLETTER_AUTH_PREFIX      = "Bearer " or "Token "        (note the trailing space)
   NEWSLETTER_EMAIL_FIELD      = email | email_address | …
   NEWSLETTER_DOUBLE_OPT_IN    = true | false                 (match the provider setting)
   NEWSLETTER_DUPLICATE_STATUS = 409                          (if the provider uses one)
   NEWSLETTER_DUPLICATE_MATCH  = already                      (text in the duplicate error)
   NEWSLETTER_EXTRA_JSON       = {"tags":["website"]}         (optional extra fields)
   ALLOWED_ORIGINS             = https://dubnationglobal.com,https://www.dubnationglobal.com
   ```
3. Set these **public** build variables:
   ```
   VITE_NEWSLETTER_MODE=endpoint
   VITE_NEWSLETTER_PROVIDER_NAME=<provider name>
   VITE_NEWSLETTER_PROVIDER_PRIVACY_URL=<their privacy policy URL>
   VITE_NEWSLETTER_DOUBLE_OPT_IN=true
   ```
4. Rebuild and deploy. Then test with a real address, a repeated address, and an invalid one.

`functions/api/subscribe.ts` already wires the handler up for **Cloudflare Pages Functions**. Vercel, Netlify Edge and Deno can call the same `handleSubscribe(request, env)`, because it uses only standard `Request`/`Response`. For rate limiting, add a platform rule such as Cloudflare's WAF rate limiting on `/api/subscribe`.

> Provider-specific settings were not pre-filled. The provider's documentation couldn't be reached from the build environment, and guessed values could silently break signups. Copy them from your provider's current API docs.

### Option B: `provider-form` mode (no server needed)

If your provider offers a public embed-form endpoint, set:

```
VITE_NEWSLETTER_MODE=provider-form
VITE_NEWSLETTER_FORM_ACTION=<the form's action URL from the provider's embed code>
VITE_NEWSLETTER_FORM_EMAIL_FIELD=<the input name in that embed code, e.g. email>
VITE_NEWSLETTER_PROVIDER_NAME=<provider name>
```

Also add the form's host to `connect-src` in `public/_headers`.

Trade-off: browsers don't let the page read the provider's reply, so visitors see an honest "Request sent… we can't confirm it was saved" message rather than success, duplicate or error.

---

## Publish on DubNationGlobal.com

**Recommended: Cloudflare Pages** (free tier; serves the static site and runs `/api/subscribe`).

1. Push this repository to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → choose the repo.
3. Build settings:
   - **Root directory:** `dubnationglobal-newsletter`
   - **Build command:** `npm run build`
   - **Output directory:** `dist`
4. **Settings → Variables and Secrets:** add the `VITE_*` variables (build time) and the `NEWSLETTER_*` secrets (runtime). Redeploy.
5. **Custom domains → Set up a domain:** add `dubnationglobal.com` (and `www`), then follow the DNS instructions. Only do this when you're ready to go live, since it changes DNS.
6. `public/_headers` gives you the security headers automatically.

**Any other static host** (Netlify, Vercel, shared hosting): upload the contents of `dist/`. The build uses relative paths, so a sub-folder works too.
- Demo and `provider-form` modes need nothing else.
- `endpoint` mode needs a server function at `/api/subscribe` that calls `handleSubscribe`.
- On Apache hosts, copy the `_headers` rules into `.htaccess` as `Header set …` lines.

**Before launch:**
- Set `SITE.url` in `src/config/site.ts` to the final address (it's used for the canonical link and the share card).
- Test signups on the live domain.
- Paste the URL into a social-card validator to check the preview image (`public/og-image.jpg`, 1200×630; regenerate it with `scripts/make-og-image.mjs`).

---

## Tests and verification

`npm test` runs 63 tests:
- email validation;
- every subscription mode and outcome, including network failure and timeout;
- the server handler (auth header, body, duplicates, origin, honeypot, size, missing configuration, no leakage of provider replies);
- a browser → server → provider round trip;
- time-zone maths across daylight saving;
- both forms (pending lock, shared state, failure keeps the email, no double send);
- keyboard use of the city selector;
- links that resolve to real sections;
- hidden unconfigured links and social proof;
- privacy wording in both modes;
- globe fallbacks.

Also checked in a real browser against the production build:
- no horizontal scroll at 320, 360, 390, 768, 1024 and 1440 px;
- Tab order and Enter-to-submit;
- every demo state through both forms, including rapid repeat clicks;
- navigation scrolling and focus;
- reduced motion gives a static globe;
- a blocked coastline file, and a browser without canvas;
- no Content-Security-Policy violations, no console errors, and no requests to any host but the site itself.

## Credits

Coastlines: Natural Earth (public domain) via `world-atlas` (ISC). Fonts: Barlow Condensed and DM Sans (SIL Open Font License) via Fontsource.
