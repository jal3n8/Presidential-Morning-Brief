import { runStudy } from "./analogs";
import { fmtMarketDate, fmtNum, fmtPct, fmtSigned, fmtUtc, provenanceLine } from "./format";
import type { Num } from "./indicators";
import type { MarketFrame } from "./market";
import { evaluateCondition, TRIGGER_BY_ID, TRIGGERS } from "./rules";
import type { ScanEvent } from "./scanner";
import type { Dataset } from "./types";
import type { WatchRow } from "./watchlist";

export const BRIEF_WEEK = 5; // sessions
export const FAILED_LOOKBACK = 120; // sessions searched for completed signals
export const FAILED_MIN_HISTORY = 5;

export interface BriefSection {
  heading: string;
  bullets: string[];
}

export interface Brief {
  title: string;
  asOf: string;
  sections: BriefSection[];
  footer: string[];
  markdown: string;
  text: string;
}

interface Ctx {
  frame: MarketFrame;
  dataset: Dataset;
  events: ScanEvent[];
  watch: WatchRow[];
  generatedAt: string;
}

function historicalStats(f: MarketFrame, triggerId: string, signalIndex: number, outcomeEnd: number) {
  const t = TRIGGER_BY_ID[triggerId];
  const s = runStudy(f, {
    predicate: t.test,
    description: t.name,
    cooldown: 20,
    dedupe: true,
    entry: "signal_close",
    excursionHorizon: 60,
    beforeIndex: signalIndex,
    outcomeEnd,
  });
  const h20 = s.horizons.find((h) => h.h === 20)!;
  const h60 = s.horizons.find((h) => h.h === 60)!;
  return { n: h20.n, median20: h20.median, pos20: h20.pctPositive, median60: h60.median, worstMae: s.mae.min, base20: h20.baseline.median };
}

const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);

