import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { planIngest, canonicalJson, type ExistingState } from "../src/lib/ingestCore";
import { compareSnapshots, newestSnapshot, snapshotIdOf, sortEntries } from "../src/lib/snapshotOrder";
import { validateSnapshot } from "../src/lib/validate";
import { mergeEntries } from "../src/lib/dataClient";
import { baseline } from "./helpers";

const sha = (v: unknown) => createHash("sha256").update(canonicalJson(v)).digest("hex");
const load = (raw: unknown) => { const v = validateSnapshot(raw); if (!v.ok) throw new Error(JSON.stringify(v.issues)); return v.snapshot; };
const NOW = "2026-11-24T21:20:00Z";
const empty = (): ExistingState => ({ manifest: { schemaVersion: 1, updatedAtUtc: null, snapshots: [] }, hashes: {}, latest: null });

function nextSession(date: string, session = "regular_close") {
  const raw = baseline();
  raw.snapshot.equityTradingDate = date;
  raw.snapshot.equitySession = session;
  raw.snapshot.reportDate = date;
  for (const w of raw.watchlist) w.closeDate = date;
  return raw;
}

describe("chronological ordering", () => {
  it("orders by trading date, then session (opening before close)", () => {
    const close20 = load(baseline());
    const open23 = load({ ...nextSession("2026-11-23", "opening") });
    const close23 = load(nextSession("2026-11-23"));
    expect(compareSnapshots(close20, open23)).toBeLessThan(0);
    expect(compareSnapshots(open23, close23)).toBeLessThan(0);
    expect(newestSnapshot([{ snapshot: close23 }, { snapshot: close20 }, { snapshot: open23 }])!.snapshot).toBe(close23);
    expect(snapshotIdOf(open23)).toBe("2026-11-23_opening");
    expect(snapshotIdOf(close20)).toBe("2026-11-20");
  });
  it("sorts archive entries and lets the higher-priority source win on duplicate ids", () => {
    const e = (id: string, d: string, s: string, source: string) => ({ id, path: `archive/${id}.json`, equityTradingDate: d, equitySession: s, reportDate: d, quality: "q", archivedAtUtc: null, source, sourceLabel: source });
    const merged = mergeEntries([[e("2026-11-23", "2026-11-23", "regular_close", "live")], [e("2026-11-23", "2026-11-23", "regular_close", "bundled"), e("2026-11-20", "2026-11-20", "regular_close", "bundled")]]);
    expect(merged.map((x) => `${x.id}@${x.source}`)).toEqual(["2026-11-20@bundled", "2026-11-23@live"]);
    expect(sortEntries([merged[1], merged[0]])[0].id).toBe("2026-11-20");
  });
});

describe("ingestion planning", () => {
  it("adds a new snapshot and points latest at it", () => {
    const raw = baseline();
    const p = planIngest(raw, sha(raw), empty(), { nowUtc: NOW });
    expect(p.action).toBe("add");
    if (p.action !== "add") return;
    expect(p.updateLatest).toBe(true);
    expect(p.archivePath).toBe("archive/2026-11-20.json");
  });

  it("treats the same content as a duplicate, even reformatted", () => {
    const raw = baseline();
    const p1 = planIngest(raw, sha(raw), empty(), { nowUtc: NOW });
    if (p1.action !== "add") throw new Error();
    const state: ExistingState = { manifest: p1.manifest, hashes: { [p1.id]: sha(raw) }, latest: p1.snapshot };
    const reordered = Object.fromEntries(Object.entries(raw).reverse()); // same content, different key order
    expect(planIngest(reordered, sha(reordered), state, { nowUtc: NOW }).action).toBe("duplicate");
  });

  it("refuses different content under an existing id unless replace is requested", () => {
    const raw = baseline();
    const p1 = planIngest(raw, sha(raw), empty(), { nowUtc: NOW });
    if (p1.action !== "add") throw new Error();
    const state: ExistingState = { manifest: p1.manifest, hashes: { [p1.id]: sha(raw) }, latest: p1.snapshot };
    const changed = baseline();
    changed.validation.warnings.push("Corrected later");
    expect(planIngest(changed, sha(changed), state, { nowUtc: NOW }).action).toBe("conflict");
    expect(planIngest(changed, sha(changed), state, { nowUtc: NOW, replace: true }).action).toBe("replace");
  });

  it("archives an older session without moving latest backwards", () => {
    const newer = nextSession("2026-11-24");
    const p1 = planIngest(newer, sha(newer), empty(), { nowUtc: NOW });
    if (p1.action !== "add") throw new Error();
    const older = baseline();
    const p2 = planIngest(older, sha(older), { manifest: p1.manifest, hashes: { [p1.id]: sha(newer) }, latest: p1.snapshot }, { nowUtc: NOW });
    expect(p2.action).toBe("add");
    if (p2.action !== "add") return;
    expect(p2.updateLatest).toBe(false);
    expect(p2.manifest.snapshots.map((e) => e.id)).toEqual(["2026-11-20", "2026-11-24"]);
  });

  it("rejects invalid files and files that publish an undefined signal", () => {
    const bad = baseline(); bad.watchlist = "none";
    expect(planIngest(bad, sha(bad), empty(), { nowUtc: NOW }).action).toBe("reject");
    const signal = baseline(); signal.club3030.triggered = true;
    expect(planIngest(signal, sha(signal), empty(), { nowUtc: NOW }).action).toBe("reject");
    const score = baseline(); score.washout.score = 4;
    expect(planIngest(score, sha(score), empty(), { nowUtc: NOW }).action).toBe("reject");
  });
});
