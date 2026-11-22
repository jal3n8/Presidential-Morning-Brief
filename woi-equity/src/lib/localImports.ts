import type { Snapshot } from "./schema";
import { entryFor, snapshotIdOf } from "./snapshotOrder";
import { canonicalJson } from "./ingestCore";
import type { SourcedEntry } from "./dataClient";

/**
 * Snapshots imported by hand in this browser. They are a private scratch
 * archive for checking a file before publishing it; nobody else sees them,
 * and clearing site data removes them.
 */

const KEY = "woi.localImports.v1";

export type LocalImport = { entry: SourcedEntry; raw: unknown; fileName: string; importedAtUtc: string };

export function loadLocalImports(): LocalImport[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as LocalImport[]) : [];
    return Array.isArray(list) ? list.filter((x) => x && x.entry && x.raw) : [];
  } catch {
    return [];
  }
}

function save(list: LocalImport[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function addLocalImport(s: Snapshot, raw: unknown, fileName: string): { ok: boolean; duplicate: boolean; id: string } {
  const id = `local:${snapshotIdOf(s)}`;
  const list = loadLocalImports();
  const prev = list.find((x) => x.entry.id === id);
  if (prev && canonicalJson(prev.raw) === canonicalJson(raw)) return { ok: true, duplicate: true, id };
  const now = new Date().toISOString();
  const entry: SourcedEntry = { ...entryFor(s, `archive/${snapshotIdOf(s)}.json`, now, null), id, source: "local", sourceLabel: "Imported in this browser" };
  const next = [...list.filter((x) => x.entry.id !== id), { entry, raw, fileName, importedAtUtc: now }];
  return { ok: save(next), duplicate: false, id };
}

export function removeLocalImport(id: string) {
  save(loadLocalImports().filter((x) => x.entry.id !== id));
}

export function localImportRaw(id: string): unknown | null {
  return loadLocalImports().find((x) => x.entry.id === id)?.raw ?? null;
}
