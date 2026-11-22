import type { TerminalState } from "../lib/dataClient";
import type { ResearchItem } from "../lib/schema";
import { Badge, KV, Missing, PageHeader, Panel, SectionNote, SourceRef, Sparkline, useSnapshot } from "../components/ui";
import { fmtDate, fmtInstant, fmtNum, fmtPct, fmtUsd, humanizeStatus, tone } from "../lib/format";
import { href } from "../lib/router";
import { nthSessionFrom, sessionsInclusive } from "../lib/calendar";
import { pickClose, seriesFrom, useArchive } from "../lib/archive";

export function StockDetail({ symbol, data }: { symbol: string; data: TerminalState }) {
  const s = useSnapshot();
  const archive = useArchive(data);
  const w = s.watchlist.find((x) => x.symbol === symbol);
  if (!w) {
    return (
      <Panel title="Not on the watchlist">
        <p className="text-sm text-ivory-300">{symbol} is not in the current snapshot. <a className="link" href={href("watchlist")}>Back to watchlist</a></p>
      </Panel>
    );
  }
  const t = w.technicalIndicators;
  const r = w.research;
  const tz = s.snapshot.displayTimezone;
  const sessions = w.listingDate ? sessionsInclusive(w.listingDate, s.snapshot.equityTradingDate) : null;
  const sma200Date = w.listingDate && sessions !== null && sessions < 200 ? nthSessionFrom(w.listingDate, 200) : null;
  const series = seriesFrom(archive, pickClose(w.symbol));

  return (
    <>
      <div className="mb-3 text-xs"><a className="link" href={href("watchlist")}>← Watchlist</a></div>
      <PageHeader kicker={`${w.symbol} · ${w.currency}`} title={w.company}>
        <Badge tone={r.status === "not_researched" ? "muted" : "brass"}>{humanizeStatus(r.status)}</Badge>
      </PageHeader>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel kicker="Price" title="Regular session">
          <div className="flex items-baseline justify-between gap-3">
            <div className="num font-mono text-[34px] leading-10 text-ivory-50">{fmtUsd(w.regularSessionClose) ?? <Missing />}</div>
            <div className={`num font-mono text-lg ${tone(w.oneDayChangePct)}`}>{fmtPct(w.oneDayChangePct) ?? "—"}</div>
          </div>
          <div className="mt-1 text-2xs text-ivory-500">Close on {fmtDate(w.closeDate)} · one-day change vs prior close</div>
          {w.intraday && (
            <div className="mt-3 border-t border-ink-800 pt-3 text-xs">
              <span className="label">Intraday</span>{" "}
              <span className="num font-mono text-ivory-100">{fmtUsd(w.intraday.price)}</span>{" "}
              <span className="text-ivory-500">as of {fmtInstant(w.intraday.asOfUtc, tz)}</span>
              <div className="mt-1"><SourceRef refKey={w.intraday.source} /></div>
            </div>
          )}
          <div className="mt-3"><SourceRef refKey={w.marketDataSource} /></div>
          <div className="mt-4 border-t border-ink-800 pt-3">
            <div className="label mb-1">Archived closes</div>
            <Sparkline points={series} height={48} />
          </div>
        </Panel>

        <Panel kicker="Technicals" title="Indicators">
          <KV rows={[
            ["50-day SMA", fmtUsd(t.sma50Usd) ?? <Missing compact reason={t.sma200Availability} />],
            ["200-day SMA", fmtUsd(t.sma200Usd) ?? <Missing compact reason={t.sma200Availability} />],
            ["RSI (14)", fmtNum(t.rsi14) ?? <Missing compact reason={t.sma200Availability} />],
            ["Close vs 200-day", t.sma200Usd !== null && w.regularSessionClose !== null ? <span className={tone(w.regularSessionClose - t.sma200Usd)}>{fmtPct((w.regularSessionClose / t.sma200Usd - 1) * 100)}</span> : <Missing compact />],
            ...(t.method ? [["Method", t.method] as [string, string]] : []),
          ]} />
          <div className="mt-3 space-y-2">
            <SectionNote>{humanizeStatus(t.sma200Availability) ?? "Indicator values supplied by the snapshot."}</SectionNote>
            {t.sma200Note && <SectionNote>{t.sma200Note}</SectionNote>}
            {sessions !== null && (
              <SectionNote>
                Listed {fmtDate(w.listingDate)}. {sessions} completed NYSE sessions through {fmtDate(s.snapshot.equityTradingDate)}.
                {sma200Date && <> On the exchange calendar, session 200 falls on <span className="text-ivory-100">{fmtDate(sma200Date)}</span>, the earliest close a full 200-session SMA can use.</>}
              </SectionNote>
            )}
          </div>
        </Panel>

        <Panel kicker="Research" title="Coverage">
          <KV rows={[
            ["Status", humanizeStatus(r.status)],
            ["As of", r.asOf ?? <Missing compact reason="No research run yet" />],
            ["Verified catalysts", r.verifiedCatalysts.length],
            ["Verified filings", r.verifiedFilings.length],
            ["Unverified claims", r.unverifiedClaims.length],
          ]} />
          <div className="mt-3">
            <div className="label mb-1.5">Focus areas</div>
            <ul className="space-y-1 text-xs text-ivory-300">{r.focus.map((f) => <li key={f} className="flex gap-2"><span className="text-brass-500">·</span>{f}</li>)}</ul>
          </div>
          <div className="mt-4 text-2xs"><a className="link" href={href(`research?q=${encodeURIComponent(w.symbol)}`)}>Open {w.symbol} in the evidence ledger</a></div>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel kicker="Summary" title="Research summary">
          {r.summary ? <p className="font-serif text-[15px] leading-relaxed text-ivory-100">{r.summary}</p>
            : <SectionNote>No research summary yet. The research agent has not produced a verified summary for {w.symbol}; nothing is written here until it does.</SectionNote>}
        </Panel>
        <Panel kicker="Analysis, not data" title="Bull / bear scenarios">
          {r.scenarios ? (
            <div className="space-y-3">
              <div><div className="label mb-1 text-up">Bull case · analysis</div><p className="text-xs leading-relaxed text-ivory-300">{r.scenarios.bull ?? "Not written."}</p></div>
              <div><div className="label mb-1 text-down">Bear case · analysis</div><p className="text-xs leading-relaxed text-ivory-300">{r.scenarios.bear ?? "Not written."}</p></div>
              <div className="text-2xs text-ivory-600">Written by {r.scenarios.author}{r.scenarios.asOf ? `, ${r.scenarios.asOf}` : ""}. Opinion, not a forecast or recommendation.</div>
            </div>
          ) : <SectionNote>No scenarios written for {w.symbol}. When the research agent adds them they appear here, labelled as analysis and kept apart from market data.</SectionNote>}
        </Panel>
        <ItemList title="Verified SEC filings" items={r.verifiedFilings} empty="No filings recorded in this snapshot." />
        <ItemList title="Verified catalyst timeline" items={[...r.verifiedCatalysts].sort((a, b) => (a.effectiveAt ?? a.date ?? "").localeCompare(b.effectiveAt ?? b.date ?? ""))} empty="No verified catalysts recorded in this snapshot." />
        <ItemList title="Unverified claims" items={r.unverifiedClaims} empty="No unverified claims recorded." unverified />
      </div>
    </>
  );
}

