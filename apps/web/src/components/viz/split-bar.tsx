"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/format";

/**
 * Two-segment outcome meter: green YES share (left) / red NO share (right).
 * The signature "market card" visual — a full-width probability bar.
 */
export function SplitBar({
  yes,
  className,
  height = 8,
  animate = true,
}: {
  /** YES probability in 0..1 (NO is the remainder). */
  yes: number;
  className?: string;
  /** Bar height in px. */
  height?: number;
  animate?: boolean;
}) {
  const pct = Math.min(100, Math.max(0, yes * 100));
  return (
    <div
      className={cn(
        "relative flex w-full overflow-hidden rounded-full bg-surface-2",
        className
      )}
      style={{ height }}
      role="img"
      aria-label={`YES ${Math.round(pct)}%, NO ${Math.round(100 - pct)}%`}
    >
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-yes to-yes/85"
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={animate ? { type: "spring", stiffness: 140, damping: 22 } : { duration: 0 }}
      />
      <div className="h-full flex-1 rounded-full bg-gradient-to-r from-no/85 to-no" />
    </div>
  );
}
