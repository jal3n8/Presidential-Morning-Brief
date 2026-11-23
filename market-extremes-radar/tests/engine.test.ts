import { describe, expect, it } from "vitest";
import { filtersPredicate, runStudy, type StudyConfig } from "../src/lib/analogs";
import { excursion, forwardReturn } from "../src/lib/indicators";
import { alignToDates, buildMarketFrame, type MarketFrame } from "../src/lib/market";
import { evaluateCondition, TRIGGERS } from "../src/lib/rules";
import { scan, triggerHistory, validationAt } from "../src/lib/scanner";
import { watchRow } from "../src/lib/watchlist";
import { makeSeries, walk } from "./helpers";

const base: Omit<StudyConfig, "predicate"> = { description: "t", cooldown: 3, dedupe: true, entry: "signal_close", excursionHorizon: 60 };

/** Minimal frame where only `close` matters, for exercising the study engine directly. */
function frameFromCloses(close: number[]): MarketFrame {
  return buildMarketFrame(makeSeries(close), null);
}

describe("4. Forward returns", () => {
  it("is Close(t+h)/Close(t) - 1 and null when the window is incomplete", () => {
    const c = [100, 102, 99, 105];
    expect(forwardReturn(c, 0, 1)).toBeCloseTo(0.02, 12);
    expect(forwardReturn(c, 0, 3)).toBeCloseTo(0.05, 12);
    expect(forwardReturn(c, 1, 3)).toBeNull();
  });
  it("max adverse/favourable movement are measured after the entry close", () => {
    const ex = excursion([100, 95, 110, 90, 101], 0, 4)!;
    expect(ex.mae).toBeCloseTo(-0.1, 12);
    expect(ex.mfe).toBeCloseTo(0.1, 12);
    expect(excursion([100, 95], 0, 4)).toBeNull();
  });
  it("study outcomes match hand calculations and next-close entry shifts by one session", () => {
    const close = Array.from({ length: 140 }, (_, i) => 100 + i);
    const f = frameFromCloses(close);
    const pred = (_: MarketFrame, i: number) => i === 10;
    const s = runStudy(f, { ...base, predicate: pred });
    expect(s.events).toHaveLength(1);
    expect(s.events[0].forward[20]).toBeCloseTo(130 / 110 - 1, 12);
    expect(s.events[0].forward[60]).toBeCloseTo(170 / 110 - 1, 12);
    const n = runStudy(f, { ...base, predicate: pred, entry: "next_close" });
    expect(n.events[0].entryIndex).toBe(11);
    expect(n.events[0].forward[20]).toBeCloseTo(131 / 111 - 1, 12);
  });
  it("events too recent for a horizon are pending, not zero", () => {
    const f = frameFromCloses(Array.from({ length: 100 }, (_, i) => 100 + i));
    const s = runStudy(f, { ...base, predicate: (_, i) => i === 90 });
    expect(s.events[0].forward[5]).not.toBeNull();
    expect(s.events[0].forward[20]).toBeNull();
    const h20 = s.horizons.find((h) => h.h === 20)!;
    expect(h20.n).toBe(0);
    expect(h20.pending).toBe(1);
    expect(h20.mean).toBeNull();
  });
});

describe("5. Market-date alignment", () => {
  it("joins on exact dates, never forward-fills, and reports gaps", () => {
    const base = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
    const other = ["2026-11-16", "2026-11-18", "2026-11-20", "2026-11-21"];
    const { values, report } = alignToDates(base, other, [20, 22, 35, 99]);
    expect(values).toEqual([20, null, 22, null, 35]);
    expect(report.missingInOther).toEqual(["2026-11-17", "2026-11-19"]);
    expect(report.extraInOther).toBe(1);
  });
  it("dates before the other series starts are not reported as gaps", () => {
    const { values, report } = alignToDates(["1989-12-29", "1990-01-02"], ["1990-01-02"], [17.24]);
    expect(values).toEqual([null, 17.24]);
    expect(report.missingInOther).toEqual([]);
  });
  it("the market frame carries VIX only on matching sessions", () => {
    const spx = makeSeries(walk(60), { start: "2026-08-03" });
    const vixDates = spx.dates.filter((_, i) => i !== 30);
    const vix = makeSeries(vixDates.map(() => 20), { dates: vixDates, symbol: "^VIX", assetClass: "volatility_index" });
    const f = buildMarketFrame(spx, vix);
    expect(f.vix[30]).toBeNull();
    expect(f.vix[31]).toBe(20);
    expect(f.alignment!.missingInOther).toEqual([spx.dates[30]]);
  });
});

