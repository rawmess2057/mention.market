"use client";

import Link from "next/link";
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
  Zap,
  Bell,
  ChevronDown,
  Copy,
  ExternalLink,
  LogOut,
} from "lucide-react";
import { cn, fmtUsd, shortAddr } from "@/lib/format";
import { useSim } from "@/lib/sim";
import { useDevnetUsdc } from "@/hooks/useDevnetUsdc";

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
  const user = useSim((s) => s.user);
  const toast = useSim((s) => s.toast);
  const showToast = useSim((s) => s.showToast);
  const { usdcBalance } = useDevnetUsdc();
  const pathname = usePathname();
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    if (!toast) return;
    setToastVisible(true);
    const t = setTimeout(() => setToastVisible(false), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-gray-warm/80 bg-cream/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue text-white shadow-md">
              <Zap className="h-4 w-4" />
            </span>
            <span className="text-[15px] font-bold tracking-tight text-navy">
              mention<span className="text-blue">.market</span>
            </span>
          </Link>

          <div className="flex items-center gap-3">
            {connected && (
              <div className="hidden items-center gap-1.5 rounded-full border border-green/20 bg-green-light px-3 py-1.5 text-xs sm:flex">
                <span className="text-gray-mid">
                  {user.balanceKind === "sol" ? "Balance" : "Balance"}
                </span>
                <span className="font-mono font-semibold text-green">
                  {user.balanceKind === "sol"
                    ? `◎ ${user.balance.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                    : fmtUsd(user.balance)}
                </span>
              </div>
            )}
            {connected && usdcBalance !== null && (
              <a
                href="https://faucet.circle.com/"
                target="_blank"
                rel="noreferrer"
                title="Devnet USDC — top up at faucet.circle.com"
                className="flex items-center gap-1.5 rounded-full border border-blue/20 bg-blue-light px-3 py-1.5 text-xs transition-colors hover:border-blue/40"
              >
                <span className="text-gray-mid">USDC</span>
                <span className="font-mono font-semibold text-blue">{fmtUsd(usdcBalance)}</span>
              </a>
            )}
            <button
              aria-label="Notifications"
              className="rounded-full p-2 text-gray-mid transition-colors hover:bg-cream-dark hover:text-navy"
            >
              <Bell className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1.5">
              {connected && publicKey ? (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      aria-label="Wallet menu"
                      className="flex items-center gap-1.5 rounded-full border border-green/20 bg-green-light px-2.5 py-1 text-xs text-green transition-colors hover:border-green/40"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-green animate-pulse" />
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
                      className="z-50 min-w-[200px] overflow-hidden rounded-lg border border-gray-warm bg-white p-1 shadow-dropdown"
                    >
                      <div className="px-2.5 py-2 text-xs text-gray-mid">
                        <div className="font-medium text-navy">{user.handle}</div>
                        <div className="mt-0.5 font-mono">{shortAddr(publicKey.toBase58())}</div>
                      </div>
                      <DropdownMenu.Separator className="my-1 h-px bg-gray-warm/60" />
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
                      <DropdownMenu.Separator className="my-1 h-px bg-gray-warm/60" />
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
                      <DropdownMenu.Separator className="my-1 h-px bg-gray-warm/60" />
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

      {/* Toast */}
      {toast && toastVisible && (
        <div className="pointer-events-none fixed inset-x-0 top-24 z-[60] flex justify-center px-4">
          <div className="animate-fade-in rounded-full border border-blue/20 bg-white px-5 py-2.5 text-sm font-medium text-navy shadow-lg backdrop-blur">
            {toast}
          </div>
        </div>
      )}
    </>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="mx-auto mb-3 max-w-[280px]">
        <div className="flex items-center justify-around rounded-2xl border border-gray-warm bg-white/95 px-2 py-2 shadow-lg backdrop-blur">
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
                    ? "bg-blue text-white shadow-md"
                    : "text-gray-mid hover:bg-cream-dark hover:text-navy"
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
  const user = useSim((s) => s.user);
  return (
    <div className="flex items-center gap-2 text-xs text-gray-mid">
      <User className="h-3.5 w-3.5" />
      <span className="text-navy">{user.handle}</span>
      <span className="rounded-full bg-blue-light px-2 py-0.5 font-semibold text-blue">
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
      ? "bg-blue-light font-semibold text-blue"
      : destructive
        ? "text-red-brand hover:bg-red-brand/10"
        : "text-navy hover:bg-blue-light"
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
