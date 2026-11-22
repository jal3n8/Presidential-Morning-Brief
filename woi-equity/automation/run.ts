/**
 * WOI Equity automation job (Phase 2).
 *
 *   npm run automation:check            what is due now, and what is connected
 *   npm run automation:run              run the job that is due (or exit quietly)
 *   npm run automation:run -- --job closing_snapshot --force
 *
 * Runs on GitHub Actions every 30 minutes on weekdays; it acts only inside a
 * 90-minute window after 09:40 or 16:15 New York time on NYSE trading days
 * (13:15 on early-close days), and only once per job per day.
 *
 * Flow: prices (provider) -> Treasury -> Gemini research -> verification ->
 * build snapshot -> full validation -> POST to the server ingest endpoint.
 * Any failure stops before publishing; the server keeps the last good data.
 */
import { DEFAULT_JOBS, jobTimeFor, sessionInfo, wallClock, MARKET_TZ, previousTradingDay, lastCompletedSession } from "../src/lib/calendar";
import { validateSnapshot } from "../src/lib/validate";
import { snapshotIdOf } from "../src/lib/snapshotOrder";
import { buildSnapshot, type ResearchInputs } from "./build";
import type { ResearchItem } from "../src/lib/schema";
import { geminiResearch, marketDataProvider, NotConfigured, treasury2y, verifyItem } from "./providers";

const WINDOW_MIN = 90;
type Job = "opening_snapshot" | "closing_snapshot";

export function dueJob(now: Date, alreadyDone: Set<string>): { job: Job; date: string } | null {
  const { date, minutes } = wallClock(now, MARKET_TZ);
  if (!sessionInfo(date).isTradingDay) return null;
  for (const j of DEFAULT_JOBS) {
    const [h, m] = jobTimeFor(j, date).split(":").map(Number);
    const start = h * 60 + m;
    if (minutes >= start && minutes < start + WINDOW_MIN && !alreadyDone.has(`${date}:${j.name}`)) return { job: j.name as Job, date };
  }
  return null;
}

const env = (k: string) => (process.env[k] ? "set" : "missing");

async function serverJson(path: string): Promise<any> {
  const base = process.env.WOI_SITE_URL;
  if (!base) throw new NotConfigured("WOI_SITE_URL is not set (e.g. https://woiequity.com).");
  for (const p of [`${base}/api/data.php?file=${path}`, `${base}/data/${path === "manifest" ? "archive/index" : path}.json`]) {
    const r = await fetch(p, { cache: "no-store" });
    if (r.ok) return r.json();
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const now = new Date();
  if (args.includes("--check")) {
    console.log(`Now in New York: ${wallClock(now, MARKET_TZ).date} ${wallClock(now, MARKET_TZ).time}; ${sessionInfo(wallClock(now, MARKET_TZ).date).reason ?? "regular day"}`);
    console.log(`Due now: ${JSON.stringify(dueJob(now, new Set()))}`);
    for (const k of ["WOI_SITE_URL", "WOI_INGEST_TOKEN", "MARKET_DATA_PROVIDER", "GEMINI_API_KEY", "GEMINI_MODEL", "SEC_USER_AGENT"]) console.log(`${k.padEnd(22)} ${env(k)}`);
    return;
  }

  const forced = args.includes("--force");
  const jobArg = args[args.indexOf("--job") + 1] as Job | undefined;
  const status = await serverJson("status").catch(() => null);
  const done = new Set<string>((status?.recentRuns ?? []).filter((r: any) => r.result !== "failed").map((r: any) => `${String(r.startedAtUtc).slice(0, 10)}:${r.job}`));
  const due = forced && jobArg ? { job: jobArg, date: wallClock(now, MARKET_TZ).date } : dueJob(now, done);
  if (!due) { console.log("Nothing due now."); return; }

  const token = process.env.WOI_INGEST_TOKEN;
  if (!token) throw new NotConfigured("WOI_INGEST_TOKEN is not set.");
  const prevRaw = await serverJson("latest");
  const prev = validateSnapshot(prevRaw);
  if (!prev.ok) throw new Error("Current published snapshot is not valid; refusing to build on it.");

  const sessionDate = due.job === "closing_snapshot" ? lastCompletedSession(new Date(now.getTime() + 60_000)) : previousTradingDay(due.date);
  const provider = marketDataProvider(); // throws NotConfigured until a provider is chosen
  const from = `${Number(sessionDate.slice(0, 4)) - 2}${sessionDate.slice(4)}`;
  const symbols = ["SPY", "QQQ", "IWM", "^GSPC", "^VIX", "BTC-USD", ...prev.snapshot.watchlist.map((w) => w.symbol)];
  const series = Object.fromEntries(await Promise.all(symbols.map(async (s) => [s, await provider.dailyCloses(s, from)] as const)));

  const research: ResearchInputs = {};
  if (process.env.GEMINI_API_KEY) {
    for (const w of prev.snapshot.watchlist) {
      try {
        const r = await geminiResearch(w.symbol, w.company, w.research.focus, w.research.asOf ?? previousTradingDay(sessionDate));
        const verified: ResearchItem[] = [], unverified: ResearchItem[] = [];
        for (const it of r.items) ((await verifyItem(w.symbol, it)) === "verified" ? verified : unverified).push({ ...it, verificationStatus: undefined });
        research[w.symbol] = {
          verifiedFilings: verified.filter((i) => i.type === "sec_filing").map((i) => ({ ...i, verificationStatus: "verified" as const, verificationMethod: "quote_found_on_primary_source" })),
          verifiedCatalysts: verified.filter((i) => i.type !== "sec_filing").map((i) => ({ ...i, verificationStatus: "verified" as const, verificationMethod: "quote_found_on_primary_source" })),
          unverifiedClaims: unverified.map((i) => ({ ...i, verificationStatus: "unverified" as const })),
          summary: null, // AI summaries are not published as research until reviewed
          asOf: now.toISOString(), sources: {},
        };
      } catch (e) {
        console.warn(`Research for ${w.symbol} skipped: ${(e as Error).message}`);
      }
    }
  }

  const next = buildSnapshot(prev.snapshot, {
    sessionDate, series, treasury2y: await treasury2y(sessionDate).catch(() => null),
    provider: { name: provider.name, sourceUrl: (s) => provider.sourceUrl(s), method: provider.method },
  }, research, {
    job: due.job, nowUtc: now.toISOString(), todayET: wallClock(now, MARKET_TZ).date,
    connections: ["marketData", ...(process.env.GEMINI_API_KEY ? ["gemini"] : [])],
  });

  const check = validateSnapshot(next);
  if (!check.ok) throw new Error(`Built snapshot failed validation: ${check.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);

  const res = await fetch(`${process.env.WOI_SITE_URL}/api/ingest.php`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-WOI-Job": due.job, "X-WOI-Connections": ["marketData", ...(process.env.GEMINI_API_KEY ? ["gemini"] : [])].join(",") },
    body: JSON.stringify(next),
  });
  const out = await res.text();
  if (!res.ok) throw new Error(`Ingest refused (${res.status}): ${out}`);
  console.log(`Published ${snapshotIdOf(check.snapshot)}: ${out}`);
}

if (process.argv[1]?.endsWith("run.ts")) {
  main().catch((e) => {
    console.error(e instanceof NotConfigured ? `NOT CONFIGURED: ${e.message}` : `FAILED: ${(e as Error).message}`);
    process.exit(e instanceof NotConfigured ? 0 : 1); // not-configured is a quiet no-op, real failures alert
  });
}
