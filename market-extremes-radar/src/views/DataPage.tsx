import { useState } from "react";
import { Badge, Button, Card, Field, inputCls, Notice, SegmentedControl, VerificationBadge } from "../components/ui";
import { importPriceCsv, type ImportResult } from "../lib/csv";
import type { DatasetChoice, ImportRole } from "../lib/data";
import { fmtMarketDate, fmtNum, fmtUtc, provenanceLine } from "../lib/format";
import { RULES, TRIGGERS } from "../lib/rules";
import type { AssetClass, Series } from "../lib/types";
import { useData } from "../state";

interface CrossCheck {
  overlapDates: number;
  tolerancePct: number;
  maxAbsDiffPct: number | null;
  breaches: number;
  secondarySource: string;
  secondaryUrl: string;
  corrections?: { date: string; replaced: number; with: number; absDiffPct: number }[];
}

function SeriesRow({ s }: { s: Series }) {
  const cc = s.verification.crossCheck as CrossCheck | null;
  return (
    <li className="rounded-lg border border-line bg-ink/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-paper">{s.symbol}</span>
        <span className="text-sm text-muted">{s.name}</span>
        <VerificationBadge level={s.verification.level} />
        <Badge>{s.tradable ? "Tradable" : "Not tradable"}</Badge>
      </div>
      <p className="num mt-1 text-xs text-muted">
        {s.dates.length.toLocaleString()} sessions · {s.dates[0]} → {s.dates[s.dates.length - 1]} · {s.currency}
      </p>
      <p className="mt-1 text-xs text-muted">{provenanceLine(s)}</p>
      <p className="mt-1 text-xs text-muted">{s.verification.detail}</p>
      <p className="mt-1 text-xs text-muted/80">{s.priceNotes}</p>
      {cc?.corrections && cc.corrections.length > 0 && (
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer text-gold">{cc.corrections.length} discrepancies resolved in favour of {cc.secondarySource}</summary>
          <ul className="num mt-1 space-y-0.5">
            {cc.corrections.map((c) => (
              <li key={c.date}>{c.date}: provider {fmtNum(c.replaced)} → official {fmtNum(c.with)} ({c.absDiffPct}% apart)</li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-1 break-all text-[11px] text-muted/70">Licence: {s.source.license}</p>
    </li>
  );
}

export default function DataPage() {
  const { dataset, choice, setChoice, imports, saveImport, removeImport, analytics } = useData();
  const ds = dataset!;
  const [file, setFile] = useState<File | null>(null);
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("stock");
  const [role, setRole] = useState<ImportRole>("watchlist");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const runImport = async () => {
    setSaveMsg(null);
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return setResult({ ok: false, errors: ["File is larger than 10 MB."] });
    const text = await file.text();
    const ac: AssetClass = role === "core_index" ? "index" : role === "core_vol" ? "volatility_index" : assetClass;
    const r = importPriceCsv(text, { symbol, name, assetClass: ac, today: new Date().toISOString().slice(0, 10), importedAt: new Date().toISOString(), fileName: file.name });
    setResult(r);
    if (r.ok) {
      const err = saveImport(`${role}:${r.doc.symbol}`, { role, doc: r.doc });
      setSaveMsg(err ?? `Imported ${r.doc.symbol} (${r.report.rows} rows) as ${role === "watchlist" ? "a watchlist series" : role === "core_index" ? "the core index" : "the core volatility index"}.`);
    }
  };

  const all: Series[] = [ds.index, ...(ds.vol ? [ds.vol] : []), ...Object.values(ds.watchlist)];
  const f = analytics!.frame;

  return (
    <div className="space-y-4">
      <Card title="Dataset in use" subtitle="The app never presents demo or imported data as verified, and never as live.">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl<DatasetChoice>
            label="Dataset"
            value={choice}
            onChange={setChoice}
            options={[
              { value: "auto", label: "Auto (verified, else demo)" },
              { value: "verified", label: "Verified only" },
              { value: "demo", label: "Demo" },
            ]}
          />
          <Badge tone={ds.kind === "demo" ? "risk" : ds.kind === "imported" ? "gold" : "gain"}>{ds.kind}</Badge>
        </div>
        <dl className="num mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-[11px] uppercase tracking-wider text-muted">Label</dt><dd className="text-paper">{ds.label}</dd></div>
          <div><dt className="text-[11px] uppercase tracking-wider text-muted">Last market date</dt><dd className="text-paper">{fmtMarketDate(ds.lastMarketDate)}</dd></div>
          <div><dt className="text-[11px] uppercase tracking-wider text-muted">Dataset built</dt><dd className="text-paper">{fmtUtc(ds.builtAt)}</dd></div>
          <div><dt className="text-[11px] uppercase tracking-wider text-muted">Freshness</dt><dd className="text-paper">{analytics!.fresh.message}</dd></div>
        </dl>
        {ds.warnings.length > 0 && (
          <details className="mt-4 text-xs text-muted">
            <summary className="cursor-pointer text-gold">{ds.warnings.length} validation notes</summary>
            <ul className="mt-2 list-disc space-y-0.5 pl-5">{ds.warnings.map((w, k) => <li key={k}>{w}</li>)}</ul>
          </details>
        )}
      </Card>

      <Card title="Series, sources and verification">
        <ul className="space-y-2">{all.map((s) => <SeriesRow key={s.symbol} s={s} />)}</ul>
        {f.alignment && (
          <p className="mt-3 text-xs text-muted">
            Market-date alignment of {f.volSymbol} to {f.indexSymbol}: {f.alignment.missingInOther.length} index sessions without a volatility close (left blank) · {f.alignment.extraInOther} volatility dates with no index session (ignored).
          </p>
        )}
      </Card>

      <Card title="Import your own CSV" subtitle="For licensed or personally downloaded daily data. The file is read in this browser only; it is never uploaded or executed.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="CSV file"><input className={`${inputCls} file:mr-2 file:rounded file:border-0 file:bg-panel2 file:px-2 file:py-1 file:text-paper`} type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
          <Field label="Use as">
            <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as ImportRole)}>
              <option value="watchlist">Watchlist symbol</option>
              <option value="core_index">Core index (replaces S&amp;P 500)</option>
              <option value="core_vol">Core volatility (replaces VIX)</option>
            </select>
          </Field>
          <Field label="Symbol"><input className={`${inputCls} uppercase`} maxLength={12} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="e.g. AAPL" /></Field>
          <Field label="Name (optional)"><input className={inputCls} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Type">
            <select className={inputCls} value={role === "watchlist" ? assetClass : role === "core_index" ? "index" : "volatility_index"} disabled={role !== "watchlist"} onChange={(e) => setAssetClass(e.target.value as AssetClass)}>
              <option value="stock">Stock</option>
              <option value="etf">ETF</option>
              <option value="index">Index</option>
              <option value="volatility_index">Volatility index</option>
            </select>
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" onClick={runImport} disabled={!file || !symbol}>Validate and import</Button>
          <span className="text-xs text-muted">Accepted: Yahoo-style (Date, …, Close, Adj Close), FRED (observation_date, VALUE), or any Date + Close file. Max 10 MB / 60,000 rows.</span>
        </div>
        {result && !result.ok && (
          <div className="mt-3"><Notice tone="risk"><p className="font-semibold">Import refused — nothing was saved.</p><ul className="mt-1 list-disc pl-5 text-xs">{result.errors.map((e, k) => <li key={k}>{e}</li>)}</ul></Notice></div>
        )}
        {result && result.ok && (
          <div className="mt-3 space-y-2">
            <Notice tone="gain">{saveMsg}</Notice>
            <p className="text-xs text-muted">Columns used: date “{result.report.dateColumn}”, close “{result.report.closeColumn}”{result.report.adjColumn ? `, adjusted “${result.report.adjColumn}”` : ""}.</p>
            {result.report.warnings.length > 0 && <ul className="list-disc pl-5 text-xs text-gold">{result.report.warnings.map((w, k) => <li key={k}>{w}</li>)}</ul>}
          </div>
        )}
        {Object.keys(imports).length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="mb-2 text-[11px] uppercase tracking-wider text-muted">Stored imports (this browser only)</p>
            <ul className="space-y-1 text-sm">
              {Object.entries(imports).map(([k, imp]) => (
                <li key={k} className="flex flex-wrap items-center gap-2">
                  <span className="text-paper">{imp.doc.symbol}</span>
                  <Badge>{imp.role.replace("_", " ")}</Badge>
                  <span className="num text-xs text-muted">{imp.doc.rows.length} rows · {imp.doc.rows[0]?.[0]} → {imp.doc.rows[imp.doc.rows.length - 1]?.[0]}</span>
                  <button type="button" className="text-xs text-muted hover:text-risk" onClick={() => removeImport(k)}>Remove</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title="Methodology: formulas and thresholds">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-2 text-xs leading-relaxed text-muted">
            <p className="text-sm text-paper">Indicators (all trailing; value on day t uses only closes up to and including t)</p>
            <ul className="list-disc space-y-1 pl-5">
              <li><span className="text-paper">SMA n</span>: mean of the last n closes. Blank until n closes exist.</li>
              <li><span className="text-paper">RSI(14), Wilder</span>: first averages are simple means of the first 14 gains and losses; then avg = (prev × 13 + today) ÷ 14; RSI = 100 − 100 ÷ (1 + avgGain ÷ avgLoss).</li>
              <li><span className="text-paper">50-day z-score</span>: (Close − SMA50) ÷ population standard deviation of the same 50 closes.</li>
              <li><span className="text-paper">VIX percentile</span>: share of all VIX closes from the first available date up to t that are ≤ the close on t.</li>
              <li><span className="text-paper">Drawdown</span>: Close ÷ highest close of the last 252 sessions (or all history) − 1.</li>
              <li><span className="text-paper">Month to date</span>: Close ÷ last close of the previous calendar month − 1.</li>
              <li><span className="text-paper">Date alignment</span>: index and VIX joined on exact New York market dates; no forward-filling.</li>
            </ul>
            <p className="pt-2 text-sm text-paper">Market condition rules</p>
            <table className="num w-full text-left">
              <thead><tr className="border-b border-line text-muted"><th className="py-1">Input</th><th>Extreme</th><th>Elevated</th></tr></thead>
              <tbody className="text-paper/90">
                <tr><td className="py-0.5">50-day z-score</td><td>≤ {RULES.extreme.z50}</td><td>≤ {RULES.elevated.z50}</td></tr>
                <tr><td className="py-0.5">RSI(14)</td><td>≤ {RULES.extreme.rsi}</td><td>≤ {RULES.elevated.rsi}</td></tr>
                <tr><td className="py-0.5">VIX</td><td>≥ {RULES.extreme.vix}</td><td>≥ {RULES.elevated.vix}</td></tr>
                <tr><td className="py-0.5">5-session return</td><td>≤ {RULES.extreme.ret5 * 100}%</td><td>≤ {RULES.elevated.ret5 * 100}%</td></tr>
                <tr><td className="py-0.5">Drawdown (252)</td><td>≤ {RULES.extreme.dd252 * 100}%</td><td>≤ {RULES.elevated.dd252 * 100}%</td></tr>
              </tbody>
            </table>
            <p>Extreme Stress: ≥ {RULES.extremeCountForLabel} extreme flags. Recovery Watch: Extreme Stress within the prior {RULES.recovery.lookback} sessions, not extreme today, close ≥ SMA20. Elevated Stress: ≥ 1 extreme or ≥ {RULES.elevatedCountForLabel} elevated flags. Upside Extension: z50 ≥ +{RULES.upside.z50} and RSI ≥ {RULES.upside.rsi}. Insufficient Data: more than 2 inputs unavailable. No probabilities are produced.</p>
          </div>
          <div className="space-y-2 text-xs leading-relaxed text-muted">
            <p className="text-sm text-paper">Scanner triggers</p>
            <ul className="space-y-1">
              {TRIGGERS.map((t) => (
                <li key={t.id}><span className="text-paper">{t.name}</span> — <span className="text-gold">{t.threshold}</span>. {t.formula}.</li>
              ))}
            </ul>
            <p className="pt-2 text-sm text-paper">Historical analogs</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Signals are evaluated with trailing indicators only. Future prices are used only to measure outcomes after the entry.</li>
              <li>Forward return over h sessions = Close(entry + h) ÷ Close(entry) − 1. Entry is the signal close (default) or the next close.</li>
              <li>Clusters: consecutive qualifying sessions form one event; a new event needs a gap of at least the cluster-gap setting (default 20 sessions). Overlapping 60-session windows are counted and disclosed.</li>
              <li>Max adverse movement: worst close in the 60 sessions after entry relative to the entry close (close-to-close; intraday lows are not available).</li>
              <li>Events without enough later data are “pending”, never counted as zero.</li>
              <li>Each result is compared with all sessions in the same date range (the baseline).</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
