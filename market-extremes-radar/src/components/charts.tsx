import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
  Legend,
} from "recharts";
import type { Num } from "../lib/indicators";
import { fmtNum, fmtPct } from "../lib/format";

export const C = {
  paper: "#F3F0E8",
  muted: "#9AA6B2",
  gold: "#C9A45C",
  risk: "#D96B66",
  gain: "#55B39A",
  line: "#26313D",
  steel: "#7C93B0",
  ink: "#0B1117",
};

const axis = { stroke: C.muted, fontSize: 11, tickLine: false, axisLine: { stroke: C.line } } as const;
const tooltipStyle = {
  contentStyle: { background: C.ink, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12, color: C.paper },
  labelStyle: { color: C.muted, marginBottom: 4 },
  itemStyle: { padding: 0 },
};

const shortDate = (d: string) => {
  const [y, m] = d.split("-");
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${y.slice(2)}`;
};

/** First session of each month, thinned so at most `max` ticks are drawn (avoids duplicate month labels). */
export function monthTicks(dates: readonly string[], max = 8): string[] {
  const firsts = dates.filter((d, i) => i === 0 || d.slice(0, 7) !== dates[i - 1].slice(0, 7)).slice(1);
  const step = Math.max(1, Math.ceil(firsts.length / max));
  return firsts.filter((_, i) => i % step === 0);
}

export interface PricePoint {
  date: string;
  close: number;
  sma20: Num;
  sma50: Num;
  sma200: Num;
}

export function PriceChart({ data, height = 300 }: { data: PricePoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.line} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="date" {...axis} tickFormatter={shortDate} ticks={monthTicks(data.map((d) => d.date))} interval={0} />
        <YAxis {...axis} domain={["auto", "auto"]} width={56} tickFormatter={(v: number) => fmtNum(v, 0)} />
        <Tooltip {...tooltipStyle} formatter={(v) => fmtNum(v as number)} />
        <Legend wrapperStyle={{ fontSize: 11, color: C.muted }} iconType="plainline" />
        <Line name="Close" dataKey="close" stroke={C.paper} dot={false} strokeWidth={1.6} isAnimationActive={false} />
        <Line name="SMA20" dataKey="sma20" stroke={C.muted} dot={false} strokeWidth={1} strokeDasharray="3 3" isAnimationActive={false} connectNulls={false} />
        <Line name="SMA50" dataKey="sma50" stroke={C.gold} dot={false} strokeWidth={1.2} isAnimationActive={false} connectNulls={false} />
        <Line name="SMA200" dataKey="sma200" stroke={C.steel} dot={false} strokeWidth={1.2} isAnimationActive={false} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Single indicator panel with labelled threshold lines. */
export function IndicatorChart({
  data,
  dataKey,
  name,
  refs,
  domain,
  height = 140,
  digits = 1,
  color = C.gold,
}: {
  data: { date: string; [k: string]: Num | string }[];
  dataKey: string;
  name: string;
  refs: { y: number; label: string; tone: "risk" | "gain" | "muted" }[];
  domain?: [number | "auto", number | "auto"];
  height?: number;
  digits?: number;
  color?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.line} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="date" {...axis} tickFormatter={shortDate} ticks={monthTicks(data.map((d) => d.date as string), 4)} interval={0} />
        <YAxis {...axis} width={56} domain={domain ?? ["auto", "auto"]} tickFormatter={(v: number) => v.toFixed(digits === 0 ? 0 : 1)} />
        <Tooltip {...tooltipStyle} formatter={(v) => (v === null ? "—" : fmtNum(v as number, digits))} />
        {refs.map((r) => (
          <ReferenceLine key={r.label} y={r.y} stroke={C[r.tone]} strokeDasharray="4 4" label={{ value: r.label, position: "insideTopRight", fill: C[r.tone], fontSize: 10 }} />
        ))}
        <Line name={name} dataKey={dataKey} stroke={color} dot={false} strokeWidth={1.4} isAnimationActive={false} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function HistogramChart({ bins, height = 220 }: { bins: { from: number; to: number; count: number }[]; height?: number }) {
  const data = bins.map((b) => ({ label: `${fmtPct(b.from)} to ${fmtPct(b.to)}`, mid: (b.from + b.to) / 2, count: b.count }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.line} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="mid" {...axis} tickFormatter={(v: number) => fmtPct(v, 0)} minTickGap={20} />
        <YAxis {...axis} width={36} allowDecimals={false} />
        <Tooltip {...tooltipStyle} labelFormatter={(_, p) => (p?.[0]?.payload as { label?: string })?.label ?? ""} formatter={(v) => [v as number, "events"]} />
        <ReferenceLine x={0} stroke={C.muted} />
        <Bar dataKey="count" isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.label} fill={d.mid >= 0 ? C.gain : C.risk} fillOpacity={0.8} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HorizonChart({ data, height = 220 }: { data: { h: string; median: Num; mean: Num; baseline: Num }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.line} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="h" {...axis} />
        <YAxis {...axis} width={48} tickFormatter={(v: number) => fmtPct(v, 0)} />
        <Tooltip {...tooltipStyle} formatter={(v) => fmtPct(v as number, 2)} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine y={0} stroke={C.muted} />
        <Bar name="Event median" dataKey="median" fill={C.gold} isAnimationActive={false} />
        <Bar name="Event mean" dataKey="mean" fill={C.steel} isAnimationActive={false} />
        <Bar name="All-days median (baseline)" dataKey="baseline" fill={C.muted} fillOpacity={0.5} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PathChart({ data, height = 220 }: { data: { k: number; mean: number; median: number; n: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.line} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="k" {...axis} />
        <YAxis {...axis} width={48} tickFormatter={(v: number) => fmtPct(v, 0)} />
        <Tooltip {...tooltipStyle} labelFormatter={(k) => `Session +${k}`} formatter={(v, name) => [fmtPct(v as number, 2), name]} />
        <ReferenceLine y={0} stroke={C.muted} />
        <Area name="Mean path" dataKey="mean" stroke={C.steel} fill={C.steel} fillOpacity={0.08} isAnimationActive={false} />
        <Line name="Median path" dataKey="median" stroke={C.gold} dot={false} strokeWidth={1.6} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
