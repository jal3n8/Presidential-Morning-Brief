/**
 * Test harness: runs public/api under PHP's built-in server with a throwaway
 * config and storage folder, and mints real RS256 tokens from a local key
 * pair (standing in for the identity provider).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, createHmac, createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const hasPhp = spawnSync("php", ["-v"]).status === 0 && spawnSync("php", ["-r", "exit(is_file('public/api/_lib/vendor/autoload.php')?0:1);"], { cwd: join(__dirname, "..") }).status === 0;

export const ISSUER = "https://issuer.test.example/";
export const AUDIENCE = "https://woiequity.test/api";
export const INGEST_TOKEN = "machine-token-" + "x".repeat(40);

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export type Keys = { privateKey: KeyObject; publicKey: KeyObject; kid: string };
export function makeKeys(kid: string): Keys {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { privateKey, publicKey, kid };
}
export function jwks(...keys: Keys[]) {
  return { keys: keys.map((k) => ({ ...(k.publicKey.export({ format: "jwk" }) as object), kid: k.kid, alg: "RS256", use: "sig" })) };
}

export function signJwt(keys: Keys, claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
  const h = b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid: keys.kid, ...header }));
  const p = b64u(JSON.stringify(claims));
  const sig = createSign("RSA-SHA256").update(`${h}.${p}`).sign(keys.privateKey);
  return `${h}.${p}.${b64u(sig)}`;
}
/** Classic attack: HS256 "signed" with the RSA public key as the HMAC secret. */
export function hs256WithPublicKey(keys: Keys, claims: Record<string, unknown>) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT", kid: keys.kid }));
  const p = b64u(JSON.stringify(claims));
  const secret = keys.publicKey.export({ format: "pem", type: "spki" });
  return `${h}.${p}.${b64u(createHmac("sha256", secret).update(`${h}.${p}`).digest())}`;
}
export function unsignedJwt(claims: Record<string, unknown>, kid = "k1") {
  return `${b64u(JSON.stringify({ alg: "none", typ: "JWT", kid }))}.${b64u(JSON.stringify(claims))}.`;
}

export const now = () => Math.floor(Date.now() / 1000);
export const claims = (over: Record<string, unknown> = {}) => ({
  iss: ISSUER, aud: [AUDIENCE, `${ISSUER}userinfo`], sub: "auth0|tester", iat: now() - 10, exp: now() + 600, permissions: [], ...over,
});

export type Server = { base: string; storage: string; stop: () => void };

export async function startServer(cfg: Record<string, unknown>, jwksDoc?: unknown): Promise<Server> {
  const dir = mkdtempSync(join(tmpdir(), "woi-php-"));
  const storage = (cfg.storage_dir as string) ?? join(dir, "woi-storage");
  let jwksFile: string | null = null;
  if (jwksDoc) { jwksFile = join(dir, "jwks.json"); writeFileSync(jwksFile, JSON.stringify(jwksDoc)); }
  const full = { storage_dir: storage, log_salt: "test-salt", ...(jwksFile ? { jwks_file: jwksFile } : {}), ...cfg };
  const php = `<?php return ${toPhp(full)};`;
  const cfgFile = join(dir, "woi-config.php");
  writeFileSync(cfgFile, php);
  const port = 9000 + Math.floor(Math.random() * 900);
  const proc: ChildProcess = spawn("php", ["-S", `127.0.0.1:${port}`, "-t", join(__dirname, "../public")], {
    env: { ...process.env, WOI_CONFIG_FILE: cfgFile, PHP_CLI_SERVER_WORKERS: "4" }, stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}/api`;
  for (let i = 0; i < 80; i++) {
    try { await fetch(`${base}/public.php`); break; } catch { await new Promise((r) => setTimeout(r, 75)); }
  }
  return { base, storage, stop: () => proc.kill() };
}

function toPhp(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (Array.isArray(v)) return `[${v.map(toPhp).join(",")}]`;
  return `[${Object.entries(v as object).map(([k, x]) => `${toPhp(k)}=>${toPhp(x)}`).join(",")}]`;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
