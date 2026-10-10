import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Short, user-readable text for a caught error. Wallet and RPC errors arrive
 * as multi-line prose; only the first line is worth putting in a toast.
 */
export function fmtErr(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : JSON.stringify(err);
  const first = raw.split("\n")[0].trim();
  if (!first) return "Transaction failed";
  return first.length > 140 ? `${first.slice(0, 139)}…` : first;
}

export function fmtSol(n: number, opts?: { compact?: boolean; decimals?: number }) {
  const d = opts?.decimals ?? 2;
  if (opts?.compact) {
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) {
      return `◎ ${(n / 1_000_000_000).toFixed(1)}b`;
    }
    if (abs >= 1_000_000) {
      return `◎ ${(n / 1_000_000).toFixed(1)}m`;
    }
    if (abs >= 1_000) {
      return `◎ ${(n / 1_000).toFixed(1)}k`;
    }
  }
  return `◎ ${n.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`;
}

/**
 * Format an amount of SOL. Everything in this app is SOL-denominated — both
 * on-chain markets (lamports / 1e9) and the simulated demo book — so there is
 * no per-asset branch here: it is always the `◎` unit.
 */
export function fmtBalance(n: number, opts?: { compact?: boolean; decimals?: number }) {
  return fmtSol(n, {
    compact: opts?.compact,
    decimals: opts?.decimals ?? (opts?.compact ? 1 : 4),
  });
}

export function fmtPct(n: number, decimals = 0) {
  return `${(n * 100).toFixed(decimals)}%`;
}

export function fmtTimeLeft(ms: number): string {
  if (ms <= 0) return "ended";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function fmtClock(t: number): string {
  // t = ms offset in stream
  const s = Math.max(0, Math.floor(t / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const h = Math.floor(m / 60);
  if (h > 0) {
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function shortAddr(a: string): string {
  if (a.length <= 6) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

/** Roughly-rounded "time since" for the notification feed. */
export function fmtAgo(t: number): string {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
