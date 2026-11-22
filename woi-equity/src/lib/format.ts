export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function fmtNum(v: number | null | undefined, dp = 2): string | null {
  if (!isNum(v)) return null;
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
export function fmtUsd(v: number | null | undefined, dp = 2): string | null {
  const s = fmtNum(v, dp);
  return s === null ? null : `$${s}`;
}
export function fmtPct(v: number | null | undefined, dp = 2, signed = true): string | null {
  if (!isNum(v)) return null;
  const s = Math.abs(v).toFixed(dp);
  if (!signed) return `${s}%`;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s}%`;
}
export function fmtSigned(v: number | null | undefined, dp = 0): string | null {
  if (!isNum(v)) return null;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp })}`;
}
export const tone = (v: number | null | undefined) => (!isNum(v) || v === 0 ? "text-ivory-300" : v > 0 ? "text-up" : "text-down");

/** "not_computed_definition_and_input_series_required" -> "Not computed: definition and input series required" */
export function humanizeStatus(s: string | null | undefined): string | null {
  if (!s) return null;
  const words = s.replace(/_/g, " ").trim();
  const m = words.match(/^(not computed|not calculated yet|missing|requires|unverified|definition required|not researched|insufficient)(.*)$/i);
  const text = m && m[2] ? `${m[1]}:${m[2]}` : words;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function fmtDate(date: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}
export function fmtInstant(d: Date | string | null | undefined, timeZone: string, withDate = true): string | null {
  if (!d) return null;
  const inst = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(inst.getTime())) return null;
  return inst.toLocaleString("en-US", {
    timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short",
    ...(withDate ? { weekday: "short", month: "short", day: "numeric" } : {}),
  });
}
export const tzShort = (timeZone: string) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(new Date());
  return p.find((x) => x.type === "timeZoneName")?.value ?? timeZone;
};
