// Personal storage over the artifact `db` capability, inside the viewer's private data/users/<id>/ subtree
// (never a shared path). State is written as chunk documents first, then a head document pointing at
// that chunk generation, so a failed write leaves the previous saved state intact.
import { chunkString } from "./lib.js";

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
const withTimeout = (p, ms) => {
  let t;
  return Promise.race([p, new Promise((_, rej) => (t = setTimeout(() => rej({ code: "timeout", message: `storage did not answer within ${ms / 1000}s` }), ms)))]).finally(() => clearTimeout(t));
};
const gid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function personalStore(db, uid) {
  const col = db.collection(`data/users/${uid}`);
  let head = null;
  return {
    async load() {
      const h = await withTimeout(once(() => col.doc("ob_state").get()), 15000);
      if (!h.exists) return null;
      const d = h.data();
      const parts = [];
      for (let i = 0; i < d.chunks; i++) {
        const c = await once(() => col.doc(`ob_state~${d.gen}~${i}`).get());
        if (!c.exists) throw { code: "corrupt", message: `saved state is missing part ${i + 1} of ${d.chunks}` };
        parts.push(c.data().data);
      }
      head = { gen: d.gen, chunks: d.chunks };
      return JSON.parse(parts.join(""));
    },
    async save(state, seq) {
      const parts = chunkString(JSON.stringify(state));
      const gen = gid();
      for (let i = 0; i < parts.length; i++) await once(() => col.doc(`ob_state~${gen}~${i}`).set({ kind: "chunk", gen, i, data: parts[i] }));
      await once(() => col.doc("ob_state").set({ kind: "head", gen, chunks: parts.length, storageSeq: seq, savedAt: new Date().toISOString(), schemaVersion: 1 }));
      const prev = head;
      head = { gen, chunks: parts.length };
      if (prev) for (let i = 0; i < prev.chunks; i++) col.doc(`ob_state~${prev.gen}~${i}`).delete().catch(() => {});
    },
  };
}

/** Resolves {store|null, sample|null, downloads|null, reason}. Never fakes a capability. */
export async function connectRuntime() {
  const c = typeof window !== "undefined" ? window.claude : undefined;
  const out = { store: null, sample: null, downloads: null, reason: null };
  if (!c || typeof c.use !== "function") {
    out.reason = "No Claude artifact runtime in this view (opened outside Claude).";
    return out;
  }
  const [db, user, sample, downloads] = await Promise.all(["db", "user", "sample", "downloads"].map((n) => c.use(n).catch(() => null)));
  out.sample = sample;
  out.downloads = downloads;
  if (!db || !user) {
    out.reason = "Personal storage is not available in this view.";
    return out;
  }
  const uid = await user.id().catch(() => null);
  if (!uid) {
    out.reason = "Personal storage needs you signed in to Claude.";
    return out;
  }
  out.store = personalStore(db, uid);
  return out;
}
