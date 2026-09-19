import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtUsd(n: number, opts?: { compact?: boolean; decimals?: number }) {
  const d = opts?.decimals ?? 2;
  if (opts?.compact) {
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) {
      return `$${(n / 1_000_000_000).toFixed(1)}b`;
    }
    if (abs >= 1_000_000) {
      return `$${(n / 1_000_000).toFixed(1)}m`;
    }
    if (abs >= 1_000) {
      return `$${(n / 1_000).toFixed(1)}k`;
    }
  }
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`;
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

export function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
