"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/format";

export function LeaderBar({
  value,
  className,
  barClassName,
}: {
  value: number;
  className?: string;
  barClassName?: string;
}) {
  return (
    <div className={cn("relative h-2 w-full overflow-hidden rounded-full bg-cream-dark", className)}>
      <motion.div
        className={cn("absolute inset-y-0 left-0 rounded-full", barClassName ?? "bg-blue")}
        initial={false}
        animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        transition={{ type: "spring", stiffness: 120, damping: 20 }}
      />
    </div>
  );
}
