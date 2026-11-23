import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { Provenance } from "../src/components/ui";
import { expectedLatestSession, freshness, isTradingDay, sessionsBetween } from "../src/lib/calendar";
import { fmtMarketDate, fmtUtc, provenanceLine } from "../src/lib/format";
import { DataProvider } from "../src/state";
import { fsFetch, makeSeries } from "./helpers";

describe("10. Timestamps and provenance", () => {
  it("market dates are formatted without time-zone shifts", () => {
    expect(fmtMarketDate("2026-11-20")).toBe("Fri 20 Nov 2026");
    expect(fmtMarketDate("2026-01-01")).toBe("Thu 1 Jan 2026");
    expect(fmtMarketDate("not a date")).toBe("—");
    expect(fmtMarketDate(null)).toBe("—");
  });
  it("retrieval timestamps are always shown in UTC", () => {
    expect(fmtUtc("2026-11-23T01:25:09Z")).toBe("2026-11-23 01:25 UTC");
    expect(fmtUtc("2026-11-22T20:25:09-05:00")).toBe("2026-11-23 01:25 UTC");
    expect(fmtUtc("garbage")).toBe("—");
  });
  it("the provenance line names provider, verification level, market date and retrieval time", () => {
    const s = makeSeries([1, 2], { dates: ["2026-11-19", "2026-11-20"], verification: { level: "cross_checked", detail: "", crossCheck: null } });
    expect(provenanceLine(s)).toBe("Unit test · Cross-checked · market date Fri 20 Nov 2026 close (New York) · retrieved 2026-11-23 01:25 UTC");
    render(<Provenance series={s} />);
    expect(screen.getByTestId("provenance")).toHaveTextContent("Cross-checked");
    expect(screen.getByTestId("provenance")).toHaveTextContent("retrieved 2026-11-23 01:25 UTC");
  });
  it("synthetic data is labelled as such", () => {
    const s = makeSeries([1, 2], { dates: ["2025-12-30", "2025-12-31"] });
    expect(provenanceLine(s)).toMatch(/Synthetic demo/);
  });
});

describe("NYSE calendar and freshness", () => {
  it("knows weekends and holidays", () => {
    expect(isTradingDay("2026-11-20")).toBe(true);
    expect(isTradingDay("2026-11-21")).toBe(false);
    expect(isTradingDay("2026-11-26")).toBe(false); // Thanksgiving
    expect(isTradingDay("2026-04-03")).toBe(false); // Good Friday
    expect(isTradingDay("2026-07-03")).toBe(false); // Independence Day observed
  });
  it("expects Friday's close over the weekend and today's close only after 17:00 New York", () => {
    expect(expectedLatestSession(new Date("2026-11-23T01:30:00Z"))).toBe("2026-11-20"); // Sunday evening NY
    expect(expectedLatestSession(new Date("2026-11-23T20:00:00Z"))).toBe("2026-11-20"); // Mon 15:00 NY
    expect(expectedLatestSession(new Date("2026-11-23T22:30:00Z"))).toBe("2026-11-23"); // Mon 17:30 NY
    expect(expectedLatestSession(new Date("2026-11-27T15:00:00Z"))).toBe("2026-11-25"); // Fri morning after Thanksgiving
  });
  it("counts missed sessions", () => {
    expect(sessionsBetween("2026-11-20", "2026-11-20")).toBe(0);
    expect(sessionsBetween("2026-11-20", "2026-11-27")).toBe(4);
    expect(freshness("2026-11-20", new Date("2026-11-23T01:30:00Z"), "verified").status).toBe("current");
    expect(freshness("2026-11-18", new Date("2026-11-23T01:30:00Z"), "verified").status).toBe("stale");
    expect(freshness("2026-11-10", new Date("2026-11-23T01:30:00Z"), "verified").status).toBe("very_stale");
    expect(freshness("2025-12-31", new Date(), "demo").status).toBe("not_applicable");
  });
});

describe("App labels demo data clearly", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });
  it("falls back to the demo dataset and shows the DEMO banner when verified data is absent", async () => {
    const serve = fsFetch("public");
    vi.stubGlobal("fetch", (url: string) => (url.startsWith("data/verified") ? Promise.resolve(new Response("", { status: 404 })) : serve(url)));
    render(
      <DataProvider>
        <App />
      </DataProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("dataset-banner")).toHaveTextContent("DEMO DATA"), { timeout: 15000 });
    expect(screen.getByTestId("dataset-banner")).toHaveTextContent("Not market data");
    expect(screen.getByTestId("dataset-banner")).toHaveTextContent("Verified data not available");
    expect(screen.getAllByText(/Synthetic demo/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("condition-label")).toBeInTheDocument();
  }, 20000);
  it("shows an error state (and no numbers) when no dataset can be loaded", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 404 })));
    render(
      <DataProvider>
        <App />
      </DataProvider>,
    );
    await waitFor(() => expect(screen.getByText(/could not be loaded/)).toBeInTheDocument());
    expect(screen.queryByTestId("condition-label")).toBeNull();
  });
});