describe("6. Missing data", () => {
  it("condition is Insufficient Data when too many inputs are missing (no guessing)", () => {
    const f = buildMarketFrame(makeSeries(walk(30)), null); // < 50 sessions, no VIX
    expect(evaluateCondition(f, 29).label).toBe("Insufficient Data");
  });
  it("VIX-based rules are unavailable without VIX, and the custom filter returns null, not false", () => {
    const f = buildMarketFrame(makeSeries(walk(300)), null);
    const vixRule = TRIGGERS.find((t) => t.id === "vix_high")!;
    expect(vixRule.test(f, 299)).toBeNull();
    const p = filtersPredicate({ side: "downside", rsiThreshold: 100, zThreshold: null, vixRegime: "gte30", trend: "any" });
    expect(p(f, 299)).toBeNull();
    const s = runStudy(f, { ...base, predicate: p });
    expect(s.events).toHaveLength(0);
    expect(s.unavailableDays).toBeGreaterThan(0);
  });
  it("watchlist does not compute a 200-day average from fewer than 200 sessions", () => {
    const r = watchRow("NEW", makeSeries(walk(120), { symbol: "NEW", assetClass: "stock" }), null);
    expect(r.sma200).toBeNull();
    expect(r.trend).toBe("Insufficient history");
    expect(r.notes.join(" ")).toMatch(/200/);
  });
  it("a symbol with no data shows nothing rather than an estimate", () => {
    const r = watchRow("ZZZZ", null, null);
    expect(r.close).toBeNull();
    expect(r.series).toBeNull();
  });
  it("relative strength is not computed when the latest dates differ", () => {
    // benchmark has no bar on the symbol's latest date
    const spy = makeSeries(walk(99), { symbol: "SPY", start: "2026-06-01" });
    const other = makeSeries(walk(100, 3), { symbol: "QQQ", start: "2026-06-01" });
    expect(watchRow("QQQ", other, spy).rs63).toBeNull();
    const same = makeSeries(walk(99, 3), { symbol: "QQQ", start: "2026-06-01" });
    expect(watchRow("QQQ", same, spy).rs63).not.toBeNull();
  });
});

describe("7. Historical-event deduplication", () => {
  const f = frameFromCloses(Array.from({ length: 200 }, (_, i) => 100 + i));
  const days = new Set([10, 11, 12, 14, 30, 31, 33, 37, 41]);
  const pred = (_: MarketFrame, i: number) => days.has(i);
  it("groups qualifying days into clusters separated by more than `cooldown` sessions", () => {
    const s = runStudy(f, { ...base, cooldown: 3, predicate: pred });
    // 10,11,12,14 -> one event; 30,31,33 -> one; 37 (gap 4 > 3) -> new; 41 (gap 4) -> new
    expect(s.events.map((e) => e.index)).toEqual([10, 30, 37, 41]);
    expect(s.events.map((e) => e.clusterDays)).toEqual([4, 3, 1, 1]);
    expect(s.qualifyingDays).toBe(9);
  });
  it("a longer cooldown merges more", () => {
    // 14 -> 30 is a 16-session gap: separate events at cooldown 10, merged at cooldown 20
    expect(runStudy(f, { ...base, cooldown: 20, predicate: pred }).events.map((e) => e.index)).toEqual([10]);
    const s = runStudy(f, { ...base, cooldown: 10, predicate: pred });
    expect(s.events.map((e) => e.index)).toEqual([10, 30]);
  });
  it("without de-duplication every qualifying day is an observation", () => {
    const s = runStudy(f, { ...base, dedupe: false, predicate: pred });
    expect(s.events).toHaveLength(9);
  });
  it("discloses events whose outcome windows overlap the next event", () => {
    const s = runStudy(f, { ...base, cooldown: 10, predicate: pred });
    expect(s.overlapping).toBe(1); // 30 starts within 60 sessions of 10
    expect(s.events[0].overlapsNext).toBe(true);
    expect(s.events[1].overlapsNext).toBe(false);
  });
});

