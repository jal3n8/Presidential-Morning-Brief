/**
 * NYSE (XNYS) trading calendar, computed from the exchange's published
 * holiday rules rather than a hard-coded list, so it keeps working in future
 * years. Unscheduled closures (e.g. a national day of mourning) go in
 * SPECIAL_CLOSURES when the exchange announces them.
 *
 * Rules (NYSE Rule 7.2 and its published calendars):
 *  - New Year's Day; Sunday -> Monday; Saturday is NOT moved to Friday.
 *  - MLK Day (3rd Mon Jan), Washington's Birthday (3rd Mon Feb),
 *    Good Friday, Memorial Day (last Mon May), Juneteenth (from 2022),
 *    Independence Day, Labor Day (1st Mon Sep), Thanksgiving (4th Thu Nov),
 *    Christmas. Saturday -> Friday, Sunday -> Monday.
 *  - 1:00 p.m. ET early closes: July 3 (when a Mon-Thu trading day),
 *    the day after Thanksgiving, Christmas Eve (when a Mon-Thu trading day).
 */

export const SPECIAL_CLOSURES: Record<string, string> = {
  "2025-01-09": "National Day of Mourning (President Carter)",
};

export type SessionInfo = {
  date: string;
  isTradingDay: boolean;
  reason: string | null;
  earlyClose: boolean;
  closeTimeET: "16:00" | "13:00" | null;
};

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}
/** 0 = Sunday ... 6 = Saturday */
export function weekday(date: string): number {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export function addDays(date: string, n: number): string {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
function nthWeekday(y: number, month: number, dow: number, n: number): string {
  const first = weekday(ymd(y, month, 1));
  return ymd(y, month, 1 + ((dow - first + 7) % 7) + (n - 1) * 7);
}
function lastWeekday(y: number, month: number, dow: number): string {
  const lastDay = new Date(Date.UTC(y, month, 0)).getUTCDate();
  const lw = weekday(ymd(y, month, lastDay));
  return ymd(y, month, lastDay - ((lw - dow + 7) % 7));
}
function easterSunday(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(y, month, day);
}
function observed(date: string): string {
  const w = weekday(date);
  if (w === 6) return addDays(date, -1);
  if (w === 0) return addDays(date, 1);
  return date;
}

const holidayCache = new Map<number, Map<string, string>>();
export function holidays(year: number): Map<string, string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const h = new Map<string, string>();
  const ny = ymd(year, 1, 1);
  if (weekday(ny) === 0) h.set(addDays(ny, 1), "New Year's Day (observed)");
  else if (weekday(ny) !== 6) h.set(ny, "New Year's Day");
  h.set(nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day");
  h.set(nthWeekday(year, 2, 1, 3), "Washington's Birthday");
  h.set(addDays(easterSunday(year), -2), "Good Friday");
  h.set(lastWeekday(year, 5, 1), "Memorial Day");
  if (year >= 2022) {
    const j = observed(ymd(year, 6, 19));
    h.set(j, j === ymd(year, 6, 19) ? "Juneteenth" : "Juneteenth (observed)");
  }
  const ind = observed(ymd(year, 7, 4));
  h.set(ind, ind === ymd(year, 7, 4) ? "Independence Day" : "Independence Day (observed)");
  h.set(nthWeekday(year, 9, 1, 1), "Labor Day");
  h.set(nthWeekday(year, 11, 4, 4), "Thanksgiving Day");
  const xmas = observed(ymd(year, 12, 25));
  h.set(xmas, xmas === ymd(year, 12, 25) ? "Christmas Day" : "Christmas Day (observed)");
  holidayCache.set(year, h);
  return h;
}

export function sessionInfo(date: string): SessionInfo {
  const w = weekday(date);
  if (w === 0 || w === 6) return { date, isTradingDay: false, reason: "Weekend", earlyClose: false, closeTimeET: null };
  const special = SPECIAL_CLOSURES[date];
  if (special) return { date, isTradingDay: false, reason: special, earlyClose: false, closeTimeET: null };
  const year = Number(date.slice(0, 4));
  const hol = holidays(year).get(date);
  if (hol) return { date, isTradingDay: false, reason: hol, earlyClose: false, closeTimeET: null };

  let early: string | null = null;
  const md = date.slice(5);
  if (md === "07-03" && w >= 1 && w <= 4) early = "Early close before Independence Day";
  if (date === addDays(nthWeekday(year, 11, 4, 4), 1)) early = "Early close after Thanksgiving";
  if (md === "12-24" && w >= 1 && w <= 4) early = "Early close on Christmas Eve";
  return { date, isTradingDay: true, reason: early, earlyClose: !!early, closeTimeET: early ? "13:00" : "16:00" };
}

export const isTradingDay = (date: string) => sessionInfo(date).isTradingDay;

export function previousTradingDay(date: string): string {
  let d = addDays(date, -1);
  while (!isTradingDay(d)) d = addDays(d, -1);
  return d;
}
export function nextTradingDay(date: string): string {
  let d = addDays(date, 1);
  while (!isTradingDay(d)) d = addDays(d, 1);
  return d;
}
/** Number of trading sessions in the half-open interval (from, to]. */
export function tradingDaysBetween(from: string, to: string): number {
  if (to <= from) return 0;
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isTradingDay(d)) n++;
  return n;
}
/** Sessions from `first` through `last`, both included (first must be a session). */
export function sessionsInclusive(first: string, last: string): number {
  if (last < first) return 0;
  return (isTradingDay(first) ? 1 : 0) + tradingDaysBetween(first, last);
}
/** The date of the Nth session counting `first` as session 1. */
export function nthSessionFrom(first: string, n: number): string {
  let d = first;
  let count = isTradingDay(first) ? 1 : 0;
  while (count < n) {
    d = addDays(d, 1);
    if (isTradingDay(d)) count++;
  }
  return d;
}

/* ---------- time zone helpers (no dependencies, uses Intl) ---------- */

export function wallClock(instant: Date, timeZone: string): { date: string; time: string; minutes: number } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${pad(hour)}:${p.minute}`, minutes: hour * 60 + Number(p.minute) };
}

/** Convert a wall-clock time in `timeZone` to a UTC instant (DST aware). */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = parts(date);
  const [hh, mm] = time.split(":").map(Number);
  const target = Date.UTC(y, m - 1, d, hh, mm);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const wc = wallClock(new Date(guess), timeZone);
    const [wy, wm, wd] = parts(wc.date);
    const seen = Date.UTC(wy, wm - 1, wd, Math.floor(wc.minutes / 60), wc.minutes % 60);
    guess += target - seen;
  }
  return new Date(guess);
}

export const MARKET_TZ = "America/New_York";

/** Latest session whose regular close has happened at `now`. */
export function lastCompletedSession(now: Date): string {
  const { date, minutes } = wallClock(now, MARKET_TZ);
  const info = sessionInfo(date);
  if (info.isTradingDay && info.closeTimeET) {
    const [h, m] = info.closeTimeET.split(":").map(Number);
    if (minutes >= h * 60 + m) return date;
  }
  return previousTradingDay(date);
}

export type ScheduledJob = { name: string; timeET: string; purpose: string };
export const DEFAULT_JOBS: ScheduledJob[] = [
  { name: "opening_snapshot", timeET: "09:40", purpose: "Opening prices, filings and news" },
  { name: "closing_snapshot", timeET: "16:15", purpose: "Verified closes and indicators" },
];

/** Closing job runs 15 minutes after the actual close, so it moves on early-close days. */
export function jobTimeFor(job: ScheduledJob, date: string): string {
  if (job.name === "closing_snapshot") {
    const info = sessionInfo(date);
    if (info.closeTimeET === "13:00") return "13:15";
  }
  return job.timeET;
}

export function upcomingRuns(now: Date, jobs = DEFAULT_JOBS, count = 4): { job: ScheduledJob; at: Date; date: string }[] {
  const out: { job: ScheduledJob; at: Date; date: string }[] = [];
  let d = wallClock(now, MARKET_TZ).date;
  if (!isTradingDay(d)) d = nextTradingDay(d);
  while (out.length < count) {
    for (const job of jobs) {
      const at = zonedToUtc(d, jobTimeFor(job, d), MARKET_TZ);
      if (at.getTime() > now.getTime()) out.push({ job, at, date: d });
    }
    d = nextTradingDay(d);
  }
  return out.slice(0, count);
}
