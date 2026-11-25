import React, { useEffect, useMemo, useRef, useState } from "react";
import * as R from "./lib.js";
import { connectRuntime } from "./store.js";

const COPY = {
  aiFail: "This review didn't complete. Your earlier results are unchanged.",
  aiParse: "The review result couldn't be read. Your earlier results are unchanged.",
  late: "An earlier review finished late and was ignored.",
  stop: "Stopped waiting — the underlying request may still finish in the background.",
  stale: "A source changed after this analysis. Review or run it again.",
  sessionBanner: "Session-only mode — export a JSON backup before closing.",
  failBanner: "Save failed. Download a JSON backup so this work isn't lost.",
  importFail: "This backup couldn't be imported. Your current workspace was not changed.",
  importPreview: "Review this backup before replacing or merging your workspace.",
  tickerHelp: "Ticker is optional and does not uniquely identify a company or exchange",
  noReview: "No review yet. Nothing will run until you ask.",
  unreadHelp: "This is a link only. It hasn't been read as evidence.",
};
const clone = (x) => JSON.parse(JSON.stringify(x));

export default function App() {
  const [ws, setWsState] = useState(null);
  const wsRef = useRef(null);
  const [rt, setRt] = useState({ phase: "connecting" });
  const storeRef = useRef(null);
  const qRef = useRef(null);
  const [, bump] = useState(0);
  const [drawer, setDrawer] = useState(true);
  const [panel, setPanel] = useState(true);
  const [tab, setTab] = useState("thesis");
  const [modal, setModal] = useState(null);
  const [exportOpen, setExportOpen] = useState(null); // 'packet' | 'backup'
  const [toasts, setToasts] = useState([]);
  const [previews, setPreviews] = useState({}); // companyId -> {md, hash}: survives closing the modal
  const aiRef = useRef({ seq: 0, active: null });
  const aiVersion = useRef({});
  const [ai, setAi] = useState({ busy: false, kind: null, entryId: null, note: null, error: null, raw: null, retry: null });

  const toast = (msg) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-2), { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  };
  const setWs = (next) => {
    wsRef.current = next;
    setWsState(next);
  };

  useEffect(() => {
    (async () => {
      const r = await connectRuntime();
      let next = R.emptyWorkspace();
      let phase = "session", reason = r.reason;
      if (r.store) {
        try {
          const { companies, meta, problems } = await r.store.load();
          const v = R.validateImport(JSON.stringify({ schemaVersion: R.SCHEMA_VERSION, activeCompanyId: meta?.activeCompanyId ?? null, companies }));
          if (v.ok) next = v.workspace;
          problems.forEach((p) => setTimeout(() => toast(p), 0));
          storeRef.current = r.store;
          phase = "personal";
          qRef.current = new R.SaveQueue(
            async (key, value) => {
              if (key === "__meta") return r.store.saveMeta(value);
              if (value === "__deleted") return r.store.deleteCompany(key);
              return r.store.saveCompany(value);
            },
            () => bump((n) => n + 1),
          );
        } catch (e) {
          reason = `Personal storage couldn't be read (${e.message || e.code}).`;
        }
      }
      setWs(next);
      setRt({ phase, reason, sample: r.sample, downloads: r.downloads });
    })();
  }, []);

  // ---------- mutations ----------
  const persist = (key, value) => (qRef.current ? qRef.current.schedule(key, value) : bump((n) => n + 1));
  const invalidateAi = (companyId) => {
    const a = aiRef.current.active;
    if (a && (!companyId || a.companyId === companyId)) {
      aiRef.current.active = null;
      a.ctl.abort();
      setAi({ busy: false, kind: null, entryId: null, note: null, error: null });
    }
  };
  /** aiRelevant: thesis or research-entry change (invalidates in-flight AI for this company). */
  const mutate = (companyId, fn, { aiRelevant = false } = {}) => {
    const cur = wsRef.current.companies.find((c) => c.id === companyId);
    const c = clone(cur);
    if (fn(c) === false) return null;
    c.updatedAt = R.nowIso();
    R.refreshAnalysisStatus(c);
    if (aiRelevant) {
      aiVersion.current[companyId] = (aiVersion.current[companyId] || 0) + 1;
      invalidateAi(companyId);
    }
    setWs({ ...wsRef.current, companies: wsRef.current.companies.map((x) => (x.id === companyId ? c : x)) });
    persist(companyId, c);
    return c;
  };
  const setActive = (id) => {
    if (id === wsRef.current.activeCompanyId) return;
    invalidateAi();
    const next = { ...wsRef.current, activeCompanyId: id };
    setWs(next);
    persist("__meta", { activeCompanyId: id });
  };

  // ---------- AI ----------
  const runAi = async (kind, entryId = null) => {
    if (aiRef.current.active) return;
    const c = wsRef.current.companies.find((x) => x.id === wsRef.current.activeCompanyId);
    if (!c || !rt.sample) return;
    const entry = entryId ? c.researchEntries.find((e) => e.id === entryId) : null;
    const ctl = new AbortController();
    const req = { token: ++aiRef.current.seq, companyId: c.id, stateVersion: aiVersion.current[c.id] || 0, ctl };
    aiRef.current.active = req;
    setAi({ busy: true, kind, entryId, note: null, error: null });
    const current = () => aiRef.current.active?.token === req.token && wsRef.current.activeCompanyId === req.companyId && (aiVersion.current[req.companyId] || 0) === req.stateVersion;
    try {
      const prompt = kind === "extract_notes" ? R.extractPrompt(c, entry) : R.comparePrompt(c);
      const raw = await rt.sample.json(prompt, { signal: ctl.signal, cache: false });
      if (!current()) return setAi((s) => (s.busy ? s : { ...s, note: COPY.late }));
      aiRef.current.active = null;
      const fresh = wsRef.current.companies.find((x) => x.id === req.companyId);
      let v;
      try {
        v = kind === "extract_notes" ? R.validateExtract(raw, fresh, fresh.researchEntries.find((e) => e.id === entryId)) : R.validateCompare(raw, fresh);
      } catch {
        return setAi({ busy: false, kind, entryId, error: COPY.aiParse, raw: safeJson(raw), retry: () => runAi(kind, entryId) });
      }
      const coverage = kind === "compare_research" ? R.comparePayload(fresh).coverage : null;
      mutate(req.companyId, (cc) => R.putAnalysis(cc, R.newAnalysis(cc, kind, v.result, { requestToken: String(req.token), targetEntryId: entryId, notes: v.notes, coverage })));
      setAi({ busy: false, kind: null, entryId: null, note: null, error: null });
    } catch (e) {
      if (aiRef.current.active?.token !== req.token) return; // stopped, superseded or switched: silent
      aiRef.current.active = null;
      const parse = e?.code === "invalid_json";
      setAi({ busy: false, kind, entryId, error: parse ? COPY.aiParse : COPY.aiFail, raw: parse ? e?.text || null : null, retry: () => runAi(kind, entryId) });
    }
  };
  const stopWaiting = () => {
    const a = aiRef.current.active;
    if (!a) return;
    aiRef.current.active = null;
    a.ctl.abort();
    setAi({ busy: false, kind: null, entryId: null, note: COPY.stop, error: null });
  };

  // ---------- clipboard / download ----------
  const copyText = async (text, label = "Copy") => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      toast("Copied");
      return true;
    } catch {
      setModal({ type: "manual", title: label, text, note: "Copy failed. Select the text below and press Cmd+C or Ctrl+C." });
      return false;
    }
  };
  const download = async (filename, text) => {
    if (rt.downloads) {
      try {
        await rt.downloads.save({ filename, data: text });
        return toast("Download requested");
      } catch (e) {
        if (e?.code === "declined") return toast("Download cancelled");
      }
    }
    setModal({ type: "manual", title: filename, text, note: `Downloads aren't available here. Select all, copy, and save it as ${filename}.` });
  };

  if (!ws) return <div className="boot">WOI Research Desk</div>;

  // ---------- status ----------
  const sum = qRef.current ? qRef.current.summary() : null;
  const status = rt.phase !== "personal" ? "Session-only" : sum.state === "failed" ? "Save failed" : sum.state === "saving" ? "Saving…" : sum.state === "saved" ? `Saved to Personal Storage · ${R.fmtTime(sum.at)}` : "Not saved yet";
  const active = ws.companies.find((c) => c.id === ws.activeCompanyId) || null;
  const ctx = { ws, active, mutate, setModal, toast, copyText, download, rt };

  return (
    <div className="app">
      <header className="top">
        <button className="btn ghost" aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>Company drawer</button>
        <h1>WOI Research Desk</h1>
        <span className="grow" />
        <span className={`status ${sum?.state === "failed" ? "alert" : ""}`} aria-live="polite" id="save-status">{status}</span>
        <button className="btn ghost" aria-expanded={panel} onClick={() => setPanel(!panel)}>Research</button>
        <button className="btn" id="open-export" disabled={!ws.companies.length && rt.phase === "personal"} onClick={() => setExportOpen(active ? "packet" : "backup")}>Export</button>
      </header>
      {rt.phase !== "personal" && <div className="banner" role="status" id="session-banner">{COPY.sessionBanner} <button className="btn link" onClick={() => setExportOpen("backup")}>Workspace Backup</button></div>}
      {sum?.state === "failed" && (
        <div className="banner alert" role="alert" id="fail-banner">
          {COPY.failBanner} <button className="btn link" onClick={() => setExportOpen("backup")}>Workspace Backup</button> <button className="btn link" onClick={() => qRef.current.retry()}>Retry saving</button>
        </div>
      )}

      <div className={`zones ${drawer ? "with-drawer" : ""} ${panel && active ? "with-panel" : ""}`}>
        {drawer && <CompanyDrawer {...ctx} setActive={setActive} createCompany={(f) => {
          const c = R.newCompany(f);
          setWs({ ...wsRef.current, companies: [...wsRef.current.companies, c], activeCompanyId: c.id });
          persist(c.id, c);
          persist("__meta", { activeCompanyId: c.id });
          setTab("thesis");
        }} />}

        <main className="center">
          {!active ? (
            <div className="empty" id="empty-state">
              <h2>No companies yet</h2>
              <p>Use <b>New Company</b> in the Company drawer to start a research journal. Nothing is filled in for you.</p>
            </div>
          ) : (
            <>
              <CompanyHeader {...ctx} deleteCompany={() => setModal({
                type: "confirm",
                title: `Delete ${active.name}?`,
                body: "This removes the company, its research, thesis, catalysts, and revisions from this workspace. Download a JSON backup first if you might need it.",
                confirm: "Delete company",
                onConfirm: () => {
                  invalidateAi(active.id);
                  const rest = wsRef.current.companies.filter((c) => c.id !== active.id);
                  setWs({ ...wsRef.current, companies: rest, activeCompanyId: rest[0]?.id || null });
                  persist(active.id, "__deleted");
                  persist("__meta", { activeCompanyId: rest[0]?.id || null });
                },
              })} />
              <nav className="tabs" role="tablist">
                {[["thesis", "Thesis"], ["catalysts", "Catalysts"], ["revisions", "Revisions"]].map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
                ))}
              </nav>
              {tab === "thesis" && <ThesisTab {...ctx} />}
              {tab === "catalysts" && <CatalystsTab {...ctx} />}
              {tab === "revisions" && <RevisionsTab {...ctx} />}
            </>
          )}
        </main>

        {panel && active && <ResearchPanel {...ctx} ai={ai} setAi={setAi} runAi={runAi} stopWaiting={stopWaiting} />}
      </div>

      {exportOpen && <ExportModal {...ctx} preview={active ? previews[active.id] : null} setPreview={(p) => active && setPreviews((m) => ({ ...m, [active.id]: p }))} tab={exportOpen} setTab={setExportOpen} close={() => setExportOpen(null)} replaceWorkspace={(w, mode) => {
        invalidateAi();
        let next;
        if (mode === "replace") {
          for (const c of wsRef.current.companies) if (!w.companies.some((x) => x.id === c.id)) persist(c.id, "__deleted");
          next = w;
        } else {
          const have = new Set(wsRef.current.companies.map((c) => c.id));
          next = { ...wsRef.current, companies: [...wsRef.current.companies, ...w.companies.filter((c) => !have.has(c.id))] };
          next.activeCompanyId = next.activeCompanyId || next.companies[0]?.id || null;
        }
        setWs(next);
        for (const c of next.companies) persist(c.id, c);
        persist("__meta", { activeCompanyId: next.activeCompanyId });
      }} />}
      {modal && <Modal modal={modal} close={() => setModal(null)} />}
      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className="toast">{t.msg}</div>)}</div>
    </div>
  );
}
const safeJson = (v) => {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

// ====================================================================================
function CompanyDrawer({ ws, setActive, createCompany }) {
  const [form, setForm] = useState(null);
  const blank = { name: "", ticker: "", exchangeNote: "", businessDescription: "", questions: "", watchlistStatus: "active_research" };
  const order = ["active_research", "monitoring", "parked", "archived"];
  const list = [...ws.companies].sort((a, b) => order.indexOf(a.watchlistStatus) - order.indexOf(b.watchlistStatus) || a.name.localeCompare(b.name));
  return (
    <aside className="drawer" aria-label="Company drawer">
      <h2 className="zone-h">Company drawer</h2>
      {form ? (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          if (!form.name.trim()) return;
          createCompany({ ...form, researchQuestions: form.questions.split("\n") });
          setForm(null);
        }}>
          <label className="field"><span>Company name</span><input id="co-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>Ticker (optional)</span><input id="co-ticker" value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value })} /></label>
          <p className="help" id="ticker-help">{COPY.tickerHelp}</p>
          <label className="field"><span>Exchange note (optional)</span><input value={form.exchangeNote} onChange={(e) => setForm({ ...form, exchangeNote: e.target.value })} /></label>
          <label className="field"><span>Business description (optional)</span><textarea rows={3} value={form.businessDescription} onChange={(e) => setForm({ ...form, businessDescription: e.target.value })} /></label>
          <label className="field"><span>Initial questions (optional, one per line)</span><textarea rows={3} value={form.questions} onChange={(e) => setForm({ ...form, questions: e.target.value })} /></label>
          <label className="field"><span>Watchlist status</span>
            <select value={form.watchlistStatus} onChange={(e) => setForm({ ...form, watchlistStatus: e.target.value })}>{Object.entries(R.WATCH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <div className="row"><button className="btn primary" id="co-create" disabled={!form.name.trim()}>Create</button><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      ) : (
        <button className="btn primary block" id="new-company" onClick={() => setForm(blank)}>New Company</button>
      )}
      <ul className="co-list">
        {list.map((c) => (
          <li key={c.id}>
            <button className={`co ${c.id === ws.activeCompanyId ? "on" : ""}`} onClick={() => setActive(c.id)}>
              <span className="co-name">{c.name}</span>
              <span className="meta">{c.ticker ? `${c.ticker} · ` : ""}{R.WATCH[c.watchlistStatus]}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function CompanyHeader({ active: c, mutate, deleteCompany }) {
  const [edit, setEdit] = useState(null);
  return (
    <section className="co-head">
      {edit ? (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          if (!edit.name.trim()) return;
          mutate(c.id, (x) => Object.assign(x, { name: edit.name.trim(), ticker: edit.ticker.trim() || null, exchangeNote: edit.exchangeNote.trim() || null, businessDescription: edit.businessDescription.trim(), researchQuestions: edit.questions.split("\n").map((q) => q.trim()).filter(Boolean) }));
          setEdit(null);
        }}>
          <label className="field"><span>Company name</span><input required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label className="field"><span>Ticker (optional)</span><input value={edit.ticker} onChange={(e) => setEdit({ ...edit, ticker: e.target.value })} /></label>
          <p className="help">{COPY.tickerHelp}</p>
          <label className="field"><span>Exchange note (optional)</span><input value={edit.exchangeNote} onChange={(e) => setEdit({ ...edit, exchangeNote: e.target.value })} /></label>
          <label className="field"><span>Business description</span><textarea rows={3} value={edit.businessDescription} onChange={(e) => setEdit({ ...edit, businessDescription: e.target.value })} /></label>
          <label className="field"><span>Initial questions (one per line)</span><textarea rows={3} value={edit.questions} onChange={(e) => setEdit({ ...edit, questions: e.target.value })} /></label>
          <div className="row"><button className="btn primary">Save details</button><button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button><span className="grow" /><button type="button" className="btn link danger" onClick={deleteCompany}>Delete company</button></div>
        </form>
      ) : (
        <>
          <div className="row">
            <h2 className="co-title">{c.name}</h2>
            {c.ticker && <span className="label">Ticker: {c.ticker}</span>}
            {c.exchangeNote && <span className="label">{c.exchangeNote}</span>}
            <span className="grow" />
            <label className="inline">Watchlist status{" "}
              <select id="watch" value={c.watchlistStatus} onChange={(e) => mutate(c.id, (x) => void (x.watchlistStatus = e.target.value))}>{Object.entries(R.WATCH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <button className="btn small" onClick={() => setEdit({ name: c.name, ticker: c.ticker || "", exchangeNote: c.exchangeNote || "", businessDescription: c.businessDescription, questions: c.researchQuestions.join("\n") })}>Edit details</button>
          </div>
          {c.businessDescription && <p className="desc">{c.businessDescription}</p>}
          {c.researchQuestions.length > 0 && <ul className="questions">{c.researchQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>}
        </>
      )}
    </section>
  );
}

// ====================================================================================
function SourcePicker({ c, ids, onChange }) {
  const readable = c.researchEntries;
  return (
    <span className="sources">
      {ids.map((id) => (
        <span key={id} className="chip">{c.researchEntries.find((e) => e.id === id)?.shortRef || "Deleted source"}
          <button aria-label="Unlink source" onClick={() => onChange(ids.filter((x) => x !== id))}>×</button>
        </span>
      ))}
      {readable.filter((e) => !ids.includes(e.id)).length > 0 && (
        <select aria-label="Link a research entry" value="" onChange={(e) => e.target.value && onChange([...ids, e.target.value])}>
          <option value="">Link source…</option>
          {readable.filter((e) => !ids.includes(e.id)).map((e) => <option key={e.id} value={e.id}>{e.shortRef} · {e.title || e.rawText.slice(0, 40) || e.url}</option>)}
        </select>
      )}
    </span>
  );
}

function ThesisTab({ active: c, mutate, setModal }) {
  const editItem = (key, id, patch) => mutate(c.id, (x) => Object.assign(x.workingThesis[key].find((i) => i.id === id), patch), { aiRelevant: true });
  const cmp = R.latestCompare(c);
  return (
    <section className="writing" aria-label="Thesis">
      <div className="row tab-actions">
        <p className="meta">Working thesis · {c.revisions.length ? `latest revision v${Math.max(...c.revisions.map((r) => r.version))}` : "no revisions saved yet"}</p>
        <span className="grow" />
        <button className="btn primary" id="save-revision" onClick={() => setModal({ type: "revision", c, onSave: (f) => mutate(c.id, (x) => void x.revisions.push(R.newRevision(x, f))) })}>Save Revision</button>
      </div>
      {R.SECTIONS.map((s) => {
        const flagged = cmp?.result.sectionsNeedingReview.filter((x) => x.sectionKey === s.key) || [];
        return (
          <div className="t-section" key={s.key} id={`sec-${s.key}`}>
            <h3>{s.title}</h3>
            <p className="help">{s.help}</p>
            {flagged.length > 0 && <p className="flag">Sections Needing Review [AI-proposed]: {flagged.map((f) => f.reason).join(" · ")}</p>}
            <ul className="items">
              {c.workingThesis[s.key].map((it) => (
                <li key={it.id} className="item">
                  <textarea aria-label={`${s.title} statement`} rows={2} value={it.text} onChange={(e) => editItem(s.key, it.id, { text: e.target.value })} />
                  <div className="row item-meta">
                    <select aria-label="Provenance" value={it.provenance} onChange={(e) => editItem(s.key, it.id, { provenance: e.target.value })}>
                      {Object.entries(R.PROVENANCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <SourcePicker c={c} ids={it.sourceEntryIds} onChange={(ids) => editItem(s.key, it.id, { sourceEntryIds: ids })} />
                    <span className="meta">Not independently verified</span>
                    <span className="grow" />
                    <button className="btn link danger small" onClick={() => mutate(c.id, (x) => void (x.workingThesis[s.key] = x.workingThesis[s.key].filter((i) => i.id !== it.id)), { aiRelevant: true })}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
            <button className="btn small" onClick={() => mutate(c.id, (x) => void x.workingThesis[s.key].push(R.newItem()), { aiRelevant: true })}>Add statement</button>
          </div>
        );
      })}
    </section>
  );
}

function CatalystsTab({ active: c, mutate, toast }) {
  const [f, setF] = useState({ event: "", suppliedDate: "", dateStatus: "unknown", sourceEntryId: "", outcomeNote: "" });
  const today = R.phoenixDate();
  return (
    <section className="writing" aria-label="Catalysts">
      <form className="panel stack" onSubmit={(e) => {
        e.preventDefault();
        if (!f.event.trim()) return;
        const k = R.newCatalyst(f);
        if (f.suppliedDate.trim() && !k.suppliedDate) toast("That date isn't a real calendar date, so it was saved as Unknown.");
        mutate(c.id, (x) => void x.catalysts.push(k));
        setF({ event: "", suppliedDate: "", dateStatus: "unknown", sourceEntryId: "", outcomeNote: "" });
      }}>
        <h3>Log a catalyst</h3>
        <label className="field"><span>Event</span><input id="cat-event" value={f.event} onChange={(e) => setF({ ...f, event: e.target.value })} /></label>
        <div className="grid2">
          <label className="field"><span>Date (YYYY-MM-DD, optional)</span><input id="cat-date" value={f.suppliedDate} onChange={(e) => setF({ ...f, suppliedDate: e.target.value })} /></label>
          <label className="field"><span>Date status</span><select id="cat-status" value={f.dateStatus} onChange={(e) => setF({ ...f, dateStatus: e.target.value })}>{Object.entries(R.DATE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <label className="field"><span>Source (optional)</span>
          <select value={f.sourceEntryId} onChange={(e) => setF({ ...f, sourceEntryId: e.target.value })}><option value="">None</option>{c.researchEntries.map((e) => <option key={e.id} value={e.id}>{R.sourceLabel(c, e.id)}</option>)}</select>
        </label>
        <button className="btn primary" id="cat-add" disabled={!f.event.trim()}>Add catalyst</button>
      </form>
      {!c.catalysts.length ? <p className="meta">None</p> : (
        <ul className="cats">
          {c.catalysts.map((k) => (
            <li key={k.id} className="cat">
              <div className="row"><b>{k.event}</b><span className="grow" />{R.isElapsed(k, today) && <span className="chip alert">{R.ELAPSED}</span>}</div>
              <p className="meta">Date: {k.suppliedDate || "Unknown"} · {R.DATE_STATUS[k.dateStatus]} · Source: {k.sourceEntryId ? R.sourceLabel(c, k.sourceEntryId) : "None"}</p>
              <div className="row">
                <label className="inline"><input type="checkbox" checked={k.outcomeRecorded} onChange={(e) => mutate(c.id, (x) => void (x.catalysts.find((y) => y.id === k.id).outcomeRecorded = e.target.checked))} /> Outcome recorded</label>
                <input className="grow" aria-label="Outcome note" placeholder="Outcome note (optional)" value={k.outcomeNote || ""} onChange={(e) => mutate(c.id, (x) => void (x.catalysts.find((y) => y.id === k.id).outcomeNote = e.target.value || null))} />
                <button className="btn link danger small" onClick={() => mutate(c.id, (x) => void (x.catalysts = x.catalysts.filter((y) => y.id !== k.id)))}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RevisionsTab({ active: c }) {
  const revs = [...c.revisions].sort((a, b) => b.version - a.version);
  const [from, setFrom] = useState(revs[0] ? String(revs[0].version) : "");
  const [to, setTo] = useState("working");
  const [view, setView] = useState(null);
  const snap = (v) => (v === "working" ? c.workingThesis : c.revisions.find((r) => String(r.version) === v)?.snapshot);
  const diff = from && snap(from) && snap(to) ? R.diffThesis(snap(from), snap(to)) : null;
  const opts = [...revs.map((r) => [String(r.version), `v${r.version}`]), ["working", "Working thesis"]];
  return (
    <section className="writing" aria-label="Revisions">
      {!revs.length ? <p className="meta">No revisions saved yet. Use Save Revision on the Thesis tab to keep a snapshot.</p> : (
        <>
          <div className="panel stack" id="diff">
            <div className="row"><b>Compare</b>
              <select aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <span>to</span>
              <select aria-label="To" value={to} onChange={(e) => setTo(e.target.value)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </div>
            {diff && diff.every((d) => !d.added.length && !d.removed.length && !d.provenanceChanged.length) && <p className="meta">No differences.</p>}
            {diff?.filter((d) => d.added.length || d.removed.length || d.provenanceChanged.length).map((d) => (
              <div key={d.key} className="diff-sec">
                <h4>{d.title}</h4>
                {d.added.map((i) => <p key={`a${i.id}`} className="add">Added: [{R.PROVENANCE[i.provenance]}] {i.text}</p>)}
                {d.removed.map((i) => <p key={`r${i.id}`} className="rem">Removed: [{R.PROVENANCE[i.provenance]}] {i.text}</p>)}
                {d.provenanceChanged.map((p, j) => <p key={`p${j}`} className="prov">Label changed: {R.PROVENANCE[p.from]} → {R.PROVENANCE[p.to]} · {p.text}</p>)}
              </div>
            ))}
          </div>
          <ol className="revs">
            {revs.map((r) => (
              <li key={r.id} className="rev" id={`rev-${r.version}`}>
                <div className="row"><b>v{r.version}</b><span className="meta">{R.fmtLocal(r.createdAt)}</span><span className="grow" /><button className="btn small" onClick={() => setView(view === r.id ? null : r.id)}>{view === r.id ? "Hide snapshot" : "View snapshot"}</button></div>
                <p><span className="meta">What changed:</span> {r.changeSummary}</p>
                <p><span className="meta">Why:</span> {r.changeRationale}</p>
                {r.supportingResearchIds.length > 0 && <p className="meta">Supporting research: {r.supportingResearchIds.map((id) => R.sourceLabel(c, id)).join("; ")}</p>}
                {view === r.id && (
                  <div className="snapshot" aria-label={`Snapshot v${r.version}`}>
                    {R.SECTIONS.map((s) => (
                      <div key={s.key}><h4>{s.title}</h4>{r.snapshot[s.key].length ? <ul>{r.snapshot[s.key].map((i) => <li key={i.id}>[{R.PROVENANCE[i.provenance]}] {i.text}</li>)}</ul> : <p className="meta">None</p>}</div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

// ====================================================================================
function ResearchPanel({ active: c, mutate, rt, ai, setAi, runAi, stopWaiting, toast, setModal }) {
  const blank = { rawText: "", title: "", publisher: "", url: "", publishedDate: "" };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState(null);
  const cmp = R.latestCompare(c);
  const entries = [...c.researchEntries].sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
  const adopt = (key, text, ids, provenance = "ai_proposed") => mutate(c.id, (x) => void x.workingThesis[key].push(R.newItem(provenance, text, ids)), { aiRelevant: true });
  return (
    <aside className="panel-zone" aria-label="Research">
      <h2 className="zone-h">Research</h2>
      <form className="stack paste" onSubmit={(e) => {
        e.preventDefault();
        const r = R.newEntry(c, f);
        if (r.error) return setErr(r.error);
        setErr(null);
        if (r.dateRejected) toast("That publication date isn't a real calendar date, so it was saved as Unknown.");
        mutate(c.id, (x) => void x.researchEntries.push(r.entry), { aiRelevant: true });
        setF(blank);
      }}>
        <h3>Paste Research</h3>
        <textarea id="paste-text" rows={6} placeholder="Paste excerpts, filing notes, transcripts, or observations exactly as written." value={f.rawText} onChange={(e) => setF({ ...f, rawText: e.target.value })} />
        <details>
          <summary>Optional details</summary>
          <div className="stack">
            <label className="field"><span>Title</span><input id="paste-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
            <label className="field"><span>Publisher</span><input id="paste-publisher" value={f.publisher} onChange={(e) => setF({ ...f, publisher: e.target.value })} /></label>
            <label className="field"><span>Web address</span><input id="paste-url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://" /></label>
            <label className="field"><span>Publication date (YYYY-MM-DD)</span><input id="paste-date" value={f.publishedDate} onChange={(e) => setF({ ...f, publishedDate: e.target.value })} /></label>
          </div>
        </details>
        {err && <p className="err" role="alert" id="paste-error">{err}</p>}
        <button className="btn primary" id="paste-add">Add research</button>
      </form>

      <div className="ai-box">
        <div className="row">
          <button className="btn" id="compare" disabled={!rt.sample || ai.busy} onClick={() => runAi("compare_research")}>Compare Against Thesis</button>
          {ai.busy && <button className="btn" id="stop-waiting" onClick={stopWaiting}>Stop waiting</button>}
        </div>
        {!rt.sample && <p className="meta">AI review isn't available in this view. Everything else works without it.</p>}
        {ai.busy && <p className="meta">Waiting for the review…</p>}
        {ai.note && <p className="meta quiet" id="ai-note">{ai.note}</p>}
        {ai.error && (
          <div className="err-box" role="alert" id="ai-error">
            <p>{ai.error}</p>
            <button className="btn small" onClick={() => ai.retry?.()}>Retry</button>
            {ai.raw && <details><summary>Show what came back (plain text)</summary><pre>{ai.raw}</pre></details>}
          </div>
        )}
        {!cmp ? <p className="meta" id="no-review">{COPY.noReview}</p> : <CompareResults c={c} a={cmp} adopt={adopt} />}
      </div>

      <h3>Entries</h3>
      {!entries.length && <p className="meta">None</p>}
      <ul className="entries">
        {entries.map((e) => <EntryCard key={e.id} e={e} c={c} mutate={mutate} rt={rt} ai={ai} runAi={runAi} adopt={adopt} setModal={setModal} />)}
      </ul>
    </aside>
  );
}

function StaleBanner({ a }) {
  return a.status === "needs_review" ? <p className="stale" role="status"><span className="chip alert">Needs review</span> {COPY.stale}</p> : null;
}
function AdoptSelect({ onPick, label = "Add to thesis…", defaultKey }) {
  return (
    <select aria-label={label} value="" onChange={(e) => e.target.value && onPick(e.target.value)}>
      <option value="">{label}</option>
      {R.SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.title}{s.key === defaultKey ? " (suggested)" : ""}</option>)}
    </select>
  );
}
function CompareResults({ c, a, adopt }) {
  const refs = (ids) => (ids.length ? ids.map((id) => c.researchEntries.find((e) => e.id === id)?.shortRef || "Deleted source").join(", ") : "No source");
  const Group = ({ title, items, defaultKey }) => (
    <div className="group">
      <h4>{title}</h4>
      {!items.length ? <p className="meta">None</p> : (
        <ul>{items.map((x, i) => (
          <li key={i}><span className="chip ai">AI-proposed</span> {x.text} <span className="meta">({refs(x.sourceEntryIds)})</span>
            <AdoptSelect defaultKey={defaultKey} onPick={(k) => adopt(k, x.text, x.sourceEntryIds)} />
          </li>
        ))}</ul>
      )}
    </div>
  );
  return (
    <div className="results" id="compare-results">
      <StaleBanner a={a} />
      <p className="meta">Review from {R.fmtLocal(a.createdAt)}{a.coverage ? ` · compared ${a.coverage.included} of ${a.coverage.readable} readable entries${a.coverage.shortened ? `, ${a.coverage.shortened} shortened` : ""}${a.coverage.unreadExcluded ? `, ${a.coverage.unreadExcluded} unread references left out` : ""}` : ""}</p>
      <Group title="New Information" items={a.result.newInformation} defaultKey="whyInteresting" />
      <Group title="Candidate Contradictions" items={a.result.candidateContradictions} defaultKey="whatWeakens" />
      <div className="group">
        <h4>Sections Needing Review</h4>
        {!a.result.sectionsNeedingReview.length ? <p className="meta">None</p> : <ul>{a.result.sectionsNeedingReview.map((x, i) => <li key={i}><span className="chip ai">AI-proposed</span> <b>{R.sectionTitle(x.sectionKey)}</b>: {x.reason} <span className="meta">({refs(x.sourceEntryIds)})</span></li>)}</ul>}
      </div>
      <Group title="Unanswered Questions" items={a.result.unansweredQuestions} defaultKey="missingEvidence" />
      {a.notes?.length > 0 && <ul className="notes">{a.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
    </div>
  );
}

function EntryCard({ e, c, mutate, rt, ai, runAi, adopt, setModal }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [ex, setEx] = useState(null);
  const [err, setErr] = useState(null);
  const a = R.extractFor(c, e.id);
  const unread = e.urlState === "unread_reference";
  const safe = e.url ? R.safeUrl(e.url) : null;
  const excerpts = c.packetExcerpts.filter((x) => x.entryId === e.id);
  return (
    <li className="entry" id={`entry-${e.shortRef}`}>
      <div className="row">
        <span className="ref">{e.shortRef}</span>
        <b className="grow">{e.title || (unread ? e.url : e.rawText.slice(0, 60))}</b>
        {unread && <span className="chip" title={COPY.unreadHelp}>Unread reference</span>}
      </div>
      {unread && <p className="help">{COPY.unreadHelp}</p>}
      <p className="meta">Publisher: {e.publisher || "Unknown"}</p>
      <p className="meta pub">Published: {e.publishedDate || "Unknown"}</p>
      <p className="meta cap">Captured: {R.fmtLocal(e.capturedAt)}</p>
      {safe?.ok && safe.url && <p className="meta url"><a href={safe.url} target="_blank" rel="noopener noreferrer">{safe.url}</a></p>}
      {edit ? (
        <div className="stack">
          <textarea rows={6} aria-label="Research text" value={edit.rawText} onChange={(x) => setEdit({ ...edit, rawText: x.target.value })} />
          <input aria-label="Title" placeholder="Title" value={edit.title} onChange={(x) => setEdit({ ...edit, title: x.target.value })} />
          <input aria-label="Publisher" placeholder="Publisher" value={edit.publisher} onChange={(x) => setEdit({ ...edit, publisher: x.target.value })} />
          <input aria-label="Web address" placeholder="https://" value={edit.url} onChange={(x) => setEdit({ ...edit, url: x.target.value })} />
          <input aria-label="Publication date" placeholder="YYYY-MM-DD" value={edit.publishedDate} onChange={(x) => setEdit({ ...edit, publishedDate: x.target.value })} />
          {err && <p className="err" role="alert">{err}</p>}
          <div className="row">
            <button className="btn small primary" onClick={() => {
              const r = R.editEntry(e, edit);
              if (r.error) return setErr(r.error);
              mutate(c.id, (x) => void (x.researchEntries = x.researchEntries.map((y) => (y.id === e.id ? r.entry : y))), { aiRelevant: true });
              setEdit(null);
              setErr(null);
            }}>Save entry</button>
            <button className="btn small" onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          {!unread && open && <pre className="raw">{e.rawText}</pre>}
          <div className="row">
            {!unread && <button className="btn link small" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide text" : "Show text"}</button>}
            {!unread && <button className="btn small" id={`extract-${e.shortRef}`} disabled={!rt.sample || ai.busy} onClick={() => runAi("extract_notes", e.id)}>Extract Notes</button>}
            {ai.busy && ai.entryId === e.id && <span className="meta">Waiting…</span>}
            <button className="btn link small" onClick={() => setEdit({ rawText: e.rawText, title: e.title || "", publisher: e.publisher || "", url: e.url || "", publishedDate: e.publishedDate || "" })}>Edit</button>
            {!unread && <button className="btn link small" onClick={() => setEx(e.rawText)}>Select excerpt for packet</button>}
            <button className="btn link small danger" onClick={() => setModal({ type: "confirm", title: `Delete ${e.shortRef}?`, body: "The entry is removed and unlinked from the working thesis and catalysts. Saved revisions keep their history.", confirm: "Delete entry", onConfirm: () => mutate(c.id, (x) => void R.deleteEntry(x, e.id), { aiRelevant: true }) })}>Delete</button>
          </div>
        </>
      )}
      {ex !== null && (
        <div className="stack excerpt-pick">
          <p className="help">Delete everything except the words you want to quote. The excerpt must stay word-for-word.</p>
          <textarea rows={5} aria-label="Excerpt" value={ex} onChange={(x) => setEx(x.target.value)} />
          <p className="meta">{ex.length} characters{ex.length > R.LIMITS.excerptWarn ? " · longer than 400 characters" : ""}</p>
          {err && <p className="err" role="alert">{err}</p>}
          <div className="row">
            <button className="btn small primary" onClick={() => {
              if (!ex.trim() || !e.rawText.includes(ex)) return setErr("The excerpt must be copied word-for-word from this entry.");
              mutate(c.id, (x) => void x.packetExcerpts.push({ id: R.uuid(), entryId: e.id, text: ex }));
              setEx(null);
              setErr(null);
            }}>Add excerpt</button>
            <button className="btn small" onClick={() => (setEx(null), setErr(null))}>Cancel</button>
          </div>
        </div>
      )}
      {excerpts.length > 0 && (
        <ul className="excerpts">{excerpts.map((x) => (
          <li key={x.id}><span className="meta">Packet excerpt · {x.text.length} characters{e.rawText.includes(x.text) ? "" : " · no longer found in this entry"}</span> <button className="btn link small" onClick={() => mutate(c.id, (y) => void (y.packetExcerpts = y.packetExcerpts.filter((z) => z.id !== x.id)))}>Remove</button></li>
        ))}</ul>
      )}
      {a && (
        <div className="results">
          <StaleBanner a={a} />
          <h4>Extracted notes</h4>
          {!a.result.claims.length && !a.result.openQuestions.length && <p className="meta">None</p>}
          <ul>
            {a.result.claims.map((x, i) => <li key={`c${i}`}><span className="chip ai">AI-proposed</span> {x.text} <AdoptSelect defaultKey="whyInteresting" onPick={(k) => adopt(k, x.text, x.sourceEntryId ? [x.sourceEntryId] : [])} /></li>)}
            {a.result.openQuestions.map((x, i) => <li key={`q${i}`}><span className="chip ai">AI-proposed</span> Open question: {x.text} <AdoptSelect defaultKey="missingEvidence" onPick={(k) => adopt(k, x.text, x.sourceEntryId ? [x.sourceEntryId] : [])} /></li>)}
          </ul>
          {a.notes?.length > 0 && <ul className="notes">{a.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        </div>
      )}
    </li>
  );
}

// ====================================================================================
function ExportModal({ ws, active, tab, setTab, close, copyText, download, replaceWorkspace, preview, setPreview }) {
  const [paste, setPaste] = useState("");
  const [imp, setImp] = useState(null);
  const outdated = preview && active && R.companyHash(active) !== preview.hash;
  const check = (text) => {
    const r = R.validateImport(text);
    setImp(r.ok ? { ok: true, ws: r.workspace, notes: r.notes } : { ok: false, error: r.error });
  };
  const fname = (ext) => `woi-research-desk-${(active?.name || "workspace").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${R.phoenixDate()}.${ext}`;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Export">
        <div className="row"><nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "packet"} className={tab === "packet" ? "on" : ""} onClick={() => setTab("packet")} disabled={!active}>Publishing Packet</button>
          <button role="tab" aria-selected={tab === "backup"} className={tab === "backup" ? "on" : ""} onClick={() => setTab("backup")}>Workspace Backup</button>
        </nav><span className="grow" /><button className="btn" onClick={close}>Close</button></div>
        {tab === "packet" && active && (
          <div className="stack">
            <p className="meta">Markdown drafting packet for {active.name}, built in your browser.</p>
            <div className="row">
              <button className="btn primary" id="gen-packet" onClick={() => setPreview({ md: R.packetMarkdown(active), hash: R.companyHash(active) })}>{preview ? "Regenerate preview" : "Generate preview"}</button>
              {outdated && <span className="chip alert" id="packet-outdated">Outdated</span>}
              {preview && <button className="btn" id="copy-packet" onClick={() => copyText(preview.md, "Publishing Packet")}>Copy</button>}
              {preview && <button className="btn" id="dl-packet" onClick={() => download(fname("md"), preview.md)}>Download .md</button>}
            </div>
            {outdated && <p className="meta">Company data changed after this preview. Regenerate to include the changes. Anything you already copied or downloaded is unchanged.</p>}
            {preview && <textarea id="packet-text" className="mono" rows={18} readOnly value={preview.md} aria-label="Packet preview" />}
          </div>
        )}
        {tab === "backup" && (
          <div className="stack">
            <h3>Export</h3>
            <div className="row">
              <button className="btn primary" id="dl-backup" onClick={() => download(`woi-research-desk-workspace-${R.phoenixDate()}.json`, R.exportWorkspace(ws))}>Download JSON backup</button>
              <button className="btn" onClick={() => copyText(R.exportWorkspace(ws), "Workspace Backup")}>Copy JSON</button>
            </div>
            <h3>Import</h3>
            <label className="btn file-btn">Choose JSON file…
              <input type="file" accept=".json,application/json" onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (file.size > R.LIMITS.importBytes) return setImp({ ok: false, error: "The file is larger than 10 MB." });
                const fr = new FileReader();
                fr.onload = () => check(String(fr.result));
                fr.readAsText(file);
              }} />
            </label>
            <textarea id="import-text" className="mono" rows={5} placeholder="…or paste a JSON backup" value={paste} onChange={(e) => setPaste(e.target.value)} aria-label="Backup JSON" />
            <button className="btn" id="import-check" disabled={!paste.trim()} onClick={() => check(paste)}>Check backup</button>
            {imp && !imp.ok && <div className="err-box" role="alert" id="import-error"><p>{COPY.importFail}</p><p className="meta">{imp.error}</p></div>}
            {imp?.ok && (
              <div className="preview-box" id="import-preview">
                <p><b>{COPY.importPreview}</b></p>
                <ul>{imp.ws.companies.map((c) => <li key={c.id}>{c.name}{c.ticker ? ` (${c.ticker})` : ""} · {c.researchEntries.length} entries · {c.revisions.length} revisions{ws.companies.some((x) => x.id === c.id) ? " · already in your workspace" : ""}</li>)}</ul>
                {imp.notes.length > 0 && <ul className="notes">{imp.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
                <div className="row">
                  <button className="btn primary" id="import-replace" onClick={() => (replaceWorkspace(imp.ws, "replace"), setImp(null), close())}>Replace workspace</button>
                  <button className="btn" id="import-merge" onClick={() => (replaceWorkspace(imp.ws, "merge"), setImp(null), close())}>Merge (add new companies only)</button>
                  <button className="btn link" onClick={() => setImp(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Modal({ modal, close }) {
  const [f, setF] = useState({ changeSummary: "", changeRationale: "", supportingResearchIds: [] });
  const ref = useRef(null);
  useEffect(() => {
    if (modal.type === "manual" && ref.current) (ref.current.focus(), ref.current.select());
    const k = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  let body;
  if (modal.type === "confirm")
    body = (<><h2>{modal.title}</h2><p>{modal.body}</p><div className="row end"><button className="btn" onClick={close} autoFocus>Cancel</button><button className="btn primary" id="modal-confirm" onClick={() => (modal.onConfirm(), close())}>{modal.confirm}</button></div></>);
  else if (modal.type === "manual")
    body = (<><h2>{modal.title}</h2><p className="meta">{modal.note}</p><textarea ref={ref} className="mono" rows={14} readOnly value={modal.text} aria-label="Text to copy" id="manual-text" /><div className="row end"><button className="btn" onClick={() => ref.current && (ref.current.focus(), ref.current.select())}>Select all</button><button className="btn primary" onClick={close}>Done</button></div></>);
  else
    body = (
      <form className="stack" onSubmit={(e) => {
        e.preventDefault();
        if (!f.changeSummary.trim() || !f.changeRationale.trim()) return;
        modal.onSave(f);
        close();
      }}>
        <h2>What changed & why</h2>
        <label className="field"><span>What changed</span><textarea id="rev-summary" rows={2} required value={f.changeSummary} onChange={(e) => setF({ ...f, changeSummary: e.target.value })} /></label>
        <label className="field"><span>Why</span><textarea id="rev-rationale" rows={3} required value={f.changeRationale} onChange={(e) => setF({ ...f, changeRationale: e.target.value })} /></label>
        {modal.c.researchEntries.length > 0 && (
          <fieldset className="field"><legend>Supporting research (optional)</legend>
            {modal.c.researchEntries.map((e) => (
              <label key={e.id} className="inline"><input type="checkbox" checked={f.supportingResearchIds.includes(e.id)} onChange={(x) => setF({ ...f, supportingResearchIds: x.target.checked ? [...f.supportingResearchIds, e.id] : f.supportingResearchIds.filter((y) => y !== e.id) })} /> {R.sourceLabel(modal.c, e.id)}</label>
            ))}
          </fieldset>
        )}
        <p className="meta">Saved revisions can't be edited later.</p>
        <div className="row end"><button type="button" className="btn" onClick={close}>Cancel</button><button className="btn primary" id="rev-save" disabled={!f.changeSummary.trim() || !f.changeRationale.trim()}>Save Revision</button></div>
      </form>
    );
  return <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}><div className="modal" role="dialog" aria-modal="true">{body}</div></div>;
}
