"use client";

import { useEffect, useState } from "react";

/**
 * Shared clock hook — returns Date.now() re-rendered every `intervalMs`.
 * Replaces per-card setInterval(forceUpdate) patterns.
 * Pauses when tab is hidden to avoid wasted renders.
 */
export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (intervalMs <= 0) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id) return;
      id = setInterval(() => {
        if (document.hidden) return;
        setNow(Date.now());
      }, intervalMs);
    };
    const stop = () => {
      if (id) {
        clearInterval(id);
        id = null;
      }
    };
    const onVis = () => {
      if (document.hidden) {
        stop();
      } else {
        setNow(Date.now());
        stop();
        start();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [intervalMs]);

  return now;
}
