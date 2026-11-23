import type { NewsletterMode } from "../config/site";
import type { SubscribeResult } from "./subscribe";

export interface Feedback {
  title: string;
  body: string;
  tone: "success" | "info" | "error";
}

/**
 * Honest, mode-aware wording. The page never claims an address was saved
 * unless the provider (via our endpoint) said so.
 */
export function feedbackFor(
  r: SubscribeResult,
  email: string,
  opts: { mode: NewsletterMode; doubleOptIn: boolean; providerName: string },
): Feedback {
  const service = opts.providerName || "our email service";
  const again = r.detail === "already-handled-this-session" ? " (You already sent this address from this page, so it wasn’t sent again.)" : "";
  switch (r.status) {
    case "demo":
      return {
        tone: "info",
        title: "Demo only: not saved",
        body: `${email} was not sent or stored, because this page isn’t connected to an email service yet. Once it is, you’ll ${opts.doubleOptIn ? "get a confirmation email to finish signing up" : "go straight onto the list"}.${again}`,
      };
    case "subscribed":
      return { tone: "success", title: "You’re on the list.", body: `${email} is subscribed. Every email has an unsubscribe link.${again}` };
    case "pending_confirmation":
      return {
        tone: "success",
        title: "Check your inbox.",
        body: `We sent a confirmation link to ${email}. Click it to finish subscribing. Until you do, no newsletter will arrive. Can’t find it? Look in spam or promotions.${again}`,
      };
    case "submitted_unverified":
      return {
        tone: "info",
        title: "Request sent.",
        body: `Your address went to ${service}. This page can’t see their reply, so it can’t confirm the address was saved. ${
          opts.doubleOptIn ? `Look for a confirmation email at ${email}. That’s how you’ll know it worked.` : "If nothing arrives, try again later."
        }${again}`,
      };
    case "duplicate":
      if (opts.mode === "demo")
        return { tone: "info", title: "Demo: already-subscribed state", body: `This previews what a returning subscriber sees. Nothing was checked or saved for ${email}.` };
      return {
        tone: "info",
        title: "You’re already on the list.",
        body: `${email} is already subscribed${opts.doubleOptIn ? " or waiting for you to confirm" : ""}, so nothing changed.${
          opts.doubleOptIn ? " If you never confirmed, look for the original confirmation email." : ""
        }`,
      };
    case "invalid":
      return { tone: "error", title: "Check that address.", body: r.detail || "The email service didn’t accept that address. Check for typos and try again." };
    case "error":
    default:
      return {
        tone: "error",
        title: "That didn’t go through.",
        body: `Nothing was saved. Your email is still in the box, so you can try again in a moment.${r.detail ? ` ${r.detail}` : ""}`,
      };
  }
}
