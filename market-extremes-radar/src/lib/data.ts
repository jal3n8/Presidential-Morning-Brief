import type { Dataset, Manifest, Series, SeriesDoc } from "./types";
import { ManifestSchema, SeriesDocSchema, seriesFromDoc } from "./types";

export type DatasetChoice = "auto" | "verified" | "demo";
export type ImportRole = "core_index" | "core_vol" | "watchlist";
export interface StoredImport {
  role: ImportRole;
  doc: SeriesDoc;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class DataLoadError extends Error {}

async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const h = await globalThis.crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

async function getJson(fetchFn: FetchFn, url: string): Promise<{ json: unknown; bytes: ArrayBuffer }> {
  const res = await fetchFn(url, { cache: "no-cache" });
  if (!res.ok) throw new DataLoadError(`${url}: HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  try {
    return { json: JSON.parse(new TextDecoder().decode(bytes)), bytes };
  } catch {
    throw new DataLoadError(`${url}: not valid JSON`);
  }
}

/** Load and fully validate one static dataset (data/<kind>/manifest.json + series files). */
export async function loadStaticDataset(kind: "verified" | "demo", fetchFn: FetchFn = fetch, base = "data"): Promise<Dataset> {
  const root = `${base}/${kind}`;
  const { json } = await getJson(fetchFn, `${root}/manifest.json`);
  const parsed = ManifestSchema.safeParse(json);
  if (!parsed.success) throw new DataLoadError(`${root}/manifest.json failed validation: ${parsed.error.issues[0]?.message}`);
  const manifest: Manifest = parsed.data;
  if (manifest.datasetKind !== kind) throw new DataLoadError(`${root}: manifest says "${manifest.datasetKind}", expected "${kind}"`);

  const warnings: string[] = [];
  const bySymbol: Record<string, Series> = {};
  for (const entry of manifest.series) {
    const { json: sj, bytes } = await getJson(fetchFn, `${root}/${entry.file}`);
    const digest = await sha256Hex(bytes);
    if (digest === null) warnings.push(`Checksum not verified for ${entry.symbol} (browser crypto unavailable).`);
    else if (digest !== entry.sha256) throw new DataLoadError(`${entry.symbol}: checksum mismatch - file changed after the manifest was built.`);
    const doc = SeriesDocSchema.safeParse(sj);
    if (!doc.success) throw new DataLoadError(`${entry.file} failed validation: ${doc.error.issues[0]?.message}`);
    if (doc.data.symbol !== entry.symbol) throw new DataLoadError(`${entry.file}: symbol mismatch`);
    if (kind === "demo" && doc.data.verification.level !== "synthetic") throw new DataLoadError(`${entry.file}: demo series must be labelled synthetic`);
    bySymbol[entry.symbol] = seriesFromDoc(doc.data);
  }
  const index = bySymbol[manifest.core.index];
  if (!index) throw new DataLoadError("Core index series missing");
  const vol = bySymbol[manifest.core.vol] ?? null;
  if (!vol) warnings.push("Volatility series missing: VIX-based rules show as unavailable.");
  const watchlist: Record<string, Series> = {};
  for (const e of manifest.series) if (e.role === "watchlist" && bySymbol[e.symbol]) watchlist[e.symbol] = bySymbol[e.symbol];
  return {
    kind,
    label: manifest.label,
    builtAt: manifest.builtAt,
    lastMarketDate: index.dates[index.dates.length - 1],
    index,
    vol,
    watchlist,
    manifest,
    warnings: [...warnings, ...manifest.validation.warnings.slice(0, 20)],
  };
}

/** Choose a dataset: "auto" prefers the verified build and falls back to the labelled demo. */
export async function loadDataset(choice: DatasetChoice, fetchFn: FetchFn = fetch): Promise<{ dataset: Dataset; notice: string | null }> {
  if (choice === "demo") return { dataset: await loadStaticDataset("demo", fetchFn), notice: null };
  try {
    return { dataset: await loadStaticDataset("verified", fetchFn), notice: null };
  } catch (e) {
    if (choice === "verified") throw e;
    const reason = e instanceof Error ? e.message : String(e);
    return {
      dataset: await loadStaticDataset("demo", fetchFn),
      notice: `Verified data not available (${reason}). Showing the synthetic DEMO dataset.`,
    };
  }
}

/** Overlay validated user imports. Importing a core series turns the whole dataset into "imported". */
export function applyImports(base: Dataset, imports: Record<string, StoredImport>): Dataset {
  const ds: Dataset = { ...base, watchlist: { ...base.watchlist }, warnings: [...base.warnings] };
  for (const [key, imp] of Object.entries(imports)) {
    const parsed = SeriesDocSchema.safeParse(imp.doc);
    if (!parsed.success) {
      ds.warnings.push(`Stored import ${key} is invalid and was ignored.`);
      continue;
    }
    const s = seriesFromDoc(parsed.data);
    if (imp.role === "watchlist") ds.watchlist[s.symbol] = s;
    else if (imp.role === "core_index") ds.index = s;
    else ds.vol = s;
  }
  if (Object.values(imports).some((i) => i.role !== "watchlist")) {
    ds.kind = "imported";
    ds.label = "User-imported data (unverified by WOI)";
    ds.lastMarketDate = ds.index.dates[ds.index.dates.length - 1];
  }
  return ds;
}
