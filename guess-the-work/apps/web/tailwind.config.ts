import type { Config } from "tailwindcss";

/** Tokens live in app/globals.css (docs/DESIGN.md); Tailwind only points at them. */
const v = (n: string) => `var(--${n})`;
const c = (n: string) => `rgb(var(--${n}-c) / <alpha-value>)`;
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: c("bg"),
        raise: c("bg-raise"),
        surface: c("surface"),
        surface2: c("surface-2"),
        line: v("line"),
        lineStrong: v("line-strong"),
        text: c("text"),
        muted: c("muted"),
        faint: c("faint"),
        accent: c("accent"),
        accentInk: c("accent-ink"),
        signal: c("signal"),
        ok: c("ok"),
        paper: "#F2EDE3",
      },
      fontFamily: { sans: ["var(--font-body)", "sans-serif"], display: ["var(--font-display)", "var(--font-body)", "sans-serif"] },
      borderRadius: { sm: "4px", DEFAULT: "6px", md: "8px", lg: "10px" },
      letterSpacing: { label: "0.08em" },
    },
  },
  plugins: [],
} satisfies Config;
