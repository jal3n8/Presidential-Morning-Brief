import { SITE } from "../config/site";
import { focusSignup } from "../lib/focusSignup";

export function Wordmark({ className = "" }: { className?: string }) {
  const [a, b] = SITE.name === "DubNationGlobal" ? ["DubNation", "Global"] : [SITE.name, ""];
  return (
    <span className={`font-display font-bold uppercase tracking-[0.08em] ${className}`}>
      <span className="text-paper">{a}</span>
      <span className="text-gold">{b}</span>
    </span>
  );
}

export function Header() {
  return (
    <header className="sticky top-[env(safe-area-inset-top,0px)] z-40 border-b border-white/[0.06] bg-space/75 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-page items-center justify-between gap-3 px-4 sm:px-6">
        <a href="#top" className="-ml-1 flex min-h-[44px] shrink-0 items-center px-1 text-[1.05rem] min-[380px]:text-[1.3rem] sm:text-2xl" aria-label={`${SITE.name}, back to top`}>
          <Wordmark />
        </a>
        <nav aria-label="Page sections" className="flex items-center sm:gap-2">
          <a href="#newsletter" className="flex min-h-[44px] items-center whitespace-nowrap rounded-lg px-2 text-sm font-medium text-mist transition-colors hover:text-paper min-[380px]:text-[15px] sm:px-3">
            Newsletter
          </a>
          <a href="#fan-globe" className="flex min-h-[44px] items-center whitespace-nowrap rounded-lg px-2 text-sm font-medium text-mist transition-colors hover:text-paper min-[380px]:text-[15px] sm:px-3">
            <span className="hidden min-[380px]:inline">Fan globe</span>
            <span className="min-[380px]:hidden">Globe</span>
          </a>
          <a
            href="#signup"
            onClick={(e) => {
              e.preventDefault();
              focusSignup();
            }}
            className="ml-1 hidden min-h-[44px] items-center rounded-lg border border-gold/50 px-4 font-display text-[17px] font-bold uppercase tracking-wider text-gold transition hover:bg-gold hover:text-space sm:flex"
          >
            Subscribe
          </a>
        </nav>
      </div>
    </header>
  );
}
