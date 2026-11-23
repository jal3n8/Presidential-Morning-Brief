import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateBrief } from "../src/lib/brief";
import { applyImports, loadDataset, loadStaticDataset } from "../src/lib/data";
import { hypotheticalReturn, journalToCsv, journalToJson, newEntry, parseJournalJson } from "../src/lib/journal";
import { buildMarketFrame, indexOnOrBefore } from "../src/lib/market";
import { evaluateCondition } from "../src/lib/rules";
import { scan } from "../src/lib/scanner";
import { watchRow } from "../src/lib/watchlist";
import { fsFetch } from "./helpers";

describe("Dataset loading and validation", () => {
  it("loads the committed demo dataset and verifies checksums", async () => {
    const ds = await loadStaticDataset("demo", fsFetch());
    expect(ds.kind).toBe("demo");
    expect(ds.index.verification.level).toBe("synthetic");
    expect(ds.vol).not.toBeNull();
    expect(Object.keys(ds.watchlist).sort()).toEqual(["GOOGL", "NVDA", "QQQ", "SPY", "TSLA"]);
  });
  it("refuses a series whose checksum does not match the manifest", async () => {
    const serve = fsFetch();
    const tampered = async (url: string) => {
      if (url.endsWith("DEMO_INDEX.json")) {
        const doc = JSON.parse(readFileSync("public/data/demo/series/DEMO_INDEX.json", "utf8"));
        doc.rows[100][1] = doc.rows[100][1] * 1.5;
        return new Response(JSON.stringify(doc));
      }
      return serve(url);
    };
    await expect(loadStaticDataset("demo", tampered)).rejects.toThrow(/checksum/);
  });
  it("refuses a manifest that does not match the schema", async () => {
    const bad = async (url: string) => (url.endsWith("manifest.json") ? new Response(JSON.stringify({ schemaVersion: 1, datasetKind: "demo", isLive: true })) : new Response("", { status: 404 }));
    await expect(loadStaticDataset("demo", bad)).rejects.toThrow(/validation/);
  });
  it("'verified only' fails loudly instead of silently showing demo data", async () => {
    const serve = fsFetch();
    const noVerified = (url: string) => (url.startsWith("data/verified") ? Promise.resolve(new Response("", { status: 404 })) : serve(url));
    await expect(loadDataset("verified", noVerified)).rejects.toThrow();
    const auto = await loadDataset("auto", noVerified);
    expect(auto.dataset.kind).toBe("demo");
    expect(auto.notice).toMatch(/DEMO/);
  });
  it("importing a core series relabels the whole dataset as imported", async () => {
    const ds = await loadStaticDataset("demo", fsFetch());
    const doc = { ...JSON.parse(readFileSync("public/data/demo/series/SPY.json", "utf8")), symbol: "MYIDX", verification: { level: "user_imported", detail: "", crossCheck: null } };
    const out = applyImports(ds, { "core_index:MYIDX": { role: "core_index", doc } });
    expect(out.kind).toBe("imported");
    expect(out.index.symbol).toBe("MYIDX");
    const junk = applyImports(ds, { x: { role: "watchlist", doc: { ...doc, rows: "nope" } } });
    expect(junk.warnings.some((w) => /invalid/.test(w))).toBe(true);
  });
});

describe("Research journal (paper only)", () => {
  it("round-trips JSON exports and validates imports", () => {
    const e = { ...newEntry("2026-11-23", "2026-11-23T02:00:00Z"), symbol: "SPY", hypotheticalEntry: 680, hypotheticalExit: 700 };
    const text = journalToJson([e], "2026-11-23T02:00:00Z");
    const r = parseJournalJson(text);
    expect(r.ok && r.entries[0]).toEqual(e);
    expect(parseJournalJson("{}").ok).toBe(false);
    expect(parseJournalJson("not json").ok).toBe(false);
  });
  it("computes hypothetical return for long and short", () => {
    expect(hypotheticalReturn({ hypotheticalEntry: 100, hypotheticalExit: 110, direction: "long" })).toBeCloseTo(0.1, 12);
    expect(hypotheticalReturn({ hypotheticalEntry: 100, hypotheticalExit: 110, direction: "short" })).toBeCloseTo(-0.1, 12);
    expect(hypotheticalReturn({ hypotheticalEntry: 100, hypotheticalExit: null, direction: "long" })).toBeNull();
  });
  it("CSV export guards against formula injection in free text", () => {
    const e = { ...newEntry("2026-11-23", "2026-11-23T02:00:00Z"), thesis: "=HYPERLINK(\"http://x\")" };
    expect(journalToCsv([e])).toContain("\"'=HYPERLINK(\"\"http://x\"\")\"");
  });
});

describe("Weekly brief (rule-based)", () => {
  it("builds every required section from the demo data and labels it as demo", async () => {
    const ds = await loadStaticDataset("demo", fsFetch());
    const f = buildMarketFrame(ds.index, ds.vol);
    const b = generateBrief({ frame: f, dataset: ds, events: scan(f), watch: ["SPY", "NVDA", "NOPE"].map((s) => watchRow(s, ds.watchlist[s] ?? null, ds.watchlist.SPY)), generatedAt: "2026-11-23T02:00:00Z" });
    expect(b.sections.map((s) => s.heading)).toEqual([
      "Current market condition",
      "Biggest signal changes this week",
      "New historical matches",
      "Signals that failed",
      "Watchlist observations",
      "Research questions for the coming week",
    ]);
    expect(b.markdown).toMatch(/DEMO DATA/);
    expect(b.markdown).toMatch(/not investment advice/);
    expect(b.markdown).toMatch(/NOPE: no validated data/);
    expect(b.text).not.toMatch(/\*\*/);
  });
});

/**
 * Cross-check against the independently sourced reference snapshot from the earlier WOI research
 * (woi_equity_verified_2026-11-20.json). Runs only when the real dataset has been built locally.
 */
describe.skipIf(!existsSync("public/data/verified/manifest.json"))("Reference values for 2026-11-20 (real data)", () => {
  it("engine output matches the cited reference snapshot", async () => {
    const ds = await loadStaticDataset("verified", fsFetch());
    const f = buildMarketFrame(ds.index, ds.vol);
    const i = indexOnOrBefore(f.dates, "2026-11-20");
    expect(f.dates[i]).toBe("2026-11-20");
    expect(f.close[i]).toBeCloseTo(6910.39, 2);
    expect(f.sma200[i]!).toBeCloseTo(7348.58, 1);
    expect(f.rsi14[i]!).toBeCloseTo(24.69, 1);
    expect(f.vix[i]).toBeCloseTo(35.89, 2);
    expect(f.dd252[i]! * 100).toBeCloseTo(-11.62, 1);
    const y = indexOnOrBefore(f.dates, "2025-11-20");
    expect((f.close[i] / f.close[y] - 1) * 100).toBeCloseTo(5.68, 1);
    expect(evaluateCondition(f, i).label).toBe("Extreme Stress");
    const closes: Record<string, number> = { SPY: 689.81, QQQ: 608.45, NVDA: 125.53, TSLA: 345.82, GOOGL: 265.29 };
    for (const [sym, c] of Object.entries(closes)) {
      const s = ds.watchlist[sym];
      expect(s.close[indexOnOrBefore(s.dates, "2026-11-20")]).toBeCloseTo(c, 2);
    }
  });
});
