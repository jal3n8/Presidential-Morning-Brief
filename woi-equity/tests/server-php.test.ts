/**
 * Exercises public/api/ingest.php and data.php through PHP's built-in server.
 * Skipped automatically when PHP is not installed.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseline } from "./helpers";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const PORT = 8765 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}/api`;
const TOKEN = "t".repeat(40);
let proc: ChildProcess | null = null;
let storage = "";

describe.skipIf(!hasPhp)("PHP ingest endpoint", () => {
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "woi-php-"));
    storage = join(dir, "woi-storage");
    const cfg = join(dir, "woi-config.php");
    writeFileSync(cfg, `<?php return ['ingest_token' => '${TOKEN}', 'storage_dir' => '${storage}', 'allow_http' => true];`);
    proc = spawn("php", ["-S", `127.0.0.1:${PORT}`, "-t", join(__dirname, "../public")], { env: { ...process.env, WOI_CONFIG_FILE: cfg }, stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      try { await fetch(`${BASE}/data.php?file=latest`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
  });
  afterAll(() => { proc?.kill(); });

  const post = (body: unknown, token = TOKEN, query = "") =>
    fetch(`${BASE}/ingest.php${query}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-WOI-Job": "manual" }, body: typeof body === "string" ? body : JSON.stringify(body) });

  it("answers 404 before anything is ingested, so the site falls back to bundled data", async () => {
    expect((await fetch(`${BASE}/data.php?file=latest`)).status).toBe(404);
  });
  it("rejects a missing or wrong token", async () => {
    expect((await post(baseline(), "wrong-token-wrong-token-wrong-token")).status).toBe(401);
    expect((await fetch(`${BASE}/ingest.php`, { method: "POST" })).status).toBe(401);
  });
  it("rejects GET and invalid JSON", async () => {
    expect((await fetch(`${BASE}/ingest.php`)).status).toBe(405);
    expect((await post("{ nope")).status).toBe(400);
  });
  it("rejects a structurally invalid snapshot with the reasons", async () => {
    const bad = baseline(); bad.watchlist[0].regularSessionClose = "high";
    const r = await post(bad);
    expect(r.status).toBe(422);
    expect((await r.json()).issues[0].path).toBe("watchlist.0.regularSessionClose");
  });
  it("refuses to store a blocked signal with a value", async () => {
    const bad = baseline(); bad.club3030.triggered = true;
    expect((await post(bad)).status).toBe(422);
  });
  it("adds the baseline, then serves it, the index and the archived copy", async () => {
    const r = await post(baseline());
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ action: "added", id: "2026-11-20", latestUpdated: true });
    const latest = await (await fetch(`${BASE}/data.php?file=latest`)).json();
    expect(latest.washout.score).toBeNull();
    expect(latest.club3030.requiredRuleDefinition).toBeNull();
    const m = await (await fetch(`${BASE}/data.php?file=manifest`)).json();
    expect(m.snapshots.map((e: { id: string }) => e.id)).toEqual(["2026-11-20"]);
    expect((await fetch(`${BASE}/data.php?file=archive&id=2026-11-20`)).status).toBe(200);
    expect((await fetch(`${BASE}/data.php?file=archive&id=../woi-config`)).status).toBe(400);
  });
  it("is idempotent for duplicates and refuses silent overwrites", async () => {
    expect(await (await post(baseline())).json()).toMatchObject({ action: "duplicate" });
    const changed = baseline(); changed.validation.warnings.push("Revised");
    expect((await post(changed)).status).toBe(409);
    expect((await post(changed, TOKEN, "?replace=1")).status).toBe(201);
  });
  it("archives an older session without moving latest backwards", async () => {
    const newer = baseline();
    newer.snapshot.equityTradingDate = "2026-11-23"; newer.snapshot.reportDate = "2026-11-23";
    for (const w of newer.watchlist) w.closeDate = "2026-11-23";
    expect((await (await post(newer)).json()).latestUpdated).toBe(true);
    const older = baseline(); older.snapshot.equityTradingDate = "2026-11-19"; older.snapshot.reportDate = "2026-11-19";
    expect((await (await post(older)).json()).latestUpdated).toBe(false);
    const latest = await (await fetch(`${BASE}/data.php?file=latest`)).json();
    expect(latest.snapshot.equityTradingDate).toBe("2026-11-23");
    const status = JSON.parse(readFileSync(join(storage, "status.json"), "utf8"));
    expect(status.lastRun.result).toBe("success");
    expect(existsSync(join(storage, "private/ingest-log.jsonl"))).toBe(true);
  });
});
