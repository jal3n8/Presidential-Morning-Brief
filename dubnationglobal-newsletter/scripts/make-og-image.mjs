// Optional maintenance script: regenerates public/og-image.jpg (1200x630 social share card)
// from the running page. Requires Playwright (`npm i -D playwright && npx playwright install chromium`)
// and a running dev server:  npm run dev  ->  node scripts/make-og-image.mjs [http://127.0.0.1:5180/]
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const url = process.argv[2] || "http://127.0.0.1:5180/";
const out = fileURLToPath(new URL("../public/og-image.jpg", import.meta.url));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
const page = await ctx.newPage();
await page.goto(url);
await page.waitForFunction(() => [...document.querySelectorAll("[data-globe-state]")].every((e) => e.getAttribute("data-globe-state")?.startsWith("ready")));
await page.addStyleTag({
  content: `header, #signup, #top > p, a[href="#signup"].sr-only { display:none !important }
            #top { min-height: 630px }
            #top > div:last-of-type { padding-top: 150px !important }
            #top > div:last-of-type > div { max-width: none !important }
            #top h1 { font-size: 112px !important }`,
});
await page.evaluate(() => {
  const h = document.querySelector("#top h1");
  const tag = document.createElement("p");
  tag.textContent = "dubnationglobal.com";
  tag.style.cssText = "margin-top:28px;font:600 30px 'Barlow Condensed',sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#F5B930";
  h?.after(tag);
  document.querySelector("#top h1 + p + p")?.remove(); // drop the supporting sentence
});
await page.waitForTimeout(400);
await page.screenshot({ path: out, type: "jpeg", quality: 86, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log(`Wrote ${out}`);
