/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./dashboard/index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#101010", 900: "#151514", 850: "#1a1a19", 800: "#1f1f1d", 700: "#2a2a27", 600: "#3a3935" },
        ivory: { 50: "#f4efe3", 100: "#ece6d8", 300: "#cfc8b8", 500: "#9a9486", 600: "#7a7569", 700: "#5f5b52" },
        brass: { 300: "#d2bb8c", 400: "#c2a874", 500: "#a88f5e", 700: "#6e5f40" },
        pewter: { 400: "#a3a7aa", 600: "#6f7376" },
        up: "#93ab8c",
        down: "#cf8577",
        caution: "#d2b16f",
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        serif: ['"Newsreader"', "ui-serif", "Georgia", "serif"],
      },
      fontSize: { "2xs": ["0.6875rem", { lineHeight: "1rem" }] },
      letterSpacing: { label: "0.09em" },
    },
  },
  plugins: [],
};
