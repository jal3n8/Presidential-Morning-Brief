import { useRef, useState } from "react";
import { Badge, Button, Card, Field, inputCls, Notice } from "../components/ui";
import { fmtMarketDate, fmtNum, fmtPct, fmtUtc } from "../lib/format";
import type { JournalEntry } from "../lib/journal";
import { hypotheticalReturn, journalToCsv, journalToJson, newEntry, parseJournalJson } from "../lib/journal";
import { downloadText, KEYS, readJson, writeJson } from "../lib/storage";
import { normaliseSymbol } from "../lib/watchlist";

const STATUS_LABEL: Record<JournalEntry["status"], string> = {
  idea: "Idea",
  paper_open: "Paper position open",
  paper_closed: "Paper position closed",
  archived: "Archived",
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function Journal() {
  const [entries, setEntries] = useState<JournalEntry[]>(() => {
    const raw = readJson<unknown>(KEYS.journal, []);
    const r = parseJournalJson(JSON.stringify({ app: "woi-market-extremes-radar", kind: "journal", version: 1, exportedAt: "", entries: raw }));
    return r.ok ? r.entries : [];
  });
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [message, setMessage] = useState<{ tone: "gain" | "risk" | "gold"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const persist = (next: JournalEntry[]) => {
    setEntries(next);
    const r = writeJson(KEYS.journal, next);
    if (!r.ok) setMessage({ tone: "risk", text: `Browser storage refused the save (${r.error}). Export a JSON backup now so nothing is lost.` });
  };

  const save = () => {
    if (!editing) return;
    const sym = editing.symbol ? normaliseSymbol(editing.symbol) : "";
    if (sym === null) return setMessage({ tone: "risk", text: "Symbol is not valid." });
    const e = { ...editing, symbol: sym, updatedAt: new Date().toISOString() };
    const exists = entries.some((x) => x.id === e.id);
    persist(exists ? entries.map((x) => (x.id === e.id ? e : x)) : [e, ...entries]);
    setEditing(null);
    setMessage({ tone: "gain", text: "Saved on this device." });
  };

  const remove = (id: string) => {
    if (!window.confirm("Delete this journal entry? Export a backup first if you might need it.")) return;
    persist(entries.filter((x) => x.id !== id));
  };

  const importFile = async (file: File) => {
    const r = parseJournalJson(await file.text());
    if (!r.ok) return setMessage({ tone: "risk", text: `Import refused: ${r.error}` });
    const known = new Set(entries.map((e) => e.id));
    const added = r.entries.filter((e) => !known.has(e.id));
    persist([...added, ...entries]);
    setMessage({ tone: "gain", text: `Imported ${added.length} entries (${r.entries.length - added.length} already present were skipped).` });
  };

  const set = <K extends keyof JournalEntry>(k: K, v: JournalEntry[K]) => setEditing((e) => (e ? { ...e, [k]: v } : e));
  const numOrNull = (s: string) => (s === "" || !Number.isFinite(Number(s)) || Number(s) < 0 ? null : Number(s));
  const stamp = new Date().toISOString();

  return (
    <div className="space-y-4">
      <Notice>
        <strong className="text-gold">Paper trading and research notes only.</strong> Nothing here places orders or connects to a broker. Entries are stored only in this browser on this device — export a backup regularly (JSON keeps everything; CSV opens in a spreadsheet).
      </Notice>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Card
        title={`Research journal · ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`}
        right={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="primary" onClick={() => setEditing(newEntry(todayIso(), stamp))}>New entry</Button>
            <Button onClick={() => downloadText(`woi-journal-${todayIso()}.json`, journalToJson(entries, stamp), "application/json")} disabled={!entries.length}>Export JSON</Button>
            <Button onClick={() => downloadText(`woi-journal-${todayIso()}.csv`, journalToCsv(entries), "text/csv")} disabled={!entries.length}>Export CSV</Button>
            <Button onClick={() => fileRef.current?.click()}>Import JSON</Button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
          </div>
        }
      >
        {editing && (
          <form className="mb-6 space-y-3 rounded-lg border border-gold/30 bg-ink/50 p-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Research date"><input className={inputCls} type="date" required value={editing.researchDate} onChange={(e) => set("researchDate", e.target.value)} /></Field>
              <Field label="Symbol"><input className={`${inputCls} uppercase`} maxLength={12} value={editing.symbol} onChange={(e) => set("symbol", e.target.value.toUpperCase())} placeholder="SPY" /></Field>
              <Field label="Status">
                <select className={inputCls} value={editing.status} onChange={(e) => set("status", e.target.value as JournalEntry["status"])}>
                  {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Direction (hypothetical)">
                <select className={inputCls} value={editing.direction} onChange={(e) => set("direction", e.target.value as JournalEntry["direction"])}>
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
              </Field>
            </div>
            <Field label="Market thesis"><textarea className={inputCls} rows={3} maxLength={5000} value={editing.thesis} onChange={(e) => set("thesis", e.target.value)} placeholder="What is happening and why it matters." /></Field>
            <Field label="Entry hypothesis"><textarea className={inputCls} rows={2} maxLength={5000} value={editing.hypothesis} onChange={(e) => set("hypothesis", e.target.value)} placeholder="Which observable condition would justify a hypothetical entry?" /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Hypothetical entry"><input className={inputCls} type="number" step="any" min={0} value={editing.hypotheticalEntry ?? ""} onChange={(e) => set("hypotheticalEntry", numOrNull(e.target.value) || null)} /></Field>
              <Field label="Hypothetical exit"><input className={inputCls} type="number" step="any" min={0} value={editing.hypotheticalExit ?? ""} onChange={(e) => set("hypotheticalExit", numOrNull(e.target.value) || null)} /></Field>
              <Field label="Risk amount (paper $)"><input className={inputCls} type="number" step="any" min={0} value={editing.riskAmount ?? ""} onChange={(e) => set("riskAmount", numOrNull(e.target.value))} /></Field>
            </div>
            <Field label="Invalidating conditions"><textarea className={inputCls} rows={2} maxLength={5000} value={editing.invalidation} onChange={(e) => set("invalidation", e.target.value)} placeholder="What would prove the thesis wrong?" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Hypothetical result" hint={hypotheticalReturn(editing) !== null ? `Entry→exit: ${fmtPct(hypotheticalReturn(editing), 2)} (${editing.direction})` : "Fill entry and exit to see the % move"}>
                <input className={inputCls} maxLength={500} value={editing.hypotheticalResult} onChange={(e) => set("hypotheticalResult", e.target.value)} placeholder="e.g. +3.1%, exited at target" />
              </Field>
              <Field label="Lessons learned"><textarea className={inputCls} rows={2} maxLength={5000} value={editing.lessons} onChange={(e) => set("lessons", e.target.value)} /></Field>
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="primary">Save entry</Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </form>
        )}

        {entries.length === 0 && !editing ? (
          <p className="py-8 text-center text-sm text-muted">No entries yet. Use “New entry” to record a research idea or paper trade.</p>
        ) : (
          <ul className="space-y-3">
            {entries.map((e) => {
              const r = hypotheticalReturn(e);
              return (
                <li key={e.id} className="rounded-lg border border-line bg-ink/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-paper">{e.symbol || "—"}</span>
                      <Badge tone={e.status === "paper_open" ? "gold" : "muted"}>{STATUS_LABEL[e.status]}</Badge>
                      <Badge>{e.direction}</Badge>
                      <span className="text-xs text-muted">{fmtMarketDate(e.researchDate)}</span>
                    </div>
                    <div className="flex gap-3 text-xs">
                      <button type="button" className="text-gold hover:underline" onClick={() => setEditing(e)}>Edit</button>
                      <button type="button" className="text-muted hover:text-risk" onClick={() => remove(e.id)}>Delete</button>
                    </div>
                  </div>
                  {e.thesis && <p className="mt-2 whitespace-pre-wrap text-sm text-paper/90">{e.thesis}</p>}
                  <dl className="num mt-2 grid gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-4">
                    <div>Entry <span className="text-paper">{fmtNum(e.hypotheticalEntry)}</span></div>
                    <div>Exit <span className="text-paper">{fmtNum(e.hypotheticalExit)}</span></div>
                    <div>Move <span className={r === null ? "" : r >= 0 ? "text-gain" : "text-risk"}>{fmtPct(r, 2)}</span></div>
                    <div>Risk <span className="text-paper">{e.riskAmount === null ? "—" : `$${fmtNum(e.riskAmount, 0)}`}</span></div>
                  </dl>
                  {e.invalidation && <p className="mt-2 text-xs text-muted"><span className="text-risk">Invalidation:</span> {e.invalidation}</p>}
                  {e.lessons && <p className="mt-1 text-xs text-muted"><span className="text-gold">Lessons:</span> {e.lessons}</p>}
                  <p className="mt-2 text-[10px] text-muted/70">Updated {fmtUtc(e.updatedAt)}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
