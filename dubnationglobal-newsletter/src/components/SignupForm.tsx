import { useEffect, useId, useRef, type FormEvent } from "react";
import { NEWSLETTER } from "../config/site";
import { feedbackFor } from "../newsletter/messages";
import { isFinished, useSignup } from "../newsletter/store";
import { DEMO_TRIGGERS } from "../newsletter/subscribe";

interface Props {
  /** unique id, e.g. "hero" or "final" */
  formId: string;
  /** id given to the email input so other parts of the page can focus it */
  inputId: string;
  support?: React.ReactNode;
  className?: string;
}

const toneStyles = {
  success: "border-gold/50 bg-gold/[0.08]",
  info: "border-sky-300/30 bg-sky-300/[0.06]",
  error: "border-coral/60 bg-coral/[0.08]",
};

export function SignupForm({ formId, inputId, support, className = "" }: Props) {
  const s = useSignup();
  const uid = useId();
  const errorId = `${uid}-error`;
  const helpId = `${uid}-help`;
  const statusId = `${uid}-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  const mine = s.activeForm === formId;
  const loading = s.phase === "loading";
  const finished = s.phase === "done" && isFinished(s.result);
  const failed = s.phase === "done" && s.result && !isFinished(s.result);
  const validation = s.validationError?.form === formId ? s.validationError.message : null;
  const fb = s.result ? feedbackFor(s.result, s.resultEmail, { mode: s.mode, doubleOptIn: NEWSLETTER.doubleOptIn, providerName: NEWSLETTER.providerName }) : null;
  const errorText = validation ?? (failed && fb ? `${fb.title} ${fb.body}` : null);

  // Move focus back to the input after a validation or submission error in this form.
  useEffect(() => {
    if (mine && (validation || failed)) inputRef.current?.focus();
  }, [mine, validation, failed]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void s.submit(formId);
  };

  if (finished && fb) {
    return (
      <div className={`rounded-2xl border p-5 sm:p-6 ${toneStyles[fb.tone]} ${className}`} data-testid={`${formId}-result`}>
        <div role={mine ? "status" : undefined} aria-live={mine ? "polite" : undefined}>
          <p className="font-display text-2xl font-semibold uppercase tracking-wide text-paper">{fb.title}</p>
          <p className="mt-2 text-[15px] leading-relaxed text-paper/85">{fb.body}</p>
        </div>
        <button type="button" onClick={s.reset} className="mt-4 min-h-[44px] rounded-lg px-1 text-sm font-medium text-gold underline decoration-gold/40 underline-offset-4 hover:decoration-gold">
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} className={className} aria-describedby={helpId} data-testid={`${formId}-form`}>
      <label htmlFor={inputId} className="mb-2 block text-sm font-medium tracking-wide text-paper">
        Email address
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          ref={inputRef}
          id={inputId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="you@example.com"
          value={s.email}
          onChange={(e) => s.setEmail(e.target.value)}
          readOnly={loading}
          aria-invalid={errorText ? true : undefined}
          aria-describedby={[errorText ? errorId : "", helpId].filter(Boolean).join(" ")}
          maxLength={254}
          className="min-h-[52px] w-full min-w-0 flex-1 rounded-xl border border-white/15 bg-black/55 px-4 text-base text-paper placeholder:text-mist/60 backdrop-blur-sm transition-colors focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/40 aria-[invalid=true]:border-coral"
        />
        <button
          type="submit"
          aria-disabled={loading || undefined}
          aria-busy={loading || undefined}
          className="inline-flex min-h-[52px] shrink-0 items-center justify-center gap-2 rounded-xl bg-gold px-6 font-display text-lg font-bold uppercase tracking-wider text-space shadow-[0_8px_30px_-8px_rgba(245,185,48,0.55)] transition hover:bg-goldsoft focus:outline-none focus-visible:ring-2 focus-visible:ring-paper focus-visible:ring-offset-2 focus-visible:ring-offset-space aria-disabled:cursor-wait aria-disabled:opacity-80"
        >
          {loading && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-space/30 border-t-space motion-reduce:animate-none" />}
          {loading ? "Joining…" : "Join the newsletter"}
        </button>
      </div>

      <div id={statusId} role={mine ? "status" : undefined} aria-live={mine ? "polite" : undefined} className="sr-only">
        {loading && mine ? "Submitting your email address…" : ""}
      </div>
      {errorText && (
        <div id={errorId} role={mine ? "alert" : undefined} className={`mt-3 rounded-xl border px-4 py-3 text-[15px] leading-relaxed ${toneStyles.error}`}>
          {validation ? (
            validation
          ) : (
            <>
              <strong className="font-semibold text-paper">{fb?.title}</strong> <span className="text-paper/85">{fb?.body}</span>
            </>
          )}
        </div>
      )}

      <div id={helpId} className="mt-3 space-y-2 text-sm leading-relaxed text-mist">
        {support}
        {s.mode === "demo" && (
          <p className="flex gap-2 text-[13px] text-sky-200/80" data-testid="demo-notice">
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300" />
            <span>
              Preview mode: this page isn’t connected to an email service yet, so addresses aren’t saved. Try{" "}
              <code className="text-sky-100">{DEMO_TRIGGERS.duplicate}</code> or <code className="text-sky-100">{DEMO_TRIGGERS.fail}</code> to see other states.
            </span>
          </p>
        )}
      </div>
    </form>
  );
}
