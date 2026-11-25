// Personal storage over the artifact `db` capability, under the viewer's private
// data/users/<id>/ subtree (private even from the artifact owner's other viewers; never shared paths).
// A packet is serialized to JSON and written as chunk documents first, then a head document that
// points at that chunk generation. A crash or failure mid-write leaves the previous head intact.
import { chunkString, rid } from "./lib.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function once(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e && e.code === "unavailable") {
      await sleep(400 + Math.random() * 600);
      return fn();
    }
    throw e;
  }
}
function withTimeout(p, ms, label) {
  let t;
  return Promise.race([p, new Promise((_, rej) => (t = setTimeout(() => rej({ code: "timeout", message: `${label} did not answer within ${ms / 1000}s` }), ms)))]).finally(() => clearTimeout(t));
}

export function createPersonalStore(db, uid) {
  const col = db.collection(`data/users/${uid}`);
  const heads = new Map(); // pid -> {gen, chunks}
  const headId = (pid) => `pk_${pid}`;
  const chunkId = (pid, gen, i) => `pk_${pid}~${gen}~${i}`;

  async function deleteChunks(pid, gen, n) {
    for (let i = 0; i < n; i++) {
      try {
        await once(() => col.doc(chunkId(pid, gen, i)).delete());
      } catch {
        /* best effort; orphan sweep catches leftovers */
      }
    }
  }

  return {
    mode: "personal",
    async loadAll() {
      const snap = await withTimeout(once(() => col.where("kind", "==", "head").get()), 15000, "Personal storage");
      const packets = [];
      const issues = [];
      for (const doc of snap.docs) {
        const h = doc.data();
        try {
          const parts = [];
          for (let i = 0; i < h.chunks; i++) {
            const c = await once(() => col.doc(chunkId(h.packet_id, h.gen, i)).get());
            if (!c.exists) throw new Error(`missing part ${i + 1} of ${h.chunks}`);
            parts.push(c.data().data);
          }
          const p = JSON.parse(parts.join(""));
          heads.set(h.packet_id, { gen: h.gen, chunks: h.chunks });
          packets.push(p);
        } catch (e) {
          issues.push(`“${h.title || h.packet_id}” could not be loaded (${e.message || e}). Its stored copy was left untouched.`);
        }
      }
      let settings = null;
      try {
        const s = await once(() => col.doc("settings").get());
        if (s.exists) settings = s.data().values || null;
      } catch {
        /* defaults */
      }
      // Sweep orphaned chunks older than 10 minutes (left by failed writes).
      (async () => {
        try {
          const cs = await col.where("kind", "==", "chunk").get();
          const cutoff = Date.now() - 10 * 60 * 1000;
          for (const d of cs.docs) {
            const c = d.data();
            const live = heads.get(c.pid);
            if ((!live || live.gen !== c.gen) && (c.t || 0) < cutoff && snap.docs.every((x) => x.data().gen !== c.gen)) await col.doc(d.id).delete().catch(() => {});
          }
        } catch {
          /* ignore */
        }
      })();
      return { packets, settings, issues };
    },
    async writePacket(pid, packet) {
      const json = JSON.stringify(packet);
      const parts = chunkString(json);
      const gen = rid("g");
      const t = Date.now();
      for (let i = 0; i < parts.length; i++) await once(() => col.doc(chunkId(pid, gen, i)).set({ kind: "chunk", pid, gen, i, t, data: parts[i] }));
      await once(() =>
        col.doc(headId(pid)).set({ kind: "head", packet_id: pid, title: packet.title, brand: packet.brand, updated_at: packet.updated_at, gen, chunks: parts.length, schema_version: 1 }),
      );
      const prev = heads.get(pid);
      heads.set(pid, { gen, chunks: parts.length });
      if (prev) deleteChunks(pid, prev.gen, prev.chunks);
    },
    async deletePacket(pid) {
      await once(() => col.doc(headId(pid)).delete());
      const prev = heads.get(pid);
      heads.delete(pid);
      if (prev) await deleteChunks(pid, prev.gen, prev.chunks);
    },
    async writeSettings(values) {
      await once(() => col.doc("settings").set({ kind: "settings", values }));
    },
  };
}

/** Resolve the runtime: personal storage if db + user id are available, else session-only. */
export async function connectRuntime() {
  const c = typeof window !== "undefined" ? window.claude : undefined;
  const out = { store: null, sample: null, downloads: null, reason: null };
  if (!c || typeof c.use !== "function") {
    out.reason = "This view has no Claude artifact runtime (opened outside Claude).";
    return out;
  }
  // Installed desktop app: set our own icon only. No OS permissions are requested (manifest lists none).
  c.use("desktop")
    .then((desktop) => {
      if (!desktop?.app?.dock?.setIcon) return;
      const cv = document.createElement("canvas");
      cv.width = cv.height = 256;
      const g = cv.getContext("2d");
      g.fillStyle = "#1f4f8f";
      g.beginPath();
      g.roundRect(0, 0, 256, 256, 56);
      g.fill();
      g.fillStyle = "#ffffff";
      g.font = "bold 92px ui-monospace, Menlo, monospace";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("R\u2192P", 128, 136);
      return desktop.app.dock.setIcon(cv.toDataURL("image/png"));
    })
    .catch(() => {});
  const [db, user, sample, downloads] = await Promise.all(["db", "user", "sample", "downloads"].map((n) => c.use(n).catch(() => null)));
  out.sample = sample;
  out.downloads = downloads;
  if (!db || !user) {
    out.reason = !db ? "Personal storage is not available in this view." : "Could not identify you for Personal storage.";
    return out;
  }
  let uid = null;
  try {
    uid = await user.id();
  } catch {
    uid = null;
  }
  if (!uid) {
    out.reason = "Personal storage needs you signed in to Claude.";
    return out;
  }
  out.store = createPersonalStore(db, uid);
  return out;
}
