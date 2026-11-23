import { z } from "zod";

/** Exchange-style symbols only (e.g. ^GSPC, SPY, BRK.B, DEMO-INDEX). Never interpreted as code. */
export const SYMBOL_RE = /^\^?[A-Z0-9][A-Z0-9.=-]{0,11}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const AssetClassSchema = z.enum(["index", "volatility_index", "etf", "stock"]);
export type AssetClass = z.infer<typeof AssetClassSchema>;

export const VerificationLevelSchema = z.enum([
  "cross_checked",
  "single_source",
  "cross_check_failed",
  "synthetic",
  "user_imported",
]);
export type VerificationLevel = z.infer<typeof VerificationLevelSchema>;

export const SourceSchema = z.object({
  provider: z.string().max(200),
  url: z.string().max(500),
  retrievedAt: z.string().max(40),
  license: z.string().max(1000),
  method: z.string().max(500),
  marketTimezone: z.string().max(60).nullable().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

const Row = z.tuple([z.string().regex(DATE_RE), z.number().positive(), z.number().positive()]);

export const SeriesDocSchema = z.object({
  schemaVersion: z.literal(1),
  symbol: z.string().regex(SYMBOL_RE),
  name: z.string().max(200),
  assetClass: AssetClassSchema,
  tradable: z.boolean(),
  currency: z.string().max(10),
  fields: z.array(z.string().max(20)).max(10),
  priceNotes: z.string().max(1000),
  source: SourceSchema,
  verification: z.object({
    level: VerificationLevelSchema,
    detail: z.string().max(2000),
    crossCheck: z.unknown().nullable(),
  }),
  rows: z.array(Row).min(2).max(60000),
});
export type SeriesDoc = z.infer<typeof SeriesDocSchema>;

export const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  datasetKind: z.enum(["demo", "verified"]),
  label: z.string().max(200),
  builtAt: z.string().max(40),
  lastMarketDate: z.string().regex(DATE_RE),
  isLive: z.literal(false),
  core: z.object({ index: z.string().regex(SYMBOL_RE), vol: z.string().regex(SYMBOL_RE) }),
  series: z
    .array(
      z.object({
        symbol: z.string().regex(SYMBOL_RE),
        name: z.string().max(200),
        role: z.enum(["core_index", "core_vol", "watchlist"]),
        assetClass: AssetClassSchema,
        file: z.string().regex(/^series\/[A-Z0-9_]+\.json$/),
        rows: z.number().int().nonnegative(),
        firstDate: z.string().regex(DATE_RE),
        lastDate: z.string().regex(DATE_RE),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        verificationLevel: VerificationLevelSchema,
      }),
    )
    .max(200),
  validation: z.object({
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
    fetchFailures: z.record(z.string(), z.string()),
  }),
  crossChecks: z.record(z.string(), z.unknown()),
  notes: z.array(z.string()),
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** In-memory, column-oriented series used by every calculation. */
export interface Series {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  tradable: boolean;
  currency: string;
  priceNotes: string;
  source: Source;
  verification: SeriesDoc["verification"];
  dates: string[];
  close: number[];
  adjClose: number[];
}

export type DatasetKind = "demo" | "verified" | "imported";

export interface Dataset {
  kind: DatasetKind;
  label: string;
  builtAt: string;
  lastMarketDate: string;
  index: Series;
  vol: Series | null;
  watchlist: Record<string, Series>;
  manifest: Manifest | null;
  warnings: string[];
}

/** Convert a validated document into column form, enforcing strictly increasing dates. */
export function seriesFromDoc(doc: SeriesDoc): Series {
  const dates: string[] = [];
  const close: number[] = [];
  const adjClose: number[] = [];
  let prev = "";
  for (const [d, c, a] of doc.rows) {
    if (d <= prev) throw new Error(`${doc.symbol}: dates must be strictly increasing (problem at ${d})`);
    prev = d;
    dates.push(d);
    close.push(c);
    adjClose.push(a);
  }
  return {
    symbol: doc.symbol,
    name: doc.name,
    assetClass: doc.assetClass,
    tradable: doc.tradable,
    currency: doc.currency,
    priceNotes: doc.priceNotes,
    source: doc.source,
    verification: doc.verification,
    dates,
    close,
    adjClose,
  };
}
