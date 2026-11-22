import { useCallback, useEffect, useRef, useState } from "react";
import { validateSnapshot, type Issue } from "./validate";
import { ArchiveManifestSchema, PipelineStatusSchema, type ArchiveEntry, type PipelineStatus, type Snapshot } from "./schema";
import { configuredSources, NotFound, type DataSource } from "./dataSource";
import { compareEntries, newestSnapshot, snapshotIdOf } from "./snapshotOrder";
import { loadLocalImports } from "./localImports";

export const POLL_MS = Number(import.meta.env.VITE_POLL_SECONDS ?? 300) * 1000;
const AUTO_KEY = "woi.autoRefresh";

export type LoadedSnapshot = {
  snapshot: Snapshot;
  issues: Issue[];
  raw: unknown;
  fetchedAt: Date;
  sourceId: string;
  sourceLabel: string;
};

export type SourceReport = { id: string; label: string; state: "ok" | "absent" | "invalid" | "error"; detail: string | null; issues: Issue[] };

export type SourcedEntry = ArchiveEntry & { source: string; sourceLabel: string };

export function validateLoaded(raw: unknown, src: { id: string; label: string }): LoadedSnapshot {
  const v = validateSnapshot(raw);
  if (!v.ok) {
    const err = new Error("Snapshot failed validation") as Error & { issues?: Issue[] };
    err.issues = v.issues;
    throw err;
  }
  return { snapshot: v.snapshot, issues: v.issues, raw, fetchedAt: new Date(), sourceId: src.id, sourceLabel: src.label };
}

async function loadFrom(src: DataSource): Promise<{ loaded: LoadedSnapshot | null; report: SourceReport }> {
  try {
    const loaded = validateLoaded(await src.getLatest(), src);
    return { loaded, report: { id: src.id, label: src.label, state: "ok", detail: null, issues: loaded.issues } };
  } catch (e) {
    const err = e as Error & { issues?: Issue[] };
    if (e instanceof NotFound) return { loaded: null, report: { id: src.id, label: src.label, state: "absent", detail: "No latest snapshot published here yet", issues: [] } };
    return { loaded: null, report: { id: src.id, label: src.label, state: err.issues ? "invalid" : "error", detail: err.message, issues: err.issues ?? [] } };
  }
}

async function manifestFrom(src: DataSource): Promise<SourcedEntry[]> {
  try {
    const m = ArchiveManifestSchema.safeParse(await src.getManifest());
    return m.success ? m.data.snapshots.map((e) => ({ ...e, source: src.id, sourceLabel: src.label })) : [];
  } catch {
    return [];
  }
}

async function statusFrom(srcs: DataSource[]): Promise<PipelineStatus | null> {
  for (const s of srcs) {
    try {
      const r = PipelineStatusSchema.safeParse(await s.getStatus());
      if (r.success) return r.data;
    } catch { /* try next */ }
  }
  return null;
}

/** Merge archives; when two sources hold the same id, the higher-priority source wins. */
export function mergeEntries(lists: SourcedEntry[][]): SourcedEntry[] {
  const seen = new Map<string, SourcedEntry>();
  for (const list of lists) for (const e of list) if (!seen.has(e.id)) seen.set(e.id, e);
  return [...seen.values()].sort(compareEntries);
}

export type TerminalState = {
  current: LoadedSnapshot | null;
  sources: SourceReport[];
  lastError: { message: string; issues: Issue[]; at: Date } | null;
  loading: boolean;
  archive: SourcedEntry[];
  status: PipelineStatus | null;
  updatedAt: Date | null;
  lastCheckedAt: Date | null;
  autoRefresh: boolean;
  setAutoRefresh: (on: boolean) => void;
  refresh: () => void;
  sourceById: (id: string) => DataSource | undefined;
};

const readAuto = () => {
  try { return window.localStorage.getItem(AUTO_KEY) !== "off"; } catch { return true; }
};

/**
 * Loads every configured source, shows the newest valid snapshot, and polls.
 * A failed or invalid fetch never replaces what is on screen.
 */
export function useTerminalData(): TerminalState {
  const sourcesRef = useRef<DataSource[]>(configuredSources());
  const [current, setCurrent] = useState<LoadedSnapshot | null>(null);
  const [sources, setSources] = useState<SourceReport[]>([]);
  const [lastError, setLastError] = useState<TerminalState["lastError"]>(null);
  const [loading, setLoading] = useState(true);
  const [archive, setArchive] = useState<SourcedEntry[]>([]);
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [autoRefresh, setAuto] = useState(readAuto);
  const idRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const srcs = sourcesRef.current;
    const results = await Promise.all(srcs.map(loadFrom));
    setSources(results.map((r) => r.report));
    const valid = results.map((r) => r.loaded).filter((x): x is LoadedSnapshot => x !== null);
    const best = newestSnapshot(valid);
    if (best) {
      const id = `${best.sourceId}:${snapshotIdOf(best.snapshot)}:${best.snapshot.snapshot.reportDate}:${best.snapshot.snapshot.lastSuccessfulAutomatedRunUtc ?? ""}`;
      if (idRef.current !== null && idRef.current !== id) setUpdatedAt(new Date());
      idRef.current = id;
      setCurrent(best);
      setLastError(null);
    } else {
      const bad = results.find((r) => r.report.state === "invalid" || r.report.state === "error")?.report;
      setLastError({ message: bad?.detail ?? "No source returned a snapshot", issues: bad?.issues ?? [], at: new Date() });
    }
    setLoading(false);
    setLastCheckedAt(new Date());
    const [lists, st] = await Promise.all([Promise.all(srcs.map(manifestFrom)), statusFrom(srcs)]);
    setArchive(mergeEntries([...lists, loadLocalImports().map((x) => x.entry)]));
    setStatus(st);
  }, []);

  useEffect(() => {
    void refresh();
    if (!autoRefresh) return;
    const t = window.setInterval(() => void refresh(), POLL_MS);
    const onVis = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh, autoRefresh]);

  const setAutoRefresh = (on: boolean) => {
    setAuto(on);
    try { window.localStorage.setItem(AUTO_KEY, on ? "on" : "off"); } catch { /* per-visit only */ }
  };

  return {
    current, sources, lastError, loading, archive, status, updatedAt, lastCheckedAt, autoRefresh, setAutoRefresh,
    refresh: () => void refresh(),
    sourceById: (id) => sourcesRef.current.find((s) => s.id === id),
  };
}
