/**
 * Indicator library. Every function is TRAILING: the value at index i uses only
 * inputs at indices <= i, so nothing here can leak future information.
 * Missing inputs (null) propagate as null; nothing is filled or estimated.
 */
export type Num = number | null;

/** Simple moving average. Null until `n` values exist, or if any value in the window is null. */
export function sma(values: readonly Num[], n: number): Num[] {
  if (n < 1 || !Number.isInteger(n)) throw new Error("SMA period must be a positive integer");
  const out: Num[] = new Array(values.length).fill(null);
  let sum = 0;
  let valid = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== null) {
      sum += v;
      valid++;
    }
    if (i >= n) {
      const old = values[i - n];
      if (old !== null) {
        sum -= old;
        valid--;
      }
    }
    if (i >= n - 1 && valid === n) out[i] = sum / n;
  }
  return out;
}

/** Population standard deviation over a trailing window of `n` values (null if incomplete). */
export function rollingStd(values: readonly Num[], n: number): Num[] {
  const out: Num[] = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - n + 1; j <= i; j++) {
      const v = values[j];
      if (v === null) {
        ok = false;
        break;
      }
      sum += v;
    }
    if (!ok) continue;
    const mean = sum / n;
    let ss = 0;
    for (let j = i - n + 1; j <= i; j++) ss += ((values[j] as number) - mean) ** 2;
    out[i] = Math.sqrt(ss / n);
  }
  return out;
}

/**
 * Standardized deviation (z-score) of the close from its own n-day mean:
 *   z_t = (C_t - SMA_n,t) / SD_n,t, population SD over the same n closes ending at t.
 */
export function zScore(values: readonly Num[], n: number): Num[] {
  const m = sma(values, n);
  const s = rollingStd(values, n);
  return values.map((v, i) => {
    const mi = m[i];
    const si = s[i];
    if (v === null || mi === null || si === null || si === 0) return null;
    return (v - mi) / si;
  });
}

/**
 * Wilder's RSI (J. Welles Wilder, 1978).
 *   change_t = C_t - C_{t-1}; gain = max(change,0); loss = max(-change,0)
 *   first average = simple mean of the first n gains/losses (changes 1..n) -> first RSI at index n
 *   then avg_t = (avg_{t-1} * (n-1) + value_t) / n
 *   RSI = 100 - 100 / (1 + avgGain/avgLoss); avgLoss = 0 -> 100 (or 50 if avgGain is also 0)
 * Requires a gap-free series; a null resets the calculation.
 */
export function rsiWilder(values: readonly Num[], n = 14): Num[] {
  const out: Num[] = new Array(values.length).fill(null);
  let start = 0; // index of the first value of the current gap-free run
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) {
      start = i + 1;
      avgGain = 0;
      avgLoss = 0;
      continue;
    }
    const k = i - start; // number of changes available in this run
    if (k === 0) continue;
    const change = v - (values[i - 1] as number);
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (k <= n) {
      avgGain += gain / n;
      avgLoss += loss / n;
      if (k < n) continue;
    } else {
      avgGain = (avgGain * (n - 1) + gain) / n;
      avgLoss = (avgLoss * (n - 1) + loss) / n;
    }
    out[i] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** k-period simple return C_t / C_{t-k} - 1 (trailing). */
export function pctChange(values: readonly Num[], k: number): Num[] {
  return values.map((v, i) => {
    if (i < k) return null;
    const p = values[i - k];
    if (v === null || p === null || p === 0) return null;
    return v / p - 1;
  });
}

/**
 * Highest value over the trailing `n` observations including today (n = Infinity -> expanding).
 * For a finite n the result is null until n observations exist, so a "252-session high" is never
 * quietly computed from a shorter history.
 */
export function rollingMax(values: readonly Num[], n: number): Num[] {
  const out: Num[] = new Array(values.length).fill(null);
  const dq: number[] = []; // indices with decreasing values
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    while (dq.length && dq[0] <= i - n) dq.shift();
    if (v !== null) {
      while (dq.length && (values[dq[dq.length - 1]] as number) <= v) dq.pop();
      dq.push(i);
    }
    out[i] = dq.length && (n === Infinity || i >= n - 1) ? (values[dq[0]] as number) : null;
  }
  return out;
}

/** Drawdown from the trailing n-day closing high (n = Infinity -> from the all-time closing high). */
export function drawdown(values: readonly Num[], n: number): Num[] {
  const mx = rollingMax(values, n);
  return values.map((v, i) => (v === null || mx[i] === null ? null : v / (mx[i] as number) - 1));
}

/**
 * Expanding percentile rank: share of all observations from the start up to and including t
 * that are <= the value at t. Uses only past and present data (no look-ahead).
 */
export function expandingPercentile(values: readonly Num[]): Num[] {
  const sorted: number[] = [];
  return values.map((v) => {
    if (v === null) return null;
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    sorted.splice(lo, 0, v);
    return (lo + 1) / sorted.length; // count(<= v) / count
  });
}

/** Month-to-date change versus the last close of the previous calendar month. */
export function monthToDate(dates: readonly string[], values: readonly Num[]): Num[] {
  let prevMonthClose: Num = null;
  let lastClose: Num = null;
  let month = "";
  return values.map((v, i) => {
    const m = dates[i].slice(0, 7);
    if (m !== month) {
      prevMonthClose = month === "" ? null : lastClose;
      month = m;
    }
    if (v !== null) lastClose = v;
    return v === null || prevMonthClose === null ? null : v / prevMonthClose - 1;
  });
}

/** Year-to-date change versus the last close of the previous calendar year. */
export function yearToDate(dates: readonly string[], values: readonly Num[]): Num[] {
  let prevYearClose: Num = null;
  let lastClose: Num = null;
  let year = "";
  return values.map((v, i) => {
    const y = dates[i].slice(0, 4);
    if (y !== year) {
      prevYearClose = year === "" ? null : lastClose;
      year = y;
    }
    if (v !== null) lastClose = v;
    return v === null || prevYearClose === null ? null : v / prevYearClose - 1;
  });
}

/** OUTCOME helper (not an indicator): C_{i+h} / C_i - 1, or null if the window is incomplete. */
export function forwardReturn(values: readonly number[], i: number, h: number): Num {
  if (i < 0 || i + h >= values.length) return null;
  return values[i + h] / values[i] - 1;
}

/** OUTCOME helper: worst and best close-to-close move over sessions i+1..i+h (null if incomplete). */
export function excursion(values: readonly number[], i: number, h: number): { mae: number; mfe: number } | null {
  if (i < 0 || i + h >= values.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = i + 1; j <= i + h; j++) {
    const r = values[j] / values[i] - 1;
    if (r < lo) lo = r;
    if (r > hi) hi = r;
  }
  return { mae: lo, mfe: hi };
}
