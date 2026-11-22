import type { TerminalState } from "../lib/dataClient";
import { Badge, DistanceBar, Panel, PageHeader, SourceList, SourceRef, Stat, useSnapshot, Missing } from "../components/ui";
import { computeThreeHorsemen } from "../lib/regime";
import { freshness } from "../lib/freshness";
import { fmtDate, fmtInstant, fmtNum, fmtPct, fmtUsd, humanizeStatus, tone, tzShort } from "../lib/format";
import { href } from "../lib/router";
import { useArchive } from "../lib/archive";
import { diffSnapshots, importantChanges } from "../lib/diff";
import { isSignalUnblocked } from "../lib/validate";
import { compareSnapshots } from "../lib/snapshotOrder";

export function CommandCenter({ data, now }: { data: TerminalState; now: Date }) {
  const s = useSnapshot();
  const tz = s.snapshot.displayTimezone;
  const regime = computeThreeHorsemen(s);
  const fr = freshness(s, now);
  const sp = s.washout.sp500;
  const archive = useArchive(data);
  const issues = data.current?.issues ?? [];
  const warnings = issues.filter((i) => i.level === "warning");

  // Previous archived snapshot strictly older than the one on screen.
  const prev = archive?.filter((a) => a.snapshot && compareSnapshots(a.snapshot, s) < 0).at(-1);
  const changes = prev?.snapshot ? importantChanges(diffSnapshots(prev.snapshot, s)) : null;
  const movers = [...s.watchlist].filter((w) => w.oneDayChangePct !== null).sort((a, b) => Math.abs(b.oneDayChangePct!) - Math.abs(a.oneDayChangePct!));

  return (
    <>
      <PageHeader kicker="Module 01" title="Market Command Center">
        Report {fmtDate(s.snapshot.reportDate)} · times in {tzShort(tz)} ({tz})
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Panel kicker="S&P 500" title={sp.symbol}>
          <Stat label="Close" value={fmtNum(sp.close)} size="lg" sub={<>{fmtDate(s.snapshot.equityTradingDate)} · {humanizeStatus(s.snapshot.equitySession)}</>} />
          <div className="mt-3 space-y-1.5">
            <div className="flex justify-between text-2xs"><span className="text-ivory-500">vs 200-day SMA</span><span className={`num font-mono ${tone(sp.pctVsSma200)}`}>{fmtPct(sp.pctVsSma200) ?? "—"}</span></div>
            <DistanceBar pct={sp.pctVsSma200} />
            <div className="flex justify-between text-2xs"><span className="text-ivory-500">YoY price return</span><span className={`num font-mono ${tone(sp.yearOverYearPriceReturnPct)}`}>{fmtPct(sp.yearOverYearPriceReturnPct) ?? "—"}</span></div>
          </div>
          <div className="mt-3"><SourceList refs={sp.dataSources.slice(0, 1)} /></div>
        </Panel>

        <Panel kicker="Volatility" title="VIX">
          <Stat label="Close" value={fmtNum(s.washout.vixClose)} size="lg" valueClass={s.washout.vixClose !== null && s.washout.vixClose >= 30 ? "text-caution" : undefined}
                sub={s.washout.vixClose === null ? undefined : s.washout.vixClose >= 30 ? "At or above 30" : s.washout.vixClose >= 20 ? "Between 20 and 30" : "Below 20"} />
          <div className="mt-3 space-y-1 text-2xs">
            <div className="flex justify-between"><span className="text-ivory-500">RSI(14) S&P 500</span><span className="num font-mono text-ivory-100">{fmtNum(sp.rsi14) ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-ivory-500">Drawdown from peak</span><span className={`num font-mono ${tone(sp.pctDrawdownFromClosingPeak)}`}>{fmtPct(sp.pctDrawdownFromClosingPeak) ?? "—"}</span></div>
          </div>
          <div className="mt-3"><SourceRef refKey={s.washout.vixSource} /></div>
        </Panel>

        <Panel kicker="Market regime" title={s.marketRegime.name}>
          <div className="label mb-1">Rule result (recomputed)</div>
          <div className={`font-mono text-[22px] leading-8 ${regime.label === "DEFENSIVE" ? "text-down" : regime.label === "NOT DEFENSIVE" ? "text-up" : "text-ivory-500"}`}>{regime.label}</div>
          <div className="mt-1 text-2xs text-ivory-500">{regime.belowCount} of 3 below their 200-day SMA{regime.missing.length ? `; missing ${regime.missing.join(", ")}` : ""}</div>
          <div className="mt-3 flex gap-1.5">
            {regime.instruments.map((i) => (
              <Badge key={i.symbol} tone={i.side === "below" ? "down" : i.side === "above" ? "up" : "muted"}>{i.symbol} {i.side === "below" ? "▼" : i.side === "above" ? "▲" : "?"}</Badge>
            ))}
          </div>
          <div className="mt-3 text-2xs text-ivory-600">
            {regime.agreesWithReported === false ? <span className="text-down">Disagrees with reported label “{regime.reportedLabel}”.</span> : "Matches the reported label. "}
            <a className="link" href={href("regime")}>Detail</a>
          </div>
        </Panel>

        <Panel kicker="Data freshness" title={fmtDate(s.snapshot.equityTradingDate)}>
          <div className={`text-[13px] ${fr.stale ? "text-caution" : "text-up"}`}>{fr.headline}</div>
          <div className="mt-3 space-y-1 text-2xs">
            <div className="flex justify-between gap-2"><span className="text-ivory-500">Last completed session</span><span className="whitespace-nowrap font-mono text-ivory-100">{fmtDate(fr.expectedSession, { month: "short", day: "numeric" })}</span></div>
            <div className="flex justify-between gap-2"><span className="text-ivory-500">Data mode</span><span className="font-mono text-ivory-100">{fr.mode}</span></div>
            <div className="flex justify-between gap-2"><span className="text-ivory-500">Served from</span><span className="text-right text-ivory-300">{data.current?.sourceLabel}</span></div>
            <div className="flex justify-between gap-2"><span className="text-ivory-500">Collection</span><span className="truncate text-right text-ivory-300">{humanizeStatus(s.snapshot.collectionMethod)}</span></div>
            <div className="flex justify-between gap-2"><span className="text-ivory-500">Last automated run</span><span className="font-mono text-ivory-100">{fmtInstant(s.snapshot.lastSuccessfulAutomatedRunUtc, tz) ?? "Never"}</span></div>
          </div>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Panel className="lg:col-span-2" kicker="Watchlist" title="Session closes" right={<a className="link" href={href("watchlist")}>All detail</a>} pad={false}>
          <div className="overflow-x-auto">
            <table className="tbl w-full text-[13px]">
              <thead><tr><th>Symbol</th><th className="hidden sm:table-cell">Company</th><th className="text-right">Close</th><th className="text-right">1-day</th><th className="hidden text-right md:table-cell">RSI(14)</th><th className="hidden md:table-cell">Research</th></tr></thead>
              <tbody>
                {s.watchlist.map((w) => (
                  <tr key={w.symbol} className="hover:bg-ink-850">
                    <td><a className="font-mono text-ivory-50 hover:text-brass-300" href={href(`stock/${w.symbol}`)}>{w.symbol}</a></td>
                    <td className="hidden text-ivory-500 sm:table-cell">{w.company}</td>
                    <td className="num text-right font-mono text-ivory-50">{fmtUsd(w.regularSessionClose) ?? <Missing compact />}</td>
                    <td className={`num text-right font-mono ${tone(w.oneDayChangePct)}`}>{fmtPct(w.oneDayChangePct) ?? <Missing compact />}</td>
                    <td className="num hidden text-right font-mono md:table-cell">{fmtNum(w.technicalIndicators.rsi14) ?? <Missing compact reason={w.technicalIndicators.sma200Availability} />}</td>
                    <td className="hidden md:table-cell"><Badge tone={w.research.status === "not_researched" ? "muted" : "brass"}>{humanizeStatus(w.research.status)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {movers[0] && (
            <div className="border-t border-ink-800 px-4 py-2.5 text-2xs text-ivory-500">
              Largest move: <span className="font-mono text-ivory-100">{movers[0].symbol}</span> <span className={tone(movers[0].oneDayChangePct)}>{fmtPct(movers[0].oneDayChangePct)}</span> on {fmtDate(movers[0].closeDate)}.
              All four closed {s.watchlist.every((w) => (w.oneDayChangePct ?? 0) < 0) ? "lower" : "mixed"} on the session.
            </div>
          )}
        </Panel>

        <Panel kicker="Signals" title="Signal readiness">
          <ul className="space-y-3 text-[13px]">
            <SignalRow label="Three Horsemen" to="regime" state={regime.label} tone={regime.label === "DEFENSIVE" ? "down" : regime.label === "INDETERMINATE" ? "muted" : "up"} note="Rules-based, recomputed" />
            <SignalRow label="Washout score" to="washout" state={isSignalUnblocked(s, "washout.score") && s.washout.score !== null ? String(s.washout.score) : "Rule not defined"} tone="caution" note={humanizeStatus(s.washout.scoreStatus) ?? ""} />
            <SignalRow label="Club 30/30" to="club3030" state={s.club3030.requiredRuleDefinition ? "Defined" : "Rule not defined"} tone="caution" note={humanizeStatus(s.club3030.status) ?? ""} />
            <SignalRow label="Real 2Y yield trend" to="macro" state={s.macroAndConfirmation.real2YearYieldTrend ?? "Missing"} tone="muted" note={humanizeStatus(s.macroAndConfirmation.realYieldStatus) ?? ""} />
            <SignalRow label="Zweig breadth thrust" to="macro" state={s.macroAndConfirmation.nasdaqBreadth.zweigBreadthThrustConfirmed === null ? "Not evaluated" : s.macroAndConfirmation.nasdaqBreadth.zweigBreadthThrustConfirmed ? "Confirmed" : "Not confirmed"} tone="muted" note="Null in snapshot" />
          </ul>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Panel className="lg:col-span-2" kicker="Important changes" title={prev?.snapshot ? `Since ${fmtDate(prev.entry.equityTradingDate)} (${humanizeStatus(prev.entry.equitySession)})` : "Since previous snapshot"}
               right={<a className="link" href={href("history")}>Compare sessions</a>}>
          {changes === null ? (
            <div className="space-y-4">
              <p className="text-xs text-ivory-500">
                {archive === null ? "Loading archive…" : "This is the first archived snapshot, so there is no earlier session to compare against. Session-to-session changes appear here after the next successful run."}
              </p>
              <div>
                <div className="label mb-2">Corrections recorded in this snapshot</div>
                <ul className="space-y-2">
                  {s.validation.warnings.map((w, i) => (
                    <li key={i} className="flex gap-3 text-xs leading-relaxed text-ivory-300"><span className="font-mono text-brass-500">{String(i + 1).padStart(2, "0")}</span>{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : changes.length === 0 ? (
            <p className="text-xs text-ivory-500">No material field changes between the two snapshots.</p>
          ) : (
            <ul className="divide-y divide-ink-800">
              {changes.map((c) => (
                <li key={c.path} className="flex items-baseline justify-between gap-3 py-1.5 text-xs">
                  <span className="truncate font-mono text-ivory-300">{c.path}</span>
                  <span className="num shrink-0 font-mono text-ivory-500">{String(c.before ?? "∅")} → <span className="text-ivory-50">{String(c.after ?? "∅")}</span>
                    {c.deltaPct !== null && <span className={`ml-2 ${tone(c.delta)}`}>{fmtPct(c.deltaPct)}</span>}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel kicker="Integrity" title="Validation">
          <div className="space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-ivory-500">Schema</span><Badge tone="up">Passed</Badge></div>
            <div className="flex justify-between"><span className="text-ivory-500">Recomputed values</span>{warnings.length === 0 ? <Badge tone="up">All consistent</Badge> : <Badge tone="caution">{warnings.length} warning{warnings.length > 1 ? "s" : ""}</Badge>}</div>
            <div className="flex justify-between"><span className="text-ivory-500">Sources in ledger</span><span className="font-mono text-ivory-100">{Object.keys(s.sources).length}</span></div>
            <div className="flex justify-between"><span className="text-ivory-500">Blocked signal fields</span><span className="font-mono text-ivory-100">{s.validation.blockedFromAutomatedTradeSignals.length}</span></div>
            <div className="flex justify-between"><span className="text-ivory-500">Quality</span><span className="text-right text-ivory-300">{humanizeStatus(s.snapshot.quality)}</span></div>
          </div>
          <div className="mt-4 border-t border-ink-800 pt-3">
            <div className="label mb-2">Next scheduled updates</div>
            <ul className="space-y-1 text-2xs">
              {fr.nextRuns.slice(0, 3).map((r) => (
                <li key={r.at.toISOString()} className="flex justify-between gap-2"><span className="text-ivory-500">{r.job.name === "opening_snapshot" ? "Opening" : "Closing"}</span><span className="font-mono text-ivory-300">{fmtInstant(r.at, tz)}</span></li>
              ))}
            </ul>
            <div className="mt-2 text-2xs text-ivory-600">
              {data.status?.automationEnabled ? "Automation enabled." : "Automation not connected yet; schedule shown for reference."} <a className="link" href={href("system")}>Status</a>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

function SignalRow({ label, state, note, to, tone }: { label: string; state: string; note: string; to: string; tone: "up" | "down" | "muted" | "caution" }) {
  return (
    <li>
      <a href={href(to)} className="group block">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-ivory-100 group-hover:text-brass-300">{label}</span>
          <Badge tone={tone}>{state}</Badge>
        </div>
        {note && <div className="mt-0.5 text-2xs text-ivory-600">{note}</div>}
      </a>
    </li>
  );
}
