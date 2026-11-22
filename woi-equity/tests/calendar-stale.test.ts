import { describe, expect, it } from "vitest";
import { holidays, sessionInfo, lastCompletedSession, upcomingRuns, tradingDaysBetween, wallClock } from "../src/lib/calendar";
import { freshness } from "../src/lib/freshness";
import { validateSnapshot } from "../src/lib/validate";
import { baseline } from "./helpers";

describe("NYSE calendar", () => {
  it("matches the published 2026 holiday list", () => {
    expect([...holidays(2026).keys()].sort()).toEqual([
      "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    ]);
  });
  it("knows 2026 early closes and does not move a Saturday New Year back to Friday", () => {
    expect(sessionInfo("2026-11-27").closeTimeET).toBe("13:00");
    expect(sessionInfo("2026-12-24").closeTimeET).toBe("13:00");
    expect(sessionInfo("2027-12-31").isTradingDay).toBe(true); // Jan 1 2028 is a Saturday
    expect(sessionInfo("2027-03-26").reason).toBe("Good Friday");
    expect(sessionInfo("2027-12-24").isTradingDay).toBe(false); // Christmas observed
  });
  it("runs 09:40 and 16:15 ET on trading days, 13:15 on early-close days, never on holidays", () => {
    const runs = upcomingRuns(new Date("2026-11-25T22:00:00Z"), undefined, 4);
    const fmt = runs.map((r) => `${r.date} ${wallClock(r.at, "America/New_York").time} ${r.job.name}`);
    expect(fmt).toEqual([
      "2026-11-27 09:40 opening_snapshot",
      "2026-11-27 13:15 closing_snapshot",
      "2026-11-30 09:40 opening_snapshot",
      "2026-11-30 16:15 closing_snapshot",
    ]);
  });
  it("handles daylight saving: 16:15 ET is 20:15 UTC in summer, 21:15 UTC in winter", () => {
    const summer = upcomingRuns(new Date("2026-07-01T14:00:00Z"), undefined, 1)[0];
    const winter = upcomingRuns(new Date("2026-12-01T15:00:00Z"), undefined, 1)[0];
    expect(summer.at.toISOString()).toBe("2026-07-01T20:15:00.000Z");
    expect(winter.at.toISOString()).toBe("2026-12-01T21:15:00.000Z");
  });
});

describe("stale-data handling", () => {
  const s = (() => { const v = validateSnapshot(baseline()); if (!v.ok) throw new Error(); return v.snapshot; })();
  it("is current, and labelled SAMPLE, on the weekend after the Nov 20 close", () => {
    const f = freshness(s, new Date("2026-11-22T18:00:00Z"));
    expect(f.stale).toBe(false);
    expect(f.mode).toBe("SAMPLE");
  });
  it("is not stale during Monday's session, before the close", () => {
    expect(lastCompletedSession(new Date("2026-11-23T18:00:00Z"))).toBe("2026-11-20");
    expect(freshness(s, new Date("2026-11-23T18:00:00Z")).stale).toBe(false);
  });
  it("counts trading sessions missed, skipping Thanksgiving", () => {
    const f = freshness(s, new Date("2026-11-27T19:00:00Z")); // after the 1 p.m. early close
    expect(f.sessionsBehind).toBe(4); // Nov 23, 24, 25, 27
    expect(f.stale).toBe(true);
    expect(tradingDaysBetween("2026-11-20", "2026-11-30")).toBe(5);
  });
  it("never reports LIVE for a snapshot that was not produced by automation", () => {
    const raw = baseline();
    raw.snapshot.isLive = true;
    const v = validateSnapshot(raw);
    if (!v.ok) throw new Error();
    expect(freshness(v.snapshot, new Date("2026-11-22T18:00:00Z")).mode).toBe("SAMPLE");
  });
});
