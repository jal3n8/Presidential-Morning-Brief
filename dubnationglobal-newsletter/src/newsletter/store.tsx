import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { NEWSLETTER, type NewsletterMode } from "../config/site";
import { normaliseEmail, subscribe as defaultSubscribe, type SubscribeResult, validateEmail } from "./subscribe";

/**
 * One shared signup state for BOTH forms on the page: the same email draft, the same
 * pending lock and the same result, so whichever form is used, both show consistent feedback.
 */
export type Phase = "idle" | "loading" | "done";

interface SignupState {
  email: string;
  setEmail: (v: string) => void;
  phase: Phase;
  result: SubscribeResult | null;
  /** address the current result refers to */
  resultEmail: string;
  /** which form submitted (for validation messages and focus) */
  activeForm: string | null;
  validationError: { form: string; message: string } | null;
  submit: (formId: string) => Promise<void>;
  reset: () => void;
  mode: NewsletterMode;
}

const Ctx = createContext<SignupState | null>(null);

export function useSignup(): SignupState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSignup must be used inside <SignupProvider>");
  return c;
}

export function SignupProvider({
  children,
  subscribeFn = defaultSubscribe,
  mode = NEWSLETTER.mode,
}: {
  children: ReactNode;
  subscribeFn?: (email: string) => Promise<SubscribeResult>;
  mode?: NewsletterMode;
}) {
  const [email, setEmailState] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<SubscribeResult | null>(null);
  const [resultEmail, setResultEmail] = useState("");
  const [activeForm, setActiveForm] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<SignupState["validationError"]>(null);
  const pending = useRef(false); // synchronous lock: blocks double clicks / double Enter
  const completed = useRef(new Map<string, SubscribeResult>()); // successful addresses this session

  const setEmail = useCallback((v: string) => {
    setEmailState(v);
    setValidationError(null);
  }, []);

  const submit = useCallback(
    async (formId: string) => {
      if (pending.current) return; // a request is already in flight
      const value = normaliseEmail(email);
      const problem = validateEmail(value);
      setActiveForm(formId);
      if (problem) {
        setValidationError({ form: formId, message: problem });
        return;
      }
      setValidationError(null);
      const key = value.toLowerCase();
      const earlier = completed.current.get(key);
      if (earlier) {
        // Same address already handled in this session: don't send it again.
        setResult({ ...earlier, detail: "already-handled-this-session" });
        setResultEmail(value);
        setPhase("done");
        return;
      }
      pending.current = true;
      setPhase("loading");
      setResult(null);
      try {
        const r = await subscribeFn(value);
        if (r.status !== "error" && r.status !== "invalid") completed.current.set(key, r);
        setResult(r);
      } catch {
        setResult({ status: "error", saved: false });
      } finally {
        setResultEmail(value);
        pending.current = false;
        setPhase("done");
      }
    },
    [email, subscribeFn],
  );

  const reset = useCallback(() => {
    if (pending.current) return;
    setPhase("idle");
    setResult(null);
    setValidationError(null);
    setEmailState("");
  }, []);

  const value = useMemo(
    () => ({ email, setEmail, phase, result, resultEmail, activeForm, validationError, submit, reset, mode }),
    [email, setEmail, phase, result, resultEmail, activeForm, validationError, submit, reset, mode],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** True when the visitor should see the "you're done" panel instead of the form. */
export function isFinished(r: SubscribeResult | null): boolean {
  return !!r && r.status !== "error" && r.status !== "invalid";
}
