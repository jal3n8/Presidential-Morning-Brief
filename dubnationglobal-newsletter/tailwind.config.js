/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        space: "#05070D",
        ink: "#0A0F1C",
        navy: "#0E1F45",
        royal: "#1F4FA8",
        gold: "#F5B930",
        goldsoft: "#FFD772",
        paper: "#F4F1EA",
        mist: "#A9B3C6",
        coral: "#EE8E7C",
      },
      fontFamily: {
        display: ['"Barlow Condensed"', '"Arial Narrow"', "Roboto Condensed", "sans-serif"],
        sans: ['"DM Sans"', "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      maxWidth: { page: "76rem" },
    },
  },
  plugins: [],
};
