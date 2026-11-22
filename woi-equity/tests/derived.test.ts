import { describe, expect, it } from "vitest";
import { validateSnapshot } from "../src/lib/validate";
import { computeThreeHorsemen } from "../src/lib/regime";
import { sma, rsiWilder, pctChange, drawdownFromPriorPeak } from "../src/lib/indicators";
import { baseline } from "./helpers";

const load = (raw: unknown) => { const v = validateSnapshot(raw); if (!v.ok) throw new Error("invalid"); return v.snapshot; };

describe("Three Horsemen", () => {
  it("is DEFENSIVE for the baseline because all three are below their 200-day SMA", () => {
    const r = computeThreeHorsemen(load(baseline()));
    expect(r.label).toBe("DEFENSIVE");
    expect(r.belowCount).toBe(3);
    expect(r.agreesWithReported).toBe(true);
    expect(r.instruments.map((i) => Number(i.computedPct!.toFixed(2)))).toEqual([-5.86, -10.92, -8.21]);
  });
  it("is NOT DEFENSIVE when one instrument is above", () => {
    const raw = baseline();
    raw.marketRegime.instruments[2].closeUsd = 290;
    expect(computeThreeHorsemen(load(raw)).label).toBe("NOT DEFENSIVE");
  });
  it("is INDETERMINATE, not guessed, when an input is missing", () => {
    const raw = baseline();
    raw.marketRegime.instruments[1].sma200Usd = null;
    raw.marketRegime.instruments[1].pctVsSma200 = null;
    const r = computeThreeHorsemen(load(raw));
    expect(r.label).toBe("INDETERMINATE");
    expect(r.missing).toEqual(["QQQ"]);
    expect(r.agreesWithReported).toBeNull();
  });
});

describe("indicator math", () => {
  it("SMA uses exactly n values and refuses short series", () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
    expect(sma([1, 2, 3], 4)).toBeNull();
  });
  it("RSI is 100 on a straight rise, 0 on a straight fall, null when short", () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsiWilder(up)).toBe(100);
    expect(rsiWilder([...up].reverse())).toBe(0);
    expect(rsiWilder(up.slice(0, 14))).toBeNull();
  });
  it("percent change and drawdown match the baseline arithmetic", () => {
    expect(Number(pctChange(7818.93, 6910.39)!.toFixed(2))).toBe(-11.62);
    expect(Number(pctChange(6538.76, 6910.39)!.toFixed(2))).toBe(5.68);
    expect(pctChange(null, 1)).toBeNull();
    expect(drawdownFromPriorPeak([100, 120, 90])).toEqual({ peak: 120, pct: -25 });
  });
});
