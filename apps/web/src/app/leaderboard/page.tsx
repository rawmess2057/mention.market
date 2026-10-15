"use client";

import { useMemo } from "react";
import { Trophy } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

import { Button } from "@/components/ui/button";
import { cn, fmtBalance, fmtPct } from "@/lib/format";
import { useStore } from "@/lib/store";

/**
 * A global ranking needs every wallet's trades, which arrive with the indexer.
 * Until then this page shows the connected wallet's own record — real data,
 * from this browser's trade history.
 */
export default function LeaderboardPage() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const user = useStore((s) => s.user);
  const trades = useStore((s) => s.trades);

  const stats = useMemo(() => {
    const closed = trades.filter((t) => t.kind === "sell" || t.kind === "claim");
    const wins = closed.filter((t) => t.pnl > 0).length;
    return {
      points: user.points,
      realized: closed.reduce((s, t) => s + t.pnl, 0),
      winRate: closed.length > 0 ? wins / closed.length : null,
      trades: trades.length,
    };
  }, [trades, user.points]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-fg">Leaderboard</h1>
        <p className="mt-1 text-sm text-fg-muted">Points for trading, holding to resolution and claiming.</p>
      </div>

      <section className="panel p-5">
        <div className="label-caps">Your record</div>
        {connected ? (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Points" value={stats.points.toLocaleString()} />
            <Stat
              label="Realized P&L"
              value={`${stats.realized >= 0 ? "+" : ""}${fmtBalance(stats.realized)}`}
              tone={stats.realized > 0 ? "yes" : stats.realized < 0 ? "no" : undefined}
            />
            <Stat label="Win rate" value={stats.winRate == null ? "—" : fmtPct(stats.winRate)} />
            <Stat label="Trades" value={String(stats.trades)} />
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">Connect a wallet to see your points and record.</p>
            <Button size="sm" onClick={() => setVisible(true)}>
              Connect wallet
            </Button>
          </div>
        )}
      </section>

      <section className="panel flex flex-col items-center gap-3 px-6 py-12 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft">
          <Trophy className="h-5 w-5 text-accent" aria-hidden />
        </span>
        <h2 className="text-base font-semibold text-fg">Global rankings are coming</h2>
        <p className="max-w-sm text-sm text-fg-muted">
          Rankings across every wallet go live with the on-chain indexer. Points you earn now count toward them.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "yes" | "no" }) {
  return (
    <div>
      <div className="text-xs text-fg-subtle">{label}</div>
      <div className={cn("tnum mt-1 text-xl font-semibold text-fg", tone === "yes" && "text-yes", tone === "no" && "text-no")}>
        {value}
      </div>
    </div>
  );
}
