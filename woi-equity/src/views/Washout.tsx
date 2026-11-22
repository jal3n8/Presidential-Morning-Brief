import { useEffect, useMemo, useState } from "react";
import { Badge, KV, Missing, PageHeader, Panel, SectionNote, SourceList, SourceRef, Stat, useSnapshot, cx } from "../components/ui";
import { DEFAULT_WASHOUT_CONFIG, evaluateWashout, sanitizeConfig, type Criterion, type WashoutConfig } from "../lib/washout";
import { fmtNum, fmtPct, humanizeStatus, tone } from "../lib/format";
import { isSignalUnblocked } from "../lib/validate";

const KEY = "woi.washoutConfig.v1";

function loadConfig(): WashoutConfig {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? sanitizeConfig(JSON.parse(raw)) : DEFAULT_WASHOUT_CONFIG;
  } catch {
    return DEFAULT_WASHOUT_CONFIG;
  }
}

export function Washout() {
  const s = useSnapshot();
  const w = s.washout;
  const sp = w.sp500;
  const [cfg, setCfg] = useState<WashoutConfig>(loadConfig);
  const [showJson, setShowJson] = useState(false);
  const [importText, setImportText] = useState("");
  useEffect(() => {
    try { window.localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* storage unavailable; config lives for this visit */ }
  }, [cfg]);
  const ev = useMemo(() => evaluateWashout(cfg, s), [cfg, s]);
  const update = (id: string, patch: Partial<Criterion>) =>
    setCfg((c) => ({ ...c, criteria: c.criteria.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const reportedScoreVisible = isSignalUnblocked(s, "washout.score") && w.score !== null;

  return (
    <>
      <PageHeader kicker="Module 04" title="Washout Monitor">Stress and oversold observations</PageHeader>
      <div className="mb-3 border border-ink-700 bg-ink-900 px-4 py-3 font-serif text-[15px] text-ivory-100">
        {w.interpretation ?? "Observations only."}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel kicker="S&P 500" title="Oversold inputs" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="RSI (14)" value={fmtNum(sp.rsi14)} valueClass={sp.rsi14 !== null && sp.rsi14 <= 30 ? "text-caution" : undefined} sub={sp.rsi14 !== null ? (sp.rsi14 <= 30 ? "At or below 30" : "Above 30") : undefined} />
            <Stat label="Drawdown" value={fmtPct(sp.pctDrawdownFromClosingPeak)} valueClass={tone(sp.pctDrawdownFromClosingPeak)} sub={sp.previousHighestDailyClose !== null ? `Peak close ${fmtNum(sp.previousHighestDailyClose)}` : undefined} />
            <Stat label="vs 200-day SMA" value={fmtPct(sp.pctVsSma200)} valueClass={tone(sp.pctVsSma200)} sub={sp.sma200 !== null ? `SMA ${fmtNum(sp.sma200)}` : undefined} />
            <Stat label="VIX close" value={fmtNum(w.vixClose)} valueClass={w.vixClose !== null && w.vixClose >= 30 ? "text-caution" : undefined} />
          </div>
          <div className="mt-4 border-t border-ink-800 pt-3"><SourceList refs={[...sp.dataSources, w.vixSource]} /></div>
        </Panel>

        <Panel kicker="Volatility confirmation" title="Confirmation inputs">
          <KV rows={[
            ["5-day sigma", fmtNum(w.fiveDaySigma) ?? <Missing compact reason={w.fiveDaySigmaStatus} />],
            ["VIX cluster", w.vixCluster === null ? <Missing compact /> : String(w.vixCluster)],
            ["Realized vol stabilizing", w.vixRealizedStabilizing === null ? <Missing compact /> : w.vixRealizedStabilizing ? "Yes" : "No"],
          ]} />
          <div className="mt-3"><SectionNote>{humanizeStatus(w.fiveDaySigmaStatus)}</SectionNote></div>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Panel kicker="Published score" title="Snapshot washout score">
          {reportedScoreVisible ? (
            <Stat label="Score" value={String(w.score)} size="lg" />
          ) : (
            <>
              <div className="inline-block border border-caution/50 px-2 py-1 font-mono text-[15px] tracking-label text-caution">RULE NOT DEFINED</div>
              <div className="mt-1 font-mono text-[10px] tracking-label text-ivory-500">NOT VERIFIED · VALUE NULL</div>
              <div className="mt-2"><SectionNote>{humanizeStatus(w.scoreStatus) ?? "Score is on the blocked-signal list"}. An earlier value of 4 was removed because no formula backs it. Null is not shown as zero.</SectionNote></div>
            </>
          )}
        </Panel>

        <Panel kicker="Your formula" title={cfg.name} className="lg:col-span-2"
               right={<Badge tone={cfg.activated ? "brass" : "muted"}>{cfg.activated ? "Activated" : "Not activated"}</Badge>}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="label">Score</div>
              {ev.score === null ? (
                <div className="mt-1 font-mono text-[22px] text-ivory-500">Off</div>
              ) : (
                <div className="mt-1 font-mono text-[28px] leading-8 text-ivory-50">{fmtNum(ev.score, 0)}<span className="text-base text-ivory-500"> / {fmtNum(ev.maxAvailable, 0)} available</span></div>
              )}
              <div className="mt-1 text-2xs text-ivory-500">
                {ev.unavailableCount} of {ev.results.filter((r) => r.state !== "disabled").length} enabled criteria have no data ({fmtNum(ev.maxPossible, 0)} points possible when complete). Missing inputs never count as met.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={() => setCfg((c) => ({ ...c, activated: !c.activated, name: !c.activated && c.name.startsWith("Draft") ? "My washout formula" : c.name }))}>
                {cfg.activated ? "Deactivate" : "Activate my formula"}
              </button>
              <button className="btn" onClick={() => setCfg(DEFAULT_WASHOUT_CONFIG)}>Reset</button>
              <button className="btn" onClick={() => setShowJson((v) => !v)}>{showJson ? "Hide" : "Export / import"}</button>
            </div>
          </div>

          <div className="-mx-4 mt-4 overflow-x-auto">
            <table className="tbl w-full min-w-[620px] text-xs">
              <thead><tr><th>On</th><th>Criterion</th><th>Rule</th><th className="text-right">Weight</th><th className="text-right">Value</th><th>State</th></tr></thead>
              <tbody>
                {ev.results.map(({ criterion: c, value, state }) => (
                  <tr key={c.id}>
                    <td><input type="checkbox" checked={c.enabled} onChange={(e) => update(c.id, { enabled: e.target.checked })} className="accent-[#c2a874]" aria-label={`Enable ${c.label}`} /></td>
                    <td className="text-ivory-100">{c.label}<div className="font-mono text-[10px] text-ivory-700">{c.field}</div></td>
                    <td className="whitespace-nowrap">
                      {c.comparator === "is_true" ? <span className="text-ivory-500">is true</span> : (
                        <span className="inline-flex items-center gap-1">
                          <select value={c.comparator} onChange={(e) => update(c.id, { comparator: e.target.value as Criterion["comparator"] })} className="border border-ink-700 bg-ink-950 px-1 py-0.5 text-ivory-100">
                            <option value="<=">≤</option><option value=">=">≥</option>
                          </select>
                          <input type="number" step="any" value={c.threshold ?? ""} onChange={(e) => update(c.id, { threshold: e.target.value === "" ? null : Number(e.target.value) })}
                                 className="w-20 border border-ink-700 bg-ink-950 px-1.5 py-0.5 font-mono text-ivory-100" aria-label={`${c.label} threshold`} />
                          <span className="text-ivory-600">{c.unit}</span>
                        </span>
                      )}
                    </td>
                    <td className="text-right"><input type="number" min={0} step="any" value={c.weight} onChange={(e) => update(c.id, { weight: Math.max(0, Number(e.target.value) || 0) })} className="w-14 border border-ink-700 bg-ink-950 px-1.5 py-0.5 text-right font-mono text-ivory-100" aria-label={`${c.label} weight`} /></td>
                    <td className="num text-right font-mono text-ivory-100">{value === null || value === undefined ? <span className="text-ivory-600">—</span> : typeof value === "number" ? fmtNum(value) : String(value)}</td>
                    <td><span className={cx("font-mono text-[10px] uppercase tracking-label", state === "met" ? "text-caution" : state === "not_met" ? "text-ivory-500" : "text-ivory-700")}>{state.replace("_", " ")}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3"><SectionNote>
            Thresholds above are an editable draft, not a published methodology. The score is produced only after you activate it, is saved in this browser,
            and is labelled with your formula name. To make it the official score, export the JSON and add it to the pipeline config so every snapshot records it.
          </SectionNote></div>

          {showJson && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <div className="label mb-1">Current formula (copy)</div>
                <textarea readOnly value={JSON.stringify(cfg, null, 2)} className="input h-48 font-mono text-[11px]" />
              </div>
              <div>
                <div className="label mb-1">Import formula</div>
                <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste formula JSON" className="input h-40 font-mono text-[11px]" />
                <button className="btn mt-2" disabled={!importText.trim()} onClick={() => { try { setCfg(sanitizeConfig(JSON.parse(importText))); setImportText(""); } catch { alert("That is not valid JSON."); } }}>Load</button>
              </div>
            </div>
          )}
        </Panel>
      </div>
      <div className="mt-3 text-2xs text-ivory-600">VIX source: <SourceRef refKey={w.vixSource} /></div>
    </>
  );
}
