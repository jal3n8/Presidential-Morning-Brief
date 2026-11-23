import { useMemo, useState } from "react";
import { Badge, Card, Field, inputCls, Provenance, SortableTable, type Column } from "../components/ui";
import { fmtMarketDate, fmtNum, fmtPct, fmtSigned, VERIFICATION_TEXT } from "../lib/format";
import type { Num } from "../lib/indicators";
import type { TriggerFamily } from "../lib/rules";
import { TRIGGERS } from "../lib/rules";
import type { ScanEvent } from "../lib/scanner";
import { activeNow, VALIDATION_COOLDOWN, VALIDATION_MIN_EVENTS } from "../lib/scanner";
import { useData } from "../state";

const INPUT_LABEL: Record<string, string> = {
  close: "Close",
  sma50: "SMA50",
  z50: "z50",
  rsi14: "RSI14",
  vix: "VIX",
  vixPercentile: "VIX pct",
  ret5: "5d ret",
};

export function fmtInput(key: string, v: Num): string {
  if (key === "z50") return fmtSigned(v);
  if (key === "rsi14") return fmtNum(v, 1);
  if (key === "vixPercentile") return fmtPct(v, 1, false);
  if (key === "ret5") return fmtPct(v, 2);
  return fmtNum(v, 2);
}

const PERIODS = [
  { v: "252", l: "Last 12 months" },
  { v: "756", l: "Last 3 years" },
  { v: "2520", l: "Last 10 years" },
  { v: "all", l: "All history" },
];

export function ValidationBadge({ v }: { v: ScanEvent["validation"] }) {
  if (v.status === "available") return <Badge tone="gain" title={v.note}>Yes · n={v.priorEvents}</Badge>;
  if (v.status === "limited") return <Badge tone="gold" title={v.note}>Limited · n={v.priorEvents}</Badge>;
  return <Badge title={v.note}>Not available</Badge>;
}

export default function Scanner() {
  const { analytics, dataset } = useData();
  const f = analytics!.frame;
  const events = analytics!.events;
  const [family, setFamily] = useState<"all" | TriggerFamily>("all");
  const [trigger, setTrigger] = useState("all");
  const [period, setPeriod] = useState("756");
  const now = activeNow(f);
  const last = f.dates.length - 1;

  const rows = useMemo(() => {
    const minIndex = period === "all" ? 0 : last - Number(period) + 1;
    return events.filter((e) => e.index >= minIndex && (family === "all" || e.family === family) && (trigger === "all" || e.triggerId === trigger));
  }, [events, family, trigger, period, last]);

  const src = `${dataset!.index.source.provider} (${VERIFICATION_TEXT[dataset!.index.verification.level].short})`;
  const columns: Column<ScanEvent>[] = [
    { key: "date", header: "Date", value: (e) => e.date, render: (e) => <span className="text-paper">{fmtMarketDate(e.date)}</span> },
    {
      key: "trigger",
      header: "Trigger",
      value: (e) => e.triggerName,
      render: (e) => (
        <span className="whitespace-normal">
          <span className="text-paper">{e.triggerName}</span>
          {e.stillActive && <span className="ml-2"><Badge tone="risk">Active</Badge></span>}
        </span>
      ),
    },
    { key: "days", header: "Days on", value: (e) => e.activeDays, align: "right" },
    {
      key: "values",
      header: "Raw values at signal close",
      value: (e) => Object.keys(e.inputs).join(","),
      render: (e) => (
        <span className="text-xs text-paper/90">
          {Object.entries(e.inputs).map(([k, v]) => (
            <span key={k} className="mr-3 whitespace-nowrap"><span className="text-muted">{INPUT_LABEL[k] ?? k}</span> {fmtInput(k, v)}</span>
          ))}
        </span>
      ),
    },
    { key: "threshold", header: "Threshold", value: (e) => e.threshold, render: (e) => <span className="text-xs text-gold">{e.threshold}</span> },
    { key: "formula", header: "Formula", value: (e) => e.formula, render: (e) => <span className="block max-w-[260px] whitespace-normal text-xs text-muted">{e.formula}</span> },
    {
      key: "validation",
      header: "Validation", info: `"Yes" when at least ${VALIDATION_MIN_EVENTS} earlier independent events (clusters separated by ${VALIDATION_COOLDOWN}+ sessions) had a completed 20-session outcome before this date. Counts never use later data.`,
      value: (e) => e.validation.priorEvents,
      render: (e) => <ValidationBadge v={e.validation} />,
      align: "right",
    },
    { key: "source", header: "Source", value: () => src, render: () => <span className="text-xs text-muted">{src}</span> },
    {
      key: "lab",
      header: "",
      value: () => null,
      render: (e) => <a className="text-xs text-gold hover:underline" href={`#/analogs?trigger=${e.triggerId}`}>Analogs →</a>,
    },
  ];

  return (
    <div className="space-y-4">
      <Card title="Trigger status at the latest close" subtitle={`${fmtMarketDate(f.dates[last])}. Each trigger is a fixed rule on the index (${f.indexSymbol})${f.volSymbol ? ` and ${f.volSymbol}` : ""}.`}>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {now.map(({ trigger: t, active, inputs }) => (
            <div key={t.id} className={`rounded-lg border p-3 ${active ? "border-risk/50 bg-risk/5" : "border-line bg-ink/40"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm text-paper">{t.name}</div>
                {active === null ? <Badge>No data</Badge> : active ? <Badge tone="risk">Active</Badge> : <Badge>Off</Badge>}
              </div>
              <div className="mt-1 text-xs text-gold">{t.threshold}</div>
              <div className="num mt-1 text-xs text-muted">
                {Object.entries(inputs).map(([k, v]) => (
                  <span key={k} className="mr-3">{INPUT_LABEL[k] ?? k} {fmtInput(k, v)}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Signal history" subtitle="One row per onset: the first close on which a trigger became true after being false.">
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Field label="Family">
            <select className={inputCls} value={family} onChange={(e) => setFamily(e.target.value as typeof family)}>
              <option value="all">All families</option>
              <option value="downside">Downside</option>
              <option value="upside">Upside</option>
              <option value="volatility">Volatility</option>
              <option value="combination">Combinations</option>
            </select>
          </Field>
          <Field label="Trigger">
            <select className={inputCls} value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              <option value="all">All triggers</option>
              {TRIGGERS.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Period">
            <select className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map((p) => (
                <option key={p.v} value={p.v}>{p.l}</option>
              ))}
            </select>
          </Field>
        </div>
        <p className="mb-2 text-xs text-muted">{rows.length} events{rows.length > 300 ? " (showing the 300 most recent by current sort)" : ""}.</p>
        <SortableTable rows={rows} columns={columns} rowKey={(e) => `${e.triggerId}-${e.date}`} initialSort={{ key: "date", dir: "desc" }} maxRows={300} empty="No events match these filters." />
        <Provenance className="mt-3" series={dataset!.index} />
      </Card>
    </div>
  );
}
