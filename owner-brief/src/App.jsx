import React, { useEffect, useMemo, useRef, useState } from "react";
import * as M from "./lib.js";
import { connectRuntime } from "./store.js";

const { L } = M;
const STOP_MSG = "Stopped waiting — the underlying request may still complete in the background and consume usage.";
const AI_ERR = {
  not_granted: "Claude access was not allowed for this artifact. AI buttons stay off; everything else works manually.",
  sampling_disabled: "AI generation is not available for this account.",
  rate_limited: "Claude is rate-limited right now. Try again later (no automatic retry).",
  session_expired: "Your Claude session expired. Sign in again, then retry.",
  refused: "Claude declined this request.",
  empty_completion: "Claude returned nothing.",
  invalid_json: "Claude's reply was not valid JSON. Nothing was changed.",
  prompt_too_large: "The request was too large.",
};
const VIEWS = [
  ["brands", "Brands"],
  ["updates", "Updates"],
  ["brief", "Owner Brief"],
  ["decisions", "Decisions"],
  ["triage", "Blockers & Conflicts"],
  ["weekly", "Weekly Review"],
  ["assignments", "Assignments"],
  ["backup", "Backup & Help"],
];
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default function App() {
  const [state, setStateS] = useState(null);
  const stateRef = useRef(null);
  const [rt, setRt] = useState({ phase: "connecting", reason: null, sample: null, downloads: null });
  const queueRef = useRef(null);
  const [, bump] = useState(0);
  const [view, setView] = useState("brands");
  const [toasts, setToasts] = useState([]);
  const [modal, setModal] = useState(null);
  const [ai, setAi] = useState({ busy: false, kind: null, msg: null, tone: "info", raw: null });
  const aiRef = useRef({ seq: 0, active: null });
  const [capture, setCapture] = useState({ brandId: "", rawText: "", eventDate: "", sourceLabel: "", staged: null, stagedFor: null });
  const [staged, setStaged] = useState({}); // updateId -> {for: version, data}
  const [focusAssignment, setFocusAssignment] = useState(null);

  const toast = (msg, tone = "info", ms = 5500) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-3), { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  };

  // ---------- boot ----------
  useEffect(() => {
    (async () => {
      const r = await connectRuntime();
      let s = null;
      let phase = "session";
      let reason = r.reason;
      if (r.store) {
        try {
          s = await r.store.load();
          phase = "personal";
        } catch (e) {
          reason = `Personal storage could not be read (${e.message || e.code}). Working in this session only; your stored copy was not touched.`;
        }
        if (phase === "personal") {
          queueRef.current = new M.SaveQueue((snap, seq) => r.store.save(snap, seq), () => bump((n) => n + 1));
        }
      }
      const first = !s;
      if (!s) s = M.emptyState();
      stateRef.current = s;
      setStateS(s);
      setRt({ phase, reason, sample: r.sample, downloads: r.downloads });
      if (phase === "personal" && first) queueRef.current.push(s, s.storageSeq);
      setCapture((c) => ({ ...c, brandId: s.brands.find((b) => !b.archived)?.id || "" }));
    })();
  }, []);

  /** The only way state changes. content=false: storage-only write (brief save, lastCopiedAt, UI prefs, assignment text). */
  const commit = (mutate, { content = true } = {}) => {
    const next = M.clone(stateRef.current);
    const res = mutate(next);
    if (res === false) return null;
    if (content) next.contentRevision += 1;
    next.storageSeq += 1;
    stateRef.current = next;
    setStateS(next);
    if (queueRef.current) queueRef.current.push(next, next.storageSeq);
    return next;
  };

  // ---------- AI single-flight ----------
  const startAi = (kind, context) => {
    if (aiRef.current.active) return null;
    const ctl = new AbortController();
    const req = { id: ++aiRef.current.seq, kind, startContentRevision: stateRef.current.contentRevision, ctl, ...context };
    aiRef.current.active = req;
    setAi({ busy: true, kind, msg: kind === "brief" ? "Generating Owner Brief…" : "Extracting fields…", tone: "info", raw: null });
    return req;
  };
  const isCurrent = (req) => aiRef.current.active && aiRef.current.active.id === req.id;
  const endAi = (req, patch) => {
    if (isCurrent(req)) aiRef.current.active = null;
    setAi({ busy: false, kind: null, raw: null, ...patch });
  };
  const stopWaiting = () => {
    const a = aiRef.current.active;
    if (!a) return;
    aiRef.current.active = null; // invalidate requestId: any late response is ignored
    a.ctl.abort();
    setAi({ busy: false, kind: null, msg: STOP_MSG, tone: "warn", raw: null });
  };
  const aiFail = (req, e) => {
    if (!isCurrent(req)) return;
    if (e?.code === "cancelled") return endAi(req, { msg: STOP_MSG, tone: "warn" });
    endAi(req, { msg: AI_ERR[e?.code] || e?.message || "AI request failed. Nothing was changed.", tone: "block", raw: e?.text || null });
  };

  // ---------- capture ----------
  const extractCapture = async () => {
    const sample = rt.sample;
    if (!sample || !capture.rawText.trim() || !capture.brandId) return;
    const snapshot = { brandId: capture.brandId, rawText: capture.rawText, eventDate: capture.eventDate || null, sourceLabel: capture.sourceLabel };
    const req = startAi("extract-capture", { snapshot });
    if (!req) return;
    try {
      const raw = await sample.json(M.extractionPrompt(stateRef.current, snapshot), { signal: req.ctl.signal, cache: false });
      if (!isCurrent(req)) return toast("Ignored stale AI response.", "info");
      let v;
      try {
        v = M.validateExtraction(stateRef.current, raw, { brandId: snapshot.brandId, rawText: snapshot.rawText });
      } catch (err) {
        return endAi(req, { msg: `AI output failed validation: ${err.message} Nothing was changed.`, tone: "block", raw: JSON.stringify(raw, null, 2) });
      }
      setCapture((c) => (c.rawText === snapshot.rawText && c.brandId === snapshot.brandId ? { ...c, staged: v, stagedFor: snapshot } : c));
      endAi(req, { msg: "Proposals staged below. Review, remove anything wrong, then Save Update. Nothing is saved yet.", tone: "ok" });
    } catch (e) {
      aiFail(req, e);
    }
  };
  const captureChanged = (patch) => {
    // Editing the text during extraction supersedes that request.
    const a = aiRef.current.active;
    if (a && a.kind === "extract-capture" && (patch.rawText !== undefined || patch.brandId !== undefined)) {
      aiRef.current.active = null;
      a.ctl.abort();
      setAi({ busy: false, kind: null, msg: "You edited the note while AI was working, so that response will be ignored. " + STOP_MSG, tone: "warn" });
    }
    setCapture((c) => ({ ...c, ...patch }));
  };
  const saveCapture = (withExtraction) => {
    const c = capture;
    if (!c.brandId || !c.rawText.trim()) return toast("Pick a brand and paste the note first.", "warn");
    if (c.eventDate && !M.isDateOnly(c.eventDate)) return toast("Event date must be a real date (YYYY-MM-DD).", "warn");
    let newId = null;
    commit((s) => {
      const u = M.newUpdate(s, { brandId: c.brandId, rawText: c.rawText, eventDate: c.eventDate || null, sourceLabel: c.sourceLabel.trim() });
      s.updates.push(u);
      newId = u.id;
      if (withExtraction && c.staged) M.applyExtraction(s, u.id, c.staged);
    });
    setCapture({ brandId: c.brandId, rawText: "", eventDate: "", sourceLabel: "", staged: null, stagedFor: null });
    setAi((a) => ({ ...a, msg: null }));
    toast(withExtraction ? `Saved update ${newId} with proposals as unconfirmed.` : `Saved ${newId} as Raw only. No AI was used.`, "ok");
  };

  // ---------- extraction for a saved update ----------
  const extractSaved = async (u) => {
    const sample = rt.sample;
    if (!sample) return;
    const rev = M.currentRev(u);
    const snapshot = { brandId: u.brandId, rawText: rev.rawText, eventDate: rev.eventDate, sourceLabel: rev.sourceLabel, excludeUpdateId: u.id };
    const req = startAi("extract-saved", { updateId: u.id, updateVersion: u.version });
    if (!req) return;
    try {
      const raw = await sample.json(M.extractionPrompt(stateRef.current, snapshot), { signal: req.ctl.signal, cache: false });
      const cur = stateRef.current.updates.find((x) => x.id === u.id);
      if (!isCurrent(req) || !cur || cur.version !== req.updateVersion) {
        if (isCurrent(req)) endAi(req, { msg: "Update changed while AI was working; response ignored.", tone: "warn" });
        return toast("Ignored stale AI response.", "info");
      }
      let v;
      try {
        v = M.validateExtraction(stateRef.current, raw, { brandId: u.brandId, rawText: rev.rawText, excludeUpdateId: u.id });
      } catch (err) {
        return endAi(req, { msg: `AI output failed validation: ${err.message} Nothing was changed.`, tone: "block", raw: JSON.stringify(raw, null, 2) });
      }
      setStaged((m) => ({ ...m, [u.id]: { forVersion: u.version, data: v } }));
      endAi(req, { msg: `Proposals staged on update ${u.id}. Review them there; nothing is saved yet.`, tone: "ok" });
    } catch (e) {
      aiFail(req, e);
    }
  };

  // ---------- owner brief ----------
  const generateBrief = async () => {
    const s0 = stateRef.current;
    const compiled = M.compileBrief(s0);
    const base = { generatedAt: M.nowIso(), basedOnContentRevision: s0.contentRevision, sections: compiled.sections, coverage: compiled.coverage, priorities: [], aiNotes: [], aiStatus: "not_run" };
    if (!rt.sample) {
      commit((s) => void (s.brief = { ...base, aiStatus: "unavailable" }), { content: false });
      return toast("Owner Brief compiled without AI (AI unavailable here). Suggested priorities: None.", "warn");
    }
    const req = startAi("brief", {});
    if (!req) return;
    try {
      const raw = await sample_json(rt.sample, M.briefPrompt(s0, compiled.aiInput), req.ctl.signal);
      if (!isCurrent(req)) return toast("Ignored stale AI response.", "info");
      if (stateRef.current.contentRevision !== req.startContentRevision) return endAi(req, { msg: "Records changed while the brief was generating, so that response was ignored. Generate again.", tone: "warn" });
      let v;
      try {
        v = M.validatePriorities(stateRef.current, raw);
      } catch (err) {
        return endAi(req, { msg: `AI output failed validation: ${err.message} The previous brief was kept.`, tone: "block", raw: JSON.stringify(raw, null, 2) });
      }
      commit((s) => void (s.brief = { ...base, priorities: v.priorities, aiNotes: v.notes, aiStatus: "ok" }), { content: false });
      endAi(req, { msg: "Owner Brief generated.", tone: "ok" });
    } catch (e) {
      aiFail(req, e);
    }
  };

  // ---------- clipboard & files ----------
  const manual = (title, text, extra) => setModal({ type: "manual", title, text, ...extra });
  const copy = async (text, ok, onCopied, title = "Copy manually") => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      onCopied?.();
      toast(ok, "ok");
    } catch {
      manual(title, text, { note: "Clipboard access was blocked. The text is selected: press Cmd+C or Ctrl+C.", onCopied });
    }
  };
  const exportJson = async () => {
    const s = stateRef.current;
    const text = M.exportJson(s);
    const name = `margots-owner-brief-${M.todayPhx()}.json`;
    if (rt.downloads) {
      try {
        await rt.downloads.save({ filename: name, data: text });
        return toast(`Saved ${name}.`, "ok");
      } catch (e) {
        if (e?.code === "declined") return toast("Download cancelled.");
      }
    }
    manual("Export JSON", text, { note: `Downloads aren't available here. Select all, copy, and save as ${name}.` });
  };

  if (!state)
    return (
      <div className="boot">
        <div className="mark">MOB</div>
        <p>Connecting to personal storage…</p>
      </div>
    );

  // ---------- storage badge ----------
  const q = queueRef.current;
  let badge;
  if (rt.phase !== "personal") badge = { tone: "warn", text: "Session only — export JSON to keep", title: rt.reason };
  else if (q.state === "failed") badge = { tone: "block", text: "Save failed — retry or export JSON", title: `${q.error?.message || q.error?.code || "Storage error"}. Click to retry. Your data is still here in memory.`, retry: true };
  else if (q.state === "saving") badge = { tone: "muted", text: "Saving..." };
  else badge = { tone: "ok", text: "Saved to personal storage", title: q.savedAt ? `Last write ${M.fmtDateTime(q.savedAt.toISOString())}` : "" };

  const brands = state.brands;
  const activeBrands = brands.filter((b) => !b.archived);
  const bname = (id) => brands.find((b) => b.id === id)?.name || id;
  const briefStale = state.brief && state.contentRevision > state.brief.basedOnContentRevision;
  const counts = {
    decisions: state.decisions.filter((d) => d.status === "Open").length + state.objectiveProposals.filter((p) => p.status === "pending").length,
    triage: state.blockers.filter((b) => b.status === "open").length + state.conflicts.filter((c) => c.status === "possible_conflict").length,
    assignments: state.assignments.filter((a) => M.assignmentChanges(state, a).length).length,
  };
  const ctx = { state, commit, bname, toast, setModal, setView, rt, ai, startCaptureFor: (bid) => (captureChanged({ brandId: bid }), setView("capture")) };

  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <h1 className="title">Margot's Owner Brief</h1>
          <span className="grow" />
          <button className={`badge-store tone-${badge.tone}`} title={badge.title} onClick={() => (badge.retry ? q.retry() : badge.tone === "warn" ? setView("backup") : null)} aria-live="polite">
            <span className="dot" aria-hidden="true" />
            {badge.text}
          </button>
          <button className="btn primary" id="capture-btn" onClick={() => setView("capture")}>+ Capture Update</button>
        </div>
        <nav className="tabs" aria-label="Views">
          {VIEWS.map(([k, label]) => (
            <button key={k} className={`tab ${view === k ? "on" : ""}`} aria-current={view === k ? "page" : undefined} onClick={() => setView(k)}>
              {label}
              {counts[k] ? <span className="count">{counts[k]}</span> : null}
              {k === "brief" && briefStale ? <span className="count warn">!</span> : null}
            </button>
          ))}
        </nav>
      </header>

      {(ai.busy || ai.msg) && (
        <div className={`ai-bar tone-${ai.busy ? "info" : ai.tone}`} role="status">
          <span>{ai.msg}</span>
          {ai.busy && <button className="btn small" id="stop-waiting" onClick={stopWaiting}>Stop waiting</button>}
          {!ai.busy && <button className="btn link small" onClick={() => setAi({ busy: false, msg: null })}>Dismiss</button>}
          {ai.raw && (
            <details className="raw-out">
              <summary>Show the AI output (plain text)</summary>
              <pre>{ai.raw}</pre>
            </details>
          )}
        </div>
      )}

      <main className="main">
        {view === "capture" && (
          <CaptureView
            {...ctx}
            capture={capture}
            onChange={captureChanged}
            onSaveRaw={() => saveCapture(false)}
            onSaveExtracted={() => saveCapture(true)}
            onExtract={extractCapture}
            onDiscard={() => setCapture((c) => ({ ...c, staged: null, stagedFor: null }))}
            setStagedData={(d) => setCapture((c) => ({ ...c, staged: d }))}
          />
        )}
        {view === "brands" && <BrandsView {...ctx} />}
        {view === "updates" && <UpdatesView {...ctx} staged={staged} setStaged={setStaged} onExtract={extractSaved} />}
        {view === "brief" && <BriefView {...ctx} onGenerate={generateBrief} stale={briefStale} />}
        {view === "decisions" && <DecisionsView {...ctx} onAssign={(id) => (setFocusAssignment(id), setView("assignments"))} />}
        {view === "triage" && <TriageView {...ctx} />}
        {view === "weekly" && <WeeklyView {...ctx} />}
        {view === "assignments" && <AssignmentsView {...ctx} copy={copy} focus={focusAssignment} setFocus={setFocusAssignment} />}
        {view === "backup" && <BackupView {...ctx} onExport={exportJson} copy={copy} queue={q} replaceState={(s) => {
          s.storageSeq = Math.max(s.storageSeq || 0, stateRef.current.storageSeq) + 1;
          stateRef.current = s;
          setStateS(s);
          if (queueRef.current) queueRef.current.push(s, s.storageSeq);
        }} />}
      </main>

      {modal && <Modal modal={modal} close={() => setModal(null)} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast tone-${t.tone}`}>{t.msg}</div>)}
      </div>
    </div>
  );
}

const sample_json = (sample, prompt, signal) => sample.json(prompt, { signal, cache: false });

// ====================================================================================
// Shared bits
function Badge({ children, tone = "muted", title }) {
  return <span className={`pill tone-${tone}`} title={title}>{children}</span>;
}
function claimTone(it) {
  if (it.confirmation === "owner_confirmed") return "ok";
  return it.origin === "ai_proposed" ? "ai" : it.origin === "source_reported" ? "src" : "own";
}
function ClaimBadge({ it }) {
  return <Badge tone={claimTone(it)}>{M.claimLabel(it)}</Badge>;
}
function RefChip({ state, r }) {
  const st = M.refStatus(state, r);
  return (
    <span className={`ref ${st.missing ? "ref-missing" : st.stale ? "ref-stale" : ""}`} title={st.text || "Reference is current"}>
      {r.type} {r.id} v{r.recordVersion}
      {st.missing ? " · Missing" : st.stale ? ` · ${L.needs_review}` : ""}
    </span>
  );
}
function Refs({ state, refs }) {
  if (!refs?.length) return null;
  return <span className="refs">{refs.map((r, i) => <RefChip key={i} state={state} r={r} />)}</span>;
}
function DateLine({ eventDate, capturedAt }) {
  return (
    <span className="dateline">
      {eventDate ? <>Event: {eventDate}</> : <>{L.no_event_date}</>}
      <span className="sep">·</span>Captured: {M.fmtDay(capturedAt)}
    </span>
  );
}
function BrandSelect({ id, brands, value, onChange, includeAll }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {includeAll && <option value="">All active brands</option>}
      {!includeAll && !value && <option value="">Choose a brand…</option>}
      {brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.archived ? " (archived)" : ""}</option>)}
    </select>
  );
}
function RefPicker({ state, brandId, refs, setRefs, id }) {
  const [sel, setSel] = useState("");
  const opts = brandId ? M.refOptions(state, brandId) : [];
  return (
    <div className="stack">
      <div className="row">
        <select id={id} value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Add a reference">
          <option value="">{brandId ? "Add a supporting record (optional)…" : "Choose a brand first"}</option>
          {opts.map((o) => <option key={`${o.type}:${o.id}`} value={`${o.type}:${o.id}`}>{o.label}</option>)}
        </select>
        <button className="btn small" disabled={!sel} onClick={() => {
          const [t, i] = sel.split(":");
          const r = M.makeRef(state, t, i);
          if (r && !refs.some((x) => M.refKey(x) === M.refKey(r))) setRefs([...refs, r]);
          setSel("");
        }}>Add</button>
      </div>
      {refs.length > 0 && (
        <div className="row">
          {refs.map((r) => (
            <span key={M.refKey(r)} className="ref">{r.label || `${r.type} ${r.id}`} v{r.recordVersion}
              <button className="x" aria-label="Remove reference" onClick={() => setRefs(refs.filter((x) => M.refKey(x) !== M.refKey(r)))}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
function NoteAction({ label, placeholder, onSubmit, tone }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open) return <button className={`btn small ${tone || ""}`} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <span className="inline-form">
      <input value={note} placeholder={placeholder || "Optional note"} onChange={(e) => setNote(e.target.value)} aria-label={`${label} note`} />
      <button className="btn small primary" onClick={() => (onSubmit(note.trim()), setOpen(false), setNote(""))}>{label}</button>
      <button className="btn small" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}
function Capped({ items, render, empty = L.none, cap = 5 }) {
  const [all, setAll] = useState(false);
  if (!items.length) return <p className="none">{empty}</p>;
  const shown = all ? items : items.slice(0, cap);
  return (
    <>
      <ul className="bullets">{shown.map(render)}</ul>
      {items.length > cap && (
        <button className="btn link small" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Show less" : `Show ${items.length - cap} more`}
        </button>
      )}
    </>
  );
}

// ====================================================================================
function CaptureView({ state, capture: c, onChange, onSaveRaw, onSaveExtracted, onExtract, onDiscard, setStagedData, rt, ai, bname }) {
  const active = state.brands.filter((b) => !b.archived);
  const stagedStale = c.staged && c.stagedFor && (c.stagedFor.rawText !== c.rawText || c.stagedFor.brandId !== c.brandId);
  return (
    <section className="panel" aria-labelledby="cap-h">
      <h2 id="cap-h">Capture Update</h2>
      <div className="grid2">
        <label className="stack"><span className="lbl">Brand (required)</span>
          <BrandSelect id="cap-brand" brands={active} value={c.brandId} onChange={(v) => onChange({ brandId: v })} />
        </label>
        <label className="stack"><span className="lbl">Source label (optional)</span>
          <input id="cap-source" value={c.sourceLabel} placeholder="e.g. Call with editor, Slack note" onChange={(e) => onChange({ sourceLabel: e.target.value })} />
        </label>
        <label className="stack"><span className="lbl">Event date (optional)</span>
          <span className="row nowrap">
            <input id="cap-date" type="date" value={c.eventDate} onChange={(e) => onChange({ eventDate: e.target.value })} />
            {c.eventDate && <button className="btn small" onClick={() => onChange({ eventDate: "" })}>Clear</button>}
          </span>
          {!c.eventDate && <span className="hint">{L.no_event_date}. The capture time is recorded separately and never used as the event date.</span>}
        </label>
      </div>
      <label className="stack"><span className="lbl">Raw note (required, saved verbatim)</span>
        <textarea id="cap-raw" rows={9} value={c.rawText} onChange={(e) => onChange({ rawText: e.target.value })} placeholder="Paste or type the update exactly as received." />
      </label>
      <div className="row">
        <button className="btn primary" id="save-raw" onClick={onSaveRaw}>Save Raw Note</button>
        <button className="btn" id="extract" disabled={!rt.sample || ai.busy || !c.rawText.trim() || !c.brandId} onClick={onExtract}>
          {rt.sample ? "Extract Fields (AI)" : "Extract Fields (AI) — unavailable here"}
        </button>
        <span className="hint">Save Raw Note uses no AI. Extract runs only when you click it.</span>
      </div>
      {c.staged && (
        <div className="staged">
          <h3>Staged proposals (not saved)</h3>
          {stagedStale && <div className="banner warn">The note changed after extraction. Run Extract again, or Save Raw Note without these proposals.</div>}
          <StagedList data={c.staged} setData={setStagedData} state={state} bname={bname} />
          <div className="row">
            <button className="btn primary" id="save-update" disabled={stagedStale} onClick={onSaveExtracted}>Save Update</button>
            <button className="btn" onClick={onDiscard}>Discard proposals</button>
            <span className="hint">Saved proposals stay unconfirmed until you confirm each one.</span>
          </div>
        </div>
      )}
    </section>
  );
}

function StagedList({ data, setData, state, bname }) {
  const drop = (key, idx) => setData({ ...data, [key]: data[key].filter((_, i) => i !== idx) });
  const lbl = (o) => (o === "source_reported" ? L.source_reported : L.ai_proposed);
  return (
    <div className="stack">
      {data.notes.length > 0 && <ul className="notes">{data.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      {data.items.length + data.blockers.length + data.conflicts.length === 0 && !data.objective && <p className="none">{L.none}</p>}
      <ul className="staged-list">
        {data.items.map((it, i) => (
          <li key={`i${i}`}>
            <Badge tone={it.origin === "ai_proposed" ? "ai" : "src"}>{lbl(it.origin)}</Badge> <b>{M.ITEM_KINDS[it.kind]}:</b> {it.text}
            {it.excerpt && <span className="excerpt">“{it.excerpt}”</span>}
            <button className="btn link small" onClick={() => drop("items", i)}>Remove</button>
          </li>
        ))}
        {data.blockers.map((b, i) => (
          <li key={`b${i}`}>
            <Badge tone={b.origin === "ai_proposed" ? "ai" : "src"}>{lbl(b.origin)}</Badge> <b>Blocker candidate:</b> {b.summary}
            {b.suggestedDuplicateOf && <span className="hint"> Possible duplicate of Blocker #{b.suggestedDuplicateOf} (not merged)</span>}
            <button className="btn link small" onClick={() => drop("blockers", i)}>Remove</button>
          </li>
        ))}
        {data.conflicts.map((cf, i) => (
          <li key={`c${i}`}>
            <Badge tone="warn">{L.possible_conflict}</Badge> {cf.summary} <span className="ref">{cf.otherRef.type} {cf.otherRef.id}</span>
            {!cf.otherExcerptVerified && <span className="hint"> Other excerpt not found verbatim.</span>}
            <button className="btn link small" onClick={() => drop("conflicts", i)}>Remove</button>
          </li>
        ))}
        {data.objective && (
          <li>
            <Badge tone="ai">Proposed objective change</Badge> “{data.objective.text}” <span className="hint">Staged for your approval in Decisions; never applied automatically.{!data.objective.excerptVerified && " Not found verbatim in the note."}</span>
            <button className="btn link small" onClick={() => setData({ ...data, objective: null })}>Remove</button>
          </li>
        )}
      </ul>
    </div>
  );
}

// ====================================================================================
function BrandsView({ state, commit, toast, startCaptureFor }) {
  const [name, setName] = useState("");
  const show = state.ui.showArchived;
  const list = state.brands.filter((b) => show || !b.archived);
  return (
    <section aria-labelledby="br-h">
      <div className="view-head">
        <h2 id="br-h">Brands</h2>
        <label className="toggle"><input type="checkbox" id="show-archived" checked={show} onChange={(e) => commit((s) => void (s.ui.showArchived = e.target.checked), { content: false })} /> Show archived</label>
        <span className="grow" />
        <span className="inline-form">
          <input id="new-brand" value={name} placeholder="New brand name" onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={() => {
            const n = name.trim();
            if (!n) return;
            if (state.brands.some((b) => b.name.toLowerCase() === n.toLowerCase())) return toast("A brand with that name exists (restore it if archived).", "warn");
            commit((s) => void s.brands.push(M.newBrand(s, n)));
            setName("");
          }}>Add brand</button>
        </span>
      </div>
      <div className="cards">
        {list.map((b) => <BrandCard key={b.id} b={b} state={state} commit={commit} startCaptureFor={startCaptureFor} />)}
      </div>
    </section>
  );
}

function BrandCard({ b, state, commit, startCaptureFor }) {
  const [renaming, setRenaming] = useState(null);
  const [obj, setObj] = useState(null);
  const prog = M.latestItem(state, b.id, "progress");
  const next = M.latestItem(state, b.id, "nextActions");
  const blockers = state.blockers.filter((x) => x.brandId === b.id && x.status === "open");
  const conflicts = state.conflicts.filter((x) => x.brandId === b.id && M.isActiveConflict(x));
  const pending = state.objectiveProposals.filter((p) => p.brandId === b.id && p.status === "pending").length;
  const latestUpd = M.sortUpdates(state.updates.filter((u) => u.brandId === b.id))[0];
  const Line = ({ label, hit }) => (
    <div className="kv">
      <span className="k">{label}</span>
      {hit ? (
        <span className="v"><ClaimBadge it={hit.item} /> {hit.item.text} <DateLine eventDate={M.updEventDate(hit.update)} capturedAt={hit.update.capturedAt} /></span>
      ) : (
        <span className="v none">{latestUpd ? `${L.none} (latest update ${latestUpd.id} is ${latestUpd.extractionStatus === "raw_only" ? L.raw_only : "without this field"})` : L.no_update}</span>
      )}
    </div>
  );
  return (
    <article className={`card brand ${b.archived ? "archived" : ""}`} aria-label={b.name}>
      <header className="card-h">
        {renaming !== null ? (
          <span className="inline-form">
            <input value={renaming} onChange={(e) => setRenaming(e.target.value)} aria-label="Brand name" />
            <button className="btn small primary" onClick={() => {
              const n = renaming.trim();
              if (n && n !== b.name) commit((s) => { const x = s.brands.find((y) => y.id === b.id); x.name = n; x.version += 1; x.updatedAt = M.nowIso(); });
              setRenaming(null);
            }}>Save</button>
            <button className="btn small" onClick={() => setRenaming(null)}>Cancel</button>
          </span>
        ) : (
          <h3>{b.name}</h3>
        )}
        {b.archived && <Badge>Archived</Badge>}
      </header>
      <div className="kv">
        <span className="k">Objective</span>
        {obj !== null ? (
          <span className="v stack">
            <textarea rows={2} value={obj} onChange={(e) => setObj(e.target.value)} aria-label={`Objective for ${b.name}`} />
            <span className="row">
              <button className="btn small primary" onClick={() => {
                const t = obj.trim();
                if (t && t !== b.currentObjective) commit((s) => void M.setObjective(s.brands.find((y) => y.id === b.id), t, "Edited by owner"));
                setObj(null);
              }}>Save objective</button>
              <button className="btn small" onClick={() => setObj(null)}>Cancel</button>
            </span>
          </span>
        ) : b.currentObjective ? (
          <span className="v"><Badge tone="ok">{L.owner_confirmed}</Badge> {b.currentObjective} <span className="hint">v{b.objectiveVersion} · {M.fmtDay(b.objectiveUpdatedAt)}</span></span>
        ) : (
          <span className="v none">{L.no_objective}</span>
        )}
      </div>
      {pending > 0 && <p className="hint warn-text">{plural(pending, "Proposed objective change")} waiting in Decisions.</p>}
      <Line label="Latest progress" hit={prog} />
      <Line label="Next action" hit={next} />
      <div className="kv">
        <span className="k">Open blockers</span>
        <span className="v">
          {blockers.length ? (
            <ul className="mini">{blockers.map((x) => <li key={x.id}><ClaimBadge it={x} /> {x.id}: {x.summary}{x.duplicateOfBlockerId ? ` (duplicate of ${x.duplicateOfBlockerId})` : ""}</li>)}</ul>
          ) : <span className="none">{L.none}</span>}
        </span>
      </div>
      <div className="kv">
        <span className="k">Active conflicts</span>
        <span className="v">
          {conflicts.length ? <ul className="mini">{conflicts.map((x) => <li key={x.id}><Badge tone="warn">{L[x.status]}</Badge> {x.id}: {x.summary}</li>)}</ul> : <span className="none">{L.none}</span>}
        </span>
      </div>
      <footer className="row card-f">
        {!b.archived && <button className="btn small primary" onClick={() => startCaptureFor(b.id)}>Capture update</button>}
        <button className="btn small" onClick={() => setObj(b.currentObjective || "")}>{b.currentObjective ? "Edit objective" : "Set objective"}</button>
        <button className="btn small" onClick={() => setRenaming(b.name)}>Rename</button>
        <button className="btn small" onClick={() => commit((s) => { const x = s.brands.find((y) => y.id === b.id); x.archived = !x.archived; x.version += 1; x.updatedAt = M.nowIso(); })}>{b.archived ? "Restore" : "Archive"}</button>
      </footer>
    </article>
  );
}

// ====================================================================================
function UpdatesView({ state, commit, staged, setStaged, onExtract, rt, ai, bname }) {
  const [brand, setBrand] = useState("");
  const list = M.sortUpdates(state.updates.filter((u) => (brand ? u.brandId === brand : !state.brands.find((b) => b.id === u.brandId)?.archived)));
  return (
    <section aria-labelledby="up-h">
      <div className="view-head">
        <h2 id="up-h">Updates</h2>
        <BrandSelect id="up-brand" brands={state.brands} value={brand} onChange={setBrand} includeAll />
        <span className="hint">Newest first by event date, or capture date when no event date was supplied.</span>
      </div>
      {!list.length && <p className="none">{L.no_update}</p>}
      <div className="stack-l">
        {list.map((u) => <UpdateCard key={u.id} u={u} state={state} commit={commit} staged={staged[u.id]} setStaged={(d) => setStaged((m) => ({ ...m, [u.id]: d }))} onExtract={onExtract} rt={rt} ai={ai} bname={bname} />)}
      </div>
    </section>
  );
}

function UpdateCard({ u, state, commit, staged, setStaged, onExtract, rt, ai, bname }) {
  const rev = M.currentRev(u);
  const [hist, setHist] = useState(false);
  const [corr, setCorr] = useState(null);
  const [add, setAdd] = useState({ kind: "progress", text: "" });
  const status = u.extractionStatus === "raw_only" ? [L.raw_only, "muted"] : u.extractionStatus === "needs_refresh" ? [L.needs_refresh, "warn"] : ["Extracted", "ok"];
  const live = u.items.filter((i) => !i.removed);
  const removed = u.items.length - live.length;
  const stagedStale = staged && staged.forVersion !== u.version;
  const editItem = (iid, fn) => commit((s) => {
    const uu = s.updates.find((x) => x.id === u.id);
    const it = uu.items.find((x) => x.id === iid);
    fn(it, uu);
    uu.version += 1;
    uu.updatedAt = M.nowIso();
  });
  return (
    <article className="card update" aria-label={`Update ${u.id}`}>
      <header className="card-h">
        <h3>{bname(u.brandId)} · Update {u.id}</h3>
        <Badge tone={status[1]}>{status[0]}</Badge>
        <span className="hint">v{u.version} · revision {rev.revisionNumber}</span>
      </header>
      <p className="meta"><DateLine eventDate={rev.eventDate} capturedAt={u.capturedAt} />{rev.sourceLabel && <><span className="sep">·</span>Source: {rev.sourceLabel}</>}</p>
      {u.extractionStatus === "needs_refresh" && <div className="banner warn">{L.needs_refresh}: the raw text was corrected after extraction (from revision {u.extractedFromRevision}). Existing items are kept; re-run extraction to stage new proposals.</div>}
      <pre className="raw">{rev.rawText}</pre>
      {live.length > 0 && (
        <div className="items">
          {Object.keys(M.ITEM_KINDS).map((k) => {
            const its = live.filter((i) => i.kind === k);
            if (!its.length) return null;
            return (
              <div key={k}>
                <h4>{M.ITEM_KINDS[k]}</h4>
                <ul className="item-list">{its.map((it) => <ItemRow key={it.id} it={it} state={state} edit={(fn) => editItem(it.id, fn)} />)}</ul>
              </div>
            );
          })}
        </div>
      )}
      {removed > 0 && <p className="hint">{plural(removed, "dismissed item")} kept in history.</p>}
      {staged && (
        <div className="staged">
          <h4>Staged proposals for {u.id} (not saved)</h4>
          {stagedStale && <div className="banner warn">This update changed after extraction. Discard and extract again.</div>}
          <StagedList data={staged.data} setData={(d) => setStaged({ ...staged, data: d })} state={state} bname={bname} />
          <div className="row">
            <button className="btn primary small" disabled={stagedStale} onClick={() => { commit((s) => void M.applyExtraction(s, u.id, staged.data)); setStaged(undefined); }}>Save extraction</button>
            <button className="btn small" onClick={() => setStaged(undefined)}>Discard proposals</button>
          </div>
        </div>
      )}
      {corr && (
        <div className="correct">
          <h4>Create Corrected Revision</h4>
          <p className="hint">Earlier revisions stay saved verbatim. Linked briefs show Needs refresh and linked assignments show Needs review.</p>
          <textarea rows={6} value={corr.rawText} onChange={(e) => setCorr({ ...corr, rawText: e.target.value })} aria-label="Corrected raw text" />
          <div className="grid2">
            <label className="stack"><span className="lbl">Event date</span><input type="date" value={corr.eventDate} onChange={(e) => setCorr({ ...corr, eventDate: e.target.value })} /></label>
            <label className="stack"><span className="lbl">Source label</span><input value={corr.sourceLabel} onChange={(e) => setCorr({ ...corr, sourceLabel: e.target.value })} /></label>
            <label className="stack"><span className="lbl">Correction note</span><input value={corr.note} onChange={(e) => setCorr({ ...corr, note: e.target.value })} placeholder="What was corrected?" /></label>
          </div>
          <div className="row">
            <button className="btn primary small" id={`save-rev-${u.id}`} onClick={() => {
              if (corr.eventDate && !M.isDateOnly(corr.eventDate)) return;
              if (corr.rawText === rev.rawText && (corr.eventDate || null) === rev.eventDate && corr.sourceLabel === rev.sourceLabel) return setCorr(null);
              commit((s) => void M.appendRevision(s.updates.find((x) => x.id === u.id), { rawText: corr.rawText, eventDate: corr.eventDate || null, sourceLabel: corr.sourceLabel, correctionNote: corr.note.trim() || undefined }));
              setCorr(null);
            }}>Save corrected revision</button>
            <button className="btn small" onClick={() => setCorr(null)}>Cancel</button>
          </div>
        </div>
      )}
      {hist && (
        <div className="history">
          <h4>Revision history</h4>
          {u.revisions.map((r) => (
            <div key={r.revisionNumber} className="rev">
              <p className="meta">Revision {r.revisionNumber} · {M.fmtDateTime(r.createdAt)} · {r.eventDate ? `Event: ${r.eventDate}` : L.no_event_date}{r.sourceLabel ? ` · Source: ${r.sourceLabel}` : ""}{r.correctionNote ? ` · Note: ${r.correctionNote}` : ""}</p>
              <pre className="raw">{r.rawText}</pre>
            </div>
          ))}
        </div>
      )}
      <div className="row add-item">
        <select value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value })} aria-label="Item type">
          {Object.entries(M.ITEM_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input value={add.text} placeholder="Add your own item (Owner-authored)" onChange={(e) => setAdd({ ...add, text: e.target.value })} aria-label="Item text" />
        <button className="btn small" disabled={!add.text.trim()} onClick={() => {
          commit((s) => {
            const uu = s.updates.find((x) => x.id === u.id);
            uu.version += 1;
            uu.items.push(M.newClaim("owner_authored", { id: M.nextId(s, "item", "I"), kind: add.kind, text: add.text.trim(), excerpt: null, fromRevision: uu.revisions.length, sourceRefs: [{ type: "update", id: uu.id, recordVersion: uu.version, label: `Update ${uu.id}` }] }));
          });
          setAdd({ ...add, text: "" });
        }}>Add item</button>
      </div>
      <footer className="row card-f">
        <button className="btn small" disabled={!rt.sample || ai.busy} onClick={() => onExtract(u)}>{rt.sample ? (u.extractionStatus === "raw_only" ? "Extract Fields (AI)" : "Re-extract (AI)") : "Extract Fields (AI) — unavailable here"}</button>
        <button className="btn small" onClick={() => setCorr({ rawText: rev.rawText, eventDate: rev.eventDate || "", sourceLabel: rev.sourceLabel, note: "" })}>Create Corrected Revision</button>
        <button className="btn small" aria-expanded={hist} onClick={() => setHist(!hist)}>{hist ? "Hide" : "Revision history"} ({u.revisions.length})</button>
      </footer>
    </article>
  );
}

function ItemRow({ it, state, edit }) {
  const [txt, setTxt] = useState(null);
  return (
    <li className="item">
      <ClaimBadge it={it} />
      {txt === null ? <span className="it-text">{it.text}</span> : (
        <span className="inline-form grow">
          <input value={txt} onChange={(e) => setTxt(e.target.value)} aria-label="Edit item" />
          <button className="btn small primary" onClick={() => {
            const t = txt.trim();
            if (t && t !== it.text) edit((x) => {
              x.text = t;
              x.version += 1;
              x.updatedAt = M.nowIso();
              if (x.confirmation === "owner_confirmed") M.setConfirmation(x, "unconfirmed", "Text edited — confirm again");
            });
            setTxt(null);
          }}>Save</button>
          <button className="btn small" onClick={() => setTxt(null)}>Cancel</button>
        </span>
      )}
      {it.excerpt && <span className="excerpt">“{it.excerpt}”</span>}
      <Refs state={state} refs={(it.sourceRefs || []).filter((r) => M.refStatus(state, r).stale || M.refStatus(state, r).missing)} />
      <span className="item-actions">
        {it.confirmation === "owner_confirmed" ? (
          <button className="btn link small" onClick={() => edit((x) => M.setConfirmation(x, "unconfirmed", "Unconfirmed by owner"))}>Unconfirm</button>
        ) : (
          <button className="btn link small" onClick={() => edit((x) => M.setConfirmation(x, "owner_confirmed", "Confirmed by owner"))}>Confirm</button>
        )}
        {txt === null && <button className="btn link small" onClick={() => setTxt(it.text)}>Edit</button>}
        <button className="btn link small danger" onClick={() => edit((x) => { x.removed = true; x.version += 1; x.confirmationHistory.push({ status: x.confirmation, at: M.nowIso(), note: "Dismissed by owner" }); })}>Dismiss</button>
      </span>
    </li>
  );
}

// ====================================================================================
function BriefView({ state, onGenerate, stale, rt, ai }) {
  const b = state.brief;
  const bullet = (x, i) => (
    <li key={i} className="b-item">
      <span className="clamp">{x.badge && <Badge tone={x.badge === L.ai_proposed ? "ai" : x.badge.startsWith(L.owner_confirmed) ? "ok" : x.badge === L.possible_conflict || x.badge === L.confirmed_conflict ? "warn" : "muted"}>{x.badge}</Badge>} {x.text}{x.date ? <span className="hint"> · {x.date}</span> : null}</span>
      {x.rationale && <span className="rationale">Rationale: {x.rationale}</span>}
      <Refs state={state} refs={x.refs} />
    </li>
  );
  const c = b?.coverage;
  return (
    <section aria-labelledby="ob-h">
      <div className="view-head">
        <h2 id="ob-h">Owner Brief</h2>
        <button className="btn primary" id="gen-brief" disabled={ai.busy} onClick={onGenerate}>{b ? "Regenerate" : "Generate Owner Brief"}</button>
        {!rt.sample && <span className="hint">AI unavailable here: the brief compiles from your records, and Suggested priorities show None.</span>}
      </div>
      {!b ? (
        <p className="none">Generated only when you click. Nothing is generated in the background.</p>
      ) : (
        <article className="card brief">
          <p className="meta">Generated {M.fmtDateTime(b.generatedAt)} <Badge tone={stale ? "warn" : "ok"}>{stale ? L.needs_refresh : "Current"}</Badge></p>
          {stale && <div className="banner warn" id="brief-stale">{L.needs_refresh}: records changed since this brief was generated.</div>}
          <details className="coverage" open>
            <summary>Coverage Summary</summary>
            <ul>
              <li>Needs your decision / Blocked work: all {c.deterministic.decisionsOpen[1]} open decisions, all {c.deterministic.blockersOpen[1]} open blockers, all {c.deterministic.conflictsActive[1]} active conflicts (compiled from records, no AI).</li>
              <li>Information missing: compiled from all records, no AI.</li>
              {b.aiStatus === "ok" ? (
                <>
                  <li>AI input window: {c.window}.</li>
                  <li>Updates sent to AI: {c.ai.updates.included} of {c.ai.updates.total}{c.ai.updates.outsideWindow ? ` · ${c.ai.updates.outsideWindow} excluded (outside window)` : ""}{c.ai.updates.overCap ? ` · ${c.ai.updates.overCap} excluded (over the ${M.AI_LIMITS.maxUpdates}-update cap)` : ""}{c.ai.updates.archivedBrand ? ` · ${c.ai.updates.archivedBrand} excluded (archived brands)` : ""}{c.ai.updates.truncatedTexts ? ` · ${c.ai.updates.truncatedTexts} texts truncated to ${M.AI_LIMITS.maxRawChars.toLocaleString()} characters` : ""}.</li>
                  <li>Open decisions sent to AI: {c.ai.decisions.included} of {c.ai.decisions.total} · open blockers: {c.ai.blockers.included} of {c.ai.blockers.total} · active conflicts: {c.ai.conflicts.included} of {c.ai.conflicts.total} (archived brands excluded).</li>
                  {b.aiNotes.length > 0 && <li>Validation: {b.aiNotes.join(" ")}</li>}
                </>
              ) : (
                <li>Suggested priorities: AI {b.aiStatus === "unavailable" ? "unavailable in this view" : "not run"}; no records were sent to AI.</li>
              )}
            </ul>
          </details>
          <h3>NEEDS YOUR DECISION</h3>
          <Capped items={b.sections.needs} render={bullet} />
          <h3>BLOCKED WORK & ACTIVE CONFLICTS</h3>
          <Capped items={b.sections.blocked} render={bullet} />
          <h3>SUGGESTED PRIORITIES (AI-PROPOSED)</h3>
          <Capped items={b.priorities} render={bullet} />
          <h3>INFORMATION MISSING</h3>
          <Capped items={b.sections.missing} render={bullet} />
        </article>
      )}
    </section>
  );
}

// ====================================================================================
function DecisionsView({ state, commit, bname, onAssign, toast }) {
  const [f, setF] = useState({ brandId: "", question: "", refs: [] });
  const active = state.brands.filter((b) => !b.archived);
  const proposals = state.objectiveProposals;
  return (
    <section aria-labelledby="dq-h">
      <div className="view-head"><h2 id="dq-h">Decision Queue</h2></div>
      <div className="panel">
        <h3>New decision</h3>
        <div className="grid2">
          <label className="stack"><span className="lbl">Brand</span><BrandSelect id="dec-brand" brands={active} value={f.brandId} onChange={(v) => setF({ ...f, brandId: v, refs: [] })} /></label>
          <label className="stack"><span className="lbl">Question</span><input id="dec-q" value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} placeholder="What needs deciding?" /></label>
        </div>
        <RefPicker state={state} brandId={f.brandId} refs={f.refs} setRefs={(refs) => setF({ ...f, refs })} id="dec-refs" />
        <button className="btn primary" id="dec-add" disabled={!f.brandId || !f.question.trim()} onClick={() => {
          commit((s) => void s.decisions.push(M.newDecision(s, { brandId: f.brandId, question: f.question.trim(), sourceRefs: f.refs })));
          setF({ brandId: f.brandId, question: "", refs: [] });
        }}>Add to queue</button>
      </div>

      <h3>Proposed objective changes</h3>
      {proposals.filter((p) => p.status === "pending").length === 0 && <p className="none">{L.none}</p>}
      <div className="stack-l">
        {proposals.filter((p) => p.status === "pending").map((p) => <ProposalCard key={p.id} p={p} state={state} commit={commit} bname={bname} />)}
      </div>

      {M.DECISION_STATES.map((st) => {
        const list = state.decisions.filter((d) => d.status === st);
        return (
          <div key={st}>
            <h3>{st} <span className="hint">({list.length})</span></h3>
            {!list.length ? <p className="none">{L.none}</p> : <div className="stack-l">{list.map((d) => <DecisionCard key={d.id} d={d} state={state} commit={commit} bname={bname} onAssign={onAssign} toast={toast} />)}</div>}
          </div>
        );
      })}
    </section>
  );
}

function ProposalCard({ p, state, commit, bname }) {
  const [txt, setTxt] = useState(null);
  const brand = state.brands.find((b) => b.id === p.brandId);
  const approve = (text, note) => commit((s) => {
    const pp = s.objectiveProposals.find((x) => x.id === p.id);
    pp.status = "approved";
    pp.resolvedAt = M.nowIso();
    pp.approvedText = text;
    M.setObjective(s.brands.find((b) => b.id === p.brandId), text, note);
  });
  return (
    <article className="card">
      <p><Badge tone="ai">Proposed objective change</Badge> <b>{bname(p.brandId)}</b></p>
      <p>Current: {brand.currentObjective ? <>{brand.currentObjective} <Badge tone="ok">{L.owner_confirmed}</Badge></> : <span className="none">{L.no_objective}</span>}</p>
      <p>Proposed: “{p.proposedText}” {!p.excerptVerified && <span className="hint">(not found verbatim in the source note)</span>}</p>
      <Refs state={state} refs={p.sourceRefs} />
      {txt !== null ? (
        <div className="stack">
          <textarea rows={2} value={txt} onChange={(e) => setTxt(e.target.value)} aria-label="Edited objective" />
          <div className="row"><button className="btn small primary" disabled={!txt.trim()} onClick={() => approve(txt.trim(), `Edited and approved from proposal ${p.id}`)}>Approve edited objective</button><button className="btn small" onClick={() => setTxt(null)}>Cancel</button></div>
        </div>
      ) : (
        <div className="row">
          <button className="btn small primary" onClick={() => approve(p.proposedText, `Approved proposal ${p.id}`)}>Approve as objective</button>
          <button className="btn small" onClick={() => setTxt(p.proposedText)}>Edit & approve</button>
          <button className="btn small" onClick={() => commit((s) => { const pp = s.objectiveProposals.find((x) => x.id === p.id); pp.status = "dismissed"; pp.resolvedAt = M.nowIso(); })}>Dismiss</button>
        </div>
      )}
    </article>
  );
}

function DecisionCard({ d, state, commit, bname, onAssign }) {
  const [rec, setRec] = useState(null);
  const upd = (patch) => commit((s) => void M.setDecision(s.decisions.find((x) => x.id === d.id), patch));
  return (
    <article className="card decision" aria-label={`Decision ${d.id}`}>
      <header className="card-h">
        <h4>Decision #{d.id} · {bname(d.brandId)}</h4>
        <Badge tone={d.status === "Decided" ? "ok" : d.status === "Open" ? "warn" : "muted"}>{d.status}</Badge>
        <span className="hint">v{d.version}</span>
      </header>
      <p className="q">{d.question}</p>
      {d.status === "Decided" && <p><Badge tone="ok">{L.owner_decision}</Badge> {d.decisionText} <span className="hint">· {M.fmtDay(d.decidedAt)}</span></p>}
      {d.status !== "Decided" && d.decisionText && <p className="hint">Earlier choice: {d.decisionText}</p>}
      <Refs state={state} refs={d.sourceRefs} />
      {d.status === "Decided" && <p className="hint">Records your choice only. It does not mark the underlying claims as Owner-confirmed.</p>}
      {rec !== null ? (
        <div className="stack">
          <textarea rows={2} value={rec} onChange={(e) => setRec(e.target.value)} aria-label="Decision" placeholder="What did you decide?" />
          <div className="row"><button className="btn small primary" disabled={!rec.trim()} onClick={() => (upd({ status: "Decided", decisionText: rec.trim() }), setRec(null))}>Record Owner decision</button><button className="btn small" onClick={() => setRec(null)}>Cancel</button></div>
        </div>
      ) : (
        <div className="row">
          {d.status !== "Decided" && <button className="btn small primary" onClick={() => setRec(d.decisionText || "")}>Record decision</button>}
          {d.status === "Decided" && <button className="btn small" onClick={() => setRec(d.decisionText)}>Revise decision</button>}
          {d.status !== "Deferred" && d.status !== "Superseded" && <button className="btn small" onClick={() => upd({ status: "Deferred" })}>Defer</button>}
          {d.status !== "Superseded" && <button className="btn small" onClick={() => upd({ status: "Superseded" })}>Mark superseded</button>}
          {d.status !== "Open" && <button className="btn small" onClick={() => upd({ status: "Open" })}>Reopen</button>}
          <button className="btn small" onClick={() => {
            let aid;
            commit((s) => { const a = M.newAssignment(s, s.decisions.find((x) => x.id === d.id)); aid = a.id; s.assignments.push(a); }, { content: false });
            onAssign(aid);
          }}>Build assignment</button>
        </div>
      )}
    </article>
  );
}

// ====================================================================================
function TriageView({ state, commit, bname }) {
  const [brand, setBrand] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [nb, setNb] = useState({ brandId: "", summary: "", refs: [] });
  const [nc, setNc] = useState({ brandId: "", summary: "", aRefs: [], aEx: "", bRefs: [], bEx: "" });
  const active = state.brands.filter((b) => !b.archived);
  const inBrand = (x) => (brand ? x.brandId === brand : true);
  const blockers = state.blockers.filter(inBrand).filter((b) => showResolved || b.status === "open");
  const conflicts = state.conflicts.filter(inBrand).filter((c) => showResolved || M.isActiveConflict(c));
  const side = (refs, ex) => {
    const r = refs[0];
    const rec = M.findRecord(state, r.type, r.id);
    return { excerpt: ex, excerptVerified: false, eventDate: r.type === "update" ? M.updEventDate(rec) : null, capturedAt: r.type === "update" ? rec.capturedAt : rec.createdAt || M.nowIso(), sourceRef: r };
  };
  return (
    <section aria-labelledby="tr-h">
      <div className="view-head">
        <h2 id="tr-h">Blockers & Conflicts</h2>
        <BrandSelect id="tr-brand" brands={state.brands} value={brand} onChange={setBrand} includeAll />
        <label className="toggle"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved</label>
      </div>
      <div className="grid2 top-align">
        <div className="stack-l">
          <h3>Blockers</h3>
          <details className="panel">
            <summary>+ New blocker</summary>
            <BrandSelect brands={active} value={nb.brandId} onChange={(v) => setNb({ ...nb, brandId: v, refs: [] })} />
            <input value={nb.summary} placeholder="What is blocked?" onChange={(e) => setNb({ ...nb, summary: e.target.value })} aria-label="Blocker summary" />
            <RefPicker state={state} brandId={nb.brandId} refs={nb.refs} setRefs={(refs) => setNb({ ...nb, refs })} />
            <button className="btn small primary" disabled={!nb.brandId || !nb.summary.trim()} onClick={() => { commit((s) => void s.blockers.push(M.newBlocker(s, { brandId: nb.brandId, summary: nb.summary.trim(), origin: "owner_authored", sourceRefs: nb.refs }))); setNb({ ...nb, summary: "", refs: [] }); }}>Add blocker</button>
          </details>
          {!blockers.length && <p className="none">{L.none}</p>}
          {blockers.map((b) => <BlockerCard key={b.id} b={b} state={state} commit={commit} bname={bname} />)}
        </div>
        <div className="stack-l">
          <h3>Conflicts</h3>
          <details className="panel">
            <summary>+ New conflict</summary>
            <BrandSelect brands={active} value={nc.brandId} onChange={(v) => setNc({ ...nc, brandId: v, aRefs: [], bRefs: [] })} />
            <input value={nc.summary} placeholder="What disagrees?" onChange={(e) => setNc({ ...nc, summary: e.target.value })} aria-label="Conflict summary" />
            <span className="lbl">Side A record</span>
            <RefPicker state={state} brandId={nc.brandId} refs={nc.aRefs} setRefs={(r) => setNc({ ...nc, aRefs: r.slice(-1) })} />
            <input value={nc.aEx} placeholder="Side A excerpt" onChange={(e) => setNc({ ...nc, aEx: e.target.value })} aria-label="Side A excerpt" />
            <span className="lbl">Side B record</span>
            <RefPicker state={state} brandId={nc.brandId} refs={nc.bRefs} setRefs={(r) => setNc({ ...nc, bRefs: r.slice(-1) })} />
            <input value={nc.bEx} placeholder="Side B excerpt" onChange={(e) => setNc({ ...nc, bEx: e.target.value })} aria-label="Side B excerpt" />
            <button className="btn small primary" disabled={!nc.brandId || !nc.summary.trim() || !nc.aRefs.length || !nc.bRefs.length} onClick={() => {
              commit((s) => void s.conflicts.push(M.newConflict(s, { brandId: nc.brandId, summary: nc.summary.trim(), sideA: side(nc.aRefs, nc.aEx), sideB: side(nc.bRefs, nc.bEx) })));
              setNc({ ...nc, summary: "", aRefs: [], aEx: "", bRefs: [], bEx: "" });
            }}>Add as Possible conflict</button>
          </details>
          {!conflicts.length && <p className="none">{L.none}</p>}
          {conflicts.map((c) => <ConflictCard key={c.id} c={c} state={state} commit={commit} bname={bname} />)}
        </div>
      </div>
    </section>
  );
}

function BlockerCard({ b, state, commit, bname }) {
  const [dup, setDup] = useState("");
  const act = (action, opts) => commit((s) => void M.blockerAction(s.blockers.find((x) => x.id === b.id), action, opts));
  const others = state.blockers.filter((x) => x.brandId === b.brandId && x.id !== b.id);
  return (
    <article className={`card blocker ${b.status}`} aria-label={`Blocker ${b.id}`}>
      <header className="card-h">
        <h4>Blocker {b.id} · {bname(b.brandId)}</h4>
        <ClaimBadge it={b} />
        <Badge tone={b.status === "open" ? "warn" : "muted"}>{b.status === "open" ? "Open" : L.resolved}</Badge>
      </header>
      <p>{b.summary}</p>
      {b.duplicateOfBlockerId && <p className="hint">Duplicate of Blocker #{b.duplicateOfBlockerId}{b.duplicateNote ? ` — ${b.duplicateNote}` : ""}</p>}
      {b.suggestedDuplicateOf && !b.duplicateOfBlockerId && <p className="hint">AI suggestion: Possible duplicate of Blocker #{b.suggestedDuplicateOf} (not merged).</p>}
      {b.status === "resolved" && <p className="hint">Resolved {M.fmtDay(b.resolvedAt)}{b.resolutionNote ? ` — ${b.resolutionNote}` : ""}</p>}
      <Refs state={state} refs={b.sourceRefs} />
      <div className="row">
        {b.confirmation === "owner_confirmed" ? <button className="btn small" onClick={() => commit((s) => void M.setConfirmation(s.blockers.find((x) => x.id === b.id), "unconfirmed", "Unconfirmed by owner"))}>Unconfirm</button>
          : <button className="btn small" onClick={() => commit((s) => void M.setConfirmation(s.blockers.find((x) => x.id === b.id), "owner_confirmed", "Confirmed by owner"))}>Confirm</button>}
        {b.status === "open" ? <NoteAction label="Resolve" placeholder="Resolution note (optional)" onSubmit={(note) => act("resolve", { note })} /> : <button className="btn small" onClick={() => act("reopen")}>Reopen</button>}
        {b.duplicateOfBlockerId ? <button className="btn small" onClick={() => act("clear_duplicate")}>Clear duplicate link</button> : others.length > 0 && (
          <span className="inline-form">
            <select value={dup} onChange={(e) => setDup(e.target.value)} aria-label={`Mark ${b.id} duplicate of`}>
              <option value="">Mark duplicate of…</option>
              {others.map((o) => <option key={o.id} value={o.id}>{o.id}: {o.summary.slice(0, 40)}</option>)}
            </select>
            <button className="btn small" disabled={!dup} onClick={() => (act("duplicate", { duplicateOf: dup }), setDup(""))}>Link</button>
          </span>
        )}
      </div>
      <details className="hist"><summary>History ({b.history.length + b.confirmationHistory.length})</summary>
        <ul>{[...b.history.map((h) => ({ at: h.at, t: `${h.action}${h.duplicateOf ? ` → ${h.duplicateOf}` : ""}${h.note ? ` — ${h.note}` : ""}` })), ...b.confirmationHistory.map((h) => ({ at: h.at, t: `${h.status}${h.note ? ` — ${h.note}` : ""}` }))].sort((x, y) => (x.at < y.at ? -1 : 1)).map((h, i) => <li key={i}>{M.fmtDateTime(h.at)}: {h.t}</li>)}</ul>
      </details>
    </article>
  );
}

function ConflictCard({ c, state, commit, bname }) {
  const set = (status, note) => commit((s) => void M.setConflictStatus(s.conflicts.find((x) => x.id === c.id), status, note));
  const Side = ({ s, name }) => (
    <div className="side">
      <span className="lbl">{name}</span>
      <pre className="raw small">{s.excerpt || "(no excerpt)"}</pre>
      {s.excerptVerified === false && <span className="hint">Excerpt not verified verbatim against the record.</span>}
      <span className="meta"><DateLine eventDate={s.eventDate} capturedAt={s.capturedAt} /></span>
      <Refs state={state} refs={[s.sourceRef]} />
    </div>
  );
  return (
    <article className="card conflict" aria-label={`Conflict ${c.id}`}>
      <header className="card-h">
        <h4>Conflict {c.id} · {bname(c.brandId)}</h4>
        <Badge tone={M.isActiveConflict(c) ? "warn" : "muted"}>{L[c.status]}</Badge>
        {c.origin === "ai_proposed" && <Badge tone="ai">{L.ai_proposed}</Badge>}
      </header>
      <p>{c.summary}</p>
      <div className="sides"><Side s={c.sideA} name="Side A" /><Side s={c.sideB} name="Side B" /></div>
      {c.resolutionNote && <p className="hint">Note: {c.resolutionNote}</p>}
      <div className="row">
        {c.status !== "confirmed_conflict" && <button className="btn small" onClick={() => set("confirmed_conflict")}>Confirmed conflict</button>}
        {c.status !== "resolved" && <NoteAction label="Resolved" placeholder="How was it resolved? (optional)" onSubmit={(n) => set("resolved", n)} />}
        {c.status !== "not_a_conflict" && <NoteAction label="Not a conflict" onSubmit={(n) => set("not_a_conflict", n)} />}
        {c.status !== "possible_conflict" && <button className="btn small" onClick={() => set("possible_conflict")}>Back to Possible conflict</button>}
      </div>
      <details className="hist"><summary>History ({c.history.length})</summary>
        <ul>{c.history.map((h, i) => <li key={i}>{M.fmtDateTime(h.at)}: {L[h.status]}{h.note ? ` — ${h.note}` : ""}</li>)}</ul>
      </details>
    </article>
  );
}

// ====================================================================================
function WeeklyView({ state, bname }) {
  const [end, setEnd] = useState(M.todayPhx());
  const w = M.weekWindow(M.isDateOnly(end) ? end : M.todayPhx());
  const archived = new Set(state.brands.filter((b) => b.archived).map((b) => b.id));
  const ok = (x) => !archived.has(x.brandId);
  const ups = M.sortUpdates(state.updates.filter(ok).filter((u) => M.inWindow(M.effectiveSortDate(M.updSortKey(u)), w)));
  const decided = state.decisions.filter(ok).filter((d) => d.status === "Decided" && d.decidedAt && M.inWindow(M.phxDate(d.decidedAt), w));
  const blkNew = state.blockers.filter(ok).filter((b) => M.inWindow(M.phxDate(b.createdAt), w));
  const blkRes = state.blockers.filter(ok).filter((b) => b.status === "resolved" && b.resolvedAt && M.inWindow(M.phxDate(b.resolvedAt), w));
  const conf = state.conflicts.filter(ok).filter((c) => c.history.some((h) => M.inWindow(M.phxDate(h.at), w)));
  const olderBlk = state.blockers.filter(ok).filter((b) => b.status === "open" && M.phxDate(b.createdAt) < w.start);
  const olderDec = state.decisions.filter(ok).filter((d) => d.status === "Open" && M.phxDate(d.createdAt) < w.start);
  const List = ({ items, render }) => (items.length ? <ul className="bullets">{items.map(render)}</ul> : <p className="none">{L.none}</p>);
  return (
    <section aria-labelledby="wr-h">
      <div className="view-head">
        <h2 id="wr-h">Weekly Review</h2>
        <label className="row nowrap"><span className="lbl">Window ends</span><input id="wr-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <span className="hint">{M.fmtDateOnly(w.start)} – {M.fmtDateOnly(w.end)} · rolling 7 days, America/Phoenix</span>
      </div>
      <h3>Updates ({ups.length})</h3>
      <List items={ups} render={(u) => {
        const r = M.currentRev(u);
        const live = u.items.filter((i) => !i.removed);
        return (
          <li key={u.id} className="b-item">
            <span><b>{bname(u.brandId)}</b> · Update {u.id} · <span className="dateline">{r.eventDate ? `Event date: ${r.eventDate}` : L.no_event_date}<span className="sep">·</span>Captured on: {M.fmtDay(u.capturedAt)}</span> {u.extractionStatus === "raw_only" && <Badge>{L.raw_only}</Badge>}</span>
            {live.length ? <ul className="mini">{live.slice(0, 6).map((i) => <li key={i.id}><ClaimBadge it={i} /> {M.ITEM_KINDS[i.kind]}: {i.text}</li>)}</ul> : <span className="hint">{r.rawText.slice(0, 160)}{r.rawText.length > 160 ? "…" : ""}</span>}
          </li>
        );
      }} />
      <h3>Decisions recorded ({decided.length})</h3>
      <List items={decided} render={(d) => <li key={d.id}><b>{bname(d.brandId)}</b> · Decision #{d.id}: {d.decisionText} <Badge tone="ok">{L.owner_decision}</Badge> <span className="hint">{M.fmtDay(d.decidedAt)}</span></li>} />
      <h3>Blockers opened ({blkNew.length}) / resolved ({blkRes.length})</h3>
      <List items={[...blkNew.map((b) => ({ b, t: "Opened" })), ...blkRes.map((b) => ({ b, t: "Resolved" }))]} render={({ b, t }, i) => <li key={i}><b>{bname(b.brandId)}</b> · {t}: Blocker {b.id} — {b.summary} <ClaimBadge it={b} /></li>} />
      <h3>Conflict activity ({conf.length})</h3>
      <List items={conf} render={(c) => <li key={c.id}><b>{bname(c.brandId)}</b> · Conflict {c.id}: {c.summary} <Badge tone="warn">{L[c.status]}</Badge></li>} />
      <div className="neutral">
        <h3>Still open from before this window</h3>
        <p className="hint">Listed for visibility only. Time open is not a measure of urgency or progress.</p>
        <List items={[...olderBlk.map((b) => ({ k: `b${b.id}`, t: `Blocker ${b.id} · ${bname(b.brandId)}: ${b.summary}`, u: b.updatedAt })), ...olderDec.map((d) => ({ k: `d${d.id}`, t: `Decision #${d.id} (Open) · ${bname(d.brandId)}: ${d.question}`, u: d.updatedAt }))]} render={(x) => <li key={x.k}>{x.t} <span className="hint">Last updated: {M.fmtDay(x.u)}</span></li>} />
      </div>
    </section>
  );
}

