import { z } from "zod";

/**
 * Data contract for WOI Equity snapshots (schemaVersion 2.x).
 *
 * STRICT: unknown keys are rejected everywhere, every string and list has a
 * size limit, and every link must be http(s). The same schema is exported to
 * JSON Schema (scripts/export-schema.ts) and enforced again on the server
 * (public/api/_lib/validate.php), so the browser is never the only check.
 *
 * Nulls are first-class: a value a source could not supply is null, and
 * nothing in the app replaces it with an estimate.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const isoDateTime = z.string().max(40).regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/, "expected an ISO date or date-time");
/** Only http(s) links: blocks javascript:, data: and other dangerous schemes. */
export const safeUrl = z.string().max(2048).regex(/^https?:\/\/[^\s"'<>\\]+$/, "expected an http(s) URL");
const text = (max: number) => z.string().max(max);
/** Keys used to refer to sources; must start with a letter (rules out __proto__). */
const refKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/, "invalid source key");
const num = z.number();
const nNum = num.nullable();
const nStr = (max = 500) => text(max).nullable();
const nBool = z.boolean().nullable();
const status = text(200).regex(/^[A-Za-z0-9_ .:/()-]*$/, "status codes use letters, digits and _");

export const SOURCE_CATEGORIES = ["market_data", "sec_filing", "earnings", "company_announcement", "market_news", "calendar", "reference"] as const;
export const RESEARCH_TYPES = ["sec_filing", "earnings", "company_announcement", "market_news", "launch", "other"] as const;

export const SourceSchema = z.strictObject({
  url: safeUrl,
  description: text(500),
  retrievedDate: isoDate,
  category: z.enum(SOURCE_CATEGORIES).optional(),
  title: text(300).optional(),
  publishedDate: isoDate.nullable().optional(),
  publisher: text(200).optional(),
});

export const ResearchItemSchema = z.strictObject({
  id: text(80).optional(),
  title: text(300),
  type: z.enum(RESEARCH_TYPES).default("other"),
  date: isoDate.nullable().default(null),
  summary: nStr(2000).default(null),
  sourceRef: refKey.nullable().default(null),
  url: safeUrl.nullable().default(null),
  verificationMethod: text(100).nullable().optional(),
  form: text(40).optional(),
  publishedAt: isoDateTime.nullable().optional(),
  effectiveAt: isoDateTime.nullable().optional(),
  verificationStatus: z.enum(["verified", "unverified", "contradicted"]).optional(),
  /** Exact sentence quoted from the source (automation evidence). Display only. */
  quote: text(600).optional(),
});

const RegimeInstrumentSchema = z.strictObject({
  symbol: text(16),
  closeUsd: nNum,
  sma200Usd: nNum,
  pctVsSma200: nNum,
  sideOfSma200: z.enum(["above", "below", "at"]).nullable(),
  dataSources: z.array(refKey).max(20),
});

const WatchItemSchema = z.strictObject({
  symbol: text(16).regex(/^[A-Z0-9.^-]{1,16}$/, "ticker symbol"),
  company: text(200),
  currency: text(8),
  regularSessionClose: nNum,
  closeDate: isoDate.nullable(),
  oneDayChangePct: nNum,
  marketDataSource: refKey.nullable(),
  technicalIndicators: z.strictObject({
    sma50Usd: nNum,
    sma200Usd: nNum,
    rsi14: nNum,
    sma200Availability: status.nullable().optional(),
    sma200Note: text(1000).optional(),
    method: text(500).optional(),
  }),
  research: z.strictObject({
    status: status,
    focus: z.array(text(200)).max(20),
    verifiedCatalysts: z.array(ResearchItemSchema).max(200),
    verifiedFilings: z.array(ResearchItemSchema).max(200),
    unverifiedClaims: z.array(ResearchItemSchema).max(200),
    summary: nStr(4000),
    asOf: isoDateTime.nullable(),
    /** Bull/bear cases. Always analysis, never data. */
    scenarios: z.strictObject({ bull: nStr(4000), bear: nStr(4000), author: text(200), asOf: isoDateTime.nullable() }).nullable().optional(),
  }),
  listingDate: isoDate.optional(),
  intraday: z.strictObject({ price: num, asOfUtc: isoDateTime, source: refKey }).nullable().optional(),
});

export const SnapshotSchema = z.strictObject({
  schemaVersion: z.string().regex(/^2\.\d{1,3}\.\d{1,3}$/, "dashboard supports schemaVersion 2.x"),
  project: text(200),
  snapshot: z.strictObject({
    reportDate: isoDate,
    equityTradingDate: isoDate,
    equitySession: z.enum(["regular_close", "opening", "intraday", "pre_market"]),
    equityMarketTimezone: text(64),
    displayTimezone: text(64).regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/, "IANA time zone"),
    collectionMethod: status,
    isLive: z.boolean(),
    quality: status,
    lastSuccessfulAutomatedRunUtc: isoDateTime.nullable(),
    snapshotId: z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/).optional(),
    openingSessionDate: isoDate.optional(),
  }),
  marketRegime: z.strictObject({
    name: text(100),
    rule: text(1000),
    instruments: z.array(RegimeInstrumentSchema).max(10),
    allBelow200DaySma: nBool,
    label: z.enum(["DEFENSIVE", "NOT DEFENSIVE"]).nullable(),
    labelType: status,
  }),
  washout: z.strictObject({
    sp500: z.strictObject({
      symbol: text(16),
      close: nNum,
      sma200: nNum,
      pctVsSma200: nNum,
      rsi14: nNum,
      previousHighestDailyClose: nNum,
      pctDrawdownFromClosingPeak: nNum,
      oneYearAgoClose: nNum,
      oneYearComparisonDate: isoDate.nullable(),
      yearOverYearPriceReturnPct: nNum,
      dataSources: z.array(refKey).max(20),
      peakLookbackStart: isoDate.nullable().optional(),
    }),
    vixClose: nNum,
    vixSource: refKey.nullable(),
    fiveDaySigma: nNum,
    fiveDaySigmaStatus: status.nullable().optional(),
    vixCluster: z.union([z.boolean(), z.number(), text(100)]).nullable(),
    vixRealizedStabilizing: nBool,
    score: nNum,
    scoreStatus: status.nullable().optional(),
    interpretation: nStr(1000).optional(),
  }),
  club3030: z.strictObject({
    triggered: nBool,
    status: status,
    isFridayClose: nBool,
    sp500YearOverYearPositive: nBool,
    requiredRuleDefinition: text(4000).nullable(),
    note: nStr(1000).optional(),
  }),
  macroAndConfirmation: z.strictObject({
    nominalUsTreasury2YearYieldPct: nNum,
    nominalYieldSource: refKey.nullable(),
    real2YearYieldThreeMonthChangeBps: nNum,
    real2YearYieldTrend: z.enum(["rising", "falling", "flat"]).nullable(),
    realYieldStatus: status.nullable().optional(),
    nasdaqBreadth: z.strictObject({
      new52WeekHighs: nNum,
      new52WeekLows: nNum,
      newHighMinusNewLow: nNum,
      source: refKey.nullable(),
      confidence: status.nullable().optional(),
      zweigBreadthThrustConfirmed: nBool,
    }),
    bitcoin: z.strictObject({
      symbol: text(16),
      utcCandleDate: isoDate.nullable(),
      dailyCandleCloseUsd: nNum,
      sma100Usd: nNum,
      sma200Usd: nNum,
      vsSma100: nNum,
      vsSma200: nNum,
      smaStatus: status.nullable().optional(),
      source: refKey.nullable(),
      note: text(1000).optional(),
    }),
  }),
  watchlist: z.array(WatchItemSchema).min(1).max(50),
  automationPlan: z.strictObject({
    status: status,
    enabled: z.boolean(),
    equitiesCalendar: status,
    proposedJobs: z.array(z.strictObject({ name: status, time: z.string().regex(/^\d{2}:\d{2}$/), timezone: text(64), days: status, purpose: text(300) })).max(10),
    ingestion: status,
    storage: text(500),
    dashboardRefresh: text(500),
    credentials: status,
  }).optional(),
  validation: z.strictObject({
    noFabricatedNulls: z.boolean(),
    neverOverwriteValidSnapshotWithFailedRun: z.boolean(),
    blockedFromAutomatedTradeSignals: z.array(z.string().regex(/^[A-Za-z0-9.]{1,100}$/)).max(50),
    warnings: z.array(text(1000)).max(100),
  }),
  sources: z.record(refKey, SourceSchema),
});

