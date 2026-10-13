import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: {
          DEFAULT: "#F9F7F4",
          dark: "#F0EDE8",
        },
        navy: {
          DEFAULT: "#0F172A",
          light: "#1E293B",
        },
        blue: {
          // Brand blue, matched to the mark in `public/mention-logo.svg`.
          DEFAULT: "#2D5CFF",
          light: "#EDF1FF",
          dark: "#1B3FCC",
          ink: "#14225C",
        },
        green: {
          DEFAULT: "#2B7550",
          light: "#E8F5F0",
        },
        "red-brand": {
          DEFAULT: "#C75B3A",
          light: "#FDF0EB",
        },
        /** Warm neutral ramp — the only greys UI text should use. */
        ink: {
          900: "#0B1220",
          800: "#0F172A",
          700: "#1E293B",
          600: "#3B4657",
          500: "#5A5A5A",
          400: "#78716C",
          300: "#A29C96",
          200: "#E5E1DB",
          100: "#F0EDE8",
          50: "#F9F7F4",
        },
        "gray-warm": "#E5E1DB",
        // 4.9:1 on white / 4.6:1 on cream — was #A8A29E (2.4:1), which failed AA.
        "gray-mid": "#78716C",
        "gray-cool": "#8291A6",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        live: {
          DEFAULT: "#C75B3A",
          soft: "rgba(199, 91, 58, 0.1)",
        },
        yes: {
          DEFAULT: "#2B7550",
          strong: "#1F5C3D",
          soft: "rgba(43, 117, 80, 0.1)",
          line: "rgba(43, 117, 80, 0.24)",
        },
        no: {
          DEFAULT: "#C75B3A",
          strong: "#A34427",
          soft: "rgba(199, 91, 58, 0.1)",
          line: "rgba(199, 91, 58, 0.24)",
        },
        /** Locked / challenge-window states. The only place amber may appear. */
        warn: {
          DEFAULT: "#9A6512",
          soft: "rgba(154, 101, 18, 0.1)",
          line: "rgba(154, 101, 18, 0.28)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "monospace"],
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
        sheet: "0 -16px 48px -16px rgba(15, 23, 42, 0.22)",
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
      },
      keyframes: {
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
