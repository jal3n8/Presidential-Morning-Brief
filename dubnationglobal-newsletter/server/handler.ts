/**
 * Server-side signup function (provider-neutral).
 *
 * Runs anywhere that speaks the standard web Request/Response API: Cloudflare Pages Functions
 * (wired up in functions/api/subscribe.ts), Vercel/Netlify edge functions, Deno, Bun or Node 18+.
 *
 * The provider's API key lives ONLY in server environment variables. The browser never sees it.
 * The function stores nothing and never logs email addresses.
 *
 * Configure from your newsletter provider's API documentation:
 *   NEWSLETTER_API_URL        "create subscriber" endpoint URL               (required)
 *   NEWSLETTER_API_KEY        secret API key                                  (required)
 *   NEWSLETTER_AUTH_HEADER    header that carries the key       default "Authorization"
 *   NEWSLETTER_AUTH_PREFIX    text before the key                default "Bearer "  (e.g. "Token ")
 *   NEWSLETTER_EMAIL_FIELD    JSON field for the address         default "email"   (e.g. "email_address")
 *   NEWSLETTER_EXTRA_JSON     extra JSON merged into the body    e.g. {"tags":["website"]}
 *   NEWSLETTER_DOUBLE_OPT_IN  "true" | "false"                   default "true" (must match the provider setting)
 *   NEWSLETTER_DUPLICATE_STATUS  HTTP codes meaning "already subscribed", comma separated, e.g. "409"
 *   NEWSLETTER_DUPLICATE_MATCH   text in the provider's error reply meaning "already subscribed"
 *   ALLOWED_ORIGINS           comma-separated origins allowed to post        e.g. https://dubnationglobal.com
 */
import { validateEmail } from "../src/newsletter/validate";

export interface Env {
  NEWSLETTER_API_URL?: string;
  NEWSLETTER_API_KEY?: string;
  NEWSLETTER_AUTH_HEADER?: string;
  NEWSLETTER_AUTH_PREFIX?: string;
  NEWSLETTER_EMAIL_FIELD?: string;
  NEWSLETTER_EXTRA_JSON?: string;
  NEWSLETTER_DOUBLE_OPT_IN?: string;
  NEWSLETTER_DUPLICATE_STATUS?: string;
  NEWSLETTER_DUPLICATE_MATCH?: string;
  ALLOWED_ORIGINS?: string;
}

type Status = "subscribed" | "pending_confirmation" | "duplicate" | "invalid" | "error";

const MAX_BODY_BYTES = 2048;
const PROVIDER_TIMEOUT_MS = 10000;

function json(status: number, body: { status: Status; detail?: string }, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra },
  });
}

const list = (s?: string) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);

export async function handleSubscribe(req: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  const origin = req.headers.get("Origin");
  const allowed = list(env.ALLOWED_ORIGINS);
  const cors: Record<string, string> = origin && allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" } });
  }
  if (req.method !== "POST") return json(405, { status: "error", detail: "Method not allowed." }, { Allow: "POST" });
  if (origin && allowed.length && !allowed.includes(origin)) return json(403, { status: "error", detail: "Origin not allowed." });
  if (!(req.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    return json(415, { status: "error", detail: "Expected JSON." }, cors);
  }

  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(413, { status: "error", detail: "Request too large." }, cors);
  let payload: { email?: unknown; website?: unknown };
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, { status: "invalid", detail: "Malformed request." }, cors);
  }

  // Honeypot: real visitors never fill the hidden "website" field. Bots get a quiet success and nothing is sent.
  if (typeof payload.website === "string" && payload.website.trim() !== "") {
    return json(200, { status: env.NEWSLETTER_DOUBLE_OPT_IN === "false" ? "subscribed" : "pending_confirmation" }, cors);
  }

  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const problem = validateEmail(email);
  if (problem) return json(422, { status: "invalid", detail: problem }, cors);

  if (!env.NEWSLETTER_API_URL || !env.NEWSLETTER_API_KEY) {
    return json(503, { status: "error", detail: "Signups aren’t switched on yet. Nothing was saved." }, cors);
  }

  let extra: Record<string, unknown> = {};
  if (env.NEWSLETTER_EXTRA_JSON) {
    try {
      extra = JSON.parse(env.NEWSLETTER_EXTRA_JSON);
    } catch {
      return json(500, { status: "error", detail: "Signup is misconfigured." }, cors);
    }
  }
  const field = env.NEWSLETTER_EMAIL_FIELD || "email";
  const headerName = env.NEWSLETTER_AUTH_HEADER || "Authorization";
  const prefix = env.NEWSLETTER_AUTH_PREFIX ?? "Bearer ";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchFn(env.NEWSLETTER_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", [headerName]: `${prefix}${env.NEWSLETTER_API_KEY}` },
      body: JSON.stringify({ ...extra, [field]: email }),
      signal: ctrl.signal,
    });
  } catch {
    return json(502, { status: "error", detail: "The email service didn’t respond. Nothing was saved." }, cors);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => "");
  const dupMatch = env.NEWSLETTER_DUPLICATE_MATCH?.toLowerCase();
  const isDuplicate = list(env.NEWSLETTER_DUPLICATE_STATUS).includes(String(res.status)) || (!res.ok && !!dupMatch && text.toLowerCase().includes(dupMatch));
  if (isDuplicate) return json(200, { status: "duplicate" }, cors);
  if (res.ok) return json(200, { status: env.NEWSLETTER_DOUBLE_OPT_IN === "false" ? "subscribed" : "pending_confirmation" }, cors);
  if (res.status === 400 || res.status === 422) return json(422, { status: "invalid", detail: "The email service didn’t accept that address." }, cors);
  if (res.status === 429) return json(429, { status: "error", detail: "Too many attempts. Please wait a minute and try again." }, cors);
  // Never echo the provider's reply: it can contain account details.
  return json(502, { status: "error", detail: "The email service had a problem. Nothing was saved." }, cors);
}
