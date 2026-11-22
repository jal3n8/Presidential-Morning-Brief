import { readFileSync } from "node:fs";
import { join } from "node:path";

export const BASELINE_PATH = join(__dirname, "../reference/woi_equity_verified_2026-11-20.json");
/** A fresh deep copy of the supplied baseline for each test. */
export const baseline = (): any => JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
