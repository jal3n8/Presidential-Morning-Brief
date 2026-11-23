import type { Num } from "./indicators";
import { excursion, forwardReturn } from "./indicators";
import type { MarketFrame } from "./market";
import { firstIndexOnOrAfter, indexOnOrBefore } from "./market";

export const HORIZONS = [1, 5, 10, 20, 60] as const;
export type Horizon = (typeof HORIZONS)[number];

export type Predicate = (f: MarketFrame, i: number) => boolean | null;

export interface StudyConfig {
  predicate: Predicate;
  description: string;
  startDate?: string;
  endDate?: string;
  /** a new event starts only after `cooldown` consecutive sessions WITHOUT the condition */
  cooldown: number;
  /** false = every qualifying day is an observation (overlapping, NOT independent) */
  dedupe: boolean;
  entry: "signal_close" | "next_close";
  excursionHorizon: number;
  /** only signals with index < beforeIndex (used for point-in-time validation) */
  beforeIndex?: number;
  /** last close index that outcomes may use (point-in-time validation); default = last row */
  outcomeEnd?: number;
}

export interface AnalogEvent {
  index: number;
  date: string;
  entryIndex: number;
  entryDate: string | null;
  close: number;
  rsi14: Num;
  z50: Num;
  vix: Num;
  above200: boolean | null;
  clusterDays: number;
  forward: Record<Horizon, Num>;
  mae: Num;
  mfe: Num;
  overlapsNext: boolean;
}

export interface Summary {
  n: number;
  mean: Num;
  median: Num;
  pctPositive: Num;
  min: Num;
  max: Num;
}

export interface HorizonStats extends Summary {
  h: Horizon;
  pending: number;
  baseline: Summary;
}

export interface StudyResult {
  events: AnalogEvent[];
  qualifyingDays: number;
  unavailableDays: number;
  horizons: HorizonStats[];
  overlapping: number;
  mae: Summary;
  path: { k: number; mean: number; median: number; n: number }[];
  rangeStart: string | null;
  rangeEnd: string | null;
}

export function summarize(xs: readonly number[]): Summary {
  if (xs.length === 0) return { n: 0, mean: null, median: null, pctPositive: null, min: null, max: null };
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return {
    n: s.length,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    median,
    pctPositive: s.filter((x) => x > 0).length / s.length,
    min: s[0],
    max: s[s.length - 1],
  };
}

/**
 * Run a historical analog study. Event selection uses ONLY trailing indicator values at the
 * signal date. Forward prices are touched only to measure outcomes, and only up to outcomeEnd.
 */
export function runStudy(f: MarketFrame, cfg: StudyConfig): StudyResult {
  const n = f.dates.length;
  const lastOutcome = Math.min(cfg.outcomeEnd ?? n - 1, n - 1);
  const closes = f.close.slice(0, lastOutcome + 1); // outcome prices visible to this study
  const lo = cfg.startDate ? firstIndexOnOrAfter(f.dates, cfg.startDate) : 0;
  const hiDate = cfg.endDate ? indexOnOrBefore(f.dates, cfg.endDate) : n - 1;
  const hi = Math.min(hiDate, (cfg.beforeIndex ?? n) - 1, lastOutcome);

  const events: AnalogEvent[] = [];
  let qualifyingDays = 0;
  let unavailableDays = 0;
  let lastQualifying = -Infinity;
  for (let i = lo; i <= hi; i++) {
    const q = cfg.predicate(f, i);
    if (q === null) {
      unavailableDays++;
      continue;
    }
    if (!q) continue;
    qualifyingDays++;
    const startsNew = !cfg.dedupe || i - lastQualifying > cfg.cooldown;
    lastQualifying = i;
    if (!startsNew) {
      events[events.length - 1].clusterDays++;
      continue;
    }
    const e = cfg.entry === "signal_close" ? i : i + 1;
    const entryOk = e < closes.length;
    const fwd = {} as Record<Horizon, Num>;
    for (const h of HORIZONS) fwd[h] = entryOk ? forwardReturn(closes, e, h) : null;
    const ex = entryOk ? excursion(closes, e, cfg.excursionHorizon) : null;
    const s200 = f.sma200[i];
    events.push({
      index: i,
      date: f.dates[i],
      entryIndex: e,
      entryDate: entryOk ? f.dates[e] : null,
      close: f.close[i],
      rsi14: f.rsi14[i],
      z50: f.z50[i],
      vix: f.vix[i],
      above200: s200 === null ? null : f.close[i] > s200,
      clusterDays: 1,
      forward: fwd,
      mae: ex?.mae ?? null,
      mfe: ex?.mfe ?? null,
      overlapsNext: false,
    });
  }
  const maxH = Math.max(...HORIZONS, cfg.excursionHorizon);
  let overlapping = 0;
  for (let k = 0; k < events.length - 1; k++) {
    if (events[k + 1].entryIndex <= events[k].entryIndex + maxH) {
      events[k].overlapsNext = true;
      overlapping++;
    }
  }

  const horizons: HorizonStats[] = HORIZONS.map((h) => {
    const xs = events.map((e) => e.forward[h]).filter((x): x is number => x !== null);
    const base: number[] = [];
    for (let i = lo; i <= hi; i++) {
      const e = cfg.entry === "signal_close" ? i : i + 1;
      const r = e < closes.length ? forwardReturn(closes, e, h) : null;
      if (r !== null) base.push(r);
    }
    return { h, ...summarize(xs), pending: events.length - xs.length, baseline: summarize(base) };
  });

  const path: StudyResult["path"] = [];
  const full = events.filter((e) => e.entryIndex + cfg.excursionHorizon < closes.length);
  for (let k = 0; k <= cfg.excursionHorizon; k++) {
    const xs = full.map((e) => closes[e.entryIndex + k] / closes[e.entryIndex] - 1);
    const s = summarize(xs);
    if (s.n) path.push({ k, mean: s.mean as number, median: s.median as number, n: s.n });
  }

  return {
    events,
    qualifyingDays,
    unavailableDays,
    horizons,
    overlapping,
    mae: summarize(events.map((e) => e.mae).filter((x): x is number => x !== null)),
    path,
    rangeStart: lo <= hi ? f.dates[lo] : null,
    rangeEnd: lo <= hi ? f.dates[hi] : null,
  };
}

