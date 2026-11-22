import type { TerminalState } from "../lib/dataClient";
import { Badge, DistanceBar, PageHeader, Panel, SectionNote, SourceList, Sparkline, Missing, useSnapshot } from "../components/ui";
import { computeThreeHorsemen } from "../lib/regime";
import { fmtPct, fmtUsd, tone } from "../lib/format";
import { seriesFrom, useArchive } from "../lib/archive";

export function ThreeHorsemen({ data }: { data: TerminalState }) {
  const s = useSnapshot();
  const r = computeThreeHorsemen(s);
  const archive = useArchive(data);
  const history = archive?.filter((a) => a.snapshot).map((a) => ({ date: a.entry.equityTradingDate, label: computeThreeHorsemen(a.snapshot!).label })) ?? [];

  return (
    <>
      <PageHeader kicker="Module 03" title="Three Horsemen">Rules-based regime · not a trade recommendation</PageHeader>

      <Panel>
        <div className="grid gap-6 md:grid-cols-[1fr_1.4fr]">
          <div>
            <div className="label">Regime, recomputed from closes and SMAs</div>
            <div className={`mt-2 font-mono text-[40px] leading-[44px] ${r.label === "DEFENSIVE" ? "text-down" : r.label === "NOT DEFENSIVE" ? "text-up" : "text-ivory-500"}`}>{r.label}</div>
            <div className="mt-2 text-xs text-ivory-500">{r.belowCount} of 3 instruments below their 200-session SMA.</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone={r.agreesWithReported === false ? "down" : "up"}>Reported: {r.reportedLabel ?? "none"}</Badge>
              <Badge tone="muted">{s.marketRegime.labelType.replace(/_/g, " ")}</Badge>
            </div>
          </div>
          <div className="border-t border-ink-800 pt-4 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="label mb-2">Rule</div>
            <p className="font-serif text-[15px] leading-relaxed text-ivory-100">{s.marketRegime.rule}</p>
            <SectionNote>
              The dashboard does not trust the stored label: it compares each close with its own SMA200 every time the data loads.
              If any input is missing the result is INDETERMINATE rather than a guess.
            </SectionNote>
          </div>
        </div>
      </Panel>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {r.instruments.map((i) => (
          <Panel key={i.symbol} kicker={i.side === "below" ? "Below 200-day" : i.side === "above" ? "Above 200-day" : "Incomplete"} title={i.symbol}>
            <div className="grid grid-cols-2 gap-3">
              <div><div className="label">Close</div><div className="num mt-0.5 font-mono text-lg text-ivory-50">{fmtUsd(i.close) ?? <Missing compact />}</div></div>
              <div><div className="label">200-session SMA</div><div className="num mt-0.5 font-mono text-lg text-ivory-300">{fmtUsd(i.sma200) ?? <Missing compact />}</div></div>
            </div>
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-2xs"><span className="text-ivory-500">Distance from SMA200</span><span className={`num font-mono ${tone(i.computedPct)}`}>{fmtPct(i.computedPct) ?? "—"}</span></div>
              <DistanceBar pct={i.computedPct} />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-ivory-700"><span>−15%</span><span>SMA</span><span>+15%</span></div>
            </div>
            <div className="mt-3 text-2xs text-ivory-600">Reported {fmtPct(i.reportedPct) ?? "—"}{i.reportedPct !== null && i.computedPct !== null && Math.abs(i.reportedPct - i.computedPct) <= 0.02 ? " · matches" : ""}</div>
            <div className="mt-3"><SourceList refs={i.sources} /></div>
          </Panel>
        ))}
      </div>

      <Panel className="mt-3" kicker="History" title="Regime by archived session">
        {history.length < 2 ? (
          <SectionNote>{history.length === 1 ? `One archived session (${history[0].date}: ${history[0].label}). The regime timeline fills in as the pipeline archives new sessions.` : "No archived sessions yet."}</SectionNote>
        ) : (
          <div className="flex flex-wrap gap-1">
            {history.map((h) => <div key={h.date} title={`${h.date}: ${h.label}`} className={`h-5 w-3 ${h.label === "DEFENSIVE" ? "bg-down/70" : h.label === "NOT DEFENSIVE" ? "bg-up/60" : "bg-ink-700"}`} />)}
          </div>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {(["SPY", "QQQ", "IWM"] as const).map((sym) => (
            <div key={sym}>
              <div className="label mb-1">{sym} % vs SMA200, archived</div>
              <Sparkline points={seriesFrom(archive, (x) => {
                const i = x.marketRegime.instruments.find((m) => m.symbol === sym);
                return i && i.closeUsd !== null && i.sma200Usd !== null ? (i.closeUsd / i.sma200Usd - 1) * 100 : null;
              })} />
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
