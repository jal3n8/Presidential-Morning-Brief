import { SnapshotSchema, type Snapshot } from "./schema";
import { isTradingDay } from "./calendar";
import { computeThreeHorsemen } from "./regime";
import { pctChange } from "./indicators";

export type Issue = { level: "error" | "warning" | "info"; path: string; message: string };

export type ValidationResult =
  | { ok: true; snapshot: Snapshot; issues: Issue[] }
  | { ok: false; snapshot: null; issues: Issue[] };

const TOLERANCE_PCT = 0.02;

/**
 * Structural validation (zod) followed by consistency checks that recompute
 * every derived number the snapshot reports. Mismatches are warnings: the
 * dashboard shows both the reported and the recomputed value instead of
 * silently choosing one.
 */
/** Keys that can tamper with JavaScript object prototypes. Rejected anywhere in a file. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
export function findForbiddenKey(v: unknown, path = "", depth = 0): string | null {
  if (depth > 64) return path || "(root)";
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) { const r = findForbiddenKey(v[i], `${path}[${i}]`, depth + 1); if (r) return r; }
  } else if (v && typeof v === "object") {
    for (const k of Object.keys(v)) {
      const p = path ? `${path}.${k}` : k;
      if (FORBIDDEN_KEYS.has(k)) return p;
      const r = findForbiddenKey((v as Record<string, unknown>)[k], p, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

export function validateSnapshot(input: unknown): ValidationResult {
  const bad = findForbiddenKey(input);
  if (bad) return { ok: false, snapshot: null, issues: [{ level: "error", path: bad, message: "Forbidden key (or nesting deeper than 64 levels)" }] };
  const parsed = SnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      snapshot: null,
      issues: parsed.error.issues.slice(0, 50).map((i) => ({
        level: "error" as const,
        path: i.path.join(".") || "(root)",
        message: i.message,
      })),
    };
  }
  const s = parsed.data;
  const issues: Issue[] = [];
  const warn = (path: string, message: string) => issues.push({ level: "warning", path, message });
  const info = (path: string, message: string) => issues.push({ level: "info", path, message });

  const checkPct = (path: string, reported: number | null, from: number | null, to: number | null) => {
    const computed = pctChange(from, to);
    if (reported === null || computed === null) return;
    if (Math.abs(reported - computed) > TOLERANCE_PCT)
      warn(path, `Reported ${reported.toFixed(2)}% but inputs give ${computed.toFixed(2)}%.`);
  };

  // Source references must resolve.
  const refs: [string, string | null][] = [];
  s.marketRegime.instruments.forEach((i, n) => i.dataSources.forEach((r) => refs.push([`marketRegime.instruments.${n}(${i.symbol})`, r])));
  s.washout.sp500.dataSources.forEach((r) => refs.push(["washout.sp500.dataSources", r]));
  refs.push(["washout.vixSource", s.washout.vixSource]);
  refs.push(["macroAndConfirmation.nominalYieldSource", s.macroAndConfirmation.nominalYieldSource]);
  refs.push(["macroAndConfirmation.nasdaqBreadth.source", s.macroAndConfirmation.nasdaqBreadth.source]);
  refs.push(["macroAndConfirmation.bitcoin.source", s.macroAndConfirmation.bitcoin.source]);
  s.watchlist.forEach((w) => {
    refs.push([`watchlist.${w.symbol}.marketDataSource`, w.marketDataSource]);
    const r = w.research;
    [...r.verifiedCatalysts, ...r.verifiedFilings, ...r.unverifiedClaims].forEach((item) => {
      if (item.sourceRef) refs.push([`watchlist.${w.symbol}.research`, item.sourceRef]);
      if (!item.sourceRef && !item.url) warn(`watchlist.${w.symbol}.research`, `"${item.title}" has no source reference or URL.`);
    });
  });
  for (const [path, ref] of refs) {
    if (ref !== null && !(ref in s.sources)) warn(path, `Source reference "${ref}" is not in the sources ledger.`);
  }

  // Three Horsemen consistency.
  const regime = computeThreeHorsemen(s);
  regime.instruments.forEach((i) => checkPct(`marketRegime.${i.symbol}.pctVsSma200`, i.reportedPct, i.sma200, i.close));
  s.marketRegime.instruments.forEach((i) => {
    const side = i.closeUsd !== null && i.sma200Usd !== null ? (i.closeUsd < i.sma200Usd ? "below" : i.closeUsd > i.sma200Usd ? "above" : "at") : null;
    if (side && i.sideOfSma200 && side !== i.sideOfSma200) warn(`marketRegime.${i.symbol}.sideOfSma200`, `Reported "${i.sideOfSma200}" but close vs SMA200 is "${side}".`);
  });
  if (regime.agreesWithReported === false)
    warn("marketRegime.label", `Reported label "${regime.reportedLabel}" disagrees with the recomputed rule result "${regime.label}".`);
  if (s.marketRegime.allBelow200DaySma !== null && regime.label !== "INDETERMINATE" && s.marketRegime.allBelow200DaySma !== (regime.label === "DEFENSIVE"))
    warn("marketRegime.allBelow200DaySma", "Flag disagrees with the instrument data.");

  // S&P 500 washout inputs.
  const sp = s.washout.sp500;
  checkPct("washout.sp500.pctVsSma200", sp.pctVsSma200, sp.sma200, sp.close);
  checkPct("washout.sp500.pctDrawdownFromClosingPeak", sp.pctDrawdownFromClosingPeak, sp.previousHighestDailyClose, sp.close);
  checkPct("washout.sp500.yearOverYearPriceReturnPct", sp.yearOverYearPriceReturnPct, sp.oneYearAgoClose, sp.close);
  if (sp.rsi14 !== null && (sp.rsi14 < 0 || sp.rsi14 > 100)) warn("washout.sp500.rsi14", "RSI outside 0-100.");
  if (s.club3030.sp500YearOverYearPositive !== null && sp.yearOverYearPriceReturnPct !== null && s.club3030.sp500YearOverYearPositive !== sp.yearOverYearPriceReturnPct > 0)
    warn("club3030.sp500YearOverYearPositive", "Flag disagrees with the S&P 500 year-over-year return.");

  // Breadth arithmetic.
  const b = s.macroAndConfirmation.nasdaqBreadth;
  if (b.new52WeekHighs !== null && b.new52WeekLows !== null && b.newHighMinusNewLow !== null && b.new52WeekHighs - b.new52WeekLows !== b.newHighMinusNewLow)
    warn("macroAndConfirmation.nasdaqBreadth.newHighMinusNewLow", "Does not equal highs minus lows.");

  // Dates.
  if (!isTradingDay(s.snapshot.equityTradingDate))
    warn("snapshot.equityTradingDate", `${s.snapshot.equityTradingDate} is not an NYSE trading day.`);
  s.watchlist.forEach((w) => {
    if (w.closeDate && w.closeDate !== s.snapshot.equityTradingDate)
      warn(`watchlist.${w.symbol}.closeDate`, `Close is dated ${w.closeDate}, snapshot trading date is ${s.snapshot.equityTradingDate}.`);
    if (w.regularSessionClose === null) info(`watchlist.${w.symbol}.regularSessionClose`, "No close in this snapshot.");
  });

  // Blocked signal fields: a value present while still blocked is suppressed in the UI.
  for (const path of s.validation.blockedFromAutomatedTradeSignals) {
    const v = path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), s);
    if (v !== null && v !== undefined) warn(path, "Field is on the blocked-signal list but has a value; the dashboard will not display it as a signal.");
  }
  if (s.club3030.triggered !== null && s.club3030.requiredRuleDefinition === null)
    warn("club3030.triggered", "Trigger value present without a rule definition; suppressed.");

  return { ok: true, snapshot: s, issues };
}

/** True if a field may be shown as a signal: it is not on the blocked list. */
export function isSignalUnblocked(s: Snapshot, path: string): boolean {
  return !s.validation.blockedFromAutomatedTradeSignals.includes(path);
}
