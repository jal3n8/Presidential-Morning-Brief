/** Scrolls to the hero signup and puts the cursor in the email field (keyboard friendly). */
export function focusSignup(targetId = "signup", inputId = "email-hero") {
  const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const target = document.getElementById(targetId);
  target?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  if (input) input.focus({ preventScroll: true });
  else target?.focus({ preventScroll: true });
  if (history.replaceState) history.replaceState(null, "", `#${targetId}`);
}
