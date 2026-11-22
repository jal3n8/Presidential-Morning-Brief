import { z } from "zod";

/**
 * Admin calls. The token proves who is calling; the server re-checks the
 * admin role, re-validates every payload and writes an audit entry.
 */

const BASE = import.meta.env.BASE_URL ?? "/";

export type AdminResult = { ok: boolean; status: number; message: string; issues?: { path: string; message: string }[] };

async function call(path: string, token: string | null, init: RequestInit): Promise<AdminResult> {
  if (!token) return { ok: false, status: 401, message: "Please sign in again." };
  const res = await fetch(`${BASE}api/admin/${path}`, { ...init, cache: "no-store", headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  let body: Record<string, unknown> = {};
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* non-JSON error */ }
  const issues = Array.isArray(body.issues) ? (body.issues as { path: string; message: string }[]).slice(0, 20) : undefined;
  const message = typeof body.error === "string" ? body.error
    : body.action === "duplicate" ? `Already published (identical): ${String(body.id)}`
      : body.action ? `${String(body.action).replace("_", " ")}: ${String(body.id)}${body.latestUpdated === false ? " (archived; older than latest)" : ""}`
        : `HTTP ${res.status}`;
  return { ok: res.ok, status: res.status, message, issues };
}

export const publishSnapshot = (token: string | null, raw: unknown, replace: boolean) =>
  call(`publish.php${replace ? "?replace=1" : ""}`, token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(raw) });

export const rollbackTo = (token: string | null, id: string) =>
  call("rollback.php", token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });

const AuditEntry = z.object({
  at: z.string(), action: z.string(), actor: z.string(), role: z.string().nullable().optional(), client: z.string().optional(), result: z.string(),
  id: z.string().optional(), sha256: z.string().optional(), reason: z.string().optional(), latestUpdated: z.boolean().optional(), previousLatest: z.string().optional(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export async function loadAudit(token: string | null): Promise<AuditEntry[]> {
  if (!token) throw new Error("Please sign in again.");
  const res = await fetch(`${BASE}api/admin/audit.php?limit=300`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Audit log unavailable (HTTP ${res.status})`);
  return z.object({ entries: z.array(AuditEntry) }).parse(await res.json()).entries;
}
