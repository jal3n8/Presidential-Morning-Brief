/**
 * Outside connections used by the automation job. Every one of them reads
 * its credentials from environment variables on the machine running the job
 * (GitHub Actions secrets), never from the website.
 */
import type { Bar } from "./build";
import type { ResearchItem } from "../src/lib/schema";

export class NotConfigured extends Error {}

/* ---------------- market prices ---------------- */

export interface MarketDataProvider {
  name: string;
  method: string;
  sourceUrl(symbol: string): string;
  dailyCloses(symbol: string, fromDate: string): Promise<Bar[]>;
}

/**
 * No price provider is chosen yet (see AUTOMATION_PLAN.md). Until one is,
 * the job stops here and publishes nothing, which is the safe outcome.
 * To add one: implement MarketDataProvider for it and return it below
 * when its key is present.
 */
export function marketDataProvider(): MarketDataProvider {
  const name = process.env.MARKET_DATA_PROVIDER;
  if (!name) throw new NotConfigured("MARKET_DATA_PROVIDER is not set: no market-price source is connected yet.");
  throw new NotConfigured(`Market data provider "${name}" has no adapter yet. See AUTOMATION_PLAN.md, step 3.`);
}

/* ---------------- US Treasury (public, no key) ---------------- */

/** Official daily par yield curve CSV for a year; returns the 2-year yield for `date`. */
export async function treasury2y(date: string): Promise<{ date: string; pct: number; url: string } | null> {
  const year = date.slice(0, 4);
  const csv = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
  const res = await fetch(csv);
  if (!res.ok) return null;
  const [header, ...rows] = (await res.text()).trim().split(/\r?\n/);
  const cols = header.split(",").map((c) => c.replace(/"/g, "").trim());
  const iDate = cols.indexOf("Date"), i2y = cols.indexOf("2 Yr");
  const [y, m, d] = date.split("-");
  const want = `${m}/${d}/${y}`;
  for (const row of rows) {
    const c = row.split(",");
    if (c[iDate] === want && c[i2y] && Number.isFinite(Number(c[i2y])))
      return { date, pct: Number(c[i2y]), url: `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve&field_tdr_date_value_month=${y}${m}` };
  }
  return null;
}

/* ---------------- Gemini research ---------------- */

export type ResearchResult = { items: (ResearchItem & { quote?: string })[]; summary: string | null };

/**
 * Asks Gemini (with Google Search grounding) for dated, sourced items about
 * one company. Everything it returns starts as UNVERIFIED; verify.ts decides
 * what can be promoted.
 */
export async function geminiResearch(symbol: string, company: string, focus: string[], sinceDate: string): Promise<ResearchResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new NotConfigured("GEMINI_API_KEY is not set.");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-pro";
  const prompt = [
    `You are a verification-focused equity research assistant. Company: ${company} (${symbol}).`,
    `Find material, dated developments since ${sinceDate} on: ${focus.join("; ")}.`,
    "Use only primary sources where possible (SEC filings, company investor-relations pages, official press releases).",
    "Return ONLY a JSON object in a ```json block with this shape:",
    '{"summary": string|null, "items": [{"title": string, "type": "sec_filing"|"earnings"|"company_announcement"|"market_news"|"launch"|"other", "publishedAt": "YYYY-MM-DD"|null, "effectiveAt": "YYYY-MM-DD"|null, "url": string, "quote": "an exact sentence copied from that page"}]}',
    "Do not include any item without a working URL and an exact quote. Do not estimate prices or numbers. If you find nothing, return an empty list.",
  ].join("\n");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const json = text.match(/```json\s*([\s\S]*?)```/)?.[1] ?? text;
  const parsed = JSON.parse(json) as { summary?: string | null; items?: unknown[] };
  const items = (parsed.items ?? []).flatMap((x) => {
    const i = x as Record<string, unknown>;
    if (typeof i.title !== "string" || typeof i.url !== "string" || !/^https:\/\//.test(i.url)) return [];
    const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
    return [{
      title: i.title.slice(0, 300), type: (["sec_filing", "earnings", "company_announcement", "market_news", "launch"].includes(String(i.type)) ? i.type : "other") as ResearchItem["type"],
      date: date(i.publishedAt), publishedAt: date(i.publishedAt), effectiveAt: date(i.effectiveAt), summary: null, sourceRef: null, url: i.url,
      quote: typeof i.quote === "string" ? i.quote.slice(0, 600) : undefined, verificationStatus: "unverified" as const,
    }];
  });
  return { items, summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 1200) : null };
}

/* ---------------- verification ---------------- */

const PRIMARY_HOSTS: Record<string, string[]> = {
  "*": ["sec.gov"],
  SPCX: ["spacex.com", "starlink.com"],
  NVDA: ["nvidia.com"],
  TSLA: ["tesla.com"],
  GOOGL: ["abc.xyz", "blog.google", "google.com"],
};

/**
 * An item is promoted to verified only if its URL is on the company's own
 * site or sec.gov AND the exact quote appears on the fetched page.
 */
export async function verifyItem(symbol: string, item: ResearchItem & { quote?: string }): Promise<"verified" | "unverified"> {
  if (!item.url || !item.quote || item.quote.length < 30) return "unverified";
  let host: string;
  try { host = new URL(item.url).hostname.toLowerCase(); } catch { return "unverified"; }
  const allowed = [...PRIMARY_HOSTS["*"], ...(PRIMARY_HOSTS[symbol] ?? [])];
  if (!allowed.some((h) => host === h || host.endsWith(`.${h}`))) return "unverified";
  try {
    const ua = process.env.SEC_USER_AGENT || "WOI Equity research bot";
    const res = await fetch(item.url, { headers: { "User-Agent": ua }, redirect: "follow" });
    if (!res.ok) return "unverified";
    const norm = (t: string) => t.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").toLowerCase();
    return norm(await res.text()).includes(norm(item.quote)) ? "verified" : "unverified";
  } catch {
    return "unverified";
  }
}
