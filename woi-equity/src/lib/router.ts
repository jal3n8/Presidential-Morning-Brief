import { useEffect, useState } from "react";

/** Hash routing: works on any static host with no rewrite rules. */
export type Route =
  | { name: "command" }
  | { name: "watchlist" }
  | { name: "stock"; symbol: string }
  | { name: "regime" }
  | { name: "washout" }
  | { name: "club3030" }
  | { name: "macro" }
  | { name: "research"; q?: string }
  | { name: "history" }
  | { name: "system" }
  | { name: "import" }
  | { name: "admin" };

export function parseHash(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const seg = path.split("/").filter(Boolean);
  const params = new URLSearchParams(query);
  switch (seg[0]) {
    case "watchlist": return { name: "watchlist" };
    case "stock": return seg[1] ? { name: "stock", symbol: decodeURIComponent(seg[1]).toUpperCase() } : { name: "watchlist" };
    case "regime": return { name: "regime" };
    case "washout": return { name: "washout" };
    case "club3030": return { name: "club3030" };
    case "macro": return { name: "macro" };
    case "research": return { name: "research", q: params.get("q") ?? undefined };
    case "history": return { name: "history" };
    case "system": return { name: "system" };
    case "import": return { name: "import" };
    case "admin": return { name: "admin" };
    default: return { name: "command" };
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const href = (path: string) => `#/${path.replace(/^\//, "")}`;