// --------------------------------------------------------------------------------------
// Analog Lab filters
// --------------------------------------------------------------------------------------

export type VixRegime = "any" | "lt20" | "20to30" | "gte30";
export type TrendFilter = "any" | "above200" | "below200";

export interface AnalogFilters {
  side: "downside" | "upside";
  rsiThreshold: number | null;
  zThreshold: number | null;
  vixRegime: VixRegime;
  trend: TrendFilter;
}

export function describeFilters(fl: AnalogFilters): string {
  const parts: string[] = [];
  const down = fl.side === "downside";
  if (fl.rsiThreshold !== null) parts.push(`RSI14 ${down ? "≤" : "≥"} ${fl.rsiThreshold}`);
  if (fl.zThreshold !== null) parts.push(`z50 ${down ? "≤ −" : "≥ +"}${Math.abs(fl.zThreshold).toFixed(1)}`);
  if (fl.vixRegime === "lt20") parts.push("VIX < 20");
  if (fl.vixRegime === "20to30") parts.push("20 ≤ VIX < 30");
  if (fl.vixRegime === "gte30") parts.push("VIX ≥ 30");
  if (fl.trend === "above200") parts.push("close above SMA200");
  if (fl.trend === "below200") parts.push("close below SMA200");
  return parts.length ? parts.join(" AND ") : "no conditions selected";
}

export function filtersPredicate(fl: AnalogFilters): Predicate {
  const down = fl.side === "downside";
  const zAbs = fl.zThreshold === null ? null : Math.abs(fl.zThreshold);
  return (f, i) => {
    const checks: (boolean | null)[] = [];
    if (fl.rsiThreshold !== null) {
      const r = f.rsi14[i];
      checks.push(r === null ? null : down ? r <= fl.rsiThreshold : r >= fl.rsiThreshold);
    }
    if (zAbs !== null) {
      const z = f.z50[i];
      checks.push(z === null ? null : down ? z <= -zAbs : z >= zAbs);
    }
    if (fl.vixRegime !== "any") {
      const v = f.vix[i];
      checks.push(
        v === null ? null : fl.vixRegime === "lt20" ? v < 20 : fl.vixRegime === "20to30" ? v >= 20 && v < 30 : v >= 30,
      );
    }
    if (fl.trend !== "any") {
      const s = f.sma200[i];
      checks.push(s === null ? null : fl.trend === "above200" ? f.close[i] > s : f.close[i] < s);
    }
    if (checks.length === 0) return false;
    if (checks.some((c) => c === false)) return false;
    if (checks.some((c) => c === null)) return null;
    return true;
  };
}

/**
 * Pre-fill the lab from the latest observation ("match current conditions"), snapping to the
 * standard cut-offs (RSI 30/40 or 70/60, |z| 2/1) so the comparison set is not over-fitted.
 */
export function filtersFromCurrent(f: MarketFrame): AnalogFilters {
  const i = f.dates.length - 1;
  const r = f.rsi14[i];
  const z = f.z50[i];
  const v = f.vix[i];
  const s = f.sma200[i];
  const side: AnalogFilters["side"] = z !== null && z > 0 ? "upside" : "downside";
  let rsiThreshold: number | null = null;
  if (r !== null) {
    if (side === "downside") rsiThreshold = r <= 30 ? 30 : r <= 40 ? 40 : null;
    else rsiThreshold = r >= 70 ? 70 : r >= 60 ? 60 : null;
  }
  const za = z === null ? 0 : Math.abs(z);
  return {
    side,
    rsiThreshold,
    zThreshold: za >= 2 ? 2 : za >= 1 ? 1 : null,
    vixRegime: v === null ? "any" : v >= 30 ? "gte30" : v >= 20 ? "20to30" : "lt20",
    trend: s === null ? "any" : f.close[i] > s ? "above200" : "below200",
  };
}

export function histogram(xs: readonly number[], bins = 16): { from: number; to: number; count: number }[] {
  if (!xs.length) return [];
  let lo = Math.min(...xs);
  let hi = Math.max(...xs);
  if (lo === hi) {
    lo -= 0.005;
    hi += 0.005;
  }
  const w = (hi - lo) / bins;
  const out = Array.from({ length: bins }, (_, k) => ({ from: lo + k * w, to: lo + (k + 1) * w, count: 0 }));
  for (const x of xs) out[Math.min(bins - 1, Math.floor((x - lo) / w))].count++;
  return out;
}
