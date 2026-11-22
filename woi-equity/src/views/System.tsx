import { useState } from "react";
import type { LoadedSnapshot, TerminalState } from "../lib/dataClient";
import { POLL_MS } from "../lib/dataClient";
import { Badge, KV, PageHeader, Panel, SectionNote, useSnapshot } from "../components/ui";
import { addDays, sessionInfo, wallClock, MARKET_TZ } from "../lib/calendar";
import { freshness } from "../lib/freshness";
import { fmtDate, fmtInstant, humanizeStatus } from "../lib/format";
import { snapshotIdOf } from "../lib/snapshotOrder";

const CONNECTIONS: [string, string][] = [
  ["ingestEndpoint", "Server ingest endpoint (Hostinger)"],
  ["gemini", "Gemini research agent"],
  ["marketData", "Market-price provider"],
  ["secEdgar", "SEC EDGAR filings"],
  ["googleDrive", "Google Drive archive"],
  ["googleSheets", "Google Sheets latest/log"],
];

const METHODS: [string, string][] = [
  ["Equity prices", "Regular-session close at 4:00 p.m. ET (1:00 p.m. on early-close days). One-day change is versus the prior regular-session close."],
  ["Bitcoin", "UTC calendar-day candle close, not aligned to the equity close."],
  ["200-day SMA", "Simple mean of the last 200 completed regular sessions. Not computed with fewer than 200 sessions (SPCX listed June 12, 2026)."],
  ["RSI (14)", "Wilder’s smoothing over 14 sessions."],
  ["Drawdown", "Close versus the highest prior daily close."],
  ["S&P 500 year over year", "^GSPC close versus the ^GSPC close one year earlier (not SPY)."],
  ["Three Horsemen", "DEFENSIVE only when SPY, QQQ and IWM all close below their own same-date 200-session SMA. Recomputed in the browser on every load."],
  ["Washout score / Club 30/30", "Not computed. Shown as Rule not defined until an exact formula is published in the data."],
  ["Adjustments", "Provider SMA methods can differ (adjusted vs unadjusted closes); each source is recorded beside the value it supports."],
];

