import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CITIES, GLOBE } from "../config/site";
import { Globe } from "../globe/Globe";
import { focusSignup } from "../lib/focusSignup";
import { formatLocal } from "../lib/time";
import { useTipoffTimes } from "./TipoffTimes";

function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function FanGlobePreview() {
  const ids = GLOBE.previewCities;
  const [selected, setSelected] = useState(ids[0]);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const now = useNow();
  const city = CITIES[selected];
  const tip = useTipoffTimes([selected], now)[0];

  // Radio-group keyboard pattern: arrows move between cities, Home/End jump.
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = ids.length;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % n;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + n) % n;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    setSelected(ids[next]);
    btnRefs.current[next]?.focus();
  };

  return (
    <section id="fan-globe" aria-labelledby="globe-title" className="relative mx-auto max-w-page px-5 py-20 sm:px-6 lg:py-28">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-gold/50 bg-gold/10 px-3 py-1 font-display text-sm font-bold uppercase tracking-[0.2em] text-gold">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold motion-safe:animate-pulse" />
          In development
        </span>
      </div>
      <h2 id="globe-title" className="mt-4 max-w-[44rem] font-display text-4xl font-bold uppercase leading-[0.95] text-paper sm:text-5xl lg:text-6xl">
        The DubNationGlobal fan globe
      </h2>
      <p className="mt-4 max-w-[40rem] font-display text-2xl font-semibold uppercase leading-snug tracking-wide text-gold/90 sm:text-[1.75rem]">
        Find your city. See who’s watching. Explore DubNation around the world.
      </p>

      <div className="mt-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
        <div className="mx-auto w-full max-w-[34rem] lg:col-span-6">
          <Globe variant="preview" focusCityId={selected} label={`Illustrative globe preview focused on ${city.name}, connected to the Bay Area`} />
          <p className="mt-1 text-center text-xs text-mist/75">Drag the globe to spin it. Markers are illustrative. There’s no fan data yet.</p>
        </div>

        <div className="lg:col-span-6">
          <div role="radiogroup" aria-label="Preview a city" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ids.map((id, i) => {
              const on = id === selected;
              return (
                <button
                  key={id}
                  ref={(el) => {
                    btnRefs.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  onClick={() => setSelected(id)}
                  onKeyDown={(e) => onKey(e, i)}
                  className={`min-h-[48px] rounded-xl border px-3 font-display text-lg font-semibold uppercase tracking-wide transition-colors ${
                    on ? "border-gold bg-gold/15 text-gold" : "border-white/12 bg-white/[0.03] text-paper/85 hover:border-white/30"
                  }`}
                >
                  {CITIES[id].name}
                </button>
              );
            })}
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-ink/70 p-6" aria-live="polite" data-testid="city-panel">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-4xl font-bold uppercase leading-none text-paper">{city.name}</h3>
              <span className="rounded-full border border-white/15 px-2.5 py-0.5 text-[11px] uppercase tracking-wider text-mist">Illustrative preview</span>
            </div>
            <p className="mt-1 text-sm text-mist">{city.country}</p>
            <dl className="mt-5 grid grid-cols-1 gap-4 text-[15px] sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wider text-mist/80">Local time now</dt>
                <dd className="mt-1 tabular-nums text-paper">{formatLocal(now, city.timeZone)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-mist/80">A {GLOBE.exampleTipoff.label} tip-off</dt>
                <dd className="mt-1 tabular-nums text-paper">
                  {selected === GLOBE.hub ? "Home time zone" : tip.full}
                  {tip.offset > 0 && selected !== GLOBE.hub && <span className="ml-1.5 text-xs text-gold">next day</span>}
                </dd>
              </div>
            </dl>
            <p className="mt-5 border-t border-white/[0.07] pt-4 text-[15px] leading-relaxed text-paper/85">
              <span className="text-gold">Planned for every city:</span> local game times, fan stories, Warriors connections, and voluntary city check-ins.
            </p>
          </div>

          <a
            href="#signup"
            onClick={(e) => {
              e.preventDefault();
              focusSignup();
            }}
            className="mt-6 inline-flex min-h-[52px] w-full items-center justify-center rounded-xl border border-gold bg-gold/10 px-6 font-display text-lg font-bold uppercase tracking-wider text-gold transition hover:bg-gold hover:text-space sm:w-auto"
          >
            Get project updates by email
          </a>
        </div>
      </div>
    </section>
  );
}
