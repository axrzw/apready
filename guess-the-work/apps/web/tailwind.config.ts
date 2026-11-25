import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: { sans: ["var(--font-ar)", "system-ui", "sans-serif"] },
      colors: {
        ink: { 950: "#0b0b12", 900: "#12121c", 800: "#1b1b29", 700: "#26263a", 600: "#34344e" },
        brand: { 300: "#ffd27a", 400: "#ffbf47", 500: "#f5a524", 600: "#d4860b" },
        tier: { mainstream: "#60a5fa", mid: "#a78bfa", hidden_gem: "#34d399", obscure: "#f472b6" },
      },
    },
  },
  plugins: [],
} satisfies Config;
