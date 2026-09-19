"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/format";

export function AnimatedNumber({
  value,
  format,
  className,
  flashMs = 700,
}: {
  value: number;
  format?: (v: number) => string;
  className?: string;
  flashMs?: number;
}) {
  const [display, setDisplay] = useState(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prev = useRef(value);
  const raf = useRef<number>(0);

  useEffect(() => {
    const from = prev.current;
    const to = value;
    if (from === to) return;
    prev.current = value;

    const dir = to > from ? "up" : "down";
    setFlash(dir);
    const flashTimer = setTimeout(() => setFlash(null), flashMs);

    const start = performance.now();
    const dur = 420;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf.current);
      clearTimeout(flashTimer);
    };
  }, [value, flashMs]);

  return (
    <span
      className={cn(flash === "up" && "num-up", flash === "down" && "num-down", className)}
      style={{ display: "inline-block" }}
    >
      {format ? format(display) : display.toFixed(0)}
    </span>
  );
}
