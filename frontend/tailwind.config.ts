import type { Config } from "tailwindcss";

/** Helper: pull a CSS variable defined in global.css and let Tailwind apply
 *  arbitrary opacity values via the `<alpha-value>` placeholder. */
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Theme-driven tokens (flip with .dark class via CSS variables)
        bg:           v("--bg"),
        surface:      v("--surface"),
        "surface-2":  v("--surface-2"),
        "surface-3":  v("--surface-3"),
        border:       v("--border"),
        "border-soft":v("--border-soft"),
        fg:           v("--fg"),
        "fg-muted":   v("--fg-muted"),
        "fg-subtle":  v("--fg-subtle"),
        "fg-faint":   v("--fg-faint"),
        accent:       v("--accent"),
        "accent-soft":v("--accent-soft"),
        "accent-fg":  v("--accent-fg"),
        warn:         v("--warn"),
        danger:       v("--danger"),

        // Fixed brand-style accents (don't need to flip)
        leaf: {
          400: "#3df2a3", 500: "#1fd989", 600: "#15b673", 700: "#0f8a59",
        },
        cyan: {
          400: "#5eead4", 500: "#2dd4bf",
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "ui-sans-serif", "system-ui",
               "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular",
               "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgb(var(--accent) / .25), 0 12px 40px -10px rgb(var(--accent) / .25)",
        panel:
          "0 1px 0 rgb(255 255 255 / .05) inset, 0 1px 2px rgb(0 0 0 / .06), 0 10px 24px -12px rgb(0 0 0 / .22)",
      },
      backgroundImage: {
        "radial-glow":
          "radial-gradient(60% 50% at 50% 0%, rgb(var(--accent) / .12), transparent 60%)",
        "leaf-gradient":
          "linear-gradient(135deg, rgb(var(--accent)) 0%, rgb(var(--accent-soft)) 100%)",
      },
      animation: {
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
        "fade-in":    "fade-in .25s ease-out both",
        "slide-up":   "slide-up .35s cubic-bezier(.2,.7,.2,1) both",
        shimmer:      "shimmer 1.6s linear infinite",
      },
      keyframes: {
        "pulse-soft": { "0%,100%": { opacity: ".55" }, "50%": { opacity: "1" } },
        "fade-in":   { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up":  {
          from: { opacity: "0", transform: "translateY(8px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
