import * as React from "react";
import { cn } from "@/lib/format";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-lg border border-gray-warm bg-white px-3 py-2 text-sm text-navy transition-colors placeholder:text-gray-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:border-blue disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
