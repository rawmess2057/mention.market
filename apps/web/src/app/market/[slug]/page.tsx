"use client";

import { use } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, ExternalLink, ScrollText, Users, Volume2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PulseFeed } from "@/components/pulse-feed";
import { OrderBook } from "@/components/order-book";
import { TradePanel } from "@/components/trade-panel";
import { WordBoard } from "@/components/word-board";
import { PositionCard } from "@/components/position-card";
import { EvidenceSection } from "@/components/evidence-viewer";
import { ActivityFeed } from "@/components/activity-feed";
import { ClaimCard } from "@/components/claim-card";
import { TheWhisper } from "@/components/the-whisper";
import { fmtTimeLeft, fmtUsd } from "@/lib/format";
import { useSim, WATCH_WORDS } from "@/lib/sim";
import { useNow } from "@/hooks/useNow";
import { VERTICAL_META } from "@/lib/types";

const PriceChartWithTimeframe = dynamic(
  () =>
    import("@/components/price-chart").then((m) => m.PriceChartWithTimeframe),
  {
    ssr: false,
    loading: () => (
      <div className="shimmer h-[313px] rounded-2xl border border-gray-warm bg-white" />
    ),
  }
);

export default function MarketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const markets = useSim((s) => s.markets);
  const history = useSim((s) => s.history);
  const now = useNow(1000);
  const m = Object.values(markets).find((x) => x.slug === slug);

  if (!m) {
    return (
      <div className="py-20 text-center">
        <p className="text-gray-mid">Market not found.</p>
        <Button variant="outline" size="sm" asChild className="mt-4">
          <Link href="/">← Back to markets</Link>
        </Button>
      </div>
    );
  }

  const watch = WATCH_WORDS[m.slug] ?? [m.title.replace(/[^a-zA-Z ]/g, "").trim()];
  const marketHistory = history[m.id] ?? [];

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div>
          <Link
            href="/"
            className="mb-3 inline-flex items-center gap-1 text-xs text-gray-mid hover:text-navy transition-colors"
          >
            <ArrowLeft className="h-3 w-3" /> All markets
          </Link>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-mid">
                <span>{VERTICAL_META[m.vertical].emoji}</span>
                <span className="truncate">{m.event}</span>
                <a
                  href={m.sourceUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 inline-flex items-center gap-0.5 text-blue hover:underline"
                >
                  {m.source} <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
              <h1 className="font-serif text-xl font-bold tracking-tight text-navy md:text-2xl">{m.title}</h1>
            </div>
            <StatusBadge status={m.status} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="flex items-center gap-1.5 rounded-full border border-gray-warm bg-white px-2.5 py-1 text-gray-mid">
              <Volume2 className="h-3 w-3" /> Vol
              <span className="font-mono font-semibold text-navy">
                {fmtUsd(m.volume, { compact: true })}
              </span>
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-gray-warm bg-white px-2.5 py-1 text-gray-mid">
              <Users className="h-3 w-3" />{" "}
              <span className="font-mono font-semibold text-navy">
                {m.traders.toLocaleString()}
              </span>{" "}
              traders
            </span>
            <span
              suppressHydrationWarning
              className="flex items-center gap-1.5 rounded-full border border-blue/20 bg-blue-light px-2.5 py-1 font-mono font-semibold text-blue"
            >
              ⏱ {m.status === "open" ? fmtTimeLeft(m.endTime - now) : "—"}
            </span>
          </div>
        </div>

        {/* 3-Column Newsroom Grid */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[15%_55%_30%] lg:gap-5">
          {/* LEFT COLUMN: Pulse Feed */}
          <div className="hidden lg:block">
            <PulseFeed
              slug={m.slug}
              watchWords={watch}
              className="h-[600px] sticky top-20"
            />
          </div>

          {/* CENTER COLUMN: The Arena */}
          <div className="space-y-4">
            {/* Market Chart */}
            <div className="rounded-2xl border border-gray-warm bg-white shadow-card overflow-hidden">
              <div className="flex items-center gap-2 border-b border-gray-warm px-4 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-navy">
                  Price Chart
                </span>
                <span className="text-[10px] text-gray-mid">Probability over time</span>
              </div>
              <PriceChartWithTimeframe history={marketHistory} showBaseline={m.type === "binary"} />
            </div>

            {/* Trading Panel */}
            {m.type === "binary" ? <TradePanel market={m} /> : <WordBoard market={m} />}

            {/* Position & Claim */}
            <PositionCard market={m} />
            <ClaimCard market={m} />

            {/* Evidence */}
            <EvidenceSection market={m} />
          </div>

          {/* RIGHT COLUMN: Order Book */}
          <div className="space-y-4">
            <OrderBook market={m} />

            {/* Mobile: show transcript here on small screens */}
            <div className="lg:hidden">
              <Tabs defaultValue="transcript">
                <TabsList className="w-full">
                  <TabsTrigger value="transcript" className="flex-1">Transcript</TabsTrigger>
                  <TabsTrigger value="activity" className="flex-1">Activity</TabsTrigger>
                </TabsList>
                <TabsContent value="transcript">
                  <div className="rounded-xl border border-gray-warm bg-white p-4 text-sm text-gray-mid">
                    <PulseFeed slug={m.slug} watchWords={watch} className="h-[300px]" />
                  </div>
                </TabsContent>
                <TabsContent value="activity">
                  <ActivityFeed marketId={m.id} />
                </TabsContent>
              </Tabs>
            </div>

            {/* Desktop: Activity + Rules */}
            <div className="hidden lg:block">
              <Tabs defaultValue="activity">
                <TabsList className="w-full">
                  <TabsTrigger value="activity" className="flex-1">Activity</TabsTrigger>
                  <TabsTrigger value="rules" className="flex-1">Rules</TabsTrigger>
                </TabsList>
                <TabsContent value="activity">
                  <ActivityFeed marketId={m.id} />
                </TabsContent>
                <TabsContent value="rules">
                  <div className="rounded-xl border border-gray-warm bg-white p-4 text-sm leading-relaxed text-text-secondary">
                    <div className="mb-2 flex items-center gap-1.5 font-semibold text-navy">
                      <ScrollText className="h-3.5 w-3.5" /> Resolution rules
                    </div>
                    {m.rules}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      </div>

      {/* The Whisper — market detail only */}
      <TheWhisper />
    </>
  );
}
