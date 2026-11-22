import { useMemo, useState } from "react";
import { Badge, PageHeader, Panel, SectionNote, useSnapshot, cx } from "../components/ui";
import { buildLedger, searchLedger, CATEGORY_LABEL, type LedgerCategory } from "../lib/ledger";
import { fmtDate } from "../lib/format";

export function Research({ initialQuery }: { initialQuery?: string }) {
  const s = useSnapshot();
  const ledger = useMemo(() => buildLedger(s), [s]);
  const [q, setQ] = useState(initialQuery ?? "");
  const [cat, setCat] = useState<LedgerCategory | "all">("all");
  const [sym, setSym] = useState<string | "all">("all");
  const results = searchLedger(ledger, q, cat, sym);
  const counts = ledger.reduce<Record<string, number>>((a, e) => ((a[e.category] = (a[e.category] ?? 0) + 1), a), {});
  const research = ledger.filter((e) => e.kind === "research");
  const categories = Object.keys(CATEGORY_LABEL) as LedgerCategory[];
  const symbols = ["all", ...s.watchlist.map((w) => w.symbol)];

  return (
    <>
      <PageHeader kicker="Module 07" title="Research & Sources">
        {ledger.length} entries · {research.length} research items
      </PageHeader>

      <Panel>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sources, symbols, fields, domains…" className="input" aria-label="Search the evidence ledger" />
          <select value={sym} onChange={(e) => setSym(e.target.value)} className="input md:w-40" aria-label="Filter by symbol">
            {symbols.map((x) => <option key={x} value={x}>{x === "all" ? "All symbols" : x}</option>)}
          </select>
        </div>
        <div className="scrollbar-none -mx-1 mt-3 flex gap-1 overflow-x-auto px-1">
          {(["all", ...categories] as const).map((c) => (
            <button key={c} onClick={() => setCat(c)}
                    className={cx("shrink-0 border px-2 py-1 text-2xs", cat === c ? "border-brass-500 text-brass-300" : "border-ink-700 text-ivory-500 hover:text-ivory-100")}>
              {c === "all" ? "All" : CATEGORY_LABEL[c]} <span className="font-mono text-ivory-700">{c === "all" ? ledger.length : counts[c] ?? 0}</span>
            </button>
          ))}
        </div>
      </Panel>

      {research.length === 0 && (
        <div className="mt-3 border border-ink-700 bg-ink-900 px-4 py-3">
          <SectionNote>
            No company announcements, SEC filings, earnings items or news have been recorded yet: all four names are marked “not researched” in this snapshot.
            The ledger currently holds the market-data sources behind every number on the dashboard. Research items appear here once the research and filings steps of the pipeline run.
          </SectionNote>
        </div>
      )}

      <Panel className="mt-3" pad={false} title={`${results.length} result${results.length === 1 ? "" : "s"}`}>
        {results.length === 0 ? <div className="p-4"><SectionNote>Nothing matches. Try a symbol, a domain such as “treasury”, or a module such as “washout”.</SectionNote></div> : (
          <ul className="divide-y divide-ink-800">
            {results.map((e) => (
              <li key={`${e.kind}-${e.key}`} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_220px]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={e.verification === "unverified" ? "caution" : e.verification === "verified" ? "up" : "neutral"}>
                      {e.verification === "data_source" ? CATEGORY_LABEL[e.category] : e.verification}
                    </Badge>
                    {e.verification !== "data_source" && <Badge tone="muted">{CATEGORY_LABEL[e.category]}</Badge>}
                    {e.symbols.map((x) => <span key={x} className="font-mono text-2xs text-ivory-300">{x}</span>)}
                  </div>
                  <div className="mt-1.5 text-[13px] text-ivory-50">{e.title}</div>
                  {e.summary && <div className="mt-1 text-xs text-ivory-500">{e.summary}</div>}
                  {e.url && (
                    <a href={e.url} target="_blank" rel="noreferrer noopener" className="mt-1 block truncate font-mono text-2xs text-ivory-500 underline decoration-ink-600 underline-offset-2 hover:text-brass-300">{e.url}</a>
                  )}
                  {e.citedBy.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">{e.citedBy.map((c) => <span key={c} className="border border-ink-800 px-1.5 py-0.5 text-[10px] text-ivory-500">{c}</span>)}</div>
                  )}
                </div>
                <div className="space-y-0.5 text-2xs text-ivory-500 md:text-right">
                  <div><span className="text-ivory-700">key </span><span className="font-mono">{e.key}</span></div>
                  {e.host && <div>{e.host}</div>}
                  {e.date && <div>Published {fmtDate(e.date)}</div>}
                  {e.retrievedDate && <div>Retrieved {fmtDate(e.retrievedDate)}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
