import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fmtUtc, provenanceLine, VERIFICATION_TEXT } from "../lib/format";
import type { Series, VerificationLevel } from "../lib/types";

export type Tone = "gain" | "risk" | "gold" | "muted" | "paper";

const toneText: Record<Tone, string> = {
  gain: "text-gain",
  risk: "text-risk",
  gold: "text-gold",
  muted: "text-muted",
  paper: "text-paper",
};

export function toneOf(x: number | null | undefined, invert = false): Tone {
  if (x === null || x === undefined || x === 0) return "paper";
  return (x > 0) !== invert ? "gain" : "risk";
}

export function Card({ title, subtitle, right, children, className = "" }: { title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-panel p-4 sm:p-5 ${className}`}>
      {(title || right) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs text-muted/80">{subtitle}</p>}
          </div>
          {right && <div className="max-w-full">{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ tone = "muted", children, title, className = "whitespace-nowrap" }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  const map: Record<Tone, string> = {
    gain: "border-gain/40 text-gain bg-gain/10",
    risk: "border-risk/40 text-risk bg-risk/10",
    gold: "border-gold/40 text-gold bg-gold/10",
    muted: "border-line text-muted bg-ink/40",
    paper: "border-paper/30 text-paper bg-paper/5",
  };
  return (
    <span title={title} className={`inline-flex items-center gap-1 ${className} rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ${map[tone]}`}>
      {children}
    </span>
  );
}

/** Accessible tooltip: opens on hover, keyboard focus or tap; positioned inside the viewport. */
export function Info({ text, label = "More information" }: { text: ReactNode; label?: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const w = Math.min(256, window.innerWidth - 16);
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8)) });
  };
  const close = () => setPos(null);
  useEffect(() => {
    if (!pos) return;
    const off = () => setPos(null);
    window.addEventListener("scroll", off, true);
    window.addEventListener("resize", off);
    return () => {
      window.removeEventListener("scroll", off, true);
      window.removeEventListener("resize", off);
    };
  }, [pos]);
  return (
    <span className="inline-flex align-middle" onMouseLeave={close}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={pos !== null}
        onMouseEnter={(e) => open(e.currentTarget)}
        onFocus={(e) => open(e.currentTarget)}
        onBlur={close}
        onClick={(e) => (pos ? close() : open(e.currentTarget))}
        onKeyDown={(e) => e.key === "Escape" && close()}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-line text-[10px] leading-none text-muted hover:border-gold hover:text-gold focus:border-gold focus:text-gold focus:outline-none"
      >
        i
      </button>
      {pos && (
        <span
          role="tooltip"
          style={{ top: pos.top, left: pos.left, width: Math.min(256, window.innerWidth - 16) }}
          className="pointer-events-none fixed z-50 rounded-lg border border-line bg-ink p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-paper/90 shadow-xl"
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function Stat({ label, value, sub, tone = "paper", info, large = false }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone; info?: ReactNode; large?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
        {label}
        {info && <Info text={info} />}
      </div>
      <div className={`num mt-1 font-semibold ${large ? "text-3xl sm:text-4xl" : "text-xl"} ${toneText[tone]}`}>{value}</div>
      {sub && <div className="num mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function VerificationBadge({ level }: { level: VerificationLevel }) {
  const v = VERIFICATION_TEXT[level];
  return <Badge tone={v.tone}>{v.short}</Badge>;
}

export function Provenance({ series, className = "" }: { series: Series; className?: string }) {
  return (
    <p className={`text-[11px] leading-relaxed text-muted ${className}`} data-testid="provenance">
      <span className="text-muted/70">Source: </span>
      {provenanceLine(series)}
    </p>
  );
}

export function Notice({ tone = "gold", children }: { tone?: Tone; children: ReactNode }) {
  const map: Record<Tone, string> = {
    gold: "border-gold/40 bg-gold/5 text-paper/90",
    risk: "border-risk/50 bg-risk/10 text-paper",
    gain: "border-gain/40 bg-gain/5 text-paper/90",
    muted: "border-line bg-panel text-muted",
    paper: "border-line bg-panel text-paper",
  };
  return <div className={`rounded-lg border px-4 py-3 text-sm ${map[tone]}`}>{children}</div>;
}

export function Button({ children, onClick, variant = "secondary", type = "button", disabled, title }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger"; type?: "button" | "submit"; disabled?: boolean; title?: string }) {
  const map = {
    primary: "bg-gold text-ink hover:bg-gold/90 border-gold",
    secondary: "bg-panel2 text-paper hover:border-gold/60 border-line",
    ghost: "bg-transparent text-muted hover:text-paper border-transparent",
    danger: "bg-transparent text-risk hover:bg-risk/10 border-risk/40",
  };
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${map[variant]}`}>
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted/80">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm text-paper placeholder:text-muted/60 focus:border-gold focus:outline-none";

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** tooltip shown next to the header (kept outside the sort button) */
  info?: ReactNode;
  value: (row: T) => number | string | null;
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
}

/** Sortable, horizontally scrollable table. Nulls always sort last. */
export function SortableTable<T>({ rows, columns, initialSort, rowKey, maxRows, empty = "No rows." }: { rows: T[]; columns: Column<T>[]; initialSort?: { key: string; dir: "asc" | "desc" }; rowKey: (r: T, i: number) => string; maxRows?: number; empty?: ReactNode }) {
  const [sort, setSort] = useState(initialSort ?? { key: columns[0].key, dir: "asc" as const });
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) ?? columns[0];
    const out = [...rows];
    out.sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === "asc" ? c : -c;
    });
    return maxRows ? out.slice(0, maxRows) : out;
  }, [rows, columns, sort, maxRows]);
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            {columns.map((c) => {
              const active = sort.key === c.key;
              return (
                <th key={c.key} scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`whitespace-nowrap px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted ${c.align === "right" ? "text-right" : "text-left"}`}>
                  <button type="button" className={`inline-flex items-center gap-1 hover:text-paper ${active ? "text-gold" : ""}`} onClick={() => setSort({ key: c.key, dir: active && sort.dir === "desc" ? "asc" : "desc" })}>
                    {c.header}
                    <span aria-hidden className="text-[9px]">{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                  </button>
                  {c.info && <Info text={c.info} />}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={rowKey(r, i)} className="border-b border-line/60 last:border-0 hover:bg-panel2/60">
              {columns.map((c) => (
                <td key={c.key} className={`num whitespace-nowrap px-3 py-2 ${c.align === "right" ? "text-right" : "text-left"} ${c.className ?? ""}`}>
                  {c.render ? c.render(r) : (c.value(r) ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Timestamp({ iso, prefix }: { iso: string; prefix?: string }) {
  return (
    <span className="num" title={iso}>
      {prefix}
      {fmtUtc(iso)}
    </span>
  );
}

export function SegmentedControl<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-ink p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${value === o.value ? "bg-panel2 text-gold" : "text-muted hover:text-paper"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
