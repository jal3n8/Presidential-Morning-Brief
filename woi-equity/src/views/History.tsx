import { useEffect, useMemo, useState } from "react";
import type { TerminalState } from "../lib/dataClient";
import { Badge, PageHeader, Panel, SectionNote, cx } from "../components/ui";
import { useArchive } from "../lib/archive";
import { diffSnapshots } from "../lib/diff";
import { fmtDate, fmtNum, fmtPct, humanizeStatus, tone } from "../lib/format";
import { pctChange } from "../lib/indicators";
import { tradingDaysBetween } from "../lib/calendar";
import type { Snapshot } from "../lib/schema";

const show = (v: unknown) => (v === undefined ? "∅" : v === null ? "null" : typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 4 }) : String(v));

/** Prices that can be compared between two snapshots, each with its own date. */
function comparablePrices(s: Snapshot) {
  const rows: { key: string; label: string; value: number | null; date: string | null }[] = [
    ...s.watchlist.map((w) => ({ key: w.symbol, label: w.company, value: w.regularSessionClose, date: w.closeDate })),
    ...s.marketRegime.instruments.map((i) => ({ key: i.symbol, label: "ETF", value: i.closeUsd, date: s.snapshot.equityTradingDate })),
    { key: "^GSPC", label: "S&P 500 index", value: s.washout.sp500.close, date: s.snapshot.equityTradingDate },
    { key: "^VIX", label: "Cboe Volatility Index", value: s.washout.vixClose, date: s.snapshot.equityTradingDate },
    { key: "BTC-USD", label: "Bitcoin (UTC daily candle)", value: s.macroAndConfirmation.bitcoin.dailyCandleCloseUsd, date: s.macroAndConfirmation.bitcoin.utcCandleDate },
  ];
  return rows;
}

