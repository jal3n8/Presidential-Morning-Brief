import type { Num } from "./indicators";
import type { MarketFrame } from "./market";

/**
 * Every threshold used anywhere in the app lives here, so the rules shown in the UI
 * are exactly the rules the code runs. Labels are descriptive, not forecasts.
 */
export const RULES = {
  extreme: { z50: -2, rsi: 30, vix: 30, ret5: -0.05, dd252: -0.1 },
  elevated: { z50: -1, rsi: 40, vix: 20, ret5: -0.025, dd252: -0.05 },
  upside: { z50: 2, rsi: 70 },
  recovery: { lookback: 20 },
  extremeCountForLabel: 3,
  elevatedCountForLabel: 2,
} as const;

export type ConditionLabel =
  | "Extreme Stress"
  | "Recovery Watch"
  | "Elevated Stress"
  | "Upside Extension"
  | "Normal"
  | "Insufficient Data";

export interface FlagResult {
  key: string;
  label: string;
  value: Num;
  threshold: number;
  rule: string;
  hit: boolean | null; // null = input unavailable
}

function flag(key: string, label: string, value: Num, threshold: number, op: "<=" | ">=", fmt: (x: number) => string): FlagResult {
  const hit = value === null ? null : op === "<=" ? value <= threshold : value >= threshold;
  return { key, label, value, threshold, rule: `${label} ${op === "<=" ? "≤" : "≥"} ${fmt(threshold)}`, hit };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const num = (x: number) => x.toFixed(x % 1 === 0 ? 0 : 1);

export function stressFlags(f: MarketFrame, i: number, level: "extreme" | "elevated"): FlagResult[] {
  const t = RULES[level];
  return [
    flag("z50", "50-day z-score", f.z50[i], t.z50, "<=", num),
    flag("rsi", "RSI(14)", f.rsi14[i], t.rsi, "<=", num),
    flag("vix", "VIX", f.vix[i], t.vix, ">=", num),
    flag("ret5", "5-session return", f.ret5[i], t.ret5, "<=", pct),
    flag("dd252", "Drawdown from 252-session high", f.dd252[i], t.dd252, "<=", pct),
  ];
}

const countHits = (fl: FlagResult[]) => fl.filter((x) => x.hit === true).length;
const countMissing = (fl: FlagResult[]) => fl.filter((x) => x.hit === null).length;

export interface Condition {
  label: ConditionLabel;
  reason: string;
  extreme: FlagResult[];
  elevated: FlagResult[];
  extremeHits: number;
  elevatedHits: number;
  missingInputs: number;
}

function isExtreme(f: MarketFrame, i: number): boolean {
  return countHits(stressFlags(f, i, "extreme")) >= RULES.extremeCountForLabel;
}

/**
 * Rule order (first match wins):
 *  1. Extreme Stress   - at least 3 of the 5 extreme flags
 *  2. Recovery Watch   - not extreme today, Extreme Stress on any of the previous 20 sessions, close >= SMA20
 *  3. Elevated Stress  - at least 1 extreme flag, or at least 2 elevated flags
 *  4. Upside Extension - z50 >= +2 and RSI >= 70
 *  5. Normal
 *  Insufficient Data   - more than 2 of the 5 inputs unavailable
 */
export function evaluateCondition(f: MarketFrame, i: number): Condition {
  const extreme = stressFlags(f, i, "extreme");
  const elevated = stressFlags(f, i, "elevated");
  const extremeHits = countHits(extreme);
  const elevatedHits = countHits(elevated);
  const missingInputs = countMissing(extreme);
  const base = { extreme, elevated, extremeHits, elevatedHits, missingInputs };
  if (missingInputs > 2) {
    return { ...base, label: "Insufficient Data", reason: `${missingInputs} of 5 inputs unavailable on this date.` };
  }
  if (extremeHits >= RULES.extremeCountForLabel) {
    return { ...base, label: "Extreme Stress", reason: `${extremeHits} of 5 extreme-stress flags active (rule: 3 or more).` };
  }
  const lb = RULES.recovery.lookback;
  let recentExtreme = -1;
  for (let j = Math.max(0, i - lb); j < i; j++) if (isExtreme(f, j)) recentExtreme = j;
  const s20 = f.sma20[i];
  if (recentExtreme >= 0 && s20 !== null && f.close[i] >= s20) {
    return {
      ...base,
      label: "Recovery Watch",
      reason: `Extreme Stress on ${f.dates[recentExtreme]} (within ${lb} sessions); close is back above its 20-day average.`,
    };
  }
  if (extremeHits >= 1 || elevatedHits >= RULES.elevatedCountForLabel) {
    return {
      ...base,
      label: "Elevated Stress",
      reason: `${extremeHits} extreme and ${elevatedHits} elevated flags active (rule: 1+ extreme or 2+ elevated).`,
    };
  }
  const z = f.z50[i];
  const r = f.rsi14[i];
  if (z !== null && r !== null && z >= RULES.upside.z50 && r >= RULES.upside.rsi) {
    return { ...base, label: "Upside Extension", reason: `50-day z-score ${z.toFixed(2)} and RSI ${r.toFixed(1)} (rule: z >= 2 and RSI >= 70).` };
  }
  return { ...base, label: "Normal", reason: "No extreme flags and fewer than 2 elevated flags." };
}

// --------------------------------------------------------------------------------------
// Scanner triggers
// --------------------------------------------------------------------------------------

export type TriggerFamily = "downside" | "upside" | "volatility" | "combination";

export interface TriggerDef {
  id: string;
  name: string;
  family: TriggerFamily;
  formula: string;
  threshold: string;
  needsVix: boolean;
  /** true / false, or null when an input is unavailable on that date */
  test: (f: MarketFrame, i: number) => boolean | null;
  inputs: (f: MarketFrame, i: number) => Record<string, Num>;
}

const all = (...xs: (boolean | null)[]) => (xs.some((x) => x === null) ? null : xs.every(Boolean));
const le = (v: Num, t: number) => (v === null ? null : v <= t);
const ge = (v: Num, t: number) => (v === null ? null : v >= t);

export const TRIGGERS: TriggerDef[] = [
  {
    id: "z_low",
    name: "Deeply negative 50-day deviation",
    family: "downside",
    formula: "z50 = (Close - SMA50) / SD50 (population SD of the same 50 closes)",
    threshold: "z50 ≤ −2.0",
    needsVix: false,
    test: (f, i) => le(f.z50[i], -2),
    inputs: (f, i) => ({ close: f.close[i], sma50: f.sma50[i], z50: f.z50[i] }),
  },
  {
    id: "z_high",
    name: "Strongly positive 50-day deviation",
    family: "upside",
    formula: "z50 = (Close - SMA50) / SD50",
    threshold: "z50 ≥ +2.0",
    needsVix: false,
    test: (f, i) => ge(f.z50[i], 2),
    inputs: (f, i) => ({ close: f.close[i], sma50: f.sma50[i], z50: f.z50[i] }),
  },
  {
    id: "rsi_oversold",
    name: "RSI oversold",
    family: "downside",
    formula: "Wilder RSI(14) on daily closes",
    threshold: "RSI14 ≤ 30",
    needsVix: false,
    test: (f, i) => le(f.rsi14[i], 30),
    inputs: (f, i) => ({ close: f.close[i], rsi14: f.rsi14[i] }),
  },
  {
    id: "rsi_overbought",
    name: "RSI overbought",
    family: "upside",
    formula: "Wilder RSI(14) on daily closes",
    threshold: "RSI14 ≥ 70",
    needsVix: false,
    test: (f, i) => ge(f.rsi14[i], 70),
    inputs: (f, i) => ({ close: f.close[i], rsi14: f.rsi14[i] }),
  },
  {
    id: "vix_high",
    name: "VIX at stress level",
    family: "volatility",
    formula: "VIX close; percentile = share of all VIX closes since 1990 (to date) at or below today",
    threshold: "VIX ≥ 30",
    needsVix: true,
    test: (f, i) => ge(f.vix[i], 30),
    inputs: (f, i) => ({ vix: f.vix[i], vixPercentile: f.vixPct[i] }),
  },
  {
    id: "vix_low",
    name: "VIX unusually low",
    family: "volatility",
    formula: "VIX expanding percentile (history to date only)",
    threshold: "VIX percentile ≤ 5%",
    needsVix: true,
    test: (f, i) => le(f.vixPct[i], 0.05),
    inputs: (f, i) => ({ vix: f.vix[i], vixPercentile: f.vixPct[i] }),
  },
  {
    id: "drop5",
    name: "Sharp 5-session decline",
    family: "downside",
    formula: "Close_t / Close_t-5 - 1",
    threshold: "5-session return ≤ −5%",
    needsVix: false,
    test: (f, i) => le(f.ret5[i], -0.05),
    inputs: (f, i) => ({ close: f.close[i], ret5: f.ret5[i] }),
  },
  {
    id: "rally5",
    name: "Sharp 5-session rally",
    family: "upside",
    formula: "Close_t / Close_t-5 - 1",
    threshold: "5-session return ≥ +5%",
    needsVix: false,
    test: (f, i) => ge(f.ret5[i], 0.05),
    inputs: (f, i) => ({ close: f.close[i], ret5: f.ret5[i] }),
  },
  {
    id: "combo_oversold",
    name: "Oversold combination",
    family: "combination",
    formula: "z50 ≤ −2 AND RSI14 ≤ 30",
    threshold: "both conditions on the same close",
    needsVix: false,
    test: (f, i) => all(le(f.z50[i], -2), le(f.rsi14[i], 30)),
    inputs: (f, i) => ({ z50: f.z50[i], rsi14: f.rsi14[i] }),
  },
  {
    id: "combo_capitulation",
    name: "Capitulation combination",
    family: "combination",
    formula: "z50 ≤ −2 AND RSI14 ≤ 30 AND VIX ≥ 30",
    threshold: "all three on the same close",
    needsVix: true,
    test: (f, i) => all(le(f.z50[i], -2), le(f.rsi14[i], 30), ge(f.vix[i], 30)),
    inputs: (f, i) => ({ z50: f.z50[i], rsi14: f.rsi14[i], vix: f.vix[i] }),
  },
  {
    id: "combo_blowoff",
    name: "Upside extension combination",
    family: "combination",
    formula: "z50 ≥ +2 AND RSI14 ≥ 70",
    threshold: "both conditions on the same close",
    needsVix: false,
    test: (f, i) => all(ge(f.z50[i], 2), ge(f.rsi14[i], 70)),
    inputs: (f, i) => ({ z50: f.z50[i], rsi14: f.rsi14[i] }),
  },
];

export const TRIGGER_BY_ID: Record<string, TriggerDef> = Object.fromEntries(TRIGGERS.map((t) => [t.id, t]));
