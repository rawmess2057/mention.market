"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ExternalLink, Info, Loader2, X, XCircle } from "lucide-react";

import { cn } from "@/lib/format";
import { EASE } from "@/lib/motion";
import { useToasts, type ToastKind } from "@/lib/toast";

const ICON: Record<ToastKind, React.ReactNode> = {
  info: <Info className="h-4 w-4 text-accent" aria-hidden />,
  pending: <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden />,
  success: <CheckCircle2 className="h-4 w-4 text-yes" aria-hidden />,
  error: <XCircle className="h-4 w-4 text-no" aria-hidden />,
};

/** Toast stack: bottom-right on desktop, above the bottom nav on mobile. */
export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 md:inset-x-auto md:bottom-6 md:right-6 md:items-end md:px-0"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, transition: { duration: 0.16 } }}
            transition={{ duration: 0.28, ease: EASE }}
            role={t.kind === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-surface-2/95 px-3.5 py-3 shadow-dropdown backdrop-blur-md",
              t.kind === "error" ? "border-no/30" : t.kind === "success" ? "border-yes/25" : "border-line"
            )}
          >
            <span className="mt-0.5 shrink-0">{ICON[t.kind]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug text-fg">{t.title}</p>
              {t.description && <p className="mt-0.5 text-xs leading-snug text-fg-muted">{t.description}</p>}
              {t.href && (
                <a
                  href={t.href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  {t.hrefLabel ?? "View transaction"} <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="-mr-1 rounded-md p-1 text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
