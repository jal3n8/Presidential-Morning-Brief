import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Tracks the visitor's operating-system "reduce motion" setting, live. */
export function usePrefersReducedMotion(): boolean {
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
  const [reduced, setReduced] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(QUERY);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}
