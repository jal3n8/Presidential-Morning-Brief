/**
 * npm run security:check  (after `npm run build`)
 * Checks the BUILT site that will be uploaded to Hostinger.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = join(process.cwd(), "dist");
if (!existsSync(DIST)) { console.error("Run npm run build first."); process.exit(1); }
const all: string[] = [];
(function walk(d: string) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : all.push(p); } })(DIST);
const rel = (p: string) => relative(DIST, p);
const problems: string[] = [];
const js = all.filter((f) => f.endsWith(".js"));
const bundle = js.map((f) => readFileSync(f, "utf8")).join("\n");

if (bundle.includes("/dev-data")) problems.push("Development preview data path found in production JavaScript.");
if (/Local preview \(seed data/.test(bundle)) problems.push("Development preview source found in production JavaScript.");
for (const re of [/AIza[0-9A-Za-z_-]{35}/, /-----BEGIN (RSA )?PRIVATE KEY/, /gh[pousr]_[A-Za-z0-9]{36}/, /ingest_token/]) if (re.test(bundle)) problems.push(`Secret-like pattern ${re} in JavaScript.`);
const jsonOutsideLib = all.filter((f) => f.endsWith(".json") && !rel(f).startsWith("api/_lib/"));
if (jsonOutsideLib.length) problems.push(`Data files outside the protected folder: ${jsonOutsideLib.map(rel).join(", ")}`);
if (all.some((f) => /woi-config\.php$/.test(f))) problems.push("woi-config.php must never be in the build.");
if (!existsSync(join(DIST, "api/_lib/vendor/autoload.php"))) problems.push("PHP vendor folder missing: run composer install in public/api/_lib before building.");
const ht = readFileSync(join(DIST, ".htaccess"), "utf8");
if (ht.includes("__AUTH_ORIGIN__")) problems.push("CSP placeholder was not replaced.");
if (!process.env.VITE_AUTH_AUTHORITY) console.warn("WARNING: built without VITE_AUTH_AUTHORITY: the terminal will stay locked (deny by default).");

if (problems.length) { console.error("SECURITY CHECK FAILED\n- " + problems.join("\n- ")); process.exit(1); }
console.log(`Security check passed (${all.length} files, ${js.length} scripts).`);
