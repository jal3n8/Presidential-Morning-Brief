/**
 * Publish snapshot files into the bundled data folder (public/data).
 *
 *   npm run ingest -- path/to/file.json [--replace]
 *   npm run ingest -- --inbox            (process every file in ./inbox)
 *
 * Same rules as the server endpoint: validate, archive first, update the
 * index, move latest.json only forward in time, never overwrite a different
 * snapshot with the same id unless --replace. Used by the GitHub workflow
 * when a JSON file is uploaded to woi-equity/inbox.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { planIngest, canonicalJson, type ExistingState } from "../src/lib/ingestCore";
import { ArchiveManifestSchema, PipelineStatusSchema, type PipelineStatus, type RunRecord } from "../src/lib/schema";
import { validateSnapshot } from "../src/lib/validate";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const DATA = process.env.WOI_DATA_DIR ? resolve(process.env.WOI_DATA_DIR) : join(ROOT, "public/data");
const INBOX = process.env.WOI_INBOX_DIR ? resolve(process.env.WOI_INBOX_DIR) : join(ROOT, "inbox");

function writeAtomic(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
const readJson = (p: string): unknown => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);

function loadState(): ExistingState {
  const m = ArchiveManifestSchema.safeParse(readJson(join(DATA, "archive/index.json")));
  const manifest = m.success ? m.data : { schemaVersion: 1 as const, updatedAtUtc: null, snapshots: [] };
  const hashes: Record<string, string | null> = {};
  for (const e of manifest.snapshots) {
    // Hash archived files that predate hashing so duplicates are still caught.
    const file = join(DATA, e.path);
    hashes[e.id] = e.sha256 ?? (existsSync(file) ? sha(readJson(file)) : null);
  }
  const latestV = validateSnapshot(readJson(join(DATA, "latest.json")));
  return { manifest, hashes, latest: latestV.ok ? latestV.snapshot : null };
}
const sha = (v: unknown) => createHash("sha256").update(canonicalJson(v)).digest("hex");

function recordRun(run: RunRecord) {
  const p = join(DATA, "status.json");
  const parsed = PipelineStatusSchema.safeParse(readJson(p));
  const st: PipelineStatus = parsed.success ? parsed.data : {
    schemaVersion: 1, automationEnabled: false, configuredConnections: {}, lastRun: null, lastSuccessUtc: null, consecutiveFailures: 0, recentRuns: [],
  };
  st.lastRun = run;
  if (run.result === "success") { st.lastSuccessUtc = run.finishedAtUtc; st.consecutiveFailures = 0; }
  if (run.result === "failed") st.consecutiveFailures += 1;
  st.recentRuns = [...st.recentRuns, run].slice(-50);
  writeAtomic(p, JSON.stringify(st, null, 2) + "\n");
}

export type IngestOutcome = { file: string; action: string; id: string | null; ok: boolean; message: string };

export function ingestFile(file: string, replace = false, job = "manual_upload"): IngestOutcome {
  const startedAtUtc = new Date().toISOString();
  const name = basename(file);
  const finish = (result: RunRecord["result"], reason: string | null, id: string | null) =>
    recordRun({ job, startedAtUtc, finishedAtUtc: new Date().toISOString(), result, reason, snapshotId: id, steps: [] });

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    finish("failed", `${name}: not valid JSON`, null);
    return { file, action: "reject", id: null, ok: false, message: "Not valid JSON" };
  }
  const plan = planIngest(raw, sha(raw), loadState(), { replace, nowUtc: startedAtUtc });
  switch (plan.action) {
    case "reject": {
      const detail = plan.issues.filter((i) => i.level === "error").slice(0, 8).map((i) => `${i.path}: ${i.message}`).join("; ");
      finish("failed", `${name}: ${plan.reason} ${detail}`.trim(), null);
      return { file, action: "reject", id: null, ok: false, message: `${plan.reason}\n${detail}` };
    }
    case "conflict":
      finish("failed", `${name}: ${plan.reason}`, plan.id);
      return { file, action: "conflict", id: plan.id, ok: false, message: plan.reason };
    case "duplicate":
      finish("skipped", `${name}: identical to archived snapshot`, plan.id);
      return { file, action: "duplicate", id: plan.id, ok: true, message: "Identical snapshot already archived" };
    default: {
      const archiveFile = join(DATA, plan.archivePath);
      if (plan.action === "replace" && existsSync(archiveFile)) {
        mkdirSync(join(DATA, "archive/revisions"), { recursive: true });
        copyFileSync(archiveFile, join(DATA, "archive/revisions", `${plan.id}.${startedAtUtc.replace(/[:.]/g, "")}.json`));
      }
      const text = JSON.stringify(raw, null, 2) + "\n"; // the file as received, nulls and all
      writeAtomic(archiveFile, text); // 1. archive first
      writeAtomic(join(DATA, "archive/index.json"), JSON.stringify(plan.manifest, null, 2) + "\n"); // 2. index
      if (plan.updateLatest) writeAtomic(join(DATA, "latest.json"), text); // 3. latest, forward only
      finish("success", plan.updateLatest ? null : "Archived as history; older than current latest", plan.id);
      return { file, action: plan.action, id: plan.id, ok: true, message: plan.updateLatest ? "Archived and set as latest" : "Archived (older than latest)" };
    }
  }
}

function processInbox(): IngestOutcome[] {
  if (!existsSync(INBOX)) return [];
  const files = readdirSync(INBOX).filter((f) => f.toLowerCase().endsWith(".json")).sort();
  const out: IngestOutcome[] = [];
  for (const f of files) {
    const full = join(INBOX, f);
    const r = ingestFile(full, /\.replace\.json$/i.test(f));
    out.push(r);
    if (r.ok) rmSync(full); // it now lives in the archive
    else {
      mkdirSync(join(INBOX, "rejected"), { recursive: true });
      renameSync(full, join(INBOX, "rejected", f));
      writeFileSync(join(INBOX, "rejected", `${f}.reason.txt`), r.message + "\n");
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  const results = args.includes("--inbox") ? processInbox() : args.filter((a) => !a.startsWith("--")).map((f) => ingestFile(resolve(f), args.includes("--replace")));
  if (!results.length) console.log("Nothing to ingest.");
  for (const r of results) console.log(`${r.ok ? "OK  " : "FAIL"} ${basename(r.file)} -> ${r.action}${r.id ? ` (${r.id})` : ""}: ${r.message}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
