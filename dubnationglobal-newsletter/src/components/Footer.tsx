import { NEWSLETTER, SITE } from "../config/site";
import { Wordmark } from "./Header";

const linkCls = "inline-flex min-h-[44px] items-center text-paper/85 underline decoration-white/25 underline-offset-4 hover:decoration-gold";

/** Privacy wording that matches how the page is actually wired up. */
export function PrivacyNote() {
  if (NEWSLETTER.mode === "demo") {
    return (
      <p data-testid="privacy-demo">
        This page is a preview and isn’t connected to an email service. Anything typed into the signup forms stays in your browser. It is not sent anywhere or stored. When the newsletter launches, this note will name the email service that stores subscriber addresses.
      </p>
    );
  }
  const service = NEWSLETTER.providerName || "our email service provider";
  return (
    <p data-testid="privacy-live">
      We ask for one thing: your email address, used only to send the {SITE.name} newsletter. It’s stored by {service}
      {NEWSLETTER.providerPrivacyUrl ? (
        <>
          {" "}(
          <a className="underline decoration-white/25 underline-offset-4 hover:decoration-gold" href={NEWSLETTER.providerPrivacyUrl} rel="noopener noreferrer" target="_blank">
            their privacy policy
          </a>
          )
        </>
      ) : null}
      {NEWSLETTER.mode === "endpoint" ? ", reached through our own signup function, which doesn’t store it" : ""}.{" "}
      {NEWSLETTER.doubleOptIn ? "You’ll confirm by email before you’re added. " : ""}
      To unsubscribe, use the link at the bottom of any email. This page loads no ads, analytics or tracking scripts.
      {NEWSLETTER.privacyPolicyUrl ? (
        <>
          {" "}
          <a className="underline decoration-white/25 underline-offset-4 hover:decoration-gold" href={NEWSLETTER.privacyPolicyUrl}>
            Full privacy policy
          </a>
          .
        </>
      ) : null}
    </p>
  );
}

export function Footer() {
  const contact = SITE.contact.href ? SITE.contact : null;
  const social = SITE.social.filter((s) => s.href);
  return (
    <footer className="border-t border-white/[0.07] bg-black/40">
      <div className="mx-auto grid max-w-page grid-cols-1 gap-10 px-5 py-14 sm:px-6 md:grid-cols-12">
        <div className="md:col-span-5">
          <Wordmark className="text-2xl" />
          <p className="mt-3 max-w-[28rem] text-sm leading-relaxed text-mist">{SITE.disclosure}</p>
          {(contact || social.length > 0) && (
            <ul className="mt-4 flex flex-wrap gap-x-5 text-sm" aria-label="Contact and social links">
              {contact && (
                <li>
                  <a className={linkCls} href={contact.href}>
                    {contact.label}
                  </a>
                </li>
              )}
              {social.map((s) => (
                <li key={s.href}>
                  <a className={linkCls} href={s.href} rel="noopener noreferrer me" target="_blank">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div id="privacy" className="text-sm leading-relaxed text-mist md:col-span-7">
          <h2 className="font-display text-base font-semibold uppercase tracking-[0.2em] text-paper">Privacy &amp; unsubscribing</h2>
          <div className="mt-3 space-y-3">
            <PrivacyNote />
            <p>Fonts are served from this site, and the page sets no cookies.</p>
          </div>
        </div>
      </div>
      <div className="border-t border-white/[0.05]">
        <p className="mx-auto max-w-page px-5 py-5 text-xs text-mist/70 sm:px-6">© {new Date().getFullYear()} {SITE.name}. Sample content and globe markers on this page are illustrative.</p>
      </div>
    </footer>
  );
}
