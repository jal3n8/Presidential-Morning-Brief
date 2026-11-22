/**
 * Indicator math used by the pipeline when it has a real daily close series.
 * Every function returns null rather than a partial or padded result when the
 * series is too short.
 */

export const round = (x: number, dp = 2) => Math.round(x * 10 ** dp) / 10 ** dp;

/** Simple moving average of the last `n` values. */
export function sma(values: number[], n: number): number | null {
  if (n <= 0 || values.length < n) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i];
  return s / n;
}

/** Wilder's RSI over `n` periods (the standard RSI(14)). Needs n+1 closes. */
export function rsiWilder(closes: number[], n = 14): number | null {
  if (closes.length < n + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  let avgG = gain / n, avgL = loss / n;
  for (let i = n + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    avgG = (avgG * (n - 1) + Math.max(ch, 0)) / n;
    avgL = (avgL * (n - 1) + Math.max(-ch, 0)) / n;
  }
  if (avgL === 0) return avgG === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgG / avgL);
}

export function pctChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return (to / from - 1) * 100;
}

export function sideOf(close: number | null, ref: number | null): "above" | "below" | "at" | null {
  if (close === null || ref === null) return null;
  if (close > ref) return "above";
  if (close < ref) return "below";
  return "at";
}

/** Highest close strictly before the last element, and the last close's drawdown from it. */
export function drawdownFromPriorPeak(closes: number[]): { peak: number; pct: number } | null {
  if (closes.length < 2) return null;
  const last = closes[closes.length - 1];
  const peak = Math.max(...closes.slice(0, -1), last);
  return { peak, pct: (last / peak - 1) * 100 };
}
