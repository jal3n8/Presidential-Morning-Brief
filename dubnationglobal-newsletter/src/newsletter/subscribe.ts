/**
 * Newsletter integration layer: the ONLY place that knows how a signup is sent.
 * UI components call `subscribe(email)` and render whatever outcome comes back.
 */
import { NEWSLETTER, type NewsletterMode } from "../config/site";

export type SubscribeStatus =
  | "subscribed" // provider confirmed the address is on the list
  | "pending_confirmation" // provider accepted; subscriber must click the confirmation email
  | "submitted_unverified" // sent to a provider form we cannot read the reply from
  | "duplicate" // already subscribed (or already awaiting confirmation)
  | "demo" // demo mode: nothing was sent or stored
  | "invalid" // rejected as an invalid address
  | "error"; // anything else; the email is preserved so the visitor can retry

export interface SubscribeResult {
  status: SubscribeStatus;
  /** true only when a provider has confirmed it stored the address */
  saved: boolean | "unknown";
  /** optional detail for the visitor (never contains secrets) */
  detail?: string;
}

export { normaliseEmail, validateEmail } from "./validate";
import { normaliseEmail, validateEmail } from "./validate";

// ---------------------------------------------------------------------------------------
// Demo mode. Special addresses let you preview every state:
//   duplicate@example.com  -> already subscribed
//   fail@example.com       -> provider/network failure
//   slow@example.com       -> long pending state
// ---------------------------------------------------------------------------------------
export const DEMO_TRIGGERS = {
  duplicate: "duplicate@example.com",
  fail: "fail@example.com",
  slow: "slow@example.com",
} as const;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function demoSubscribe(email: string, delayMs: number): Promise<SubscribeResult> {
  const e = email.toLowerCase();
  await wait(e === DEMO_TRIGGERS.slow ? delayMs * 4 : delayMs);
  if (e === DEMO_TRIGGERS.fail) return { status: "error", saved: false, detail: "Demo failure: this simulates the email service being unreachable." };
  if (e === DEMO_TRIGGERS.duplicate) return { status: "duplicate", saved: false };
  return { status: "demo", saved: false };
}

// ---------------------------------------------------------------------------------------
// Endpoint mode: POST JSON to our own server function, which holds the provider secret.
// Response contract (see server/handler.ts): { status: SubscribeStatus, detail?: string }
// ---------------------------------------------------------------------------------------
async function endpointSubscribe(email: string, fetchFn: typeof fetch, url: string, timeoutMs: number): Promise<SubscribeResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, website: "" }), // "website" is an empty honeypot field
      signal: ctrl.signal,
      credentials: "same-origin",
    });
    let body: { status?: string; detail?: string } = {};
    try {
      body = await res.json();
    } catch {
      /* non-JSON reply: handled by status code below */
    }
    const s = body.status;
    if (res.ok && (s === "subscribed" || s === "pending_confirmation")) return { status: s, saved: true };
    if (s === "duplicate" || res.status === 409) return { status: "duplicate", saved: true };
    if (s === "invalid" || res.status === 422 || res.status === 400) return { status: "invalid", saved: false, detail: body.detail };
    if (res.status === 429) return { status: "error", saved: false, detail: "Too many attempts. Please wait a minute and try again." };
    return { status: "error", saved: false, detail: body.detail };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return { status: "error", saved: false, detail: aborted ? "The request timed out." : "We couldn’t reach the signup service." };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------
// Provider-form mode: the provider's public embed form endpoint (no secret needed).
// Browsers block reading cross-site replies, so the outcome cannot be confirmed here.
// ---------------------------------------------------------------------------------------
async function providerFormSubscribe(email: string, fetchFn: typeof fetch, action: string, field: string): Promise<SubscribeResult> {
  if (!action) return { status: "error", saved: false, detail: "The newsletter form address hasn’t been configured yet." };
  try {
    const body = new FormData();
    body.set(field, email);
    await fetchFn(action, { method: "POST", mode: "no-cors", body });
    return { status: "submitted_unverified", saved: "unknown" };
  } catch {
    return { status: "error", saved: false, detail: "We couldn’t reach the signup service." };
  }
}

export interface SubscribeOptions {
  mode?: NewsletterMode;
  fetchFn?: typeof fetch;
  demoDelayMs?: number;
}

/** The single integration function. Swap or extend providers here without touching the UI. */
export async function subscribe(rawEmail: string, opts: SubscribeOptions = {}): Promise<SubscribeResult> {
  const email = normaliseEmail(rawEmail);
  if (validateEmail(email)) return { status: "invalid", saved: false };
  const mode = opts.mode ?? NEWSLETTER.mode;
  const fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  if (mode === "endpoint") return endpointSubscribe(email, fetchFn, NEWSLETTER.endpoint, NEWSLETTER.requestTimeoutMs);
  if (mode === "provider-form") return providerFormSubscribe(email, fetchFn, NEWSLETTER.providerForm.action, NEWSLETTER.providerForm.emailField);
  return demoSubscribe(email, opts.demoDelayMs ?? 900);
}