// ====================================================================================
function AssignmentsView({ state, commit, copy, focus, setFocus, setModal, bname }) {
  const list = [...state.assignments].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const sel = list.find((a) => a.id === focus) || list[0];
  return (
    <section aria-labelledby="as-h">
      <div className="view-head"><h2 id="as-h">Assignments</h2><span className="hint">Build one from any decision in the Decision Queue.</span></div>
      {!list.length ? <p className="none">{L.none}</p> : (
        <div className="assign-layout">
          <ul className="assign-list">
            {list.map((a) => {
              const ch = M.assignmentChanges(state, a);
              return (
                <li key={a.id}>
                  <button className={`assign-btn ${sel?.id === a.id ? "on" : ""}`} onClick={() => setFocus(a.id)}>
                    <b>{a.id}</b> · {bname(a.brandId)} · Decision #{a.linkedDecisionId}
                    {ch.length > 0 && <Badge tone="warn">{L.needs_review}</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
          {sel && <AssignmentEditor key={sel.id} a={sel} state={state} commit={commit} copy={copy} setModal={setModal} />}
        </div>
      )}
    </section>
  );
}

function AssignmentEditor({ a, state, commit, copy, setModal }) {
  const changes = M.assignmentChanges(state, a);
  const taRef = useRef(null);
  const markCopied = () => commit((s) => void (s.assignments.find((x) => x.id === a.id).lastCopiedAt = M.nowIso()), { content: false });
  const rebuild = () => commit((s) => void M.rebuildAssignment(s, s.assignments.find((x) => x.id === a.id)), { content: false });
  return (
    <div className="card assign-ed">
      <header className="card-h">
        <h3>Assignment {a.id}</h3>
        {changes.length ? <Badge tone="warn">{L.needs_review}</Badge> : <Badge tone="ok">Current</Badge>}
        {a.userEdited && <Badge>Edited by you</Badge>}
      </header>
      {changes.length > 0 && (
        <div className="banner warn" id="assign-review">
          <b>{L.needs_review}.</b> Your text is kept as is. What changed:
          <ul>{changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}
      <textarea id="assign-text" ref={taRef} rows={22} value={a.text} onChange={(e) => {
        const v = e.target.value;
        commit((s) => { const x = s.assignments.find((y) => y.id === a.id); x.text = v; x.userEdited = true; x.updatedAt = M.nowIso(); }, { content: false });
      }} aria-label="Assignment text" />
      <p className="hint">Created {M.fmtDateTime(a.createdAt)} · Last copied: {a.lastCopiedAt ? M.fmtDateTime(a.lastCopiedAt) : "Never"} · Captures Decision v{a.linkedDecisionVersion}, objective v{a.linkedObjectiveVersion}, {plural(a.supportingRefs.length, "supporting record")}</p>
      <Refs state={state} refs={a.supportingRefs} />
      <div className="row">
        <button className="btn primary" id="copy-assign" onClick={() => copy(a.text, "Assignment copied. Paste it wherever you're sending it.", markCopied, "Copy Assignment")}>Copy Assignment</button>
        <button className="btn" onClick={() => taRef.current && (taRef.current.focus(), taRef.current.select())}>Select all</button>
        <button className="btn" id="rebuild" onClick={() => (a.userEdited ? setModal({ type: "confirm", title: "Rebuild from latest context?", body: "This replaces your edited text with a fresh draft from current records. Copy your text first if you need it.", confirm: "Rebuild Draft", onConfirm: rebuild }) : rebuild())}>Rebuild Draft from Latest Context</button>
        <button className="btn link danger" onClick={() => setModal({ type: "confirm", title: `Delete assignment ${a.id}?`, body: "This removes the handoff text. Decisions and records are untouched.", confirm: "Delete", onConfirm: () => commit((s) => void (s.assignments = s.assignments.filter((x) => x.id !== a.id)), { content: false }) })}>Delete</button>
      </div>
    </div>
  );
}

// ====================================================================================
function BackupView({ state, onExport, copy, setModal, toast, replaceState, rt, queue }) {
  const [paste, setPaste] = useState("");
  const [err, setErr] = useState(null);
  const check = (text) => {
    const r = M.validateImport(text);
    if (!r.ok) return setErr(r.error);
    setErr(null);
    const s = r.summary;
    setModal({
      type: "confirm",
      title: "Restore this backup?",
      body: `It contains ${plural(s.brands, "brand")}, ${plural(s.updates, "update")}, ${plural(s.blockers, "blocker")}, ${plural(s.conflicts, "conflict")}, ${plural(s.decisions, "decision")} and ${plural(s.assignments, "assignment")}${s.missingRefs ? `, with ${plural(s.missingRefs, "reference")} to missing records (shown as Missing, not fabricated)` : ""}. It replaces everything currently in the app. Export your current state first if you might need it.`,
      confirm: "Replace current state",
      onConfirm: () => {
        replaceState(r.state);
        setPaste("");
        toast("Backup restored.", "ok");
      },
    });
  };
  return (
    <section aria-labelledby="bk-h" className="stack-l">
      <div className="view-head"><h2 id="bk-h">Backup & Help</h2></div>
      <div className="panel">
        <h3>Export</h3>
        <p className="hint">Complete state as formatted JSON (schemaVersion 1).</p>
        <div className="row">
          <button className="btn primary" id="export-json" onClick={onExport}>Export JSON</button>
          <button className="btn" onClick={() => copy(M.exportJson(state), "JSON copied to clipboard.", null, "Copy JSON")}>Copy JSON</button>
        </div>
      </div>
      <div className="panel">
        <h3>Restore</h3>
        <p className="hint">Invalid files and newer schema versions are rejected without changing anything.</p>
        <label className="btn file-btn">Choose JSON file…
          <input type="file" accept=".json,application/json" onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const fr = new FileReader();
            fr.onload = () => check(String(fr.result));
            fr.onerror = () => setErr("Couldn't read that file. Paste the JSON instead.");
            fr.readAsText(f);
          }} />
        </label>
        <textarea id="import-text" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="…or paste backup JSON here" aria-label="Backup JSON" />
        <button className="btn" id="import-check" disabled={!paste.trim()} onClick={() => check(paste)}>Check and restore</button>
        {err && <div className="banner block" role="alert" id="import-error">{err}</div>}
      </div>
      <div className="panel help">
        <h3>How this artifact keeps you safe, and what it can't promise</h3>
        <ul>
          <li><b>Storage:</b> {rt.phase === "personal" ? "Personal storage, private to you (never Shared storage)." : `Session only. ${rt.reason || ""} Export JSON to keep your work.`}</li>
          <li><b>AI:</b> {rt.sample ? "Available. It runs only when you click Extract Fields (AI) or Generate Owner Brief, and uses your Claude plan. Your pasted text is sent to Anthropic's Claude service for that request." : "Unavailable in this view. Every other feature works manually."}</li>
          <li><b>Stop waiting:</b> stops the app from waiting and ignores any late answer. The request may still complete in the background and consume usage.</li>
          <li><b>Safeguards:</b> no connectors, external API calls, browsing, sending, publishing, or background tasks; all pasted and AI text is shown as escaped plain text, never as HTML; AI output must pass strict JSON and reference checks; nothing AI-proposed is saved until you click, and nothing is marked Owner-confirmed unless you confirm it.</li>
          <li><b>Limits:</b> prompting cannot guarantee safety or truth. A pasted note can still try to steer the AI, and AI extraction or priorities can be wrong or incomplete. Review before you rely on anything labeled Source-reported or AI-proposed.</li>
          <li><b>Times:</b> stored as UTC, shown in America/Phoenix. Event dates are plain calendar dates and never converted.</li>
        </ul>
        <p className="hint">contentRevision {state.contentRevision} · storageSeq {state.storageSeq}{queue?.savedAt ? ` · last write ${M.fmtDateTime(queue.savedAt.toISOString())}` : ""}</p>
      </div>
    </section>
  );
}

// ====================================================================================
function Modal({ modal, close }) {
  const ref = useRef(null);
  useEffect(() => {
    const k = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [close]);
  useEffect(() => {
    if (modal.type === "manual" && ref.current) (ref.current.focus(), ref.current.select());
  }, [modal]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true">
        <h2>{modal.title}</h2>
        {modal.type === "confirm" ? (
          <>
            <p>{modal.body}</p>
            <div className="row end"><button className="btn" onClick={close} autoFocus>Cancel</button><button className="btn primary" id="modal-confirm" onClick={() => (modal.onConfirm(), close())}>{modal.confirm}</button></div>
          </>
        ) : (
          <>
            <p className="hint">{modal.note}</p>
            <textarea ref={ref} className="mono" rows={14} readOnly value={modal.text} onFocus={(e) => e.target.select()} aria-label="Text to copy" />
            <div className="row end">
              <button className="btn" onClick={() => ref.current && (ref.current.focus(), ref.current.select())}>Select all</button>
              {modal.onCopied && <button className="btn" onClick={() => (modal.onCopied(), close())}>I copied it</button>}
              <button className="btn primary" onClick={close}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
