"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Activity,
  Clock,
  TrendingUp,
  TrendingDown,
  Wallet,
  Trophy,
  Filter,
  History as HistoryIcon,
  BarChart3,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { cn, fmtTimeLeft, fmtUsd, shortAddr } from "@/lib/format";
import { lmsrPositionValue, lmsrProbYes } from "@/lib/lmsr";
import { pnlSeries, summarizePnl, verticalBreakdown } from "@/lib/pnl";
import { claimableAmounts } from "@/lib/settle";
import { useSim } from "@/lib/sim";
import { STATUS_META, type Market, type TradeRecord } from "@/lib/types";

type FilterStatus = "all" | "open" | "resolving" | "resolved";
type SortKey = "pnl" | "value" | "name";

interface PositionRow {
  marketId: string;
  market: Market;
  side: string;
  shares: number;
  avgEntry: number;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  pnl: number;
  pnlPct: number;
  timeLeft: number;
  isClaimable: boolean;
  claimableAmount: number;
  wordBacks?: Record<string, number>;
}

function computePositions(
  positions: Record<string, any>,
  markets: Record<string, Market>,
  claimable: Record<string, number>
): PositionRow[] {
  return Object.values(positions)
    .map((pos) => {
      const m = markets[pos.marketId];
      if (!m) return null;

      if (m.type === "binary") {
        const yes = pos.yesShares ?? 0;
        const no = pos.noShares ?? 0;
        if (yes === 0 && no === 0) return null;

        const side = yes > 0 ? "YES" : "NO";
        const shares = yes > 0 ? yes : no;
        const avgEntry = yes > 0 ? (pos.avgYesPrice ?? 0) : (pos.avgNoPrice ?? 0);
        const currentPrice = lmsrProbYes(m.yesShares, m.noShares, m.b);
        const displayPrice = yes > 0 ? currentPrice : 1 - currentPrice;
        const marketValue = lmsrPositionValue(m.yesShares, m.noShares, m.b, {
          yesShares: yes,
          noShares: no,
        });
        const costBasis = avgEntry * shares;
        const pnl = marketValue - costBasis;
        const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
        const timeLeft = m.endTime - Date.now();

        return {
          marketId: m.id,
          market: m,
          side,
          shares,
          avgEntry,
          currentPrice: displayPrice,
          marketValue,
          costBasis,
          pnl,
          pnlPct,
          timeLeft,
          isClaimable: !!claimable[m.id],
          claimableAmount: claimable[m.id] ?? 0,
        };
      }

      // Majority market
      const wordBacks: Record<string, number> = pos.wordBacks ?? {};
      const entries = Object.entries(wordBacks).filter(([, v]) => v > 0) as [string, number][];
      if (entries.length === 0) return null;

      const totalBacked = entries.reduce((s, [, v]) => s + v, 0);
      const odds = m.words
        ? Object.fromEntries(
            m.words.map((w) => {
              const pot = m.words!.reduce((s, x) => s + x.pool, 0);
              return [w.word, pot > 0 ? w.pool / pot : 0];
            })
          )
        : {};
      const sorted = [...entries].sort((a, b) => b[1] - a[1]);
      const bestWord = sorted[0]!;
      const bestOdds = odds[bestWord[0]] ?? 0;

      return {
        marketId: m.id,
        market: m,
        side: entries.map(([w]) => w).join(", "),
        shares: totalBacked,
        avgEntry: 0,
        currentPrice: bestOdds,
        marketValue: totalBacked,
        costBasis: totalBacked,
        pnl: 0,
        pnlPct: 0,
        timeLeft: m.endTime - Date.now(),
        isClaimable: !!claimable[m.id],
        claimableAmount: claimable[m.id] ?? 0,
        wordBacks,
      };
    })
    .filter(Boolean) as PositionRow[];
}

