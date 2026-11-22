import type { PublicSnapshot, Snapshot } from "./schema";
import { lastCompletedSession, tradingDaysBetween } from "./calendar";

/**
 * The public homepage projection. MUST match woi_public_projection() in
 * public/api/_lib/store.php (a test compares the two). Used directly only by
 * the development server; production reads /api/public.php.
 */
export function publicProjection(s: Snapshot): PublicSnapshot {
  const keys = new Set<string>();
  s.washout.sp500.dataSources.forEach((k) => keys.add(k));
  if (s.washout.vixSource) keys.add(s.washout.vixSource);
  s.marketRegime.instruments.forEach((i) => i.dataSources.forEach((k) => keys.add(k)));
  s.watchlist.forEach((w) => w.marketDataSource && keys.add(w.marketDataSource));
  return {
    schemaVersion: 1,
    snapshot: {
      equityTradingDate: s.snapshot.equityTradingDate, equitySession: s.snapshot.equitySession, reportDate: s.snapshot.reportDate,
      isLive: s.snapshot.isLive, lastSuccessfulAutomatedRunUtc: s.snapshot.lastSuccessfulAutomatedRunUtc, collectionMethod: s.snapshot.collectionMethod,
    },
    sp500Close: s.washout.sp500.close,
    vixClose: s.washout.vixClose,
    regimeInstruments: s.marketRegime.instruments.map((i) => ({ symbol: i.symbol, closeUsd: i.closeUsd, sma200Usd: i.sma200Usd })),
    watchlist: s.watchlist.map((w) => ({ symbol: w.symbol, company: w.company, regularSessionClose: w.regularSessionClose, oneDayChangePct: w.oneDayChangePct, closeDate: w.closeDate, focus: w.research.focus })),
    sources: [...keys].filter((k) => s.sources[k]).map((k) => ({ key: k, url: s.sources[k].url, description: s.sources[k].description, retrievedDate: s.sources[k].retrievedDate })),
  };
}

export function publicRegime(p: PublicSnapshot): "DEFENSIVE" | "NOT DEFENSIVE" | "INDETERMINATE" {
  const need = ["SPY", "QQQ", "IWM"].map((sym) => p.regimeInstruments.find((i) => i.symbol === sym));
  if (need.some((i) => !i || i.closeUsd === null || i.sma200Usd === null)) return "INDETERMINATE";
  return need.every((i) => i!.closeUsd! < i!.sma200Usd!) ? "DEFENSIVE" : "NOT DEFENSIVE";
}

export function publicMode(p: PublicSnapshot, now = new Date()) {
  const expected = lastCompletedSession(now);
  const d = p.snapshot.equityTradingDate;
  const stale = d < expected && tradingDaysBetween(d, expected) > 0;
  const automated = p.snapshot.lastSuccessfulAutomatedRunUtc !== null;
  const mode = automated && p.snapshot.isLive && !stale ? "LIVE" : automated ? "AUTOMATED" : "SAMPLE";
  return { stale, mode };
}
