"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/format";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

/**
 * Bottom sheet on mobile, centred dialog on desktop — the trade flow's home on
 * a phone. The header and footer stay put while the quote scrolls, so the
 * confirm button never leaves the thumb zone.
 */
export function SheetContent({
  title,
  description,
  children,
  footer,
  className,
  hideTitle = false,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  /** Visually hide the title but keep it for assistive tech. */
  hideTitle?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-navy/30 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col border border-ink-200 bg-white shadow-dropdown",
          "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-panel animate-in slide-in-from-bottom-10 duration-300",
          "sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-h-[85vh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-panel",
          className
        )}
        {...props}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-pill bg-ink-200 sm:hidden" />
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-3">
          <div className="min-w-0">
            <DialogPrimitive.Title
              className={cn(
                "truncate text-body-lg font-semibold tracking-tight text-navy",
                hideTitle && "sr-only"
              )}
            >
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mt-0.5 line-clamp-2 text-label text-gray-mid">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="-mr-1 shrink-0 rounded-pill p-1.5 text-gray-mid transition-colors hover:bg-ink-100 hover:text-navy"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </div>

        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>

        {footer && (
          <div className="border-t border-ink-200 bg-white/95 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
            {footer}
          </div>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