export default function PortfolioPage() {
  const { connected } = useWallet();
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold tracking-tight text-navy">Portfolio</h1>
          <p className="mt-1 text-sm text-gray-mid">
            Your book — P&L, positions, and every trade you&apos;ve made
          </p>
        </div>
      </div>

      {connected ? (
        <Tabs defaultValue="overview">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="overview" className="flex-1 gap-1.5 sm:flex-none">
              <BarChart3 className="h-3.5 w-3.5" /> Overview
            </TabsTrigger>
            <TabsTrigger value="positions" className="flex-1 gap-1.5 sm:flex-none">
              <Wallet className="h-3.5 w-3.5" /> Positions
            </TabsTrigger>
            <TabsTrigger value="history" className="flex-1 gap-1.5 sm:flex-none">
              <HistoryIcon className="h-3.5 w-3.5" /> History
            </TabsTrigger>
          </TabsList>

          <OverviewTab />
          <PositionsTab />
          <HistoryTab />
        </Tabs>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-gray-warm bg-white p-12 text-center shadow-card">
          <Wallet className="h-8 w-8 text-gray-mid" />
          <div>
            <p className="font-serif text-lg font-semibold text-navy">Connect your wallet</p>
            <p className="mt-1 max-w-md text-sm text-gray-mid">
              Your portfolio is per-wallet: positions, trade history, and P&L are all
              tied to the connected account.
            </p>
          </div>
          <WalletMultiButton className="!bg-navy hover:opacity-90" />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview — PnL dashboard                                             */
/* ------------------------------------------------------------------ */

const TAB_CLASS =
  "rounded-xl border border-gray-warm bg-white p-4 shadow-card";

function OverviewTab({ className }: { className?: string }) {
  const markets = useSim((s) => s.markets);
  const positions = useSim((s) => s.positions);
  const user = useSim((s) => s.user);
  const trades = useSim((s) => s.trades);
  const claimable = useMemo(
    () => claimableAmounts(positions, markets),
    [positions, markets]
  );

  const overview = useMemo(
    () => summarizePnl(trades, positions, markets, claimable, user.balance),
    [trades, positions, markets, claimable, user.balance]
  );
  const series = useMemo(() => pnlSeries(trades, 14), [trades]);
  const byVertical = useMemo(() => verticalBreakdown(trades, markets), [trades, markets]);
  const maxVertical = Math.max(1, ...byVertical.map((v) => v.buyVolume));

  const settled = useMemo(() => trades.filter((t) => t.pnl !== 0), [trades]);
  let best: TradeRecord | undefined;
  let worst: TradeRecord | undefined;
  for (const t of settled) {
    if (!best || t.pnl > best.pnl) best = t;
    if (!worst || t.pnl < worst.pnl) worst = t;
  }

  return (
    <TabsContent value="overview" className={className}>
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <PnlCard
          label="Net P&L"
          value={fmtSigned(overview.netPnl)}
          tone={toneOf(overview.netPnl)}
          icon={overview.netPnl >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
        />
        <PnlCard
          label="Realized"
          value={fmtSigned(overview.realizedPnl)}
          tone={toneOf(overview.realizedPnl)}
          icon={<Activity className="h-3.5 w-3.5" />}
        />
        <PnlCard
          label="Unrealized"
          value={fmtSigned(overview.unrealizedPnl)}
          tone={toneOf(overview.unrealizedPnl)}
          icon={<TrendingUp className="h-3.5 w-3.5" />}
        />
        <PnlCard
          label="Claimable"
          value={fmtUsd(overview.claimableTotal)}
          tone="pos"
          icon={<Trophy className="h-3.5 w-3.5" />}
        />
        <PnlCard
          label="Net Worth"
          value={fmtUsd(overview.netWorth)}
          tone="neutral"
          icon={<Wallet className="h-3.5 w-3.5" />}
        />
        <PnlCard
          label="Win Rate"
          value={`${(overview.winRate * 100).toFixed(0)}%`}
          tone="neutral"
          icon={<Filter className="h-3.5 w-3.5" />}
          sub={`${overview.wins}/${overview.settled} settled`}
        />
        <PnlCard
          label="Trades"
          value={overview.tradeCount.toString()}
          tone="neutral"
          icon={<HistoryIcon className="h-3.5 w-3.5" />}
        />
      </div>

      {/* Best / worst settled trades */}
      {settled.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {best && (
            <div className="flex items-center gap-3 rounded-xl border border-green/20 bg-green-light/40 p-3">
              <Trophy className="h-4 w-4 flex-none text-green" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-navy">{best.marketTitle}</div>
                <div className="text-[10px] text-gray-mid">
                  {best.kind === "sell" ? "Sold" : "Claimed"} {tSideLabel(best.side)} · {fmtWhen(best.at)}
                </div>
              </div>
              <span className="font-mono text-sm font-bold text-green">+{fmtUsd(best.pnl)}</span>
            </div>
          )}
          {worst && (
            <div className="flex items-center gap-3 rounded-xl border border-red-brand/20 bg-red-50/60 p-3">
              <TrendingDown className="h-4 w-4 flex-none text-red-brand" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-navy">{worst.marketTitle}</div>
                <div className="text-[10px] text-gray-mid">
                  {worst.kind === "sell" ? "Sold" : "Claimed"} {tSideLabel(worst.side)} · {fmtWhen(worst.at)}
                </div>
              </div>
              <span className="font-mono text-sm font-bold text-red-brand">−{fmtUsd(Math.abs(worst.pnl))}</span>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* P&L trend */}
        <div className={cn(TAB_CLASS, "lg:col-span-3")}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-mid">
              Realized P&L trend
            </h2>
            <span className="text-xs text-gray-mid">
              cumulative <span className={cn("font-mono font-semibold", overview.realizedPnl >= 0 ? "text-green" : "text-red-brand")}>
                {overview.realizedPnl >= 0 ? "+" : ""}
                {fmtUsd(overview.realizedPnl)}
              </span>
            </span>
          </div>
          {series.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-gray-mid">
                No settled trades yet. Sell a position or claim a win and it shows up here.
              </p>
            </div>
          ) : (
            <div className="flex h-40 items-end gap-1.5">
              {series.map((b) => {
                const maxAbs = Math.max(1, ...series.map((x) => Math.abs(x.realizedPnl)));
                const h = Math.min(100, (Math.abs(b.realizedPnl) / maxAbs) * 100);
                return (
                  <div key={b.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                    <span
                      className={cn(
                        "font-mono text-[9px]",
                        b.realizedPnl >= 0 ? "text-green/80" : "text-red-brand/80"
                      )}
                    >
                      {b.realizedPnl >= 0 ? "+" : ""}
                      {fmtUsd(b.realizedPnl, { compact: true })}
                    </span>
                    <div
                      className={cn("w-full rounded-t", b.realizedPnl >= 0 ? "bg-green/80" : "bg-red-brand/80")}
                      style={{ height: `${Math.max(3, h)}%` }}
                      title={`${b.label}: ${fmtUsd(b.realizedPnl)}`}
                    />
                    <span className="text-[9px] text-gray-mid">{b.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* By vertical */}
        <div className={cn(TAB_CLASS, "lg:col-span-2")}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-mid">
            By market type
          </h2>
          {byVertical.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-mid">No trades yet.</p>
          ) : (
            <div className="space-y-3">
              {byVertical.map((v) => (
                <div key={v.vertical}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium capitalize text-navy">{v.vertical}</span>
                    <span className="text-gray-mid">
                      {v.tradeCount} trades ·{" "}
                      <span
                        className={cn(
                          "font-mono font-semibold",
                          v.realizedPnl >= 0 ? "text-green" : "text-red-brand"
                        )}
                      >
                        {v.realizedPnl >= 0 ? "+" : ""}
                        {fmtUsd(v.realizedPnl, { compact: true })}
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-cream-dark">
                    <div
                      className="h-full rounded-full bg-blue/70"
                      style={{ width: `${(v.buyVolume / maxVertical) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </TabsContent>
  );
}

function PnlCard({
  label,
  value,
  icon,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "pos" | "neg" | "neutral";
}) {
  return (
    <div className="rounded-xl border border-gray-warm bg-white p-3 shadow-card">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-mid">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-lg font-bold",
          tone === "pos" ? "text-green" : tone === "neg" ? "text-red-brand" : "text-navy"
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-gray-mid">{sub}</div>}
    </div>
  );
}

function fmtSigned(n: number): string {
  return `${n >= 0 ? "+" : ""}${fmtUsd(n)}`;
}

function toneOf(n: number): "pos" | "neg" | "neutral" {
  return n > 0 ? "pos" : n < 0 ? "neg" : "neutral";
}

function tSideLabel(side: string): string {
  return side === "yes" || side === "no" ? side.toUpperCase() : `\u201c${side}\u201d`;
}

/* ------------------------------------------------------------------ */
/* Positions (existing)                                                 */
/* ------------------------------------------------------------------ */

function PositionsTab({ className }: { className?: string }) {
  const markets = useSim((s) => s.markets);
  const positions = useSim((s) => s.positions);
  const user = useSim((s) => s.user);
  const sellBinary = useSim((s) => s.sellBinary);
  const claim = useSim((s) => s.claim);
  const claimable = useMemo(
    () => claimableAmounts(positions, markets),
    [positions, markets]
  );

  const [filter, setFilter] = useState<FilterStatus>("all");
  const [sort, setSort] = useState<SortKey>("pnl");
  const [sortOpen, setSortOpen] = useState(false);

  const rows = useMemo(
    () => computePositions(positions, markets, claimable),
    [positions, markets, claimable]
  );

  const filtered = useMemo(() => {
    let r = rows;
    if (filter !== "all") {
      r = r.filter((row) => row.market.status === filter);
    }
    return r.sort((a, b) => {
      if (sort === "pnl") return b.pnl - a.pnl;
      if (sort === "value") return b.marketValue - a.marketValue;
      return a.market.title.localeCompare(b.market.title);
    });
  }, [rows, filter, sort]);

  const totals = useMemo(() => {
    const active = rows.filter((r) => !r.isClaimable);
    const totalValue = active.reduce((s, r) => s + r.marketValue, 0);
    const totalCost = active.reduce((s, r) => s + r.costBasis, 0);
    const totalPnl = totalValue - totalCost;
    return {
      count: active.length,
      value: totalValue,
      cost: totalCost,
      pnl: totalPnl,
      pnlPct: totalCost > 0 ? (totalPnl / totalCost) * 100 : 0,
    };
  }, [rows]);

  const claimableTotal = Object.values(claimable).reduce((s, v) => s + v, 0);

  return (
    <TabsContent value="positions" className={className}>
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryCard
          label="Positions"
          value={totals.count.toString()}
          icon={<Filter className="h-3.5 w-3.5" />}
        />
        <SummaryCard
          label="Market Value"
          value={fmtUsd(totals.value)}
          icon={<Wallet className="h-3.5 w-3.5" />}
        />
        <SummaryCard
          label="Cost Basis"
          value={fmtUsd(totals.cost)}
          icon={<TrendingUp className="h-3.5 w-3.5" />}
        />
        <SummaryCard
          label="Unrealized P&L"
          value={
            <span className={cn(totals.pnl >= 0 ? "text-green" : "text-red-brand")}>
              {totals.pnl >= 0 ? "+" : ""}
              {fmtUsd(totals.pnl)}
            </span>
          }
          sub={
            totals.pnlPct !== 0 ? (
              <span
                className={cn(
                  "text-[10px] font-mono",
                  totals.pnl >= 0 ? "text-green" : "text-red-brand"
                )}
              >
                {totals.pnl >= 0 ? "+" : ""}
                {totals.pnlPct.toFixed(1)}%
              </span>
            ) : undefined
          }
          icon={
            totals.pnl >= 0 ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )
          }
        />
        <SummaryCard
          label="Free-play Balance"
          value={fmtUsd(user.balance)}
          accent="text-green"
          icon={<Trophy className="h-3.5 w-3.5" />}
        />
      </div>

      {/* Filters & Sort */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-gray-warm bg-white p-1">
          {(["all", "open", "resolving", "resolved"] as FilterStatus[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                filter === f
                  ? "bg-blue-light text-blue"
                  : "text-gray-mid hover:text-navy hover:bg-cream-dark"
              )}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="relative">
          <button
            onClick={() => setSortOpen(!sortOpen)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-warm bg-white px-3 py-1.5 text-xs font-medium text-navy transition-colors hover:border-blue/40"
          >
            Sort: {sort === "pnl" ? "P&L" : sort === "value" ? "Value" : "Name"}
          </button>
          {sortOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-lg border border-gray-warm bg-white shadow-dropdown">
              {([
                ["pnl", "P&L (best)"],
                ["value", "Value (highest)"],
                ["name", "Name (A-Z)"],
              ] as [SortKey, string][]).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => {
                    setSort(k);
                    setSortOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center px-3 py-2 text-left text-xs transition-colors",
                    sort === k
                      ? "bg-blue-light font-semibold text-blue"
                      : "text-navy hover:bg-cream-dark"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Claimable Winnings */}
      {claimableTotal > 0 && (
        <section>
          <h2 className="mb-2.5 text-sm font-semibold uppercase tracking-wider text-gray-mid">
            Claimable Winnings
          </h2>
          <div className="space-y-2">
            {Object.entries(claimable).map(([mid, amt]) => {
              const m = markets[mid];
              if (!m) return null;
              return (
                <div
                  key={mid}
                  className="flex items-center gap-4 rounded-xl border border-green/20 bg-green-light/50 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-navy">{m.title}</div>
                    <div className="text-xs text-gray-mid">
                      {m.event} · winner: {m.winningOutcome?.toUpperCase()}
                    </div>
                  </div>
                  <span className="font-mono text-lg font-bold text-green">{fmtUsd(amt)}</span>
                  <Button variant="yes" size="sm" onClick={() => claim(mid)}>
                    Claim
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Position List */}
      <section>
        <h2 className="mb-2.5 text-sm font-semibold uppercase tracking-wider text-gray-mid">
          All Positions
        </h2>
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-warm py-16 text-center">
            <p className="text-sm text-gray-mid">
              {rows.length === 0 ? "No positions yet." : "No positions match this filter."}
            </p>
            {rows.length === 0 && (
              <Button variant="outline" size="sm" asChild className="mt-3">
                <Link href="/">Browse markets</Link>
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((row) => (
              <PositionRowCard
                key={row.marketId}
                row={row}
                onSell={(side, shares) => sellBinary(row.marketId, side as "yes" | "no", shares)}
              />
            ))}
          </div>
        )}
      </section>
    </TabsContent>
  );
}

/* ------------------------------------------------------------------ */
/* History — trade ledger                                               */
/* ------------------------------------------------------------------ */

type HistFilter = "all" | "buy" | "sell" | "back" | "claim";

function HistoryTab({ className }: { className?: string }) {
  const trades = useSim((s) => s.trades);
  const markets = useSim((s) => s.markets);
  const [filter, setFilter] = useState<HistFilter>("all");

  const filtered = useMemo(() => {
    const list = [...trades].sort((a, b) => b.at - a.at);
    return filter === "all" ? list : list.filter((t) => t.kind === filter);
  }, [trades, filter]);

  const footer = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    let realized = 0;
    for (const t of filtered) {
      inflow += t.kind === "buy" || t.kind === "back" ? t.amount : 0;
      outflow += t.kind === "sell" || t.kind === "claim" ? t.amount : 0;
      realized += t.pnl || 0;
    }
    return { inflow, outflow, net: outflow - inflow, realized };
  }, [filtered]);

  const tradesCompacted = filtered.length !== trades.length;

  return (
    <TabsContent value="history" className={className}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-mid">
          {filtered.length} trade{filtered.length === 1 ? "" : "s"}
        </h2>
        <div className="flex gap-1 rounded-lg border border-gray-warm bg-white p-1">
          {(["all", "buy", "sell", "back", "claim"] as HistFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                filter === f
                  ? "bg-blue-light text-blue"
                  : "text-gray-mid hover:text-navy hover:bg-cream-dark"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-warm py-16 text-center">
          <p className="text-sm text-gray-mid">
            No trades yet — buy YES on a market and it&apos;ll appear here.
          </p>
          <Button variant="outline" size="sm" asChild className="mt-3">
            <Link href="/">Browse markets</Link>
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-warm bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-warm/70 bg-cream/60 text-[10px] uppercase tracking-wider text-gray-mid">
                  <th className="px-4 py-2.5 font-semibold">When</th>
                  <th className="px-4 py-2.5 font-semibold">Market</th>
                  <th className="px-4 py-2.5 font-semibold">Side</th>
                  <th className="px-4 py-2.5 font-semibold">Price</th>
                  <th className="px-4 py-2.5 font-semibold">Size</th>
                  <th className="px-4 py-2.5 font-semibold">P&L</th>
                  <th className="px-4 py-2.5 text-right font-semibold">On-chain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-warm/50">
                {filtered.map((t) => (
                  <HistoryRow key={t.id} t={t} slug={markets[t.marketId]?.slug} />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-warm/70 bg-cream/60 text-[11px]">
                  <td className="px-4 py-2.5" colSpan={4}>
                    <span className="font-semibold uppercase tracking-wider text-gray-mid">Cash flow</span>{" "}
                    <span className="text-gray-mid">
                      {tradesCompacted && `(filtered: ${filtered.length} of ${trades.length})`}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    <span className="text-red-brand">−{fmtUsd(footer.inflow)}</span>
                    <span className="text-gray-mid"> / </span>
                    <span className="text-green">+{fmtUsd(footer.outflow)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span
                      className={cn(
                        "font-mono font-bold",
                        footer.net >= 0 ? "text-green" : "text-red-brand"
                      )}
                    >
                      {fmtSigned(footer.net)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    <span className={cn("font-bold", footer.realized >= 0 ? "text-green" : "text-red-brand")}>
                      {footer.realized >= 0 ? "+" : ""}
                      {fmtUsd(footer.realized)}
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </TabsContent>
  );
}

function HistoryRow({ t, slug }: { t: TradeRecord; slug?: string }) {
  const isOut = t.kind === "buy" || t.kind === "back";
  const kindLabel = t.kind === "buy" ? "Buy" : t.kind === "sell" ? "Sell" : t.kind === "back" ? "Back" : "Claim";
  const kindColor =
    t.kind === "buy" || t.kind === "back"
      ? "bg-blue-light text-blue"
      : t.kind === "sell"
        ? "bg-amber-50 text-amber-700"
        : "bg-green-light text-green";

  return (
    <tr className="transition-colors hover:bg-cream/50">
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-mid">
        {fmtWhen(t.at)}
      </td>
      <td className="max-w-[260px] px-4 py-3">
        {slug ? (
          <Link
            href={`/market/${slug}`}
            className="flex items-center gap-1.5 truncate font-medium text-navy hover:text-blue"
          >
            <span className="truncate">{t.marketTitle}</span>
            <ArrowUpRight className="h-3 w-3 flex-none text-gray-cool" />
          </Link>
        ) : (
          <span className="truncate font-medium text-navy">{t.marketTitle}</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", kindColor)}>
          {kindLabel}
        </span>
        <span className="ml-1.5 font-mono text-xs text-navy">
          {t.kind === "back" || t.kind === "claim" ? `\u201c${t.side}\u201d` : t.side.toUpperCase()}
        </span>
      </td>
      <td className="px-4 py-3">
        {t.kind === "buy" ? (
          <div>
            <div className="font-mono text-xs text-navy">{(t.price * 100).toFixed(0)}¢</div>
            <div className="text-[10px] text-gray-mid">entry</div>
          </div>
        ) : t.kind === "sell" ? (
          <div>
            <div
              className={cn(
                "font-mono text-xs font-semibold",
                (t.avgEntry ?? 0) > 0 && t.price > (t.avgEntry ?? 0) ? "text-green" : t.price < (t.avgEntry ?? 0) ? "text-red-brand" : "text-navy"
              )}
            >
              {(t.price * 100).toFixed(0)}¢
            </div>
            {(t.avgEntry ?? 0) > 0 && (
              <div className="text-[10px] text-gray-mid">
                vs <span className="font-mono">{(t.avgEntry! * 100).toFixed(0)}¢</span>
              </div>
            )}
          </div>
        ) : t.kind === "back" ? (
          <div>
            <div className="font-mono text-xs text-navy">
              {t.price > 0 ? `${Math.max(1, Math.round(t.price * 100))}% pot` : "—"}
            </div>
            <div className="text-[10px] text-gray-mid">at back</div>
          </div>
        ) : (
          <span className="text-xs text-gray-mid">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="font-mono text-xs font-semibold text-navy">
          {t.kind === "buy" || t.kind === "sell" ? `${t.shares.toFixed(1)} sh` : ""}
        </div>
        <div className={cn("font-mono text-[11px]", isOut ? "text-red-brand" : "text-green")}>
          {isOut ? "−" : "+"}
          {fmtUsd(t.amount)}
        </div>
        {t.kind === "back" && t.price > 0 && (
          <div className="mt-0.5 font-mono text-[11px] font-semibold text-navy">
            → ≈ {fmtUsd(t.amount / t.price, { compact: true })} if it lands
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        {t.pnl !== 0 ? (
          <span className={cn("font-mono text-xs font-bold", t.pnl > 0 ? "text-green" : "text-red-brand")}>
            {t.pnl > 0 ? "+" : ""}
            {fmtUsd(t.pnl)}
          </span>
        ) : (
          <span className="font-mono text-xs text-gray-mid">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {t.txSig ? (
          <a
            href={`https://explorer.solana.com/tx/${t.txSig}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded bg-blue-light px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue transition-colors hover:bg-blue hover:text-white"
          >
            {shortAddr(t.txSig)}
          </a>
        ) : (
          <span className={cn("text-[10px] font-semibold uppercase", isOut ? "text-amber-600" : "text-gray-mid")}>
            Sim
          </span>
        )}
      </td>
    </tr>
  );
}

function fmtWhen(at: number): string {
  return new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------ */
/* Sub-components (shared)                                              */
/* ------------------------------------------------------------------ */

function SummaryCard({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-warm bg-white p-3.5 shadow-card">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-mid">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-lg font-bold text-navy",
          accent
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5">{sub}</div>}
    </div>
  );
}

function PositionRowCard({
  row,
  onSell,
}: {
  row: PositionRow;
  onSell: (side: "yes" | "no", shares: number) => void;
}) {
  const m = row.market;
  const status = STATUS_META[m.status];

  return (
    <Link
      href={`/market/${m.slug}`}
      className="group block rounded-xl border border-gray-warm bg-white p-4 shadow-card transition-all hover:border-blue/30 hover:shadow-md"
    >
      {/* Top row: status + title + time */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                status.className
              )}
            >
              {m.status === "open" && (
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green animate-pulse" />
              )}
              {status.label}
            </span>
            <span className="text-[11px] text-gray-mid">
              {m.vertical} · {m.type}
            </span>
          </div>
          <h3 className="truncate text-[15px] font-semibold text-navy group-hover:text-blue">
            {m.title}
          </h3>
          <p className="mt-0.5 truncate text-xs text-gray-mid">{m.event}</p>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-gray-mid">
          {m.status === "open" && row.timeLeft > 0 && (
            <>
              <Clock className="h-3 w-3" />
              <span className="font-mono">{fmtTimeLeft(row.timeLeft)}</span>
            </>
          )}
          <ArrowUpRight className="h-4 w-4 text-gray-cool opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>

      {/* Position details grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {/* Side */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-mid">Side</div>
          <div className="mt-0.5 font-mono text-sm font-semibold text-navy">{row.side}</div>
        </div>

        {/* Shares / Backed */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-mid">
            {m.type === "binary" ? "Shares" : "Backed"}
          </div>
          <div className="mt-0.5 font-mono text-sm font-semibold text-navy">
            {m.type === "binary"
              ? row.shares.toFixed(1)
              : row.wordBacks
                  ? Object.entries(row.wordBacks)
                      .map(([w, v]) => `${w} ${fmtUsd(v, { compact: true })}`)
                      .join(" · ")
                  : "—"}
          </div>
        </div>

        {/* Entry vs Current */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-mid">Entry → Now</div>
          <div className="mt-0.5 font-mono text-sm font-semibold text-navy">
            {m.type === "binary" ? (
              <>
                <span>{(row.avgEntry * 100).toFixed(0)}¢</span>
                <span className="text-gray-mid"> → </span>
                <span
                  className={cn(
                    row.currentPrice >= row.avgEntry ? "text-green" : "text-red-brand"
                  )}
                >
                  {(row.currentPrice * 100).toFixed(0)}¢
                </span>
              </>
            ) : (
              <span className="text-gray-mid">{(row.currentPrice * 100).toFixed(0)}% pot share</span>
            )}
          </div>
        </div>

        {/* P&L */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-mid">P&L</div>
          {m.type === "binary" ? (
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span
                className={cn(
                  "font-mono text-sm font-bold",
                  row.pnl >= 0 ? "text-green" : "text-red-brand"
                )}
              >
                {row.pnl >= 0 ? "+" : ""}
                {fmtUsd(row.pnl)}
              </span>
              <span
                className={cn(
                  "text-[10px] font-mono",
                  row.pnl >= 0 ? "text-green/70" : "text-red-brand/70"
                )}
              >
                {row.pnl >= 0 ? "+" : ""}
                {row.pnlPct.toFixed(1)}%
              </span>
            </div>
          ) : (
            <div className="mt-0.5 font-mono text-sm text-gray-mid">—</div>
          )}
        </div>
      </div>

      {/* Value + Actions */}
      <div className="mt-3 flex items-center justify-between border-t border-gray-warm/60 pt-3">
        <div className="flex items-baseline gap-3">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-gray-mid">Value</span>{" "}
            <span className="font-mono text-sm font-bold text-navy">{fmtUsd(row.marketValue)}</span>
          </div>
          {m.type === "binary" && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-gray-mid">Cost</span>{" "}
              <span className="font-mono text-sm text-gray-mid">{fmtUsd(row.costBasis)}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {row.isClaimable && (
            <span className="rounded-full bg-green/10 px-2 py-0.5 text-[10px] font-bold text-green">
              CLAIMABLE
            </span>
          )}
          {m.status === "open" && m.type === "binary" && row.shares > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSell(row.side === "YES" ? "yes" : "no", row.shares);
              }}
            >
              Sell {row.side}
            </Button>
          )}
        </div>
      </div>
    </Link>
  );
}