export function generateBrief({ frame: f, dataset, events, watch, generatedAt }: Ctx): Brief {
  const i = f.dates.length - 1;
  const w = Math.max(0, i - BRIEF_WEEK);
  const now = evaluateCondition(f, i);
  const then = evaluateCondition(f, w);
  const sections: BriefSection[] = [];
  const idx = f.indexSymbol;
  const isDemo = dataset.kind === "demo";

  // 1. Current market condition
  const s200 = f.sma200[i];
  sections.push({
    heading: "Current market condition",
    bullets: [
      `Rule-based label: **${now.label}**. ${now.reason}`,
      `${idx} closed at ${fmtNum(f.close[i])} on ${fmtMarketDate(f.dates[i])}: ${fmtPct(f.close[i] / f.close[w] - 1)} over ${i - w} sessions, ${fmtPct(f.mtd[i])} month to date.`,
      `RSI(14) ${fmtNum(f.rsi14[i], 1)} · 50-day z-score ${fmtSigned(f.z50[i])} · ${s200 === null ? "SMA200 unavailable" : `${fmtPct(f.close[i] / s200 - 1)} vs 200-day average`} · drawdown ${fmtPct(f.dd252[i])} from the 252-session high.`,
      f.vix[i] === null
        ? "VIX: not available for this date."
        : `VIX ${fmtNum(f.vix[i])} (${fmtPct(f.vixPct[i], 0, false)} percentile of all closes since ${f.firstVolDate}).`,
    ],
  });

  // 2. Biggest signal changes
  const changes: { name: string; a: Num; b: Num; scale: number; fmt: (x: Num) => string }[] = [
    { name: "RSI(14)", a: f.rsi14[w], b: f.rsi14[i], scale: 10, fmt: (x) => fmtNum(x, 1) },
    { name: "50-day z-score", a: f.z50[w], b: f.z50[i], scale: 1, fmt: (x) => fmtSigned(x) },
    { name: "VIX", a: f.vix[w], b: f.vix[i], scale: 5, fmt: (x) => fmtNum(x) },
    { name: "Drawdown from 252-session high", a: f.dd252[w], b: f.dd252[i], scale: 0.05, fmt: (x) => fmtPct(x) },
    { name: "VIX percentile", a: f.vixPct[w], b: f.vixPct[i], scale: 0.25, fmt: (x) => fmtPct(x, 0, false) },
  ];
  const ranked = changes
    .filter((c) => c.a !== null && c.b !== null)
    .sort((x, y) => Math.abs(((y.b as number) - (y.a as number)) / y.scale) - Math.abs(((x.b as number) - (x.a as number)) / x.scale));
  const switchedOn = events.filter((e) => e.index > w && e.index <= i);
  const switchedOff = TRIGGERS.filter((t) => t.test(f, w) === true && t.test(f, i) !== true);
  sections.push({
    heading: "Biggest signal changes this week",
    bullets: [
      then.label !== now.label ? `Condition changed from ${then.label} to ${now.label}.` : `Condition unchanged: ${now.label}.`,
      ...ranked.slice(0, 4).map((c) => `${c.name}: ${c.fmt(c.a)} → ${c.fmt(c.b)}.`),
      switchedOn.length ? `Triggers that switched on: ${[...new Set(switchedOn.map((e) => e.triggerName))].join("; ")}.` : "No new trigger onsets.",
      switchedOff.length ? `Triggers that switched off: ${switchedOff.map((t) => t.name).join("; ")}.` : "No triggers switched off.",
    ],
  });

  // 3. New historical matches (statistics use only events that started before each signal)
  const matchBullets = switchedOn.map((e) => {
    const hs = historicalStats(f, e.triggerId, e.index, i);
    if (hs.n === 0) return `${fmtMarketDate(e.date)} · ${e.triggerName} (${e.threshold}): no earlier completed events to compare.`;
    return `${fmtMarketDate(e.date)} · ${e.triggerName} (${e.threshold}): ${hs.n} earlier independent events; median 20-session ${idx} return ${fmtPct(hs.median20)} (unconditional median ${fmtPct(hs.base20)}), ${fmtPct(hs.pos20, 0, false)} positive; median 60-session ${fmtPct(hs.median60)}; worst 60-session adverse move ${fmtPct(hs.worstMae)}.${hs.n < 10 ? " Small sample." : ""}`;
  });
  sections.push({ heading: "New historical matches", bullets: matchBullets.length ? matchBullets : ["No new trigger onsets in the last 5 sessions."] });

  // 4. Signals that failed: realised 20-session return had the opposite sign to the historical median
  //    known AT THE SIGNAL DATE (point-in-time; no hindsight in the expectation).
  const failed: string[] = [];
  let evaluated = 0;
  for (const e of events) {
    if (e.index < i - FAILED_LOOKBACK || e.index + 20 > i) continue;
    const hs = historicalStats(f, e.triggerId, e.index, e.index);
    if (hs.n < FAILED_MIN_HISTORY || hs.median20 === null) continue;
    evaluated++;
    const realised = f.close[e.index + 20] / f.close[e.index] - 1;
    if (sign(realised) !== sign(hs.median20)) {
      failed.push(`${fmtMarketDate(e.date)} · ${e.triggerName}: history (n=${hs.n}) pointed to a median ${fmtPct(hs.median20)} over 20 sessions; realised ${fmtPct(realised)}.`);
    }
  }
  sections.push({
    heading: "Signals that failed",
    bullets: failed.length
      ? [...failed.slice(0, 8), `${failed.length} of ${evaluated} completed signals in the last ${FAILED_LOOKBACK} sessions failed by this rule.`]
      : [evaluated ? `None of the ${evaluated} completed signals in the last ${FAILED_LOOKBACK} sessions failed by this rule.` : `No signals with a completed 20-session outcome and at least ${FAILED_MIN_HISTORY} prior examples in the last ${FAILED_LOOKBACK} sessions.`],
  });

  // 5. Watchlist observations
  const wl: string[] = [];
  for (const r of watch) {
    if (!r.series) {
      wl.push(`${r.symbol}: no validated data.`);
      continue;
    }
    const tags: string[] = [];
    if (r.rsi14 !== null && r.rsi14 <= 30) tags.push("RSI oversold");
    if (r.rsi14 !== null && r.rsi14 >= 70) tags.push("RSI overbought");
    if (r.series.symbol !== "SPY" && r.rs63 !== null && Math.abs(r.rs63) >= 0.1) tags.push(r.rs63 > 0 ? "strong vs SPY" : "weak vs SPY");
    wl.push(
      `${r.symbol}${r.series.tradable ? "" : " (index)"}: ${fmtNum(r.close)} on ${r.lastDate}; 1d ${fmtPct(r.ret1)}, 5d ${fmtPct(r.ret5)}, 1m ${fmtPct(r.ret21)}; RSI ${fmtNum(r.rsi14, 1)}; ${r.trend}${r.rs63 !== null ? `; 3m relative to SPY ${fmtSigned(r.rs63 * 100, 1)} pts` : ""}${tags.length ? ` — ${tags.join(", ")}` : ""}.`,
    );
  }
  sections.push({ heading: "Watchlist observations", bullets: wl.length ? wl : ["Watchlist is empty."] });

  // 6. Research questions (rule-based templates)
  const q: string[] = [];
  if (now.label === "Extreme Stress" || now.label === "Elevated Stress")
    q.push(`Which of the active stress flags (${now.extreme.filter((x) => x.hit).map((x) => x.label).join(", ") || "none extreme"}) clears first, and how did that sequence play out in earlier episodes?`);
  if (now.label === "Recovery Watch") q.push("Does the close hold above its 20-day average for another week, or does Extreme Stress return?");
  if (f.vix[i] !== null && (f.vix[i] as number) >= 30) q.push("How many sessions did VIX take to close back below 30 after earlier onsets above 30?");
  if (s200 !== null && f.close[i] < s200) q.push("Is this a correction inside a longer uptrend or the start of a sustained move below the 200-day average? What evidence would distinguish them?");
  if (failed.length) q.push("What was different about the signals that failed (macro catalyst, earnings, liquidity)?");
  const laggard = watch.filter((r) => r.rs63 !== null).sort((a, b) => (a.rs63 as number) - (b.rs63 as number))[0];
  if (laggard && (laggard.rs63 as number) < -0.05) q.push(`What explains ${laggard.symbol}'s ${fmtSigned((laggard.rs63 as number) * 100, 1)}-point underperformance vs SPY over 3 months?`);
  q.push("What observation next week would invalidate the current working thesis?");
  sections.push({ heading: "Research questions for the coming week", bullets: q });

  const footer = [
    isDemo ? "DEMO DATA: synthetic series for testing the software. Contains no market information." : `Data: ${provenanceLine(dataset.index)}.`,
    `Generated ${fmtUtc(generatedAt)} by fixed rules (no AI model). Thresholds and formulas: Methodology page.`,
    "Research only, not investment advice. Historical and hypothetical results do not guarantee future results.",
  ];
  const title = `WOI Equity · Weekly Market Extremes Brief · ${fmtMarketDate(f.dates[i])}`;
  const markdown = [
    `# ${title}`,
    "",
    ...sections.flatMap((s) => [`## ${s.heading}`, ...s.bullets.map((b) => `- ${b}`), ""]),
    "---",
    ...footer.map((x) => `_${x}_`),
    "",
  ].join("\n");
  const text = markdown
    .replace(/^#+ /gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^_(.*)_$/gm, "$1")
    .replace(/^- /gm, "• ")
    .replace(/^---$/gm, "");
  return { title, asOf: f.dates[i], sections, footer, markdown, text };
}
