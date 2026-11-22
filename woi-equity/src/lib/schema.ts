import { z } from "zod";

/**
 * Data contract for WOI Equity snapshots (schemaVersion 2.x).
 *
 * Shared by the dashboard (validates what it fetches) and the automation
 * pipeline (validates what it is about to publish). Nulls are first-class:
 * every value that a source may fail to supply is `.nullable()`, and nothing
 * in the app replaces a null with an estimate.
 *
 * Unknown keys are kept (`passthrough`) so a newer pipeline can add fields
 * without the dashboard discarding them.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const num = z.number().finite();
const nNum = num.nullable();
const nStr = z.string().nullable();
const nBool = z.boolean().nullable();

export const SourceSchema = z
  .object({
    url: z.string().url(),
    description: z.string(),
    retrievedDate: isoDate,
    /** Optional richer metadata the research pipeline may add. */
    category: z
      .enum(["market_data", "sec_filing", "earnings", "company_announcement", "market_news", "calendar", "reference"])
      .optional(),
    title: z.string().optional(),
    publishedDate: isoDate.nullable().optional(),
    publisher: z.string().optional(),
  })
  .passthrough();

export const ResearchItemSchema = z
  .object({
    id: z.string().optional(),
    title: z.string(),
    type: z
      .enum(["sec_filing", "earnings", "company_announcement", "market_news", "launch", "other"])
      .default("other"),
    date: isoDate.nullable().default(null),
    summary: nStr.default(null),
    /** Key into snapshot.sources, preferred. */
    sourceRef: nStr.default(null),
    /** Direct URL when there is no sources entry. */
    url: z.string().url().nullable().default(null),
    /** How the item was checked, e.g. "sec_edgar_api", "quoted_text_found_on_primary_source". */
    verificationMethod: nStr.optional(),
    /** For filings: form type such as 10-Q, 8-K. */
    form: z.string().optional(),
    /** When the source published it (ISO date or date-time). */
    publishedAt: z.string().nullable().optional(),
    /** When the event itself happens or happened (ISO date or date-time). */
    effectiveAt: z.string().nullable().optional(),
    verificationStatus: z.enum(["verified", "unverified", "contradicted"]).optional(),
  })
  .passthrough();

const RegimeInstrumentSchema = z
  .object({
    symbol: z.string(),
    closeUsd: nNum,
    sma200Usd: nNum,
    pctVsSma200: nNum,
    sideOfSma200: z.enum(["above", "below", "at"]).nullable(),
    dataSources: z.array(z.string()),
  })
  .passthrough();

