import { useRef, useState } from "react";
import { validateLoaded, type LoadedSnapshot } from "../lib/dataClient";
import type { Issue } from "../lib/validate";
import { addLocalImport, loadLocalImports, removeLocalImport } from "../lib/localImports";
import { snapshotIdOf } from "../lib/snapshotOrder";
import { Badge, PageHeader, Panel, SectionNote, cx } from "../components/ui";
import { fmtDate, humanizeStatus } from "../lib/format";

type Checked =
  | { ok: true; fileName: string; loaded: LoadedSnapshot }
  | { ok: false; fileName: string; message: string; issues: Issue[] };

const MAX_BYTES = 2_000_000;

export function ImportView({ onPreview, previewing, onExit }: { onPreview: (l: LoadedSnapshot) => void; previewing: LoadedSnapshot | null; onExit: () => void }) {
  const [checked, setChecked] = useState<Checked | null>(null);
  const [drag, setDrag] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [locals, setLocals] = useState(loadLocalImports);
  const input = useRef<HTMLInputElement>(null);

  async function handle(file: File) {
    setNote(null);
    if (file.size > MAX_BYTES) return setChecked({ ok: false, fileName: file.name, message: "File is larger than 2 MB; a snapshot is normally about 15 KB.", issues: [] });
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      return setChecked({ ok: false, fileName: file.name, message: "This file is not valid JSON.", issues: [] });
    }
    try {
      setChecked({ ok: true, fileName: file.name, loaded: validateLoaded(raw, { id: "import", label: `Imported file ${file.name}` }) });
    } catch (e) {
      const err = e as Error & { issues?: Issue[] };
      setChecked({ ok: false, fileName: file.name, message: err.message, issues: err.issues ?? [] });
    }
  }

  return (
    <>
      <PageHeader kicker="Manual import" title="Check a snapshot file">
        Files stay on this device. Nothing is uploaded.
      </PageHeader>

      {previewing && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border border-brass-700 bg-ink-900 px-4 py-3 text-xs text-brass-300">
          Previewing {previewing.sourceLabel}. <button className="btn px-2 py-1" onClick={onExit}>Exit preview</button>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <Panel kicker="Step 1" title="Choose a JSON file">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void handle(f); }}
            onClick={() => input.current?.click()}
            role="button" tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
            className={cx("flex cursor-pointer flex-col items-center justify-center border border-dashed px-4 py-12 text-center", drag ? "border-brass-400 bg-ink-850" : "border-ink-600 hover:border-brass-500")}
          >
            <div className="text-sm text-ivory-100">Drag a WOI Equity JSON file here</div>
            <div className="mt-1 text-xs text-ivory-500">or tap to choose one</div>
            <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handle(f); e.target.value = ""; }} />
          </div>
          <div className="mt-3"><SectionNote>
            The file is checked against the same rules the server uses: required fields, number types, dates, source references, and every derived percentage is recomputed.
            Use this to test a file from Gemini before publishing it.
          </SectionNote></div>
        </Panel>

        <Panel kicker="Step 2" title="Result">
          {!checked && <SectionNote>No file checked yet.</SectionNote>}
          {checked && !checked.ok && (
            <div>
              <Badge tone="down">Rejected</Badge>
              <div className="mt-2 text-sm text-ivory-100">{checked.fileName}</div>
              <p className="mt-1 text-xs text-down">{checked.message}</p>
              {checked.issues.length > 0 && (
                <ul className="mt-3 max-h-64 space-y-1 overflow-auto font-mono text-2xs text-ivory-500">
                  {checked.issues.map((i, n) => <li key={n}><span className="text-down">{i.path}</span>: {i.message}</li>)}
                </ul>
              )}
            </div>
          )}
          {checked && checked.ok && (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="up">Valid</Badge>
                <Badge tone={checked.loaded.issues.some((i) => i.level === "warning") ? "caution" : "muted"}>
                  {checked.loaded.issues.filter((i) => i.level === "warning").length} warnings
                </Badge>
              </div>
              <div className="mt-2 text-sm text-ivory-100">{checked.fileName}</div>
              <dl className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between gap-2"><dt className="text-ivory-500">Snapshot id</dt><dd className="font-mono text-ivory-100">{snapshotIdOf(checked.loaded.snapshot)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-ivory-500">Trading date</dt><dd className="font-mono text-ivory-100">{fmtDate(checked.loaded.snapshot.snapshot.equityTradingDate)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-ivory-500">Session</dt><dd className="text-ivory-100">{humanizeStatus(checked.loaded.snapshot.snapshot.equitySession)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-ivory-500">Symbols</dt><dd className="font-mono text-ivory-100">{checked.loaded.snapshot.watchlist.map((w) => w.symbol).join(", ")}</dd></div>
              </dl>
              {checked.loaded.issues.length > 0 && (
                <ul className="mt-3 max-h-40 space-y-1 overflow-auto font-mono text-2xs text-ivory-500">
                  {checked.loaded.issues.map((i, n) => <li key={n}><span className={i.level === "warning" ? "text-caution" : "text-ivory-600"}>{i.path}</span>: {i.message}</li>)}
                </ul>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn" onClick={() => onPreview(checked.loaded)}>Preview in dashboard</button>
                <button className="btn" onClick={() => {
                  const r = addLocalImport(checked.loaded.snapshot, checked.loaded.raw, checked.fileName);
                  setLocals(loadLocalImports());
                  setNote(!r.ok ? "This browser blocked local storage, so the file could not be kept." : r.duplicate ? "Already in this browser's archive (identical content)." : "Added to this browser's archive. It appears on the History page.");
                }}>Keep in this browser</button>
              </div>
              {note && <p className="mt-2 text-xs text-brass-300">{note}</p>}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel kicker="Step 3" title="Publish it for everyone">
          <ol className="list-decimal space-y-2 pl-5 text-xs leading-relaxed text-ivory-300">
            <li>Open the project on github.com and go to the <span className="font-mono">woi-equity/inbox</span> folder.</li>
            <li>Choose <span className="text-ivory-100">Add file → Upload files</span>, drop the JSON in, and commit to <span className="font-mono">main</span>.</li>
            <li>GitHub validates it with these same rules, archives it, and redeploys the site. An invalid file is rejected and nothing changes.</li>
          </ol>
          <div className="mt-3"><SectionNote>Automated publishing (Gemini) uses the server’s secure ingest endpoint instead; see AUTOMATION_PLAN.md.</SectionNote></div>
        </Panel>

        <Panel kicker="This browser" title="Locally kept imports" right={<span className="font-mono">{locals.length}</span>}>
          {locals.length === 0 ? <SectionNote>None.</SectionNote> : (
            <ul className="divide-y divide-ink-800">
              {locals.map((l) => (
                <li key={l.entry.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="truncate text-ivory-100">{l.fileName}</div>
                    <div className="font-mono text-2xs text-ivory-500">{l.entry.id.replace(/^local:/, "")}</div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button className="btn px-2 py-1 text-2xs" onClick={() => { try { onPreview(validateLoaded(l.raw, { id: "import", label: `Imported file ${l.fileName}` })); } catch { setNote("That stored file no longer validates."); } }}>Preview</button>
                    <button className="btn px-2 py-1 text-2xs" onClick={() => { removeLocalImport(l.entry.id); setLocals(loadLocalImports()); }}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
