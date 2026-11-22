import type { Snapshot } from "./schema";
import { lastCompletedSession, tradingDaysBetween, upcomingRuns } from "./calendar";

export type DataMode = "LIVE" | "AUTOMATED" | "SAMPLE";

export type Freshness = {
  expectedSession: string;
  sessionsBehind: number;
  stale: boolean;
  /** SAMPLE: hand-built baseline. AUTOMATED: written by the pipeline. LIVE: pipeline and flagged live. */
  mode: DataMode;
  headline: string;
  nextRuns: ReturnType<typeof upcomingRuns>;
};

export function freshness(s: Snapshot, now = new Date()): Freshness {
  const expectedSession = lastCompletedSession(now);
  const d = s.snapshot.equityTradingDate;
  const sessionsBehind = d >= expectedSession ? 0 : tradingDaysBetween(d, expectedSession);
  const stale = sessionsBehind > 0;
  const automated = s.snapshot.lastSuccessfulAutomatedRunUtc !== null;
  const mode: DataMode = automated && s.snapshot.isLive && !stale ? "LIVE" : automated ? "AUTOMATED" : "SAMPLE";
  const headline = stale
    ? `${sessionsBehind} completed session${sessionsBehind === 1 ? "" : "s"} newer than this snapshot`
    : "Covers the most recent completed session";
  return { expectedSession, sessionsBehind, stale, mode, headline, nextRuns: upcomingRuns(now) };
}