const WatchItemSchema = z
  .object({
    symbol: z.string(),
    company: z.string(),
    currency: z.string(),
    regularSessionClose: nNum,
    closeDate: isoDate.nullable(),
    oneDayChangePct: nNum,
    marketDataSource: nStr,
    technicalIndicators: z
      .object({
        sma50Usd: nNum,
        sma200Usd: nNum,
        rsi14: nNum,
        sma200Availability: nStr.optional(),
        sma200Note: z.string().optional(),
        method: z.string().optional(),
      })
      .passthrough(),
    research: z
      .object({
        status: z.string(),
        focus: z.array(z.string()),
        verifiedCatalysts: z.array(ResearchItemSchema),
        verifiedFilings: z.array(ResearchItemSchema),
        unverifiedClaims: z.array(ResearchItemSchema),
        summary: nStr,
        asOf: nStr,
        /** Bull/bear cases. Always analysis, never data. */
        scenarios: z
          .object({ bull: nStr, bear: nStr, author: z.string(), asOf: nStr })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough(),
    listingDate: isoDate.optional(),
    /** Written by the opening job: a dated, sourced intraday price. */
    intraday: z
      .object({ price: num, asOfUtc: z.string(), source: z.string() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export const SnapshotSchema = z
  .object({
    schemaVersion: z.string().regex(/^2\.\d+\.\d+$/, "dashboard supports schemaVersion 2.x"),
    project: z.string(),
    snapshot: z
      .object({
        reportDate: isoDate,
        equityTradingDate: isoDate,
        equitySession: z.enum(["regular_close", "opening", "intraday", "pre_market"]).or(z.string()),
        equityMarketTimezone: z.string(),
        displayTimezone: z.string(),
        collectionMethod: z.string(),
        isLive: z.boolean(),
        quality: z.string(),
        lastSuccessfulAutomatedRunUtc: nStr,
      })
      .passthrough(),
    marketRegime: z
      .object({
        name: z.string(),
        rule: z.string(),
        instruments: z.array(RegimeInstrumentSchema),
        allBelow200DaySma: nBool,
        label: nStr,
        labelType: z.string(),
      })
      .passthrough(),
    washout: z
      .object({
        sp500: z
          .object({
            symbol: z.string(),
            close: nNum,
            sma200: nNum,
            pctVsSma200: nNum,
            rsi14: nNum,
            previousHighestDailyClose: nNum,
            pctDrawdownFromClosingPeak: nNum,
            oneYearAgoClose: nNum,
            oneYearComparisonDate: isoDate.nullable(),
            yearOverYearPriceReturnPct: nNum,
            dataSources: z.array(z.string()),
          })
          .passthrough(),
        vixClose: nNum,
        vixSource: nStr,
        fiveDaySigma: nNum,
        fiveDaySigmaStatus: nStr.optional(),
        vixCluster: z.union([z.boolean(), z.number(), z.string()]).nullable(),
        vixRealizedStabilizing: nBool,
        score: nNum,
        scoreStatus: nStr.optional(),
        interpretation: nStr.optional(),
      })
      .passthrough(),
    club3030: z
      .object({
        triggered: nBool,
        status: z.string(),
        isFridayClose: nBool,
        sp500YearOverYearPositive: nBool,
        requiredRuleDefinition: z.union([z.string(), z.record(z.unknown())]).nullable(),
        note: nStr.optional(),
      })
      .passthrough(),
    macroAndConfirmation: z
      .object({
        nominalUsTreasury2YearYieldPct: nNum,
        nominalYieldSource: nStr,
        real2YearYieldThreeMonthChangeBps: nNum,
        real2YearYieldTrend: nStr,
        realYieldStatus: nStr.optional(),
        nasdaqBreadth: z
          .object({
            new52WeekHighs: nNum,
            new52WeekLows: nNum,
            newHighMinusNewLow: nNum,
            source: nStr,
            confidence: nStr.optional(),
            zweigBreadthThrustConfirmed: nBool,
          })
          .passthrough(),
        bitcoin: z
          .object({
            symbol: z.string(),
            utcCandleDate: isoDate.nullable(),
            dailyCandleCloseUsd: nNum,
            sma100Usd: nNum,
            sma200Usd: nNum,
            vsSma100: z.union([z.number(), z.string()]).nullable(),
            vsSma200: z.union([z.number(), z.string()]).nullable(),
            smaStatus: nStr.optional(),
            source: nStr,
            note: z.string().optional(),
          })
          .passthrough(),
      })
      .passthrough(),
    watchlist: z.array(WatchItemSchema).min(1),
    automationPlan: z.record(z.unknown()).optional(),
    validation: z
      .object({
        noFabricatedNulls: z.boolean(),
        neverOverwriteValidSnapshotWithFailedRun: z.boolean(),
        blockedFromAutomatedTradeSignals: z.array(z.string()),
        warnings: z.array(z.string()),
      })
      .passthrough(),
    sources: z.record(SourceSchema),
  })
  .passthrough();

export type Snapshot = z.infer<typeof SnapshotSchema>;
export type WatchItem = Snapshot["watchlist"][number];
export type RegimeInstrument = Snapshot["marketRegime"]["instruments"][number];
export type Source = z.infer<typeof SourceSchema>;
export type ResearchItem = z.infer<typeof ResearchItemSchema>;

/** Archive manifest: public/data/archive/index.json */
export const ArchiveEntrySchema = z.object({
  id: z.string(),
  path: z.string(),
  equityTradingDate: isoDate,
  equitySession: z.string(),
  reportDate: isoDate,
  quality: z.string(),
  archivedAtUtc: nStr,
  sha256: nStr.optional(),
});
export const ArchiveManifestSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAtUtc: nStr,
  snapshots: z.array(ArchiveEntrySchema),
});
export type ArchiveEntry = z.infer<typeof ArchiveEntrySchema>;
export type ArchiveManifest = z.infer<typeof ArchiveManifestSchema>;

/** Pipeline run status: public/data/status.json */
export const RunRecordSchema = z.object({
  job: z.string(),
  startedAtUtc: z.string(),
  finishedAtUtc: nStr,
  result: z.enum(["success", "failed", "skipped"]),
  reason: nStr,
  snapshotId: nStr,
  steps: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: nStr })).default([]),
});
export const PipelineStatusSchema = z.object({
  schemaVersion: z.literal(1),
  automationEnabled: z.boolean(),
  configuredConnections: z.record(z.boolean()),
  lastRun: RunRecordSchema.nullable(),
  lastSuccessUtc: nStr,
  consecutiveFailures: z.number().int().nonnegative(),
  recentRuns: z.array(RunRecordSchema),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;
export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;
