import { TipoffTimes } from "./TipoffTimes";

const REASONS = [
  {
    n: "01",
    title: "The Warriors, through a fan’s eyes.",
    body: [
      "Original takes on what the team is doing and why it matters: the rotations, the off-ball stuff, the decisions worth arguing about.",
      "When we pass along someone else’s reporting or a moment worth rewatching, we link to the source so you can read it where it was published.",
    ],
  },
  {
    n: "02",
    title: "Game day across time zones.",
    body: [
      "A 7 p.m. tip-off in San Francisco is late morning in Manila, around lunch in Tokyo and the small hours in Paris. Game-day notes list local times, so you know when to set the alarm.",
    ],
    extra: true,
  },
  {
    n: "03",
    title: "The people watching around the world.",
    body: [
      "DubNation doesn’t stop at the Bay Bridge. Editions make room for how fans in São Paulo, Tokyo, Paris and everywhere between watch, argue and celebrate.",
      "Want your city in a future edition? Reply to any email and tell us where you watch.",
    ],
  },
];

export function Reasons() {
  return (
    <section id="newsletter" aria-labelledby="reasons-title" className="relative mx-auto max-w-page px-5 py-20 sm:px-6 lg:py-28">
      <p className="font-display text-[15px] font-semibold uppercase tracking-[0.28em] text-gold">What lands in your inbox</p>
      <h2 id="reasons-title" className="mt-3 max-w-[40rem] font-display text-4xl font-bold uppercase leading-[0.95] text-paper sm:text-5xl">
        Three reasons to let us in.
      </h2>
      <p className="mt-4 max-w-[38rem] text-[1.0625rem] leading-relaxed text-mist">
        Publishing frequency is still being set. The focus isn’t: the team, the time zones and the people.
      </p>
      <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
        {REASONS.map((r) => (
          <article key={r.n} className="flex flex-col rounded-2xl border border-white/[0.08] bg-gradient-to-b from-navy/40 to-ink/40 p-6 sm:p-7">
            <span aria-hidden className="font-display text-sm font-semibold tracking-[0.3em] text-gold/80">{r.n}</span>
            <h3 className="mt-3 font-display text-[1.75rem] font-semibold uppercase leading-[1.02] text-paper">{r.title}</h3>
            {r.body.map((b) => (
              <p key={b} className="mt-3 text-[15.5px] leading-relaxed text-paper/80">{b}</p>
            ))}
            {r.extra && <TipoffTimes />}
          </article>
        ))}
      </div>
    </section>
  );
}
