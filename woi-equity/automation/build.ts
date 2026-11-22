/**
 * Builds the next snapshot from the previous one plus real daily price
 * series. Every value is either computed from a dated observation on the
 * exact session date or left null with a reason. Nothing is carried forward
 * from an older session and presented as current.
 */
import type { Snapshot, ResearchItem } from "../src/lib/schema";
import { sma, rsiWilder, pctChange, sideOf, round } from "../src/lib/indicators";
import { weekday, sessionsInclusive } from "../src/lib/calendar";

export type Bar = { date: string; close: number };

export type MarketInputs = {
  /** The completed NYSE session the closes belong to. */
  sessionDate: string;
  /** Daily closes, oldest first. BTC-USD uses UTC calendar-day candles. */
  series: Partial<Record<string, Bar[]>>;
  /** Official 2-year par yield for sessionDate, if fetched. */
  treasury2y: { date: string; pct: number; url: string } | null;
  provider: { name: string; sourceUrl: (symbol: string) => string; method: string };
};

export type ResearchInputs = Partial<Record<string, {
  verifiedCatalysts: ResearchItem[];
  verifiedFilings: ResearchItem[];
  unverifiedClaims: ResearchItem[];
  summary: string | null;
  asOf: string;
  sources: Record<string, { url: string; description: string; retrievedDate: string; category?: string; title?: string; publishedDate?: string | null }>;
}>>;

export type BuildOptions = { job: "opening_snapshot" | "closing_snapshot"; nowUtc: string; todayET: string; connections: string[] };

const r2 = (x: number | null) => (x === null ? null : round(x, 2));

