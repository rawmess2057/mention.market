import { cn } from "@/lib/format";

/** Shimmer block. Uses the global `.shimmer` keyframe so timing stays in one place. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("shimmer rounded-field bg-surface-3", className)}
    />
  );
}

export function MarketCardSkeleton() {
  // Mirrors `MarketCard` so nothing shifts when the data lands.
  return (
    <div className="flex flex-col gap-3.5 rounded-2xl border border-line/80 bg-surface p-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-7 w-7 rounded-field" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="ml-auto h-4 w-16 rounded-pill" />
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-5 w-11/12" />
        <Skeleton className="h-5 w-2/3" />
      </div>
      <div className="flex items-end justify-between">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Skeleton className="h-7 rounded-field" />
        <Skeleton className="h-7 rounded-field" />
      </div>
      <Skeleton className="h-3 w-24" />
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