export function History({ data }: { data: TerminalState }) {
  const archive = useArchive(data, 400, true);
  const usable = useMemo(() => (archive ?? []).filter((a) => a.snapshot), [archive]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [onlyValues, setOnlyValues] = useState(true);
  const key = (x: { entry: { source: string; id: string } }) => `${x.entry.source}|${x.entry.id}`;

  useEffect(() => {
    if (usable.length >= 2) {
      setA((x) => x || key(usable[usable.length - 2]));
      setB((x) => x || key(usable[usable.length - 1]));
    }
  }, [usable]);

  const A = usable.find((x) => key(x) === a)?.snapshot ?? null;
  const B = usable.find((x) => key(x) === b)?.snapshot ?? null;
  const changes = A && B ? diffSnapshots(A, B).filter((c) => !onlyValues || !["Sources", "Validation", "Automation"].includes(c.section)) : [];
  const bySection = changes.reduce<Record<string, typeof changes>>((acc, c) => ((acc[c.section] ??= []).push(c), acc), {});
  const perf = A && B ? comparablePrices(B).map((row) => {
    const before = comparablePrices(A).find((r) => r.key === row.key);
    return { ...row, before: before?.value ?? null, beforeDate: before?.date ?? null, change: pctChange(before?.value ?? null, row.value) };
  }) : [];
  const sessions = A && B ? tradingDaysBetween(A.snapshot.equityTradingDate, B.snapshot.equityTradingDate) : 0;

  return (
    <>
      <PageHeader kicker="History" title="Snapshots & comparisons">
        {data.archive.length} archived snapshot{data.archive.length === 1 ? "" : "s"}
      </PageHeader>

      <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
        <Panel kicker="Archive" title="Snapshots, newest first" pad={false}>
          {(archive ?? []).length === 0 ? <div className="p-4"><SectionNote>{archive === null ? "Loading…" : "No archive available."}</SectionNote></div> : (
            <ul className="divide-y divide-ink-800">
              {[...(archive ?? [])].reverse().map((x) => {
                const src = data.sourceById(x.entry.source) as { fileUrl?: (p: string) => string } | undefined;
                return (
                  <li key={key(x)} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="font-mono text-[13px] text-ivory-50">{x.entry.equityTradingDate}</div>
                      <div className="text-2xs text-ivory-500">{humanizeStatus(x.entry.equitySession)} · {humanizeStatus(x.entry.quality)}</div>
                      <div className="mt-0.5"><Badge tone={x.entry.source === "local" ? "brass" : "muted"}>{x.entry.sourceLabel}</Badge></div>
                      {x.error && <div className="mt-1 text-2xs text-down">{x.error}</div>}
                    </div>
                    {src?.fileUrl && <a className="btn shrink-0 px-2 py-1 text-2xs" href={src.fileUrl(x.entry.path)} download>JSON</a>}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="space-y-3">
          <Panel kicker="Compare" title="Two sessions side by side">
            {usable.length < 2 ? (
              <SectionNote>
                A comparison needs two archived snapshots. There {usable.length === 1 ? `is one, ${fmtDate(usable[0].entry.equityTradingDate)}` : "are none yet"}.
                Each published update adds one; you can also check two files side by side by keeping them on the Import page.
                No trend lines or performance figures are drawn until real snapshots exist to support them.
              </SectionNote>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <select className="input" value={a} onChange={(e) => setA(e.target.value)} aria-label="Earlier snapshot">
                    {usable.map((x) => <option key={key(x)} value={key(x)}>{x.entry.equityTradingDate} · {x.entry.equitySession}{x.entry.source === "local" ? " (local)" : ""}</option>)}
                  </select>
                  <span className="text-center text-ivory-600">→</span>
                  <select className="input" value={b} onChange={(e) => setB(e.target.value)} aria-label="Later snapshot">
                    {usable.map((x) => <option key={key(x)} value={key(x)}>{x.entry.equityTradingDate} · {x.entry.equitySession}{x.entry.source === "local" ? " (local)" : ""}</option>)}
                  </select>
                </div>
                <div className="mt-2 text-2xs text-ivory-500">{sessions} trading session{sessions === 1 ? "" : "s"} apart on the NYSE calendar.</div>
              </>
            )}
          </Panel>

          {A && B && (
            <Panel kicker="Performance" title="Price change between the two snapshots" pad={false}>
              <div className="overflow-x-auto">
                <table className="tbl w-full text-xs">
                  <thead><tr><th>Instrument</th><th className="text-right">Earlier</th><th className="text-right">Later</th><th className="text-right">Change</th></tr></thead>
                  <tbody>
                    {perf.map((r) => (
                      <tr key={r.key}>
                        <td><span className="font-mono text-ivory-50">{r.key}</span> <span className="hidden text-ivory-600 sm:inline">{r.label}</span></td>
                        <td className="num text-right font-mono text-ivory-500">{fmtNum(r.before) ?? "—"}<div className="text-[10px] text-ivory-700">{r.beforeDate ?? ""}</div></td>
                        <td className="num text-right font-mono text-ivory-100">{fmtNum(r.value) ?? "—"}<div className="text-[10px] text-ivory-700">{r.date ?? ""}</div></td>
                        <td className={cx("num text-right font-mono", tone(r.change))}>{fmtPct(r.change) ?? <span className="text-ivory-600">n/a</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 text-2xs text-ivory-600">Price change only (no dividends). n/a means one side has no value.</div>
            </Panel>
          )}

          {A && B && (
            <Panel kicker="Field changes" title="Everything that changed">
              <label className="flex items-center gap-2 text-xs text-ivory-500">
                <input type="checkbox" checked={onlyValues} onChange={(e) => setOnlyValues(e.target.checked)} className="accent-[#c2a874]" /> Market values only (hide source and validation bookkeeping)
              </label>
              <div className="mt-4 space-y-4">
                {changes.length === 0 && <SectionNote>No differences.</SectionNote>}
                {Object.entries(bySection).map(([section, list]) => (
                  <div key={section}>
                    <div className="label mb-1 text-brass-500">{section} <span className="text-ivory-700">{list.length}</span></div>
                    <div className="overflow-x-auto">
                      <table className="tbl w-full text-xs">
                        <tbody>
                          {list.map((c) => (
                            <tr key={c.path}>
                              <td className="break-all font-mono text-ivory-300">{c.path}</td>
                              <td className="num whitespace-nowrap text-right font-mono text-ivory-500">{show(c.before)}</td>
                              <td className="num whitespace-nowrap text-right font-mono text-ivory-50">{show(c.after)}</td>
                              <td className={cx("num whitespace-nowrap text-right font-mono", tone(c.delta))}>{c.deltaPct !== null ? fmtPct(c.deltaPct) : c.kind !== "changed" ? <Badge tone="muted">{c.kind}</Badge> : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