export type Snapshot = z.infer<typeof SnapshotSchema>;
export type WatchItem = Snapshot["watchlist"][number];
export type RegimeInstrument = Snapshot["marketRegime"]["instruments"][number];
export type Source = z.infer<typeof SourceSchema>;
export type ResearchItem = z.infer<typeof ResearchItemSchema>;

/** Archive manifest */
export const ArchiveEntrySchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_.:-]{1,90}$/),
  path: z.string().regex(/^archive\/[A-Za-z0-9_.-]{1,90}\.json$/),
  equityTradingDate: isoDate,
  equitySession: text(40),
  reportDate: isoDate,
  quality: text(200),
  archivedAtUtc: isoDateTime.nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
});
export const ArchiveManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  updatedAtUtc: isoDateTime.nullable(),
  snapshots: z.array(ArchiveEntrySchema).max(10000),
});
export type ArchiveEntry = z.infer<typeof ArchiveEntrySchema>;
export type ArchiveManifest = z.infer<typeof ArchiveManifestSchema>;

/** Pipeline/update status */
export const RunRecordSchema = z.strictObject({
  job: text(40),
  startedAtUtc: isoDateTime,
  finishedAtUtc: isoDateTime.nullable(),
  result: z.enum(["success", "failed", "skipped"]),
  reason: nStr(1000),
  snapshotId: nStr(90),
  actor: text(40).optional(),
  steps: z.array(z.strictObject({ name: text(80), ok: z.boolean(), detail: nStr(500) })).max(20).default([]),
});
export const PipelineStatusSchema = z.strictObject({
  schemaVersion: z.literal(1),
  automationEnabled: z.boolean(),
  configuredConnections: z.record(z.string().regex(/^[A-Za-z]{2,32}$/), z.boolean()),
  lastRun: RunRecordSchema.nullable(),
  lastSuccessUtc: isoDateTime.nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  recentRuns: z.array(RunRecordSchema).max(200),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;
export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;

/**
 * Public projection: the only market data visible without signing in
 * (homepage). Produced by the server (api/public.php) from the latest snapshot.
 */
export const PublicSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  snapshot: z.strictObject({
    equityTradingDate: isoDate,
    equitySession: text(40),
    reportDate: isoDate,
    isLive: z.boolean(),
    lastSuccessfulAutomatedRunUtc: isoDateTime.nullable(),
    collectionMethod: status,
  }),
  sp500Close: nNum,
  vixClose: nNum,
  regimeInstruments: z.array(z.strictObject({ symbol: text(16), closeUsd: nNum, sma200Usd: nNum })).max(10),
  watchlist: z.array(z.strictObject({
    symbol: text(16), company: text(200), regularSessionClose: nNum, oneDayChangePct: nNum, closeDate: isoDate.nullable(), focus: z.array(text(200)).max(20),
  })).max(50),
  sources: z.array(z.strictObject({ key: refKey, url: safeUrl, description: text(500), retrievedDate: isoDate })).max(100),
});
export type PublicSnapshot = z.infer<typeof PublicSnapshotSchema>;

/** What the server says about the signed-in caller (api/me.php). */
export const MeSchema = z.strictObject({ role: z.enum(["public", "subscriber", "admin"]), subject: nStr(200) });
export type Role = z.infer<typeof MeSchema>["role"];
