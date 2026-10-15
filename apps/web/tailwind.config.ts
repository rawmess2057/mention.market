import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Dark-first semantic tokens (values in `globals.css`, as RGB channels
        // so opacity modifiers like `bg-accent/10` work). Use only these:
        // a guard test rejects the old light palette names and raw hex.
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          2: "rgb(var(--surface-2) / <alpha-value>)",
          3: "rgb(var(--surface-3) / <alpha-value>)",
        },
        line: {
          DEFAULT: "rgb(var(--line) / <alpha-value>)",
          strong: "rgb(var(--line-strong) / <alpha-value>)",
        },
        fg: {
          DEFAULT: "rgb(var(--fg) / <alpha-value>)",
          muted: "rgb(var(--fg-muted) / <alpha-value>)",
          subtle: "rgb(var(--fg-subtle) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          strong: "rgb(var(--accent-strong) / <alpha-value>)",
          soft: "rgb(var(--accent) / 0.12)",
          foreground: "rgb(var(--on-accent) / <alpha-value>)",
        },
        yes: {
          DEFAULT: "rgb(var(--yes) / <alpha-value>)",
          strong: "rgb(var(--yes-strong) / <alpha-value>)",
          soft: "rgb(var(--yes) / 0.12)",
          line: "rgb(var(--yes) / 0.32)",
        },
        no: {
          DEFAULT: "rgb(var(--no) / <alpha-value>)",
          strong: "rgb(var(--no-strong) / <alpha-value>)",
          soft: "rgb(var(--no) / 0.12)",
          line: "rgb(var(--no) / 0.32)",
        },
        /** Locked / challenge-window states. The only place amber may appear. */
        warn: {
          DEFAULT: "rgb(var(--warn) / <alpha-value>)",
          soft: "rgb(var(--warn) / 0.12)",
          line: "rgb(var(--warn) / 0.32)",
        },
        live: {
          DEFAULT: "rgb(var(--live) / <alpha-value>)",
          soft: "rgb(var(--live) / 0.12)",
        },
        // shadcn-style aliases used by `components/ui/*`.
        background: "rgb(var(--bg) / <alpha-value>)",
        foreground: "rgb(var(--fg) / <alpha-value>)",
        card: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          foreground: "rgb(var(--fg) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "rgb(var(--surface-2) / <alpha-value>)",
          foreground: "rgb(var(--fg-muted) / <alpha-value>)",
        },
        border: "rgb(var(--line) / <alpha-value>)",
        input: "rgb(var(--line-strong) / <alpha-value>)",
        ring: "rgb(var(--accent) / <alpha-value>)",
        // Solid fills carrying white text use the darker logo blue (5.1:1).
        primary: {
          DEFAULT: "rgb(var(--accent-strong) / <alpha-value>)",
          foreground: "rgb(var(--on-accent) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--surface-2) / <alpha-value>)",
          foreground: "rgb(var(--fg) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "rgb(var(--no) / <alpha-value>)",
          foreground: "rgb(var(--on-accent) / <alpha-value>)",
        },
        success: {
          DEFAULT: "rgb(var(--yes) / <alpha-value>)",
          foreground: "rgb(var(--on-accent) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      fontSize: {
        micro: ["11px", { lineHeight: "1.35" }],
        label: ["12px", { lineHeight: "1.4" }],
        body: ["14px", { lineHeight: "1.5" }],
        "body-lg": ["15px", { lineHeight: "1.5" }],
      },
      borderRadius: {
        // Legacy scale — kept stable so untouched screens don't shift.
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // Semantic radii for new work.
        field: "0.625rem",
        tile: "0.75rem",
        card: "1rem",
        panel: "1.25rem",
        pill: "9999px",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        dropdown: "var(--shadow-dropdown)",
        sheet: "0 -16px 48px -16px rgb(0 0 0 / 0.6)",
        cta: "var(--shadow-cta)",
      },
      animation: {
        "fade-in": "fade-in 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        "slide-up": "slide-up 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        "pulse-live": "pulse-live 2s ease-in-out infinite",
        shimmer: "shimmer 2.5s linear infinite",
        marquee: "marquee 36s linear infinite",
        "on-air-shimmer": "on-air-shimmer 2s ease-in-out infinite",
        "whisper-in": "whisper-in 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        "slip-flip": "slip-flip 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards",
        rise: "rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
        drift: "drift 28s ease-in-out infinite alternate",
        "glow-breathe": "glow-breathe 3.2s ease-in-out infinite",
      },
      keyframes: {
        rise: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        drift: {
          from: { transform: "translate3d(0, 0, 0) scale(1)" },
          to: { transform: "translate3d(6%, -4%, 0) scale(1.12)" },
        },
        "glow-breathe": {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-live": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        "on-air-shimmer": {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
    },
  },
  plugins: [animate],
};

export default config;
