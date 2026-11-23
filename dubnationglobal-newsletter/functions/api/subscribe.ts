/**
 * Cloudflare Pages Function: POST /api/subscribe
 * Set the NEWSLETTER_* variables (API key as an encrypted "Secret") in
 * Cloudflare dashboard → your Pages project → Settings → Variables and Secrets.
 */
import { handleSubscribe, type Env } from "../../server/handler";

export const onRequest = (context: { request: Request; env: Env }) => handleSubscribe(context.request, context.env);
