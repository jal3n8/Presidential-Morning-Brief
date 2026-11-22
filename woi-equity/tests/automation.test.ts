/**
 * The automation builder, fed a synthetic in-memory price series (test data
 * only, never shipped), must compute indicators correctly and leave nulls
 * where the series cannot support a value.
 */
import { describe, expect, it } from "vitest";
import { buildSnapshot, type Bar } from "../automation/build";
import { dueJob } from "../automation/run";
import { validateSnapshot } from "../src/lib/validate";
import { addDays, isTradingDay } from "../src/lib/calendar";
import { baseline } from "./helpers";

function series(end: string, n: number, start: number, step: number): Bar[] {
  const out: Bar[] = [];
  let d = end;
  while (out.length < n) { if (isTradingDay(d)) out.unshift({ date: d, close: 0 }); d = addDays(d, -1); }
  return out.map((b, i) => ({ ...b, close: start + i * step }));
}
const prev = (() => { const v = validateSnapshot(baseline()); if (!v.ok) throw new Error(); return v.snapshot; })();
const D = "2026-11-23";
const provider = { name: "testfeed", method: "test closes", sourceUrl: (s: string) => `https://example.test/${encodeURIComponent(s)}` };

describe("automation snapshot builder", () => {
  const next = buildSnapshot(prev, {
    sessionDate: D,
    series: {
      SPY: series(D, 260, 800, -0.5), QQQ: series(D, 260, 700, -0.4), IWM: series(D, 260, 200, 0.3),
      "^GSPC": series(D, 300, 8000, -3), "^VIX": series(D, 30, 30, 0.1),
      NVDA: series(D, 260, 150, -0.1), TSLA: series(D, 260, 300, 0.2), GOOGL: series(D, 260, 200, 0.2),
      SPCX: series(D, 114, 100, 0.1), // only since listing
      // BTC-USD missing entirely
    },
    treasury2y: null,
    provider,
  }, {}, { job: "closing_snapshot", nowUtc: "2026-11-23T21:16:00Z", todayET: D, connections: [] });

  it("produces a snapshot that passes full validation", () => {
    const v = validateSnapshot(next);
    expect(v.ok).toBe(true);
    expect(v.ok && v.issues.filter((i) => i.level === "warning")).toEqual([]);
  });
  it("computes the regime from its own SMAs: IWM rising means NOT DEFENSIVE", () => {
    expect(next.marketRegime.instruments.find((i) => i.symbol === "IWM")!.sideOfSma200).toBe("above");
    expect(next.marketRegime.label).toBe("NOT DEFENSIVE");
  });
  it("leaves SPCX's 200-day SMA null for lack of history, while computing its 50-day", () => {
    const spcx = next.watchlist.find((w) => w.symbol === "SPCX")!;
    expect(spcx.technicalIndicators.sma200Usd).toBeNull();
    expect(spcx.technicalIndicators.sma50Usd).not.toBeNull();
    expect(spcx.technicalIndicators.sma200Availability).toBe("insufficient_public_trading_history");
  });
  it("does not carry old values forward when a source is missing", () => {
    expect(next.macroAndConfirmation.bitcoin.dailyCandleCloseUsd).toBeNull();
    expect(next.macroAndConfirmation.nominalUsTreasury2YearYieldPct).toBeNull();
    expect(next.macroAndConfirmation.nasdaqBreadth.new52WeekHighs).toBeNull();
    expect(next.validation.warnings.some((w) => w.includes("2-year"))).toBe(true);
  });
  it("keeps undefined signals null and marks the run as automated, not live", () => {
    expect(next.washout.score).toBeNull();
    expect(next.club3030.triggered).toBeNull();
    expect(next.snapshot.isLive).toBe(false);
    expect(next.snapshot.lastSuccessfulAutomatedRunUtc).toBe("2026-11-23T21:16:00Z");
    expect(next.club3030.isFridayClose).toBe(false);
  });
});

describe("automation schedule gate", () => {
  it("is due in the window after 16:15 ET on a trading day, once", () => {
    const t = new Date("2026-11-23T21:30:00Z"); // 16:30 ET
    expect(dueJob(t, new Set())).toEqual({ job: "closing_snapshot", date: "2026-11-23" });
    expect(dueJob(t, new Set(["2026-11-23:closing_snapshot"]))).toBeNull();
  });
  it("is never due on Thanksgiving or a weekend, and moves to 13:15 on the early close", () => {
    expect(dueJob(new Date("2026-11-26T21:30:00Z"), new Set())).toBeNull();
    expect(dueJob(new Date("2026-11-28T15:00:00Z"), new Set())).toBeNull();
    expect(dueJob(new Date("2026-11-27T18:20:00Z"), new Set())).toEqual({ job: "closing_snapshot", date: "2026-11-27" });
    expect(dueJob(new Date("2026-11-27T21:30:00Z"), new Set())).toBeNull();
  });
});
