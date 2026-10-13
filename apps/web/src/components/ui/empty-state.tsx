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
        "flex flex-col items-center justify-center rounded-card border border-dashed border-ink-200 px-6 py-10 text-center",
        className
      )}
    >
      {icon && (
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-tile bg-ink-100 text-gray-mid">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-navy">{title}</p>
      {body && <p className="mt-1 max-w-sm text-label text-gray-mid">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
