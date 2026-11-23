import { Globe } from "../globe/Globe";
import { SignupForm } from "./SignupForm";

export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      {/* Globe: atmosphere only. Behind the text on phones, beside it on large screens. */}
      <div className="pointer-events-none absolute -right-[42%] -top-[4%] -z-10 w-[118vw] max-w-[44rem] opacity-90 sm:-right-[20%] sm:opacity-90 lg:-right-[10%] lg:top-1/2 lg:w-[60rem] lg:max-w-none lg:-translate-y-1/2 lg:opacity-100 xl:-right-[4%]">
        <Globe variant="hero" className="globe-in" />
      </div>
      {/* Readability veil */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(5,7,13,0)_0%,rgba(5,7,13,0.35)_28%,rgba(5,7,13,0.88)_52%,#05070D_100%)] lg:bg-[linear-gradient(90deg,#05070D_0%,rgba(5,7,13,0.92)_32%,rgba(5,7,13,0.35)_58%,rgba(5,7,13,0)_75%)]" />

      <div className="mx-auto max-w-page px-5 pb-16 pt-10 sm:px-6 sm:pt-16 lg:pb-32 lg:pt-28">
        <div className="max-w-[36rem]">
          <p className="rise font-display text-[15px] font-semibold uppercase tracking-[0.28em] text-gold">The DubNationGlobal newsletter</p>
          <h1 id="hero-title" className="rise rise-2 mt-4 font-display text-[3.6rem] font-bold uppercase leading-[0.9] tracking-[0.01em] text-paper sm:text-[5rem] lg:text-[6.25rem]">
            DubNation, everywhere.
          </h1>
          <p className="rise rise-3 mt-5 max-w-[32rem] text-[1.0625rem] leading-relaxed text-paper/85 sm:text-lg">
            A Warriors newsletter for fans wherever you watch. Honest takes on the team, game times that make sense in your time zone, and stories from fans from the Bay to Manila.
          </p>
          <div id="signup" tabIndex={-1} className="mt-7 rounded-2xl border border-white/10 bg-ink/70 p-4 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-md focus:outline-none sm:p-5">
            <SignupForm
              formId="hero"
              inputId="email-hero"
              support={
                <p>
                  You’ll get original Warriors commentary, hand-picked stories linked to their sources, game-day times for fans outside the Bay, and updates on the fan globe. We only ask for your email. Every email has an unsubscribe link.
                </p>
              }
            />
          </div>
        </div>
      </div>
      <p className="absolute bottom-4 right-5 hidden max-w-[16rem] text-right text-xs leading-snug text-mist/70 lg:block">
        Illustration: city lights and gold connections are decorative, not fan data.
      </p>
    </section>
  );
}
