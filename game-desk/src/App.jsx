import React, { useEffect, useMemo, useRef, useState } from "react";
import * as G from "./lib.js";
import { connectRuntime } from "./store.js";

const STOP_MSG = "Stopped waiting — the request may still complete in the background and use your Claude plan. Any late reply will be ignored.";
const AI_ERR = {
  not_granted: "Claude access was not allowed for this artifact. Use Template still works.",
  sampling_disabled: "AI captions aren't available for this account. Use Template still works.",
  rate_limited: "Claude is rate-limited right now. Try later or use the template.",
  session_expired: "Your Claude session expired. Sign in again, or use the template.",
  refused: "Claude declined this request. Use the template instead.",
  invalid_json: "Claude's reply wasn't valid JSON. Nothing was changed.",
  empty_completion: "Claude returned nothing. Nothing was changed.",
};
const MATCHUP_LABEL = { home: "Home", away: "Away", unspecified: "Unspecified" };

// ---------- canvas rendering of the shared layout ----------
let measureCtx = null;
function measure(text, size, weight, tracking = 0) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = `${weight} ${size}px ${G.FONT}`;
  if (!tracking) return measureCtx.measureText(text).width;
  let w = 0;
  for (const ch of text) w += measureCtx.measureText(ch).width;
  return w + tracking * size * (text.length - 1);
}
function drawCard(canvas, ops) {
  const { w, h } = G.CARD;
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  for (const o of ops) {
    if (o.t === "bg") {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, G.COLORS.blue);
      gr.addColorStop(1, G.COLORS.navy);
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    } else if (o.t === "line") {
      g.strokeStyle = o.color;
      g.lineWidth = o.width;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(o.x1, o.y);
      g.lineTo(o.x2, o.y);
      g.stroke();
    } else if (o.t === "arc") {
      g.strokeStyle = o.color;
      g.lineWidth = o.width;
      g.beginPath();
      g.moveTo(o.x1, o.y);
      g.quadraticCurveTo((o.x1 + o.x2) / 2, o.y - o.lift * 2, o.x2, o.y);
      g.stroke();
    } else if (o.t === "text") {
      g.font = `${o.weight} ${o.size}px ${G.FONT}`;
      g.fillStyle = o.color;
      g.globalAlpha = o.opacity || 1;
      g.textBaseline = "alphabetic";
      if (o.tracking) {
        const total = measure(o.text, o.size, o.weight, o.tracking);
        let x = o.align === "center" ? o.x - total / 2 : o.align === "right" ? o.x - total : o.x;
        g.textAlign = "left";
        for (const ch of o.text) {
          g.fillText(ch, x, o.y);
          x += g.measureText(ch).width + o.tracking * o.size;
        }
      } else {
        g.textAlign = o.align;
        g.fillText(o.text, o.x, o.y);
      }
      g.globalAlpha = 1;
    }
  }
}

