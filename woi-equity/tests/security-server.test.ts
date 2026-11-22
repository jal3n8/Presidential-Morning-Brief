/**
 * Security tests against the real PHP endpoints (skipped if PHP or the
 * Composer vendor folder is missing; CI installs both).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUDIENCE, INGEST_TOKEN, ISSUER, claims, hasPhp, hs256WithPublicKey, jwks, makeKeys, now, sha256, signJwt, startServer, unsignedJwt, type Server } from "./phpServer";
import { baseline } from "./helpers";
import { publicProjection } from "../src/lib/publicProjection";
import { SnapshotSchema } from "../src/lib/schema";

const provider = makeKeys("k1");
const attacker = makeKeys("k1"); // same kid, different key
const AUTH = { issuer: ISSUER, audience: AUDIENCE };
const admin = () => signJwt(provider, claims({ sub: "auth0|admin", permissions: ["woi:admin", "woi:subscriber"] }));
const subscriber = () => signJwt(provider, claims({ sub: "auth0|sub", permissions: ["woi:subscriber"] }));
const noRole = () => signJwt(provider, claims({ sub: "auth0|norole", permissions: [] }));

let S: Server;
const get = (path: string, token?: string, headers: Record<string, string> = {}) =>
  fetch(`${S.base}/${path}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } });
const post = (path: string, body: unknown, token?: string, headers: Record<string, string> = {}) =>
  fetch(`${S.base}/${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe.skipIf(!hasPhp)("server security", () => {
  beforeAll(async () => {
    S = await startServer({ allow_http: true, auth: AUTH, ingest_token_sha256: sha256(INGEST_TOKEN) }, jwks(provider));
  });
  afterAll(() => S?.stop());

  describe("public surface", () => {
    it("serves the homepage summary without sign-in, matching the TypeScript projection, with no research", async () => {
      const r = await get("public.php");
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body).toEqual(publicProjection(SnapshotSchema.parse(baseline())));
      const text = JSON.stringify(body);
      for (const k of ["research", "unverifiedClaims", "technicalIndicators", "washout", "club3030", "validation"]) expect(text).not.toContain(k);
    });
    it("sends defensive headers on API responses", async () => {
      const r = await get("public.php");
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    });
  });

  describe("authentication bypass attempts on subscriber data", () => {
    const cases: [string, () => string | undefined, number][] = [
      ["no token", () => undefined, 401],
      ["garbage token", () => "not-a-jwt-not-a-jwt-not-a-jwt", 401],
      ["alg none", () => unsignedJwt(claims({ permissions: ["woi:admin"] })), 401],
      ["HS256 signed with the public key", () => hs256WithPublicKey(provider, claims({ permissions: ["woi:admin"] })), 401],
      ["forged with an attacker key using the same kid", () => signJwt(attacker, claims({ permissions: ["woi:admin"] })), 401],
      ["unknown kid", () => signJwt(provider, claims({ permissions: ["woi:admin"] }), { kid: "other" }), 401],
      ["tampered payload", () => { const [h, , s] = subscriber().split("."); return `${h}.${Buffer.from(JSON.stringify(claims({ permissions: ["woi:admin"] }))).toString("base64url")}.${s}`; }, 401],
      ["wrong issuer", () => signJwt(provider, claims({ iss: "https://evil.example/", permissions: ["woi:admin"] })), 401],
      ["wrong audience", () => signJwt(provider, claims({ aud: "https://other.example/api", permissions: ["woi:admin"] })), 401],
      ["expired", () => signJwt(provider, claims({ exp: now() - 3600, permissions: ["woi:admin"] })), 401],
      ["not yet valid", () => signJwt(provider, claims({ nbf: now() + 3600, permissions: ["woi:admin"] })), 401],
      ["missing exp", () => { const c: Record<string, unknown> = claims({ permissions: ["woi:admin"] }); delete c.exp; return signJwt(provider, c); }, 401],
      ["missing sub", () => { const c: Record<string, unknown> = claims({ permissions: ["woi:admin"] }); delete c.sub; return signJwt(provider, c); }, 401],
      ["valid but no subscription", noRole, 403],
    ];
    for (const [name, token, status] of cases) {
      it(`${name} -> ${status}`, async () => {
        const r = await get("data.php?file=latest", token());
        expect(r.status).toBe(status);
        const text = await r.text();
        expect(text).not.toContain("research");
      });
    }
    it("rejects non-Bearer schemes and oversized headers", async () => {
      expect((await get("data.php?file=latest", undefined, { Authorization: "Basic YWRtaW46YWRtaW4=" })).status).toBe(401);
      expect((await get("data.php?file=latest", undefined, { Authorization: `Bearer ${"a".repeat(9000)}` })).status).toBe(401);
    });
    it("reports the server-verified role, not the client's claim", async () => {
      expect(await (await get("me.php", subscriber())).json()).toEqual({ role: "subscriber", subject: "auth0|sub" });
      expect(await (await get("me.php", noRole())).json()).toEqual({ role: "public", subject: "auth0|norole" });
      expect(await (await get("me.php")).json()).toEqual({ role: "public", subject: null });
    });
  });

  describe("role-based access", () => {
    it("subscriber can read research data, including the seed before anything is published", async () => {
      const r = await get("data.php?file=latest", subscriber());
      expect(r.status).toBe(200);
      expect(r.headers.get("x-woi-origin")).toBe("seed");
      expect((await r.json()).washout.score).toBeNull();
      expect((await get("data.php?file=manifest", subscriber())).status).toBe(200);
      expect((await get("data.php?file=archive&id=2026-11-20", subscriber())).status).toBe(200);
    });
    it("subscriber cannot use any admin endpoint", async () => {
      expect((await post("admin/publish.php", baseline(), subscriber())).status).toBe(403);
      expect((await post("admin/rollback.php", { id: "2026-11-20" }, subscriber())).status).toBe(403);
      expect((await get("admin/audit.php", subscriber())).status).toBe(403);
    });
    it("a user token cannot use the automation endpoint, and the machine token cannot use admin endpoints", async () => {
      expect((await post("ingest.php", baseline(), admin())).status).toBe(401);
      expect((await post("admin/publish.php", baseline(), INGEST_TOKEN)).status).toBe(401);
      expect((await get("data.php?file=latest", INGEST_TOKEN)).status).toBe(401);
    });
    it("the automation read endpoint accepts only the machine token", async () => {
      expect((await get("automation.php")).status).toBe(401);
      expect((await get("automation.php", admin())).status).toBe(401);
      const r = await get("automation.php", INGEST_TOKEN);
      expect(r.status).toBe(200);
      expect((await r.json()).latest.schemaVersion).toBe("2.0.0");
    });
    it("rejects wrong HTTP methods", async () => {
      expect((await get("ingest.php")).status).toBe(405);
      expect((await post("data.php?file=latest", {}, subscriber())).status).toBe(405);
      expect((await get("admin/publish.php", admin())).status).toBe(405);
    });
  });

  describe("malicious and malformed JSON (admin publish)", () => {
    const bad = (mutate: (s: any) => unknown) => { const s = baseline(); const out = mutate(s); return out === undefined ? s : out; };
    const cases: [string, unknown, number][] = [
      ["not JSON", "{ nope", 400],
      ["nested 200 levels deep", "[".repeat(200) + "]".repeat(200), 400],
      ["a JSON array instead of an object", [1, 2, 3], 422],
      ["unknown top-level key", bad((s) => { s.extra = 1; }), 422],
      ["unknown nested key", bad((s) => { s.watchlist[0].hidden = "x"; }), 422],
      ["javascript: URL in a source", bad((s) => { s.sources.spy_close.url = "javascript:alert(1)"; }), 422],
      ["data: URL in a source", bad((s) => { s.sources.spy_close.url = "data:text/html,<script>alert(1)</script>"; }), 422],
      ["__proto__ source key", JSON.stringify(baseline()).replace('"spy_close":', '"__proto__":'), 422],
      ["constructor as a source key", JSON.stringify(baseline()).replace('"spy_close":', '"constructor":'), 422],
      ["price sent as a string", bad((s) => { s.watchlist[0].regularSessionClose = "127.79"; }), 422],
      ["oversized text", bad((s) => { s.validation.warnings.push("x".repeat(5000)); }), 422],
      ["HTML in a status code", bad((s) => { s.snapshot.quality = "<img src=x onerror=alert(1)>"; }), 422],
      ["path traversal in snapshotId", bad((s) => { s.snapshot.snapshotId = "../../woi-config"; }), 422],
      ["fabricated washout score", bad((s) => { s.washout.score = 4; }), 422],
      ["Club 30/30 triggered without a rule", bad((s) => { s.club3030.triggered = true; }), 422],
      ["empty watchlist", bad((s) => { s.watchlist = []; }), 422],
      ["wrong schema major version", bad((s) => { s.schemaVersion = "3.0.0"; }), 422],
    ];
    for (const [name, body, status] of cases) {
      it(`${name} -> ${status}`, async () => {
        const r = await post("admin/publish.php", body, admin());
        expect(r.status).toBe(status);
      });
    }
    it("refuses a non-JSON content type and a body over 2 MB", async () => {
      expect((await post("admin/publish.php", JSON.stringify(baseline()), admin(), { "Content-Type": "text/plain" })).status).toBe(415);
      const big = baseline(); big.validation.warnings = Array.from({ length: 3000 }, () => "y".repeat(800));
      expect((await post("admin/publish.php", big, admin())).status).toBe(413);
    });
    it("nothing was written by any rejected request", () => {
      expect(existsSync(join(S.storage, "latest.json"))).toBe(false);
    });
  });

  describe("path traversal on reads", () => {
    for (const id of ["../woi-config", "..%2F..%2Fwoi-config", "%00", "archive/../../x", ".htaccess", "a".repeat(100)]) {
      it(`archive id ${JSON.stringify(id.slice(0, 20))} is refused`, async () => {
        const r = await get(`data.php?file=archive&id=${id}`, subscriber());
        expect([400, 404]).toContain(r.status);
        expect(await r.text()).not.toContain("ingest_token");
      });
    }
    it("rollback refuses a traversal id", async () => {
      expect((await post("admin/rollback.php", { id: "../latest" }, admin())).status).toBe(400);
    });
  });

  describe("publishing, idempotency, rollback and audit", () => {
    it("admin publishes; duplicate is a no-op; different content is refused without replace", async () => {
      const r = await post("admin/publish.php", baseline(), admin());
      expect(r.status).toBe(201);
      expect(await (await post("admin/publish.php", baseline(), admin())).json()).toMatchObject({ action: "duplicate" });
      const changed = baseline(); changed.validation.warnings.push("Revised");
      expect((await post("admin/publish.php", changed, admin())).status).toBe(409);
      expect((await post("admin/publish.php?replace=1", changed, admin())).status).toBe(201);
    });
    it("automation publishes a newer session; an older one is archived without moving latest back", async () => {
      const newer = baseline();
      newer.snapshot.equityTradingDate = "2026-11-23"; newer.snapshot.reportDate = "2026-11-23";
      for (const w of newer.watchlist) w.closeDate = "2026-11-23";
      const r = await post("ingest.php", newer, INGEST_TOKEN, { "X-WOI-Job": "closing_snapshot" });
      expect(r.status).toBe(201);
      const older = baseline(); older.snapshot.equityTradingDate = "2026-11-19"; older.snapshot.reportDate = "2026-11-19";
      expect((await (await post("ingest.php", older, INGEST_TOKEN)).json()).latestUpdated).toBe(false);
      expect((await (await get("data.php?file=latest", subscriber())).json()).snapshot.equityTradingDate).toBe("2026-11-23");
    });
    it("admin rollback moves latest back to a chosen archived snapshot", async () => {
      const r = await post("admin/rollback.php", { id: "2026-11-20" }, admin());
      expect(r.status).toBe(200);
      expect((await (await get("data.php?file=latest", subscriber())).json()).snapshot.equityTradingDate).toBe("2026-11-20");
    });
    it("audit log records who did what, with no tokens, no raw IPs, no emails", async () => {
      const r = await get("admin/audit.php", admin());
      const { entries } = await r.json();
      const actions = entries.map((e: { action: string; result: string }) => `${e.action}:${e.result}`);
      expect(actions).toEqual(expect.arrayContaining(["snapshot.publish:added", "snapshot.publish:duplicate", "snapshot.publish:conflict", "snapshot.publish:replaced", "snapshot.rollback:success"]));
      const raw = readFileSync(join(S.storage, "private/audit.jsonl"), "utf8") + readFileSync(join(S.storage, "status.json"), "utf8");
      expect(raw).toContain("auth0|admin");
      expect(raw).not.toContain(INGEST_TOKEN);
      expect(raw).not.toContain("Bearer");
      expect(raw).not.toContain("eyJ"); // no JWTs
      expect(raw).not.toContain("127.0.0.1");
    });
  });

  describe("rate limiting", () => {
    it("locks out repeated bad automation tokens", { timeout: 30_000 }, async () => {
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) codes.push((await post("ingest.php", {}, `wrong-${"z".repeat(40)}`)).status);
      const firstLock = codes.indexOf(429);
      expect(firstLock).toBeGreaterThan(0); // locked within 11 bad attempts (earlier tests used some)
      expect(firstLock).toBeLessThanOrEqual(10);
      expect(codes.slice(0, firstLock).every((c) => c === 401)).toBe(true);
      expect(codes.slice(firstLock).every((c) => c === 429)).toBe(true);
    });
    it("limits bursts on the public endpoint and says when to retry", { timeout: 30_000 }, async () => {
      let last: Response | null = null;
      for (let i = 0; i < 130; i++) { last = await get("public.php"); if (last.status === 429) break; }
      expect(last!.status).toBe(429);
      expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    });
  });
});

describe.skipIf(!hasPhp)("secure defaults", () => {
  let U: Server, H: Server, B: Server;
  beforeAll(async () => {
    U = await startServer({ allow_http: true });                                  // nothing configured
    H = await startServer({ auth: AUTH }, jwks(provider));                          // HTTPS enforced (no allow_http)
    const file = join(mkdtempSync(join(tmpdir(), "woi-broken-")), "not-a-folder");
    writeFileSync(file, "x");
    B = await startServer({ allow_http: true, auth: AUTH, storage_dir: file }, jwks(provider)); // storage broken
  });
  afterAll(() => { U?.stop(); H?.stop(); B?.stop(); });

  it("denies protected endpoints when sign-in is not configured, but keeps the public page", async () => {
    expect((await fetch(`${U.base}/data.php?file=latest`, { headers: { Authorization: `Bearer ${subscriber()}` } })).status).toBe(503);
    expect((await fetch(`${U.base}/admin/audit.php`, { headers: { Authorization: `Bearer ${admin()}` } })).status).toBe(503);
    expect((await fetch(`${U.base}/ingest.php`, { method: "POST", headers: { Authorization: `Bearer ${INGEST_TOKEN}`, "Content-Type": "application/json" }, body: "{}" })).status).toBe(503);
    expect((await fetch(`${U.base}/public.php`)).status).toBe(200);
  });
  it("refuses plain HTTP unless explicitly allowed", async () => {
    const r = await fetch(`${H.base}/public.php`);
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("HTTPS required");
  });
  it("hides internal errors: generic message and a reference id only", async () => {
    const r = await fetch(`${B.base}/admin/publish.php`, { method: "POST", headers: { Authorization: `Bearer ${admin()}`, "Content-Type": "application/json" }, body: JSON.stringify(baseline()) });
    expect(r.status).toBe(500);
    const text = await r.text();
    const body = JSON.parse(text);
    expect(body.error).toBe("Internal error");
    expect(body.ref).toMatch(/^[a-f0-9]{12}$/);
    for (const leak of ["/tmp", ".php", "Exception", "Stack", "#0", "not-a-folder", "storage"]) expect(text).not.toContain(leak);
  });
});
