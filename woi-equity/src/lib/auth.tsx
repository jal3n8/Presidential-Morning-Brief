import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { UserManager, WebStorageStateStore } from "oidc-client-ts";
import { MeSchema, type Role } from "./schema";

/**
 * Sign-in through an established identity provider (Auth0 by default) using
 * the standard OpenID Connect Authorization Code flow with PKCE
 * (oidc-client-ts). WOI Equity never sees or stores passwords.
 *
 * The browser holds a short-lived access token (sessionStorage) and sends it
 * as "Authorization: Bearer" to /api. The SERVER verifies it and decides the
 * role on every request; the role shown here (from /api/me.php) only
 * decides which screens to draw.
 *
 * Build-time settings (public identifiers, not secrets):
 *   VITE_AUTH_AUTHORITY  e.g. https://woiequity.us.auth0.com/
 *   VITE_AUTH_CLIENT_ID  the SPA application's client id
 *   VITE_AUTH_AUDIENCE   e.g. https://woiequity.com/api
 */

const env = import.meta.env as Record<string, string | undefined>;
const BASE = import.meta.env.BASE_URL ?? "/";

export type AuthStatus = "loading" | "unconfigured" | "signedOut" | "signedIn" | "preview" | "error";

export type AuthState = {
  status: AuthStatus;
  role: Role | null;
  name: string | null;
  error: string | null;
  signIn: () => void;
  signOut: () => void;
  /** Current access token, refreshing it if needed. null when signed out. */
  getToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthState | null>(null);
export const useAuth = () => {
  const a = useContext(AuthContext);
  if (!a) throw new Error("AuthProvider missing");
  return a;
};

export function authSettings() {
  const authority = env.VITE_AUTH_AUTHORITY?.trim();
  const clientId = env.VITE_AUTH_CLIENT_ID?.trim();
  const audience = env.VITE_AUTH_AUDIENCE?.trim();
  if (!authority || !clientId || !audience || !/^https:\/\/[^/\s]+\/$/.test(authority)) return null;
  return { authority, clientId, audience };
}

/**
 * Local preview without sign-in exists ONLY in the development server
 * (`npm run dev`). In a production build import.meta.env.DEV is the constant
 * false, so this branch and its data source are removed from the bundle.
 */
export const DEV_PREVIEW = import.meta.env.DEV && env.VITE_DEV_PREVIEW !== "0";

let manager: UserManager | null = null;
function getManager(): UserManager | null {
  const s = authSettings();
  if (!s) return null;
  if (!manager) {
    const origin = window.location.origin;
    manager = new UserManager({
      authority: s.authority,
      client_id: s.clientId,
      redirect_uri: `${origin}${BASE}dashboard/`,
      post_logout_redirect_uri: `${origin}${BASE}`,
      response_type: "code",
      scope: "openid profile email offline_access",
      extraQueryParams: { audience: s.audience },
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
      automaticSilentRenew: true,
      loadUserInfo: false,
      monitorSession: false,
    });
  }
  return manager;
}

async function fetchRole(token: string): Promise<Role> {
  const res = await fetch(`${BASE}api/me.php`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (res.status === 401) throw new Error("Your session is not valid. Please sign in again.");
  if (!res.ok) throw new Error(`The server could not confirm your access (HTTP ${res.status}).`);
  return MeSchema.parse(await res.json()).role;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (DEV_PREVIEW) {
      setStatus("preview");
      setRole("admin");
      setName("Local preview");
      return;
    }
    const mgr = getManager();
    if (!mgr) {
      setStatus("unconfigured");
      return;
    }
    (async () => {
      try {
        const q = new URLSearchParams(window.location.search);
        if (q.has("code") && q.has("state")) {
          await mgr.signinRedirectCallback();
          window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
        } else if (q.has("error")) {
          throw new Error(q.get("error_description") || "Sign-in was not completed.");
        }
        let user = await mgr.getUser();
        if (user?.expired) user = await mgr.signinSilent().catch(() => null);
        if (!user) {
          setStatus("signedOut");
          return;
        }
        setName((user.profile.name as string | undefined) ?? (user.profile.email as string | undefined) ?? null);
        setRole(await fetchRole(user.access_token));
        setStatus("signedIn");
      } catch (e) {
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
        await mgr.removeUser().catch(() => undefined);
        setError((e as Error).message);
        setStatus("error");
      }
    })();
  }, []);

  const signIn = useCallback(() => {
    const mgr = getManager();
    if (mgr) void mgr.signinRedirect({ state: { hash: window.location.hash } });
  }, []);

  const signOut = useCallback(() => {
    const mgr = getManager();
    const s = authSettings();
    if (!mgr || !s) return;
    void (async () => {
      await mgr.removeUser();
      try {
        await mgr.signoutRedirect();
      } catch {
        // Providers without RP-initiated logout: use Auth0's logout endpoint.
        const u = new URL("v2/logout", s.authority);
        u.searchParams.set("client_id", s.clientId);
        u.searchParams.set("returnTo", `${window.location.origin}${BASE}`);
        window.location.assign(u.toString());
      }
    })();
  }, []);

  const getToken = useCallback(async () => {
    if (DEV_PREVIEW) return null;
    const mgr = getManager();
    if (!mgr) return null;
    let user = await mgr.getUser();
    if (!user || user.expired || (user.expires_in ?? 0) < 30) user = await mgr.signinSilent().catch(() => null);
    if (!user) {
      setStatus("signedOut");
      return null;
    }
    return user.access_token;
  }, []);

  const value = useMemo(() => ({ status, role, name, error, signIn, signOut, getToken }), [status, role, name, error, signIn, signOut, getToken]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const canSee = (role: Role | null, min: Role) => {
  const rank = { public: 0, subscriber: 1, admin: 2 } as const;
  return role !== null && rank[role] >= rank[min];
};
