import { z } from "zod";
import { toCsv } from "./csv";

/** Paper-trading / research notes only. There is no brokerage connection of any kind. */
export const JournalEntrySchema = z.object({
  id: z.string().max(64),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
  researchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symbol: z.string().max(12),
  status: z.enum(["idea", "paper_open", "paper_closed", "archived"]),
  thesis: z.string().max(5000),
  hypothesis: z.string().max(5000),
  hypotheticalEntry: z.number().positive().nullable(),
  hypotheticalExit: z.number().positive().nullable(),
  direction: z.enum(["long", "short"]),
  invalidation: z.string().max(5000),
  riskAmount: z.number().nonnegative().nullable(),
  hypotheticalResult: z.string().max(500),
  lessons: z.string().max(5000),
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;
export const JournalFileSchema = z.object({
  app: z.literal("woi-market-extremes-radar"),
  kind: z.literal("journal"),
  version: z.literal(1),
  exportedAt: z.string(),
  entries: z.array(JournalEntrySchema).max(5000),
});

export function newEntry(today: string, now: string): JournalEntry {
  return {
    id: `j_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    researchDate: today,
    symbol: "",
    status: "idea",
    thesis: "",
    hypothesis: "",
    hypotheticalEntry: null,
    hypotheticalExit: null,
    direction: "long",
    invalidation: "",
    riskAmount: null,
    hypotheticalResult: "",
    lessons: "",
  };
}

/** Hypothetical % move from entry to exit in the stated direction (null when incomplete). */
export function hypotheticalReturn(e: Pick<JournalEntry, "hypotheticalEntry" | "hypotheticalExit" | "direction">): number | null {
  if (e.hypotheticalEntry === null || e.hypotheticalExit === null) return null;
  const r = e.hypotheticalExit / e.hypotheticalEntry - 1;
  return e.direction === "long" ? r : -r;
}

export function journalToJson(entries: JournalEntry[], exportedAt: string): string {
  return JSON.stringify({ app: "woi-market-extremes-radar", kind: "journal", version: 1, exportedAt, entries }, null, 2);
}

export function journalToCsv(entries: JournalEntry[]): string {
  const rows = entries.map((e) => ({ ...e, hypotheticalReturnPct: (() => { const r = hypotheticalReturn(e); return r === null ? null : Math.round(r * 10000) / 100; })() }));
  return toCsv(rows, [
    "researchDate", "symbol", "status", "direction", "thesis", "hypothesis", "hypotheticalEntry", "hypotheticalExit",
    "hypotheticalReturnPct", "invalidation", "riskAmount", "hypotheticalResult", "lessons", "createdAt", "updatedAt", "id",
  ]);
}

export function parseJournalJson(text: string): { ok: true; entries: JournalEntry[] } | { ok: false; error: string } {
  if (text.length > 5 * 1024 * 1024) return { ok: false, error: "File larger than 5 MB." };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON." };
  }
  const r = JournalFileSchema.safeParse(json);
  if (!r.success) return { ok: false, error: `Not a WOI journal export: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}` };
  return { ok: true, entries: r.data.entries };
}
