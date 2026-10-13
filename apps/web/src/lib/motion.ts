/**
 * One motion spec for the whole app.
 *
 * The research on prediction-market UX is consistent on this point: live data
 * should feel *alive*, not urgent. Numbers roll over ~280ms, surfaces settle in
 * ~400ms, presses answer in ~120ms, and nothing snaps. Import these instead of
 * hand-rolling durations so the product feels like one product.
 */

export const DURATION = {
  /** Button/tap acknowledgement. */
  press: 0.12,
  /** Hover, fade, small state changes. */
  hover: 0.18,
  /** Price/probability number rolls. */
  roll: 0.28,
  /** Sheets, panels, tab panels. */
  panel: 0.4,
} as const;

/** ease-out-quint — fast start, soft landing. */
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Bar/meter springs (probability splits, pool shares). */
export const SPRING = { type: "spring", stiffness: 140, damping: 22 } as const;

/** Snappier spring for pill/segment indicators. */
export const SPRING_TIGHT = { type: "spring", stiffness: 400, damping: 32 } as const;

export const PRESS = { scale: 0.98 } as const;

export const fadeIn = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
  transition: { duration: DURATION.hover, ease: EASE },
} as const;

export const sheetIn = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 16 },
  transition: { duration: DURATION.panel, ease: EASE },
} as const;
