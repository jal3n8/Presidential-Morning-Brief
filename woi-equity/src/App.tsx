import { useEffect, useState } from "react";
import { useTerminalData, type LoadedSnapshot } from "./lib/dataClient";
import { useRoute, href, type Route } from "./lib/router";
import { SnapshotContext, Badge, cx } from "./components/ui";
import { freshness } from "./lib/freshness";
import { fmtDate, fmtInstant, humanizeStatus } from "./lib/format";
import { CommandCenter } from "./views/CommandCenter";
import { Watchlist } from "./views/Watchlist";
import { StockDetail } from "./views/StockDetail";
import { ThreeHorsemen } from "./views/ThreeHorsemen";
import { Washout } from "./views/Washout";
import { Club3030 } from "./views/Club3030";
import { Macro } from "./views/Macro";
import { Research } from "./views/Research";
import { History } from "./views/History";
import { System } from "./views/System";
import { ImportView } from "./views/Import";
import { AdminView } from "./views/Admin";
import { useAuth, canSee } from "./lib/auth";
import { Gate } from "./components/Gate";
import type { Role } from "./lib/schema";

const NAV: { name: Route["name"]; path: string; label: string; short: string; min?: Role }[] = [
  { name: "command", path: "", label: "Command Center", short: "Command" },
  { name: "watchlist", path: "watchlist", label: "Watchlist", short: "Watchlist" },
  { name: "regime", path: "regime", label: "Three Horsemen", short: "Horsemen" },
  { name: "washout", path: "washout", label: "Washout Monitor", short: "Washout" },
  { name: "club3030", path: "club3030", label: "Club 30/30", short: "30/30" },
  { name: "macro", path: "macro", label: "Macro & Rates", short: "Macro" },
  { name: "research", path: "research", label: "Research & Sources", short: "Sources" },
  { name: "history", path: "history", label: "History", short: "History" },
  { name: "system", path: "system", label: "Audit & Data", short: "Audit" },
  { name: "import", path: "import", label: "Import & publish", short: "Import", min: "admin" },
  { name: "admin", path: "admin", label: "Admin", short: "Admin", min: "admin" },
];

