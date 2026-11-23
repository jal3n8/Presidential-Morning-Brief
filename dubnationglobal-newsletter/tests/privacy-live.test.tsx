import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("privacy note when a provider is connected", () => {
  it("names the provider and explains confirmation, storage and unsubscribing", async () => {
    vi.resetModules();
    vi.doMock("../src/config/site", async (orig) => {
      const real = await orig<typeof import("../src/config/site")>();
      return {
        ...real,
        NEWSLETTER: { ...real.NEWSLETTER, mode: "endpoint", providerName: "Example Mail", providerPrivacyUrl: "https://mail.example/privacy", doubleOptIn: true },
      };
    });
    const { PrivacyNote } = await import("../src/components/Footer");
    render(<PrivacyNote />);
    const note = screen.getByTestId("privacy-live");
    expect(note).toHaveTextContent(/your email address, used only to send/);
    expect(note).toHaveTextContent(/stored by Example Mail/);
    expect(note).toHaveTextContent(/doesn’t store it/);
    expect(note).toHaveTextContent(/confirm by email before you’re added/);
    expect(note).toHaveTextContent(/unsubscribe, use the link at the bottom of any email/);
    expect(screen.getByRole("link", { name: "their privacy policy" })).toHaveAttribute("href", "https://mail.example/privacy");
    vi.doUnmock("../src/config/site");
  });
});
