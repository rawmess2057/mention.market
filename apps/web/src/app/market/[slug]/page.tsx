"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, ExternalLink, Share2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartSkeleton, PanelSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { PulseFeed } from "@/components/pulse-feed";
import { TradeTicket } from "@/components/trade-ticket";
import { RecentTrades } from "@/components/recent-trades";
import { TrustPanel } from "@/components/trust-panel";
import { WordBoard } from "@/components/word-board";
import { MarketHero } from "@/components/market-hero";
import { PositionCard } from "@/components/position-card";
import { ClaimCard } from "@/components/claim-card";
import { ResolutionPanel } from "@/components/resolution-panel";
import { ActivityFeed } from "@/components/activity-feed";
import { fmtAgo, fmtSol } from "@/lib/format";
import { useStore } from "@/lib/store";
import { watchWordsFor } from "@/lib/watch-words";
import { useNow } from "@/hooks/useNow";
import { useChainActivity } from "@/hooks/useChainActivity";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { lmsrProbYes } from "@/lib/lmsr";
import { isChainId } from "@/lib/chain";
import type { PriceSeries } from "@/lib/history";
import { VERTICAL_META } from "@/lib/types";

const PriceChartWithTimeframe = dynamic(
  () => import("@/components/price-chart").then((m) => m.PriceChartWithTimeframe),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

export default function MarketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const markets = useStore((s) => s.markets);
  const history = useStore((s) => s.history);
  const wordHistory = useStore((s) => s.wordHistory);
  const showToast = useStore((s) => s.showToast);
  const chainSynced = useStore((s) => s.chainSynced);
  const now = useNow(1000);
  const isDesktop = useIsDesktop();
  const m = Object.values(markets).find((x) => x.slug === slug);

  // One selection, two homes: the sticky desktop rail and the mobile sheet.
  const [railSide, setRailSide] = useState<"yes" | "no">("yes");
  const [railWord, setRailWord] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetSide, setSheetSide] = useState<"yes" | "no">("yes");
  const [sheetWord, setSheetWord] = useState<string | null>(null);

  // Word-race markets plot one line per option, in the market's own word order
  // (so colors stay stable as options are toggled/lines appear).
  const wordSeries = useMemo<PriceSeries[] | undefined>(() => {
    if (!m || m.type !== "majority" || !m.words) return undefined;
    const byWord = wordHistory[m.id] ?? {};
    return m.words
      .map((w) => ({ name: w.word, points: byWord[w.word] ?? [] }))
      .filter((s) => s.points.length > 0);
  }, [m, wordHistory]);

  useChainActivity(m);

  if (!m && !chainSynced) {
    // A direct link can land before the first chain read: show the page's
    // shape, not "not found".
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-2/3" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
          <div className="space-y-4">
            <PanelSkeleton rows={2} />
            <ChartSkeleton />
          </div>
          <PanelSkeleton rows={5} className="hidden lg:block" />
        </div>
      </div>
    );
  }

  if (!m) {
    return (
      <div className="py-20 text-center">
        <p className="text-fg-muted">Market not found.</p>
        <Button variant="outline" size="sm" asChild className="mt-4">
          <Link href="/">← Back to markets</Link>
        </Button>
      </div>
    );
  }

  const watch = watchWordsFor(m);
  const marketHistory = history[m.id] ?? [];
  const lastAt = marketHistory.length > 0 ? marketHistory[marketHistory.length - 1].t : 0;
  const chainYes =
    isChainId(m.id) && m.type === "binary"
      ? lmsrProbYes(m.yesShares, m.noShares, m.b)
      : null;
  const words = [...(m.words ?? [])].sort((a, b) => b.pool - a.pool);
  const leadWord = words[0]?.word ?? null;
  const trading = m.status === "open" && now < m.endTime;

  const openTrade = (opts: { side?: "yes" | "no"; word?: string }) => {
    if (opts.side) setRailSide(opts.side);
    if (opts.word) setRailWord(opts.word);
    if (isDesktop) return;
    setSheetSide(opts.side ?? railSide);
    setSheetWord(opts.word ?? railWord);
    setSheetOpen(true);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/market/${m.slug}`);
      showToast("Market link copied");
    } catch {
      showToast("Couldn't copy the link");
    }
  };

  return (
    <>
      <div className="space-y-4 pb-24 lg:pb-2">
        {/* Header */}
        <header>
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-micro text-fg-muted transition-colors hover:text-fg"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden /> All markets
          </Link>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-fg-muted">
                <span>
                  {VERTICAL_META[m.vertical].emoji} {VERTICAL_META[m.vertical].label}
                </span>
                <span aria-hidden>·</span>
                <span className="truncate">{m.event}</span>
                {m.sourceUrl && (
                  <a
                    href={m.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline"
                  >
                    {m.source} <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                  </a>
                )}
              </div>
              <h1 className="mt-1 text-2xl font-bold leading-tight tracking-tight text-fg md:text-3xl">
                {m.title}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={m.status} />
              <button
                type="button"
                onClick={copyLink}
                aria-label="Copy market link"
                className="rounded-field border border-line p-2 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <Share2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
          {/* Main column */}
          <div className="space-y-4">
            <MarketHero market={m} onTrade={openTrade} />

            {/* Mobile: once trading ends, the outcome and claim lead the page. */}
            {!trading && (
              <div className="space-y-4 lg:hidden">
                <ResolutionPanel market={m} />
                <ClaimCard market={m} />
              </div>
            )}

            <section className="panel overflow-hidden">
              <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                <span className="label-caps text-fg">
                  {m.type === "binary" ? "Probability" : "Word race odds"}
                </span>
                <span suppressHydrationWarning className="text-micro text-fg-muted">
                  {lastAt > 0 ? `updated ${fmtAgo(lastAt)}` : "waiting for the first print"}
                </span>
              </div>
              <PriceChartWithTimeframe
                history={marketHistory}
                series={wordSeries}
                showBaseline={m.type === "binary"}
              />
            </section>

            {m.type !== "binary" && (
              <WordBoard
                market={m}
                selected={railWord}
                onSelect={(word) => openTrade({ word })}
              />
            )}

            <Tabs defaultValue="transcript" className="space-y-3">
              <TabsList className="w-full justify-start rounded-tile bg-surface-2 p-1">
                <TabsTrigger value="transcript" className="flex-1 sm:flex-none">
                  Transcript
                </TabsTrigger>
                <TabsTrigger value="activity" className="flex-1 sm:flex-none">
                  Activity
                </TabsTrigger>
                <TabsTrigger value="rules" className="flex-1 sm:flex-none">
                  Rules
                </TabsTrigger>
              </TabsList>

              <TabsContent value="transcript">
                <PulseFeed market={m} watchWords={watch} />
              </TabsContent>

              <TabsContent value="activity">
                <ActivityFeed marketId={m.id} limit={20} />
              </TabsContent>

              <TabsContent value="rules">
                <TrustPanel market={m} />
              </TabsContent>
            </Tabs>

            {trading && <ResolutionPanel market={m} />}
            <PositionCard market={m} />
          </div>

          {/* Sticky trade rail */}
          <aside className="hidden lg:sticky lg:top-20 lg:block lg:self-start">
            <div className="space-y-4">
              {trading ? (
                <section className="panel p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="label-caps text-fg">Trade</span>
                    {chainYes !== null && (
                      <span className="tnum ml-auto inline-flex items-center gap-1.5 rounded-pill border border-yes-line bg-yes-soft px-2 py-0.5 text-micro font-semibold text-yes">
                        <span className="live-dot" aria-hidden />
                        {Math.round(chainYes * 100)}¢ live
                      </span>
                    )}
                  </div>
                  <TradeTicket
                    market={m}
                    side={railSide}
                    onSideChange={setRailSide}
                    word={railWord}
                    onWordChange={setRailWord}
                    showWordPicker={m.type === "binary"}
                  />
                </section>
              ) : (
                <>
                  <ResolutionPanel market={m} />
                  <ClaimCard market={m} />
                </>
              )}

              <TrustPanel market={m} />
              <RecentTrades marketId={m.id} limit={6} />
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile: one-thumb trade entry, replacing the bottom nav on this route. */}
      {trading && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
          {m.type === "binary" ? (
            <div className="flex gap-2">
              <Button
                variant="yes"
                size="lg"
                className="flex-1"
                onClick={() => openTrade({ side: "yes" })}
              >
                YES {Math.round(lmsrProbYes(m.yesShares, m.noShares, m.b) * 100)}¢
              </Button>
              <Button
                variant="no"
                size="lg"
                className="flex-1"
                onClick={() => openTrade({ side: "no" })}
              >
                NO {Math.round((1 - lmsrProbYes(m.yesShares, m.noShares, m.b)) * 100)}¢
              </Button>
            </div>
          ) : (
            <Button
              size="lg"
              className="w-full"
              onClick={() => openTrade({ word: railWord ?? leadWord ?? undefined })}
            >
              {railWord ? `Back “${railWord}”` : "Back a word"}
            </Button>
          )}
        </div>
      )}

      {/* Mobile trade sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          title={m.type === "binary" ? "Place a trade" : "Back a word"}
          description={`${m.title} · ${fmtSol(m.volume, { compact: true })} volume`}
        >
          <TradeTicket
            market={m}
            side={sheetSide}
            onSideChange={setSheetSide}
            word={sheetWord}
            onWordChange={setSheetWord}
            onFilled={() => setSheetOpen(false)}
          />
        </SheetContent>
      </Sheet>

    </>
  );
}
