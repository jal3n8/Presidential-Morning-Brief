// StorageAdapter: Personal storage via the artifact `db` capability, inside the viewer's private
// data/users/<id>/ subtree (never a shared path). Each company is written as chunk documents followed
// by a head document, so a failed write leaves the previous saved copy intact.
// AiAdapter/ExportAdapter capabilities (`sample`, `downloads`) are resolved here too; none are faked.
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
const gid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function personalStore(db, uid) {
  const col = db.collection(`data/users/${uid}`);
  const heads = new Map();
  const headId = (id) => `co_${id}`;
  const chunkId = (id, gen, i) => `co_${id}~${gen}~${i}`;
  const dropChunks = (id, h) => {
    for (let i = 0; i < h.chunks; i++) col.doc(chunkId(id, h.gen, i)).delete().catch(() => {});
  };
  return {
    async load() {
      let t;
      const snap = await Promise.race([
        once(() => col.where("kind", "==", "company_head").get()),
        new Promise((_, rej) => (t = setTimeout(() => rej({ code: "timeout", message: "storage did not answer" }), 15000))),
      ]).finally(() => clearTimeout(t));
      const companies = [];
      const problems = [];
      for (const d of snap.docs) {
        const h = d.data();
        try {
          let s = "";
          for (let i = 0; i < h.chunks; i++) {
            const c = await once(() => col.doc(chunkId(h.companyId, h.gen, i)).get());
            if (!c.exists) throw new Error("a saved part is missing");
            s += c.data().data;
          }
          companies.push(JSON.parse(s));
          heads.set(h.companyId, { gen: h.gen, chunks: h.chunks });
        } catch (e) {
          problems.push(`“${h.name || "A company"}” couldn't be loaded (${e.message}). Its saved copy was left as it was.`);
        }
      }
      const meta = await once(() => col.doc("workspace").get()).catch(() => null);
      return { companies, meta: meta?.exists ? meta.data() : null, problems };
    },
    async saveCompany(c) {
      const parts = chunkString(JSON.stringify(c));
      const gen = gid();
      for (let i = 0; i < parts.length; i++) await once(() => col.doc(chunkId(c.id, gen, i)).set({ kind: "company_chunk", companyId: c.id, gen, i, data: parts[i] }));
      await once(() => col.doc(headId(c.id)).set({ kind: "company_head", companyId: c.id, name: c.name, gen, chunks: parts.length, schemaVersion: "1.0.0" }));
      const prev = heads.get(c.id);
      heads.set(c.id, { gen, chunks: parts.length });
      if (prev) dropChunks(c.id, prev);
    },
    async deleteCompany(id) {
      await once(() => col.doc(headId(id)).delete());
      const prev = heads.get(id);
      heads.delete(id);
      if (prev) dropChunks(id, prev);
    },
    saveMeta: (meta) => once(() => col.doc("workspace").set({ kind: "workspace", ...meta })),
  };
}

export async function connectRuntime() {
  const c = typeof window !== "undefined" ? window.claude : undefined;
  const out = { store: null, sample: null, downloads: null, reason: null };
  if (!c || typeof c.use !== "function") return { ...out, reason: "No Claude artifact runtime in this view." };
  const [db, user, sample, downloads] = await Promise.all(["db", "user", "sample", "downloads"].map((n) => c.use(n).catch(() => null)));
  Object.assign(out, { sample, downloads });
  if (!db || !user) return { ...out, reason: "Personal storage isn't available in this view." };
  const uid = await user.id().catch(() => null);
  if (!uid) return { ...out, reason: "Personal storage needs you signed in to Claude." };
  return { ...out, store: personalStore(db, uid) };
}
