import type { Num } from "./indicators";
import { pctChange, rsiWilder, sma, yearToDate } from "./indicators";
import { indexOnOrBefore } from "./market";
import type { Series } from "./types";
import { SYMBOL_RE } from "./types";

export const DEFAULT_WATCHLIST = ["SPY", "QQQ", "NVDA", "TSLA", "GOOGL"];
export const RS_LOOKBACK = 63; // ~3 months of sessions
export const RS_BENCHMARK = "SPY";

export type Trend = "Uptrend" | "Downtrend" | "Mixed" | "Insufficient history";

export interface WatchRow {
  symbol: string;
  series: Series | null;
  lastDate: string | null;
  close: Num;
  ret1: Num;
  ret5: Num;
  ret21: Num;
  ytd: Num;
  sma50: Num;
  sma200: Num;
  rsi14: Num;
  trend: Trend;
  rs63: Num;
  notes: string[];
}

export function normaliseSymbol(input: string): string | null {
  const s = input.trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : null;
}

const last = <T,>(xs: readonly T[]): T | null => (xs.length ? xs[xs.length - 1] : null);

/**
 * Trend rule: Uptrend if close > SMA50 > SMA200; Downtrend if close < SMA50 < SMA200; else Mixed.
 * Indicators use the split- and dividend-adjusted close so splits do not create false signals.
 */
export function watchRow(symbol: string, series: Series | null, benchmark: Series | null): WatchRow {
  const empty: WatchRow = {
    symbol, series: null, lastDate: null, close: null, ret1: null, ret5: null, ret21: null, ytd: null,
    sma50: null, sma200: null, rsi14: null, trend: "Insufficient history", rs63: null,
    notes: ["No validated data for this symbol. Add it to pipeline/symbols.json and run `npm run data:update`, or import a CSV on the Data page."],
  };
  if (!series || series.dates.length < 2) return empty;
  const a = series.adjClose;
  const s50 = last(sma(a, 50));
  const s200 = last(sma(a, 200));
  const lastAdj = a[a.length - 1];
  const notes: string[] = [];
  let trend: Trend = "Insufficient history";
  if (s50 !== null && s200 !== null) {
    trend = lastAdj > s50 && s50 > s200 ? "Uptrend" : lastAdj < s50 && s50 < s200 ? "Downtrend" : "Mixed";
  } else notes.push(`Only ${a.length} sessions: a 200-session average needs 200.`);

  let rs63: Num = null;
  if (benchmark && symbol !== benchmark.symbol) {
    const lastDate = series.dates[series.dates.length - 1];
    const bi = indexOnOrBefore(benchmark.dates, lastDate);
    if (bi >= 0 && benchmark.dates[bi] === lastDate && a.length > RS_LOOKBACK && bi >= RS_LOOKBACK) {
      const own = lastAdj / a[a.length - 1 - RS_LOOKBACK] - 1;
      const bench = benchmark.adjClose[bi] / benchmark.adjClose[bi - RS_LOOKBACK] - 1;
      rs63 = own - bench;
    } else if (bi < 0 || benchmark.dates[bi] !== lastDate) {
      notes.push(`Latest date differs from ${benchmark.symbol}; relative strength not computed (dates must match).`);
    }
  }
  return {
    symbol,
    series,
    lastDate: series.dates[series.dates.length - 1],
    close: series.close[series.close.length - 1],
    ret1: last(pctChange(a, 1)),
    ret5: last(pctChange(a, 5)),
    ret21: last(pctChange(a, 21)),
    ytd: last(yearToDate(series.dates, a)),
    sma50: s50 === null ? null : s50 * (series.close[series.close.length - 1] / lastAdj),
    sma200: s200 === null ? null : s200 * (series.close[series.close.length - 1] / lastAdj),
    rsi14: last(rsiWilder(a, 14)),
    trend,
    rs63,
    notes,
  };
}
