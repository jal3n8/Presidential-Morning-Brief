import { SITE } from "../config/site";

/** Renders ONLY when verified figures, testimonials or mentions are configured in site.ts. */
export function SocialProof() {
  const { subscriberCount, testimonials, mentions } = SITE.socialProof;
  const has = (subscriberCount !== null && subscriberCount > 0) || testimonials.length > 0 || mentions.length > 0;
  if (!has) return null;
  return (
    <section aria-label="What readers say" className="mx-auto max-w-page px-5 pb-16 sm:px-6" data-testid="social-proof">
      {subscriberCount !== null && subscriberCount > 0 && (
        <p className="text-center font-display text-2xl uppercase tracking-wide text-paper">
          Join <span className="text-gold">{subscriberCount.toLocaleString("en-US")}</span> subscribers
        </p>
      )}
      {testimonials.length > 0 && (
        <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          {testimonials.map((t) => (
            <li key={t.quote} className="rounded-2xl border border-white/10 bg-ink/60 p-6">
              <blockquote className="text-paper/85">“{t.quote}”</blockquote>
              <p className="mt-3 text-sm text-mist">
                {t.name}
                {t.location ? ` · ${t.location}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      {mentions.length > 0 && (
        <p className="mt-8 text-center text-sm text-mist">
          As mentioned by{" "}
          {mentions.map((m, i) => (
            <span key={m.href}>
              {i > 0 && ", "}
              <a className="text-paper underline decoration-white/30 underline-offset-4 hover:decoration-gold" href={m.href} rel="noopener noreferrer" target="_blank">
                {m.label}
              </a>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
