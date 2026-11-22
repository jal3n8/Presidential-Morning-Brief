import type { ArchiveEntry, Snapshot } from "./schema";

/**
 * Snapshot identity and chronological order.
 *
 * id: "2026-11-20" for a regular close, "2026-11-23_opening" for other
 * sessions. A snapshot may carry an explicit snapshot.snapshotId, which wins.
 * The id is what makes ingestion idempotent: the same id with the same
 * content is a duplicate, the same id with different content is a conflict.
 */

const SESSION_ORDER: Record<string, number> = { pre_market: 0, opening: 1, intraday: 2, regular_close: 3 };

export function snapshotIdOf(s: Snapshot): string {
  const explicit = (s.snapshot as { snapshotId?: unknown }).snapshotId;
  if (typeof explicit === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(explicit)) return explicit;
  const { equityTradingDate: d, equitySession: sess } = s.snapshot;
  const openingDate = (s.snapshot as { openingSessionDate?: unknown }).openingSessionDate;
  const day = typeof openingDate === "string" && sess !== "regular_close" ? openingDate : d;
  return sess === "regular_close" ? d : `${day}_${sess}`;
}

type Orderable = { date: string; session: string; reportDate: string; runUtc: string | null };

const fromSnapshot = (s: Snapshot): Orderable => ({
  date: s.snapshot.equityTradingDate,
  session: s.snapshot.equitySession,
  reportDate: s.snapshot.reportDate,
  runUtc: s.snapshot.lastSuccessfulAutomatedRunUtc,
});
const fromEntry = (e: ArchiveEntry): Orderable => ({
  date: e.equityTradingDate,
  session: e.equitySession,
  reportDate: e.reportDate,
  runUtc: e.archivedAtUtc,
});

function compareOrderable(a: Orderable, b: Orderable): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const sa = SESSION_ORDER[a.session] ?? 9, sb = SESSION_ORDER[b.session] ?? 9;
  if (sa !== sb) return sa - sb;
  if (a.reportDate !== b.reportDate) return a.reportDate < b.reportDate ? -1 : 1;
  return (a.runUtc ?? "").localeCompare(b.runUtc ?? "");
}

export const compareSnapshots = (a: Snapshot, b: Snapshot) => compareOrderable(fromSnapshot(a), fromSnapshot(b));
export const compareEntries = (a: ArchiveEntry, b: ArchiveEntry) => compareOrderable(fromEntry(a), fromEntry(b));
export const sortEntries = (entries: ArchiveEntry[]) => [...entries].sort(compareEntries);

/** Of several valid snapshots, the chronologically latest one. */
export function newestSnapshot<T extends { snapshot: Snapshot }>(items: T[]): T | null {
  return items.reduce<T | null>((best, x) => (best === null || compareSnapshots(x.snapshot, best.snapshot) > 0 ? x : best), null);
}

export function entryFor(s: Snapshot, path: string, archivedAtUtc: string | null, sha256: string | null): ArchiveEntry & { sha256: string | null } {
  return {
    id: snapshotIdOf(s),
    path,
    equityTradingDate: s.snapshot.equityTradingDate,
    equitySession: s.snapshot.equitySession,
    reportDate: s.snapshot.reportDate,
    quality: s.snapshot.quality,
    archivedAtUtc,
    sha256,
  };
}
