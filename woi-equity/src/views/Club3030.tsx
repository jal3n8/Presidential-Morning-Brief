import { Badge, KV, Missing, PageHeader, Panel, SectionNote, SourceList, useSnapshot } from "../components/ui";
import { fmtDate, fmtPct, humanizeStatus } from "../lib/format";
import { isSignalUnblocked } from "../lib/validate";
import { weekday } from "../lib/calendar";

export function Club3030() {
  const s = useSnapshot();
  const c = s.club3030;
  const sp = s.washout.sp500;
  const defined = c.requiredRuleDefinition !== null;
  const unblocked = isSignalUnblocked(s, "club3030.triggered");
  const active = defined && unblocked;
  const isFriday = weekday(s.snapshot.equityTradingDate) === 5;

  return (
    <>
      <PageHeader kicker="Module 05" title="Club 30/30 Monitor">
        <Badge tone={active ? "brass" : "muted"}>{active ? "Signal active" : "Signal inactive"}</Badge>
      </PageHeader>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel kicker="Status" title="Signal" className="lg:col-span-1">
          {active ? (
            <>
              <div className={`font-mono text-[28px] ${c.triggered ? "text-caution" : "text-ivory-300"}`}>{c.triggered === null ? "Not evaluated" : c.triggered ? "Triggered" : "Not triggered"}</div>
              <SectionNote>Evaluated by the pipeline against the rule definition shown.</SectionNote>
            </>
          ) : (
            <>
              <div className="inline-block border border-caution/50 px-2 py-1 font-mono text-[15px] tracking-label text-caution">RULE NOT DEFINED</div>
              <div className="mt-1 font-mono text-[10px] tracking-label text-ivory-500">TRIGGER: NULL · NOT “FALSE”</div>
              <div className="mt-2 text-xs text-ivory-300">{humanizeStatus(c.status)}</div>
              {c.note && <SectionNote>{c.note}</SectionNote>}
              <div className="mt-3 text-2xs text-ivory-600">
                The monitor will not show triggered / not triggered until the snapshot carries an exact rule in <span className="font-mono">club3030.requiredRuleDefinition</span> and
                <span className="font-mono"> club3030.triggered</span> is removed from the blocked-signal list.
              </div>
            </>
          )}
        </Panel>

        <Panel kicker="Observed inputs" title="Known facts for this session" className="lg:col-span-2">
          <KV rows={[
            ["Session", fmtDate(s.snapshot.equityTradingDate, { weekday: "long", month: "short", day: "numeric", year: "numeric" })],
            ["Friday close (snapshot)", c.isFridayClose === null ? <Missing compact /> : c.isFridayClose ? "Yes" : "No"],
            ["Friday close (exchange calendar)", isFriday ? "Yes" : "No"],
            ["S&P 500 year-over-year", fmtPct(sp.yearOverYearPriceReturnPct) ?? <Missing compact />],
            ["Comparison date", fmtDate(sp.oneYearComparisonDate) ?? <Missing compact />],
            ["Year-over-year positive", c.sp500YearOverYearPositive === null ? <Missing compact /> : c.sp500YearOverYearPositive ? "Yes" : "No"],
          ]} />
          <div className="mt-3"><SourceList refs={["sp500_close", "sp500_prev_year"].filter((k) => k in s.sources)} /></div>
        </Panel>
      </div>

      <Panel className="mt-3" kicker="Definition" title="Rule definition">
        {defined ? (
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-ivory-100">{typeof c.requiredRuleDefinition === "string" ? c.requiredRuleDefinition : JSON.stringify(c.requiredRuleDefinition, null, 2)}</pre>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="font-mono text-sm text-ivory-500">null</div>
              <SectionNote>No rule is defined, so the monitor is disabled. The two inputs above are recorded because the snapshot tracks them, not because they are known to be the rule.</SectionNote>
            </div>
            <div>
              <div className="label mb-2">To activate, the definition needs to state</div>
              <ul className="space-y-1.5 text-xs text-ivory-300">
                {[
                  "Which series each “30” refers to and its units",
                  "Each threshold and whether it is inclusive",
                  "Lookback windows and the calendar used",
                  "When it is evaluated (for example, Friday closes only)",
                  "What resets or expires the signal",
                  "The data source for every input",
                ].map((t) => <li key={t} className="flex gap-2"><span className="text-brass-500">·</span>{t}</li>)}
              </ul>
            </div>
          </div>
        )}
      </Panel>
    </>
  );
}
