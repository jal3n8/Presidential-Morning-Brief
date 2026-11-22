/**
 * Where the dashboard reads snapshots from.
 *
 * Production: ONLY the server data API (/api/data.php), with the signed-in
 * user's access token. The server checks the role on every request; there
 * are no data files in the public website folder.
 *
 * Development (`npm run dev` only): a local preview source reading the
 * bundled seed through the dev server. Removed from production builds.
 */

export class NotFound extends Error {
  constructor(what: string) {
    super(`${what} not found`);
  }
}
export class AuthRequired extends Error {}

export interface DataSource {
  readonly id: string;
  readonly label: string;
  getLatest(): Promise<unknown>;
  getManifest(): Promise<unknown>;
  getStatus(): Promise<unknown>;
  /** `path` as written in the manifest, e.g. "archive/2026-11-20.json". */
  getArchived(path: string): Promise<unknown>;
}

export type TokenGetter = () => Promise<string | null>;

async function fetchJson(url: string, token: string | null): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store", credentials: "same-origin", headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (res.status === 401) throw new AuthRequired("Your session has ended. Please sign in again.");
  if (res.status === 403) throw new AuthRequired("Your account does not have access to this data.");
  if (res.status === 404) throw new NotFound(url.split("?")[0]);
  if (res.status === 429) throw new Error("Too many requests; trying again shortly.");
  if (!res.ok) throw new Error(`The data service answered HTTP ${res.status}.`);
  const type = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!type.includes("json")) throw new NotFound(url.split("?")[0]);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The data service returned invalid JSON.");
  }
}

const bust = (url: string) => `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;

/** Manifest paths are data, so they are constrained before use in a URL. */
export function safePath(path: string): string {
  const p = path.replace(/^\.?\/?(data\/)?/, "");
  if (!/^archive\/[A-Za-z0-9_.-]+\.json$/.test(p)) throw new Error(`Refusing unexpected archive path "${path}"`);
  return p;
}
const idFromPath = (path: string) => safePath(path).replace(/^archive\//, "").replace(/\.json$/, "");

export class HttpDataSource implements DataSource {
  constructor(readonly id: string, readonly label: string, private endpoint: string, private getToken: TokenGetter) {}
  private async get(params: Record<string, string>) {
    const token = await this.getToken();
    if (!token) throw new AuthRequired("Please sign in.");
    return fetchJson(bust(`${this.endpoint}?${new URLSearchParams(params)}`), token);
  }
  getLatest = () => this.get({ file: "latest" });
  getManifest = () => this.get({ file: "manifest" });
  getStatus = () => this.get({ file: "status" });
  getArchived = (path: string) => this.get({ file: "archive", id: idFromPath(path) });
  /** Authenticated download (a plain link would not carry the token). */
  download = async (path: string) => JSON.stringify(await this.getArchived(path), null, 2);
}

export class StaticJsonDataSource implements DataSource {
  constructor(readonly id: string, readonly label: string, private base: string) {
    this.base = base.replace(/\/$/, "");
  }
  getLatest = () => fetchJson(bust(`${this.base}/latest.json`), null);
  getManifest = () => fetchJson(bust(`${this.base}/archive/index.json`), null);
  getStatus = () => fetchJson(bust(`${this.base}/status.json`), null);
  getArchived = (path: string) => fetchJson(`${this.base}/${safePath(path)}`, null);
  download = async (path: string) => JSON.stringify(await this.getArchived(path), null, 2);
}

const BASE = import.meta.env.BASE_URL ?? "/";

export function configuredSources(getToken: TokenGetter): (HttpDataSource | StaticJsonDataSource)[] {
  if (import.meta.env.DEV && (import.meta.env as Record<string, string | undefined>).VITE_DEV_PREVIEW !== "0") {
    return [new StaticJsonDataSource("dev", "Local preview (seed data, no sign-in)", "/dev-data")];
  }
  return [new HttpDataSource("live", "WOI Equity data service", `${BASE}api/data.php`, getToken)];
}
