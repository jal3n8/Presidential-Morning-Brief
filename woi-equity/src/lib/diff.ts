import type { Snapshot } from "./schema";

export type Change = {
  path: string;
  section: string;
  kind: "changed" | "added" | "removed";
  before: unknown;
  after: unknown;
  /** after - before, when both are numbers. */
  delta: number | null;
  /** percentage change, when both are non-zero numbers. */
  deltaPct: number | null;
};

/** Paths whose churn is bookkeeping, not market information. */
const IGNORE = [/^sources\.[^.]+\.retrievedDate$/, /^snapshot\.reportDate$/, /^snapshot\.lastSuccessfulAutomatedRunUtc$/];

const SECTION_NAMES: Record<string, string> = {
  snapshot: "Snapshot",
  marketRegime: "Three Horsemen",
  washout: "Washout",
  club3030: "Club 30/30",
  macroAndConfirmation: "Macro",
  watchlist: "Watchlist",
  validation: "Validation",
  sources: "Sources",
  automationPlan: "Automation",
};

/**
 * Flatten to dotted paths. Arrays of objects with a `symbol` are keyed by the
 * symbol (watchlist.NVDA.regularSessionClose) so reordering is not a change.
 */
export function flatten(value: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (Array.isArray(value)) {
    const keyed = value.length > 0 && value.every((v) => v && typeof v === "object" && typeof (v as { symbol?: unknown }).symbol === "string");
    if (keyed) value.forEach((v) => flatten(v, `${prefix}${prefix ? "." : ""}${(v as { symbol: string }).symbol}`, out));
    else if (value.every((v) => v === null || typeof v !== "object")) out[prefix] = JSON.stringify(value);
    else value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return out;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) out[prefix] = "{}";
    for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  out[prefix] = value;
  return out;
}

export function diffSnapshots(before: Snapshot, after: Snapshot): Change[] {
  const a = flatten(before);
  const b = flatten(after);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changes: Change[] = [];
  for (const path of [...keys].sort()) {
    if (IGNORE.some((r) => r.test(path))) continue;
    const inA = path in a, inB = path in b;
    const va = a[path], vb = b[path];
    if (inA && inB && Object.is(va, vb)) continue;
    const kind = !inA ? "added" : !inB ? "removed" : "changed";
    const delta = typeof va === "number" && typeof vb === "number" ? vb - va : null;
    const deltaPct = delta !== null && va !== 0 ? (delta / Math.abs(va as number)) * 100 : null;
    changes.push({ path, section: SECTION_NAMES[path.split(/[.[]/)[0]] ?? "Other", kind, before: inA ? va : undefined, after: inB ? vb : undefined, delta, deltaPct });
  }
  return changes;
}

/** Changes worth surfacing on the command center: values, labels and nulls flipping. */
export function importantChanges(changes: Change[]): Change[] {
  const keyFields = /(close|Close|Usd|Pct|rsi14|label|vixClose|score|triggered|Yield|newHighMinusNewLow|status|quality)$/;
  return changes.filter((c) => c.section !== "Sources" && c.section !== "Snapshot" && keyFields.test(c.path)).slice(0, 12);
}
