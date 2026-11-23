import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { freshness, type Freshness } from "./lib/calendar";
import type { DatasetChoice, StoredImport } from "./lib/data";
import { applyImports, loadDataset } from "./lib/data";
import type { MarketFrame } from "./lib/market";
import { buildMarketFrame } from "./lib/market";
import type { Condition } from "./lib/rules";
import { evaluateCondition } from "./lib/rules";
import type { ScanEvent } from "./lib/scanner";
import { scan } from "./lib/scanner";
import { KEYS, readJson, writeJson } from "./lib/storage";
import type { Dataset } from "./lib/types";
import { DEFAULT_WATCHLIST } from "./lib/watchlist";

interface Analytics {
  frame: MarketFrame;
  condition: Condition;
  events: ScanEvent[];
  fresh: Freshness;
}

interface Ctx {
  status: "loading" | "ready" | "error";
  error: string | null;
  notice: string | null;
  dataset: Dataset | null;
  analytics: Analytics | null;
  choice: DatasetChoice;
  setChoice: (c: DatasetChoice) => void;
  imports: Record<string, StoredImport>;
  saveImport: (key: string, imp: StoredImport) => string | null;
  removeImport: (key: string) => void;
  watchlist: string[];
  setWatchlist: (s: string[]) => void;
  reload: () => void;
}

const DataCtx = createContext<Ctx | null>(null);

export function useData(): Ctx {
  const c = useContext(DataCtx);
  if (!c) throw new Error("useData outside provider");
  return c;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<DatasetChoice>(() => readJson<DatasetChoice>(KEYS.datasetChoice, "auto"));
  const [base, setBase] = useState<Dataset | null>(null);
  const [status, setStatus] = useState<Ctx["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [imports, setImports] = useState<Record<string, StoredImport>>(() => readJson(KEYS.imports, {}));
  const [watchlist, setWatchlistState] = useState<string[]>(() => readJson(KEYS.watchlist, DEFAULT_WATCHLIST));
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    loadDataset(choice)
      .then(({ dataset, notice }) => {
        if (cancelled) return;
        setBase(dataset);
        setNotice(notice);
        setError(null);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [choice, nonce]);

  const dataset = useMemo(() => (base ? applyImports(base, imports) : null), [base, imports]);

  const analytics = useMemo<Analytics | null>(() => {
    if (!dataset) return null;
    const frame = buildMarketFrame(dataset.index, dataset.vol);
    return {
      frame,
      condition: evaluateCondition(frame, frame.dates.length - 1),
      events: scan(frame),
      fresh: freshness(dataset.lastMarketDate, new Date(), dataset.kind),
    };
  }, [dataset]);

  const setChoice = useCallback((c: DatasetChoice) => {
    writeJson(KEYS.datasetChoice, c);
    setChoiceState(c);
  }, []);

  const saveImport = useCallback((key: string, imp: StoredImport) => {
    const next = { ...imports, [key]: imp };
    const r = writeJson(KEYS.imports, next);
    setImports(next);
    return r.ok ? null : `Imported for this session only - browser storage refused it (${r.error}).`;
  }, [imports]);

  const removeImport = useCallback((key: string) => {
    const next = { ...imports };
    delete next[key];
    writeJson(KEYS.imports, next);
    setImports(next);
  }, [imports]);

  const setWatchlist = useCallback((s: string[]) => {
    writeJson(KEYS.watchlist, s);
    setWatchlistState(s);
  }, []);

  const value: Ctx = {
    status, error, notice, dataset, analytics, choice, setChoice, imports, saveImport, removeImport,
    watchlist, setWatchlist, reload: () => setNonce((n) => n + 1),
  };
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}
