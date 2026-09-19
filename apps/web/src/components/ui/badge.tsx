import * as React from "react";
import { cn } from "@/lib/format";
import { STATUS_META, type MarketStatus } from "@/lib/types";

const Badge = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        className
      )}
      {...props}
    />
  )
);
Badge.displayName = "Badge";

export function StatusBadge({ status, className }: { status: MarketStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <Badge className={cn(meta.className, className)}>
      {status === "open" && (
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-live" />
      )}
      {meta.label}
    </Badge>
  );
}

export { Badge };
