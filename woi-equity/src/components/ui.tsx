import { createContext, useContext, type ReactNode } from "react";
import type { Snapshot } from "../lib/schema";
import { humanizeStatus, isNum } from "../lib/format";

export const SnapshotContext = createContext<Snapshot | null>(null);
export const useSnapshot = () => {
  const s = useContext(SnapshotContext);
  if (!s) throw new Error("SnapshotContext missing");
  return s;
};

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

export function Panel({ title, kicker, right, children, className, pad = true, id }: {
  title?: ReactNode; kicker?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean; id?: string;
}) {
  return (
    <section id={id} className={cx("border border-ink-700 bg-ink-900", className)}>
      {(title || right) && (
        <header className="flex items-baseline justify-between gap-3 border-b border-ink-700 px-4 py-2.5">
          <div className="min-w-0">
            {kicker && <div className="label mb-0.5 text-brass-500">{kicker}</div>}
            {title && <h2 className="truncate text-[13px] font-medium tracking-wide text-ivory-100">{title}</h2>}
          </div>
          {right && <div className="shrink-0 text-2xs text-ivory-500">{right}</div>}
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

/** The only way a missing value is rendered: a dash plus the reason from the data. */
export function Missing({ reason, compact = false }: { reason?: string | null; compact?: boolean }) {
  const text = humanizeStatus(reason) ?? "Not in snapshot";
  return (
    <span className="inline-flex items-baseline gap-2" title={text}>
      <span className="font-mono text-ivory-600">—</span>
      {!compact && <span className="text-2xs leading-snug text-ivory-600">{text}</span>}
    </span>
  );
}

export function Stat({ label, value, sub, valueClass, reason, source, size = "md" }: {
  label: ReactNode; value: string | null; sub?: ReactNode; valueClass?: string; reason?: string | null; source?: string | null; size?: "sm" | "md" | "lg";
}) {
  const sz = size === "lg" ? "text-[28px] leading-8" : size === "sm" ? "text-[15px] leading-5" : "text-xl leading-7";
  return (
    <div className="min-w-0">
      <div className="label mb-1 flex items-center gap-2">{label}</div>
      {value === null ? (
        <div className="py-1"><Missing reason={reason} /></div>
      ) : (
        <div className={cx("num font-mono", sz, valueClass ?? "text-ivory-50")}>{value}</div>
      )}
      {sub && <div className="mt-1 text-2xs text-ivory-500">{sub}</div>}
      {source !== undefined && <div className="mt-1"><SourceRef refKey={source} /></div>}
    </div>
  );
}

export function SourceRef({ refKey, label }: { refKey: string | null | undefined; label?: string }) {
  const s = useSnapshot();
  if (!refKey) return <span className="text-2xs text-ivory-600">No source</span>;
  const src = s.sources[refKey];
  if (!src) return <span className="text-2xs text-down">Unresolved source “{refKey}”</span>;
  let host = src.url;
  try { host = new URL(src.url).hostname.replace(/^www\./, ""); } catch { /* keep url */ }
  return (
    <a href={src.url} target="_blank" rel="noreferrer noopener" title={`${src.description} · retrieved ${src.retrievedDate}`}
       className="group inline-flex max-w-full items-center gap-1 text-2xs text-ivory-500 hover:text-brass-300">
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-label text-ivory-600 group-hover:text-brass-500">src</span>
      <span className="truncate underline decoration-ink-600 underline-offset-2 group-hover:decoration-brass-500">{label ?? host}</span>
    </a>
  );
}

export function SourceList({ refs }: { refs: (string | null)[] }) {
  const uniq = [...new Set(refs.filter(Boolean))] as string[];
  return <div className="flex flex-wrap gap-x-3 gap-y-1">{uniq.map((r) => <SourceRef key={r} refKey={r} />)}</div>;
}

type Tone = "neutral" | "brass" | "down" | "up" | "caution" | "muted";
const toneCls: Record<Tone, string> = {
  neutral: "border-ink-600 text-ivory-300",
  brass: "border-brass-700 text-brass-300",
  down: "border-down/40 text-down",
  up: "border-up/40 text-up",
  caution: "border-caution/40 text-caution",
  muted: "border-ink-700 text-ivory-600",
};
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap border px-1.5 py-[1px] font-mono text-[10px] uppercase tracking-label", toneCls[tone], className)}>
      {children}
    </span>
  );
}

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="divide-y divide-ink-800">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-xs text-ivory-500">{k}</dt>
          <dd className="num text-right font-mono text-[13px] text-ivory-100">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Horizontal gauge of % distance from a reference (e.g. SMA200). Center line = reference. */
export function DistanceBar({ pct, range = 15, label }: { pct: number | null; range?: number; label?: string }) {
  if (!isNum(pct)) return <div className="h-4 border-y border-dashed border-ink-700" title="No data" />;
  const clamped = Math.max(-range, Math.min(range, pct));
  const w = (Math.abs(clamped) / range) * 50;
  return (
    <div className="relative h-4" role="img" aria-label={label ?? `${pct.toFixed(2)}% vs reference`}>
      <div className="absolute inset-y-1/2 left-0 right-0 h-px bg-ink-700" />
      {[-10, -5, 5, 10].filter((t) => Math.abs(t) < range).map((t) => (
        <div key={t} className="absolute top-1 h-2 w-px bg-ink-700" style={{ left: `${50 + (t / range) * 50}%` }} />
      ))}
      <div className={cx("absolute top-[5px] h-[6px]", pct < 0 ? "bg-down/70" : "bg-up/70")}
           style={pct < 0 ? { right: "50%", width: `${w}%` } : { left: "50%", width: `${w}%` }} />
      <div className="absolute inset-y-0 left-1/2 w-px bg-ivory-300" />
    </div>
  );
}

/** Sparkline from real archived points only; renders a note when fewer than 2. */
export function Sparkline({ points, height = 36 }: { points: { x: string; y: number }[]; height?: number }) {
  if (points.length < 2)
    return <div className="text-2xs text-ivory-600">{points.length === 1 ? "1 archived session: trend needs 2+" : "No archived values"}</div>;
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = max - min || 1;
  const W = 120;
  const d = points.map((p, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * W).toFixed(1)},${(height - 2 - ((p.y - min) / span) * (height - 4)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none" role="img"
         aria-label={`Archived values from ${points[0].x} to ${points[points.length - 1].x}`}>
      <path d={d} fill="none" stroke="#c2a874" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function SectionNote({ children }: { children: ReactNode }) {
  return <p className="max-w-prose text-xs leading-relaxed text-ivory-500">{children}</p>;
}

export function PageHeader({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-2 border-b border-ink-700 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="label text-brass-500">{kicker}</div>
        <h1 className="mt-1 font-serif text-[26px] leading-8 text-ivory-50">{title}</h1>
      </div>
      {children && <div className="text-xs text-ivory-500">{children}</div>}
    </div>
  );
}
