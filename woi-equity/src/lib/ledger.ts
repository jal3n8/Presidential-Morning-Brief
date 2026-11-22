import type { Snapshot, Source, ResearchItem } from "./schema";

export type LedgerCategory =
  | "market_data"
  | "sec_filing"
  | "earnings"
  | "company_announcement"
  | "market_news"
  | "calendar"
  | "reference";

export const CATEGORY_LABEL: Record<LedgerCategory, string> = {
  market_data: "Market data",
  sec_filing: "SEC filing",
  earnings: "Earnings",
  company_announcement: "Company announcement",
  market_news: "Market news",
  calendar: "Exchange calendar",
  reference: "Reference",
};

export type LedgerEntry = {
  key: string;
  kind: "source" | "research";
  category: LedgerCategory;
  title: string;
  url: string | null;
  host: string | null;
  date: string | null;
  retrievedDate: string | null;
  symbols: string[];
  /** Fields in the snapshot that cite this entry. */
  citedBy: string[];
  verification: "verified" | "unverified" | "data_source";
  summary: string | null;
};

const host = (url: string | null) => {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
};

const researchCategory = (t: ResearchItem["type"]): LedgerCategory =>
  t === "sec_filing" ? "sec_filing" : t === "earnings" ? "earnings" : t === "company_announcement" || t === "launch" ? "company_announcement" : t === "market_news" ? "market_news" : "reference";

/**
 * Builds the evidence ledger: every entry in `sources`, annotated with the
 * fields that cite it, plus every research item on the watchlist. Category
 * comes from the entry's own `category` when present; otherwise it is derived
 * from how the snapshot uses it (cited by a market field -> market data).
 */
export function buildLedger(s: Snapshot): LedgerEntry[] {
  const cites = new Map<string, Set<string>>();
  const symbolsFor = new Map<string, Set<string>>();
  const cite = (ref: string | null, field: string, symbol?: string) => {
    if (!ref) return;
    if (!cites.has(ref)) cites.set(ref, new Set());
    cites.get(ref)!.add(field);
    if (symbol) {
      if (!symbolsFor.has(ref)) symbolsFor.set(ref, new Set());
      symbolsFor.get(ref)!.add(symbol);
    }
  };
  s.marketRegime.instruments.forEach((i) => i.dataSources.forEach((r) => cite(r, `Three Horsemen · ${i.symbol}`, i.symbol)));
  s.washout.sp500.dataSources.forEach((r) => cite(r, "Washout · S&P 500", "^GSPC"));
  cite(s.washout.vixSource, "Washout · VIX", "^VIX");
  cite(s.macroAndConfirmation.nominalYieldSource, "Macro · 2Y Treasury");
  cite(s.macroAndConfirmation.nasdaqBreadth.source, "Macro · Nasdaq breadth");
  cite(s.macroAndConfirmation.bitcoin.source, "Macro · Bitcoin", "BTC-USD");
  s.watchlist.forEach((w) => cite(w.marketDataSource, `Watchlist · ${w.symbol} close`, w.symbol));

  const entries: LedgerEntry[] = Object.entries(s.sources).map(([key, src]: [string, Source]) => {
    const citedBy = [...(cites.get(key) ?? [])];
    let category: LedgerCategory = (src.category as LedgerCategory | undefined) ?? (citedBy.length ? "market_data" : "reference");
    if (!src.category && /calendar|hours/i.test(src.description)) category = "calendar";
    if (!src.category && /^spcx_company|_company$/.test(key)) category = "company_announcement";
    const sym = [...(symbolsFor.get(key) ?? [])];
    const keySym = key.split("_")[0].toUpperCase();
    if (!sym.length && s.watchlist.some((w) => w.symbol === keySym)) sym.push(keySym);
    return {
      key, kind: "source", category, title: src.title ?? src.description, url: src.url, host: host(src.url),
      date: src.publishedDate ?? null, retrievedDate: src.retrievedDate, symbols: sym, citedBy,
      verification: "data_source", summary: src.title ? src.description : null,
    };
  });

  s.watchlist.forEach((w) => {
    const add = (items: ResearchItem[], verification: "verified" | "unverified", label: string) =>
      items.forEach((it, n) => {
        const src = it.sourceRef ? s.sources[it.sourceRef] : undefined;
        const url = it.url ?? src?.url ?? null;
        entries.push({
          key: it.id ?? `${w.symbol}-${label}-${n}`, kind: "research", category: researchCategory(it.type),
          title: it.title, url, host: host(url), date: it.date, retrievedDate: src?.retrievedDate ?? null,
          symbols: [w.symbol], citedBy: [`${w.symbol} · ${label}`], verification, summary: it.summary,
        });
      });
    add(w.research.verifiedFilings, "verified", "filing");
    add(w.research.verifiedCatalysts, "verified", "catalyst");
    add(w.research.unverifiedClaims, "unverified", "claim");
  });
  return entries;
}

export function searchLedger(entries: LedgerEntry[], q: string, category: LedgerCategory | "all", symbol: string | "all") {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (category !== "all" && e.category !== category) return false;
    if (symbol !== "all" && !e.symbols.includes(symbol)) return false;
    if (!terms.length) return true;
    const hay = [e.key, e.title, e.host, e.summary, e.date, e.retrievedDate, ...e.symbols, ...e.citedBy, CATEGORY_LABEL[e.category]]
      .filter(Boolean).join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
