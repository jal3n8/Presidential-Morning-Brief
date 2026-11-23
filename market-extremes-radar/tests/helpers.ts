import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addDays, isTradingDay } from "../src/lib/calendar";
import type { Series } from "../src/lib/types";

/** Consecutive NYSE sessions starting at (or after) `start`. */
export function sessions(start: string, n: number): string[] {
  const out: string[] = [];
  let d = start;
  while (out.length < n) {
    if (isTradingDay(d)) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

export function makeSeries(closes: number[], opts: Partial<Series> & { start?: string } = {}): Series {
  const dates = opts.dates ?? sessions(opts.start ?? "2020-01-02", closes.length);
  return {
    symbol: opts.symbol ?? "TEST",
    name: opts.name ?? "Test series",
    assetClass: opts.assetClass ?? "index",
    tradable: opts.tradable ?? false,
    currency: "USD",
    priceNotes: "test",
    source: opts.source ?? { provider: "Unit test", url: "n/a", retrievedAt: "2026-11-23T01:25:00Z", license: "test", method: "test" },
    verification: opts.verification ?? { level: "synthetic", detail: "test", crossCheck: null },
    dates,
    close: closes,
    adjClose: opts.adjClose ?? closes,
  };
}

/** Deterministic pseudo-random walk (no Math.random so tests are reproducible). */
export function walk(n: number, seed = 1, start = 100, vol = 0.012): number[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const out = [start];
  for (let i = 1; i < n; i++) out.push(out[i - 1] * Math.exp((rnd() - 0.5) * 2 * vol * 1.7));
  return out;
}

/** fetch() stand-in that serves files from public/ */
export function fsFetch(root = "public") {
  return async (url: string) => {
    try {
      const buf = readFileSync(join(root, url));
      return new Response(buf, { status: 200 });
    } catch {
      return new Response("not found", { status: 404 });
    }
  };
}
