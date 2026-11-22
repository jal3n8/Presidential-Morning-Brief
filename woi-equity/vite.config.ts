import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Two pages from one codebase:
 *   /            public website     (index.html -> src/site)
 *   /dashboard/  research terminal  (dashboard/index.html -> src/main.tsx)
 */

const SEED = resolve(__dirname, "public/api/_lib/seed/latest.json");

/** `npm run dev` only: serves the seed snapshot at /dev-data so the UI can be previewed without a server or sign-in. */
function devData(): Plugin {
  return {
    name: "woi-dev-data",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/dev-data", (req, res, next) => {
        const seed = JSON.parse(readFileSync(SEED, "utf8"));
        const d = seed.snapshot.equityTradingDate;
        const send = (v: unknown) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(v)); };
        const url = (req.url ?? "").split("?")[0];
        if (url === "/latest.json" || url === `/archive/${d}.json`) return send(seed);
        if (url === "/archive/index.json") return send({ schemaVersion: 1, updatedAtUtc: null, snapshots: [{ id: d, path: `archive/${d}.json`, equityTradingDate: d, equitySession: seed.snapshot.equitySession, reportDate: seed.snapshot.reportDate, quality: seed.snapshot.quality, archivedAtUtc: null, sha256: null }] });
        if (url === "/status.json") return send({ schemaVersion: 1, automationEnabled: false, configuredConnections: {}, lastRun: null, lastSuccessUtc: null, consecutiveFailures: 0, recentRuns: [] });
        next();
      });
    },
  };
}

/** Writes the sign-in provider's origin into the Content-Security-Policy of the built .htaccess. */
function cspAuthOrigin(authority: string | undefined): Plugin {
  return {
    name: "woi-csp-auth-origin",
    apply: "build",
    closeBundle() {
      const file = resolve(__dirname, "dist/.htaccess");
      if (!existsSync(file)) return;
      let origin = "";
      try { if (authority) origin = new URL(authority).origin; } catch { origin = ""; }
      if (origin && !/^https:\/\/[a-z0-9.-]+$/i.test(origin)) throw new Error("VITE_AUTH_AUTHORITY must be an https origin");
      writeFileSync(file, readFileSync(file, "utf8").replaceAll("__AUTH_ORIGIN__", origin));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    base: "/",
    plugins: [react(), devData(), cspAuthOrigin(env.VITE_AUTH_AUTHORITY)],
    build: {
      outDir: "dist",
      sourcemap: false,
      rollupOptions: {
        input: { site: resolve(__dirname, "index.html"), dashboard: resolve(__dirname, "dashboard/index.html") },
      },
    },
    test: { environment: "node", include: ["tests/**/*.test.ts"] },
  } as never;
});
