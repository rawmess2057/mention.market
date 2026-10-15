import { create } from "zustand";

/**
 * App-wide toasts. `toast.pending()` returns an id that a later
 * `toast.success/error(..., { id })` resolves in place — the shape of a
 * transaction: "Confirming…" turns into "Bought 0.41 YES" without a second
 * toast popping in.
 */

export type ToastKind = "info" | "pending" | "success" | "error";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
  /** Optional link (e.g. a transaction on the explorer). */
  href?: string;
  hrefLabel?: string;
}

interface ToastOptions {
  id?: number;
  description?: string;
  href?: string;
  hrefLabel?: string;
  /** ms; pending toasts never auto-dismiss. */
  duration?: number;
}

interface ToastState {
  toasts: ToastItem[];
  dismiss: (id: number) => void;
}

const DEFAULT_MS: Record<ToastKind, number> = { info: 3200, pending: 0, success: 4200, error: 6500 };
const MAX_VISIBLE = 4;
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  dismiss: (id) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

function push(kind: ToastKind, title: string, opts: ToastOptions = {}): number {
  const id = opts.id ?? nextId++;
  const item: ToastItem = { id, kind, title, description: opts.description, href: opts.href, hrefLabel: opts.hrefLabel };
  useToasts.setState((s) => {
    const exists = s.toasts.some((t) => t.id === id);
    const toasts = exists ? s.toasts.map((t) => (t.id === id ? item : t)) : [...s.toasts, item];
    return { toasts: toasts.slice(-MAX_VISIBLE) };
  });
  clearTimeout(timers.get(id));
  const ms = opts.duration ?? DEFAULT_MS[kind];
  if (ms > 0) timers.set(id, setTimeout(() => useToasts.getState().dismiss(id), ms));
  return id;
}

export const toast = {
  info: (title: string, opts?: ToastOptions) => push("info", title, opts),
  pending: (title: string, opts?: ToastOptions) => push("pending", title, opts),
  success: (title: string, opts?: ToastOptions) => push("success", title, opts),
  error: (title: string, opts?: ToastOptions) => push("error", title, opts),
  dismiss: (id: number) => useToasts.getState().dismiss(id),
};

/** Legacy one-line messages (`showToast`): infer the tone from the wording. */
export function toastFromMessage(message: string): number {
  return /fail|error|couldn't|can't|cannot|rejected|insufficient|invalid/i.test(message)
    ? toast.error(message)
    : toast.info(message);
}

/** Solana explorer link for a devnet transaction. */
export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
