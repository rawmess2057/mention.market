import * as React from "react";
import { cn } from "@/lib/format";

/** Labelled figure for market metadata (volume, traders, countdown, source). */
export function Stat({
  label,
  value,
  hint,
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="label-caps flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="tnum mt-0.5 truncate font-mono text-sm font-semibold text-navy">
        {value}
      </div>
      {hint && <div className="text-micro text-gray-mid">{hint}</div>}
    </div>
  );
}

/** Horizontal set of stats with hairline separators. */
export function StatRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-3",
        "[&>*+*]:border-l [&>*+*]:border-ink-200 [&>*+*]:pl-6",
        className
      )}
    >
      {children}
    </div>
  );
}
