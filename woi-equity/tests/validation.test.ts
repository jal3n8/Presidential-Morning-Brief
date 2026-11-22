import { describe, expect, it } from "vitest";
import { validateSnapshot } from "../src/lib/validate";
import { baseline } from "./helpers";

describe("snapshot validation", () => {
  it("accepts the supplied baseline with no consistency warnings", () => {
    const v = validateSnapshot(baseline());
    expect(v.ok).toBe(true);
    expect(v.issues.filter((i) => i.level !== "info")).toEqual([]);
  });

  it("preserves every null exactly as supplied", () => {
    const raw = baseline();
    const v = validateSnapshot(raw);
    if (!v.ok) throw new Error("expected valid");
    const s = v.snapshot;
    expect(s.washout.score).toBeNull();
    expect(s.washout.fiveDaySigma).toBeNull();
    expect(s.club3030.triggered).toBeNull();
    expect(s.club3030.requiredRuleDefinition).toBeNull();
    expect(s.macroAndConfirmation.bitcoin.sma200Usd).toBeNull();
    for (const w of s.watchlist) {
      expect(w.technicalIndicators.sma200Usd).toBeNull();
      expect(w.technicalIndicators.rsi14).toBeNull();
    }
    expect(s.sources.spy_close.url).toBe(raw.sources.spy_close.url);
  });

  it("rejects a wrong major schema version", () => {
    const raw = baseline();
    raw.schemaVersion = "3.0.0";
    expect(validateSnapshot(raw).ok).toBe(false);
  });

  it("rejects a string where a price belongs", () => {
    const raw = baseline();
    raw.watchlist[0].regularSessionClose = "127.79";
    const v = validateSnapshot(raw);
    expect(v.ok).toBe(false);
    expect(v.issues[0].path).toContain("regularSessionClose");
  });

  it("rejects an empty watchlist and a missing section", () => {
    const a = baseline(); a.watchlist = [];
    const b = baseline(); delete b.washout;
    expect(validateSnapshot(a).ok).toBe(false);
    expect(validateSnapshot(b).ok).toBe(false);
  });

  it("flags a reported percentage that does not match its inputs", () => {
    const raw = baseline();
    raw.marketRegime.instruments[0].pctVsSma200 = -4.1;
    const v = validateSnapshot(raw);
    expect(v.issues.some((i) => i.level === "warning" && i.path.includes("SPY.pctVsSma200"))).toBe(true);
  });

  it("flags SPX year-over-year computed from the wrong series", () => {
    const raw = baseline();
    raw.washout.sp500.yearOverYearPriceReturnPct = 4.1; // the SPY-conflated value the baseline corrected
    const v = validateSnapshot(raw);
    expect(v.issues.some((i) => i.path === "washout.sp500.yearOverYearPriceReturnPct")).toBe(true);
  });

  it("flags unresolved source references and a regime label that contradicts the data", () => {
    const raw = baseline();
    raw.watchlist[1].marketDataSource = "missing_source";
    raw.marketRegime.label = "NOT DEFENSIVE";
    const v = validateSnapshot(raw);
    expect(v.issues.some((i) => i.message.includes("missing_source"))).toBe(true);
    expect(v.issues.some((i) => i.path === "marketRegime.label")).toBe(true);
  });

  it("warns when a blocked signal field carries a value", () => {
    const raw = baseline();
    raw.washout.score = 4;
    const v = validateSnapshot(raw);
    expect(v.ok).toBe(true);
    expect(v.issues.some((i) => i.path === "washout.score")).toBe(true);
  });
});
