/**
 * Lightweight 2D-canvas globe: orthographic projection (d3-geo), translucent "smoky" sphere,
 * faint coastlines, decorative gold city lights and lifted great-circle arcs.
 * No WebGL, no textures: ~25 KB of code plus a 55 KB coastline file.
 */
import { geoGraticule10, geoInterpolate, geoOrthographic, geoPath, geoRotation, type GeoPermissibleObjects } from "d3-geo";

export interface GlobeScene {
  land: GeoPermissibleObjects | null;
  lights: [number, number][];
  hub: [number, number] | null;
  arcs: [number, number][]; // destinations connected to the hub
  focus: [number, number] | null; // highlighted city
}

export interface View {
  width: number;
  height: number;
  dpr: number;
  /** [lambda, phi] rotation in degrees (d3 convention: centre = [-lambda, -phi]) */
  rotate: [number, number];
  /** sphere radius in CSS px */
  radius: number;
  cx: number;
  cy: number;
  /** seconds, drives pulses; null = static */
  time: number | null;
}

const GOLD = "245,185,48";
const GOLD_SOFT = "255,215,114";
const BLUE = "70,120,220";

let sprite: HTMLCanvasElement | null = null;
/** Pre-rendered glow dot, drawn with drawImage (much cheaper than per-light gradients). */
function glowSprite(): HTMLCanvasElement {
  if (sprite) return sprite;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, `rgba(${GOLD_SOFT},1)`);
  grd.addColorStop(0.18, `rgba(${GOLD},0.85)`);
  grd.addColorStop(0.45, `rgba(${GOLD},0.22)`);
  grd.addColorStop(1, `rgba(${GOLD},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  sprite = c;
  return c;
}

/** Orthographic coordinates of a lon/lat after rotation, with an optional lift above the surface. */
function project(rot: (p: [number, number]) => [number, number], lon: number, lat: number, lift = 0) {
  const [l, p] = rot([lon, lat]);
  const lr = (l * Math.PI) / 180;
  const pr = (p * Math.PI) / 180;
  const k = 1 + lift;
  return { x: Math.cos(pr) * Math.sin(lr) * k, y: Math.sin(pr) * k, z: Math.cos(pr) * Math.cos(lr) };
}

/** Is a projected point visible (front hemisphere, or lifted beyond the silhouette)? */
function visible(pt: { x: number; y: number; z: number }) {
  return pt.z > 0 || Math.hypot(pt.x, pt.y) > 1;
}

export function drawGlobe(ctx: CanvasRenderingContext2D, scene: GlobeScene, v: View) {
  const { width, height, dpr, radius: r, cx, cy } = v;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // 1. Atmosphere halo (circular and kept inside the canvas, so it never shows a square edge)
  const haloR = Math.max(r * 1.02, Math.min(r * 1.45, cx, cy, width - cx, height - cy));
  const halo = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, haloR);
  halo.addColorStop(0, `rgba(${BLUE},0.28)`);
  halo.addColorStop(0.4, `rgba(${BLUE},0.09)`);
  halo.addColorStop(1, `rgba(${BLUE},0)`);
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
  ctx.fillStyle = halo;
  ctx.fill();

  // 2. Translucent body, lit from the upper left
  const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
  body.addColorStop(0, "rgba(38,74,150,0.55)");
  body.addColorStop(0.55, "rgba(14,30,70,0.55)");
  body.addColorStop(1, "rgba(4,8,20,0.75)");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();

  const projection = geoOrthographic().scale(r).translate([cx, cy]).rotate([v.rotate[0], v.rotate[1], 0]).clipAngle(90).precision(0.6);
  const path = geoPath(projection, ctx);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // 3. Drifting smoke inside the sphere
  const t = v.time ?? 0;
  for (let i = 0; i < 4; i++) {
    const a = t * 0.05 + i * 1.7;
    const sx = cx + Math.cos(a) * r * 0.45;
    const sy = cy + Math.sin(a * 1.3) * r * 0.35;
    const sm = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 0.7);
    sm.addColorStop(0, "rgba(150,180,240,0.07)");
    sm.addColorStop(1, "rgba(150,180,240,0)");
    ctx.fillStyle = sm;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // 4. Faint graticule
  ctx.beginPath();
  path(geoGraticule10());
  ctx.strokeStyle = "rgba(160,190,255,0.06)";
  ctx.lineWidth = 0.6;
  ctx.stroke();

  // 5. Land: soft fill + fine coastline
  if (scene.land) {
    ctx.beginPath();
    path(scene.land);
    ctx.fillStyle = "rgba(150,180,235,0.10)";
    ctx.fill();
    ctx.strokeStyle = "rgba(190,210,255,0.22)";
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  ctx.restore();

  // 6. Rim light
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(140,175,255,0.35)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const rot = geoRotation([v.rotate[0], v.rotate[1], 0]) as unknown as (p: [number, number]) => [number, number];
  const spr = glowSprite();

  // 7. Decorative city lights (illustrative only)
  for (let i = 0; i < scene.lights.length; i++) {
    const [lon, lat] = scene.lights[i];
    const p = project(rot, lon, lat);
    if (p.z <= 0.04) continue;
    const twinkle = v.time === null ? 1 : 0.75 + 0.25 * Math.sin(v.time * 1.3 + i * 2.1);
    const size = (5 + (i % 3) * 2) * (0.6 + 0.4 * p.z) * twinkle;
    ctx.globalAlpha = 0.35 + 0.55 * p.z;
    ctx.drawImage(spr, cx + p.x * r - size, cy - p.y * r - size, size * 2, size * 2);
  }
  ctx.globalAlpha = 1;

  // 8. Gold connections from the hub (lifted great circles)
  if (scene.hub) {
    const [hLon, hLat] = scene.hub;
    scene.arcs.forEach(([dLon, dLat], ai) => {
      const interp = geoInterpolate([hLon, hLat], [dLon, dLat]);
      const N = 72;
      const pts = Array.from({ length: N + 1 }, (_, k) => {
        const tt = k / N;
        const [lon, lat] = interp(tt);
        return project(rot, lon, lat, Math.sin(Math.PI * tt) * 0.16);
      });
      const focused = scene.focus && scene.focus[0] === dLon && scene.focus[1] === dLat;
      const drawSeg = (from: number, to: number, alpha: number, width: number) => {
        ctx.beginPath();
        let open = false;
        for (let k = from; k <= to; k++) {
          const p = pts[k];
          if (!visible(p)) {
            open = false;
            continue;
          }
          const X = cx + p.x * r;
          const Y = cy - p.y * r;
          if (open) ctx.lineTo(X, Y);
          else ctx.moveTo(X, Y);
          open = true;
        }
        ctx.strokeStyle = `rgba(${GOLD},${alpha})`;
        ctx.lineWidth = width;
        ctx.stroke();
      };
      drawSeg(0, N, focused ? 0.75 : 0.38, focused ? 1.8 : 1.1);
      if (v.time !== null) {
        // travelling pulse from the Bay Area outwards
        const phase = ((v.time * 0.28 + ai * 0.27) % 1) * N;
        const head = Math.floor(phase);
        drawSeg(Math.max(0, head - 10), head, 0.95, 2.2);
      }
    });
  }

  // 9. Hub and focus markers
  const marker = (lon: number, lat: number, strong: boolean) => {
    const p = project(rot, lon, lat);
    if (p.z <= 0) return;
    const X = cx + p.x * r;
    const Y = cy - p.y * r;
    const s = strong ? 22 : 15;
    ctx.drawImage(spr, X - s, Y - s, s * 2, s * 2);
    ctx.beginPath();
    ctx.arc(X, Y, strong ? 3.4 : 2.6, 0, Math.PI * 2);
    ctx.fillStyle = "#FFF4D6";
    ctx.fill();
    if (strong) {
      const ring = v.time === null ? 0.5 : (v.time * 0.6) % 1;
      ctx.beginPath();
      ctx.arc(X, Y, 6 + ring * 16, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${GOLD},${0.7 * (1 - ring)})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  };
  if (scene.hub) marker(scene.hub[0], scene.hub[1], !scene.focus);
  for (const [lon, lat] of scene.arcs) marker(lon, lat, !!scene.focus && scene.focus[0] === lon && scene.focus[1] === lat);
  if (scene.focus && scene.hub && scene.focus[0] === scene.hub[0] && scene.focus[1] === scene.hub[1]) marker(scene.hub[0], scene.hub[1], true);
}

/** Rotation that centres a lon/lat, slightly tilted so the northern hemisphere reads well. */
export function rotationFor(lon: number, lat: number, tilt = 12): [number, number] {
  return [-lon, -lat + tilt];
}

/** Shortest-path interpolation between two rotations. */
export function lerpRotation(a: [number, number], b: [number, number], t: number): [number, number] {
  const d = ((b[0] - a[0] + 540) % 360) - 180;
  return [a[0] + d * t, a[1] + (b[1] - a[1]) * t];
}
