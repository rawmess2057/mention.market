"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/format";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-blue text-white hover:bg-blue-dark shadow-sm",
        secondary: "bg-cream-dark text-navy hover:bg-gray-warm border border-gray-warm/60",
        outline: "border border-gray-warm bg-white hover:bg-cream-dark text-navy",
        ghost: "hover:bg-cream-dark text-navy",
        destructive: "bg-red-brand text-white hover:bg-red-brand/90 shadow-sm",
        yes: "bg-green text-white hover:bg-green/90 shadow-[0_2px_12px_rgba(43,117,80,0.25)]",
        no: "bg-red-brand text-white hover:bg-red-brand/90 shadow-[0_2px_12px_rgba(199,91,58,0.25)]",
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