export default function App() {
  const [rt, setRt] = useState({ phase: "connecting" });
  const [pkgs, setPkgs] = useState([]);
  const pkgsRef = useRef([]);
  const [activeId, setActiveId] = useState(null);
  const storeRef = useRef(null);
  const saveRef = useRef({}); // id -> {seq, savedSeq, inflight, error, at}
  const [, bump] = useState(0);
  const [modal, setModal] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [ai, setAi] = useState({ busy: false, msg: null, tone: "info" });
  const aiRef = useRef({ seq: 0, active: null });
  const [exp, setExp] = useState({ status: null, url: null, kind: null, note: null });
  const urlsRef = useRef([]);
  const [shot, setShot] = useState(false);
  const [copyFallback, setCopyFallback] = useState({});
  const [copied, setCopied] = useState({});
  const engine = useMemo(() => G.detectEngine(), []);

  const toast = (msg, tone = "info") => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-2), { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5500);
  };

  useEffect(() => {
    (async () => {
      const r = await connectRuntime();
      let loaded = [];
      let phase = "session";
      let reason = r.reason;
      if (r.store) {
        try {
          const raw = await r.store.loadAll();
          for (const j of raw) {
            const v = G.validateImport(JSON.stringify({ schemaVersion: 1, packages: [JSON.parse(j)] }));
            if (v.ok) loaded.push(v.packages[0]);
          }
          storeRef.current = r.store;
          phase = "personal";
        } catch (e) {
          reason = `Personal storage could not be read (${e.message || e.code}). Working in Session-Only Mode.`;
        }
      }
      loaded.sort((a, b) => (a.updatedAtUtc < b.updatedAtUtc ? 1 : -1));
      const fresh = G.newPackage(); // the app always opens on a clean, empty game
      pkgsRef.current = [fresh, ...loaded];
      setPkgs(pkgsRef.current);
      setActiveId(fresh.packageId);
      setRt({ phase, reason, sample: r.sample, downloads: r.downloads });
    })();
    return () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)); // revoke only on unmount
  }, []);

  // ---------- persistence: one write in flight per package; Saved only after resolve ----------
  const flush = async (id) => {
    const st = saveRef.current[id];
    const store = storeRef.current;
    if (!st || !store || st.inflight || st.savedSeq >= st.seq || st.error) return bump((n) => n + 1);
    const seq = st.seq;
    const pkg = pkgsRef.current.find((p) => p.packageId === id);
    if (!pkg) return;
    st.inflight = true;
    bump((n) => n + 1);
    const at = G.nowIso();
    try {
      await store.save({ ...pkg, lastSavedAtUtc: at });
      st.savedSeq = Math.max(st.savedSeq, seq);
      st.at = at;
      pkgsRef.current = pkgsRef.current.map((p) => (p.packageId === id ? { ...p, lastSavedAtUtc: at } : p));
      setPkgs(pkgsRef.current);
    } catch (e) {
      st.error = e;
    } finally {
      st.inflight = false;
    }
    flush(id);
  };
  const schedule = (id) => {
    if (!storeRef.current) return bump((n) => n + 1);
    const st = (saveRef.current[id] ||= { seq: 0, savedSeq: 0, inflight: false, error: null, at: null });
    st.seq += 1;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => flush(id), 350);
    bump((n) => n + 1);
  };

  /** input=true increments inputRevision (game fields / cities). */
  const update = (fn, { input = false } = {}) => {
    const cur = pkgsRef.current.find((p) => p.packageId === activeId);
    const next = JSON.parse(JSON.stringify(cur));
    fn(next);
    if (input) {
      next.inputRevision += 1;
      // A newer input revision supersedes any in-flight AI request.
      const a = aiRef.current.active;
      if (a) {
        aiRef.current.active = null;
        a.ctl.abort();
        setAi({ busy: false, msg: "You changed the game while captions were generating, so that response will be ignored.", tone: "warn" });
      }
    }
    next.updatedAtUtc = G.nowIso();
    const b = G.computeBoard(next, engine);
    next.resolvedInstantUtc = b.status === "ok" ? b.resolvedInstantUtc : null;
    pkgsRef.current = pkgsRef.current.map((p) => (p.packageId === activeId ? next : p));
    setPkgs(pkgsRef.current);
    if (!G.isBlank(next)) schedule(next.packageId);
  };

  const pkg = pkgs.find((p) => p.packageId === activeId);
  const board = useMemo(() => (pkg ? G.computeBoard(pkg, engine) : null), [pkg, engine]);
  const ready = board?.status === "ok";
  const reviewed = ready && pkg.reviewedInputRevision === pkg.inputRevision;
  const snapshot = ready ? G.snapshotOf(board) : null;
  const ops = useMemo(() => (snapshot ? G.layoutCard(snapshot, measure) : null), [JSON.stringify(snapshot)]);

  if (rt.phase === "connecting" || !pkg) return <div className="boot"><b>DNG</b><p>Checking storage…</p></div>;

  // ---------- save status ----------
  const st = saveRef.current[pkg.packageId];
  let saveLabel;
  if (rt.phase !== "personal") saveLabel = { tone: "warn", text: "Session-Only Mode" };
  else if (G.isBlank(pkg)) saveLabel = { tone: "muted", text: "Nothing to save yet" };
  else if (st?.error) saveLabel = { tone: "block", text: "Save failed — unsaved changes", retry: true };
  else if (st && (st.inflight || st.savedSeq < st.seq)) saveLabel = { tone: "muted", text: "Saving…" };
  else if (st?.at || pkg.lastSavedAtUtc) saveLabel = { tone: "ok", text: `Saved ${G.chromeTime(st?.at || pkg.lastSavedAtUtc)}` };
  else saveLabel = { tone: "muted", text: "Not saved yet" };

  const g = pkg.game;
  const setGame = (patch) => update((p) => Object.assign(p.game, patch), { input: true });
  const exported = pkg.lastExportedGraphic;
  const exportOutdated = exported && exported.basedOnInputRevision !== pkg.inputRevision;

  // ---------- exports ----------
  const registerUrl = (u) => {
    urlsRef.current.forEach((x) => URL.revokeObjectURL(x)); // revoke previous only on regeneration
    urlsRef.current = [u];
    return u;
  };
  const requestDownload = async (blob, filename) => {
    if (rt.downloads) {
      try {
        await rt.downloads.save({ filename, data: blob });
        return { status: "Download requested", note: "Your browser was asked to download the file. This app can't confirm it was saved." };
      } catch (e) {
        if (e?.code === "declined") return { status: "Image ready", note: "Download was declined. The inline image below is still available." };
        return { status: "Export failed", note: `Download isn't available here (${e?.code || "error"}). Use the inline image below or Screenshot Mode.` };
      }
    }
    try {
      const a = document.createElement("a");
      a.href = urlsRef.current[0];
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return { status: "Download requested", note: "A download link was triggered. If nothing downloaded, this sandbox blocked it: use the inline image below or Screenshot Mode." };
    } catch {
      return { status: "Export failed", note: "Download was blocked. Use the inline image below or Screenshot Mode." };
    }
  };
  const fileBase = () => `dng-gametime-${board.source.date.y}-${String(board.source.date.m).padStart(2, "0")}-${String(board.source.date.d).padStart(2, "0")}-${board.opponent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "game"}`;
  const recordExport = (format, status) =>
    update((p) => void (p.lastExportedGraphic = { format, status, exportedAtUtc: G.nowIso(), basedOnInputRevision: p.inputRevision, snapshot: JSON.parse(JSON.stringify(snapshot)) }));
  const exportPng = async () => {
    if (!reviewed) return;
    try {
      const c = document.createElement("canvas");
      drawCard(c, ops);
      const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob returned nothing"))), "image/png"));
      const url = registerUrl(URL.createObjectURL(blob));
      setExp({ status: "Image ready", url, kind: "png", note: "PNG generated in memory." });
      const r = await requestDownload(blob, `${fileBase()}.png`);
      setExp({ status: r.status, url, kind: "png", note: r.note });
      recordExport("png", r.status);
    } catch (e) {
      setExp({ status: "Export failed", url: null, kind: "png", note: `PNG could not be generated (${e.message}). Try Download SVG or Screenshot Mode.` });
      recordExport("png", "Export failed");
    }
  };
  const exportSvg = async () => {
    if (!reviewed) return;
    try {
      const svg = G.renderSvg(ops);
      const blob = new Blob([svg], { type: "image/svg+xml" });
      const url = registerUrl(URL.createObjectURL(blob));
      setExp({ status: "Image ready", url, kind: "svg", note: "SVG generated in memory." });
      const r = await requestDownload(blob, `${fileBase()}.svg`);
      setExp({ status: r.status, url, kind: "svg", note: r.note });
      recordExport("svg", r.status);
    } catch (e) {
      setExp({ status: "Export failed", url: null, kind: "svg", note: `SVG could not be generated (${e.message}). Use Screenshot Mode.` });
      recordExport("svg", "Export failed");
    }
  };

  // ---------- captions ----------
  const setCaption = (kind, text, mode) =>
    update((p) => void (p.captions[kind] = { text, mode, generatedAtUtc: G.nowIso(), basedOnInputRevision: p.inputRevision, manuallyEdited: false }));
  const applyCaptions = (next, mode) => {
    const edited = ["x", "ig"].filter((k) => pkg.captions[k]?.manuallyEdited && pkg.captions[k].text !== next[k]);
    const go = (kinds) => update((p) => {
      for (const k of kinds) p.captions[k] = { text: next[k], mode, generatedAtUtc: G.nowIso(), basedOnInputRevision: p.inputRevision, manuallyEdited: false };
    });
    const free = ["x", "ig"].filter((k) => !edited.includes(k));
    if (free.length) go(free);
    if (edited.length) setModal({ type: "replace", kinds: edited, next, mode, onReplace: () => go(edited) });
  };
  const useTemplate = () => ready && applyCaptions({ x: G.templateX(board), ig: G.templateIG(board) }, "template");
  const generate = async () => {
    if (!ready || !rt.sample || aiRef.current.active) return;
    const ctl = new AbortController();
    const req = { id: ++aiRef.current.seq, inputRevision: pkg.inputRevision, packageId: pkg.packageId, ctl };
    aiRef.current.active = req;
    setAi({ busy: true, msg: "Generating captions…", tone: "info" });
    try {
      const raw = await rt.sample.json(G.captionPrompt(board), { signal: ctl.signal, cache: false });
      const cur = pkgsRef.current.find((p) => p.packageId === req.packageId);
      if (aiRef.current.active?.id !== req.id || !cur || cur.inputRevision !== req.inputRevision) return toast("Ignored a late AI response (inputs changed or a newer request started).");
      aiRef.current.active = null;
      let v;
      try {
        v = G.validateCaptionReply(raw);
      } catch (e) {
        return setAi({ busy: false, msg: `AI reply failed validation: ${e.message} Nothing was changed. Use Template instead.`, tone: "block", raw: JSON.stringify(raw, null, 2) });
      }
      applyCaptions(v, "ai");
      setAi({ busy: false, msg: "AI captions ready. Review every line before posting.", tone: "ok" });
    } catch (e) {
      if (aiRef.current.active?.id !== req.id) return;
      aiRef.current.active = null;
      setAi({ busy: false, msg: e?.code === "cancelled" ? STOP_MSG : `${AI_ERR[e?.code] || e?.message || "AI request failed."} Your current captions were not changed.`, tone: e?.code === "cancelled" ? "warn" : "block", raw: e?.text || null });
    }
  };
  const stopWaiting = () => {
    const a = aiRef.current.active;
    if (!a) return;
    aiRef.current.active = null;
    a.ctl.abort();
    setAi({ busy: false, msg: STOP_MSG, tone: "warn" });
  };
  const copyCaption = async (kind) => {
    if (!reviewed) return;
    const text = pkg.captions[kind]?.text || "";
    setCopied((c) => ({ ...c, [kind]: false }));
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      setCopied((c) => ({ ...c, [kind]: true }));
      setCopyFallback((c) => ({ ...c, [kind]: false }));
    } catch {
      setCopyFallback((c) => ({ ...c, [kind]: true }));
    }
  };

  // ---------- packages & backup ----------
  const newGame = () => {
    const p = G.newPackage();
    pkgsRef.current = [p, ...pkgsRef.current.filter((x) => !G.isBlank(x))];
    setPkgs(pkgsRef.current);
    setActiveId(p.packageId);
    setExp({ status: null, url: null });
    setAi({ busy: false, msg: null });
  };
  const exportJson = async (all) => {
    const list = (all ? pkgsRef.current : [pkg]).filter((p) => !G.isBlank(p));
    if (!list.length) return toast("Nothing to back up yet.", "warn");
    const text = G.backupJson(list);
    const name = `dng-game-desk-${all ? "all" : "game"}-${new Date().toISOString().slice(0, 10)}.json`;
    if (rt.downloads) {
      try {
        await rt.downloads.save({ filename: name, data: text });
        return toast("Download requested. This app can't confirm the file was saved.", "ok");
      } catch (e) {
        if (e?.code === "declined") return toast("Download declined.");
      }
    }
    setModal({ type: "manual", title: "Backup JSON", text, note: `Downloads aren't available here. Select all, copy, and save it as ${name}.` });
  };
  const importText = (text) => {
    const r = G.validateImport(text);
    if (!r.ok) return setModal({ type: "import", error: r.error, text });
    const existing = new Set(pkgsRef.current.map((p) => p.packageId));
    const clashes = r.packages.filter((p) => existing.has(p.packageId));
    const apply = () => {
      const ids = new Set(r.packages.map((p) => p.packageId));
      pkgsRef.current = [...r.packages, ...pkgsRef.current.filter((p) => !ids.has(p.packageId) && !G.isBlank(p))];
      setPkgs(pkgsRef.current);
      setActiveId(r.packages[0].packageId);
      r.packages.forEach((p) => schedule(p.packageId));
      setModal(null);
      toast(`Imported ${r.packages.length} game${r.packages.length === 1 ? "" : "s"}. Times were recomputed from the imported inputs.`, "ok");
    };
    if (clashes.length) setModal({ type: "confirm", title: "Overwrite existing games?", body: `${clashes.length} imported game${clashes.length === 1 ? " has" : "s have"} the same ID as a game already here (${clashes.map((p) => p.game.opponent || p.packageId).join(", ")}). Importing replaces ${clashes.length === 1 ? "it" : "them"}.`, confirm: "Overwrite", onConfirm: apply });
    else apply();
  };
  const deleteGame = (p) =>
    setModal({
      type: "confirm",
      title: "Delete this game?",
      body: `${p.game.opponent || "Untitled game"} will be removed from personal storage. Export a backup first if you need it.`,
      confirm: "Delete game",
      onConfirm: async () => {
        try {
          if (storeRef.current && p.lastSavedAtUtc) await storeRef.current.remove(p.packageId);
          pkgsRef.current = pkgsRef.current.filter((x) => x.packageId !== p.packageId);
          if (!pkgsRef.current.length) pkgsRef.current = [G.newPackage()];
          setPkgs(pkgsRef.current);
          setActiveId(pkgsRef.current[0].packageId);
        } catch (e) {
          toast(`Couldn't delete from storage (${e.code || e.message}). Nothing was removed.`, "block");
        }
      },
    });

  const saved = pkgs.filter((p) => !G.isBlank(p));
  const selected = pkg.selectedCityIds;
  const addable = G.CITIES.filter((c) => !selected.includes(c.id));
  const differing = ready ? board.cities.filter((c) => c.dayOffset !== 0) : [];
  const urlCheck = G.safeHttpUrl(g.referenceUrl);
  const capOutdated = (k) => pkg.captions[k] && pkg.captions[k].basedOnInputRevision !== pkg.inputRevision;

  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <h1>DNG Global Game Desk</h1>
          <span className="grow" />
          <button className={`status tone-${saveLabel.tone}`} onClick={() => saveLabel.retry && ((st.error = null), flush(pkg.packageId))} title={saveLabel.retry ? "Retry saving" : rt.reason || ""} aria-live="polite">{saveLabel.text}</button>
          <select aria-label="Saved games" value={activeId} onChange={(e) => setActiveId(e.target.value)}>
            {pkgs.map((p) => <option key={p.packageId} value={p.packageId}>{G.isBlank(p) ? "New game (empty)" : `${p.game.opponent || "Untitled"}${p.game.date ? ` · ${p.game.date}` : ""}`}</option>)}
          </select>
          <button className="btn" id="new-game" onClick={newGame}>New game</button>
          <details className="menu">
            <summary className="btn">Backup</summary>
            <div className="menu-pop" onClick={(e) => { if (e.target.closest("button")) e.currentTarget.closest("details").open = false; }} onChange={(e) => (e.currentTarget.closest("details").open = false)}>
              <button onClick={() => exportJson(false)} disabled={G.isBlank(pkg)}>Export this game (.json)</button>
              <button onClick={() => exportJson(true)} disabled={!saved.length}>Export all games (.json)</button>
              <label className="file">Import from file…
                <input type="file" accept=".json,application/json" onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  if (f.size > G.LIMITS.importBytes) return setModal({ type: "import", error: "File is larger than 1 MB.", text: "" });
                  const fr = new FileReader();
                  fr.onload = () => importText(String(fr.result));
                  fr.readAsText(f);
                }} />
              </label>
              <button onClick={() => setModal({ type: "import", text: "" })}>Paste JSON…</button>
              {!G.isBlank(pkg) && <button className="danger" onClick={() => deleteGame(pkg)}>Delete this game…</button>}
            </div>
          </details>
        </div>
        <div className="trust" role="note">User-entered — not independently verified.</div>
        {rt.phase !== "personal" && <div className="session" role="status">Session-Only Mode: {rt.reason} Work is kept only while this window is open. Use Backup → Export to keep it.</div>}
      </header>

      <main className="main">
        <div className="col">
          {/* 1. GAME SETUP */}
          <section className="panel" aria-labelledby="s1">
            <h2 id="s1"><span className="step">1</span> Game setup</h2>
            <div className="grid">
              <label className="field wide"><span className="lbl">Opponent</span>
                <input id="opponent" maxLength={G.LIMITS.opponent} value={g.opponent} onChange={(e) => setGame({ opponent: e.target.value })} placeholder="Team name as you want it shown" />
              </label>
              <fieldset className="field wide">
                <legend className="lbl">Matchup</legend>
                <div className="seg" role="radiogroup">
                  {["home", "away", "unspecified"].map((m) => (
                    <label key={m} className={g.matchup === m ? "on" : ""}><input type="radio" name="matchup" value={m} checked={g.matchup === m} onChange={() => setGame({ matchup: m })} />{MATCHUP_LABEL[m]}</label>
                  ))}
                </div>
                <span className="hint">Set explicitly. Venue never changes this.</span>
              </fieldset>
              <label className="field"><span className="lbl">Game date (source time zone)</span>
                <input id="game-date" value={g.date} inputMode="numeric" placeholder="YYYY-MM-DD" onChange={(e) => setGame({ date: e.target.value.trim(), dstDisambiguation: null })} />
              </label>
              <label className="field"><span className="lbl">Source time zone</span>
                <select id="source-zone" value={g.sourceZoneId} onChange={(e) => setGame({ sourceZoneId: e.target.value, dstDisambiguation: null })}>
                  <option value="">Choose the schedule's city…</option>
                  {G.SOURCE_ZONES.map((z) => <option key={z.zone} value={z.zone}>{z.label}</option>)}
                </select>
              </label>
              <fieldset className="field wide">
                <legend className="lbl">Tipoff time</legend>
                <div className="row">
                  {g.timeMode === "12h" ? (
                    <>
                      <input id="hour" className="num" aria-label="Hour" inputMode="numeric" maxLength={2} value={g.time12.hour} placeholder="7" onChange={(e) => setGame({ time12: { ...g.time12, hour: e.target.value.trim() }, dstDisambiguation: null })} />
                      <span>:</span>
                      <input id="minute" className="num" aria-label="Minutes" inputMode="numeric" maxLength={2} value={g.time12.minute} placeholder="00" onChange={(e) => setGame({ time12: { ...g.time12, minute: e.target.value.trim() }, dstDisambiguation: null })} />
                      <div className="seg" role="radiogroup" aria-label="AM or PM">
                        {["AM", "PM"].map((x) => <label key={x} className={g.time12.ampm === x ? "on" : ""}><input type="radio" name="ampm" value={x} checked={g.time12.ampm === x} onChange={() => setGame({ time12: { ...g.time12, ampm: x }, dstDisambiguation: null })} />{x}</label>)}
                      </div>
                    </>
                  ) : (
                    <input id="time24" className="num wide-num" value={g.time24} placeholder="HH:mm" onChange={(e) => setGame({ time24: e.target.value.trim(), dstDisambiguation: null })} />
                  )}
                  <button className="btn link small" onClick={() => setGame({ timeMode: g.timeMode === "12h" ? "24h" : "12h", dstDisambiguation: null })}>Use {g.timeMode === "12h" ? "24-hour" : "12-hour"} entry</button>
                </div>
              </fieldset>
              <label className="field wide"><span className="lbl">Venue (optional)</span>
                <input id="venue" maxLength={G.LIMITS.venue} value={g.venue} onChange={(e) => setGame({ venue: e.target.value })} placeholder="Location line only" />
              </label>
            </div>
            <div className="ref-card">
              <h3>Source reference (optional) <span className="hint">kept separate from captions and the graphic</span></h3>
              <label className="field"><span className="lbl">Reference URL</span>
                <input id="ref-url" value={g.referenceUrl} onChange={(e) => setGame({ referenceUrl: e.target.value })} placeholder="https://…" />
              </label>
              {!urlCheck.ok && <p className="err" role="alert">{urlCheck.error}</p>}
              {urlCheck.ok && urlCheck.url && <p className="hint"><a href={urlCheck.url} target="_blank" rel="noopener noreferrer">{urlCheck.url}</a> · Unread reference — not fetched</p>}
              <label className="field"><span className="lbl">Schedule excerpt · Supplied excerpt — kept separate from AI copy</span>
                <textarea id="excerpt" rows={3} maxLength={G.LIMITS.excerpt} value={g.excerpt} onChange={(e) => setGame({ excerpt: e.target.value })} />
              </label>
              <span className="hint">{g.excerpt.length}/{G.LIMITS.excerpt}</span>
            </div>
            {(board.status === "ambiguous" || board.ambiguous) && (
              <fieldset className="ambig" id="ambiguity">
                <legend>This time happens twice. Which one?</legend>
                {board.candidates.map((c, i) => (
                  <label key={i}><input type="radio" name="dst" checked={g.dstDisambiguation === (i === 0 ? "earlier" : "later")} onChange={() => setGame({ dstDisambiguation: i === 0 ? "earlier" : "later" })} /> {i === 0 ? "Earlier" : "Later"} occurrence ({G.utcOffsetText(c.offsetMin)})</label>
                ))}
              </fieldset>
            )}
            {board.problems.length > 0 && <ul className={`problems ${board.status === "gap" ? "block" : ""}`} id="problems">{board.problems.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          </section>

          {/* CITIES + BOARD */}
          <section className="panel" aria-labelledby="s2">
            <h2 id="s2"><span className="step">2</span> Global tipoff board</h2>
            <ol className="cities">
              {selected.map((id, i) => {
                const c = G.cityById(id);
                const row = ready ? board.cities.find((x) => x.id === id) : null;
                return (
                  <li key={id} className="city">
                    <span className="c-name">{c.label}</span>
                    {row ? <><span className="c-time">{row.time}</span><span className="c-date">{row.dateLabel}</span>{row.offsetText ? <span className="c-off">{row.offsetText}</span> : <span />}</> : <span className="hint c-wait">Waiting for a complete tipoff</span>}
                    <span className="c-act">
                      <button className="icon" aria-label={`Move ${c.label} up`} disabled={i === 0} onClick={() => update((p) => { const a = p.selectedCityIds; [a[i - 1], a[i]] = [a[i], a[i - 1]]; }, { input: true })}>↑</button>
                      <button className="icon" aria-label={`Move ${c.label} down`} disabled={i === selected.length - 1} onClick={() => update((p) => { const a = p.selectedCityIds; [a[i + 1], a[i]] = [a[i], a[i + 1]]; }, { input: true })}>↓</button>
                      <button className="icon" aria-label={`Remove ${c.label}`} onClick={() => update((p) => void (p.selectedCityIds = p.selectedCityIds.filter((x) => x !== id)), { input: true })}>×</button>
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className="row">
              <select id="add-city" aria-label="Add a city" value="" onChange={(e) => e.target.value && update((p) => void p.selectedCityIds.push(e.target.value), { input: true })}>
                <option value="">Add a city…</option>
                {addable.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              {selected.length > G.CITY_CAP_RECOMMENDED && <span className="warn-text">More than {G.CITY_CAP_RECOMMENDED} cities may be hard to read on the card.</span>}
              <span className="hint grow-right">Converted in your browser with {engine === "Temporal" ? "Temporal" : "Intl.DateTimeFormat"}. No AI does time math.</span>
            </div>
          </section>

          {/* 3. FINAL REVIEW */}
          <section className="panel" aria-labelledby="s3">
            <h2 id="s3"><span className="step">3</span> Final review</h2>
            {!ready ? <p className="hint">Complete the game setup to review.</p> : (
              <div id="review">
                <dl className="review">
                  <dt>Matchup</dt><dd>{G.matchupCaption(board.matchup, board.opponent)} <span className="tag">{MATCHUP_LABEL[board.matchup]}</span></dd>
                  <dt>Source time</dt><dd>{board.source.dateShort} · {board.source.time} in {board.source.cityLabel}</dd>
                  <dt>Selected cities</dt><dd>{board.cities.map((c) => c.label).join(", ")}</dd>
                  <dt>Different local date</dt><dd>{differing.length ? differing.map((c) => <span key={c.id} className="diff">{c.label}: {c.dateLabel} ({c.offsetText})</span>) : "None"}</dd>
                </dl>
                {reviewed ? <p className="ok-text" id="review-ok">Reviewed for these inputs.</p> : (
                  <button className="btn primary" id="confirm-review" onClick={() => update((p) => void (p.reviewedInputRevision = p.inputRevision))}>Looks right — continue</button>
                )}
              </div>
            )}
          </section>

          {/* 5. CAPTIONS */}
          <section className="panel" aria-labelledby="s5">
            <h2 id="s5"><span className="step">5</span> Caption desk</h2>
            {!ready ? <p className="hint">Captions unlock once every selected city converts.</p> : (
              <>
                <div className="row">
                  <button className="btn" id="use-template" onClick={useTemplate}>Use Template</button>
                  <button className="btn" id="gen-captions" disabled={!rt.sample || ai.busy} onClick={generate}>{rt.sample ? "Generate Captions" : "Generate Captions — AI unavailable here"}</button>
                  {ai.busy && <button className="btn" id="stop-waiting" onClick={stopWaiting}>Stop waiting</button>}
                </div>
                {ai.msg && <div className={`ai tone-${ai.tone}`} role="status">{ai.msg}{ai.raw && <details><summary>Show reply as plain text</summary><pre>{ai.raw}</pre></details>}</div>}
                <p className="hint">AI receives only the confirmed fields and already-converted times, never the excerpt or URL. Prompting can't guarantee safety or accuracy: review every caption before posting. Posting stays manual, outside this app.</p>
                {["x", "ig"].map((k) => {
                  const cap = pkg.captions[k];
                  const warns = cap ? G.lintCaption(cap.text, k, board) : [];
                  const bad = cap?.mode === "ai" ? G.aiTimeMismatches(cap.text, board) : [];
                  return (
                    <div className="caption" key={k}>
                      <div className="cap-head">
                        <h3>{k === "x" ? "X" : "Instagram / Facebook"}</h3>
                        {cap && <span className="tag">{cap.mode === "ai" ? "AI" : "Template"}</span>}
                        {cap?.manuallyEdited && <span className="tag">Edited</span>}
                        {capOutdated(k) && <span className="tag warn" id={`outdated-${k}`}>Outdated</span>}
                        <span className="grow" />
                        {k === "x" && cap && <span className="hint">Approx. X count (aid only): {G.approxXCount(cap.text)}</span>}
                      </div>
                      {cap ? (
                        <>
                          <textarea id={`cap-${k}`} rows={k === "x" ? 3 : 10} value={cap.text} onChange={(e) => update((p) => void (p.captions[k] = { ...p.captions[k], text: e.target.value, manuallyEdited: true }))} />
                          {(warns.length > 0 || bad.length > 0) && <ul className="warns">{bad.map((t) => <li key={t}>Time {t} isn't on the converted board.</li>)}{warns.map((w, i) => <li key={i}>{w}</li>)}</ul>}
                          <div className="row">
                            <button className="btn" id={`copy-${k}`} disabled={!reviewed} onClick={() => copyCaption(k)}>Copy</button>
                            {copied[k] && <span className="ok-text" id={`copied-${k}`}>Copied</span>}
                            {!reviewed && <span className="hint">Confirm the final review to copy.</span>}
                          </div>
                          {copyFallback[k] && (
                            <div className="fallback">
                              <p className="hint">Clipboard access was blocked. Select this text and press Cmd+C / Ctrl+C.</p>
                              <textarea readOnly rows={k === "x" ? 3 : 8} value={cap.text} onFocus={(e) => e.target.select()} ref={(el) => el && (el.focus(), el.select())} aria-label="Text to copy manually" />
                            </div>
                          )}
                        </>
                      ) : <p className="hint">No caption yet.</p>}
                    </div>
                  );
                })}
              </>
            )}
          </section>
        </div>

        {/* 4. GRAPHIC */}
        <aside className="col preview-col">
          <section className="panel" aria-labelledby="s4">
            <h2 id="s4"><span className="step">4</span> Time card · 1080×1350</h2>
            {ready ? <CardCanvas ops={ops} /> : <div className="card-empty">Complete the game setup to preview the card.</div>}
            <div className="row">
              <button className="btn primary" id="export-png" disabled={!reviewed} onClick={exportPng}>Export PNG</button>
              <button className="btn" id="export-svg" disabled={!reviewed} onClick={exportSvg}>Download SVG</button>
              <button className="btn" id="screenshot" disabled={!ready} onClick={() => setShot(true)}>Screenshot Mode</button>
            </div>
            {ready && !reviewed && <p className="hint">Confirm the final review to export.</p>}
            {(exp.status || exported) && (
              <div className="export-status" id="export-status">
                {exp.status && <p><span className={`tag ${exp.status === "Export failed" ? "block" : ""}`}>{exp.status}</span> {exp.note}</p>}
                {exported && <p className="hint">Last export: {exported.format.toUpperCase()} · {exported.status} · {G.chromeTime(exported.exportedAtUtc)} {exportOutdated && <span className="tag warn" id="export-outdated">Outdated</span>}</p>}
                {exp.url && <figure className="inline-img"><img src={exp.url} alt="Exported time card" /><figcaption className="hint">Inline image: right-click or long-press to save if the download didn't arrive.</figcaption></figure>}
              </div>
            )}
          </section>
        </aside>
      </main>

      {shot && ready && <ScreenshotMode ops={ops} onExit={() => setShot(false)} />}
      {modal && <Modal modal={modal} close={() => setModal(null)} importText={importText} />}
      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast tone-${t.tone}`}>{t.msg}</div>)}</div>
    </div>
  );
}

function CardCanvas({ ops, className = "card-canvas" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && ops) drawCard(ref.current, ops);
  }, [ops]);
  return <canvas ref={ref} className={className} role="img" aria-label="Time card preview" />;
}

function ScreenshotMode({ ops, onExit }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onExit();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onExit]);
  return (
    <div className="shot" id="shot-mode">
      <CardCanvas ops={ops} className="shot-canvas" />
      <button className="shot-exit" onClick={onExit}>Exit Screenshot Mode</button>
    </div>
  );
}

function Modal({ modal, close, importText }) {
  const [text, setText] = useState(modal.text || "");
  const ref = useRef(null);
  useEffect(() => {
    const k = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    if (modal.type === "manual" && ref.current) (ref.current.focus(), ref.current.select());
    return () => window.removeEventListener("keydown", k);
  }, [modal, close]);
  let body;
  if (modal.type === "replace")
    body = (
      <>
        <h2>Replace your edited caption{modal.kinds.length > 1 ? "s" : ""}?</h2>
        <p>You edited {modal.kinds.map((k) => (k === "x" ? "the X caption" : "the Instagram / Facebook caption")).join(" and ")}. Here is the new {modal.mode === "ai" ? "AI" : "template"} text:</p>
        {modal.kinds.map((k) => <pre key={k} className="preview-text" id={`preview-${k}`}>{modal.next[k]}</pre>)}
        <div className="row end"><button className="btn" onClick={close} autoFocus>Keep my edits</button><button className="btn primary" id="confirm-replace" onClick={() => (modal.onReplace(), close())}>Replace</button></div>
      </>
    );
  else if (modal.type === "confirm")
    body = (
      <>
        <h2>{modal.title}</h2>
        <p>{modal.body}</p>
        <div className="row end"><button className="btn" onClick={close} autoFocus>Cancel</button><button className="btn primary" id="modal-confirm" onClick={() => (modal.onConfirm(), close())}>{modal.confirm}</button></div>
      </>
    );
  else if (modal.type === "manual")
    body = (
      <>
        <h2>{modal.title}</h2>
        <p className="hint">{modal.note}</p>
        <textarea ref={ref} className="mono" rows={14} readOnly value={modal.text} aria-label="Text to copy" />
        <div className="row end"><button className="btn" onClick={() => ref.current && (ref.current.focus(), ref.current.select())}>Select all</button><button className="btn primary" onClick={close}>Done</button></div>
      </>
    );
  else
    body = (
      <>
        <h2>Import backup</h2>
        <p className="hint">Paste a DNG Game Desk backup (.json, up to 1 MB). Nothing changes until it passes every check. Times are always recomputed from the imported inputs.</p>
        <textarea id="import-text" className="mono" rows={10} value={text} onChange={(e) => setText(e.target.value)} aria-label="Backup JSON" />
        {modal.error && <p className="err" role="alert" id="import-error">{modal.error}</p>}
        <div className="row end"><button className="btn" onClick={close}>Cancel</button><button className="btn primary" id="import-go" disabled={!text.trim()} onClick={() => importText(text)}>Check and import</button></div>
      </>
    );
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true">{body}</div>
    </div>
  );
}
