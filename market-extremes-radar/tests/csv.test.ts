import { describe, expect, it } from "vitest";
import { csvCell, importPriceCsv, parseCsv, toCsv } from "../src/lib/csv";
import { SeriesDocSchema } from "../src/lib/types";

const opts = { symbol: "aapl", assetClass: "stock" as const, today: "2026-11-23", importedAt: "2026-11-23T02:00:00Z", fileName: "AAPL.csv" };

describe("9. CSV import validation", () => {
  it("accepts a Yahoo-style export and keeps close and adjusted close", () => {
    const csv = "Date,Open,High,Low,Close,Adj Close,Volume\n2026-11-18,1,1,1,230.10,229.50,100\n2026-11-19,1,1,1,\"1,231.00\",230.40,100\n2026-11-20,1,1,1,228.00,227.40,100\n";
    const r = importPriceCsv(csv, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.symbol).toBe("AAPL");
    expect(r.doc.rows[1]).toEqual(["2026-11-19", 1231, 230.4]);
    expect(r.doc.verification.level).toBe("user_imported");
    expect(SeriesDocSchema.safeParse(r.doc).success).toBe(true);
  });
  it("accepts a FRED file and skips '.' missing values without filling them", () => {
    const r = importPriceCsv("observation_date,VIXCLS\n2026-11-18,20.1\n2026-11-19,.\n2026-11-20,35.89\n", { ...opts, symbol: "^VIX", assetClass: "volatility_index" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.rows.map((x) => x[0])).toEqual(["2026-11-18", "2026-11-20"]);
    expect(r.report.warnings.join(" ")).toMatch(/missing values were skipped/);
  });
  it("accepts US-style dates and sorts unsorted rows with a warning", () => {
    const r = importPriceCsv("Date,Close\n11/20/2026,3\n11/18/2026,1\n11/19/2026,2\n", opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.rows.map((x) => x[0])).toEqual(["2026-11-18", "2026-11-19", "2026-11-20"]);
    expect(r.report.warnings[0]).toMatch(/sorted/);
  });
  it.each([
    ["duplicate dates", "Date,Close\n2026-11-18,1\n2026-11-18,2\n2026-11-19,3\n", /duplicate/],
    ["future dates", "Date,Close\n2026-11-18,1\n2027-01-04,2\n2026-11-19,3\n", /future/],
    ["spreadsheet formulas", "Date,Close\n2026-11-18,1\n2026-11-19,=HYPERLINK(\"x\")\n2026-11-20,3\n", /formula/],
    ["non-numeric prices", "Date,Close\n2026-11-18,1\n2026-11-19,abc\n2026-11-20,3\n", /not a number/],
    ["negative prices", "Date,Close\n2026-11-18,1\n2026-11-19,-4\n2026-11-20,3\n", /non-positive/],
    ["impossible dates", "Date,Close\n2026-02-30,1\n2026-11-19,2\n2026-11-20,3\n", /unreadable date/],
    ["missing close column", "Date,Volume,Open\n2026-11-18,1,1\n2026-11-19,1,1\n", /No close column/],
    ["missing date column", "When,Close\n2026-11-18,1\n2026-11-19,1\n", /No date column/],
    ["too few rows", "Date,Close\n2026-11-18,1\n", /at least 2/],
  ])("rejects %s", (_, csv, msg) => {
    const r = importPriceCsv(csv, opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(msg);
  });
  it("rejects invalid symbols and binary content", () => {
    expect(importPriceCsv("Date,Close\n2026-11-18,1\n2026-11-19,2\n", { ...opts, symbol: "<script>" }).ok).toBe(false);
    expect(importPriceCsv("Date,Close\n2026-11-18,1\u0000\n2026-11-19,2\n", opts).ok).toBe(false);
  });
  it("warns about likely unadjusted splits", () => {
    const r = importPriceCsv("Date,Close\n2026-11-18,400\n2026-11-19,100\n2026-11-20,101\n", opts);
    expect(r.ok && r.report.warnings.some((w) => /split/.test(w))).toBe(true);
  });
  it("parses quoted fields, escaped quotes and CRLF", () => {
    expect(parseCsv('a,"b ""q"", c"\r\n1,2\r\n')).toEqual([["a", 'b "q", c'], ["1", "2"]]);
  });
  it("exports neutralise formula-like text (CSV injection) but keep numbers", () => {
    expect(csvCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
    expect(csvCell("@SUM(1)")).toBe("'@SUM(1)");
    expect(csvCell(-5.2)).toBe("-5.2");
    expect(csvCell("-5.2")).toBe("-5.2");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(toCsv([{ a: 1, b: null }], ["a", "b"])).toBe("a,b\r\n1,\r\n");
  });
});