function upTo(bars: Bar[] | undefined, date: string): Bar[] {
  return (bars ?? []).filter((b) => b.date <= date && Number.isFinite(b.close));
}
/** Close on exactly `date`, plus the closes up to it. Null close if that day is missing. */
function at(bars: Bar[] | undefined, date: string) {
  const s = upTo(bars, date);
  const last = s.at(-1);
  const close = last && last.date === date ? last.close : null;
  const closes = s.map((b) => b.close);
  const prev = close !== null && s.length >= 2 ? s[s.length - 2].close : null;
  return { close, closes: close === null ? [] : closes, prev, bars: s };
}
function oneYearBefore(bars: Bar[], date: string) {
  const target = `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;
  const s = bars.filter((b) => b.date <= target);
  return s.at(-1) ?? null;
}

export function buildSnapshot(prev: Snapshot, m: MarketInputs, research: ResearchInputs, o: BuildOptions): Snapshot {
  const s: Snapshot = structuredClone(prev);
  const d = m.sessionDate;
  const warnings: string[] = [];
  const srcKey = (sym: string) => `auto_${sym.replace(/[^A-Za-z0-9]/g, "").toLowerCase()}`;
  const addSource = (sym: string, description: string) => {
    s.sources[srcKey(sym)] = { url: m.provider.sourceUrl(sym), description, retrievedDate: o.todayET, category: "market_data" };
    return srcKey(sym);
  };

  // Snapshot metadata
  s.snapshot = {
    ...s.snapshot,
    reportDate: o.todayET,
    equityTradingDate: d,
    equitySession: o.job === "closing_snapshot" ? "regular_close" : "opening",
    collectionMethod: `automated_pipeline_${m.provider.name}`,
    isLive: false,
    lastSuccessfulAutomatedRunUtc: o.nowUtc,
  };
  if (o.job === "opening_snapshot") (s.snapshot as Record<string, unknown>).openingSessionDate = o.todayET;
  else delete (s.snapshot as Record<string, unknown>).openingSessionDate;

  // Three Horsemen
  s.marketRegime.instruments = ["SPY", "QQQ", "IWM"].map((sym) => {
    const x = at(m.series[sym], d);
    const avg = x.closes.length >= 200 ? sma(x.closes, 200) : null;
    if (x.close === null) warnings.push(`${sym}: no close for ${d} from ${m.provider.name}.`);
    else if (avg === null) warnings.push(`${sym}: fewer than 200 sessions returned; SMA200 not computed.`);
    return {
      symbol: sym, closeUsd: r2(x.close), sma200Usd: r2(avg), pctVsSma200: r2(pctChange(avg, x.close)),
      sideOfSma200: sideOf(x.close, avg), dataSources: [addSource(sym, `${sym} daily closes (${m.provider.method})`)],
    };
  });
  const sides = s.marketRegime.instruments.map((i) => i.sideOfSma200);
  s.marketRegime.allBelow200DaySma = sides.includes(null) ? null : sides.every((x) => x === "below");
  s.marketRegime.label = s.marketRegime.allBelow200DaySma === null ? null : s.marketRegime.allBelow200DaySma ? "DEFENSIVE" : "NOT DEFENSIVE";

  // S&P 500 washout inputs
  const spx = at(m.series["^GSPC"], d);
  const spxAvg = spx.closes.length >= 200 ? sma(spx.closes, 200) : null;
  const priorPeak = spx.close !== null && spx.closes.length >= 2 ? Math.max(...spx.closes.slice(0, -1)) : null;
  const yearAgo = spx.close !== null ? oneYearBefore(spx.bars, d) : null;
  const spxKey = addSource("^GSPC", `S&P 500 index daily closes (${m.provider.method})`);
  s.washout.sp500 = {
    ...s.washout.sp500,
    close: r2(spx.close), sma200: r2(spxAvg), pctVsSma200: r2(pctChange(spxAvg, spx.close)),
    rsi14: spx.closes.length >= 100 ? r2(rsiWilder(spx.closes, 14)) : null,
    previousHighestDailyClose: r2(priorPeak),
    pctDrawdownFromClosingPeak: r2(priorPeak === null ? null : pctChange(Math.max(priorPeak, spx.close!), spx.close)),
    oneYearAgoClose: r2(yearAgo?.close ?? null), oneYearComparisonDate: yearAgo?.date ?? null,
    yearOverYearPriceReturnPct: r2(pctChange(yearAgo?.close ?? null, spx.close)),
    dataSources: [spxKey],
    peakLookbackStart: spx.bars[0]?.date ?? null,
  };
  if (spx.close === null) warnings.push(`^GSPC: no close for ${d}.`);
  const vix = at(m.series["^VIX"], d);
  s.washout.vixClose = r2(vix.close);
  s.washout.vixSource = addSource("^VIX", "Cboe VIX daily closes");
  // Undefined measures stay null until their formulas are published.
  s.washout.fiveDaySigma = null;
  s.washout.vixCluster = null;
  s.washout.vixRealizedStabilizing = null;
  s.washout.score = null;

  // Club 30/30 inputs only; trigger stays null until a rule exists.
  s.club3030.isFridayClose = weekday(d) === 5;
  s.club3030.sp500YearOverYearPositive = s.washout.sp500.yearOverYearPriceReturnPct === null ? null : s.washout.sp500.yearOverYearPriceReturnPct > 0;
  if (s.club3030.requiredRuleDefinition === null) s.club3030.triggered = null;

  // Macro
  const mc = s.macroAndConfirmation;
  if (m.treasury2y && m.treasury2y.date === d) {
    mc.nominalUsTreasury2YearYieldPct = m.treasury2y.pct;
    s.sources.ust = { url: m.treasury2y.url, description: `US Treasury official 2-year par yield, ${d}`, retrievedDate: o.todayET, category: "market_data" };
    mc.nominalYieldSource = "ust";
  } else {
    mc.nominalUsTreasury2YearYieldPct = null;
    mc.nominalYieldSource = null;
    warnings.push(`2-year Treasury yield for ${d} not available.`);
  }
  // No automated breadth source is configured: old figures are not carried forward.
  mc.nasdaqBreadth = { ...mc.nasdaqBreadth, new52WeekHighs: null, new52WeekLows: null, newHighMinusNewLow: null, source: null, confidence: "no_automated_source_configured", zweigBreadthThrustConfirmed: null };
  const btc = at(m.series["BTC-USD"], d);
  const b100 = btc.closes.length >= 100 ? sma(btc.closes, 100) : null;
  const b200 = btc.closes.length >= 200 ? sma(btc.closes, 200) : null;
  mc.bitcoin = {
    ...mc.bitcoin,
    utcCandleDate: btc.close === null ? null : d, dailyCandleCloseUsd: r2(btc.close),
    sma100Usd: r2(b100), sma200Usd: r2(b200), vsSma100: r2(pctChange(b100, btc.close)), vsSma200: r2(pctChange(b200, btc.close)),
    smaStatus: `computed_from_${m.provider.name}_utc_daily_candles`, source: addSource("BTC-USD", "BTC-USD UTC daily candles"),
    note: "BTC is a UTC-calendar-day close, not an equity 4 p.m. ET close. Values vs SMA are percentages.",
  };

  // Watchlist
  s.watchlist = s.watchlist.map((w) => {
    const x = at(m.series[w.symbol], d);
    const sessions = w.listingDate ? sessionsInclusive(w.listingDate, d) : null;
    const enough200 = x.closes.length >= 200 && (sessions === null || sessions >= 200);
    if (x.close === null) warnings.push(`${w.symbol}: no close for ${d}.`);
    const r = research[w.symbol];
    if (r) Object.assign(s.sources, r.sources);
    return {
      ...w,
      regularSessionClose: r2(x.close),
      closeDate: x.close === null ? null : d,
      oneDayChangePct: r2(pctChange(x.prev, x.close)),
      marketDataSource: addSource(w.symbol, `${w.symbol} daily closes (${m.provider.method})`),
      technicalIndicators: {
        ...w.technicalIndicators,
        sma50Usd: r2(x.closes.length >= 50 ? sma(x.closes, 50) : null),
        sma200Usd: r2(enough200 ? sma(x.closes, 200) : null),
        rsi14: r2(x.closes.length >= 100 ? rsiWilder(x.closes, 14) : null),
        sma200Availability: enough200 ? "computed" : sessions !== null && sessions < 200 ? "insufficient_public_trading_history" : "insufficient_series_from_provider",
        method: `SMA = simple mean of completed sessions; RSI = Wilder 14; ${m.provider.method}`,
      },
      research: r ? { ...w.research, status: "researched", verifiedCatalysts: r.verifiedCatalysts, verifiedFilings: r.verifiedFilings, unverifiedClaims: r.unverifiedClaims, summary: r.summary, asOf: r.asOf } : w.research,
    };
  });

  s.snapshot.quality = warnings.length ? "automated_with_missing_values" : "automated";
  s.validation = { ...s.validation, noFabricatedNulls: true, neverOverwriteValidSnapshotWithFailedRun: true, warnings };
  return s;
}
