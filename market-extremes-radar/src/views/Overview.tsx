import { useMemo, useState } from "react";
import { IndicatorChart, PriceChart } from "../components/charts";
import { Badge, Card, Info, Provenance, SegmentedControl, Stat, toneOf, type Tone } from "../components/ui";
import { assetClassLabel, fmtMarketDate, fmtNum, fmtPct, fmtSigned } from "../lib/format";
import type { ConditionLabel } from "../lib/rules";
import { RULES } from "../lib/rules";
import { activeNow } from "../lib/scanner";
import { useData } from "../state";

export const CONDITION_TONE: Record<ConditionLabel, Tone> = {
  "Extreme Stress": "risk",
  "Elevated Stress": "gold",
  "Recovery Watch": "gain",
  "Upside Extension": "gold",
  Normal: "paper",
  "Insufficient Data": "muted",
};

const RANGES = [
  { value: "126", label: "6M" },
  { value: "252", label: "1Y" },
  { value: "504", label: "2Y" },
  { value: "1260", label: "5Y" },
] as const;

export default function Overview() {
  const { dataset, analytics } = useData();
  const [range, setRange] = useState<(typeof RANGES)[number]["value"]>("252");
  const f = analytics!.frame;
  const ds = dataset!;
  const cond = analytics!.condition;
  const i = f.dates.length - 1;
  const n = Number(range);

  const chartData = useMemo(() => {
    const s = Math.max(0, f.dates.length - n);
    return f.dates.slice(s).map((d, k) => ({
      date: d,
      close: f.close[s + k],
      sma20: f.sma20[s + k],
      sma50: f.sma50[s + k],
      sma200: f.sma200[s + k],
      rsi14: f.rsi14[s + k],
      z50: f.z50[s + k],
      vix: f.vix[s + k],
    }));
  }, [f, n]);

  const vsMa = (m: number | null) => (m === null ? null : f.close[i] / m - 1);
  const active = activeNow(f).filter((a) => a.active === true);
  const tone = CONDITION_TONE[cond.label];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Market condition" subtitle={`Rule-based label for the ${fmtMarketDate(f.dates[i])} close. Not a forecast or a probability.`}>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <div data-testid="condition-label" className={`font-serif text-3xl sm:text-4xl ${tone === "risk" ? "text-risk" : tone === "gold" ? "text-gold" : tone === "gain" ? "text-gain" : "text-paper"}`}>
              {cond.label}
            </div>
            <span className="text-sm text-muted">{cond.reason}</span>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="py-1.5 pr-3 font-medium">Input</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Value</th>
                  <th className="py-1.5 pr-3 font-medium">Extreme rule</th>
                  <th className="py-1.5 pr-3 font-medium">Elevated rule</th>
                  <th className="py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {cond.extreme.map((x, k) => {
                  const el = cond.elevated[k];
                  const isPct = x.key === "ret5" || x.key === "dd252";
                  return (
                    <tr key={x.key} className="border-b border-line/50 last:border-0">
                      <td className="py-1.5 pr-3 text-paper/90">{x.label}</td>
                      <td className="num py-1.5 pr-3 text-right">{isPct ? fmtPct(x.value) : fmtNum(x.value, x.key === "z50" ? 2 : 1)}</td>
                      <td className="num py-1.5 pr-3 text-muted">{x.rule.replace(x.label, "").trim()}</td>
                      <td className="num py-1.5 pr-3 text-muted">{el.rule.replace(el.label, "").trim()}</td>
                      <td className="py-1.5">
                        {x.hit === null ? <Badge>Unavailable</Badge> : x.hit ? <Badge tone="risk">Extreme</Badge> : el.hit ? <Badge tone="gold">Elevated</Badge> : <Badge>Normal</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            Rule order: Extreme Stress if {RULES.extremeCountForLabel}+ extreme flags · Recovery Watch if Extreme Stress in the prior {RULES.recovery.lookback} sessions and close ≥ SMA20 · Elevated Stress if 1+ extreme or {RULES.elevatedCountForLabel}+ elevated flags · Upside Extension if z50 ≥ +2 and RSI ≥ 70 · otherwise Normal.
          </p>
        </Card>

        <Card className="lg:col-span-2" title={ds.index.name} right={<Badge>{assetClassLabel(ds.index.assetClass)}</Badge>}>
          <Stat large label="Close" value={fmtNum(f.close[i])} sub={fmtMarketDate(f.dates[i])} />
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Stat label="Daily change" value={fmtPct(f.ret1[i], 2)} tone={toneOf(f.ret1[i])} />
            <Stat label="Month to date" value={fmtPct(f.mtd[i], 2)} tone={toneOf(f.mtd[i])} info="Change versus the last close of the previous calendar month." />
            <Stat label="From 252-session high" value={fmtPct(f.dd252[i])} tone={toneOf(f.dd252[i])} info="Drawdown from the highest close of the last 252 sessions (about one year), including today." />
            <Stat label="From all-time closing high" value={fmtPct(f.ddAth[i])} tone={toneOf(f.ddAth[i])} info={`Drawdown from the highest close in the dataset (since ${f.dates[0]}).`} />
          </div>
          <Provenance className="mt-4" series={ds.index} />
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {([
          ["20-day SMA", f.sma20[i]],
          ["50-day SMA", f.sma50[i]],
          ["200-day SMA", f.sma200[i]],
        ] as const).map(([label, m]) => (
          <Card key={label}>
            <Stat label={label} value={fmtNum(m)} sub={<span className={toneOf(vsMa(m)) === "risk" ? "text-risk" : "text-gain"}>Close {fmtPct(vsMa(m))} vs average</span>} info="Simple moving average of the last N closes, including today. Shown as a dash until N closes exist." />
          </Card>
        ))}
        <Card>
          <Stat label="RSI (14)" value={fmtNum(f.rsi14[i], 1)} tone={f.rsi14[i] !== null && f.rsi14[i]! <= 30 ? "risk" : f.rsi14[i] !== null && f.rsi14[i]! >= 70 ? "gold" : "paper"} sub="≤ 30 oversold · ≥ 70 overbought" info="Wilder's RSI over 14 sessions: the first average is a simple mean of 14 gains/losses, then smoothed as (previous × 13 + today) / 14." />
        </Card>
        <Card>
          <Stat label="50-day z-score" value={fmtSigned(f.z50[i])} tone={f.z50[i] !== null && Math.abs(f.z50[i]!) >= 2 ? "risk" : "paper"} sub="Std. deviations from SMA50" info="(Close − SMA50) ÷ standard deviation of the same 50 closes (population SD). −2 means the close is two standard deviations below its 50-day mean." />
        </Card>
        <Card>
          <Stat
            label={ds.vol ? "VIX" : "Volatility index"}
            value={fmtNum(f.vix[i])}
            tone={f.vix[i] !== null && f.vix[i]! >= 30 ? "risk" : f.vix[i] !== null && f.vix[i]! >= 20 ? "gold" : "paper"}
            sub={f.vixPct[i] === null ? "Percentile unavailable" : `${fmtPct(f.vixPct[i], 0, false)} historical percentile`}
            info={`Share of all VIX closes from ${f.firstVolDate ?? "the first available date"} up to this date that were at or below today's close. Uses history to date only.`}
          />
        </Card>
      </div>

      <Card
        title="Price and moving averages"
        right={<SegmentedControl label="Chart range" value={range} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} onChange={setRange} />}
      >
        <PriceChart data={chartData} />
        <div className="mt-2 grid gap-2 lg:grid-cols-3">
          <div>
            <p className="px-1 text-[11px] uppercase tracking-wider text-muted">RSI (14)</p>
            <IndicatorChart data={chartData} dataKey="rsi14" name="RSI14" domain={[0, 100]} refs={[{ y: 70, label: "70", tone: "muted" }, { y: 30, label: "30", tone: "risk" }]} />
          </div>
          <div>
            <p className="px-1 text-[11px] uppercase tracking-wider text-muted">50-day z-score</p>
            <IndicatorChart data={chartData} dataKey="z50" name="z50" digits={2} refs={[{ y: 2, label: "+2", tone: "muted" }, { y: -2, label: "−2", tone: "risk" }]} />
          </div>
          <div>
            <p className="px-1 text-[11px] uppercase tracking-wider text-muted">VIX</p>
            <IndicatorChart data={chartData} dataKey="vix" name="VIX" color="#7C93B0" refs={[{ y: 30, label: "30", tone: "risk" }, { y: 20, label: "20", tone: "muted" }]} />
          </div>
        </div>
        {ds.vol && <Provenance className="mt-2" series={ds.vol} />}
      </Card>

      <Card title="Active scanner triggers" subtitle="Conditions true at the latest close." right={<a href="#/scanner" className="text-xs text-gold hover:underline">Open scanner →</a>}>
        {active.length === 0 ? (
          <p className="text-sm text-muted">No triggers active.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {active.map((a) => (
              <li key={a.trigger.id}>
                <Badge className="whitespace-normal text-left" tone={a.trigger.family === "upside" || a.trigger.family === "volatility" ? "gold" : "risk"} title={a.trigger.formula}>
                  {a.trigger.name} · {a.trigger.threshold}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {f.alignment && f.alignment.missingInOther.length > 0 && (
          <p className="mt-3 text-[11px] text-muted">
            Date alignment: {f.alignment.missingInOther.length} index sessions have no volatility close and are shown as unavailable (never forward-filled)
            {f.alignment.missingInOther.length <= 5 ? `: ${f.alignment.missingInOther.join(", ")}` : ""}.
            <Info text="The index and VIX are joined on exact market dates. A missing VIX value is left blank rather than copied from the previous day." />
          </p>
        )}
      </Card>
    </div>
  );
}
