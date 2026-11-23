import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { SITE } from "../src/config/site";
import { loadLand, resetLandCache } from "../src/globe/Globe";
import { SignupProvider } from "../src/newsletter/store";
import type { SubscribeResult } from "../src/newsletter/subscribe";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function renderPage(subscribeFn: (email: string) => Promise<SubscribeResult>, mode: "demo" | "endpoint" = "endpoint") {
  const user = userEvent.setup();
  render(
    <SignupProvider subscribeFn={subscribeFn} mode={mode}>
      <App />
    </SignupProvider>,
  );
  const hero = () => screen.queryByTestId("hero-form");
  const final = () => screen.queryByTestId("final-form");
  return { user, hero, final };
}

afterEach(() => {
  vi.restoreAllMocks();
  resetLandCache();
});

describe("signup forms", () => {
  it("both forms have a visible label, an email input and the button", () => {
    renderPage(vi.fn());
    for (const id of ["hero-form", "final-form"]) {
      const f = within(screen.getByTestId(id));
      expect(f.getByLabelText("Email address")).toHaveAttribute("type", "email");
      expect(f.getByRole("button", { name: "Join the newsletter" })).toBeInTheDocument();
    }
  });

  it("invalid email: message on the submitting form only, input flagged, nothing sent", async () => {
    const fn = vi.fn();
    const { user, hero, final } = renderPage(fn);
    const input = within(hero()!).getByLabelText("Email address");
    await user.type(input, "fan@example");
    await user.click(within(hero()!).getByRole("button", { name: "Join the newsletter" }));
    expect(within(hero()!).getByRole("alert")).toHaveTextContent(/after the @/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveFocus();
    expect(within(final()!).queryByText(/after the @/)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("Enter submits; a pending request blocks repeat submissions from either form", async () => {
    const d = deferred<SubscribeResult>();
    const fn = vi.fn(() => d.promise);
    const { user, hero, final } = renderPage(fn);
    await user.type(within(hero()!).getByLabelText("Email address"), "fan@example.com{Enter}");
    const btn = within(hero()!).getByRole("button");
    expect(btn).toHaveTextContent("Joining…");
    expect(btn).toHaveAttribute("aria-busy", "true");
    await user.click(btn);
    await user.click(btn);
    await user.click(within(final()!).getByRole("button"));
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ status: "pending_confirmation", saved: true }));
    // Both forms now show the same confirmation
    expect(await screen.findByTestId("hero-result")).toHaveTextContent("Check your inbox.");
    expect(screen.getByTestId("final-result")).toHaveTextContent("Check your inbox.");
    expect(screen.getByTestId("final-result")).toHaveTextContent("fan@example.com");
  });

  it("failure keeps the email, shows the error in both forms, and allows a retry", async () => {
    const fn = vi.fn().mockResolvedValueOnce({ status: "error", saved: false, detail: "We couldn’t reach the signup service." }).mockResolvedValueOnce({ status: "subscribed", saved: true });
    const { user, hero, final } = renderPage(fn);
    await user.type(within(final()!).getByLabelText("Email address"), "fan@example.com");
    await user.click(within(final()!).getByRole("button", { name: "Join the newsletter" }));
    expect(await within(final()!).findByRole("alert")).toHaveTextContent(/didn’t go through.*Nothing was saved/);
    expect(within(final()!).getByLabelText("Email address")).toHaveValue("fan@example.com");
    expect(within(hero()!).getByLabelText("Email address")).toHaveValue("fan@example.com");
    expect(within(hero()!).getByText(/didn’t go through/)).toBeInTheDocument();
    await user.click(within(final()!).getByRole("button", { name: "Join the newsletter" }));
    expect(await screen.findByTestId("final-result")).toHaveTextContent("You’re on the list.");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("duplicate subscriptions get their own message", async () => {
    const { user, hero } = renderPage(vi.fn(async () => ({ status: "duplicate", saved: true }) as SubscribeResult));
    await user.type(within(hero()!).getByLabelText("Email address"), "fan@example.com{Enter}");
    expect(await screen.findByTestId("hero-result")).toHaveTextContent("You’re already on the list.");
  });

  it("the same address is not sent twice in one visit", async () => {
    const fn = vi.fn(async () => ({ status: "subscribed", saved: true }) as SubscribeResult);
    const { user } = renderPage(fn);
    await user.type(screen.getAllByLabelText("Email address")[0], "fan@example.com{Enter}");
    await user.click((await screen.findAllByRole("button", { name: "Use a different email" }))[1]);
    await user.type(within(screen.getByTestId("final-form")).getByLabelText("Email address"), "FAN@example.com{Enter}");
    expect(await screen.findByTestId("final-result")).toHaveTextContent(/wasn’t sent again/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("demo mode says plainly that nothing was saved", async () => {
    const { user, hero } = renderPage(async () => ({ status: "demo", saved: false }), "demo");
    expect(within(hero()!).getByTestId("demo-notice")).toHaveTextContent(/aren’t saved/);
    await user.type(within(hero()!).getByLabelText("Email address"), "fan@example.com{Enter}");
    expect(await screen.findByTestId("hero-result")).toHaveTextContent(/Demo only: not saved/);
  });
});

describe("page content and configuration", () => {
  it("has one h1 with the headline and labelled sections", () => {
    renderPage(vi.fn());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("DubNation, everywhere.");
    expect(screen.getByText("Sample edition")).toBeInTheDocument();
    expect(screen.getByText("In development")).toBeInTheDocument();
    expect(screen.getByText("Find your city. See who’s watching. Explore DubNation around the world.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get project updates by email" })).toHaveAttribute("href", "#signup");
  });

  it("every in-page link points at an element that exists", () => {
    const { container } = render(
      <SignupProvider subscribeFn={vi.fn()}>
        <App />
      </SignupProvider>,
    );
    const links = [...container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")!);
    expect(links.length).toBeGreaterThan(3);
    for (const href of links) {
      expect(href.startsWith("#")).toBe(true); // no external links render without configuration
      expect(document.getElementById(href.slice(1))).not.toBeNull();
    }
    expect(screen.getByRole("navigation", { name: "Page sections" })).toBeInTheDocument();
  });

  it("unconfigured contact, social links and social proof are not rendered", () => {
    renderPage(vi.fn());
    expect(SITE.contact.href).toBe("");
    expect(screen.queryByRole("list", { name: "Contact and social links" })).toBeNull();
    expect(screen.queryByTestId("social-proof")).toBeNull();
    expect(screen.getByText(/not affiliated with, endorsed by, or sponsored by/)).toBeInTheDocument();
  });

  it("privacy note matches demo mode", () => {
    renderPage(vi.fn());
    expect(screen.getByTestId("privacy-demo")).toHaveTextContent(/not sent anywhere or stored/);
  });

  it("city preview: arrow keys move the selection and update the panel", async () => {
    const { user } = renderPage(vi.fn());
    const group = screen.getByRole("radiogroup", { name: "Preview a city" });
    const bay = within(group).getByRole("radio", { name: "Bay Area" });
    expect(bay).toHaveAttribute("aria-checked", "true");
    bay.focus();
    await user.keyboard("{ArrowRight}");
    const tokyo = within(group).getByRole("radio", { name: "Tokyo" });
    expect(tokyo).toHaveAttribute("aria-checked", "true");
    expect(tokyo).toHaveFocus();
    expect(screen.getByTestId("city-panel")).toHaveTextContent("Tokyo");
    expect(screen.getByTestId("city-panel")).toHaveTextContent(/Planned for every city/);
    await user.keyboard("{End}");
    expect(screen.getByTestId("city-panel")).toHaveTextContent("São Paulo");
  });

  it("'Get project updates by email' moves focus to the signup field", async () => {
    const { user } = renderPage(vi.fn());
    await user.click(screen.getByRole("link", { name: "Get project updates by email" }));
    expect(document.getElementById("email-hero")).toHaveFocus();
  });
});

describe("globe resilience", () => {
  it("without canvas support the globe shows its static fallback and signup still works", async () => {
    const fn = vi.fn(async () => ({ status: "subscribed", saved: true }) as SubscribeResult);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ type: "Topology", objects: {}, arcs: [] })));
    const { user, hero } = renderPage(fn);
    await waitFor(() => expect(document.querySelectorAll('[data-globe-state="fallback"]').length).toBe(2));
    await user.type(within(hero()!).getByLabelText("Email address"), "fan@example.com{Enter}");
    expect(await screen.findByTestId("hero-result")).toBeInTheDocument();
  });
  it("a missing or broken coastline file resolves to null instead of throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("not found", { status: 404 }));
    expect(await loadLand("geo/missing.json")).toBeNull();
    resetLandCache();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{broken"));
    expect(await loadLand("geo/broken.json")).toBeNull();
    resetLandCache();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("offline"));
    expect(await loadLand("geo/offline.json")).toBeNull();
  });
});
