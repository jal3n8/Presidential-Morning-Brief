/**
 * Static security checks on the source tree: no secrets, no dangerous DOM or
 * eval patterns, strict schema rules in force, the server schema in sync,
 * and hardened web-server configuration.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { validateSnapshot } from "../src/lib/validate";
import { snapshotJsonSchema } from "../scripts/export-schema";
import { baseline } from "./helpers";

const ROOT = join(__dirname, "..");
function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (["node_modules", "dist", "vendor", ".git"].includes(f)) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out); else out.push(p);
  }
  return out;
}
const SOURCE = files(ROOT).filter((f) => /\.(ts|tsx|php|js|json|html|htaccess|yml|md)$|\.htaccess$/.test(f));

describe("no secrets in the repository", () => {
  const patterns: [string, RegExp][] = [
    ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
    ["private key block", /-----BEGIN (RSA |EC )?PRIVATE KEY-----/],
    ["GitHub token", /gh[pousr]_[A-Za-z0-9]{36}/],
    ["OpenAI-style key", /sk-[A-Za-z0-9]{32,}/],
    ["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/],
    ["hard-coded ingest token", /'ingest_token(_sha256)?'\s*=>\s*'(?!REPLACE|<|\$\{)[^']{20,}'/],
  ];
  for (const [name, re] of patterns) {
    it(`contains no ${name}`, () => {
      const hits = SOURCE.filter((f) => !f.includes(`${join("tests", "")}`) && re.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
      expect(hits).toEqual([]);
    });
  }
});

describe("no dangerous browser patterns", () => {
  const ui = SOURCE.filter((f) => f.includes(join(ROOT, "src")) && /\.(ts|tsx)$/.test(f));
  it("never injects raw HTML or evaluates strings", () => {
    const hits = ui.filter((f) => /dangerouslySetInnerHTML|\binnerHTML\s*=|\beval\(|new Function\(|document\.write/.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => relative(ROOT, f))).toEqual([]);
  });
  it("opens external links with noopener", () => {
    for (const f of ui) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/target="_blank"[^>]*>/g)) expect(m[0], relative(ROOT, f)).toContain("noopener");
    }
  });
  it("keeps the no-sign-in preview behind the development-only flag", () => {
    for (const f of ["src/lib/auth.tsx", "src/lib/dataSource.ts"]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      for (const line of src.split("\n").filter((l) => l.includes("VITE_DEV_PREVIEW") && !l.trim().startsWith("*") && !l.trim().startsWith("//")))
        expect(line, f).toContain("import.meta.env.DEV");
    }
  });
});

describe("strict schema", () => {
  const v = (mutate: (s: any) => void) => { const s = baseline(); mutate(s); return validateSnapshot(s).ok; };
  it("accepts the baseline", () => expect(validateSnapshot(baseline()).ok).toBe(true));
  it("rejects unknown keys at any depth", () => {
    expect(v((s) => { s.extra = 1; })).toBe(false);
    expect(v((s) => { s.watchlist[0].research.secret = 1; })).toBe(false);
  });
  it("rejects non-http(s) links (javascript:, data:, protocol-relative)", () => {
    expect(v((s) => { s.sources.spy_close.url = "javascript:alert(1)"; })).toBe(false);
    expect(v((s) => { s.sources.spy_close.url = "data:text/html,x"; })).toBe(false);
    expect(v((s) => { s.sources.spy_close.url = "//evil.example"; })).toBe(false);
    expect(v((s) => { s.watchlist[0].research.unverifiedClaims.push({ title: "x", url: "javascript:void(0)" }); })).toBe(false);
  });
  it("rejects prototype-pollution keys and oversized values", () => {
    expect(validateSnapshot(JSON.parse(JSON.stringify(baseline()).replace('"spy_close":', '"__proto__":'))).ok).toBe(false);
    expect(v((s) => { s.validation.warnings.push("x".repeat(1001)); })).toBe(false);
    expect(v((s) => { s.watchlist = Array.from({ length: 51 }, () => s.watchlist[0]); })).toBe(false);
  });
  it("the server's JSON Schema is generated from this schema and up to date", () => {
    expect(readFileSync(join(ROOT, "public/api/_lib/snapshot.schema.json"), "utf8")).toBe(snapshotJsonSchema());
  });
});

describe("web server hardening", () => {
  const root = readFileSync(join(ROOT, "public/.htaccess"), "utf8");
  it("forces HTTPS, sends HSTS and a strict CSP without unsafe-inline or unsafe-eval", () => {
    expect(root).toMatch(/RewriteCond %\{HTTPS\} !=on/);
    expect(root).toContain("Strict-Transport-Security");
    const csp = root.match(/Content-Security-Policy "([^"]+)"/)![1];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/unsafe-(inline|eval)/);
  });
  it("denies the server library, vendor code, dotfiles and config-like files", () => {
    expect(root).toContain("RewriteRule ^api/_lib(/|$) - [F,L]");
    expect(readFileSync(join(ROOT, "public/api/_lib/.htaccess"), "utf8")).toContain("Require all denied");
    expect(root).toMatch(/woi-config/);
  });
  it("every PHP endpoint enforces HTTPS, a method, and a rate limit; protected ones check a role or token", () => {
    const eps = readdirSync(join(ROOT, "public/api")).filter((f) => f.endsWith(".php")).map((f) => `public/api/${f}`)
      .concat(readdirSync(join(ROOT, "public/api/admin")).map((f) => `public/api/admin/${f}`));
    for (const f of eps) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src, f).toContain("woi_require_https()");
      expect(src, f).toContain("woi_require_method(");
      expect(src, f).toContain("woi_rate_limit(");
      if (!f.endsWith("public.php") && !f.endsWith("me.php")) expect(src, f).toMatch(/woi_require_role\('(subscriber|admin)'\)|woi_require_ingest_token\(\)/);
      if (f.includes("/admin/")) expect(src, f).toContain("woi_require_role('admin')");
    }
  });
});
