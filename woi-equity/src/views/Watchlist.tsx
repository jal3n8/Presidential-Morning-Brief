import type { TerminalState } from "../lib/dataClient";
import type { WatchItem } from "../lib/schema";
import { Badge, Missing, PageHeader, Panel, SourceRef, Sparkline, useSnapshot } from "../components/ui";
import { fmtDate, fmtNum, fmtPct, fmtUsd, humanizeStatus, tone } from "../lib/format";
import { href } from "../lib/router";
import { sessionsInclusive } from "../lib/calendar";
import { pickClose, seriesFrom, useArchive } from "../lib/archive";

export function Watchlist({ data }: { data: TerminalState }) {
  const s = useSnapshot();
  const archive = useArchive(data);
  return (
    <>
      <PageHeader kicker="Module 02" title="Four-Stock Watchlist">
        Regular-session closes for {fmtDate(s.snapshot.equityTradingDate)}
      </PageHeader>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {s.watchlist.map((w) => <StockCard key={w.symbol} w={w} series={seriesFrom(archive, pickClose(w.symbol))} />)}
      </div>
      <p className="mt-4 text-2xs text-ivory-600">
        Technical indicators are shown only when the snapshot supplies them from a recorded method. They are not estimated in the browser.
      </p>
    </>
  );
}

function StockCard({ w, series }: { w: WatchItem; series: { x: string; y: number }[] }) {
  const s = useSnapshot();
  const t = w.technicalIndicators;
  const r = w.research;
  const sessions = w.listingDate ? sessionsInclusive(w.listingDate, s.snapshot.equityTradingDate) : null;
  return (
    <Panel pad={false} className="flex flex-col">
      <a href={href(`stock/${w.symbol}`)} className="group block flex-1 p-4 hover:bg-ink-850">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-mono text-[17px] text-ivory-50 group-hover:text-brass-300">{w.symbol}</div>
            <div className="text-2xs text-ivory-500">{w.company}</div>
          </div>
          <Badge tone={r.status === "not_researched" ? "muted" : "brass"}>{humanizeStatus(r.status)}</Badge>
        </div>
        <div className="mt-4 flex items-baseline justify-between gap-2">
          <div className="num font-mono text-[26px] leading-8 text-ivory-50">{fmtUsd(w.regularSessionClose) ?? <Missing />}</div>
          <div className={`num font-mono text-[15px] ${tone(w.oneDayChangePct)}`}>{fmtPct(w.oneDayChangePct) ?? "—"}</div>
        </div>
        <div className="mt-0.5 text-2xs text-ivory-600">Close {fmtDate(w.closeDate)} · {w.currency}</div>

        <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-ink-800 pt-3">
          {([["SMA 50", fmtUsd(t.sma50Usd)], ["SMA 200", fmtUsd(t.sma200Usd)], ["RSI 14", fmtNum(t.rsi14)]] as const).map(([k, v]) => (
            <div key={k}>
              <dt className="label">{k}</dt>
              <dd className="num mt-0.5 font-mono text-[13px] text-ivory-100">{v ?? <span className="text-ivory-600">—</span>}</dd>
            </div>
          ))}
        </dl>
        {(t.sma50Usd === null || t.sma200Usd === null || t.rsi14 === null) && (
          <div className="mt-2 text-2xs leading-snug text-ivory-600">
            {humanizeStatus(t.sma200Availability) ?? "Not supplied"}
            {sessions !== null && <> · {sessions} public sessions since listing on {fmtDate(w.listingDate)}</>}
          </div>
        )}

        <div className="mt-4 border-t border-ink-800 pt-3">
          <div className="label mb-1.5">Research focus</div>
          <div className="flex flex-wrap gap-1">{r.focus.map((f) => <span key={f} className="border border-ink-700 px-1.5 py-0.5 text-2xs text-ivory-300">{f}</span>)}</div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {([["Catalysts", r.verifiedCatalysts.length], ["Filings", r.verifiedFilings.length], ["Unverified", r.unverifiedClaims.length]] as const).map(([k, n]) => (
              <div key={k} className="border border-ink-800 py-1.5"><div className="num font-mono text-[13px] text-ivory-100">{n}</div><div className="text-[10px] text-ivory-600">{k}</div></div>
            ))}
          </div>
        </div>
        <div className="mt-3 text-2xs">
          <span className="label">Next sourced catalyst </span>
          {(() => {
            const next = [...r.verifiedCatalysts].filter((c) => (c.effectiveAt ?? c.date ?? "") >= s.snapshot.equityTradingDate).sort((a, b) => (a.effectiveAt ?? a.date ?? "").localeCompare(b.effectiveAt ?? b.date ?? ""))[0];
            return next ? <span className="text-ivory-100">{next.title} · {(next.effectiveAt ?? next.date ?? "").slice(0, 10)}</span> : <span className="text-ivory-600">None recorded</span>;
          })()}
        </div>
        <div className="mt-4"><div className="label mb-1">Archived closes</div><Sparkline points={series} /></div>
      </a>
      <div className="border-t border-ink-800 px-4 py-2"><SourceRef refKey={w.marketDataSource} /></div>
    </Panel>
  );
}
