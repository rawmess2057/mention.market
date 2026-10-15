"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Home,
  Briefcase,
  PlusCircle,
  Trophy,
  User,
  Bell,
  ChevronDown,
  Copy,
  ExternalLink,
  LogOut,
  CheckCircle2,
  Lock,
  ShieldAlert,
} from "lucide-react";
import { cn, fmtAgo, fmtSol, shortAddr } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { NotificationItem } from "@/lib/types";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/create", label: "Create", icon: PlusCircle },
  { href: "/leaderboard", label: "Ranks", icon: Trophy },
];

export function TopBar() {
  const { connected, publicKey, disconnect } = useWallet();
  const user = useStore((s) => s.user);
  const showToast = useStore((s) => s.showToast);
  const pathname = usePathname();

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line/80 bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 md:px-8 lg:px-12">
          <Link href="/" className="group flex items-center gap-2.5">
            <Image
              src="/mention-logo.svg"
              alt=""
              width={32}
              height={32}
              priority
              unoptimized
              className="h-8 w-8 shadow-md"
            />
            <span className="text-[15px] font-bold tracking-tight text-fg">
              mention<span className="text-accent">.market</span>
            </span>
          </Link>

          <div className="flex items-center gap-3">
            {connected && (
              <div className="hidden items-center gap-1.5 rounded-full border border-yes/20 bg-yes-soft px-3 py-1.5 text-xs sm:flex">
                <span className="text-fg-muted">Balance</span>
                <span className="font-mono font-semibold text-yes">
                  {fmtSol(user.balance)}
                </span>
              </div>
            )}
            <NotifBell />
            <div className="flex items-center gap-1.5">
              {connected && publicKey ? (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      aria-label="Wallet menu"
                      className="flex items-center gap-1.5 rounded-full border border-yes/20 bg-yes-soft px-2.5 py-1 text-xs text-yes transition-colors hover:border-yes/40"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-yes animate-pulse" />
                      <span className="font-mono font-semibold">
                        {shortAddr(publicKey.toBase58())}
                      </span>
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="end"
                      sideOffset={6}
                      className="z-50 min-w-[200px] overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-dropdown"
                    >
                      <div className="px-2.5 py-2 text-xs text-fg-muted">
                        <div className="font-medium text-fg">{user.handle}</div>
                        <div className="mt-0.5 font-mono">{shortAddr(publicKey.toBase58())}</div>
                      </div>
                      <DropdownMenu.Separator className="my-1 h-px bg-surface-3/60" />
                      <DropdownItem asChild active={pathname === "/portfolio"}>
                        <Link href="/portfolio">
                          <Briefcase className="h-3.5 w-3.5" /> Portfolio
                        </Link>
                      </DropdownItem>
                      <DropdownItem asChild active={pathname === "/leaderboard"}>
                        <Link href="/leaderboard">
                          <Trophy className="h-3.5 w-3.5" /> Ranks
                        </Link>
                      </DropdownItem>
                      <DropdownMenu.Separator className="my-1 h-px bg-surface-3/60" />
                      <DropdownItem
                        onSelect={() => navigator.clipboard.writeText(publicKey.toBase58())}
                      >
                        <Copy className="h-3.5 w-3.5" /> Copy address
                      </DropdownItem>
                      <DropdownItem asChild>
                        <a
                          href={`https://explorer.solana.com/address/${publicKey.toBase58()}?cluster=devnet`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> View on explorer
                        </a>
                      </DropdownItem>
                      <DropdownMenu.Separator className="my-1 h-px bg-surface-3/60" />
                      <DropdownItem
                        destructive
                        onSelect={async () => {
                          await disconnect();
                          showToast("Wallet disconnected");
                        }}
                      >
                        <LogOut className="h-3.5 w-3.5" /> Disconnect
                      </DropdownItem>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              ) : (
                <WalletMultiButton />
              )}
            </div>
          </div>
        </div>
      </header>

    </>
  );
}

const NOTIF_ICON: Record<NotificationItem["kind"], React.ReactNode> = {
  locked: <Lock className="h-3.5 w-3.5 shrink-0 text-accent" />,
  resolved: <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-yes" />,
  "chain-resolved": <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-yes" />,
  challenge: <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-warn" />,
};

function NotifBell() {
  const notifications = useStore((s) => s.notifications);
  const markAllRead = useStore((s) => s.markAllRead);
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <DropdownMenu.Root onOpenChange={(open) => open && markAllRead()}>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
          className="relative rounded-full p-2 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-strong px-1 text-[9px] font-bold text-accent-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[340px] overflow-hidden rounded-lg border border-line bg-surface shadow-dropdown"
        >
          <div className="flex items-center justify-between border-b border-line/60 px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Notifications
            </span>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-[11px] font-medium text-accent hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-fg-muted">
                No updates yet — lock and resolution alerts for markets you trade land here.
              </p>
            ) : (
              notifications.slice(0, 10).map((n) => (
                <DropdownMenu.Item key={n.id} asChild>
                  <Link
                    href={n.marketSlug ? `/market/${n.marketSlug}` : "/"}
                    className="flex items-start gap-2.5 px-3 py-2.5 outline-none transition-colors hover:bg-accent-soft"
                  >
                    {NOTIF_ICON[n.kind]}
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs leading-snug text-fg">{n.text}</span>
                      <span className="mt-0.5 block text-[10px] font-mono text-fg-muted">
                        {fmtAgo(n.at)}
                      </span>
                    </span>
                    {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-strong" />}
                  </Link>
                </DropdownMenu.Item>
              ))
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  // Market pages own the bottom of the screen with their own trade action bar,
  // so the tab bar would only compete with the primary action there.
  if (pathname.startsWith("/market/")) return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="mx-auto mb-3 max-w-[280px]">
        <div className="flex items-center justify-around rounded-2xl border border-line bg-surface/95 px-2 py-2 shadow-lg backdrop-blur">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-xl transition-all",
                  active
                    ? "bg-accent-strong text-accent-foreground shadow-md"
                    : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                )}
              >
                <Icon className="h-5 w-5" />
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

export function UserBadge() {
  const user = useStore((s) => s.user);
  return (
    <div className="flex items-center gap-2 text-xs text-fg-muted">
      <User className="h-3.5 w-3.5" />
      <span className="text-fg">{user.handle}</span>
      <span className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent">
        {user.points.toLocaleString()} pts
      </span>
    </div>
  );
}

function DropdownItem({
  asChild,
  destructive,
  active,
  onSelect,
  children,
}: {
  asChild?: boolean;
  destructive?: boolean;
  active?: boolean;
  onSelect?: () => void | Promise<void>;
  children: React.ReactNode;
}) {
  const cls = cn(
    "flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none transition-colors",
    active
      ? "bg-accent-soft font-semibold text-accent"
      : destructive
        ? "text-no hover:bg-no/10"
        : "text-fg hover:bg-accent-soft"
  );
  if (asChild)
    return (
      <DropdownMenu.Item onSelect={onSelect} className={cls} asChild>
        {children}
      </DropdownMenu.Item>
    );
  return (
    <DropdownMenu.Item onSelect={onSelect} className={cls}>
      {children}
    </DropdownMenu.Item>
  );
}