function ItemList({ title, items, empty, unverified = false }: { title: string; items: ResearchItem[]; empty: string; unverified?: boolean }) {
  return (
    <Panel kicker={unverified ? "Not verified" : "Evidence"} title={title} right={<span className="font-mono">{items.length}</span>}>
      {items.length === 0 ? <SectionNote>{empty}</SectionNote> : (
        <ul className="divide-y divide-ink-800">
          {items.map((it, i) => (
            <li key={it.id ?? i} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className={`text-[13px] ${unverified ? "text-ivory-300" : "text-ivory-50"}`}>{it.title}</span>
                <span className="shrink-0 font-mono text-2xs text-ivory-500">{it.date ?? "undated"}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge tone={unverified ? "caution" : "neutral"}>{it.form ?? humanizeStatus(it.type)}</Badge>
                {it.sourceRef ? <SourceRef refKey={it.sourceRef} /> : it.url ? <a className="text-2xs text-ivory-500 underline" href={it.url} target="_blank" rel="noreferrer noopener">{it.url}</a> : <span className="text-2xs text-down">No source</span>}
              </div>
              {(it.publishedAt || it.effectiveAt) && (
                <div className="mt-1 font-mono text-[10px] text-ivory-600">
                  {it.publishedAt && <>published {it.publishedAt}</>}{it.publishedAt && it.effectiveAt && " · "}{it.effectiveAt && <>event {it.effectiveAt}</>}
                </div>
              )}
              {it.summary && <p className="mt-1.5 text-xs leading-relaxed text-ivory-500">{it.summary}</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
