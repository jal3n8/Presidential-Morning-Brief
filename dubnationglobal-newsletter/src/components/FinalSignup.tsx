import { SignupForm } from "./SignupForm";

export function FinalSignup() {
  return (
    <section id="join" aria-labelledby="join-title" className="mx-auto max-w-page px-5 pb-24 sm:px-6">
      <div className="relative overflow-hidden rounded-3xl border border-gold/25 bg-[radial-gradient(ellipse_at_top_right,rgba(245,185,48,0.14),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(31,79,168,0.3),transparent_60%)] bg-ink px-5 py-12 sm:px-10 lg:px-16 lg:py-16">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 id="join-title" className="font-display text-4xl font-bold uppercase leading-[0.95] text-paper sm:text-5xl">
              Pull up a seat, wherever you are.
            </h2>
            <p className="mt-4 max-w-[30rem] text-[1.0625rem] leading-relaxed text-paper/80">
              One field, your email. Warriors takes, game times for your time zone, and the fans who make DubNation global.
            </p>
          </div>
          <SignupForm formId="final" inputId="email-final" support={<p>Unsubscribe anytime from the link in any email.</p>} />
        </div>
      </div>
    </section>
  );
}
