/** npm run validate -- file.json : check a snapshot without publishing it. */
import { readFileSync } from "node:fs";
import { validateSnapshot } from "../src/lib/validate";
import { snapshotIdOf } from "../src/lib/snapshotOrder";

let failed = false;
for (const f of process.argv.slice(2)) {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(f, "utf8")); } catch { console.log(`FAIL ${f}: not valid JSON`); failed = true; continue; }
  const v = validateSnapshot(raw);
  console.log(`${v.ok ? "VALID" : "INVALID"} ${f}${v.ok ? ` (id ${snapshotIdOf(v.snapshot)})` : ""}`);
  for (const i of v.issues) console.log(`  ${i.level.padEnd(7)} ${i.path}: ${i.message}`);
  if (!v.ok) failed = true;
}
process.exit(failed ? 1 : 0);
