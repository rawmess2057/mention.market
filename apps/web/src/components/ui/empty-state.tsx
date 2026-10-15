import * as React from "react";
import { cn } from "@/lib/format";

/** Consistent "nothing here yet" surface: icon, one-line reason, one action. */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-card border border-dashed border-line px-6 py-10 text-center",
        className
      )}
    >
      {icon && (
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-tile bg-surface-2 text-fg-muted">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-fg">{title}</p>
      {body && <p className="mt-1 max-w-sm text-label text-fg-muted">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
