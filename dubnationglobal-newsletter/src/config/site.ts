/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  DubNationGlobal landing page — EVERYTHING EDITABLE LIVES IN THIS FILE.
 *  Brand text, links, newsletter provider settings and globe content.
 *  Leave a link empty ("") and the page simply won't render it.
 *  Never put API keys or secrets here: this file ships to every visitor.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface LinkItem {
  label: string;
  href: string;
}

export const SITE = {
  name: "DubNationGlobal",
  /** Canonical address, used for share cards and search engines. */
  url: "https://dubnationglobal.com/",
  title: "DubNationGlobal Newsletter · Warriors takes for fans everywhere",
  description:
    "A Golden State Warriors newsletter for fans wherever they watch: original takes, sourced stories, game times across time zones, and the people of DubNation around the world.",
  /** Share image relative to the site root. Set to "" to omit og:image tags. */
  ogImage: "og-image.jpg",
  ogImageAlt: "DubNationGlobal: DubNation, everywhere. A glowing globe linking the Bay Area to fans around the world.",
  themeColor: "#05070D",

  /** Contact link slot. Rendered only when href is set, e.g. "mailto:hello@dubnationglobal.com". */
  contact: { label: "Contact", href: "" } as LinkItem,

  /** Social profiles. Add only real, approved URLs. Empty list = nothing rendered. */
  social: [] as LinkItem[],

  /**
   * Social proof renders ONLY when verified items are supplied here.
   * subscriberCount: a real, current number from your email provider (or null).
   */
  socialProof: {
    subscriberCount: null as number | null,
    testimonials: [] as { quote: string; name: string; location?: string }[],
    mentions: [] as LinkItem[],
  },

  disclosure:
    "DubNationGlobal is an independent fan publication. It is not affiliated with, endorsed by, or sponsored by the Golden State Warriors or the NBA. Team and league names are used only to identify the subject of our commentary.",
};

export type NewsletterMode = "demo" | "endpoint" | "provider-form";

const env = import.meta.env ?? {};

/**
 * Newsletter integration (see README → "Connect a newsletter provider").
 *  - "demo":          nothing is sent or saved; the page says so.
 *  - "endpoint":      the form POSTs JSON to your own server function (/api/subscribe),
 *                     which holds the provider API key. Full success/duplicate/error states.
 *  - "provider-form": the form posts to the provider's PUBLIC embed-form URL (no key needed).
 *                     Browsers can't read that reply, so the page can't confirm the result.
 * Public (non-secret) values can also be set at build time with VITE_NEWSLETTER_* variables.
 */
export const NEWSLETTER = {
  mode: ((env.VITE_NEWSLETTER_MODE as string) || "demo") as NewsletterMode,
  endpoint: (env.VITE_NEWSLETTER_ENDPOINT as string) || "/api/subscribe",
  providerForm: {
    action: (env.VITE_NEWSLETTER_FORM_ACTION as string) || "",
    emailField: (env.VITE_NEWSLETTER_FORM_EMAIL_FIELD as string) || "email",
  },
  /** Shown in the privacy note once connected, e.g. "Buttondown", "Kit", "beehiiv". */
  providerName: (env.VITE_NEWSLETTER_PROVIDER_NAME as string) || "",
  providerPrivacyUrl: (env.VITE_NEWSLETTER_PROVIDER_PRIVACY_URL as string) || "",
  /** Must match the provider setting: true = subscribers confirm by email first. */
  doubleOptIn: ((env.VITE_NEWSLETTER_DOUBLE_OPT_IN as string) ?? "true") !== "false",
  /** Optional link to a full privacy policy page on your site. */
  privacyPolicyUrl: (env.VITE_PRIVACY_POLICY_URL as string) || "",
  requestTimeoutMs: 12000,
};

export interface City {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  timeZone: string;
}

/** Destinations used by the globe. Coordinates are city centres. */
export const CITIES: Record<string, City> = {
  "bay-area": { id: "bay-area", name: "Bay Area", country: "United States", lat: 37.77, lon: -122.42, timeZone: "America/Los_Angeles" },
  tokyo: { id: "tokyo", name: "Tokyo", country: "Japan", lat: 35.68, lon: 139.65, timeZone: "Asia/Tokyo" },
  manila: { id: "manila", name: "Manila", country: "Philippines", lat: 14.6, lon: 120.98, timeZone: "Asia/Manila" },
  "sao-paulo": { id: "sao-paulo", name: "São Paulo", country: "Brazil", lat: -23.55, lon: -46.63, timeZone: "America/Sao_Paulo" },
  paris: { id: "paris", name: "Paris", country: "France", lat: 48.86, lon: 2.35, timeZone: "Europe/Paris" },
};

export const GLOBE = {
  hub: "bay-area",
  /** Gold connections drawn from the hub in the hero (illustrative). */
  heroConnections: ["tokyo", "manila", "sao-paulo", "paris"],
  /** Cities a visitor can select in the fan-globe preview. */
  previewCities: ["bay-area", "tokyo", "manila", "sao-paulo"],
  /** Example tip-off used for time-zone illustrations. Not a scheduled game. */
  exampleTipoff: { hour: 19, minute: 0, timeZone: "America/Los_Angeles", label: "7:00 p.m. Pacific" },
  /** Coastline data (Natural Earth via world-atlas, public domain). Path relative to the page. */
  landUrl: "geo/land-110m.json",
};

/**
 * Decorative "city lights". Real city locations, but the lights are purely
 * illustrative: they do not represent subscribers, fans or any data.
 */
export const DECORATIVE_LIGHTS: [number, number][] = [
  [-122.42, 37.77], [-118.24, 34.05], [-122.33, 47.61], [-123.12, 49.28], [-79.38, 43.65], [-87.63, 41.88],
  [-74.0, 40.71], [-99.13, 19.43], [-157.86, 21.31], [-121.49, 38.58], [-121.89, 37.34], [-115.14, 36.17],
  [151.21, -33.87], [144.96, -37.81], [174.76, -36.85], [126.98, 37.57], [121.47, 31.23], [116.4, 39.9],
  [114.17, 22.32], [121.57, 25.03], [103.82, 1.35], [106.85, -6.2], [100.5, 13.75], [72.88, 19.08],
  [77.21, 28.61], [55.27, 25.2], [28.98, 41.01], [13.4, 52.52], [-3.7, 40.42], [12.5, 41.9],
  [-0.13, 51.51], [-6.26, 53.35], [18.07, 59.33], [3.38, 6.52], [28.05, -26.2], [36.82, -1.29],
  [31.24, 30.04], [-58.38, -34.6], [-77.04, -12.05], [-74.07, 4.71], [-43.17, -22.91], [-70.67, -33.45],
  [123.89, 10.32], [135.5, 34.69], [139.65, 35.68], [120.98, 14.6], [-46.63, -23.55], [2.35, 48.86],
  [125.6, 7.07], [130.4, 33.59], [141.35, 43.06], [-80.19, 25.76], [-97.74, 30.27], [-104.99, 39.74],
];
