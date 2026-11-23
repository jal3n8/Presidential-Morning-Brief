export function About() {
  return (
    <section id="about" aria-labelledby="about-title" className="mx-auto max-w-page px-5 py-20 sm:px-6 lg:py-24">
      <div className="mx-auto max-w-[44rem] text-center">
        <p className="font-display text-[15px] font-semibold uppercase tracking-[0.28em] text-gold">About</p>
        <h2 id="about-title" className="mt-3 font-display text-4xl font-bold uppercase leading-[0.95] text-paper sm:text-5xl">
          Made by fans, for every time zone.
        </h2>
        <div className="mt-6 space-y-4 text-[1.0625rem] leading-relaxed text-paper/80">
          <p>
            DubNationGlobal is an independent Warriors fan publication. It’s for the fans in the Bay and the ones setting alarms on the other side of the planet: the same team, the same groans, the same celebrations, just at different hours.
          </p>
          <p>
            It isn’t connected to the team or the league. It’s a fan paying close attention, giving credit to good work by others, and making room for the people who make DubNation global.
          </p>
        </div>
      </div>
    </section>
  );
}
