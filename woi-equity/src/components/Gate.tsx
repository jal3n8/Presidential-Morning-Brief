import { useAuth } from "../lib/auth";

/** Shown instead of the terminal whenever the visitor is not a confirmed subscriber or admin. */
export function Gate() {
  const auth = useAuth();
  const home = import.meta.env.BASE_URL;

  let kicker = "Research terminal";
  let title = "Sign in to continue";
  let body: React.ReactNode = "The WOI Equity research terminal is available to subscribers. Sign in with your WOI Equity account.";
  let action: React.ReactNode = <button onClick={auth.signIn} className="bg-ivory-100 px-5 py-2.5 text-[13px] font-medium text-ink-950 hover:bg-ivory-50">Sign in</button>;

  if (auth.status === "loading") {
    title = "Checking your access…";
    body = null;
    action = null;
  } else if (auth.status === "unconfigured") {
    kicker = "Locked";
    title = "The terminal is locked";
    body = "Sign-in has not been set up for this site yet, so access is denied by default. (Administrators: see START_HERE.md, step 7.)";
    action = null;
  } else if (auth.status === "error") {
    kicker = "Sign-in problem";
    title = "We couldn’t confirm your access";
    body = auth.error ?? "Please try signing in again.";
  } else if (auth.status === "signedIn" && auth.role === "public") {
    kicker = "No subscription";
    title = "Your account doesn’t include the terminal";
    body = "You are signed in, but this account has no subscriber access. If you believe this is wrong, contact WOI Equity.";
    action = <button onClick={auth.signOut} className="border border-ink-600 px-5 py-2.5 text-[13px] text-ivory-100 hover:border-ivory-500">Sign out</button>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-ink-950 text-ivory-100">
      <header className="border-b border-ink-800 px-4 py-3 sm:px-6" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <a href={home} className="flex items-center gap-2.5">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="5" fill="#1f1f1d" /><path d="M7 22 L12 11 L16 19 L20 11 L25 22" stroke="#c2a874" strokeWidth="2.2" fill="none" strokeLinejoin="round" /></svg>
          <span className="text-[13px] font-semibold tracking-[0.16em] text-ivory-50">WOI EQUITY</span>
        </a>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md border border-ink-700 bg-ink-900 p-8">
          <div className="label text-brass-500">{kicker}</div>
          <h1 className="mt-3 font-serif text-[26px] leading-tight text-ivory-50">{title}</h1>
          {body && <p className="mt-3 text-sm leading-relaxed text-ivory-500">{body}</p>}
          {action && <div className="mt-6">{action}</div>}
          <p className="mt-8 text-2xs leading-relaxed text-ivory-600">
            Sign-in is handled by our identity provider; WOI Equity never sees your password. <a href={home} className="link text-ivory-500">Back to woiequity.com</a>
          </p>
        </div>
      </main>
    </div>
  );
}
