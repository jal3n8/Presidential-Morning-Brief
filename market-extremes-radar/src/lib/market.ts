import type { Num } from "./indicators";
import { drawdown, expandingPercentile, monthToDate, pctChange, rsiWilder, sma, zScore } from "./indicators";
import type { Series } from "./types";

export interface AlignmentReport {
  /** base dates where the other series has no value (left null, never filled) */
  missingInOther: string[];
  /** dates present only in the other series (ignored) */
  extraInOther: number;
}

/**
 * Exact market-date alignment: returns the other series' value on each base date, or null.
 * No forward-filling: a VIX value from Tuesday is never used for Wednesday.
 */
export function alignToDates(
  baseDates: readonly string[],
  otherDates: readonly string[],
  otherValues: readonly Num[],
): { values: Num[]; report: AlignmentReport } {
  const map = new Map<string, Num>();
  otherDates.forEach((d, i) => map.set(d, otherValues[i]));
  const baseSet = new Set(baseDates);
  const missing: string[] = [];
  const firstOther = otherDates[0] ?? "9999-12-31";
  const values = baseDates.map((d) => {
    const v = map.get(d);
    if (v === undefined) {
      if (d >= firstOther) missing.push(d);
      return null;
    }
    return v;
  });
  let extra = 0;
  for (const d of otherDates) if (!baseSet.has(d)) extra++;
  return { values, report: { missingInOther: missing, extraInOther: extra } };
}

export interface MarketFrame {
  indexSymbol: string;
  volSymbol: string | null;
  dates: string[];
  close: number[];
  sma20: Num[];
  sma50: Num[];
  sma200: Num[];
  rsi14: Num[];
  z50: Num[];
  ret1: Num[];
  ret5: Num[];
  ret20: Num[];
  mtd: Num[];
  dd252: Num[];
  ddAth: Num[];
  vix: Num[];
  vixPct: Num[];
  alignment: AlignmentReport | null;
  firstVolDate: string | null;
}

/** All Overview / Scanner / Analog inputs, computed once from the index and volatility series. */
export function buildMarketFrame(index: Series, vol: Series | null): MarketFrame {
  const close = index.close;
  let vix: Num[] = close.map(() => null);
  let vixPct: Num[] = close.map(() => null);
  let alignment: AlignmentReport | null = null;
  if (vol) {
    const pctOnOwnDates = expandingPercentile(vol.close);
    const a = alignToDates(index.dates, vol.dates, vol.close);
    vix = a.values;
    alignment = a.report;
    vixPct = alignToDates(index.dates, vol.dates, pctOnOwnDates).values;
  }
  return {
    indexSymbol: index.symbol,
    volSymbol: vol?.symbol ?? null,
    dates: index.dates,
    close,
    sma20: sma(close, 20),
    sma50: sma(close, 50),
    sma200: sma(close, 200),
    rsi14: rsiWilder(close, 14),
    z50: zScore(close, 50),
    ret1: pctChange(close, 1),
    ret5: pctChange(close, 5),
    ret20: pctChange(close, 20),
    mtd: monthToDate(index.dates, close),
    dd252: drawdown(close, 252),
    ddAth: drawdown(close, Infinity),
    vix,
    vixPct,
    alignment,
    firstVolDate: vol?.dates[0] ?? null,
  };
}

/** Index of the last row on or before a date (binary search); -1 if none. */
export function indexOnOrBefore(dates: readonly string[], date: string): number {
  let lo = 0;
  let hi = dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Index of the first row on or after a date; dates.length if none. */
export function firstIndexOnOrAfter(dates: readonly string[], date: string): number {
  const i = indexOnOrBefore(dates, date);
  return i >= 0 && dates[i] === date ? i : i + 1;
}
