import { SITE } from "../config/site";
import { TipoffTimes } from "./TipoffTimes";

/** A clearly labelled mock-up of the intended newsletter format. All content is illustrative. */
export function SampleEdition() {
  return (
    <section aria-labelledby="sample-title" className="relative overflow-hidden border-y border-white/[0.06] bg-[radial-gradient(ellipse_at_top,rgba(31,79,168,0.18),transparent_60%)]">
      <div className="mx-auto grid max-w-page grid-cols-1 gap-10 px-5 py-20 sm:px-6 lg:grid-cols-12 lg:py-28">
        <div className="lg:col-span-4">
          <p className="font-display text-[15px] font-semibold uppercase tracking-[0.28em] text-gold">A look inside</p>
          <h2 id="sample-title" className="mt-3 font-display text-4xl font-bold uppercase leading-[0.95] text-paper sm:text-5xl">
            What an edition reads like.
          </h2>
          <p className="mt-4 text-[1.0625rem] leading-relaxed text-mist">
            A take up top. Linked stories worth your time. A watch guide in your time zone. A fan somewhere in the world. Short enough to read before tip-off.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-mist/80">
            The example on the right shows the format only. It isn’t a real issue, and it contains no current news, results or statistics.
          </p>
        </div>

        <article aria-label="Sample edition (illustrative content)" className="relative lg:col-span-8">
          <div className="absolute -top-3 left-5 z-10 rounded-full border border-gold/60 bg-space px-3 py-1 font-display text-sm font-bold uppercase tracking-[0.2em] text-gold">
            Sample edition
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0C1222] shadow-[0_40px_100px_-40px_rgba(0,0,0,1)]">
            {/* email chrome */}
            <div className="border-b border-white/[0.07] bg-white/[0.02] px-5 pb-4 pt-7 sm:px-8">
              <dl className="grid grid-cols-[4.5rem_1fr] gap-y-1.5 text-sm">
                <dt className="text-mist/70">From</dt>
                <dd className="text-paper/90">{SITE.name}</dd>
                <dt className="text-mist/70">Subject</dt>
                <dd className="font-semibold text-paper">Five passes, one wide-open corner</dd>
              </dl>
            </div>

            <div className="space-y-8 px-5 py-7 sm:px-8 sm:py-9">
              <div>
                <h3 className="font-display text-[1.9rem] font-semibold uppercase leading-[1.02] text-paper">The possession you feel before you see it</h3>
                <p className="mt-3 text-[16px] leading-[1.75] text-paper/85">
                  There’s a kind of Warriors possession you feel before you can explain it. The ball swings. Somebody cuts backdoor for no obvious reason. A screen gets set for a player who doesn’t even have the ball. Then a shooter is standing alone in the corner, and half the arena is still watching the wrong side of the floor. That’s what this newsletter will keep pointing at: not just who scored, but how the floor opened up.
                </p>
              </div>

              <div>
                <h4 className="font-display text-sm font-semibold uppercase tracking-[0.22em] text-gold">Worth your time</h4>
                <div className="mt-3 rounded-xl border border-dashed border-white/15 p-4">
                  <p className="text-[15px] text-paper/85">
                    <span className="text-paper">[Story headline]</span> <span className="text-mist">· Publisher name</span>
                  </p>
                  <p className="mt-1 text-sm text-mist">One or two lines on why it’s worth reading, plus a direct link to the original source.</p>
                </div>
              </div>

              <div>
                <h4 className="font-display text-sm font-semibold uppercase tracking-[0.22em] text-gold">Watch guide · format example</h4>
                <p className="mt-2 text-[15px] text-paper/80">Each game gets one line per time zone, so nobody does the math at 3 a.m.</p>
                <TipoffTimes cityIds={["bay-area", "manila", "tokyo", "paris"]} />
              </div>

              <div className="rounded-xl border border-gold/25 bg-gradient-to-br from-gold/[0.07] to-transparent p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-display text-sm font-semibold uppercase tracking-[0.22em] text-gold">Around DubNation · Manila</h4>
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] uppercase tracking-wider text-mist">Illustrative example</span>
                </div>
                <p className="mt-3 text-[15.5px] leading-relaxed text-paper/85">
                  Picture a weekday morning: a café TV, a few people who should be at work, and a groan that crosses the room at the exact same second. Each edition hands the mic to one reader about where and how they watch. Real features will come only from readers who choose to share.
                </p>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
