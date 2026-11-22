import { KV, Missing, PageHeader, Panel, SectionNote, SourceRef, Stat, useSnapshot, Badge } from "../components/ui";
import { fmtDate, fmtNum, fmtSigned, fmtUsd, humanizeStatus } from "../lib/format";

export function Macro() {
  const s = useSnapshot();
  const m = s.macroAndConfirmation;
  const b = m.nasdaqBreadth;
  const btc = m.bitcoin;
  const total = b.new52WeekHighs !== null && b.new52WeekLows !== null ? b.new52WeekHighs + b.new52WeekLows : null;
  const highShare = total ? (b.new52WeekHighs! / total) * 100 : null;

  return (
    <>
      <PageHeader kicker="Module 06" title="Macro Intelligence">Rates, breadth and crypto confirmation</PageHeader>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Panel kicker="Rates" title="US Treasury 2-year">
          <Stat label="Nominal par yield" value={m.nominalUsTreasury2YearYieldPct !== null ? `${fmtNum(m.nominalUsTreasury2YearYieldPct)}%` : null} size="lg" sub={`Official daily par yield curve, ${fmtDate(s.snapshot.equityTradingDate)}`} source={m.nominalYieldSource} />
        </Panel>

        <Panel kicker="Rates" title="Real 2-year yield">
          <KV rows={[
            ["3-month change", m.real2YearYieldThreeMonthChangeBps !== null ? `${fmtSigned(m.real2YearYieldThreeMonthChangeBps)} bp` : <Missing compact />],
            ["Trend", m.real2YearYieldTrend ?? <Missing compact />],
          ]} />
          <div className="mt-3"><SectionNote>{humanizeStatus(m.realYieldStatus) ?? "Not supplied."} Treasury publishes real (TIPS) par yields starting at the 5-year maturity, so a 2-year real yield needs a separately defined series.</SectionNote></div>
        </Panel>

        <Panel kicker="Breadth" title="Nasdaq new highs / lows" className="xl:col-span-2">
          <div className="grid grid-cols-3 gap-4">
            <Stat label="52-wk highs" value={fmtNum(b.new52WeekHighs, 0)} valueClass="text-up" />
            <Stat label="52-wk lows" value={fmtNum(b.new52WeekLows, 0)} valueClass="text-down" />
            <Stat label="Highs − lows" value={fmtSigned(b.newHighMinusNewLow)} valueClass={b.newHighMinusNewLow !== null && b.newHighMinusNewLow < 0 ? "text-down" : "text-up"} />
          </div>
          {highShare !== null && (
            <div className="mt-4">
              <div className="flex h-2 w-full overflow-hidden" role="img" aria-label={`${highShare.toFixed(1)}% of extremes are new highs`}>
                <div className="bg-up/70" style={{ width: `${highShare}%` }} />
                <div className="flex-1 bg-down/60" />
              </div>
              <div className="mt-1 text-2xs text-ivory-500">New highs are {highShare.toFixed(1)}% of {total} issues at 52-week extremes.</div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="caution">{humanizeStatus(b.confidence) ?? "Confidence not stated"}</Badge>
            <span className="text-2xs text-ivory-500">Zweig breadth thrust: {b.zweigBreadthThrustConfirmed === null ? "not evaluated" : b.zweigBreadthThrustConfirmed ? "confirmed" : "not confirmed"}</span>
          </div>
          <div className="mt-2"><SourceRef refKey={b.source} /></div>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel kicker="Crypto" title={`Bitcoin · ${btc.symbol}`}>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Daily candle close" value={fmtUsd(btc.dailyCandleCloseUsd)} size="lg" sub={`UTC day ${fmtDate(btc.utcCandleDate) ?? "unknown"}`} />
            <div>
              <KV rows={[
                ["100-day SMA", fmtUsd(btc.sma100Usd) ?? <Missing compact />],
                ["200-day SMA", fmtUsd(btc.sma200Usd) ?? <Missing compact />],
                ["vs 100-day", btc.vsSma100 === null ? <Missing compact /> : String(btc.vsSma100)],
                ["vs 200-day", btc.vsSma200 === null ? <Missing compact /> : String(btc.vsSma200)],
              ]} />
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <SectionNote>Trend: {humanizeStatus(btc.smaStatus) ?? "Not supplied."}</SectionNote>
            {btc.note && <SectionNote>{btc.note}</SectionNote>}
          </div>
          <div className="mt-2"><SourceRef refKey={btc.source} /></div>
        </Panel>

        <Panel kicker="Read-through" title="What this page can and cannot say">
          <ul className="space-y-2 text-xs leading-relaxed text-ivory-300">
            <li>The 2-year nominal yield is the official Treasury par yield for the session.</li>
            <li>Breadth comes from a single vendor, flagged as single-source until a second source agrees.</li>
            <li>Bitcoin’s close is a UTC calendar-day candle, so it does not line up with the 4 p.m. ET equity close.</li>
            <li>Real-yield trend, Bitcoin moving averages and the breadth thrust stay empty until the pipeline has a consistent series for each.</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
