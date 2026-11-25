import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import twitterText from "twitter-text";
const { parseTweet } = twitterText;
import {
  BRANDS, BRAND_IDS, FORMATS, FORMAT_IDS, DEFAULT_SETTINGS, isXFormat,
  newPacket, makeSource, editSource, applySourceStaleness, editDraft, draftText, draftHash,
  runQuoteChecks, findHashtags, removeHashtags, findNeedSource, urlInfo,
  buildPrompt, buildRecheckPrompt, validateGeneration, validateClaims, newDraftFromGeneration,
  draftIssues, cleanPublicText, draftWithSources, researchNotesMd, backupJson, validateBackup,
  copyPacketAsNew, RequestFence, SaveQueue, threadCopyParts, nowIso, sourceLine, approxXCount,
} from "./lib.js";
import { connectRuntime } from "./store.js";

// ---- X counter: twitter-text is bundled into this file, so the weighted count is real. ----
let COUNTER = { label: "X weighted count", fn: (t) => parseTweet(t || "").weightedLength, approx: false };
try {
  if (parseTweet("ab").weightedLength !== 2) throw new Error("bad");
} catch {
  COUNTER = { label: "Approx. X count", fn: approxXCount, approx: true };
}

const STOP_MSG = "Stopped. Claude was told to stop writing; anything it already generated still counts toward your Claude plan usage.";
const SAMPLE_ERR = {
  not_granted: "Claude access was not allowed for this artifact. Allow it from the artifact's permissions to generate.",
  sampling_disabled: "Claude generation is not available for this account.",
  rate_limited: "Claude is rate-limited right now. Wait a bit, then try again.",
  session_expired: "Your Claude session expired. Sign in again, then retry.",
  refused: "Claude declined this request. Change the sources or angle and try again.",
  empty_completion: "Claude returned nothing. Try fewer sources or a simpler angle.",
  invalid_json: "Claude's reply wasn't valid JSON. Try again.",
  prompt_too_large: "The request is too large. Exclude some sources and retry.",
};
const fmtTime = (d) => (d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function exampleStarter() {
  const p = newPacket("agent_skills_101", "Example — inbox triage workflow");
  const r = makeSource(p, {
    raw_text:
      "EXAMPLE NOTE (replace with your own)\nTest log, Nov 18: ran the triage prompt on 40 support emails. 31 were labeled correctly on the first pass. 9 needed a human fix, mostly billing questions. Average time per email dropped from about 2 minutes to about 40 seconds including review.\nOperator note: \"the model is fast but it still needs a human on billing\"",
    title: "Example test log",
  });
  p.sources = [r.source];
  p.next_source_num = r.next_source_num;
  p.example = true;
  return p;
}

// ======================================================================================
export default function App() {
  const [packets, setPacketsState] = useState([]);
  const packetsRef = useRef([]);
  const [activeId, setActiveId] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [rt, setRt] = useState({ phase: "connecting", reason: null, sample: null, downloads: null });
  const storeRef = useRef(null);
  const [, bump] = useState(0);
  const queueRef = useRef(null);
  const fenceRef = useRef(new RequestFence());
  const ctlRef = useRef(null);
  const [gen, setGen] = useState({ busy: false, kind: null, packetId: null, msg: null, tone: "info" });
  const [toasts, setToasts] = useState([]);
  const [modal, setModal] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(() => (typeof window !== "undefined" ? window.innerWidth > 1100 : true));
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [menu, setMenu] = useState(null); // 'settings' | 'backup'
  const [brandFilter, setBrandFilter] = useState("all");
  const headerRef = useRef(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--topbar-h", `${el.getBoundingClientRect().height}px`));
    ro.observe(el);
    return () => ro.disconnect();
  });
  const [inputs, setInputs] = useState({}); // per-packet paste-box state, survives packet switching
  const [srcEdits, setSrcEdits] = useState({}); // `${pid}:${sid}` -> form

  const toast = useCallback((msg, tone = "info", ms = 5200) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-3), { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  const setPackets = (next) => {
    packetsRef.current = next;
    setPacketsState(next);
  };

  // ---------- boot ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await connectRuntime();
      if (!alive) return;
      let loaded = [];
      let mode = "session";
      let reason = r.reason;
      if (r.store) {
        try {
          const res = await r.store.loadAll();
          loaded = res.packets;
          if (res.settings) setSettings({ ...DEFAULT_SETTINGS, ...res.settings });
          for (const i of res.issues) toast(i, "warn", 12000);
          storeRef.current = r.store;
          mode = "personal";
        } catch (e) {
          reason = `Personal storage could not be read (${e.message || e.code || "error"}).`;
        }
      }
      queueRef.current = new SaveQueue(
        async (key, value) => {
          const st = storeRef.current;
          if (!st) throw { code: "session" };
          if (key === "__settings") return st.writeSettings(value);
          if (value && value.__deleted) return st.deletePacket(key);
          return st.writePacket(key, value);
        },
        () => bump((n) => n + 1),
        { delay: 600 },
      );
      if (!loaded.length) loaded = [exampleStarter()];
      loaded.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
      setPackets(loaded);
      setActiveId(loaded[0].packet_id);
      setRt({ phase: mode, reason, sample: r.sample, downloads: r.downloads });
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  const active = packets.find((p) => p.packet_id === activeId) || null;
  const activeDraft = active ? active.drafts.find((d) => d.draft_id === active.active_draft_id) || active.drafts[active.drafts.length - 1] || null : null;

  // ---------- mutation core ----------
  const persist = (p) => {
    if (rt.phase === "personal" && queueRef.current) queueRef.current.schedule(p.packet_id, stripRuntime(p));
    else bump((n) => n + 1);
  };
  // `auto` = app-derived update (e.g. live quote check): never promotes the example packet to saved.
  const updatePacket = (pid, fn, { touch = true, auto = false } = {}) => {
    const cur = packetsRef.current.find((p) => p.packet_id === pid);
    if (!cur) return null;
    let next = fn(cur);
    if (next === cur) return cur;
    if (touch) next = { ...next, updated_at: nowIso() };
    if (cur.example && !auto) next = { ...next, example: false };
    setPackets(packetsRef.current.map((p) => (p.packet_id === pid ? next : p)));
    if (!next.example) persist(next);
    return next;
  };

  // A user edit to a draft invalidates any in-flight request bound to that draft.
  const invalidateFor = (pid, draftId, why) => {
    const a = fenceRef.current.active;
    if (!a || a.packetId !== pid) return;
    if (draftId && a.draftId && a.draftId !== draftId) return;
    fenceRef.current.invalidate(why);
    ctlRef.current?.abort();
    setGen({ busy: false, kind: null, packetId: null, msg: `${why} The response will be discarded. ${STOP_MSG}`, tone: "warn" });
  };

  const updateDraftUser = (pid, did, patch) => {
    invalidateFor(pid, did, "You edited the draft while Claude was working.");
    updatePacket(pid, (p) => ({ ...p, drafts: p.drafts.map((d) => (d.draft_id === did ? editDraft(d, patch) : d)) }));
  };
  const updateDraftMeta = (pid, did, patch, opts) =>
    updatePacket(pid, (p) => ({ ...p, drafts: p.drafts.map((d) => (d.draft_id === did ? { ...d, ...patch } : d)) }), opts);

  // ---------- live exact-wording check (debounced) ----------
  const qcKey = activeDraft ? `${activeDraft.draft_id}|${activeDraft.draft_content_hash}|${active.sources.map((s) => s.content_hash).join(",")}` : "";
  useEffect(() => {
    if (!active || !activeDraft) return;
    const t = setTimeout(() => {
      const p = packetsRef.current.find((x) => x.packet_id === active.packet_id);
      const d = p?.drafts.find((x) => x.draft_id === activeDraft.draft_id);
      if (!d) return;
      const qc = runQuoteChecks(draftText(d), p.sources, d.quote_checks, d.quote_speakers);
      if (JSON.stringify(qc) !== JSON.stringify(d.quote_checks)) updateDraftMeta(p.packet_id, d.draft_id, { quote_checks: qc }, { touch: false, auto: true });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qcKey]);

  // ---------- packets ----------
  const switchPacket = (pid) => {
    if (pid === activeId) return;
    if (fenceRef.current.busy) {
      fenceRef.current.invalidate("switch");
      ctlRef.current?.abort();
      setGen({ busy: false, kind: null, packetId: null, msg: null, tone: "info" });
      toast(`Switched packets while Claude was working. That response will be discarded. ${STOP_MSG}`, "warn", 9000);
    }
    setActiveId(pid);
    if (window.innerWidth <= 1100) setDrawerOpen(false);
  };
  const createPacket = () => {
    const p = newPacket(active?.brand || "woi_equity");
    setPackets([p, ...packetsRef.current]);
    persist(p);
    switchPacket(p.packet_id);
  };
  const deletePacket = (pid) => {
    const p = packetsRef.current.find((x) => x.packet_id === pid);
    setModal({
      type: "confirm",
      title: `Delete “${p.title}”?`,
      body: `This removes the packet, its ${plural(p.sources.length, "source")} and ${plural(p.drafts.length, "draft")} from Personal storage. Export a backup first if you might need it.`,
      confirm: "Delete packet",
      danger: true,
      onConfirm: () => {
        if (fenceRef.current.active?.packetId === pid) {
          fenceRef.current.invalidate("delete");
          ctlRef.current?.abort();
          setGen({ busy: false, kind: null, packetId: null, msg: null, tone: "info" });
        }
        const rest = packetsRef.current.filter((x) => x.packet_id !== pid);
        if (rt.phase === "personal" && !p.example) queueRef.current.schedule(pid, { __deleted: true }, { immediate: true });
        const remaining = rest.length ? rest : [newPacket()];
        if (!rest.length) persist(remaining[0]);
        setPackets(remaining);
        if (pid === activeId) setActiveId(remaining[0].packet_id);
        toast("Packet deleted.");
      },
    });
  };

  // ---------- sources ----------
  const pin = (active && inputs[active.packet_id]) || { paste: "", url: "", title: "", outlet: "", date: "", more: false };
  const setPin = (patch) => setInputs((m) => ({ ...m, [active.packet_id]: { ...pin, ...patch } }));
  const addSource = () => {
    let raw = pin.paste;
    let url = pin.url;
    const bare = raw.trim();
    if (!url.trim() && /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(bare) && !bare.includes("\n")) {
      url = bare; // a bare URL pasted alone is stored as Link only (not read)
      raw = "";
    }
    const r = makeSource(active, { raw_text: raw, url, title: pin.title, outlet_or_author: pin.outlet, published_date: pin.date });
    if (r.error) return toast(r.error, "warn");
    updatePacket(active.packet_id, (p) => ({ ...p, sources: [...p.sources, r.source], next_source_num: r.next_source_num }));
    setInputs((m) => ({ ...m, [active.packet_id]: { paste: "", url: "", title: "", outlet: "", date: "", more: pin.more } }));
    toast(r.source.retrieval_status === "url_only" ? `${r.source.source_id} saved as Link only (not read). It can't support factual claims.` : `${r.source.source_id} added.`);
  };
  const saveSourceEdit = (sid, form) => {
    const pid = active.packet_id;
    updatePacket(pid, (p) => {
      const sources = p.sources.map((s) => (s.source_id === sid ? editSource(s, form) : s));
      return { ...p, sources, drafts: applySourceStaleness(p.drafts, sources) };
    });
    setSrcEdits((m) => {
      const n = { ...m };
      delete n[`${pid}:${sid}`];
      return n;
    });
  };
  const toggleInclude = (sid) => updatePacket(active.packet_id, (p) => ({ ...p, sources: p.sources.map((s) => (s.source_id === sid ? { ...s, include: s.include === false } : s)) }));
  const deleteSource = (sid) =>
    setModal({
      type: "confirm",
      title: `Delete ${sid}?`,
      body: `The id ${sid} won't be reused. Drafts generated with it will be marked Needs recheck.`,
      confirm: "Delete source",
      danger: true,
      onConfirm: () =>
        updatePacket(active.packet_id, (p) => {
          const sources = p.sources.filter((s) => s.source_id !== sid);
          return { ...p, sources, drafts: applySourceStaleness(p.drafts, sources) };
        }),
    });

  const included = active ? active.sources.filter((s) => s.include !== false && s.retrieval_status === "pasted_content") : [];
  const includedChars = included.reduce((n, s) => n + s.raw_text.length, 0);

  // ---------- generation ----------
  const [genForm, setGenForm] = useState({ format: "x_post", opinion: false, angle: "" });
  const generate = async () => {
    if (fenceRef.current.busy || !active) return; // no duplicate calls
    const sample = rt.sample;
    if (!sample) return setGen({ busy: false, msg: "Claude generation isn't available in this view. Open the artifact in Claude on the web or desktop.", tone: "warn" });
    if (!genForm.opinion && !included.length) return setGen({ busy: false, msg: "Add at least one pasted source, include it, or turn on Opinion-only.", tone: "warn" });
    if (!genForm.opinion && includedChars > settings.hard_chars)
      return setGen({ busy: false, msg: `Included sources total ${includedChars.toLocaleString()} characters, over your ${settings.hard_chars.toLocaleString()} cap. Exclude or trim sources first.`, tone: "block" });
    const pid = active.packet_id;
    const binding = fenceRef.current.start({ kind: "generate", packetId: pid, draftId: activeDraft?.draft_id || null, baseDraftRevision: activeDraft?.draft_revision ?? 0 });
    const ctl = new AbortController();
    ctlRef.current = ctl;
    setGen({ busy: true, kind: "generate", packetId: pid, msg: "Thinking…", tone: "info" });
    const ctxSources = active.sources;
    const includedIds = genForm.opinion ? [] : included.map((s) => s.source_id);
    const prompt = buildPrompt({ brand: active.brand, format: genForm.format, angle: genForm.angle.trim(), opinionOnly: genForm.opinion, sources: ctxSources, xTarget: settings.x_target });
    try {
      const raw = await sample.json(prompt, { signal: ctl.signal, cache: false, onText: () => fenceRef.current.isCurrent(binding.id) && setGen((g) => (g.busy ? { ...g, msg: "Writing…" } : g)) });
      if (!fenceRef.current.isCurrent(binding.id)) return; // late response: discard
      const p = packetsRef.current.find((x) => x.packet_id === pid);
      if (!p) return;
      const v = validateGeneration(raw, { format: genForm.format, sources: p.sources, opinionOnly: genForm.opinion });
      const d = newDraftFromGeneration(v, { format: genForm.format, opinionOnly: genForm.opinion, angle: genForm.angle.trim(), sources: p.sources, includedIds });
      fenceRef.current.invalidate("done");
      updatePacket(pid, (pp) => ({ ...pp, drafts: [...pp.drafts, d], active_draft_id: d.draft_id }));
      setGen({ busy: false, msg: v.rejections.length ? `Draft ready. ${plural(v.rejections.length, "validation note")} in the Evidence drawer.` : "Draft ready. Review it before publishing.", tone: v.rejections.length ? "warn" : "ok" });
    } catch (e) {
      if (!fenceRef.current.isCurrent(binding.id)) return;
      fenceRef.current.invalidate("error");
      if (e && e.code === "cancelled") return setGen({ busy: false, msg: STOP_MSG, tone: "warn" });
      setGen({ busy: false, msg: (e && SAMPLE_ERR[e.code]) || (e && e.message) || "Generation failed. Try again.", tone: "block" });
    }
  };
  const cancel = () => {
    if (!fenceRef.current.busy) return;
    fenceRef.current.invalidate("cancel");
    ctlRef.current?.abort();
    setGen({ busy: false, msg: STOP_MSG, tone: "warn" });
  };

  const recheck = async () => {
    if (fenceRef.current.busy || !activeDraft) return;
    const sample = rt.sample;
    if (!sample) return toast("Claude isn't available in this view.", "warn");
    const pid = active.packet_id;
    const d0 = activeDraft;
    if (d0.opinion_only) {
      updateDraftMeta(pid, d0.draft_id, { evidence_stale: false, stale_reason: null, source_versions_snapshot: {} });
      return toast("Opinion-only draft: no factual sources to check against. Marked current.");
    }
    const pasted = active.sources.filter((s) => s.retrieval_status === "pasted_content");
    const binding = fenceRef.current.start({ kind: "recheck", packetId: pid, draftId: d0.draft_id, baseDraftRevision: d0.draft_revision });
    const ctl = new AbortController();
    ctlRef.current = ctl;
    setGen({ busy: true, kind: "recheck", packetId: pid, msg: "Re-checking AI-suggested support…", tone: "info" });
    try {
      const raw = await sample.json(buildRecheckPrompt({ brand: active.brand, text: draftText(d0), sources: active.sources }), { signal: ctl.signal, cache: false });
      if (!fenceRef.current.isCurrent(binding.id)) return;
      fenceRef.current.invalidate("done");
      const p = packetsRef.current.find((x) => x.packet_id === pid);
      const d = p?.drafts.find((x) => x.draft_id === d0.draft_id);
      if (!d || d.draft_revision !== d0.draft_revision) return setGen({ busy: false, msg: "The draft changed during the check, so the result was discarded.", tone: "warn" });
      const { items, rejections } = validateClaims(raw && raw.claims, p.sources.map((s) => ({ ...s, include: true })), false);
      const notIn = Array.isArray(raw?.not_in_supplied_text) ? raw.not_in_supplied_text.filter((x) => typeof x === "string") : [];
      const snap = Object.fromEntries(pasted.map((s) => [s.source_id, s.content_hash]));
      updateDraftMeta(pid, d.draft_id, { ai_evidence_items: items, not_in_supplied_text: notIn, validation_notes: rejections, source_versions_snapshot: snap, evidence_stale: false, stale_reason: null });
      setGen({ busy: false, msg: "AI-suggested support re-checked against current sources. Your review is still yours to confirm.", tone: "ok" });
    } catch (e) {
      if (!fenceRef.current.isCurrent(binding.id)) return;
      fenceRef.current.invalidate("error");
      setGen({ busy: false, msg: e?.code === "cancelled" ? STOP_MSG : SAMPLE_ERR[e?.code] || "Re-check failed.", tone: e?.code === "cancelled" ? "warn" : "block" });
    }
  };

  // ---------- issues ----------
  const issues = useMemo(() => (active && activeDraft ? draftIssues(activeDraft, active, settings, COUNTER.fn) : { blocks: [], warns: [] }), [active, activeDraft, settings]);

  // ---------- exports ----------
  const manual = (title, text, note) => setModal({ type: "manual", title, text, note });
  const copyText = async (text, okMsg, tone = "ok", title = "Copy manually") => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      toast(okMsg, tone, 7000);
    } catch {
      manual(title, text, "Clipboard access was blocked here. The text is selected: press Cmd+C or Ctrl+C.");
    }
  };
  const saveFile = async (filename, data, title) => {
    const dl = rt.downloads;
    if (dl) {
      try {
        await dl.save({ filename, data });
        return toast(`Saved ${filename}.`, "ok");
      } catch (e) {
        if (e?.code === "declined") return toast("Download cancelled.");
        if (e?.code === "rate_limited") return toast("A download prompt is already open.", "warn");
      }
    }
    manual(title, data, `Downloads aren't available in this view. Select all, copy, and save it as ${filename}.`);
  };

  const onCopyPost = () => {
    const d = activeDraft;
    if (!d) return;
    if (issues.blocks.length) {
      setEvidenceOpen(true);
      return setModal({ type: "blocked", blocks: issues.blocks });
    }
    const text = cleanPublicText(d);
    const need = findNeedSource(draftText(d)).length;
    const n = issues.warns.filter((w) => w.kind !== "opinion" && w.kind !== "length").length;
    const parts = [];
    if (n) parts.push(`${plural(n, "item")} need${n === 1 ? "s" : ""} recheck`);
    if (need) parts.push(`${need} [NEED SOURCE] marker${need > 1 ? "s" : ""} stripped; those sentences still lack a source`);
    copyText(text, parts.length ? `Copied clean post — ${parts.join("; ")}.` : "Copied clean post.", parts.length ? "warn" : "ok", "Copy post");
  };
  const onCopyWithSources = () => {
    const d = activeDraft;
    if (!d) return;
    const n = issues.blocks.length + issues.warns.filter((w) => w.kind !== "opinion").length;
    copyText(draftWithSources(d, active), n ? `Copied draft with sources — ${plural(n, "unresolved item")} (see Evidence).` : "Copied draft with sources.", n ? "warn" : "ok", "Copy draft with sources");
  };
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2");
  const slug = (s) => (s || "packet").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "packet";
  const onExportNotes = () => activeDraft && saveFile(`${slug(active.title)}-notes-${stamp()}.md`, researchNotesMd(activeDraft, active), "Research notes (.md)");
  const onExportBackup = (all) => {
    const list = all ? packetsRef.current : [active];
    saveFile(all ? `r2p-backup-all-${stamp()}.json` : `r2p-backup-${slug(active.title)}-${stamp()}.json`, backupJson(list.map(stripRuntime)), "Backup (.json)");
    setMenu(null);
  };

  // ---------- import ----------
  const startImport = (text) => {
    const r = validateBackup(text);
    if (!r.ok) return setModal({ type: "import", stage: "input", error: r.error, text });
    const existing = new Set(packetsRef.current.map((p) => p.packet_id));
    setModal({ type: "import", stage: "review", parsed: r, choices: Object.fromEntries(r.packets.map((p) => [p.packet_id, existing.has(p.packet_id) ? "copy" : "new"])) });
  };
  const finishImport = (parsed, choices) => {
    let list = [...packetsRef.current];
    const added = [];
    for (const p of parsed.packets) {
      const ch = choices[p.packet_id];
      if (ch === "skip") continue;
      if (ch === "replace") {
        list = list.map((x) => (x.packet_id === p.packet_id ? p : x));
        added.push(p);
      } else if (ch === "copy") {
        const c = copyPacketAsNew(p);
        list = [c, ...list];
        added.push(c);
      } else {
        list = [p, ...list];
        added.push(p);
      }
    }
    list = list.filter((p) => !(p.example && added.length));
    setPackets(list);
    added.forEach(persist);
    if (added[0]) setActiveId(added[0].packet_id);
    setModal(null);
    toast(`Imported ${plural(added.length, "packet")}.${parsed.notes.length ? ` ${parsed.notes.length} note(s): ${parsed.notes[0]}` : ""}`, "ok", 8000);
  };

  // ---------- settings ----------
  const saveSettings = (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (rt.phase === "personal") queueRef.current?.schedule("__settings", next);
  };

  // ---------- save pill ----------
  const q = queueRef.current;
  const sum = q ? q.summary() : { state: "saved" };
  let pill;
  if (rt.phase === "connecting") pill = { tone: "muted", text: "Connecting storage…" };
  else if (rt.phase === "session") pill = { tone: "warn", text: "Session only — export backup", title: rt.reason || "Personal storage is unavailable; edits live only in this window." };
  else if (sum.state === "failed") pill = { tone: "block", text: "Save failed — export backup", title: `${sum.error?.message || sum.error?.code || "Storage error"}. Your edits are still here in memory. Click to retry.`, retry: true };
  else if (sum.state === "saving") pill = { tone: "muted", text: "Saving…" };
  else if (sum.state === "dirty") pill = { tone: "muted", text: "Unsaved changes" };
  else pill = { tone: "ok", text: sum.at ? `Saved at ${fmtTime(sum.at)}` : active?.example ? "Example (not saved until edited)" : "Saved" };

  // ======================================================================================
  if (rt.phase === "connecting")
    return (
      <div className="boot">
        <div className="boot-mark">R→P</div>
        <p>Connecting to Personal storage…</p>
      </div>
    );

  const visiblePackets = packets.filter((p) => brandFilter === "all" || p.brand === brandFilter);
  const blocksN = issues.blocks.length;
  const warnsN = issues.warns.length;

  return (
    <div className={`app ${drawerOpen ? "drawer-open" : ""} ${evidenceOpen ? "ev-open" : ""}`}>
      {/* ---------------- top utility bar ---------------- */}
      <header className="topbar" ref={headerRef}>
        <button className="icon-btn" id="toggle-drawer" aria-label="Toggle packets" aria-expanded={drawerOpen} onClick={() => setDrawerOpen((o) => !o)}>
          <span aria-hidden="true">☰</span>
        </button>
        <div className="wordmark" aria-hidden="true">R→P</div>
        {active && (
          <>
            <input
              id="packet-title"
              className="title-input"
              aria-label="Packet title"
              value={active.title}
              onChange={(e) => updatePacket(active.packet_id, (p) => ({ ...p, title: e.target.value }))}
            />
            <select
              id="packet-brand"
              className={`brand-select brand-${active.brand}`}
              aria-label="Brand"
              value={active.brand}
              onChange={(e) =>
                updatePacket(active.packet_id, (p) => ({
                  ...p,
                  brand: e.target.value,
                  drafts: p.drafts.map((d) => ({ ...d, evidence_stale: true, stale_reason: "Brand changed since last check", review_stale: d.user_review_status !== "unreviewed" })),
                }))
              }
            >
              {BRAND_IDS.map((b) => (
                <option key={b} value={b}>
                  {BRANDS[b].label}
                </option>
              ))}
            </select>
          </>
        )}
        <div className="topbar-spacer" />
        <button className={`pill pill-${pill.tone}`} title={pill.title} onClick={() => (pill.retry ? q.retry() : rt.phase === "session" ? setMenu("backup") : null)} aria-live="polite">
          <span className="dot" aria-hidden="true" />
          {pill.text}
        </button>
        <div className="menu-wrap">
          <button className="btn ghost" id="backup-menu" aria-expanded={menu === "backup"} onClick={() => setMenu(menu === "backup" ? null : "backup")}>
            Backup
          </button>
          {menu === "backup" && (
            <div className="popover" role="menu">
              <button role="menuitem" onClick={() => onExportBackup(false)}>Export this packet (.json)</button>
              <button role="menuitem" onClick={() => onExportBackup(true)}>Export all packets (.json)</button>
              <hr />
              <label className="menu-file" role="menuitem">
                Import from file…
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    setMenu(null);
                    if (!f) return;
                    const fr = new FileReader();
                    fr.onload = () => startImport(String(fr.result));
                    fr.onerror = () => toast("Couldn't read that file. Try Paste JSON instead.", "warn");
                    fr.readAsText(f);
                  }}
                />
              </label>
              <button role="menuitem" onClick={() => (setMenu(null), setModal({ type: "import", stage: "input", text: "" }))}>Paste JSON…</button>
            </div>
          )}
        </div>
        <div className="menu-wrap">
          <button className="btn ghost" id="settings-menu" aria-expanded={menu === "settings"} onClick={() => setMenu(menu === "settings" ? null : "settings")}>
            Settings
          </button>
          {menu === "settings" && <SettingsPopover settings={settings} save={saveSettings} rt={rt} close={() => setMenu(null)} />}
        </div>
      </header>

      <div className="body">
        {/* ---------------- packets drawer ---------------- */}
        {drawerOpen && (
          <aside className="drawer" aria-label="Packets">
            <button className="btn primary block" id="new-packet" onClick={createPacket}>
              + New packet
            </button>
            <div className="filters" role="group" aria-label="Filter by brand">
              {["all", ...BRAND_IDS].map((b) => (
                <button key={b} className={`chip ${brandFilter === b ? "on" : ""}`} aria-pressed={brandFilter === b} onClick={() => setBrandFilter(b)}>
                  {b === "all" ? "All" : BRANDS[b].short}
                </button>
              ))}
            </div>
            <ul className="packet-list">
              {visiblePackets.map((p) => {
                const st = q?.status(p.packet_id);
                const unsaved = rt.phase === "personal" && st && st.saved < st.local;
                return (
                  <li key={p.packet_id} className={p.packet_id === activeId ? "current" : ""}>
                    <button className="packet-btn" onClick={() => switchPacket(p.packet_id)}>
                      <span className={`brand-dot brand-${p.brand}`} aria-hidden="true" />
                      <span className="packet-name">{p.title || "Untitled"}</span>
                      <span className="packet-meta">
                        {BRANDS[p.brand].short} · {plural(p.sources.length, "source")} · {plural(p.drafts.length, "draft")}
                        {p.example ? " · example" : ""}
                        {unsaved ? " · unsaved" : ""}
                      </span>
                    </button>
                    <button className="icon-btn subtle" aria-label={`Delete ${p.title}`} onClick={() => deletePacket(p.packet_id)}>
                      ×
                    </button>
                  </li>
                );
              })}
              {!visiblePackets.length && <li className="empty">No packets for this brand yet.</li>}
            </ul>
            <p className="privacy-mini">Private to you · Personal storage only</p>
          </aside>
        )}

        {active && (
          <main className="workspace">
            {active.example && <div className="banner info">This is an example packet so you can see the flow. Edit it to keep it, or start a New packet.</div>}
            <div className="panes">
              {/* ---------------- source panel ---------------- */}
              <section className="pane sources" aria-labelledby="src-h">
                <div className="pane-head">
                  <h2 id="src-h">Sources</h2>
                  <Guardrail chars={includedChars} settings={settings} n={included.length} />
                </div>
                <div className="paste-box">
                  <label htmlFor="quick-paste" className="sr-only">Paste notes, transcript, or article text</label>
                  <textarea
                    id="quick-paste"
                    placeholder="Paste notes, transcripts, or article text. A URL alone is saved as Link only (not read)."
                    value={pin.paste}
                    onChange={(e) => setPin({ paste: e.target.value })}
                    rows={5}
                  />
                  {pin.more && (
                    <div className="meta-grid">
                      <Field id="src-url" label="URL (optional)" value={pin.url} onChange={(v) => setPin({ url: v })} />
                      <Field id="src-title" label="Title (optional)" value={pin.title} onChange={(v) => setPin({ title: v })} />
                      <Field id="src-outlet" label="Outlet / author (optional)" value={pin.outlet} onChange={(v) => setPin({ outlet: v })} />
                      <Field id="src-date" label="Published date (optional)" value={pin.date} onChange={(v) => setPin({ date: v })} placeholder="e.g. 2026-11-24" />
                    </div>
                  )}
                  <div className="row">
                    <button className="btn link" onClick={() => setPin({ more: !pin.more })} aria-expanded={pin.more}>
                      {pin.more ? "Hide details" : "Add details"}
                    </button>
                    <span className="grow" />
                    <span className="muted small tabnum">{pin.paste.length.toLocaleString()} chars</span>
                    <button className="btn primary" id="add-source" onClick={addSource}>
                      Add source
                    </button>
                  </div>
                </div>
                <ol className="source-list">
                  {active.sources.map((s) => (
                    <SourceCard
                      key={s.source_id}
                      s={s}
                      form={srcEdits[`${active.packet_id}:${s.source_id}`]}
                      setForm={(f) => setSrcEdits((m) => ({ ...m, [`${active.packet_id}:${s.source_id}`]: f }))}
                      onSave={(f) => saveSourceEdit(s.source_id, f)}
                      onCancel={() =>
                        setSrcEdits((m) => {
                          const n = { ...m };
                          delete n[`${active.packet_id}:${s.source_id}`];
                          return n;
                        })
                      }
                      onToggle={() => toggleInclude(s.source_id)}
                      onDelete={() => deleteSource(s.source_id)}
                    />
                  ))}
                  {!active.sources.length && (
                    <li className="empty-src">
                      <strong>No sources yet.</strong> Paste text above and press Add source. Sources are numbered S1, S2… and numbers are never reused.
                    </li>
                  )}
                </ol>
              </section>

              {/* ---------------- draft panel ---------------- */}
              <section className="pane draft" aria-labelledby="draft-h">
                <div className="pane-head">
                  <h2 id="draft-h">Draft</h2>
                  <button className={`btn evidence-btn ${blocksN ? "has-block" : warnsN ? "has-warn" : ""}`} id="toggle-evidence" aria-expanded={evidenceOpen} onClick={() => setEvidenceOpen((o) => !o)}>
                    Evidence
                    {blocksN + warnsN > 0 && <span className="count">{blocksN + warnsN}</span>}
                  </button>
                </div>
                <div className="gen-controls">
                  <div className="gen-row">
                    <label className="stack">
                      <span className="lbl">Format</span>
                      <select id="format" value={genForm.format} onChange={(e) => setGenForm({ ...genForm, format: e.target.value })}>
                        {FORMAT_IDS.map((f) => (
                          <option key={f} value={f}>
                            {FORMATS[f]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="toggle">
                      <input id="opinion-only" type="checkbox" checked={genForm.opinion} onChange={(e) => setGenForm({ ...genForm, opinion: e.target.checked })} />
                      <span>Opinion / angle only (no factual sources)</span>
                    </label>
                  </div>
                  <label className="stack">
                    <span className="lbl">Angle (optional)</span>
                    <input id="angle" value={genForm.angle} maxLength={300} onChange={(e) => setGenForm({ ...genForm, angle: e.target.value })} placeholder="One line: what's the take?" />
                  </label>
                  <div className="row">
                    <button className="btn primary" id="generate" disabled={gen.busy} onClick={generate}>
                      {gen.busy && gen.kind === "generate" ? "Generating…" : "Generate draft"}
                    </button>
                    {gen.busy && (
                      <button className="btn" id="cancel" onClick={cancel}>
                        Cancel
                      </button>
                    )}
                    <span className="muted small">
                      {genForm.opinion ? "Sends your angle only." : `Sends ${plural(included.length, "included pasted source")} to Claude.`}
                    </span>
                  </div>
                  {gen.msg && <div className={`status status-${gen.tone}`} role="status">{gen.msg}</div>}
                  {!rt.sample && <div className="status status-warn">Claude generation isn't available in this view; you can still paste, edit, and export.</div>}
                </div>

                {active.drafts.length > 0 && (
                  <div className="draft-tabs" role="tablist" aria-label="Drafts">
                    {active.drafts.map((d, i) => (
                      <button
                        key={d.draft_id}
                        role="tab"
                        aria-selected={d.draft_id === activeDraft?.draft_id}
                        className={`tab ${d.draft_id === activeDraft?.draft_id ? "on" : ""}`}
                        onClick={() => updatePacket(active.packet_id, (p) => ({ ...p, active_draft_id: d.draft_id }), { touch: false })}
                      >
                        {i + 1} · {FORMATS[d.format]}
                        {d.evidence_stale ? " •" : ""}
                      </button>
                    ))}
                  </div>
                )}

                {activeDraft ? (
                  <DraftEditor
                    d={activeDraft}
                    packet={active}
                    issues={issues}
                    settings={settings}
                    onEdit={(patch) => updateDraftUser(active.packet_id, activeDraft.draft_id, patch)}
                    onMeta={(patch) => updateDraftMeta(active.packet_id, activeDraft.draft_id, patch)}
                    onDelete={() =>
                      setModal({
                        type: "confirm",
                        title: "Delete this draft?",
                        body: "The draft and its evidence notes will be removed from this packet.",
                        confirm: "Delete draft",
                        danger: true,
                        onConfirm: () => {
                          invalidateFor(active.packet_id, activeDraft.draft_id, "Draft deleted.");
                          updatePacket(active.packet_id, (p) => {
                            const drafts = p.drafts.filter((x) => x.draft_id !== activeDraft.draft_id);
                            return { ...p, drafts, active_draft_id: drafts[drafts.length - 1]?.draft_id || null };
                          });
                        },
                      })
                    }
                  />
                ) : (
                  <div className="empty-draft">
                    <p>
                      <strong>No draft yet.</strong> Pick a format and press Generate draft. Claude reads only the pasted text you include; Link only sources are never sent as evidence.
                    </p>
                    <button
                      className="btn"
                      onClick={() => {
                        const d = newDraftFromGeneration({ content: "", cards: genForm.format === "x_thread" ? [""] : [], source_card: null, ai_evidence_items: [], not_in_supplied_text: [], rejections: [], speakers: {}, workflow_label: null }, { format: genForm.format, opinionOnly: genForm.opinion, angle: "", sources: active.sources, includedIds: [] });
                        d.evidence_stale = true;
                        d.stale_reason = "Written by hand, no AI support check yet";
                        updatePacket(active.packet_id, (p) => ({ ...p, drafts: [...p.drafts, d], active_draft_id: d.draft_id }));
                      }}
                    >
                      Write by hand instead
                    </button>
                  </div>
                )}

                {activeDraft && (
                  <div className="export-bar" aria-label="Export">
                    <button className={`btn primary ${blocksN ? "blocked" : ""}`} id="copy-post" onClick={onCopyPost} aria-describedby={blocksN ? "block-note" : undefined}>
                      {blocksN ? "Copy post (blocked)" : "Copy post"}
                    </button>
                    <button className="btn" id="copy-sources" onClick={onCopyWithSources}>
                      Copy draft with sources
                    </button>
                    <button className="btn" id="export-notes" onClick={onExportNotes}>
                      Export research notes (.md)
                    </button>
                    <button className="btn" id="export-backup" onClick={() => onExportBackup(false)}>
                      Export backup (.json)
                    </button>
                    {blocksN > 0 && (
                      <p className="block-note" id="block-note">
                        {plural(blocksN, "hard block")} must be fixed before a clean copy.
                      </p>
                    )}
                  </div>
                )}
              </section>
            </div>
          </main>
        )}

        {evidenceOpen && active && (
          <EvidenceDrawer
            d={activeDraft}
            packet={active}
            issues={issues}
            gen={gen}
            onClose={() => setEvidenceOpen(false)}
            onRecheck={recheck}
            onCancel={cancel}
            onMeta={(patch) => activeDraft && updateDraftMeta(active.packet_id, activeDraft.draft_id, patch)}
            onFixHashtags={() => fixHashtags(activeDraft, (patch) => updateDraftUser(active.packet_id, activeDraft.draft_id, patch))}
          />
        )}
      </div>

      {/* ---------------- modals & toasts ---------------- */}
      {modal && (
        <Modal
          modal={modal}
          close={() => setModal(null)}
          onImportText={startImport}
          onFinishImport={finishImport}
          setModal={setModal}
          existingIds={new Set(packets.map((p) => p.packet_id))}
          onFixHashtags={() => {
            fixHashtags(activeDraft, (patch) => updateDraftUser(active.packet_id, activeDraft.draft_id, patch));
            setModal(null);
          }}
        />
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

function stripRuntime(p) {
  const { example, ...rest } = p;
  return rest;
}
function fixHashtags(d, edit) {
  if (!d) return;
  if (d.format === "x_thread") edit({ cards: d.cards.map(removeHashtags), source_card: d.source_card && removeHashtags(d.source_card) });
  else edit({ content: removeHashtags(d.content) });
}

// ======================================================================================
function Field({ id, label, value, onChange, placeholder, multiline }) {
  return (
    <label className="stack" htmlFor={id}>
      <span className="lbl">{label}</span>
      {multiline ? <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={8} /> : <input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

function Guardrail({ chars, settings, n }) {
  const over = chars > settings.hard_chars;
  const warn = chars > settings.soft_chars;
  const pct = Math.min(100, (chars / settings.hard_chars) * 100);
  return (
    <div className={`guard ${over ? "over" : warn ? "warn" : ""}`} title="Configurable app guardrails (not Anthropic platform limits). Change them in Settings.">
      <div className="guard-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
        <i style={{ left: `${(settings.soft_chars / settings.hard_chars) * 100}%` }} />
      </div>
      <span className="small tabnum">
        {chars.toLocaleString()} / {settings.hard_chars.toLocaleString()} chars in {plural(n, "source")}
        {over ? " — over cap, exclude some" : warn ? " — large, consider trimming" : ""}
      </span>
    </div>
  );
}

function SourceCard({ s, form, setForm, onSave, onCancel, onToggle, onDelete }) {
  const [open, setOpen] = useState(false);
  const u = s.url ? urlInfo(s.url) : null;
  const editing = !!form;
  const linkOnly = s.retrieval_status === "url_only";
  return (
    <li className={`src-card ${linkOnly ? "link-only" : ""} ${s.include === false ? "excluded" : ""}`}>
      <div className="src-top">
        <span className="sid">{s.source_id}</span>
        <span className={`badge ${linkOnly ? "badge-link" : "badge-text"}`}>{linkOnly ? "Link only (not read)" : "Pasted text"}</span>
        {u && !u.safe && <span className="badge badge-unsafe">Unsafe URL</span>}
        <span className="grow" />
        {!linkOnly && (
          <label className="toggle small" title="Include this source in the next Generate">
            <input type="checkbox" checked={s.include !== false} onChange={onToggle} aria-label={`Include ${s.source_id} in generation`} />
            <span>Include</span>
          </label>
        )}
      </div>
      <div className="src-title">{s.title}</div>
      <div className="src-meta small muted">
        {s.outlet_or_author || "Author/outlet unknown"} · {s.published_date || "Date unknown"}
        {!linkOnly && ` · ${s.raw_text.length.toLocaleString()} chars`} · v{s.source_version}
      </div>
      {u && (
        <div className="src-url small">
          {u.safe ? (
            <a href={u.url} target="_blank" rel="noopener noreferrer nofollow">
              {u.url}
            </a>
          ) : (
            <span className="inert" title="Not a http(s) link, shown as text only">{u.url}</span>
          )}
        </div>
      )}
      {editing ? (
        <div className="src-edit">
          <Field id={`e-${s.source_id}-text`} label="Pasted text (kept exactly as entered)" value={form.raw_text} onChange={(v) => setForm({ ...form, raw_text: v })} multiline />
          <div className="meta-grid">
            <Field id={`e-${s.source_id}-title`} label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
            <Field id={`e-${s.source_id}-url`} label="URL" value={form.url} onChange={(v) => setForm({ ...form, url: v })} />
            <Field id={`e-${s.source_id}-outlet`} label="Outlet / author" value={form.outlet_or_author} onChange={(v) => setForm({ ...form, outlet_or_author: v })} />
            <Field id={`e-${s.source_id}-date`} label="Published date" value={form.published_date} onChange={(v) => setForm({ ...form, published_date: v })} />
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => onSave({ ...form, title: form.title.trim() || s.title })}>Save edits</button>
            <button className="btn" onClick={onCancel}>Cancel</button>
            <span className="grow" />
            <span className="muted small">Saving marks drafts that used {s.source_id} as Needs recheck.</span>
          </div>
        </div>
      ) : (
        <>
          {!linkOnly && open && <pre className="src-text">{s.raw_text}</pre>}
          <div className="row src-actions">
            {!linkOnly && (
              <button className="btn link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                {open ? "Collapse" : "View text"}
              </button>
            )}
            <button
              className="btn link"
              onClick={() => setForm({ raw_text: s.raw_text, title: s.title, url: s.url || "", outlet_or_author: s.outlet_or_author || "", published_date: s.published_date || "" })}
            >
              Edit
            </button>
            <span className="grow" />
            <button className="btn link danger" onClick={onDelete}>Delete</button>
          </div>
        </>
      )}
    </li>
  );
}

function Counter({ text, target }) {
  const n = COUNTER.fn(text);
  return (
    <span className={`counter tabnum ${n > target ? "over" : ""}`} title={COUNTER.approx ? "Approximate: emoji/CJK count 2, URLs 23." : "Weighted like X: URLs 23, emoji and CJK 2. Uses the twitter-text library bundled in this app."}>
      {COUNTER.label}: {n}/{target}
    </span>
  );
}

function Highlighted({ text, packet }) {
  // Inert preview with hashtags and failed quotes marked; all text rendered as React text nodes.
  const tags = packet.brand === "dubnation_global" ? findHashtags(text) : [];
  if (!tags.length) return null;
  const parts = text.split(/((?:^|\s)#[\p{L}\p{N}_]+)/u);
  return (
    <div className="hl-preview" aria-label="Hashtags highlighted">
      {parts.map((p, i) => (/#[\p{L}\p{N}_]+/u.test(p) ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}
    </div>
  );
}

function DraftEditor({ d, packet, issues, settings, onEdit, onMeta, onDelete }) {
  const stale = d.evidence_stale || d.review_stale;
  const dub = packet.brand === "dubnation_global" && isXFormat(d.format);
  return (
    <div className="editor">
      {stale && (
        <div className="banner warn" role="status">
          <strong>Needs recheck.</strong> {d.evidence_stale ? d.stale_reason : "Changed after your review."} AI-suggested support and your review no longer describe this text.
        </div>
      )}
      {issues.blocks.length > 0 && (
        <div className="banner block" role="alert">
          <strong>Copy post is blocked.</strong>
          <ul>
            {issues.blocks.map((b, i) => (
              <li key={i}>{b.msg}</li>
            ))}
          </ul>
          {issues.blocks.some((b) => b.kind === "hashtag") && (
            <button className="btn small" onClick={() => fixHashtags(d, onEdit)}>
              Remove hashtags
            </button>
          )}
          {issues.blocks.some((b) => b.kind === "quote") && <p className="small">Restore the exact wording from the source, or remove the quote. Removing only the quotation marks keeps the claim flagged as unverified.</p>}
        </div>
      )}
      {d.format === "x_thread" ? (
        <div className="cards">
          {d.cards.map((c, i) => (
            <div className="card-edit" key={i}>
              <div className="card-head">
                <span className="card-num">{i + 1}/</span>
                <Counter text={`${i + 1}/ ${c}`} target={settings.x_target} />
                <span className="grow" />
                <button className="btn link small" disabled={d.cards.length < 2} onClick={() => onEdit({ cards: d.cards.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              </div>
              <textarea aria-label={`Card ${i + 1}`} value={c} rows={4} onChange={(e) => onEdit({ cards: d.cards.map((x, j) => (j === i ? e.target.value : x)) })} />
              {dub && <Highlighted text={c} packet={packet} />}
            </div>
          ))}
          <button className="btn link" onClick={() => onEdit({ cards: [...d.cards, ""] })}>+ Add card</button>
          <div className="card-edit source-card">
            <div className="card-head">
              <span className="card-num">Source / reply card (optional)</span>
              {d.source_card ? <Counter text={`${d.cards.length + 1}/ ${d.source_card}`} target={settings.x_target} /> : null}
            </div>
            <textarea aria-label="Source card" value={d.source_card || ""} rows={2} placeholder="Credit reporters or sources in prose. Leave empty to skip." onChange={(e) => onEdit({ source_card: e.target.value || null })} />
          </div>
        </div>
      ) : (
        <div className="single-edit">
          <div className="card-head">
            <span className="lbl">{FORMATS[d.format]}{d.opinion_only ? " · Opinion only" : ""}</span>
            <span className="grow" />
            {d.format === "x_post" && <Counter text={d.content} target={settings.x_target} />}
            {d.format === "article_outline" && (
              <label className="toggle small">
                <input type="checkbox" checked={d.show_s_tags !== false} onChange={(e) => onMeta({ show_s_tags: e.target.checked })} />
                <span>Keep [S#] tags in “Copy draft with sources”</span>
              </label>
            )}
          </div>
          <textarea id="draft-content" aria-label="Draft text" value={d.content} rows={d.format === "x_post" ? 7 : 18} onChange={(e) => onEdit({ content: e.target.value })} />
          {dub && <Highlighted text={d.content} packet={packet} />}
        </div>
      )}
      {d.format === "research_brief" && <BriefExtras d={d} packet={packet} />}
      <div className="row editor-foot">
        <span className="muted small tabnum">Revision {d.draft_revision}</span>
        <span className="grow" />
        <button className="btn link danger small" onClick={onDelete}>Delete draft</button>
      </div>
    </div>
  );
}

function BriefExtras({ d, packet }) {
  return (
    <div className="brief-extras">
      <h3>Exact wording matches</h3>
      <QuoteList d={d} />
      <h3>Source register</h3>
      <ul className="register">
        {packet.sources.map((s) => (
          <li key={s.source_id} className="small">{sourceLine(s)}</li>
        ))}
        {!packet.sources.length && <li className="small muted">No sources.</li>}
      </ul>
    </div>
  );
}

function QuoteList({ d }) {
  const qc = d?.quote_checks || [];
  if (!qc.length) return <p className="small muted">No multi-word quotations in the draft.</p>;
  return (
    <ul className="quotes">
      {qc.map((q, i) => (
        <li key={i} className={`q q-${q.status}`}>
          <span className="q-text">“{q.quote}”</span>
          <span className="q-status small">
            {q.status === "exact" && (
              <>
                <span className="layer layer-exact">Exact wording match</span>
                {q.mode === "whitespace_normalized" ? " (whitespace-normalized)" : " (literal)"} in {q.source_ids.join(", ")} · confirms the words appear, not who said them or whether they're true
              </>
            )}
            {q.status === "failed" && <span className="layer layer-block">Not found word-for-word in pasted text</span>}
            {q.status === "marks_removed" && <span className="layer layer-warn">Quote marks removed — underlying claim still unverified against supplied text</span>}
          </span>
          <span className="small muted">Speaker: {q.speaker || "Attribution missing"}</span>
        </li>
      ))}
    </ul>
  );
}

function EvidenceDrawer({ d, packet, issues, gen, onClose, onRecheck, onCancel, onMeta, onFixHashtags }) {
  const linkOnly = packet.sources.filter((s) => s.retrieval_status === "url_only");
  const need = d ? findNeedSource(draftText(d)) : [];
  const unsupported = d ? (d.ai_evidence_items || []).filter((c) => !c.source_ids.length) : [];
  const supported = d ? (d.ai_evidence_items || []).filter((c) => c.source_ids.length) : [];
  const reviewLabel = d ? { unreviewed: "Unreviewed", reviewed: "Reviewed by you", flagged: "Flagged" }[d.user_review_status] : "";
  return (
    <aside className="evidence" aria-label="Evidence drawer">
      <div className="ev-head">
        <h2>Evidence</h2>
        <button className="icon-btn" aria-label="Close evidence drawer" onClick={onClose}>×</button>
      </div>
      <p className="small muted">Software assists your review. It can't guarantee truth or brand compliance.</p>
      {!d ? (
        <p className="small">No draft selected.</p>
      ) : (
        <>
          <section className="ev-sec">
            <h3>Status</h3>
            <dl className="status-grid">
              <dt><span className="layer layer-ai">AI-suggested support</span></dt>
              <dd>{d.opinion_only ? "Opinion-only draft — no factual sources used" : d.evidence_stale ? <span className="warn-text">Needs recheck — {d.stale_reason}</span> : "Current as of last check (proposed, not verified)"}</dd>
              <dt><span className="layer layer-review">User review</span></dt>
              <dd>
                {reviewLabel}
                {d.review_stale && <span className="warn-text"> — Needs recheck (changed after review)</span>}
              </dd>
            </dl>
            <div className="row wrap">
              {gen.busy && gen.kind === "recheck" ? (
                <button className="btn" onClick={onCancel}>Cancel re-check</button>
              ) : (
                <button className="btn" id="recheck" disabled={gen.busy} onClick={onRecheck}>Re-check AI support</button>
              )}
              <button className="btn" id="mark-reviewed" onClick={() => onMeta({ user_review_status: "reviewed", review_stale: false, reviewed_at: nowIso(), reviewed_hash: d.draft_content_hash })}>Mark reviewed by you</button>
              <button className="btn" onClick={() => onMeta({ user_review_status: "flagged", review_stale: false, reviewed_at: nowIso(), reviewed_hash: d.draft_content_hash })}>Flag</button>
              {d.user_review_status !== "unreviewed" && <button className="btn link" onClick={() => onMeta({ user_review_status: "unreviewed", review_stale: false })}>Clear</button>}
            </div>
            <label className="stack">
              <span className="lbl">Review note (plain text)</span>
              <textarea id="review-note" rows={2} value={d.user_review_note || ""} onChange={(e) => onMeta({ user_review_note: e.target.value })} />
            </label>
          </section>

          {(issues.blocks.length > 0 || issues.warns.length > 0) && (
            <section className="ev-sec">
              <h3>Blocks & warnings</h3>
              <ul className="issues">
                {issues.blocks.map((b, i) => (
                  <li key={`b${i}`} className="issue block">
                    <span className="tag">Block</span> {b.msg}
                    {b.kind === "hashtag" && <button className="btn small" onClick={onFixHashtags}>Remove hashtags</button>}
                  </li>
                ))}
                {issues.warns.map((w, i) => (
                  <li key={`w${i}`} className="issue warn">
                    <span className="tag">Warn</span> {w.msg}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="ev-sec">
            <h3><span className="layer layer-ai">AI-suggested support</span> <span className="small muted">proposed, not verified</span></h3>
            {d.evidence_stale && supported.length > 0 && <p className="small warn-text">These mappings were made before the latest change.</p>}
            {supported.length ? (
              <ul className="claims">
                {supported.map((c, i) => (
                  <li key={i} className={d.evidence_stale ? "stale" : ""}>
                    <span className="ids">{c.source_ids.map((x) => `[${x}]`).join(" ")}</span> {c.claim}
                    {c.note && <span className="small muted"> — {c.note}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">{d.opinion_only ? "Opinion-only draft — no factual sources used." : "No claim-to-source mappings."}</p>
            )}
          </section>

          <section className="ev-sec">
            <h3><span className="layer layer-exact">Exact wording match</span> <span className="small muted">live, text presence only</span></h3>
            <QuoteList d={d} />
          </section>

          <section className="ev-sec">
            <h3><span className="layer layer-warn">Not in supplied text</span></h3>
            {need.length + unsupported.length + (d.not_in_supplied_text || []).length === 0 ? (
              <p className="small muted">Nothing listed.</p>
            ) : (
              <ul className="claims">
                {need.map((n, i) => <li key={`n${i}`}>[NEED SOURCE] {n}</li>)}
                {(d.not_in_supplied_text || []).map((n, i) => <li key={`m${i}`}>{n}</li>)}
                {unsupported.map((c, i) => <li key={`u${i}`}>{c.claim}</li>)}
              </ul>
            )}
          </section>

          {(d.validation_notes || []).length > 0 && (
            <section className="ev-sec">
              <h3>Validation notes</h3>
              <ul className="claims small">{d.validation_notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </section>
          )}
          {d.workflow_label && packet.brand === "agent_skills_101" && (
            <section className="ev-sec">
              <h3>Workflow label</h3>
              <p className="small">{d.workflow_label === "tested" ? "Tested workflow (per supplied notes) — check the test log supports this." : "Proposed workflow (not yet tested)"}</p>
            </section>
          )}
          {linkOnly.length > 0 && (
            <section className="ev-sec">
              <h3>Link only (not read)</h3>
              <p className="small">{linkOnly.map((s) => s.source_id).join(", ")} were never read and are never used as factual support.</p>
            </section>
          )}
        </>
      )}
    </aside>
  );
}

function SettingsPopover({ settings, save, rt, close }) {
  const [f, setF] = useState({ ...settings });
  const num = (v, lo, hi) => Math.max(lo, Math.min(hi, parseInt(v, 10) || lo));
  return (
    <div className="popover settings-pop" role="dialog" aria-label="Settings">
      <h3>Settings</h3>
      <label className="stack">
        <span className="lbl">X target length (weighted characters)</span>
        <input id="set-x" type="number" min={50} max={25000} value={f.x_target} onChange={(e) => setF({ ...f, x_target: e.target.value })} />
      </label>
      <label className="stack">
        <span className="lbl">Input soft warning (characters per Generate)</span>
        <input id="set-soft" type="number" min={1000} value={f.soft_chars} onChange={(e) => setF({ ...f, soft_chars: e.target.value })} />
      </label>
      <label className="stack">
        <span className="lbl">Input hard cap (characters per Generate)</span>
        <input id="set-hard" type="number" min={1000} value={f.hard_chars} onChange={(e) => setF({ ...f, hard_chars: e.target.value })} />
      </label>
      <p className="small muted">These are configurable app guardrails, not Anthropic platform limits. The counter is an amber warning only; it never locks the editor or blocks copying.</p>
      <div className="row">
        <button
          className="btn primary"
          onClick={() => {
            const x = num(f.x_target, 50, 25000), soft = num(f.soft_chars, 1000, 200000);
            const hard = Math.max(soft, num(f.hard_chars, 1000, 200000));
            save({ x_target: x, soft_chars: soft, hard_chars: hard });
            close();
          }}
        >
          Save settings
        </button>
        <button className="btn" onClick={() => setF({ ...DEFAULT_SETTINGS })}>Defaults</button>
      </div>
      <h3>Data & privacy</h3>
      <ul className="small privacy">
        <li>Pasted text is sent to Anthropic's Claude service only when you press Generate draft or Re-check AI support, and it uses your own Claude plan.</li>
        <li>Keep this artifact private (Only you). It stores data in Personal storage only, never Shared storage.</li>
        <li>Installed artifact apps are not covered by Zero Data Retention (ZDR).</li>
        <li>No analytics, remote scripts, fonts, or API keys. URLs are never fetched.</li>
        <li>Storage now: {rt.phase === "personal" ? "Personal storage (private to you)" : `Session only — ${rt.reason || "export a backup to keep your work"}`}</li>
      </ul>
    </div>
  );
}

function Modal({ modal, close, onImportText, onFinishImport, setModal, existingIds, onFixHashtags }) {
  const ref = useRef(null);
  useEffect(() => {
    const k = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [close]);
  useEffect(() => {
    if (modal.type === "manual" && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [modal]);
  let body;
  if (modal.type === "confirm")
    body = (
      <>
        <h2>{modal.title}</h2>
        <p>{modal.body}</p>
        <div className="row end">
          <button className="btn" onClick={close} autoFocus>Keep it</button>
          <button className={`btn ${modal.danger ? "danger-fill" : "primary"}`} onClick={() => (modal.onConfirm(), close())}>{modal.confirm}</button>
        </div>
      </>
    );
  else if (modal.type === "manual")
    body = (
      <>
        <h2>{modal.title}</h2>
        <p className="small">{modal.note}</p>
        <textarea ref={ref} className="manual-text" readOnly value={modal.text} rows={14} onFocus={(e) => e.target.select()} aria-label="Text to copy" />
        <div className="row end">
          <button className="btn" onClick={() => ref.current && (ref.current.focus(), ref.current.select())}>Select all</button>
          <button className="btn primary" onClick={close}>Done</button>
        </div>
      </>
    );
  else if (modal.type === "blocked")
    body = (
      <>
        <h2>Copy post is blocked</h2>
        <ul>{modal.blocks.map((b, i) => <li key={i}>{b.msg}</li>)}</ul>
        <p className="small">Restore exact wording or remove the quote. Removing only the quotation marks clears this block but the claim stays flagged as unverified.</p>
        <div className="row end">
          {modal.blocks.some((b) => b.kind === "hashtag") && <button className="btn" onClick={onFixHashtags}>Remove hashtags</button>}
          <button className="btn primary" onClick={close}>Back to draft</button>
        </div>
      </>
    );
  else if (modal.type === "import" && modal.stage === "input")
    body = (
      <>
        <h2>Import backup</h2>
        <p className="small">Paste the contents of a Research-to-Publish backup (.json). Nothing changes until you review and confirm.</p>
        <textarea id="import-text" className="manual-text" rows={12} value={modal.text || ""} onChange={(e) => setModal({ ...modal, text: e.target.value, error: null })} aria-label="Backup JSON" />
        {modal.error && <div className="status status-block" role="alert">{modal.error}</div>}
        <div className="row end">
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn primary" id="import-validate" onClick={() => onImportText(modal.text || "")}>Check backup</button>
        </div>
      </>
    );
  else if (modal.type === "import" && modal.stage === "review")
    body = (
      <>
        <h2>Review import</h2>
        <p className="small">Existing packets are never overwritten unless you pick Replace.</p>
        <ul className="import-list">
          {modal.parsed.packets.map((p) => {
            const exists = existingIds.has(p.packet_id);
            const ch = modal.choices[p.packet_id];
            const set = (v) => setModal({ ...modal, choices: { ...modal.choices, [p.packet_id]: v } });
            return (
              <li key={p.packet_id}>
                <strong>{p.title}</strong> <span className="small muted">{BRANDS[p.brand].label} · {plural(p.sources.length, "source")} · {plural(p.drafts.length, "draft")}</span>
                {exists ? (
                  <div className="row wrap small">
                    <span className="warn-text">Already exists.</span>
                    <label className="toggle"><input type="radio" name={`c-${p.packet_id}`} checked={ch === "copy"} onChange={() => set("copy")} /> Import as new copy</label>
                    <label className="toggle"><input type="radio" name={`c-${p.packet_id}`} checked={ch === "replace"} onChange={() => set("replace")} /> Replace existing</label>
                    <label className="toggle"><input type="radio" name={`c-${p.packet_id}`} checked={ch === "skip"} onChange={() => set("skip")} /> Skip</label>
                  </div>
                ) : (
                  <div className="row wrap small">
                    <label className="toggle"><input type="radio" name={`c-${p.packet_id}`} checked={ch === "new"} onChange={() => set("new")} /> Import</label>
                    <label className="toggle"><input type="radio" name={`c-${p.packet_id}`} checked={ch === "skip"} onChange={() => set("skip")} /> Skip</label>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {modal.parsed.notes.length > 0 && <ul className="small warn-text">{modal.parsed.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        <div className="row end">
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn primary" id="import-confirm" onClick={() => onFinishImport(modal.parsed, modal.choices)}>Import</button>
        </div>
      </>
    );
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true">{body}</div>
    </div>
  );
}
