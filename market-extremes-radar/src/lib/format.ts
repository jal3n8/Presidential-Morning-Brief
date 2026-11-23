import { weekdayOf } from "./calendar";
import type { Num } from "./indicators";
import type { Series, VerificationLevel } from "./types";

const DASH = "—";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtNum(x: Num | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return DASH;
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPct(x: Num | undefined, digits = 1, signed = true): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return DASH;
  const v = (x * 100).toFixed(digits);
  return `${signed && x > 0 ? "+" : ""}${v}%`;
}

export function fmtSigned(x: Num | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return DASH;
  return `${x > 0 ? "+" : ""}${x.toFixed(digits)}`;
}

/** Market date "2026-11-20" -> "Fri 20 Nov 2026". Pure string math: never shifted by the viewer's time zone. */
export function fmtMarketDate(d: string | null | undefined): string {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return DASH;
  const [y, m, day] = d.split("-").map(Number);
  return `${WEEKDAYS[weekdayOf(d)]} ${day} ${MONTHS[m - 1]} ${y}`;
}

/** ISO instant -> "2026-11-23 01:26 UTC" (always UTC, so every viewer sees the same text). */
export function fmtUtc(isoInstant: string | null | undefined): string {
  if (!isoInstant) return DASH;
  const t = new Date(isoInstant);
  if (Number.isNaN(t.getTime())) return DASH;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())} UTC`;
}

export const VERIFICATION_TEXT: Record<VerificationLevel, { short: string; tone: "gain" | "gold" | "risk" | "muted" }> = {
  cross_checked: { short: "Cross-checked", tone: "gain" },
  single_source: { short: "Single source", tone: "gold" },
  cross_check_failed: { short: "Cross-check failed", tone: "risk" },
  synthetic: { short: "Synthetic demo", tone: "risk" },
  user_imported: { short: "User import (unverified)", tone: "gold" },
};

/** One-line provenance used under every number block. */
export function provenanceLine(s: Pick<Series, "source" | "verification" | "dates">): string {
  const last = s.dates[s.dates.length - 1];
  return [
    s.source.provider,
    VERIFICATION_TEXT[s.verification.level].short,
    `market date ${fmtMarketDate(last)} close (New York)`,
    `retrieved ${fmtUtc(s.source.retrievedAt)}`,
  ].join(" · ");
}

export const assetClassLabel = (a: Series["assetClass"]) =>
  a === "index" ? "Index · not tradable" : a === "volatility_index" ? "Volatility index · not tradable" : a === "etf" ? "ETF · tradable" : "Stock · tradable";
