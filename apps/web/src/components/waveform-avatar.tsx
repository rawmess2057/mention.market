"use client";

import { cn } from "@/lib/format";

export function WaveformAvatar({
  speaking = false,
  size = "md",
  className,
}: {
  speaking?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dims = size === "sm" ? 28 : size === "md" ? 40 : 48;
  const bars = 5;
  const barWidth = size === "sm" ? 2 : 3;
  const gap = size === "sm" ? 1.5 : 2;

  return (
    <div
      className={cn(
        "relative flex items-center justify-center rounded-full bg-blue-light",
        speaking && "ring-2 ring-blue/20",
        className
      )}
      style={{ width: dims, height: dims }}
      aria-hidden
    >
      <svg
        width={dims * 0.5}
        height={dims * 0.5}
        viewBox="0 0 20 20"
        className="overflow-visible"
      >
        {Array.from({ length: bars }).map((_, i) => {
          const x = (i - (bars - 1) / 2) * (barWidth + gap);
          const baseHeight = 4 + Math.sin(i * 1.2) * 2;
          return (
            <rect
              key={i}
              x={x - barWidth / 2}
              y={-baseHeight / 2}
              width={barWidth}
              rx={1}
              fill="#2E7DF6"
              opacity={0.7}
            >
              {speaking && (
                <animate
                  attributeName="height"
                  values={`${baseHeight};${baseHeight * 2.5};${baseHeight * 1.5};${baseHeight * 3};${baseHeight}`}
                  dur={`${0.8 + i * 0.15}s`}
                  repeatCount="indefinite"
                />
              )}
              {speaking && (
                <animate
                  attributeName="y"
                  values={`${-baseHeight / 2};${-baseHeight * 2.5 / 2};${-baseHeight * 1.5 / 2};${-baseHeight * 3 / 2};${-baseHeight / 2}`}
                  dur={`${0.8 + i * 0.15}s`}
                  repeatCount="indefinite"
                />
              )}
            </rect>
          );
        })}
      </svg>

      {/* Speaking indicator ring */}
      {speaking && (
        <div className="absolute inset-0 rounded-full ring-2 ring-blue/30 animate-pulse-live" />
      )}
    </div>
  );
}
