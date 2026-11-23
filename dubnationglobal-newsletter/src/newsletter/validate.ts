/** Email validation shared by the browser forms and the server function (no dependencies). */

const MAX_EMAIL = 254;

/** Returns a visitor-friendly error message, or null when the address looks deliverable. */
export function validateEmail(raw: string): string | null {
  const email = raw.trim();
  if (!email) return "Enter your email address.";
  if (email.length > MAX_EMAIL) return "That email address is too long.";
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return "That doesn’t look like an email address. It needs an @ and a domain, like name@example.com.";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || /\s/.test(email) || email.indexOf("@") !== at) return "That email address doesn’t look right. Check for spaces or an extra @.";
  if (!/^[^\s@]+$/.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return "Check the part before the @. It has a stray dot or character.";
  if (!/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) return "Check the part after the @. It should look like example.com.";
  return null;
}

export function normaliseEmail(raw: string): string {
  return raw.trim();
}
