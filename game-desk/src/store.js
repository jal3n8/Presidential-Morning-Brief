// Personal storage via the artifact `db` capability, inside the viewer's private data/users/<id>/ subtree.
// One document per game package. Never a shared path.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function once(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e && e.code === "unavailable") {
      await sleep(500 + Math.random() * 500);
      return fn();
    }
    throw e;
  }
}
function personalStore(db, uid) {
  const col = db.collection(`data/users/${uid}`);
  const docId = (id) => `pkg_${id}`;
  return {
    async loadAll() {
      let t;
      const snap = await Promise.race([
        once(() => col.where("kind", "==", "package").get()),
        new Promise((_, rej) => (t = setTimeout(() => rej({ code: "timeout", message: "storage did not answer within 15s" }), 15000))),
      ]).finally(() => clearTimeout(t));
      return snap.docs.map((d) => d.data().json);
    },
    save: (pkg) => once(() => col.doc(docId(pkg.packageId)).set({ kind: "package", json: JSON.stringify(pkg) })),
    remove: (id) => once(() => col.doc(docId(id)).delete()),
  };
}
/** Feature-detects runtime capabilities. Never fakes one. */
export async function connectRuntime() {
  const c = typeof window !== "undefined" ? window.claude : undefined;
  const out = { store: null, sample: null, downloads: null, reason: null };
  if (!c || typeof c.use !== "function") {
    out.reason = "No Claude artifact runtime in this view.";
    return out;
  }
  const [db, user, sample, downloads] = await Promise.all(["db", "user", "sample", "downloads"].map((n) => c.use(n).catch(() => null)));
  Object.assign(out, { sample, downloads });
  if (!db || !user) return { ...out, reason: "Personal storage is not available in this view." };
  const uid = await user.id().catch(() => null);
  if (!uid) return { ...out, reason: "Personal storage needs you signed in to Claude." };
  out.store = personalStore(db, uid);
  return out;
}
