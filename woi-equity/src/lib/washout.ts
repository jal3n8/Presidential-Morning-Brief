import type { Snapshot } from "./schema";

/**
 * Configurable washout scoring.
 *
 * The snapshot's own `washout.score` stays blocked until a formula is agreed.
 * This module lets the user define criteria and thresholds explicitly. It
 * produces a score only when the user has activated their formula, and a
 * criterion whose input is null is reported as "unavailable", never as met
 * or not met.
 */

export type Comparator = "<=" | ">=" | "is_true";

export type Criterion = {
  id: string;
  label: string;
  /** Dotted path into the snapshot. */
  field: string;
  comparator: Comparator;
  threshold: number | null;
  unit: string;
  weight: number;
  enabled: boolean;
};

export type WashoutConfig = {
  version: 1;
  /** Score is only produced when the user has switched this on. */
  activated: boolean;
  /** Free-text name for the formula, so a score is always attributable. */
  name: string;
  criteria: Criterion[];
};

export const DEFAULT_WASHOUT_CONFIG: WashoutConfig = {
  version: 1,
  activated: false,
  name: "Draft formula (not activated)",
  criteria: [
    { id: "rsi", label: "S&P 500 RSI(14)", field: "washout.sp500.rsi14", comparator: "<=", threshold: 30, unit: "", weight: 1, enabled: true },
    { id: "drawdown", label: "Drawdown from closing peak", field: "washout.sp500.pctDrawdownFromClosingPeak", comparator: "<=", threshold: -10, unit: "%", weight: 1, enabled: true },
    { id: "vix", label: "VIX close", field: "washout.vixClose", comparator: ">=", threshold: 30, unit: "", weight: 1, enabled: true },
    { id: "sma200", label: "S&P 500 vs 200-day SMA", field: "washout.sp500.pctVsSma200", comparator: "<=", threshold: -5, unit: "%", weight: 1, enabled: true },
    { id: "sigma", label: "5-day sigma move", field: "washout.fiveDaySigma", comparator: "<=", threshold: -2, unit: "σ", weight: 1, enabled: true },
    { id: "cluster", label: "VIX cluster confirmed", field: "washout.vixCluster", comparator: "is_true", threshold: null, unit: "", weight: 1, enabled: true },
    { id: "stabilizing", label: "Realized volatility stabilizing", field: "washout.vixRealizedStabilizing", comparator: "is_true", threshold: null, unit: "", weight: 1, enabled: true },
  ],
};

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export type CriterionResult = {
  criterion: Criterion;
  value: unknown;
  state: "met" | "not_met" | "unavailable" | "disabled";
};

export function evaluateCriterion(c: Criterion, s: Snapshot): CriterionResult {
  const value = getPath(s, c.field);
  if (!c.enabled) return { criterion: c, value, state: "disabled" };
  if (value === null || value === undefined) return { criterion: c, value: null, state: "unavailable" };
  if (c.comparator === "is_true") {
    if (typeof value !== "boolean") return { criterion: c, value, state: "unavailable" };
    return { criterion: c, value, state: value ? "met" : "not_met" };
  }
  if (typeof value !== "number" || c.threshold === null) return { criterion: c, value, state: "unavailable" };
  const met = c.comparator === "<=" ? value <= c.threshold : value >= c.threshold;
  return { criterion: c, value, state: met ? "met" : "not_met" };
}

export type WashoutEvaluation = {
  results: CriterionResult[];
  /** null unless activated. */
  score: number | null;
  maxAvailable: number;
  maxPossible: number;
  unavailableCount: number;
};

export function evaluateWashout(cfg: WashoutConfig, s: Snapshot): WashoutEvaluation {
  const results = cfg.criteria.map((c) => evaluateCriterion(c, s));
  const live = results.filter((r) => r.state !== "disabled");
  const available = live.filter((r) => r.state !== "unavailable");
  const scoreSum = available.filter((r) => r.state === "met").reduce((a, r) => a + r.criterion.weight, 0);
  return {
    results,
    score: cfg.activated ? scoreSum : null,
    maxAvailable: available.reduce((a, r) => a + r.criterion.weight, 0),
    maxPossible: live.reduce((a, r) => a + r.criterion.weight, 0),
    unavailableCount: live.length - available.length,
  };
}

export function sanitizeConfig(raw: unknown): WashoutConfig {
  try {
    const c = raw as WashoutConfig;
    if (!c || c.version !== 1 || !Array.isArray(c.criteria)) return DEFAULT_WASHOUT_CONFIG;
    const criteria = c.criteria
      .filter((x) => x && typeof x.id === "string" && typeof x.field === "string")
      .map((x) => ({
        ...x,
        threshold: typeof x.threshold === "number" && Number.isFinite(x.threshold) ? x.threshold : null,
        weight: typeof x.weight === "number" && x.weight >= 0 ? x.weight : 1,
        enabled: !!x.enabled,
      }));
    return { version: 1, activated: !!c.activated, name: String(c.name || "Custom formula"), criteria };
  } catch {
    return DEFAULT_WASHOUT_CONFIG;
  }
}
