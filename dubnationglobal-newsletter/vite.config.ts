/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { SITE } from "./src/config/site";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Writes title, description, canonical and social-sharing tags from src/config/site.ts into index.html. */
function siteMeta(): Plugin {
  return {
    name: "dng-site-meta",
    transformIndexHtml(html) {
      const img = SITE.ogImage ? new URL(SITE.ogImage, SITE.url).href : "";
      const tags = [
        `<title>${esc(SITE.title)}</title>`,
        `<meta name="description" content="${esc(SITE.description)}" />`,
        `<link rel="canonical" href="${esc(SITE.url)}" />`,
        `<meta name="theme-color" content="${esc(SITE.themeColor)}" />`,
        `<meta property="og:type" content="website" />`,
        `<meta property="og:site_name" content="${esc(SITE.name)}" />`,
        `<meta property="og:title" content="${esc(SITE.title)}" />`,
        `<meta property="og:description" content="${esc(SITE.description)}" />`,
        `<meta property="og:url" content="${esc(SITE.url)}" />`,
        ...(img
          ? [
              `<meta property="og:image" content="${esc(img)}" />`,
              `<meta property="og:image:width" content="1200" />`,
              `<meta property="og:image:height" content="630" />`,
              `<meta property="og:image:alt" content="${esc(SITE.ogImageAlt)}" />`,
              `<meta name="twitter:card" content="summary_large_image" />`,
              `<meta name="twitter:image" content="${esc(img)}" />`,
            ]
          : [`<meta name="twitter:card" content="summary" />`]),
        `<meta name="twitter:title" content="${esc(SITE.title)}" />`,
        `<meta name="twitter:description" content="${esc(SITE.description)}" />`,
      ];
      return html.replace("<!--SITE_META-->", tags.join("\n    "));
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), siteMeta()],
  server: { host: "127.0.0.1", port: 5180, strictPort: true },
  preview: { host: "127.0.0.1", port: 4180, strictPort: true },
  build: { outDir: "dist", sourcemap: false },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
