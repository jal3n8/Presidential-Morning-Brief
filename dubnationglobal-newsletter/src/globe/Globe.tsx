import { useEffect, useRef, useState } from "react";
import type { GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import { CITIES, DECORATIVE_LIGHTS, GLOBE } from "../config/site";
import { usePrefersReducedMotion } from "../lib/usePrefersReducedMotion";
import { drawGlobe, lerpRotation, rotationFor, type GlobeScene } from "./render";

export type GlobeState = "loading" | "ready" | "ready-no-land" | "fallback";

// ---- coastline data: fetched once, shared by every globe on the page -------------------
let landPromise: Promise<GeoPermissibleObjects | null> | null = null;
export function loadLand(url = GLOBE.landUrl): Promise<GeoPermissibleObjects | null> {
  if (!landPromise) {
    landPromise = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const topo = await res.json();
        if (!topo?.objects?.land) return null;
        return feature(topo, topo.objects.land) as unknown as GeoPermissibleObjects;
      } catch {
        return null; // globe still renders: sphere, lights and arcs without coastlines
      }
    })();
  }
  return landPromise;
}
/** test helper */
export function resetLandCache() {
  landPromise = null;
}

interface Props {
  variant: "hero" | "preview";
  focusCityId?: string;
  className?: string;
  /** accessible description (preview); the hero globe is decorative */
  label?: string;
  onStateChange?: (s: GlobeState) => void;
}

const FRAME_MS = 1000 / 40;

export function Globe({ variant, focusCityId, className = "", label, onStateChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  const [state, setState] = useState<GlobeState>("loading");
  const [land, setLand] = useState<GeoPermissibleObjects | null | undefined>(undefined);

  const hub = CITIES[GLOBE.hub];
  const initial: [number, number] = variant === "hero" ? rotationFor(-150, 24, 10) : rotationFor(hub.lon, hub.lat);
  const rotRef = useRef<[number, number]>(initial);
  const animRef = useRef<{ from: [number, number]; to: [number, number]; start: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; rot: [number, number] } | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const visibleRef = useRef(true);
  const drawRef = useRef<(now: number) => void>(() => {});

  useEffect(() => {
    let alive = true;
    loadLand().then((l) => alive && setLand(l));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);

  // Focus a city: animate (or jump, with reduced motion) to centre it.
  useEffect(() => {
    if (!focusCityId) return;
    const c = CITIES[focusCityId];
    if (!c) return;
    const to = rotationFor(c.lon, c.lat);
    if (reduced) {
      rotRef.current = to;
      animRef.current = null;
    } else animRef.current = { from: rotRef.current, to, start: performance.now() };
    drawRef.current(performance.now());
  }, [focusCityId, reduced]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || land === undefined) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      ctx = null;
    }
    if (!ctx) {
      setState("fallback");
      return;
    }
    const focus = focusCityId ? CITIES[focusCityId] : null;
    const scene: GlobeScene = {
      land,
      lights: DECORATIVE_LIGHTS,
      hub: [hub.lon, hub.lat],
      arcs: (variant === "hero" ? GLOBE.heroConnections : GLOBE.previewCities.filter((id) => id !== GLOBE.hub)).map((id) => [CITIES[id].lon, CITIES[id].lat]),
      focus: focus ? [focus.lon, focus.lat] : null,
    };
    const t0 = performance.now();
    let raf = 0;
    let last = 0;

    const render = (now: number) => {
      const { w, h } = sizeRef.current;
      if (!w || !h || !ctx) return;
      const a = animRef.current;
      if (a) {
        const k = Math.min(1, (now - a.start) / 1400);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        rotRef.current = lerpRotation(a.from, a.to, e);
        if (k >= 1) animRef.current = null;
      } else if (variant === "hero" && !reduced && !dragRef.current) {
        rotRef.current = [rotRef.current[0] + (now - (last || now)) * 0.0024, rotRef.current[1]];
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const radius = Math.min(w, h) * 0.41;
      try {
        drawGlobe(ctx, scene, { width: w, height: h, dpr, rotate: rotRef.current, radius, cx: w / 2, cy: h / 2, time: reduced ? null : (now - t0) / 1000 });
      } catch {
        setState("fallback");
      }
    };
    drawRef.current = render;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visibleRef.current || document.hidden) {
        last = now;
        return;
      }
      if (now - last < FRAME_MS) return;
      render(now);
      last = now;
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: rect.width, h: rect.height };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      render(performance.now());
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(wrap);
    resize();
    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([en]) => {
            visibleRef.current = en.isIntersecting;
          })
        : null;
    io?.observe(wrap);

    setState(land ? "ready" : "ready-no-land");
    // Reduced motion: one static frame (redrawn on resize / focus / drag), no loop.
    if (!reduced) raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
    };
  }, [land, reduced, variant, focusCityId, hub.lat, hub.lon]);

  // Drag to rotate (preview globe only). Horizontal drags rotate; vertical page scroll still works.
  const interactive = variant === "preview";
  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    dragRef.current = { x: e.clientX, y: e.clientY, rot: rotRef.current };
    animRef.current = null;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const k = 140 / Math.max(200, sizeRef.current.w);
    rotRef.current = [d.rot[0] + (e.clientX - d.x) * k, Math.max(-60, Math.min(60, d.rot[1] - (e.clientY - d.y) * k))];
    if (reduced) drawRef.current(performance.now());
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const showFallback = state === "fallback" || state === "loading";
  return (
    <div
      ref={wrapRef}
      className={`relative aspect-square ${className}`}
      data-globe-state={state}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {/* Static fallback: always reserves the space; visible until (or unless) the canvas draws. */}
      <div aria-hidden className={`globe-fallback absolute inset-[9%] rounded-full transition-opacity duration-700 ${showFallback ? "opacity-100" : "opacity-0"}`} />
      <canvas
        ref={canvasRef}
        aria-hidden
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`absolute inset-0 h-full w-full ${interactive ? "cursor-grab touch-pan-y active:cursor-grabbing" : "pointer-events-none"} ${state === "fallback" ? "hidden" : ""}`}
      />
    </div>
  );
}
