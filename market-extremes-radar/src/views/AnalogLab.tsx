import { useMemo, useState } from "react";
import { HistogramChart, HorizonChart, PathChart } from "../components/charts";
import { Badge, Button, Card, Field, inputCls, Notice, SegmentedControl, SortableTable, Stat, type Column } from "../components/ui";
import type { AnalogEvent, AnalogFilters, Horizon, StudyConfig } from "../lib/analogs";
import { describeFilters, filtersFromCurrent, filtersPredicate, histogram, HORIZONS, runStudy } from "../lib/analogs";
import { toCsv } from "../lib/csv";
import { fmtMarketDate, fmtNum, fmtPct, fmtSigned } from "../lib/format";
import { TRIGGER_BY_ID, TRIGGERS } from "../lib/rules";
import { downloadText } from "../lib/storage";
import { useData } from "../state";

function hashParams(): URLSearchParams {
  const q = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(q);
}

const pctCell = (x: number | null) => <span className={x === null ? "text-muted" : x >= 0 ? "text-gain" : "text-risk"}>{fmtPct(x, 2)}</span>;

export default function AnalogLab() {
  const { analytics, dataset } = useData();
  const f = analytics!.frame;
  const last = f.dates.length - 1;
  const params = hashParams();
  const initialTrigger = params.get("trigger");
  const [mode, setMode] = useState<"trigger" | "custom">(initialTrigger && TRIGGER_BY_ID[initialTrigger] ? "trigger" : "custom");
  const [triggerId, setTriggerId] = useState(initialTrigger && TRIGGER_BY_ID[initialTrigger] ? initialTrigger : "combo_oversold");
  const [filters, setFilters] = useState<AnalogFilters>(() => filtersFromCurrent(f));
  const [startDate, setStartDate] = useState(f.dates[0]);
  const [endDate, setEndDate] = useState(f.dates[last]);
  const [cooldown, setCooldown] = useState(20);
  const [dedupe, setDedupe] = useState(true);
  const [entry, setEntry] = useState<StudyConfig["entry"]>("signal_close");
  const [horizon, setHorizon] = useState<Horizon>(20);

  const trig = TRIGGER_BY_ID[triggerId];
  const predicate = useMemo(() => (mode === "trigger" ? trig.test : filtersPredicate(filters)), [mode, trig, filters]);
  const description = mode === "trigger" ? `${trig.name}: ${trig.formula} (${trig.threshold})` : describeFilters(filters);
  const noRule = mode === "custom" && filters.rsiThreshold === null && filters.zThreshold === null && filters.vixRegime === "any" && filters.trend === "any";

  const study = useMemo(
    () => runStudy(f, { predicate, description, startDate, endDate, cooldown, dedupe, entry, excursionHorizon: 60 }),
    [f, predicate, description, startDate, endDate, cooldown, dedupe, entry],
  );
  const qualifiesNow = predicate(f, last);
  const hs = study.horizons.find((h) => h.h === horizon)!;
  const bins = useMemo(() => histogram(study.events.map((e) => e.forward[horizon]).filter((x): x is number => x !== null)), [study, horizon]);
  const activeTriggers = TRIGGERS.filter((t) => t.test(f, last) === true);

  const columns: Column<AnalogEvent>[] = [
    { key: "date", header: "Signal date", value: (e) => e.date, render: (e) => <span className="text-paper">{fmtMarketDate(e.date)}</span> },
    { key: "close", header: "Close", value: (e) => e.close, render: (e) => fmtNum(e.close), align: "right" },
    { key: "rsi", header: "RSI14", value: (e) => e.rsi14, render: (e) => fmtNum(e.rsi14, 1), align: "right" },
    { key: "z", header: "z50", value: (e) => e.z50, render: (e) => fmtSigned(e.z50), align: "right" },
    { key: "vix", header: "VIX", value: (e) => e.vix, render: (e) => fmtNum(e.vix), align: "right" },
    { key: "trend", header: "vs SMA200", value: (e) => (e.above200 === null ? null : e.above200 ? "Above" : "Below"), render: (e) => (e.above200 === null ? "—" : e.above200 ? "Above" : "Below") },
    { key: "cluster", header: "Days", info: "Qualifying sessions grouped into this event (the cluster).", value: (e) => e.clusterDays, align: "right" },
    ...HORIZONS.map((h) => ({ key: `r${h}`, header: `${h}d`, value: (e: AnalogEvent) => e.forward[h], render: (e: AnalogEvent) => pctCell(e.forward[h]), align: "right" as const })),
    { key: "mae", header: "Max adverse", info: "Worst close-to-close decline from the entry close during the next 60 sessions.", value: (e) => e.mae, render: (e) => pctCell(e.mae), align: "right" },
    { key: "mfe", header: "Max favourable", value: (e) => e.mfe, render: (e) => pctCell(e.mfe), align: "right" },
    { key: "ov", header: "Overlap", info: "Yes when the next event starts within 60 sessions of this one, so their outcome windows share days.", value: (e) => (e.overlapsNext ? 1 : 0), render: (e) => (e.overlapsNext ? <Badge tone="gold">Yes</Badge> : <span className="text-muted">No</span>), align: "right" },
  ];

  const exportCsv = () => {
    const rows = study.events.map((e) => ({
      signalDate: e.date, entryDate: e.entryDate, close: e.close, rsi14: e.rsi14, z50: e.z50, vix: e.vix, above200: e.above200,
      clusterDays: e.clusterDays, fwd1: e.forward[1], fwd5: e.forward[5], fwd10: e.forward[10], fwd20: e.forward[20], fwd60: e.forward[60],
      mae60: e.mae, mfe60: e.mfe, overlapsNext: e.overlapsNext,
    }));
    const header = `# ${description} | ${f.indexSymbol} | entry=${entry} | dedupe=${dedupe} cooldown=${cooldown} | dataset=${dataset!.kind}\r\n`;
    downloadText(`woi-analogs-${f.dates[last]}.csv`, header + toCsv(rows, Object.keys(rows[0] ?? { signalDate: "" }) as (keyof (typeof rows)[number])[]), "text/csv");
  };

  return (
    <div className="space-y-4">
      <Card title="Choose the event" subtitle="Select a current trigger, any scanner rule, or build a custom rule.">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Active at the {fmtMarketDate(f.dates[last])} close:</span>
          {activeTriggers.length === 0 && <span className="text-xs text-muted">none</span>}
          {activeTriggers.map((t) => (
            <Button key={t.id} variant={mode === "trigger" && triggerId === t.id ? "primary" : "secondary"} onClick={() => { setMode("trigger"); setTriggerId(t.id); }}>
              {t.name}
            </Button>
          ))}
          <Button variant={mode === "custom" ? "primary" : "secondary"} onClick={() => { setMode("custom"); setFilters(filtersFromCurrent(f)); }}>
            Match current conditions
          </Button>
        </div>

        <div className="mb-3">
          <SegmentedControl label="Rule type" value={mode} onChange={setMode} options={[{ value: "trigger", label: "Scanner trigger" }, { value: "custom", label: "Custom filters" }]} />
        </div>

        {mode === "trigger" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Trigger">
              <select className={inputCls} value={triggerId} onChange={(e) => setTriggerId(e.target.value)}>
                {TRIGGERS.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.threshold})</option>
                ))}
              </select>
            </Field>
            <div className="text-xs text-muted sm:pt-6">{trig.formula}</div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Side">
              <select className={inputCls} value={filters.side} onChange={(e) => setFilters({ ...filters, side: e.target.value as AnalogFilters["side"] })}>
                <option value="downside">Downside (oversold)</option>
                <option value="upside">Upside (overbought)</option>
              </select>
            </Field>
            <Field label={`RSI14 ${filters.side === "downside" ? "≤" : "≥"}`} hint="Blank = off">
              <input className={inputCls} type="number" min={1} max={99} step={1} value={filters.rsiThreshold ?? ""} onChange={(e) => setFilters({ ...filters, rsiThreshold: e.target.value === "" ? null : Math.min(99, Math.max(1, Number(e.target.value))) })} />
            </Field>
            <Field label={`z50 ${filters.side === "downside" ? "≤ −" : "≥ +"}`} hint="Std. deviations; blank = off">
              <input className={inputCls} type="number" min={0} max={6} step={0.25} value={filters.zThreshold ?? ""} onChange={(e) => setFilters({ ...filters, zThreshold: e.target.value === "" ? null : Math.min(6, Math.max(0, Number(e.target.value))) })} />
            </Field>
            <Field label="VIX regime" hint={f.firstVolDate ? `VIX data from ${f.firstVolDate}` : "No VIX data"}>
              <select className={inputCls} value={filters.vixRegime} onChange={(e) => setFilters({ ...filters, vixRegime: e.target.value as AnalogFilters["vixRegime"] })}>
                <option value="any">Any</option>
                <option value="lt20">Calm (VIX &lt; 20)</option>
                <option value="20to30">Elevated (20–30)</option>
                <option value="gte30">Stress (VIX ≥ 30)</option>
              </select>
            </Field>
            <Field label="200-day trend">
              <select className={inputCls} value={filters.trend} onChange={(e) => setFilters({ ...filters, trend: e.target.value as AnalogFilters["trend"] })}>
                <option value="any">Any</option>
                <option value="above200">Close above SMA200</option>
                <option value="below200">Close below SMA200</option>
              </select>
            </Field>
          </div>
        )}

        <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="From">
            <input className={inputCls} type="date" value={startDate} min={f.dates[0]} max={endDate} onChange={(e) => e.target.value && setStartDate(e.target.value)} />
          </Field>
          <Field label="To">
            <input className={inputCls} type="date" value={endDate} min={startDate} max={f.dates[last]} onChange={(e) => e.target.value && setEndDate(e.target.value)} />
          </Field>
          <Field label="Cluster gap (sessions)" hint="New event only after this many sessions without the condition">
            <input className={inputCls} type="number" min={1} max={250} value={cooldown} disabled={!dedupe} onChange={(e) => setCooldown(Math.min(250, Math.max(1, Number(e.target.value) || 1)))} />
          </Field>
          <Field label="Observations">
            <select className={inputCls} value={dedupe ? "dedupe" : "all"} onChange={(e) => setDedupe(e.target.value === "dedupe")}>
              <option value="dedupe">First day of each cluster</option>
              <option value="all">Every qualifying day (overlapping)</option>
            </select>
          </Field>
          <Field label="Entry price" hint="Signal-close entry assumes you act at the close that triggered">
            <select className={inputCls} value={entry} onChange={(e) => setEntry(e.target.value as StudyConfig["entry"])}>
              <option value="signal_close">Signal-day close</option>
              <option value="next_close">Next session close</option>
            </select>
          </Field>
        </div>
      </Card>

      {noRule ? (
        <Notice>Select at least one condition to run a study.</Notice>
      ) : (
        <>
          <Card title="Study summary" subtitle={description}>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Historical events" value={study.events.length} sub={`${study.qualifyingDays} qualifying sessions`} info="Events are the first day of each cluster of qualifying sessions. Statistics below count events, not days." />
              <Stat label="Current close qualifies" value={qualifiesNow === null ? "No data" : qualifiesNow ? "Yes" : "No"} tone={qualifiesNow ? "gold" : "paper"} sub={fmtMarketDate(f.dates[last])} />
              <Stat label="Overlapping windows" value={study.overlapping} tone={study.overlapping ? "gold" : "paper"} sub="next event within 60 sessions" />
              <Stat label="Median 60d max adverse" value={fmtPct(study.mae.median)} tone="risk" sub={`worst ${fmtPct(study.mae.min)}`} />
            </div>
            <div className="mt-4 space-y-2">
              {!dedupe && (
                <Notice tone="risk">Every qualifying day is counted. Consecutive days share almost the same future, so these observations are <strong>not independent</strong> and the sample size overstates the evidence.</Notice>
              )}
              {dedupe && study.overlapping > 0 && (
                <Notice>
                  {study.overlapping} of {study.events.length} events start within 60 sessions of the next one, so their longer-horizon windows overlap and are not fully independent. Treat 60-session statistics with extra caution.
                </Notice>
              )}
              {study.unavailableDays > 0 && (
                <p className="text-xs text-muted">{study.unavailableDays} sessions in range could not be evaluated because an input was unavailable (e.g. VIX before {f.firstVolDate}, or fewer than 200 sessions for SMA200). They are excluded, not filled.</p>
              )}
              {study.events.length > 0 && study.events.length < 10 && <Notice>Fewer than 10 events: results are anecdotal, not statistical evidence.</Notice>}
              <p className="text-xs text-muted">
                Range {study.rangeStart ?? "—"} to {study.rangeEnd ?? "—"}. Signals use only data available at each signal close. Forward returns are close-to-close on {f.indexSymbol} (price index, no dividends). Events too recent for a horizon are counted as pending, not as zero.
              </p>
            </div>
          </Card>

          <Card title="Forward returns by horizon">
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line text-right text-[11px] uppercase tracking-wider text-muted">
                    <th className="px-3 py-2 text-left font-medium">Horizon</th>
                    <th className="px-3 py-2 font-medium">Events</th>
                    <th className="px-3 py-2 font-medium">Mean</th>
                    <th className="px-3 py-2 font-medium">Median</th>
                    <th className="px-3 py-2 font-medium">% positive</th>
                    <th className="px-3 py-2 font-medium">Worst</th>
                    <th className="px-3 py-2 font-medium">Best</th>
                    <th className="px-3 py-2 font-medium">All-days median</th>
                    <th className="px-3 py-2 font-medium">All-days % pos.</th>
                    <th className="px-3 py-2 font-medium">Pending</th>
                  </tr>
                </thead>
                <tbody className="num">
                  {study.horizons.map((h) => (
                    <tr key={h.h} className="border-b border-line/50 text-right last:border-0">
                      <td className="px-3 py-2 text-left text-paper">{h.h} session{h.h > 1 ? "s" : ""}</td>
                      <td className="px-3 py-2">{h.n}</td>
                      <td className="px-3 py-2">{pctCell(h.mean)}</td>
                      <td className="px-3 py-2">{pctCell(h.median)}</td>
                      <td className="px-3 py-2">{fmtPct(h.pctPositive, 0, false)}</td>
                      <td className="px-3 py-2">{pctCell(h.min)}</td>
                      <td className="px-3 py-2">{pctCell(h.max)}</td>
                      <td className="px-3 py-2 text-muted">{fmtPct(h.baseline.median, 2)}</td>
                      <td className="px-3 py-2 text-muted">{fmtPct(h.baseline.pctPositive, 0, false)}</td>
                      <td className="px-3 py-2 text-muted">{h.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted">All-days columns: every session in the same date range, for context. A signal is only interesting if it differs from this baseline.</p>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card title="Median vs mean vs baseline">
              <HorizonChart data={study.horizons.map((h) => ({ h: `${h.h}d`, median: h.median, mean: h.mean, baseline: h.baseline.median }))} />
            </Card>
            <Card title="Distribution of outcomes" right={<SegmentedControl label="Histogram horizon" value={String(horizon)} onChange={(v) => setHorizon(Number(v) as Horizon)} options={HORIZONS.map((h) => ({ value: String(h), label: `${h}d` }))} />}>
              {bins.length ? <HistogramChart bins={bins} /> : <p className="py-16 text-center text-sm text-muted">No completed outcomes.</p>}
              <p className="mt-1 text-[11px] text-muted">{hs.n} events with a completed {horizon}-session outcome.</p>
            </Card>
            <Card title="Average path after entry">
              {study.path.length ? <PathChart data={study.path} /> : <p className="py-16 text-center text-sm text-muted">No events with a full 60-session window.</p>}
              <p className="mt-1 text-[11px] text-muted">Cumulative return by session after entry (x-axis). Events with a complete 60-session window: {study.path[0]?.n ?? 0}.</p>
            </Card>
          </div>

          <Card title="Historical examples" right={<Button onClick={exportCsv} disabled={!study.events.length}>Export CSV</Button>}>
            <SortableTable rows={study.events} columns={columns} rowKey={(e) => e.date} initialSort={{ key: "date", dir: "desc" }} empty="No historical events match this rule." />
          </Card>
        </>
      )}
    </div>
  );
}
