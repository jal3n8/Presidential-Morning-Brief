/**
 * Browser-local persistence. Everything stays on this device; nothing is sent anywhere.
 * Storage can be unavailable (private windows, blocked site data) - every call is guarded
 * and the app keeps working in memory.
 */
export const KEYS = {
  journal: "woi.radar.journal.v1",
  watchlist: "woi.radar.watchlist.v1",
  imports: "woi.radar.imports.v1",
  datasetChoice: "woi.radar.dataset.v1",
} as const;

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): { ok: boolean; error?: string } {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Storage unavailable" };
  }
}

export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
