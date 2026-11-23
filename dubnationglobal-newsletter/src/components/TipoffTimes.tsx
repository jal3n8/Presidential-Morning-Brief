import { useMemo } from "react";
import { CITIES, GLOBE } from "../config/site";
import { dayOffset, formatLocal, zonedTimeToInstant } from "../lib/time";

/** Converts the configured example tip-off (7:00 p.m. Pacific) into each city's local time, for today's date. */
export function useTipoffTimes(cityIds: string[], now: Date) {
  return useMemo(() => {
    const t = GLOBE.exampleTipoff;
    const instant = zonedTimeToInstant(now, t.hour, t.minute, t.timeZone);
    return cityIds.map((id) => {
      const c = CITIES[id];
      const off = dayOffset(instant, t.timeZone, c.timeZone);
      return { id, city: c.name, time: formatLocal(instant, c.timeZone, false), offset: off, full: formatLocal(instant, c.timeZone, true) };
    });
  }, [cityIds, now]);
}

export function TipoffTimes({ now = new Date(), cityIds = ["bay-area", "manila", "tokyo", "sao-paulo", "paris"], caption = true }: { now?: Date; cityIds?: string[]; caption?: boolean }) {
  const rows = useTipoffTimes(cityIds, now);
  return (
    <figure className="mt-5">
      <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-black/30">
        {rows.map((r) => (
          <li key={r.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-[15px]">
            <span className="text-paper/90">{r.city}</span>
            <span className="tabular-nums text-paper">
              {r.time}
              {r.offset !== 0 && <span className="ml-1.5 text-xs text-gold">{r.offset > 0 ? "next day" : "day before"}</span>}
            </span>
          </li>
        ))}
      </ul>
      {caption && (
        <figcaption className="mt-2 text-xs leading-snug text-mist/80">
          Example: a {GLOBE.exampleTipoff.label} tip-off on today’s date, converted with daylight-saving rules. Not a scheduled game.
        </figcaption>
      )}
    </figure>
  );
}
