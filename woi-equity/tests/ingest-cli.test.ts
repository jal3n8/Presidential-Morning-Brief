import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseline } from "./helpers";

const dir = mkdtempSync(join(tmpdir(), "woi-ingest-"));
process.env.WOI_DATA_DIR = join(dir, "data");
process.env.WOI_INBOX_DIR = join(dir, "inbox");
let ingestFile: typeof import("../scripts/ingest").ingestFile;

beforeAll(async () => {
  ({ ingestFile } = await import("../scripts/ingest"));
});

const write = (name: string, v: unknown) => { const p = join(dir, name); writeFileSync(p, typeof v === "string" ? v : JSON.stringify(v)); return p; };
const read = (p: string) => JSON.parse(readFileSync(join(dir, "data", p), "utf8"));

describe("command-line ingester (GitHub inbox path)", () => {
  it("archives first, then sets latest, and records the run", () => {
    const r = ingestFile(write("a.json", baseline()));
    expect(r).toMatchObject({ ok: true, action: "add", id: "2026-11-20" });
    expect(read("archive/2026-11-20.json").washout.score).toBeNull();
    expect(read("latest.json").snapshot.equityTradingDate).toBe("2026-11-20");
    expect(read("archive/index.json").snapshots).toHaveLength(1);
    expect(read("status.json").lastRun.result).toBe("success");
  });
  it("skips an identical re-upload", () => {
    expect(ingestFile(write("b.json", baseline())).action).toBe("duplicate");
    expect(read("status.json").lastRun.result).toBe("skipped");
  });
  it("keeps the last good latest.json when a bad file arrives", () => {
    const before = readFileSync(join(dir, "data/latest.json"), "utf8");
    const r = ingestFile(write("bad.json", "{ not json"));
    expect(r.ok).toBe(false);
    const r2 = ingestFile(write("bad2.json", { ...baseline(), watchlist: [] }));
    expect(r2.ok).toBe(false);
    expect(readFileSync(join(dir, "data/latest.json"), "utf8")).toBe(before);
    expect(read("status.json").consecutiveFailures).toBe(2);
  });
  it("replaces only on request and keeps the old version as a revision", () => {
    const changed = baseline();
    changed.validation.warnings.push("Revised");
    expect(ingestFile(write("c.json", changed)).action).toBe("conflict");
    expect(ingestFile(write("c.json", changed), true).action).toBe("replace");
    expect(readdirSync(join(dir, "data/archive/revisions"))).toHaveLength(1);
    expect(existsSync(join(dir, "data/archive/2026-11-20.json"))).toBe(true);
  });
});
