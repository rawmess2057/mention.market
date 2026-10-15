/**
 * The palette for code that needs real color values (charts, canvas, SVG
 * props) rather than Tailwind classes. Mirrors the channel tokens in
 * `app/globals.css` — a test keeps the two in sync.
 */

export type Rgb = readonly [number, number, number];

export const PALETTE = {
  bg: [10, 13, 19],
  surface: [17, 21, 29],
  "surface-2": [24, 29, 39],
  "surface-3": [33, 39, 52],
  line: [36, 43, 57],
  "line-strong": [52, 61, 79],
  fg: [236, 239, 245],
  "fg-muted": [152, 163, 184],
  "fg-subtle": [126, 138, 160],
  accent: [92, 136, 255],
  "accent-strong": [45, 92, 255],
  yes: [46, 204, 138],
  "yes-strong": [32, 168, 112],
  no: [244, 92, 112],
  "no-strong": [214, 62, 84],
  warn: [232, 170, 66],
  live: [255, 94, 82],
} as const satisfies Record<string, Rgb>;

export type PaletteKey = keyof typeof PALETTE;

/** `rgba(r, g, b, a)` — the comma form every charting lib parses. */
export function rgba(key: PaletteKey, alpha = 1): string {
  const [r, g, b] = PALETTE[key];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Distinct, dark-legible series colors (word races), accent first. */
export const SERIES_COLORS = [
  rgba("accent"),
  rgba("yes"),
  rgba("no"),
  rgba("warn"),
  "rgba(176, 132, 255, 1)",
  "rgba(64, 200, 220, 1)",
  "rgba(255, 128, 196, 1)",
  "rgba(150, 200, 90, 1)",
  "rgba(255, 170, 120, 1)",
  "rgba(120, 160, 230, 1)",
  "rgba(220, 200, 100, 1)",
  "rgba(200, 120, 220, 1)",
] as const;
