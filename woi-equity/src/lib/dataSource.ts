/**
 * Where the dashboard reads snapshots from.
 *
 * Two adapters implement one interface:
 *  - StaticJsonDataSource: plain JSON files shipped with the site (/data).
 *    Holds the bundled baseline, works offline and in local preview.
 *  - HttpDataSource: the server's data API (/api/data.php on Hostinger),
 *    which serves the live store written by the ingest endpoint. It sends
 *    the browser's session cookie, so it can later be restricted to signed-in
 *    members on the server without any secret in browser code.
 *
 * Neither adapter ever talks to Google Drive or any API that needs a key.
 */

export class NotFound extends Error {
  constructor(what: string) {
    super(`${what} not found`);
  }
}

export interface DataSource {
  readonly id: string;
  readonly label: string;
  getLatest(): Promise<unknown>;
  getManifest(): Promise<unknown>;
  getStatus(): Promise<unknown>;
  /** `path` as written in the manifest, e.g. "archive/2026-11-20.json". */
  getArchived(path: string): Promise<unknown>;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (res.status === 404) throw new NotFound(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const type = res.headers.get("content-type") ?? "";
  const text = await res.text();
  // A host that answers unknown paths with an HTML page means "not available here".
  if (!type.includes("json") && /^\s*</.test(text)) throw new NotFound(url);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Response from ${url} is not valid JSON`);
  }
}

const bust = (url: string) => `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;

export class StaticJsonDataSource implements DataSource {
  constructor(readonly id: string, readonly label: string, private base: string) {
    this.base = base.replace(/\/$/, "");
  }
  getLatest = () => fetchJson(bust(`${this.base}/latest.json`));
  getManifest = () => fetchJson(bust(`${this.base}/archive/index.json`));
  getStatus = () => fetchJson(bust(`${this.base}/status.json`));
  getArchived = (path: string) => fetchJson(`${this.base}/${safePath(path)}`);
  fileUrl = (path: string) => `${this.base}/${safePath(path)}`;
}

export class HttpDataSource implements DataSource {
  constructor(readonly id: string, readonly label: string, private endpoint: string) {}
  private q = (params: Record<string, string>) => bust(`${this.endpoint}?${new URLSearchParams(params)}`);
  private get = (params: Record<string, string>) => fetchJson(this.q(params), { credentials: "same-origin" });
  getLatest = () => this.get({ file: "latest" });
  getManifest = () => this.get({ file: "manifest" });
  getStatus = () => this.get({ file: "status" });
  getArchived = (path: string) => this.get({ file: "archive", id: safePath(path).replace(/^archive\//, "").replace(/\.json$/, "") });
  fileUrl = (path: string) => `${this.endpoint}?${new URLSearchParams({ file: "archive", id: safePath(path).replace(/^archive\//, "").replace(/\.json$/, "") })}`;
}

/** Manifest paths are data, so they are constrained before use in a URL. */
export function safePath(path: string): string {
  const p = path.replace(/^\.?\/?(data\/)?/, "");
  if (!/^archive\/[A-Za-z0-9_.-]+\.json$/.test(p)) throw new Error(`Refusing unexpected archive path "${path}"`);
  return p;
}

const BASE = import.meta.env.BASE_URL ?? "/";

/**
 * Configured sources, highest priority first. The newest valid snapshot
 * across all of them is shown, so a manual upload through GitHub and an
 * automated ingest can coexist.
 *   VITE_LIVE_API: data API endpoint ("" disables it). Default /api/data.php
 *   VITE_BUNDLED_DATA: bundled JSON folder. Default <base>data
 */
export function configuredSources(): (StaticJsonDataSource | HttpDataSource)[] {
  const env = import.meta.env as Record<string, string | undefined>;
  const live = env.VITE_LIVE_API ?? `${BASE}api/data.php`;
  const bundled = env.VITE_BUNDLED_DATA ?? `${BASE}data`;
  const out: (StaticJsonDataSource | HttpDataSource)[] = [];
  if (live) out.push(new HttpDataSource("live", "Live data store", live));
  out.push(new StaticJsonDataSource("bundled", "Bundled snapshots", bundled));
  return out;
}