function useNow(ms = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

/** Signed-out, unconfigured and no-subscription states never reach the terminal or its data. */
export default function App() {
  const auth = useAuth();
  if (auth.status === "signedIn" || auth.status === "preview") {
    if (canSee(auth.role, "subscriber")) return <Terminal />;
  }
  return <Gate />;
}

function Terminal() {
  const auth = useAuth();
  const data = useTerminalData(auth.getToken);
  const route = useRoute();
  const nav = NAV.filter((n) => !n.min || canSee(auth.role, n.min));
  const allowed = (name: Route["name"]) => nav.some((n) => n.name === name) || name === "stock";
  const now = useNow();
  /** An imported file being previewed. Never published; cleared on reload. */
  const [preview, setPreview] = useState<LoadedSnapshot | null>(null);
  const active = route.name === "stock" ? "watchlist" : route.name;
  const shown = preview ?? data.current;
  const s = shown?.snapshot ?? null;
  const fr = s ? freshness(s, now) : null;
  const tz = s?.snapshot.displayTimezone ?? "America/New_York";

  return (
    <div className="min-h-screen text-ivory-100 lg:flex">
      <aside className="hidden w-56 shrink-0 border-r border-ink-700 bg-ink-950 lg:block">
        <div className="sticky top-0 flex h-screen flex-col">
          <Brand />
          <nav className="mt-2 flex-1 overflow-y-auto px-2" aria-label="Dashboard sections">
            {nav.map((n, i) => (
              <a key={n.name} href={href(n.path)} aria-current={active === n.name ? "page" : undefined}
                 className={cx("flex items-center gap-3 px-3 py-2 text-[13px]", active === n.name ? "bg-ink-850 text-ivory-50" : "text-ivory-500 hover:text-ivory-100")}>
                <span className={cx("font-mono text-[10px]", active === n.name ? "text-brass-400" : "text-ivory-700")}>{String(i + 1).padStart(2, "0")}</span>
                {n.label}
              </a>
            ))}
          </nav>
          <div className="border-t border-ink-700 p-4 text-2xs leading-relaxed text-ivory-600">
            {auth.name && <div className="mb-2 truncate text-ivory-500">{auth.name} · <span className="uppercase">{auth.role}</span></div>}
            {auth.status === "signedIn" && <button onClick={auth.signOut} className="btn mb-3 px-2 py-1 text-2xs">Sign out</button>}
            <div><a href={import.meta.env.BASE_URL} className="link text-ivory-500">← woiequity.com</a></div>
            <p className="mt-2">Watchlist research only. Rules-based labels are not trade instructions.</p>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-ink-700 bg-ink-950/95 backdrop-blur supports-[backdrop-filter]:bg-ink-950/85" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 lg:px-6">
            <div className="lg:hidden"><Brand compact /></div>
            <div className="hidden min-w-0 items-center gap-3 text-xs text-ivory-500 lg:flex">
              {s && (
                <>
                  <span>Session <span className="font-mono text-ivory-100">{fmtDate(s.snapshot.equityTradingDate)}</span></span>
                  <span className="text-ink-600">/</span>
                  <span>{humanizeStatus(s.snapshot.equitySession)}</span>
                  <span className="text-ink-600">/</span>
                  <span>{humanizeStatus(s.snapshot.quality)}</span>
                </>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              {auth.status === "preview" && <Badge tone="caution">Local preview</Badge>}
              {preview && <Badge tone="brass">Preview</Badge>}
              {fr && <Badge tone={fr.mode === "LIVE" ? "up" : fr.mode === "SAMPLE" ? "caution" : "neutral"}>{fr.mode}</Badge>}
              {fr?.stale && <Badge tone="down">Stale</Badge>}
              {data.status && data.status.consecutiveFailures > 0 && <Badge tone="down">Update failed</Badge>}
              {data.lastError && <Badge tone="down">Feed error</Badge>}
              <label className="hidden cursor-pointer items-center gap-1.5 text-2xs text-ivory-500 sm:flex" title={`Checks for new data every ${Math.round(Number(import.meta.env.VITE_POLL_SECONDS ?? 300) / 60)} minutes`}>
                <input type="checkbox" checked={data.autoRefresh} onChange={(e) => data.setAutoRefresh(e.target.checked)} className="accent-[#c2a874]" /> Auto
              </label>
              <button onClick={data.refresh} className="btn px-2 py-1" aria-label="Check for new data now">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.8h-2.8" /></svg>
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>
          <nav className="scrollbar-none flex gap-1 overflow-x-auto border-t border-ink-800 px-2 lg:hidden" aria-label="Dashboard sections">
            {nav.map((n) => (
              <a key={n.name} href={href(n.path)} className={cx("shrink-0 border-b px-2.5 py-2 text-xs", active === n.name ? "border-brass-400 text-ivory-50" : "border-transparent text-ivory-500")}>{n.short}</a>
            ))}
          </nav>
        </header>

        {s && fr && <ModeBanner mode={fr.mode} stale={fr.stale} headline={fr.headline} date={s.snapshot.equityTradingDate} preview={!!preview} onExit={() => setPreview(null)} />}
        {data.updatedAt && !preview && (
          <div className="border-b border-brass-700 bg-ink-850 px-4 py-2 text-xs text-brass-300 lg:px-6">New snapshot loaded {fmtInstant(data.updatedAt, tz)}.</div>
        )}
        {data.lastError && data.current && (
          <div className="border-b border-down/30 bg-ink-850 px-4 py-2 text-xs text-down lg:px-6">
            Latest check failed ({data.lastError.message}). Showing the last valid snapshot. <a className="link" href={href("system")}>Details</a>
          </div>
        )}

        <main className="mx-auto max-w-[1400px] px-4 py-5 lg:px-6 lg:py-6">
          {!allowed(route.name) ? (
            <div className="mx-auto max-w-xl border border-ink-700 bg-ink-900 p-6 text-sm text-ivory-300">This page is for administrators. <a className="link" href={href("")}>Back to the Command Center</a></div>
          ) : route.name === "admin" ? (
            <AdminView data={data} />
          ) : route.name === "import" ? (
            <ImportView onPreview={(l) => { setPreview(l); window.location.hash = "#/"; }} previewing={preview} onExit={() => setPreview(null)} />
          ) : (
            <>
              {data.loading && !s && <div className="py-24 text-center text-sm text-ivory-500">Loading snapshot…</div>}
              {!data.loading && !s && <LoadFailure error={data.lastError} />}
              {s && shown && (
                <SnapshotContext.Provider value={s}>
                  {route.name === "command" && <CommandCenter data={{ ...data, current: shown }} now={now} />}
                  {route.name === "watchlist" && <Watchlist data={data} />}
                  {route.name === "stock" && <StockDetail symbol={route.symbol} data={data} />}
                  {route.name === "regime" && <ThreeHorsemen data={data} />}
                  {route.name === "washout" && <Washout />}
                  {route.name === "club3030" && <Club3030 />}
                  {route.name === "macro" && <Macro />}
                  {route.name === "research" && <Research initialQuery={route.q} />}
                  {route.name === "history" && <History data={data} />}
                  {route.name === "system" && <System data={data} shown={shown} now={now} />}
                </SnapshotContext.Provider>
              )}
            </>
          )}
        </main>
        <footer className="mx-auto max-w-[1400px] border-t border-ink-800 px-4 py-6 text-2xs leading-relaxed text-ivory-600 lg:px-6">
          WOI Equity. Figures are shown exactly as published in the validated snapshot, with their sources; missing values stay missing.
          Research and watchlist monitoring only, not investment advice, and no orders are placed.
          {data.lastCheckedAt && <> Last checked {fmtInstant(data.lastCheckedAt, tz)}.</>}
        </footer>
      </div>
    </div>
  );
}

function ModeBanner({ mode, stale, headline, date, preview, onExit }: { mode: string; stale: boolean; headline: string; date: string; preview: boolean; onExit: () => void }) {
  if (preview)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brass-700 bg-[#1d1a14] px-4 py-2 text-xs text-brass-300 lg:px-6">
        <span><span className="font-mono tracking-label">PREVIEW</span> · Showing an imported file from this device. It is not published and nobody else can see it.</span>
        <button className="btn px-2 py-0.5" onClick={onExit}>Exit preview</button>
      </div>
    );
  const text =
    mode === "SAMPLE" ? `Historical sample: the hand-verified baseline for ${fmtDate(date)}. Not a live feed.`
      : mode === "LIVE" ? `Live: automated update for ${fmtDate(date)}.`
        : `Automated snapshot for ${fmtDate(date)}.`;
  return (
    <div className={cx("border-b px-4 py-2 text-xs lg:px-6", stale ? "border-down/30 bg-[#1e1614] text-down" : mode === "SAMPLE" ? "border-caution/20 bg-[#1c1a14] text-caution" : "border-ink-700 bg-ink-900 text-ivory-300")}>
      <span className="font-mono tracking-label">{stale ? "STALE" : mode}</span> · {text}{stale ? ` ${headline}.` : ""}
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a href={href("")} className={cx("flex items-center gap-2.5", !compact && "px-5 pb-3 pt-5")}>
      <Mark />
      <div className="leading-tight">
        <div className="text-[13px] font-semibold tracking-[0.14em] text-ivory-50">WOI EQUITY</div>
        {!compact && <div className="font-mono text-[10px] uppercase tracking-label text-ivory-600">Research terminal</div>}
      </div>
    </a>
  );
}

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="5" fill="#1f1f1d" />
      <path d="M7 22 L12 11 L16 19 L20 11 L25 22" stroke="#c2a874" strokeWidth="2.2" fill="none" strokeLinejoin="round" />
    </svg>
  );
}

function LoadFailure({ error }: { error: ReturnType<typeof useTerminalData>["lastError"] }) {
  return (
    <div className="mx-auto max-w-2xl border border-down/30 bg-ink-900 p-6">
      <div className="label text-down">No valid snapshot</div>
      <p className="mt-2 text-sm text-ivory-300">No data source returned a snapshot that passes validation, so the dashboard shows nothing rather than guessing.</p>
      <p className="mt-2 text-sm text-ivory-300">You can still check a file on the <a className="link" href={href("import")}>Import</a> page.</p>
      {error && (
        <>
          <p className="mt-3 font-mono text-xs text-ivory-500">{error.message}</p>
          {error.issues.length > 0 && (
            <ul className="mt-3 space-y-1 font-mono text-2xs text-ivory-500">
              {error.issues.map((i, n) => <li key={n}><span className="text-down">{i.path}</span>: {i.message}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
