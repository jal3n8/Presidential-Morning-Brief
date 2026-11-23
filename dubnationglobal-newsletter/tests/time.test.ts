import { describe, expect, it } from "vitest";
import { dayOffset, formatLocal, zonedTimeToInstant } from "../src/lib/time";

describe("time-zone conversion for example tip-offs", () => {
  it("7 p.m. Pacific in winter (PST) is 03:00 UTC the next day", () => {
    expect(zonedTimeToInstant(new Date("2026-11-20T20:00:00Z"), 19, 0, "America/Los_Angeles").toISOString()).toBe("2026-11-21T03:00:00.000Z");
  });
  it("7 p.m. Pacific in summer (PDT) is 02:00 UTC the next day", () => {
    expect(zonedTimeToInstant(new Date("2026-07-15T20:00:00Z"), 19, 0, "America/Los_Angeles").toISOString()).toBe("2026-07-16T02:00:00.000Z");
  });
  it("handles the day clocks change", () => {
    expect(zonedTimeToInstant(new Date("2026-03-08T20:00:00Z"), 19, 0, "America/Los_Angeles").toISOString()).toBe("2026-03-09T02:00:00.000Z");
  });
  it("converts to city times with the right day", () => {
    const t = zonedTimeToInstant(new Date("2026-11-20T20:00:00Z"), 19, 0, "America/Los_Angeles");
    expect(formatLocal(t, "Asia/Manila", false)).toBe("11:00 AM");
    expect(formatLocal(t, "Asia/Tokyo", false)).toBe("12:00 PM");
    expect(formatLocal(t, "America/Sao_Paulo", false)).toBe("12:00 AM");
    expect(formatLocal(t, "Europe/Paris", false)).toBe("4:00 AM");
    expect(dayOffset(t, "America/Los_Angeles", "Asia/Manila")).toBe(1);
    expect(dayOffset(t, "America/Los_Angeles", "America/Los_Angeles")).toBe(0);
  });
});
