import { useEffect, useState } from "react";
import type { Snapshot } from "./schema";
import { validateLoaded, type SourcedEntry, type TerminalState } from "./dataClient";
import { localImportRaw } from "./localImports";
import { getPath } from "./washout";

export type ArchivedSnapshot = { entry: SourcedEntry; snapshot: Snapshot | null; error: string | null };

const cache = new Map<string, Promise<ArchivedSnapshot>>();

function loadEntry(entry: SourcedEntry, data: TerminalState): Promise<ArchivedSnapshot> {
  const key = `${entry.source}|${entry.id}|${entry.sha256 ?? entry.archivedAtUtc ?? ""}`;
  if (!cache.has(key)) {
    const p = (async () => {
      try {
        let raw: unknown;
        if (entry.source === "local") raw = localImportRaw(entry.id);
        else {
          const src = data.sourceById(entry.source);
          if (!src) throw new Error(`Unknown source ${entry.source}`);
          raw = await src.getArchived(entry.path);
        }
        return { entry, snapshot: validateLoaded(raw, { id: entry.source, label: entry.sourceLabel }).snapshot, error: null };
      } catch (e) {
        return { entry, snapshot: null, error: (e as Error).message };
      }
    })();
    cache.set(key, p);
  }
  return cache.get(key)!;
}

/** Archived snapshots (already in chronological order), newest `limit`. */
export function useArchive(data: TerminalState, limit = 60, includeLocal = false) {
  const [items, setItems] = useState<ArchivedSnapshot[] | null>(null);
  const entries = data.archive.filter((e) => includeLocal || e.source !== "local").slice(-limit);
  const sig = entries.map((e) => `${e.source}:${e.id}`).join(",");
  useEffect(() => {
    let live = true;
    Promise.all(entries.map((e) => loadEntry(e, data))).then((r) => live && setItems(r));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return items;
}

/** A real series of archived values for one field. Nulls are skipped, never interpolated. */
export function seriesFrom(items: ArchivedSnapshot[] | null, pick: (s: Snapshot) => unknown) {
  if (!items) return [];
  return items
    .filter((i) => i.snapshot)
    .map((i) => ({ x: i.entry.equityTradingDate, y: pick(i.snapshot!) }))
    .filter((p): p is { x: string; y: number } => typeof p.y === "number");
}

export const pickPath = (path: string) => (s: Snapshot) => getPath(s, path);
export const pickClose = (symbol: string) => (s: Snapshot) => s.watchlist.find((w) => w.symbol === symbol)?.regularSessionClose ?? null;