export function System({ data, shown, now }: { data: TerminalState; shown: LoadedSnapshot; now: Date }) {
  const s = useSnapshot();
  const tz = s.snapshot.displayTimezone;
  const fr = freshness(s, now);
  const st = data.status;
  const issues = shown.issues;
  const [showRaw, setShowRaw] = useState(false);

  const today = wallClock(now, MARKET_TZ).date;
  const exceptions: { date: string; text: string; closed: boolean }[] = [];
  for (let i = 0; i < 120; i++) {
    const d = addDays(today, i);
    const info = sessionInfo(d);
    if (info.reason && info.reason !== "Weekend") exceptions.push({ date: d, text: info.reason, closed: !info.isTradingDay });
  }

  return (
    <>
      <PageHeader kicker="Audit" title="Audit & Data">Sources, conventions, validation and update log</PageHeader>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel kicker="Feed" title="Data sources">
          <ul className="space-y-2.5">
            {data.sources.map((r) => (
              <li key={r.id} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ivory-100">{r.label}</span>
                  <Badge tone={r.state === "ok" ? "up" : r.state === "absent" ? "muted" : "down"}>{r.state === "ok" ? "OK" : r.state === "absent" ? "Not set up" : r.state}</Badge>
                </div>
                {r.detail && <div className="mt-0.5 text-2xs text-ivory-600">{r.detail}</div>}
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-ink-800 pt-3">
            <KV rows={[
              ["On screen", <span>{shown.sourceLabel}</span>],
              ["Snapshot id", snapshotIdOf(s)],
              ["Auto-refresh", data.autoRefresh ? `every ${Math.round(POLL_MS / 60000)} min` : "off"],
              ["Last checked", fmtInstant(data.lastCheckedAt, tz) ?? "—"],
            ]} />
          </div>
        </Panel>

        <Panel kicker="Updates" title="Automation status" right={<Badge tone={st?.automationEnabled ? "up" : "muted"}>{st?.automationEnabled ? "Enabled" : "Not connected"}</Badge>}>
          {st ? (
            <>
              <KV rows={[
                ["Last update attempt", st.lastRun ? `${humanizeStatus(st.lastRun.job)} · ${st.lastRun.result}` : "None yet"],
                ["Last good update", fmtInstant(st.lastSuccessUtc, tz) ?? "None yet"],
                ["Failures in a row", st.consecutiveFailures],
              ]} />
              <div className="mt-3 space-y-1">
                {CONNECTIONS.map(([k, label]) => (
                  <div key={k} className="flex items-center justify-between gap-2 text-2xs">
                    <span className="text-ivory-500">{label}</span>
                    <Badge tone={st.configuredConnections[k] ? "up" : "muted"}>{st.configuredConnections[k] ? "Connected" : "Not connected"}</Badge>
                  </div>
                ))}
              </div>
            </>
          ) : <SectionNote>No status file found.</SectionNote>}
        </Panel>

        <Panel kicker="Schedule" title="Planned update times" right="ET calendar">
          <ul className="space-y-1.5 text-xs">
            {fr.nextRuns.map((r) => (
              <li key={r.at.toISOString()} className="flex justify-between gap-2">
                <span className="text-ivory-500">{r.job.name === "opening_snapshot" ? "Opening" : "Closing"}</span>
                <span className="font-mono text-ivory-100">{fmtInstant(r.at, tz)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 text-2xs text-ivory-600">09:40 and 16:15 New York time on trading days; the closing run moves to 13:15 on early-close days.</div>
          <div className="label mb-1.5 mt-4">Exchange calendar, next 120 days</div>
          <ul className="space-y-1 text-2xs">
            {exceptions.length === 0 && <li className="text-ivory-600">No holidays or early closes.</li>}
            {exceptions.map((e) => (
              <li key={e.date} className="flex justify-between gap-2"><span className="font-mono text-ivory-300">{fmtDate(e.date, { weekday: "short", month: "short", day: "numeric" })}</span><span className={e.closed ? "text-right text-ivory-500" : "text-right text-caution"}>{e.closed ? "Closed · " : "1 p.m. close · "}{e.text}</span></li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel className="mt-3" kicker="Update log" title="Recent update attempts" pad={false}>
        {!st || st.recentRuns.length === 0 ? <div className="p-4"><SectionNote>No automated or manual update has run yet. Failed attempts will be listed here with their reason; a failed attempt never replaces the last good snapshot.</SectionNote></div> : (
          <div className="overflow-x-auto">
            <table className="tbl w-full text-xs">
              <thead><tr><th>Started</th><th>Job</th><th>Result</th><th>Snapshot</th><th>Reason</th></tr></thead>
              <tbody>
                {st.recentRuns.slice().reverse().map((r, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap font-mono text-ivory-300">{fmtInstant(r.startedAtUtc, tz)}</td>
                    <td className="text-ivory-300">{r.job}</td>
                    <td><Badge tone={r.result === "success" ? "up" : r.result === "failed" ? "down" : "muted"}>{r.result}</Badge></td>
                    <td className="font-mono text-ivory-300">{r.snapshotId ?? "—"}</td>
                    <td className="text-ivory-500">{r.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel kicker="Validation" title={`Checks on this snapshot · ${issues.length} note${issues.length === 1 ? "" : "s"}`}>
          {issues.length === 0 ? (
            <SectionNote>Schema passed, and every recomputed value (percent distances, drawdown, year-over-year return, breadth arithmetic, regime label, source references, trading dates) matches the reported value.</SectionNote>
          ) : (
            <ul className="space-y-1 font-mono text-2xs">
              {issues.map((i, n) => <li key={n}><Badge tone={i.level === "warning" ? "caution" : i.level === "error" ? "down" : "muted"}>{i.level}</Badge> <span className="text-ivory-300">{i.path}</span> <span className="text-ivory-500">{i.message}</span></li>)}
            </ul>
          )}
          <div className="label mb-1.5 mt-4">Data-quality warnings in the file</div>
          <ul className="space-y-1.5 text-xs text-ivory-300">{s.validation.warnings.map((w, i) => <li key={i} className="flex gap-2"><span className="text-brass-500">·</span>{w}</li>)}</ul>
          <div className="label mb-1.5 mt-4">Blocked from signals</div>
          <ul className="space-y-1 font-mono text-2xs text-ivory-300">{s.validation.blockedFromAutomatedTradeSignals.map((b) => <li key={b}>{b}</li>)}</ul>
        </Panel>

        <Panel kicker="Methodology" title="Conventions and formulas">
          <KV rows={METHODS.map(([k, v]) => [k, <span className="block max-w-md text-left font-sans text-xs leading-relaxed text-ivory-300">{v}</span>])} />
        </Panel>
      </div>

      <Panel className="mt-3" kicker="Raw" title="Snapshot JSON as received" right={<button className="btn px-2 py-1" onClick={() => setShowRaw((v) => !v)}>{showRaw ? "Hide" : "Show"}</button>}>
        {showRaw ? <pre className="max-h-[480px] overflow-auto font-mono text-[11px] leading-relaxed text-ivory-300">{JSON.stringify(shown.raw, null, 2)}</pre>
          : <SectionNote>The unmodified file, including every null and source key.</SectionNote>}
      </Panel>
    </>
  );
}
