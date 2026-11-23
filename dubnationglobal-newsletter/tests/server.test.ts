import { describe, expect, it, vi } from "vitest";
import { handleSubscribe, type Env } from "../server/handler";
import { subscribe } from "../src/newsletter/subscribe";

const env: Env = {
  NEWSLETTER_API_URL: "https://provider.example/v1/subscribers",
  NEWSLETTER_API_KEY: "test-secret-key",
  NEWSLETTER_AUTH_PREFIX: "Token ",
  NEWSLETTER_EMAIL_FIELD: "email_address",
  NEWSLETTER_EXTRA_JSON: '{"tags":["website"]}',
  NEWSLETTER_DUPLICATE_STATUS: "409",
  NEWSLETTER_DUPLICATE_MATCH: "already",
  ALLOWED_ORIGINS: "https://dubnationglobal.com",
};
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://dubnationglobal.com/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://dubnationglobal.com", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const provider = (status: number, body = "{}") => vi.fn(async () => new Response(body, { status }));

describe("server handler", () => {
  it("forwards the email with the secret only in the server-side request", async () => {
    const fetchFn = provider(201);
    const res = await handleSubscribe(post({ email: " fan@example.com ", website: "" }), env, fetchFn as unknown as typeof fetch);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "pending_confirmation" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(env.NEWSLETTER_API_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe("Token test-secret-key");
    expect(JSON.parse(init.body as string)).toEqual({ tags: ["website"], email_address: "fan@example.com" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("reports 'subscribed' when double opt-in is off", async () => {
    const res = await handleSubscribe(post({ email: "fan@example.com" }), { ...env, NEWSLETTER_DOUBLE_OPT_IN: "false" }, provider(200) as unknown as typeof fetch);
    expect(await res.json()).toEqual({ status: "subscribed" });
  });
  it("detects duplicates by status code or by reply text", async () => {
    expect(await (await handleSubscribe(post({ email: "a@b.io" }), env, provider(409) as unknown as typeof fetch)).json()).toEqual({ status: "duplicate" });
    const r2 = await handleSubscribe(post({ email: "a@b.io" }), env, provider(400, '{"code":"email_already_exists"}') as unknown as typeof fetch);
    expect(await r2.json()).toEqual({ status: "duplicate" });
  });
  it("maps provider errors without leaking the provider's reply", async () => {
    const r = await handleSubscribe(post({ email: "a@b.io" }), env, provider(500, '{"account":"secret-detail"}') as unknown as typeof fetch);
    expect(r.status).toBe(502);
    expect(await r.text()).not.toMatch(/secret-detail/);
    expect((await handleSubscribe(post({ email: "a@b.io" }), env, provider(422) as unknown as typeof fetch)).status).toBe(422);
    expect((await handleSubscribe(post({ email: "a@b.io" }), env, provider(429) as unknown as typeof fetch)).status).toBe(429);
    const down = vi.fn(async () => { throw new TypeError("network"); });
    expect((await handleSubscribe(post({ email: "a@b.io" }), env, down as unknown as typeof fetch)).status).toBe(502);
  });
  it("rejects bad requests before contacting the provider", async () => {
    const fetchFn = provider(200);
    const f = fetchFn as unknown as typeof fetch;
    expect((await handleSubscribe(new Request("https://x/api/subscribe"), env, f)).status).toBe(405);
    expect((await handleSubscribe(post({ email: "a@b.io" }, { Origin: "https://evil.example" }), env, f)).status).toBe(403);
    expect((await handleSubscribe(post({ email: "a@b.io" }, { "Content-Type": "text/plain" }), env, f)).status).toBe(415);
    expect((await handleSubscribe(post("{not json"), env, f)).status).toBe(400);
    expect((await handleSubscribe(post({ email: "x".repeat(3000) }), env, f)).status).toBe(413);
    expect((await handleSubscribe(post({ email: "not-an-email" }), env, f)).status).toBe(422);
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("silently drops bot submissions caught by the honeypot", async () => {
    const fetchFn = provider(200);
    const r = await handleSubscribe(post({ email: "a@b.io", website: "http://spam" }), env, fetchFn as unknown as typeof fetch);
    expect(r.status).toBe(200);
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("refuses honestly when the provider is not configured", async () => {
    const r = await handleSubscribe(post({ email: "a@b.io" }), {}, provider(200) as unknown as typeof fetch);
    expect(r.status).toBe(503);
    expect((await r.json()).detail).toMatch(/Nothing was saved/);
  });
  it("end to end: browser integration -> server function -> provider", async () => {
    const prov = provider(201);
    const browserFetch = (async (url: string, init: RequestInit) =>
      handleSubscribe(new Request(new URL(url, "https://dubnationglobal.com"), { ...init, headers: { ...(init.headers as Record<string, string>), Origin: "https://dubnationglobal.com" } }), env, prov as unknown as typeof fetch)) as unknown as typeof fetch;
    expect(await subscribe("fan@example.com", { mode: "endpoint", fetchFn: browserFetch })).toEqual({ status: "pending_confirmation", saved: true });
    const dupProv = provider(409);
    const dupFetch = (async (url: string, init: RequestInit) => handleSubscribe(new Request(new URL(url, "https://dubnationglobal.com"), init), env, dupProv as unknown as typeof fetch)) as unknown as typeof fetch;
    expect((await subscribe("fan@example.com", { mode: "endpoint", fetchFn: dupFetch })).status).toBe("duplicate");
  });
});
