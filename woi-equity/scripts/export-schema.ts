/**
 * Exports the Zod snapshot schema to JSON Schema (draft-07) for the PHP
 * server (public/api/_lib/snapshot.schema.json). One source of truth:
 * a test fails if the committed file is out of date.
 *
 *   npm run export-schema
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SnapshotSchema } from "../src/lib/schema";

export function snapshotJsonSchema(): string {
  const schema = z.toJSONSchema(SnapshotSchema, { target: "draft-7", io: "input", unrepresentable: "throw" });
  return JSON.stringify(schema, null, 2) + "\n";
}

if (process.argv[1]?.endsWith("export-schema.ts")) {
  const out = join(dirname(fileURLToPath(import.meta.url)), "../public/api/_lib/snapshot.schema.json");
  writeFileSync(out, snapshotJsonSchema());
  console.log(`Wrote ${out}`);
}
