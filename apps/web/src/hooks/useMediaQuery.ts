"use client";

import { useEffect, useState } from "react";

/**
 * SSR-safe media query. Starts `false` (mobile-first assumption) and settles on
 * mount, so the first paint never depends on a browser API.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/** True from the `lg` breakpoint up, matching the Tailwind config. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
