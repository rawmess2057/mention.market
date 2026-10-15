import { cn } from "@/lib/format";

/** Shimmer block. Uses the global `.shimmer` keyframe so timing stays in one place. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("shimmer rounded-field bg-surface-2", className)}
    />
  );
}

export function MarketCardSkeleton() {
  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-9 w-9 rounded-tile" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
      <Skeleton className="h-2 w-full rounded-pill" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-20 rounded-field" />
        <Skeleton className="h-6 w-20 rounded-field" />
      </div>
    </div>
  );
}

export function PanelSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("panel space-y-3 p-4", className)}>
      <Skeleton className="h-3 w-20" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-tile" />
      ))}
    </div>
  );
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("panel overflow-hidden", className)}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Skeleton className="h-5 w-9" />
        <Skeleton className="h-5 w-9" />
        <Skeleton className="h-5 w-9" />
      </div>
      <Skeleton className="h-[280px] w-full rounded-none" />
    </div>
  );
}
