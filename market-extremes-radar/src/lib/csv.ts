import type { AssetClass, SeriesDoc } from "./types";
import { SYMBOL_RE } from "./types";

export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_CSV_ROWS = 60000;
const MISSING = new Set(["", ".", "null", "nan", "n/a", "na", "-"]);

/** RFC-4180 style parser (quotes, escaped quotes, CRLF). Returns raw strings; nothing is evaluated. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

function normaliseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/.exec(t);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(t))) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

type Cell = { kind: "missing" } | { kind: "value"; v: number } | { kind: "bad"; reason: string };

function parseNumber(s: string): Cell {
  const t = s.trim();
  if (MISSING.has(t.toLowerCase())) return { kind: "missing" };
  if (/^[=+@]/.test(t) || /^-[^0-9.]/.test(t)) return { kind: "bad", reason: `looks like a spreadsheet formula (${t.slice(0, 20)})` };
  const cleaned = t.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(cleaned)) return { kind: "bad", reason: `not a number (${t.slice(0, 20)})` };
  const v = Number(cleaned);
  if (!Number.isFinite(v)) return { kind: "bad", reason: "not finite" };
  if (v <= 0) return { kind: "bad", reason: `non-positive price (${t.slice(0, 20)})` };
  return { kind: "value", v };
}

export interface ImportOptions {
  symbol: string;
  name?: string;
  assetClass: AssetClass;
  /** today's date (YYYY-MM-DD); rows after it are rejected */
  today: string;
  importedAt: string;
  fileName?: string;
}

export type ImportResult =
  | { ok: true; doc: SeriesDoc; report: { rows: number; dropped: string[]; warnings: string[]; dateColumn: string; closeColumn: string; adjColumn: string | null } }
  | { ok: false; errors: string[] };

/**
 * Validate a personally obtained / licensed CSV and convert it into a series document.
 * Accepted layouts: Yahoo-style (Date, Open, High, Low, Close, Adj Close, Volume),
 * FRED (observation_date, SERIES), or any file with a Date column and a Close column.
 */
export function importPriceCsv(text: string, opts: ImportOptions): ImportResult {
  const errors: string[] = [];
  const symbol = opts.symbol.trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) errors.push(`Symbol "${opts.symbol}" is not valid (letters, digits, . = - and an optional leading ^; max 12).`);
  if (text.length > MAX_CSV_BYTES) errors.push("File is larger than 10 MB.");
  if (text.includes("\u0000")) errors.push("File contains binary data; expected a text CSV.");
  if (errors.length) return { ok: false, errors };

  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (rows.length < 3) return { ok: false, errors: ["Need a header row and at least 2 data rows."] };
  if (rows.length - 1 > MAX_CSV_ROWS) return { ok: false, errors: [`Too many rows (max ${MAX_CSV_ROWS}).`] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const dateIdx = header.findIndex((h) => ["date", "observation_date", "datetime", "time"].includes(h));
  if (dateIdx < 0) return { ok: false, errors: ['No date column found (expected "Date" or "observation_date").'] };
  let closeIdx = header.findIndex((h) => h === "close" || h === "close/last" || h === "price");
  const adjIdx = header.findIndex((h) => h === "adj close" || h === "adj_close" || h === "adjclose" || h === "adjusted close");
  if (closeIdx < 0 && header.length === 2) closeIdx = dateIdx === 0 ? 1 : 0; // FRED layout
  if (closeIdx < 0) closeIdx = adjIdx;
  if (closeIdx < 0) return { ok: false, errors: ['No close column found (expected "Close", "Adj Close" or a 2-column FRED file).'] };

  const dropped: string[] = [];
  const warnings: string[] = [];
  const out: [string, number, number][] = [];
  const seen = new Set<string>();
  for (let r = 1; r < rows.length; r++) {
    const line = rows[r];
    const d = normaliseDate(line[dateIdx] ?? "");
    if (!d) {
      errors.push(`Row ${r + 1}: unreadable date "${(line[dateIdx] ?? "").slice(0, 20)}".`);
      continue;
    }
    if (d > opts.today) {
      errors.push(`Row ${r + 1}: date ${d} is in the future.`);
      continue;
    }
    if (seen.has(d)) {
      errors.push(`Row ${r + 1}: duplicate date ${d}.`);
      continue;
    }
    const c = parseNumber(line[closeIdx] ?? "");
    if (c.kind === "missing") {
      dropped.push(`${d}: missing close`);
      continue;
    }
    if (c.kind === "bad") {
      errors.push(`Row ${r + 1} (${d}): ${c.reason}.`);
      continue;
    }
    let adj = c.v;
    if (adjIdx >= 0 && adjIdx !== closeIdx) {
      const a = parseNumber(line[adjIdx] ?? "");
      if (a.kind === "value") adj = a.v;
      else if (a.kind === "bad") {
        errors.push(`Row ${r + 1} (${d}): adjusted close ${a.reason}.`);
        continue;
      }
    }
    seen.add(d);
    out.push([d, c.v, adj]);
    if (errors.length > 25) break;
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 25) };
  if (out.length < 2) return { ok: false, errors: ["Fewer than 2 valid price rows after removing missing values."] };

  const sorted = out.every((r, i) => i === 0 || out[i - 1][0] < r[0]);
  if (!sorted) {
    out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    warnings.push("Rows were not in date order; they have been sorted oldest to newest.");
  }
  const weekend = out.filter(([d]) => {
    const w = new Date(`${d}T12:00:00Z`).getUTCDay();
    return w === 0 || w === 6;
  }).length;
  if (weekend) warnings.push(`${weekend} rows fall on a weekend - check the file is daily exchange data.`);
  for (let i = 1; i < out.length; i++) {
    const mv = out[i][1] / out[i - 1][1] - 1;
    if (Math.abs(mv) > 0.25 && opts.assetClass !== "volatility_index") {
      warnings.push(`${out[i][0]}: one-day move of ${(mv * 100).toFixed(1)}% - check for an unadjusted split or bad tick.`);
      if (warnings.length > 10) break;
    }
  }
  if (dropped.length) warnings.push(`${dropped.length} rows with missing values were skipped (not filled).`);

  const doc: SeriesDoc = {
    schemaVersion: 1,
    symbol,
    name: (opts.name?.trim() || symbol).slice(0, 120),
    assetClass: opts.assetClass,
    tradable: opts.assetClass === "etf" || opts.assetClass === "stock",
    currency: "USD",
    fields: ["date", "close", "adjClose"],
    priceNotes: adjIdx >= 0 ? "close and adjusted close from the imported file." : "Imported file had no adjusted close; adjClose = close.",
    source: {
      provider: `User CSV import${opts.fileName ? ` (${opts.fileName.slice(0, 80)})` : ""}`,
      url: "local file",
      retrievedAt: opts.importedAt,
      license: "Supplied by the user. The user is responsible for the licence of this data.",
      method: "In-browser CSV import with validation (src/lib/csv.ts)",
      marketTimezone: "America/New_York",
    },
    verification: { level: "user_imported", detail: "Imported by the user; not cross-checked by WOI.", crossCheck: null },
    rows: out,
  };
  return { ok: true, doc, report: { rows: out.length, dropped, warnings, dateColumn: rows[0][dateIdx], closeColumn: rows[0][closeIdx], adjColumn: adjIdx >= 0 ? rows[0][adjIdx] : null } };
}

/** Escape one CSV cell. Text that a spreadsheet would run as a formula is neutralised. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T extends object>(rows: readonly T[], columns: readonly (keyof T & string)[]): string {
  const lines = [columns.join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}
