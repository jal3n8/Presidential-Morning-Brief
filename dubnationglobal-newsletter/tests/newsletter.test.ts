import { describe, expect, it, vi } from "vitest";
import { feedbackFor } from "../src/newsletter/messages";
import { subscribe, validateEmail } from "../src/newsletter/subscribe";

const jsonRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("email validation", () => {
  it.each(["fan@example.com", "  fan@example.com ", "first.last+dubs@sub.domain.co", "a@b.io"])("accepts %s", (e) => {
    expect(validateEmail(e)).toBeNull();
  });
  it.each([
    ["", /Enter your email/],
    ["fan", /needs an @/],
    ["fan@", /needs an @/],
    ["@example.com", /needs an @/],
    ["fan@@example.com", /extra @/],
    ["fan name@example.com", /spaces/],
    [".fan@example.com", /before the @/],
    ["fan..dubs@example.com", /before the @/],
    ["fan@example", /after the @/],
    ["fan@-example.com", /after the @/],
    [`${"a".repeat(65)}@example.com`, /doesn’t look right/],
    [`a@${"b".repeat(250)}.com`, /too long/],
  ])("rejects %j", (e, msg) => {
    expect(validateEmail(e)).toMatch(msg);
  });
});

describe("subscribe(): demo mode", () => {
  it("never claims an address was saved", async () => {
    const r = await subscribe("fan@example.com", { mode: "demo", demoDelayMs: 0 });
    expect(r).toEqual({ status: "demo", saved: false });
    expect(feedbackFor(r, "fan@example.com", { mode: "demo", doubleOptIn: true, providerName: "" }).body).toMatch(/was not sent or stored/);
  });
  it("previews duplicate and failure states with test addresses", async () => {
    expect((await subscribe("duplicate@example.com", { mode: "demo", demoDelayMs: 0 })).status).toBe("duplicate");
    const f = await subscribe("FAIL@example.com", { mode: "demo", demoDelayMs: 0 });
    expect(f.status).toBe("error");
    expect(f.saved).toBe(false);
  });
  it("rejects invalid input without any network call", async () => {
    const fetchFn = vi.fn();
    expect((await subscribe("nope", { mode: "endpoint", fetchFn })).status).toBe("invalid");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("subscribe(): endpoint mode", () => {
  const run = (res: Response | Error) => subscribe("fan@example.com", { mode: "endpoint", fetchFn: vi.fn(async () => { if (res instanceof Error) throw res; return res; }) as unknown as typeof fetch });
  it("posts JSON with the email and an empty honeypot", async () => {
    const fetchFn = vi.fn(async () => jsonRes(200, { status: "pending_confirmation" }));
    await subscribe(" fan@example.com ", { mode: "endpoint", fetchFn: fetchFn as unknown as typeof fetch });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/subscribe");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ email: "fan@example.com", website: "" });
  });
  it.each([
    [jsonRes(200, { status: "pending_confirmation" }), "pending_confirmation", true],
    [jsonRes(200, { status: "subscribed" }), "subscribed", true],
    [jsonRes(200, { status: "duplicate" }), "duplicate", true],
    [jsonRes(409, {}), "duplicate", true],
    [jsonRes(422, { status: "invalid" }), "invalid", false],
    [jsonRes(429, { status: "error" }), "error", false],
    [jsonRes(503, { status: "error", detail: "Signups aren’t switched on yet." }), "error", false],
    [new Response("<html>oops</html>", { status: 500 }), "error", false],
    [jsonRes(200, { unexpected: true }), "error", false],
  ])("maps a %#th reply", async (res, status, saved) => {
    const r = await run(res as Response);
    expect(r.status).toBe(status);
    expect(r.saved).toBe(saved);
  });
  it("reports network failures honestly", async () => {
    const r = await run(new TypeError("Failed to fetch"));
    expect(r).toMatchObject({ status: "error", saved: false });
  });
});

describe("subscribe(): provider-form mode", () => {
  it("is honest that the outcome is unknown", async () => {
    const r = await subscribe("fan@example.com", { mode: "provider-form", fetchFn: vi.fn(async () => new Response(null)) as unknown as typeof fetch });
    // no action configured in tests -> refuses rather than pretending
    expect(r.status).toBe("error");
    expect(r.detail).toMatch(/hasn’t been configured/);
  });
  it("feedback for an unverified submission never says 'saved'", () => {
    const fb = feedbackFor({ status: "submitted_unverified", saved: "unknown" }, "fan@example.com", { mode: "provider-form", doubleOptIn: true, providerName: "Example Mail" });
    expect(fb.body).toMatch(/can’t confirm/);
    expect(fb.body).toMatch(/Example Mail/);
  });
});

describe("confirmation wording follows double opt-in", () => {
  it("pending confirmation asks the reader to click the link", () => {
    expect(feedbackFor({ status: "pending_confirmation", saved: true }, "a@b.io", { mode: "endpoint", doubleOptIn: true, providerName: "" }).title).toBe("Check your inbox.");
  });
  it("single opt-in says subscribed", () => {
    expect(feedbackFor({ status: "subscribed", saved: true }, "a@b.io", { mode: "endpoint", doubleOptIn: false, providerName: "" }).title).toBe("You’re on the list.");
  });
  it("duplicate mentions unconfirmed subscriptions only with double opt-in", () => {
    const on = feedbackFor({ status: "duplicate", saved: true }, "a@b.io", { mode: "endpoint", doubleOptIn: true, providerName: "" }).body;
    const off = feedbackFor({ status: "duplicate", saved: true }, "a@b.io", { mode: "endpoint", doubleOptIn: false, providerName: "" }).body;
    expect(on).toMatch(/confirm/);
    expect(off).not.toMatch(/confirm/);
  });
});
