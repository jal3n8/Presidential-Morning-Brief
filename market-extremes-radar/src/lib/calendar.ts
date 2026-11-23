/**
 * Rule-based NYSE calendar (weekends + full-day holidays) and data-freshness checks.
 * Dates are exchange-local "YYYY-MM-DD" strings and are handled WITHOUT the browser's
 * local time zone so a market date can never shift by a day.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** 0 = Sunday .. 6 = Saturday, computed in UTC from the date string itself. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, k: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + k));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function easter(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

function nthWeekday(y: number, m: number, wd: number, n: number): string {
  let d = iso(y, m, 1);
  while (weekdayOf(d) !== wd) d = addDays(d, 1);
  return addDays(d, 7 * (n - 1));
}

function lastWeekday(y: number, m: number, wd: number): string {
  let d = addDays(m === 12 ? iso(y + 1, 1, 1) : iso(y, m + 1, 1), -1);
  while (weekdayOf(d) !== wd) d = addDays(d, -1);
  return d;
}

function observed(d: string): string {
  const w = weekdayOf(d);
  return w === 6 ? addDays(d, -1) : w === 0 ? addDays(d, 1) : d;
}

const holidayCache = new Map<number, Set<string>>();
export function nyseHolidays(y: number): Set<string> {
  const hit = holidayCache.get(y);
  if (hit) return hit;
  const s = new Set<string>();
  const ny = iso(y, 1, 1);
  if (weekdayOf(ny) !== 6) s.add(observed(ny));
  if (y >= 1998) s.add(nthWeekday(y, 1, 1, 3));
  s.add(nthWeekday(y, 2, 1, 3));
  s.add(addDays(easter(y), -2));
  s.add(lastWeekday(y, 5, 1));
  if (y >= 2022) s.add(observed(iso(y, 6, 19)));
  s.add(observed(iso(y, 7, 4)));
  s.add(nthWeekday(y, 9, 1, 1));
  s.add(nthWeekday(y, 11, 4, 4));
  s.add(observed(iso(y, 12, 25)));
  holidayCache.set(y, s);
  return s;
}

export function isTradingDay(date: string): boolean {
  const w = weekdayOf(date);
  return w !== 0 && w !== 6 && !nyseHolidays(Number(date.slice(0, 4))).has(date);
}

/** New York wall-clock date and minutes-after-midnight for an instant. */
export function newYorkNow(now: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { date: iso(get("year"), get("month"), get("day")), minutes: get("hour") * 60 + get("minute") };
}

/** Closing data for a session is expected from 17:00 New York time (allows for provider lag). */
export const CLOSE_DATA_READY_MINUTES = 17 * 60;

export function expectedLatestSession(now: Date): string {
  const ny = newYorkNow(now);
  let d = ny.date;
  if (!(isTradingDay(d) && ny.minutes >= CLOSE_DATA_READY_MINUTES)) {
    d = addDays(d, -1);
    while (!isTradingDay(d)) d = addDays(d, -1);
  }
  return d;
}

/** Number of NYSE sessions strictly after `from` up to and including `to`. */
export function sessionsBetween(from: string, to: string): number {
  if (to <= from) return 0;
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isTradingDay(d)) n++;
  return n;
}

export type FreshnessStatus = "current" | "stale" | "very_stale" | "not_applicable";

export interface Freshness {
  status: FreshnessStatus;
  expected: string | null;
  missedSessions: number;
  message: string;
}

export function freshness(lastMarketDate: string, now: Date, kind: "demo" | "verified" | "imported"): Freshness {
  if (kind === "demo") {
    return { status: "not_applicable", expected: null, missedSessions: 0, message: "Demo data: freshness does not apply." };
  }
  const expected = expectedLatestSession(now);
  const missed = sessionsBetween(lastMarketDate, expected);
  if (missed === 0) return { status: "current", expected, missedSessions: 0, message: `Up to date through the ${lastMarketDate} close.` };
  return {
    status: missed <= 2 ? "stale" : "very_stale",
    expected,
    missedSessions: missed,
    message: `${missed} completed session${missed === 1 ? "" : "s"} missing (latest expected close: ${expected}).`,
  };
}
