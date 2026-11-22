import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * Two pages from one codebase:
 *   /            public website   (index.html  -> src/site)
 *   /dashboard/  research terminal (dashboard/index.html -> src/main.tsx)
 * The site is served from the domain root, so base is "/".
 */
export default defineConfig({
  base: "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      input: {
        site: resolve(__dirname, "index.html"),
        dashboard: resolve(__dirname, "dashboard/index.html"),
      },
    },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
} as never);
