"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/format";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40 active:scale-[0.98]",
  {
    variants: {
      variant: {
        // White text only on the darker logo blue (5.1:1). YES/NO fills are
        // bright, so they carry dark text (9.4:1 / 6.1:1), exchange-style.
        default: "bg-accent-strong text-accent-foreground hover:brightness-110 shadow-cta",
        secondary: "bg-surface-2 text-fg hover:bg-surface-3 border border-line",
        outline: "border border-line-strong bg-transparent hover:bg-surface-2 text-fg",
        ghost: "hover:bg-surface-2 text-fg-muted hover:text-fg",
        destructive: "bg-no text-bg hover:brightness-110",
        yes: "bg-yes text-bg hover:brightness-110 shadow-[0_8px_24px_-12px_rgb(var(--yes)/0.7)]",
        no: "bg-no text-bg hover:brightness-110 shadow-[0_8px_24px_-12px_rgb(var(--no)/0.7)]",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-6 text-base",
        xl: "h-14 px-6 text-lg rounded-xl",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