describe("8. No look-ahead bias", () => {
  const n = 900;
  const closes = walk(n, 7, 100, 0.02);
  const vixVals = walk(n, 11, 20, 0.05);
  const spx = makeSeries(closes, { start: "2022-01-03" });
  const vix = makeSeries(vixVals, { dates: spx.dates, symbol: "^VIX", assetClass: "volatility_index" });
  const full = buildMarketFrame(spx, vix);
  const t = 600;
  const cut = (s: typeof spx) => ({ ...s, dates: s.dates.slice(0, t + 1), close: s.close.slice(0, t + 1), adjClose: s.adjClose.slice(0, t + 1) });
  const truncated = buildMarketFrame(cut(spx), cut(vix));

  it("every indicator value up to t is identical whether or not later data exists", () => {
    for (const k of ["sma20", "sma50", "sma200", "rsi14", "z50", "ret5", "mtd", "dd252", "ddAth", "vix", "vixPct"] as const) {
      expect(full[k].slice(0, t + 1)).toEqual(truncated[k]);
    }
  });

  it("changing future prices does not change which past dates are selected", () => {
    const shocked = closes.map((c, i) => (i > t ? c * (i % 2 ? 0.5 : 1.7) : c));
    const f2 = buildMarketFrame(makeSeries(shocked, { dates: spx.dates }), vix);
    const pred = filtersPredicate({ side: "downside", rsiThreshold: 40, zThreshold: 1, vixRegime: "any", trend: "any" });
    const a = runStudy(full, { ...base, cooldown: 10, predicate: pred, endDate: spx.dates[t] }).events.map((e) => e.date);
    const b = runStudy(f2, { ...base, cooldown: 10, predicate: pred, endDate: spx.dates[t] }).events.map((e) => e.date);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it("point-in-time studies never read closes after outcomeEnd", () => {
    const pred = (_: MarketFrame, i: number) => i % 50 === 0;
    const pit = runStudy(full, { ...base, predicate: pred, beforeIndex: t, outcomeEnd: t });
    for (const e of pit.events) {
      expect(e.index).toBeLessThan(t);
      for (const h of [1, 5, 10, 20, 60] as const) if (e.forward[h] !== null) expect(e.entryIndex + h).toBeLessThanOrEqual(t);
    }
    const truncatedStudy = runStudy(truncated, { ...base, predicate: pred, beforeIndex: t });
    expect(pit.events.map((e) => e.forward)).toEqual(truncatedStudy.events.map((e) => e.forward));
  });

  it("scanner validation counts only events whose outcome was known before the signal", () => {
    const trig = TRIGGERS.find((x) => x.id === "rsi_oversold")!;
    const h = triggerHistory(full, trig);
    for (const e of h.events) {
      const v = validationAt(h, e.index);
      const manual = h.events.filter((p) => p.index < e.index && p.completeAt <= e.index).length;
      expect(v.priorEvents).toBe(manual);
    }
    const events = scan(full, [trig]);
    expect(events.every((e) => e.validation.priorEvents <= h.events.filter((p) => p.index < e.index).length)).toBe(true);
  });
});
