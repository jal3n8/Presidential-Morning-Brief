import { describe, expect, it } from "vitest";
import { validateSnapshot } from "../src/lib/validate";
import { DEFAULT_WASHOUT_CONFIG, evaluateWashout } from "../src/lib/washout";
import { sessionsInclusive, nthSessionFrom } from "../src/lib/calendar";
import { sma } from "../src/lib/indicators";
import { diffSnapshots } from "../src/lib/diff";
import { buildLedger, searchLedger } from "../src/lib/ledger";
import { baseline } from "./helpers";

const load = (raw: unknown) => { const v = validateSnapshot(raw); if (!v.ok) throw new Error(); return v.snapshot; };

describe("missing readings", () => {
  const s = load(baseline());
  it("never counts a missing input as met, and produces no score until activated", () => {
    const ev = evaluateWashout(DEFAULT_WASHOUT_CONFIG, s);
    expect(ev.score).toBeNull();
    const byId = Object.fromEntries(ev.results.map((r) => [r.criterion.id, r.state]));
    expect(byId.sigma).toBe("unavailable");
    expect(byId.cluster).toBe("unavailable");
    expect(byId.stabilizing).toBe("unavailable");
    expect(byId.rsi).toBe("met");
    expect(ev.unavailableCount).toBe(3);
  });
  it("scores only available criteria once the user activates a formula", () => {
    const ev = evaluateWashout({ ...DEFAULT_WASHOUT_CONFIG, activated: true }, s);
    expect(ev.score).toBe(4);
    expect(ev.maxAvailable).toBe(4);
    expect(ev.maxPossible).toBe(7);
  });
  it("reports a value turning into null as a change, not as zero", () => {
    const raw = baseline();
    raw.macroAndConfirmation.nominalUsTreasury2YearYieldPct = null;
    const c = diffSnapshots(s, load(raw)).find((x) => x.path === "macroAndConfirmation.nominalUsTreasury2YearYieldPct")!;
    expect(c.before).toBe(4.63);
    expect(c.after).toBeNull();
    expect(c.delta).toBeNull();
  });
});

describe("SPCX, newly listed", () => {
  it("has 113 completed sessions through Nov 20, 2026, too few for a 200-session SMA", () => {
    expect(sessionsInclusive("2026-06-12", "2026-11-20")).toBe(113);
    expect(sma(Array.from({ length: 113 }, (_, i) => 100 + i), 200)).toBeNull();
    const spcx = load(baseline()).watchlist.find((w) => w.symbol === "SPCX")!;
    expect(spcx.technicalIndicators.sma200Usd).toBeNull();
    expect(spcx.technicalIndicators.sma200Availability).toBe("insufficient_public_trading_history");
  });
  it("reaches its 200th session on Mar 31, 2027 on the exchange calendar", () => {
    expect(nthSessionFrom("2026-06-12", 200)).toBe("2027-03-31");
  });
});

describe("evidence ledger", () => {
  it("lists every source with the fields that cite it, and searches them", () => {
    const ledger = buildLedger(load(baseline()));
    expect(ledger.length).toBe(19);
    const ust = ledger.find((e) => e.key === "ust")!;
    expect(ust.citedBy).toContain("Macro · 2Y Treasury");
    expect(searchLedger(ledger, "treasury", "all", "all").map((e) => e.key)).toEqual(["ust"]);
    expect(searchLedger(ledger, "", "all", "NVDA").map((e) => e.key)).toEqual(["nvda_close"]);
  });
});
