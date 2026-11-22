import { validateSnapshot, type Issue } from "./validate";
import type { ArchiveManifest, Snapshot } from "./schema";
import { compareSnapshots, entryFor, snapshotIdOf, sortEntries } from "./snapshotOrder";
import { getPath } from "./washout";

/**
 * Pure ingestion planner shared by the command-line ingester (used by the
 * GitHub inbox workflow) and mirrored by the PHP endpoint. It decides what to
 * write; callers do the writing, archive first, latest pointer last.
 */

export type IngestPlan =
  | { action: "reject"; reason: string; issues: Issue[] }
  | { action: "duplicate"; id: string; issues: Issue[] }
  | { action: "conflict"; id: string; reason: string; issues: Issue[] }
  | {
      action: "add" | "replace";
      id: string;
      snapshot: Snapshot;
      archivePath: string;
      manifest: ArchiveManifest;
      /** False when the file is older than the current latest (backfill). */
      updateLatest: boolean;
      issues: Issue[];
    };

export type ExistingState = {
  manifest: ArchiveManifest;
  /** sha256 of each archived file by id, as stored in the manifest. */
  hashes: Record<string, string | null>;
  latest: Snapshot | null;
};

/** Canonical JSON (sorted keys) so formatting changes don't defeat duplicate detection. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

export function planIngest(raw: unknown, hash: string, state: ExistingState, opts: { replace?: boolean; nowUtc: string }): IngestPlan {
  const v = validateSnapshot(raw);
  if (!v.ok) return { action: "reject", reason: "Snapshot failed schema validation.", issues: v.issues };
  const s = v.snapshot;
  // Safety rule: never publish a signal whose rule is still undefined.
  const blocked = s.validation.blockedFromAutomatedTradeSignals.filter((p) => getPath(s, p) !== null && getPath(s, p) !== undefined);
  if (blocked.length || (s.club3030.triggered !== null && s.club3030.requiredRuleDefinition === null))
    return {
      action: "reject",
      reason: "A signal field has a value while its rule is undefined or blocked.",
      issues: [...blocked.map((p) => ({ level: "error" as const, path: p, message: "On the blocked-signal list but not null" })),
        ...(s.club3030.triggered !== null && s.club3030.requiredRuleDefinition === null ? [{ level: "error" as const, path: "club3030.triggered", message: "Needs requiredRuleDefinition" }] : [])],
    };
  const id = snapshotIdOf(s);
  const existing = state.manifest.snapshots.find((e) => e.id === id);

  if (existing) {
    const prevHash = state.hashes[id] ?? null;
    if (prevHash !== null && prevHash === hash) return { action: "duplicate", id, issues: v.issues };
    if (!opts.replace)
      return {
        action: "conflict", id, issues: v.issues,
        reason: `An archived snapshot with id "${id}" already exists with different content. Re-run with replace to supersede it; the old file is kept as a revision.`,
      };
  }

  const archivePath = `archive/${id}.json`;
  const entry = entryFor(s, archivePath, opts.nowUtc, hash);
  const others = state.manifest.snapshots.filter((e) => e.id !== id);
  const manifest: ArchiveManifest = { schemaVersion: 1, updatedAtUtc: opts.nowUtc, snapshots: sortEntries([...others, entry]) };
  const updateLatest = state.latest === null || compareSnapshots(s, state.latest) >= 0;
  return { action: existing ? "replace" : "add", id, snapshot: s, archivePath, manifest, updateLatest, issues: v.issues };
}
