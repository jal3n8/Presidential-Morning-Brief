import type { RegimeInstrument, Snapshot } from "./schema";
import { pctChange, sideOf } from "./indicators";

export type RegimeLabel = "DEFENSIVE" | "NOT DEFENSIVE" | "INDETERMINATE";

export type InstrumentCheck = {
  symbol: string;
  close: number | null;
  sma200: number | null;
  computedPct: number | null;
  reportedPct: number | null;
  side: "above" | "below" | "at" | null;
  sources: string[];
};

export type RegimeResult = {
  label: RegimeLabel;
  belowCount: number;
  missing: string[];
  instruments: InstrumentCheck[];
  reportedLabel: string | null;
  agreesWithReported: boolean | null;
};

const REQUIRED = ["SPY", "QQQ", "IWM"] as const;

/**
 * Three Horsemen rule, recomputed in the browser from close and SMA200:
 * DEFENSIVE if and only if SPY, QQQ and IWM all close below their own
 * same-date 200-session SMA. Any missing input makes the result INDETERMINATE;
 * it never falls back to the reported label.
 */
export function computeThreeHorsemen(s: Snapshot): RegimeResult {
  const bySym = new Map<string, RegimeInstrument>(s.marketRegime.instruments.map((i) => [i.symbol, i]));
  const instruments: InstrumentCheck[] = REQUIRED.map((sym) => {
    const i = bySym.get(sym);
    const close = i?.closeUsd ?? null;
    const sma200 = i?.sma200Usd ?? null;
    return {
      symbol: sym,
      close,
      sma200,
      computedPct: pctChange(sma200, close),
      reportedPct: i?.pctVsSma200 ?? null,
      side: sideOf(close, sma200),
      sources: i?.dataSources ?? [],
    };
  });
  const missing = instruments.filter((i) => i.side === null).map((i) => i.symbol);
  const belowCount = instruments.filter((i) => i.side === "below").length;
  const label: RegimeLabel = missing.length ? "INDETERMINATE" : belowCount === 3 ? "DEFENSIVE" : "NOT DEFENSIVE";
  const reportedLabel = s.marketRegime.label;
  const agreesWithReported =
    reportedLabel === null || label === "INDETERMINATE"
      ? null
      : (reportedLabel === "DEFENSIVE") === (label === "DEFENSIVE");
  return { label, belowCount, missing, instruments, reportedLabel, agreesWithReported };
}
