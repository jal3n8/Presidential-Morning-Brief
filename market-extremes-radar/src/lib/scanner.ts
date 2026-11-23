import type { Num } from "./indicators";
import type { MarketFrame } from "./market";
import { runStudy } from "./analogs";
import type { TriggerDef } from "./rules";
import { TRIGGERS } from "./rules";

export const VALIDATION_COOLDOWN = 20;
export const VALIDATION_MIN_EVENTS = 10;

export interface ScanEvent {
  triggerId: string;
  triggerName: string;
  family: TriggerDef["family"];
  index: number;
  date: string;
  /** consecutive sessions the trigger stayed active from this onset */
  activeDays: number;
  stillActive: boolean;
  inputs: Record<string, Num>;
  formula: string;
  threshold: string;
  validation: { status: "available" | "limited" | "not_available"; priorEvents: number; note: string };
}

export interface TriggerHistory {
  trigger: TriggerDef;
  /** de-duplicated events (20-session cluster rule) with the index at which their 20-session outcome became known */
  events: { index: number; completeAt: number; fwd20: Num }[];
}

/** Full-history de-duplicated events for a trigger (used for point-in-time validation counts). */
export function triggerHistory(f: MarketFrame, t: TriggerDef): TriggerHistory {
  const s = runStudy(f, {
    predicate: t.test,
    description: t.name,
    cooldown: VALIDATION_COOLDOWN,
    dedupe: true,
    entry: "signal_close",
    excursionHorizon: 60,
  });
  return { trigger: t, events: s.events.map((e) => ({ index: e.index, completeAt: e.entryIndex + 20, fwd20: e.forward[20] })) };
}

/** How many independent prior events had a COMPLETED 20-session outcome as of index t. */
export function validationAt(h: TriggerHistory, t: number): ScanEvent["validation"] {
  const prior = h.events.filter((e) => e.index < t && e.completeAt <= t).length;
  if (prior >= VALIDATION_MIN_EVENTS)
    return { status: "available", priorEvents: prior, note: `${prior} earlier independent events with known 20-session outcomes` };
  if (prior > 0) return { status: "limited", priorEvents: prior, note: `Only ${prior} earlier independent events - treat statistics as anecdotal` };
  return { status: "not_available", priorEvents: 0, note: "No earlier completed events in the available history" };
}

/** Onset events: trigger true today and not true on the previous session. */
export function scan(f: MarketFrame, triggers: TriggerDef[] = TRIGGERS): ScanEvent[] {
  const out: ScanEvent[] = [];
  const n = f.dates.length;
  for (const t of triggers) {
    const hist = triggerHistory(f, t);
    let prev: boolean | null = null;
    for (let i = 0; i < n; i++) {
      const cur = t.test(f, i);
      if (cur === true && prev !== true) {
        let j = i;
        while (j + 1 < n && t.test(f, j + 1) === true) j++;
        out.push({
          triggerId: t.id,
          triggerName: t.name,
          family: t.family,
          index: i,
          date: f.dates[i],
          activeDays: j - i + 1,
          stillActive: j === n - 1,
          inputs: t.inputs(f, i),
          formula: t.formula,
          threshold: t.threshold,
          validation: validationAt(hist, i),
        });
      }
      prev = cur;
    }
  }
  return out.sort((a, b) => (a.date === b.date ? a.triggerId.localeCompare(b.triggerId) : b.date.localeCompare(a.date)));
}

/** Triggers active on the latest session, with their current inputs. */
export function activeNow(f: MarketFrame, triggers: TriggerDef[] = TRIGGERS) {
  const i = f.dates.length - 1;
  return triggers.map((t) => ({ trigger: t, active: t.test(f, i), inputs: t.inputs(f, i) }));
}
