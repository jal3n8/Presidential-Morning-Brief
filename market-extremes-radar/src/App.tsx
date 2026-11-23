import { useEffect, useState } from "react";
import { Badge, Button, Notice } from "./components/ui";
import { fmtMarketDate, fmtUtc } from "./lib/format";
import { useData } from "./state";
import AnalogLab from "./views/AnalogLab";
import Brief from "./views/Brief";
import DataPage from "./views/DataPage";
import Journal from "./views/Journal";
import Overview from "./views/Overview";
import Scanner from "./views/Scanner";
import Watchlist from "./views/Watchlist";

const ROUTES = [
  { id: "overview", label: "Overview", el: Overview },
  { id: "scanner", label: "Scanner", el: Scanner },
  { id: "analogs", label: "Analog Lab", el: AnalogLab },
  { id: "watchlist", label: "Watchlist", el: Watchlist },
  { id: "journal", label: "Journal", el: Journal },
  { id: "brief", label: "Weekly Brief", el: Brief },
  { id: "data", label: "Data & Method", el: DataPage },
] as const;
type RouteId = (typeof ROUTES)[number]["id"];

function currentRoute(): RouteId {
  const id = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return (ROUTES.find((r) => r.id === id)?.id ?? "overview") as RouteId;
}

export function DatasetBanner() {
  const { dataset, analytics, notice } = useData();
  if (!dataset) return null;
  const fresh = analytics?.fresh;
  return (
    <div data-testid="dataset-banner">
      {dataset.kind === "demo" && (
        <div className="border-b border-risk/40 bg-risk/15 px-4 py-2 text-center text-xs font-medium text-paper">
          <span className="font-semibold tracking-wider text-risk">DEMO DATA</span> · Synthetic series for testing the software. Not market data. Not live. Do not use for decisions.
        </div>
      )}
      {dataset.kind === "imported" && (
        <div className="border-b border-gold/40 bg-gold/10 px-4 py-2 text-center text-xs text-paper">
          <span className="font-semibold tracking-wider text-gold">IMPORTED DATA</span> · Core series come from your own CSV import and have not been cross-checked.
        </div>
      )}
      {notice && <div className="border-b border-line bg-panel px-4 py-2 text-center text-xs text-muted">{notice}</div>}
      {fresh && (fresh.status === "stale" || fresh.status === "very_stale") && (
        <div className={`border-b px-4 py-2 text-center text-xs ${fresh.status === "very_stale" ? "border-risk/40 bg-risk/10 text-paper" : "border-gold/40 bg-gold/10 text-paper"}`}>
          <span className="font-semibold">STALE</span> · {fresh.message} Run <code className="text-gold">npm run data:update</code> and rebuild.
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState<RouteId>(currentRoute);
  const { status, error, dataset, analytics, reload } = useData();
  useEffect(() => {
    const on = () => {
      setRoute(currentRoute());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const View = ROUTES.find((r) => r.id === route)!.el;
  const kindBadge =
    dataset?.kind === "demo" ? <Badge tone="risk">Demo</Badge> : dataset?.kind === "imported" ? <Badge tone="gold">Imported</Badge> : dataset ? <Badge tone="gain">Source-backed</Badge> : null;
  const fresh = analytics?.fresh;

  return (
    <div className="min-h-screen bg-ink text-paper">
      <DatasetBanner />
      <header className="border-b border-line bg-ink/95">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-3 px-4 pb-3 pt-5 sm:px-6">
          <a href="#/overview" className="group">
            <div className="font-serif text-[13px] tracking-[0.32em] text-gold">WOI EQUITY</div>
            <div className="font-serif text-xl text-paper sm:text-2xl">Market Extremes Radar</div>
          </a>
          {dataset && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              {kindBadge}
              <span className="num">Market date <span className="text-paper">{fmtMarketDate(dataset.lastMarketDate)}</span></span>
              <span aria-hidden>·</span>
              <span className="num" title="When the dataset was built">Built {fmtUtc(dataset.builtAt)}</span>
              {fresh && fresh.status === "current" && <Badge tone="gain">Up to date</Badge>}
              {fresh && fresh.status === "stale" && <Badge tone="gold">Stale</Badge>}
              {fresh && fresh.status === "very_stale" && <Badge tone="risk">Stale</Badge>}
              <Badge tone="muted" title="End-of-day closes only">End of day · not live</Badge>
            </div>
          )}
        </div>
        <nav aria-label="Sections" className="mx-auto max-w-7xl overflow-x-auto px-2 sm:px-4">
          <ul className="flex min-w-max gap-1">
            {ROUTES.map((r) => (
              <li key={r.id}>
                <a
                  href={`#/${r.id}`}
                  aria-current={route === r.id ? "page" : undefined}
                  className={`block border-b-2 px-3 py-2.5 text-sm transition-colors ${route === r.id ? "border-gold text-paper" : "border-transparent text-muted hover:text-paper"}`}
                >
                  {r.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6">
        {status === "loading" && !dataset && <p className="py-20 text-center text-sm text-muted">Loading and validating data…</p>}
        {status === "error" && (
          <div className="mx-auto max-w-xl space-y-3 py-12">
            <Notice tone="risk">
              <p className="font-semibold">The data could not be loaded.</p>
              <p className="mt-1 text-paper/80">{error}</p>
              <p className="mt-2 text-paper/70">Nothing has been estimated or filled in. Check the Data &amp; Method page, switch to the demo dataset, or rebuild the data.</p>
            </Notice>
            <div className="flex gap-2">
              <Button onClick={reload}>Try again</Button>
              <Button variant="ghost" onClick={() => { localStorage.removeItem("woi.radar.dataset.v1"); window.location.reload(); }}>Reset data choice</Button>
            </div>
          </div>
        )}
        {dataset && analytics && <View />}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-7xl space-y-1 px-4 py-6 text-[11px] leading-relaxed text-muted sm:px-6">
          <p>WOI Equity · Market Extremes Radar · private research tool. Research only, not investment advice. No orders are placed; there is no brokerage connection.</p>
          <p>Labels are produced by fixed, published rules (Data &amp; Method page). Historical and hypothetical results do not guarantee future results.</p>
        </div>
      </footer>
    </div>
  );
}
