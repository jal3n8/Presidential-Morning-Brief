import { describe, expect, it } from "vitest";
import { drawdown, expandingPercentile, monthToDate, pctChange, rollingMax, rsiWilder, sma, zScore } from "../src/lib/indicators";

describe("1. SMA", () => {
  it("computes the trailing mean and is null until n values exist", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it("n = 1 returns the input", () => {
    expect(sma([5, 6, 7], 1)).toEqual([5, 6, 7]);
  });
  it("is null when any value in the window is missing (no filling)", () => {
    expect(sma([1, 2, null, 4, 5, 6], 2)).toEqual([null, 3 / 2, null, null, 4.5, 5.5]);
  });
  it("matches a direct computation on a long series", () => {
    const xs = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 7) * 10 + i * 0.1);
    const s = sma(xs, 200);
    const direct = xs.slice(100, 300).reduce((a, b) => a + b, 0) / 200;
    expect(s[299]).toBeCloseTo(direct, 10);
    expect(s[198]).toBeNull();
  });
  it("rejects a non-integer period", () => {
    expect(() => sma([1, 2], 1.5)).toThrow();
  });
});

describe("2. Wilder RSI", () => {
  // Classic worked example (StockCharts "RSI" ChartSchool table, 14-period Wilder smoothing)
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66, 43.13];
  const published = [70.46, 66.25, 66.48, 69.35, 66.29, 57.92, 62.88, 63.21, 56.01, 62.34, 54.67, 50.39, 40.02, 41.49, 41.9, 45.5, 37.32, 33.09, 37.79];
  it("reproduces the published worked example to 2 decimals", () => {
    const r = rsiWilder(closes, 14);
    expect(r.slice(0, 14).every((x) => x === null)).toBe(true);
    r.slice(14).forEach((x, k) => expect(x).toBeCloseTo(published[k], 2));
  });
  it("first value uses a simple average of the first 14 changes", () => {
    const xs = [10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10];
    // 7 gains of 1 and 7 losses of 1 -> RS = 1 -> RSI 50
    expect(rsiWilder(xs, 14)[14]).toBeCloseTo(50, 10);
  });
  it("is 100 when there are no losses and 50 when flat", () => {
    expect(rsiWilder(Array.from({ length: 20 }, (_, i) => 100 + i), 14)[19]).toBe(100);
    expect(rsiWilder(Array(20).fill(100), 14)[19]).toBe(50);
  });
  it("restarts after a gap instead of bridging it", () => {
    const xs: (number | null)[] = [...closes.slice(0, 20), null, ...closes.slice(0, 16)];
    const r = rsiWilder(xs, 14);
    expect(r[20]).toBeNull();
    expect(r.slice(21, 21 + 14).every((x) => x === null)).toBe(true);
    expect(r[21 + 14]).toBeCloseTo(published[0], 2);
  });
});

describe("3. Standardized deviation (z-score)", () => {
  it("uses (close - SMA) / population SD of the same window", () => {
    const xs = [2, 4, 4, 4, 5, 5, 7, 9]; // mean 5, population SD 2
    expect(zScore(xs, 8)[7]).toBeCloseTo((9 - 5) / 2, 12);
  });
  it("is null for a flat window (SD = 0) and before the window fills", () => {
    const z = zScore([3, 3, 3, 3], 3);
    expect(z).toEqual([null, null, null, null]);
  });
  it("is negative after a sharp drop", () => {
    const xs = [...Array(49).fill(100), 80];
    expect(zScore(xs, 50)[49]!).toBeLessThan(-6);
  });
});

describe("Other trailing indicators", () => {
  it("pctChange", () => {
    expect(pctChange([100, 110, 99], 1)).toEqual([null, 0.10000000000000009, -0.09999999999999998]);
  });
  it("rollingMax and drawdown", () => {
    expect(rollingMax([1, 3, 2, 5, 4], 2)).toEqual([null, 3, 3, 5, 5]);
    expect(rollingMax([1, 3, 2], Infinity)).toEqual([1, 3, 3]);
    expect(drawdown([100, 90, 95], 252)).toEqual([null, null, null]); // never from a shorter history
    expect(drawdown([100, 120, 90, 130], Infinity)).toEqual([0, 0, 90 / 120 - 1, 0]);
  });
  it("expanding percentile uses history to date only", () => {
    expect(expandingPercentile([10, 20, 15, 5, null, 25])).toEqual([1, 1, 2 / 3, 1 / 4, null, 1]);
  });
  it("month to date compares with the previous month's last close", () => {
    const d = ["2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03"];
    const m = monthToDate(d, [100, 110, 99, 121]);
    expect(m[0]).toBeNull();
    expect(m[2]).toBeCloseTo(99 / 110 - 1, 12);
    expect(m[3]).toBeCloseTo(121 / 110 - 1, 12);
  });
});
