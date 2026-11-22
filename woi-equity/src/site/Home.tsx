import { useEffect, useState } from "react";
import { PublicSnapshotSchema, SnapshotSchema, type PublicSnapshot } from "../lib/schema";
import { publicMode, publicProjection, publicRegime } from "../lib/publicProjection";
import { fmtDate, fmtNum, fmtPct, fmtUsd, tone } from "../lib/format";

const DASH = `${import.meta.env.BASE_URL}dashboard/`;

/** Public market summary only: production reads /api/public.php (no research, no sign-in). */
async function fetchPublic(): Promise<PublicSnapshot> {
  if (import.meta.env.DEV) {
    const raw = await (await fetch("/dev-data/latest.json", { cache: "no-store" })).json();
    return publicProjection(SnapshotSchema.parse(raw));
  }
  const res = await fetch(`${import.meta.env.BASE_URL}api/public.php`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return PublicSnapshotSchema.parse(await res.json());
}

function useLatest() {
  const [state, setState] = useState<{ p: PublicSnapshot | null; failed: boolean }>({ p: null, failed: false });
  useEffect(() => {
    let live = true;
    fetchPublic().then((p) => live && setState({ p, failed: false })).catch(() => live && setState({ p: null, failed: true }));
    return () => { live = false; };
  }, []);
  return state;
}

const PRINCIPLES = [
  {
    n: "01",
    title: "Sourced, or shown as missing",
    body: "Every figure carries the source it came from and the date it was retrieved. When a value cannot be verified it stays empty and says why. Nothing is estimated to fill a gap.",
  },
  {
    n: "02",
    title: "Rules before signals",
    body: "A signal appears only after its exact rule is written down. Regime labels are recomputed from the underlying prices on every load, and a label is never a trade instruction.",
  },
  {
    n: "03",
    title: "Research kept apart from data",
    body: "Market closes, calculated indicators and written analysis are stored and shown separately. Claims that have not been checked against a primary source are labelled unverified.",
  },
];

const MODULES = [
  ["Market Command Center", "S&P 500, VIX, regime and data freshness on one screen."],
  ["Three Horsemen", "SPY, QQQ and IWM against their own 200-session averages."],
  ["Washout Monitor", "RSI, drawdown and volatility readings with a user-defined score."],
  ["Club 30/30", "A monitor that stays inactive until its rule is defined."],
  ["Four-stock watchlist", "Closes, indicators, filings and catalysts for each name."],
  ["Macro & rates", "Treasury yields, Nasdaq breadth and Bitcoin, each with its own convention."],
  ["Research & sources", "A searchable ledger of every source behind every number."],
  ["History", "Archived sessions, compared field by field."],
];

export function Home() {
  const { p: s, failed } = useLatest();
  const regime = s ? { label: publicRegime(s) } : null;
  const fr = s ? publicMode(s) : null;

  return (
    <div className="min-h-screen bg-ink-950 text-ivory-100">
      <header className="sticky top-0 z-20 border-b border-ink-800 bg-ink-950/90 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href={import.meta.env.BASE_URL} className="flex items-center gap-2.5">
            <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="5" fill="#1f1f1d" /><path d="M7 22 L12 11 L16 19 L20 11 L25 22" stroke="#c2a874" strokeWidth="2.2" fill="none" strokeLinejoin="round" /></svg>
            <span className="text-[13px] font-semibold tracking-[0.16em] text-ivory-50">WOI EQUITY</span>
          </a>
          <nav className="flex items-center gap-5 text-[13px] text-ivory-500">
            <a href="#approach" className="hidden hover:text-ivory-100 sm:inline">Approach</a>
            <a href="#terminal" className="hidden hover:text-ivory-100 sm:inline">Terminal</a>
            <a href="#coverage" className="hidden hover:text-ivory-100 sm:inline">Coverage</a>
            <a href={DASH} className="border border-brass-700 px-3 py-1.5 text-brass-300 hover:border-brass-400 hover:text-brass-300">Open terminal</a>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="border-b border-ink-800">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1.25fr_1fr] lg:items-center">
            <div>
              <div className="label text-brass-500">Independent market intelligence</div>
              <h1 className="mt-4 font-serif text-[38px] leading-[1.08] text-ivory-50 sm:text-[52px]">
                Evidence-first research on markets and the companies moving them.
              </h1>
              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ivory-300">
                WOI Equity tracks market regime, market stress and a focused watchlist. Every figure is tied to its source, and every gap is left visible rather than filled in.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href={DASH} className="bg-ivory-100 px-5 py-2.5 text-[13px] font-medium text-ink-950 hover:bg-ivory-50">Open the research terminal</a>
                <a href="#approach" className="border border-ink-600 px-5 py-2.5 text-[13px] text-ivory-100 hover:border-ivory-500">How we work</a>
              </div>
            </div>

            <aside className="border border-ink-700 bg-ink-900" aria-label="Latest published snapshot">
              <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
                <div className="label">Latest snapshot</div>
                {fr && <span className={`font-mono text-[10px] tracking-label ${fr.stale ? "text-down" : fr.mode === "SAMPLE" ? "text-caution" : "text-up"}`}>{fr.stale ? "STALE" : fr.mode}</span>}
              </div>
              {!s && <div className="px-5 py-10 text-center text-xs text-ivory-500">{failed ? "Snapshot unavailable right now." : "Loading…"}</div>}
              {s && regime && (
                <div className="px-5 py-4">
                  <div className="text-2xs text-ivory-500">Regular-session close, {fmtDate(s.snapshot.equityTradingDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>
                  <div className="mt-4 grid grid-cols-3 gap-3 border-b border-ink-800 pb-4">
                    <div><div className="label">S&P 500</div><div className="num mt-1 font-mono text-[15px] text-ivory-50">{fmtNum(s.sp500Close) ?? "—"}</div></div>
                    <div><div className="label">VIX</div><div className="num mt-1 font-mono text-[15px] text-ivory-50">{fmtNum(s.vixClose) ?? "—"}</div></div>
                    <div><div className="label">Regime</div><div className={`mt-1 font-mono text-[13px] ${regime.label === "DEFENSIVE" ? "text-down" : "text-ivory-100"}`}>{regime.label}</div></div>
                  </div>
                  <table className="mt-2 w-full text-[13px]">
                    <tbody>
                      {s.watchlist.map((w) => (
                        <tr key={w.symbol} className="border-b border-ink-800 last:border-0">
                          <td className="py-2 font-mono text-ivory-100">{w.symbol}</td>
                          <td className="num py-2 text-right font-mono text-ivory-100">{fmtUsd(w.regularSessionClose) ?? "—"}</td>
                          <td className={`num py-2 text-right font-mono ${tone(w.oneDayChangePct)}`}>{fmtPct(w.oneDayChangePct) ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-3 text-2xs leading-relaxed text-ivory-600">
                    {fr?.mode === "SAMPLE" ? "Hand-verified historical baseline, not a live quote. " : ""}Regime is a rules-based label, not a recommendation.
                  </p>
                  <details className="mt-2 text-2xs text-ivory-600">
                    <summary className="cursor-pointer text-ivory-500 hover:text-ivory-300">Sources ({s.sources.length})</summary>
                    <ul className="mt-2 space-y-1">
                      {s.sources.map((src) => (
                        <li key={src.key}><a className="underline decoration-ink-600 underline-offset-2 hover:text-brass-300" href={src.url} target="_blank" rel="noreferrer noopener">{src.description}</a> · retrieved {src.retrievedDate}</li>
                      ))}
                    </ul>
                  </details>
                </div>
              )}
            </aside>
          </div>
        </section>

        {/* Approach */}
        <section id="approach" className="scroll-mt-16 border-b border-ink-800">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 md:py-20">
            <div className="label text-brass-500">Approach</div>
            <h2 className="mt-3 max-w-2xl font-serif text-[30px] leading-tight text-ivory-50">Three commitments behind every page.</h2>
            <div className="mt-10 grid gap-px bg-ink-800 md:grid-cols-3">
              {PRINCIPLES.map((p) => (
                <div key={p.n} className="bg-ink-950 p-6 md:pr-8">
                  <div className="font-mono text-xs text-brass-500">{p.n}</div>
                  <h3 className="mt-3 text-[17px] font-medium text-ivory-50">{p.title}</h3>
                  <p className="mt-3 text-[14px] leading-relaxed text-ivory-500">{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Terminal */}
        <section id="terminal" className="scroll-mt-16 border-b border-ink-800">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 md:py-20">
            <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
              <div>
                <div className="label text-brass-500">Research terminal</div>
                <h2 className="mt-3 font-serif text-[30px] leading-tight text-ivory-50">One desk for regime, stress and company research.</h2>
                <p className="mt-4 text-[14px] leading-relaxed text-ivory-500">
                  The terminal reads each published snapshot, validates it, and recomputes the derived figures before showing them. It works on a phone as well as a desktop.
                </p>
                <a href={DASH} className="mt-6 inline-block border border-brass-700 px-4 py-2 text-[13px] text-brass-300 hover:border-brass-400">Open the terminal →</a>
              </div>
              <ol className="grid gap-px bg-ink-800 sm:grid-cols-2">
                {MODULES.map(([t, d], i) => (
                  <li key={t} className="bg-ink-950 p-5">
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono text-[10px] text-ivory-700">{String(i + 1).padStart(2, "0")}</span>
                      <span className="text-[14px] text-ivory-100">{t}</span>
                    </div>
                    <p className="mt-1.5 pl-7 text-xs leading-relaxed text-ivory-500">{d}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Coverage */}
        <section id="coverage" className="scroll-mt-16 border-b border-ink-800">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 md:py-20">
            <div className="label text-brass-500">Coverage</div>
            <h2 className="mt-3 font-serif text-[30px] leading-tight text-ivory-50">The current watchlist.</h2>
            <div className="mt-10 grid gap-px bg-ink-800 sm:grid-cols-2 lg:grid-cols-4">
              {(s?.watchlist ?? []).map((w) => (
                <a key={w.symbol} href={`${DASH}#/stock/${w.symbol}`} className="group bg-ink-950 p-6 hover:bg-ink-900">
                  <div className="font-mono text-lg text-ivory-50 group-hover:text-brass-300">{w.symbol}</div>
                  <div className="mt-1 text-xs text-ivory-500">{w.company}</div>
                  <ul className="mt-4 space-y-1.5 text-xs text-ivory-300">
                    {w.focus.map((f) => <li key={f} className="flex gap-2"><span className="text-brass-500">·</span>{f}</li>)}
                  </ul>
                </a>
              ))}
              {!s && <div className="bg-ink-950 p-6 text-xs text-ivory-500 sm:col-span-2 lg:col-span-4">Coverage loads from the latest snapshot.</div>}
            </div>
          </div>
        </section>

        {/* Membership */}
        <section className="border-b border-ink-800">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:px-6 md:grid-cols-[1fr_1.4fr] md:py-16">
            <div>
              <div className="label text-brass-500">Member research</div>
              <h2 className="mt-3 font-serif text-[26px] leading-tight text-ivory-50">Not open yet.</h2>
            </div>
            <p className="text-[14px] leading-relaxed text-ivory-500">
              Subscriber research will sit behind a proper sign-in when it launches. Until then, the terminal and its sources are open to read.
            </p>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-4 py-10 text-2xs leading-relaxed text-ivory-600 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
          <div className="text-ivory-500">© {new Date().getFullYear()} WOI Equity</div>
          <p className="max-w-2xl">
            WOI Equity publishes research for information only. It is not investment advice, an offer, or a solicitation to buy or sell any security.
            Market data may be delayed, incomplete or historical; check the date and source shown with each figure.
          </p>
        </div>
      </footer>
    </div>
  );
}
