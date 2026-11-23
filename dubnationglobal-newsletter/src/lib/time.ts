/** Time-zone helpers built on Intl only (no date library). */

function partsIn(date: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute") };
}

/**
 * The instant at which the wall clock in `timeZone` shows hour:minute on the same calendar
 * day as `onDay` does there. Handles daylight-saving changes by correcting the offset.
 */
export function zonedTimeToInstant(onDay: Date, hour: number, minute: number, timeZone: string): Date {
  const { y, m, d } = partsIn(onDay, timeZone);
  let guess = Date.UTC(y, m - 1, d, hour, minute);
  for (let k = 0; k < 3; k++) {
    const p = partsIn(new Date(guess), timeZone);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    const target = Date.UTC(y, m - 1, d, hour, minute);
    if (shown === target) break;
    guess += target - shown;
  }
  return new Date(guess);
}

/** "Wed 11:00 AM" style local label. */
export function formatLocal(instant: Date, timeZone: string, withDay = true): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: withDay ? "short" : undefined,
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

/** Calendar-day difference between two zones for the same instant (-1, 0, +1). */
export function dayOffset(instant: Date, fromZone: string, toZone: string): number {
  const a = partsIn(instant, fromZone);
  const b = partsIn(instant, toZone);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}
