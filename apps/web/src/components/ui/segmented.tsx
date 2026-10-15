"use client";

import { useId } from "react";
import { motion } from "framer-motion";

import { cn } from "@/lib/format";
import { SPRING_TIGHT } from "@/lib/motion";

/** A compact segmented control with a sliding indicator (Buy/Sell, timeframes). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: React.ReactNode; disabled?: boolean }>;
  className?: string;
  size?: "sm" | "md";
  "aria-label"?: string;
}) {
  const id = useId();
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("relative flex rounded-lg bg-surface-2 p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative z-10 flex-1 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active ? "text-fg" : "text-fg-muted hover:text-fg"
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                transition={SPRING_TIGHT}
                className="absolute inset-0 -z-10 rounded-md border border-line-strong bg-surface-3"
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
