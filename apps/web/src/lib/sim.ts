/**
 * Mock seed data + live simulation store.
 *
 * In production this is replaced by the indexer + WebSocket feed. For the demo
 * we simulate: live markets with ticking LMSR prices, a scrolling transcript
 * that highlights watched words, pari-mutuel pools filling up, and markets
 * moving through the resolution pipeline (evidence -> challenge window -> resolved).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { seededRandom, shortAddr } from "./format";
import type { PricePoint } from "./history";
import { lmsrBuyCost, lmsrProbYes, lmsrSellReturn } from "./lmsr";
import { realizedOnSell as realizedPnlOnSell } from "./pnl";
import { claimPayout } from "./settle";
import type {
  ActivityItem,
  LeaderboardRow,
  Market,
  Position,
  TradeRecord,
  TranscriptSnippet,
  User,
  WordPool,
} from "./types";

/* ------------------------------------------------------------------ */
/* Seed data                                                           */
/* ------------------------------------------------------------------ */

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;

export const WATCH_WORDS: Record<string, string[]> = {
  "sol-ai": ["AI", "Solana", "agent"],
  "x-grok": ["grok", "benchmark", "open source"],
  "fed-presser": ["cut", "inflation", "pause"],
  "nbafinals-g7": ["MVP", "foul", "three"],
  "streams-kai": ["chat", "subathon", "W"],
  "earnings-nvda": ["AI", "data center", "guidance"],
  "debate-mayor": ["housing", "budget", "safety"],
  "podcast-lex": ["consciousness", "sim", "love"],
  "kick-ice": ["ice", "donation", "goal"],
  "spaces-crypto": ["ETF", "halving", "bullish"],
};

const seedWords = (entries: Array<[string, number, number]>): WordPool[] =>
  entries.map(([word, pool, bettors]) => ({
    word,
    pool,
    bettors,
    lastBetAt: NOW - Math.floor(Math.random() * 5 * MIN),
  }));

export const SEED_MARKETS: Market[] = [
  {
    id: "m1",
    slug: "sol-ai",
    title: "Will they say \u201cAI\u201d?",
    event: "Solana Speedrun #12 — live dev stream",
    vertical: "streams",
    type: "binary",
    status: "open",
    createdAt: NOW - 3 * HOUR,
    endTime: NOW + 42 * MIN,
    volume: 18_420,
    traders: 312,
    yesShares: 640,
    noShares: 410,
    b: 300,
    rules:
      "Resolves YES if the exact word \u201cAI\u201d (case-insensitive, standalone) is spoken by the host during the live segment. Track: twitch.tv/solspeedrun. Transcript from Deepgram primary feed.",
    creator: "mention",
    creatorFeeBps: 100,
    source: "twitch.tv/solspeedrun",
    sourceUrl: "https://twitch.tv/solspeedrun",
  },
  {
    id: "m2",
    slug: "x-grok",
    title: "First word said: race",
    event: "xAI Grok 5 launch livestream",
    vertical: "streams",
    type: "majority",
    status: "open",
    createdAt: NOW - 6 * HOUR,
    endTime: NOW + 2 * HOUR,
    volume: 44_100,
    traders: 891,
    yesShares: 0,
    noShares: 0,
    b: 0,
    words: seedWords([
      ["agents", 5_200, 214],
      ["open source", 4_150, 168],
      ["benchmark", 3_980, 190],
      ["Grok", 2_640, 132],
      ["safety", 1_210, 63],
      [" Elon ", 980, 54],
      ["physics", 640, 31],
      ["nothingburger", 310, 12],
    ]),
    rules:
      "Pot is split among backers of the first word/phrase (from the board) spoken by the presenter. Case-insensitive. First occurrence per Deepgram feed wins. 1% rake.",
    creator: "mention",
    creatorFeeBps: 100,
    source: "x.com/xai",
    sourceUrl: "https://x.com/xai",
  },
  {
    id: "m3",
    slug: "fed-presser",
    title: "Will Powell say \u201cpause\u201d?",
    event: "FOMC press conference",
    vertical: "earnings",
    type: "binary",
    status: "open",
    createdAt: NOW - 2 * HOUR,
    endTime: NOW + 8 * MIN,
    volume: 96_800,
    traders: 2_041,
    yesShares: 1_180,
    noShares: 960,
    b: 500,
    rules:
      "Resolves YES if \u201cpause\u201d appears in the official presser transcript (Federal Reserve feed, primary source). Derivative forms (\u201cpaused\u201d, \u201cpausing\u201d) do NOT count.",
    creator: "mention",
    creatorFeeBps: 100,
    source: "federalreserve.gov",
    sourceUrl: "https://federalreserve.gov",
  },
  {
    id: "m4",
    slug: "nbafinals-g7",
    title: "Word race: post-game interview",
    event: "NBA Finals G7 — courtside mic",
    vertical: "sports",
    type: "majority",
    status: "open",
    createdAt: NOW - 1 * HOUR,
    endTime: NOW + 25 * MIN,
    volume: 61_350,
    traders: 1_450,
    yesShares: 0,
    noShares: 0,
    b: 0,
    words: seedWords([
      ["credit the team", 8_900, 402],
      ["we fought", 6_720, 318],
      ["MVP", 5_410, 261],
      ["God bless", 4_180, 202],
      ["next season", 2_050, 98],
    ]),
    rules:
      "First phrase from the board said during the post-game court interview wins. Broadcast audio only. 1% rake.",
    creator: "mention",
    creatorFeeBps: 100,
    source: "nba.com/broadcast",
    sourceUrl: "https://nba.com",
  },
  {
    id: "m5",
    slug: "streams-kai",
    title: "Will he say \u201cW in the chat\u201d?",
    event: "Kai Cenat — subathon stream",
    vertical: "streams",
    type: "binary",
    status: "open",
    createdAt: NOW - 30 * MIN,
    endTime: NOW + 90 * MIN,
    volume: 12_930,
    traders: 744,
    yesShares: 210,
    noShares: 260,
    b: 150,
    rules:
      "Resolves YES if the phrase \u201cW in the chat\u201d is spoken by the streamer. Chat messages don\u2019t count. Twitch VOD audio is the source of truth.",
    creator: "mention",
    creatorFeeBps: 100,
    source: "twitch.tv/kaicenat",
    sourceUrl: "https://twitch.tv/kaicenat",
  },
  {
    id: "m6",
    slug: "earnings-nvda",
    title: "Earnings call buzzword race",
    event: "NVDA Q4 earnings call",
    vertical: "earnings",
    type: "majority",
    status: "open",
    createdAt: NOW - 4 * HOUR,
    endTime: NOW + 3 * HOUR,
    volume: 88_240,
    traders: 1_977,
    yesShares: 0,
    noShares: 0,
    b: 0,
    words: seedWords([
      ["data center", 11_200, 388],
      ["AI demand", 9_640, 341],
      ["guidance", 7_310, 276],
      ["supply", 4_920, 188],
      ["sovereign AI", 3_150, 121],
    ]),
    rules:
      "First phrase from the board said by management during prepared remarks or Q&A wins. Official earnings transcript is the source. 1% rake.",
    creator: "mention",
    creatorFeeBps: 100,
    source: "nvidia.com/ir",
    sourceUrl: "https://nvidia.com/ir",
  },
  {
    id: "m7",
    slug: "debate-mayor",
    title: "Will the mayor say \u201chousing\u201d first minute?",
    event: "NYC mayoral debate",
    vertical: "politics",
    type: "binary",
    status: "locked",
    createdAt: NOW - 2 * HOUR,
    endTime: NOW - 1 * MIN,
    volume: 51_600,
    traders: 1_204,
    yesShares: 1_520,
    noShares: 1_010,
    b: 400,
    rules:
      "Resolves YES if \u201chousing\u201d is spoken in the first minute of the debate by any candidate. Official broadcast transcript.",
    creator: "mention",
    creatorFeeBps: 100,
    source: "nyc.gov/tv",
    sourceUrl: "https://nyc.gov",
  },
  {
    id: "m8",
    slug: "podcast-lex",
    title: "Will Lex say \u201csimulation\u201d?",
    event: "Lex Fridman #412 — guest TBA",
    vertical: "podcasts",
    type: "binary",
    status: "resolved",
    createdAt: NOW - 2 * 24 * HOUR,
    endTime: NOW - 20 * HOUR,
    resolvedAt: NOW - 19 * HOUR,
    volume: 33_470,
    traders: 918,
    yesShares: 980,
    noShares: 620,
    b: 250,
    rules:
      "Resolves YES if \u201csimulation\u201d (any form: simulate, simulated) is spoken by Lex during the episode. Podcast audio, Deepgram feed.",
    creator: "mention",
    creatorFeeBps: 100,
    source: "lexfridman.com",
    sourceUrl: "https://lexfridman.com",
    winningOutcome: "yes",
    confidence: 98,
    evidence: {
      winningOutcome: "yes",
      confidence: 98,
      proposedAt: NOW - 19 * HOUR + 4 * MIN,
      proposedBy: "mention-resolver-01",
      evidenceHash: "9f2c…a41d",
      bondUsd: 50,
      challengeWindowMs: 20 * MIN,
      challengeDeadline: NOW - 19 * HOUR + 24 * MIN,
      challenged: false,
      snippets: [
        {
          t: 1_284_000,
          speaker: "Lex Fridman",
          text: "…if we are living in a simulation, then the physics we observe is just the renderer…",
        },
        {
          t: 2_410_000,
          speaker: "Lex Fridman",
          text: "…I keep coming back to the simulation hypothesis, it\u2019s a beautiful question…",
        },
      ],
    },
  },
  {
    id: "m9",
    slug: "kick-ice",
    title: "Will she break the ice bath record live?",
    event: "Kick — ice bath challenge stream",
    vertical: "streams",
    type: "binary",
    status: "resolved",
    createdAt: NOW - 3 * 24 * HOUR,
    endTime: NOW - 40 * HOUR,
    resolvedAt: NOW - 40 * HOUR + 9 * MIN,
    volume: 21_050,
    traders: 655,
    yesShares: 410,
    noShares: 890,
    b: 200,
    rules:
      "Resolves YES if the stated record time is beaten on the live timer shown on stream. Overlay timer + mod confirmation.",
    creator: "mention",
    creatorFeeBps: 100,
    source: "kick.com/icequeen",
    sourceUrl: "https://kick.com",
    winningOutcome: "no",
    confidence: 96,
    evidence: {
      winningOutcome: "no",
      confidence: 96,
      proposedAt: NOW - 40 * HOUR + 9 * MIN,
      proposedBy: "mention-resolver-02",
      evidenceHash: "c77e…19b0",
      bondUsd: 50,
      challengeWindowMs: 20 * MIN,
      challengeDeadline: NOW - 40 * HOUR + 29 * MIN,
      challenged: false,
      snippets: [
        {
          t: 5_512_000,
          speaker: "Host timer overlay",
          text: "Final time 12:41 — record 11:58. Record not broken.",
        },
      ],
    },
  },
  {
    id: "m10",
    slug: "spaces-crypto",
    title: "Will \u201cETF\u201d be said 10+ times?",
    event: "X Spaces — crypto policy roundtable",
    vertical: "politics",
    type: "binary",
    status: "resolving",
    createdAt: NOW - 5 * HOUR,
    endTime: NOW - 4 * MIN,
    volume: 27_300,
    traders: 832,
    yesShares: 700,
    noShares: 690,
    b: 250,
    rules:
      "Resolves YES if \u201cETF\u201d is spoken at least 10 times during the Space. Official X Spaces audio via Deepgram feed.",
    creator: "mention",
    creatorFeeBps: 100,
    source: "x.com/spaces",
    sourceUrl: "https://x.com",
  },
];

export const SEED_ACTIVITY: ActivityItem[] = [
  { id: "a1", marketId: "m1", kind: "buy", side: "yes", amount: 50, user: "degen_dm", at: NOW - 1 * MIN },
  { id: "a2", marketId: "m1", kind: "buy", side: "no", amount: 25, user: "quant_queen", at: NOW - 2 * MIN },
  { id: "a3", marketId: "m2", kind: "back", side: "agents", amount: 200, user: "whale_wallet", at: NOW - 3 * MIN },
  { id: "a4", marketId: "m3", kind: "buy", side: "yes", amount: 120, user: "macro_mike", at: NOW - 4 * MIN },
  { id: "a5", marketId: "m8", kind: "resolve", side: "yes", amount: 33_470, user: "resolver", at: NOW - 19 * HOUR },
  { id: "a6", marketId: "m4", kind: "back", side: "MVP", amount: 75, user: "hoops_henry", at: NOW - 5 * MIN },
  { id: "a7", marketId: "m5", kind: "buy", side: "no", amount: 40, user: "stream_sniper", at: NOW - 6 * MIN },
  { id: "a8", marketId: "m6", kind: "back", side: "data center", amount: 300, user: "ai_alpha", at: NOW - 7 * MIN },
];

export const LEADERBOARD: LeaderboardRow[] = [
  { rank: 1, handle: "whale_wallet", avatarSeed: "ww", points: 8_420, profit: 3_120, winRate: 0.68, trades: 214 },
  { rank: 2, handle: "quant_queen", avatarSeed: "qq", points: 7_910, profit: 2_450, winRate: 0.71, trades: 189 },
  { rank: 3, handle: "degen_dm", avatarSeed: "dd", points: 6_380, profit: 1_980, winRate: 0.59, trades: 341 },
  { rank: 4, handle: "ai_alpha", avatarSeed: "aa", points: 5_970, profit: 1_640, winRate: 0.62, trades: 156 },
  { rank: 5, handle: "macro_mike", avatarSeed: "mm", points: 5_420, profit: 1_210, winRate: 0.57, trades: 132 },
  { rank: 6, handle: "hoops_henry", avatarSeed: "hh", points: 4_880, profit: 990, winRate: 0.55, trades: 121 },
  { rank: 7, handle: "stream_sniper", avatarSeed: "ss", points: 4_310, profit: 870, winRate: 0.53, trades: 98 },
];

export const CURRENT_USER: User = {
  handle: "",
  points: 0,
  rank: 0,
  balance: 0,
  balanceKind: "usdc",
};

/** A few transcript lines already in the buffer for live markets. */
export const SEED_TRANSCRIPT: Record<string, TranscriptSnippet[]> = {
  "sol-ai": [
    { t: 1_002_000, speaker: "host", text: "…and then we wire up the program client, super straightforward…" },
    { t: 1_048_000, speaker: "host", text: "…the anchor macros generate all the plumbing for you…" },
    { t: 1_121_000, speaker: "host", text: "…next we deploy to devnet and run the test suite…" },
  ],
  "fed-presser": [
    { t: 3_410_000, speaker: "Powell", text: "…the committee remains attentive to the risks on both sides…" },
    { t: 3_452_000, speaker: "Powell", text: "…we will evaluate incoming data carefully before adjusting stance…" },
  ],
  "streams-kai": [
    { t: 7_640_000, speaker: "Kai", text: "…yo chat we are SO back, look at this donation…" },
  ],
};

/* ------------------------------------------------------------------ */
/* Simulation store                                                    */
/* ------------------------------------------------------------------ */

export interface ConfirmTrade {
  marketId: string;
  side: string; // "yes" | "no" | word
  shares?: number;
  amount: number;
}

/** The per-wallet "book": everything the wallet owns or has done. */
export interface WalletBook {
  user: User;
  positions: Record<string, Position>;
  trades: TradeRecord[];
}

function freshBook(wallet: string): WalletBook {
  return {
    user: {
      handle: shortAddr(wallet),
      points: 0,
      rank: 0,
      balance: 0,
      wallet,
      balanceKind: "usdc",
    },
    positions: {},
    trades: [],
  };
}

function emptyBook(): WalletBook {
  return { user: { ...CURRENT_USER }, positions: {}, trades: [] };
}

function projectBook(books: Record<string, WalletBook>, wallet: string | null): WalletBook {
  return (wallet && books[wallet]) || emptyBook();
}

interface SimState {
  markets: Record<string, Market>;
  positions: Record<string, Position>;
  activity: ActivityItem[];
  transcript: Record<string, TranscriptSnippet[]>;
  history: Record<string, PricePoint[]>; // timestamped sparkline/chart data per market
  user: User;
  trades: TradeRecord[];
  books: Record<string, WalletBook>;
  activeWallet: string | null;
  pendingTrade: ConfirmTrade | null;
  toast: string | null;

  // actions
  setWallet: (wallet: string | null) => void;
  setBalance: (wallet: string, balance: number, kind: "usdc" | "sol") => void;
  buyBinary: (marketId: string, side: "yes" | "no", amount: number, txSig?: string) => void;
  sellBinary: (marketId: string, side: "yes" | "no", shares: number) => void;
  backWord: (marketId: string, word: string, amount: number, txSig?: string) => void;
  claim: (marketId: string) => void;
  challenge: (marketId: string) => void;
  createMarket: (m: {
    title: string;
    event: string;
    vertical: Market["vertical"];
    type: Market["type"];
    words: string[];
    minutes: number;
    rules: string;
  }) => string;
  setPendingTrade: (t: ConfirmTrade | null) => void;
  showToast: (msg: string | null) => void;
  tick: () => void;
}

const FIRST = ["degen", "quant", "macro", "ai", "crypto", "stream", "hoops", "bag", "moon", "floor"];
const LAST = ["dm", "queen", "mike", "alpha", "kid", "sniper", "henry", "wolf", "rider", "trader"];

function randomUser(rnd: () => number) {
  return `${FIRST[Math.floor(rnd() * FIRST.length)]}_${LAST[Math.floor(rnd() * LAST.length)]}`;
}

let simTimer: ReturnType<typeof setInterval> | null = null;

/** Durable slice persisted to localStorage. Volatile state (seeded markets
 *  relative to page-load, history, transcript, toasts) is NOT persisted:
 *  seed markets re-seed fresh each load, the wallet book and anything the
 *  user created survive refresh. */
interface PersistedState {
  books: Record<string, WalletBook>;
  activeWallet: string | null;
  activity: ActivityItem[];
  customMarkets: Record<string, Market>;
}

const SEED_IDS = new Set(SEED_MARKETS.map((m) => m.id));

export const useSim = create<SimState>()(persist((set, get) => {
  const markets: Record<string, Market> = {};
  for (const m of SEED_MARKETS) markets[m.id] = structuredClone(m);

  const positions: Record<string, Position> = {};
  const trades: TradeRecord[] = [];

  const transcript: Record<string, TranscriptSnippet[]> = {};
  for (const [k, v] of Object.entries(SEED_TRANSCRIPT)) transcript[k] = structuredClone(v);

  // Seed plausible price walks so sparklines are never empty
  const history: Record<string, PricePoint[]> = {};
  for (const m of Object.values(markets)) {
    const target =
      m.type === "binary" ? lmsrProbYes(m.yesShares, m.noShares, m.b) : leaderShare(m);
    history[m.id] = seededWalkTimed(
      target,
      48,
      (m.id.charCodeAt(1) + 3) * 7919,
      Date.now(),
      5_000
    );
  }

  return {
    markets,
    positions,
    activity: [...SEED_ACTIVITY],
    history,
    transcript,
    user: { ...CURRENT_USER },
    trades,
    books: {},
    activeWallet: null,
    pendingTrade: null,
    toast: null,

    setWallet: (wallet) =>
      set((s) => {
        const books = wallet
          ? s.books[wallet]
            ? s.books
            : { ...s.books, [wallet]: freshBook(wallet) }
          : s.books;
        const activeWallet = wallet;
        const book = projectBook(books, activeWallet);
        return {
          books,
          activeWallet,
          positions: book.positions,
          trades: book.trades,
          user: book.user,
        };
      }),

    setBalance: (wallet, balance, kind) =>
      set((s) => {
        const book = s.books[wallet];
        if (!book) return {};
        const user = { ...book.user, balance, balanceKind: kind };
        const books = { ...s.books, [wallet]: { ...book, user } };
        const active = s.activeWallet === wallet;
        return { books, ...(active ? { user } : {}) };
      }),

    buyBinary: (marketId, side, amount, txSig) => {
      const wallet = get().activeWallet;
      if (!wallet) return;
      const m = get().markets[marketId];
      if (!m || m.status !== "open") return;
      const cost = amount; // LMSR: buy by cost, derive shares
      const shares = lmsrSharesForCost(m, side, cost);
      if (shares <= 0) return;

      const trade: TradeRecord = {
        id: `t-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        marketId,
        marketTitle: m.title,
        kind: "buy",
        side,
        amount: cost,
        shares,
        price: cost / shares,
        avgEntry: cost / shares,
        pnl: 0,
        at: Date.now(),
        txSig,
      };

      set((s) => {
        const mm = structuredClone(s.markets[marketId]);
        if (side === "yes") {
          mm.yesShares += shares;
        } else {
          mm.noShares += shares;
        }
        mm.volume += cost;
        mm.traders += 1;
        const markets = { ...s.markets, [marketId]: mm };

        const positions = { ...s.positions };
        const p: Position = positions[marketId]
          ? structuredClone(positions[marketId])
          : { id: `p-${marketId}`, marketId };
        if (side === "yes") {
          const prevCost = (p.avgYesPrice ?? 0) * (p.yesShares ?? 0);
          const newShares = (p.yesShares ?? 0) + shares;
          p.avgYesPrice = (prevCost + cost) / newShares;
          p.yesShares = newShares;
        } else {
          const prevCost = (p.avgNoPrice ?? 0) * (p.noShares ?? 0);
          const newShares = (p.noShares ?? 0) + shares;
          p.avgNoPrice = (prevCost + cost) / newShares;
          p.noShares = newShares;
        }
        positions[marketId] = p;

        const user = { ...s.user, balance: Math.max(0, s.user.balance - cost) };
        const trades = [trade, ...s.trades].slice(0, 500);
        const book = { user, positions, trades };
        return { markets, positions, user, trades, books: { ...s.books, [wallet]: book } };
      });

      get().showToast(`Bought ${side.toUpperCase()} · ${fmtShares(shares)} shares`);
    },

    sellBinary: (marketId, side, shares) => {
      const wallet = get().activeWallet;
      if (!wallet) return;
      const s = get();
      const m = s.markets[marketId];
      const p = s.positions[marketId];
      if (!m || !p || m.status !== "open") return;
      const held = side === "yes" ? (p.yesShares ?? 0) : (p.noShares ?? 0);
      const sell = Math.min(shares, held);
      if (sell <= 0) return;

      const proceeds = lmsrSellValue(m, side, sell);
      const avgEntry = side === "yes" ? (p.avgYesPrice ?? 0) : (p.avgNoPrice ?? 0);
      const entryPrice = avgEntry > 0 ? avgEntry : proceeds / sell;
      const trade: TradeRecord = {
        id: `t-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        marketId,
        marketTitle: m.title,
        kind: "sell",
        side,
        amount: proceeds,
        shares: sell,
        price: proceeds / sell,
        avgEntry: entryPrice,
        pnl: realizedPnlOnSell(entryPrice, sell, proceeds),
        at: Date.now(),
      };
      set((st) => {
        const markets = { ...st.markets };
        const mm = structuredClone(markets[marketId]);
        if (side === "yes") {
          mm.yesShares = Math.max(0, mm.yesShares - sell);
        } else {
          mm.noShares = Math.max(0, mm.noShares - sell);
        }
        markets[marketId] = mm;

        const positions = { ...st.positions };
        const pp = structuredClone(positions[marketId]);
        if (side === "yes") {
          pp.yesShares = (pp.yesShares ?? 0) - sell;
        } else {
          pp.noShares = (pp.noShares ?? 0) - sell;
        }
        positions[marketId] = pp;

        const user = { ...st.user, balance: st.user.balance + proceeds };
        const trades = [trade, ...st.trades].slice(0, 500);
        const book = { user, positions, trades };
        return { markets, positions, user, trades, books: { ...st.books, [wallet]: book } };
      });

      get().showToast(`Sold ${side.toUpperCase()} · +${fmtShares(proceeds)} USDC`);
    },

    backWord: (marketId, word, amount, txSig) => {
      const wallet = get().activeWallet;
      if (!wallet) return;
      const m = get().markets[marketId];
      if (!m || m.status !== "open" || !m.words) return;

      const w0 = m.words.find((x) => x.word === word);
      const pot = m.words.reduce((s, x) => s + x.pool, 0);
      const wPool = w0?.pool ?? 0;
      const impliedShare = pot + amount > 0 ? wPool / (pot + amount) : 0;

      const trade: TradeRecord = {
        id: `t-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        marketId,
        marketTitle: m.title,
        kind: "back",
        side: word,
        amount,
        shares: 0,
        price: impliedShare,
        pnl: 0,
        at: Date.now(),
        txSig,
      };
      set((s) => {
        const markets = { ...s.markets };
        const mm = structuredClone(markets[marketId]);
        const w = mm.words!.find((x) => x.word === word);
        if (!w) return {};
        w.pool += amount;
        w.bettors += 1;
        w.lastBetAt = Date.now();
        mm.volume += amount;
        markets[marketId] = mm;

        const positions = { ...s.positions };
        const p: Position = positions[marketId]
          ? structuredClone(positions[marketId])
          : { id: `p-${marketId}`, marketId };
        p.wordBacks = { ...(p.wordBacks ?? {}) };
        p.wordBacks[word] = (p.wordBacks[word] ?? 0) + amount;
        positions[marketId] = p;

        const user = { ...s.user, balance: Math.max(0, s.user.balance - amount) };
        const trades = [trade, ...s.trades].slice(0, 500);
        const book = { user, positions, trades };
        return { markets, positions, user, trades, books: { ...s.books, [wallet]: book } };
      });

      get().showToast(`Backed \u201c${word}\u201d · ${fmtShares(amount)} USDC`);
    },

    claim: (marketId) => {
      const wallet = get().activeWallet;
      if (!wallet) return;
      const s = get();
      const m = s.markets[marketId];
      const pos = s.positions[marketId];
      if (!m || !pos || pos.claimed) return;
      const q = claimPayout(m, pos);
      if (!q || q.payout <= 0) return;
      const trade: TradeRecord = {
        id: `t-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        marketId,
        marketTitle: m.title,
        kind: "claim",
        side: q.side,
        amount: q.payout,
        shares: 0,
        price: 0,
        pnl: q.payout - q.cost,
        at: Date.now(),
      };
      set((st) => {
        const positions = { ...st.positions };
        const p = positions[marketId];
        if (p) positions[marketId] = { ...p, claimed: true, payout: q.payout };
        const user = {
          ...st.user,
          balance: st.user.balance + q.payout,
          points: st.user.points + 25,
        };
        const trades = [trade, ...st.trades].slice(0, 500);
        const book = { user, positions, trades };
        return { positions, user, trades, books: { ...st.books, [wallet]: book } };
      });
      get().showToast(`Claimed ${fmtShares(q.payout)} USDC 🎉`);
    },

    challenge: (marketId) => {
      set((s) => {
        const markets = { ...s.markets };
        const mm = structuredClone(markets[marketId]);
        if (!mm.evidence) return {};
        mm.evidence.challenged = true;
        markets[marketId] = mm;
        return { markets };
      });
      get().showToast("Challenge submitted — resolver review started");
    },

    createMarket: ({ title, event, vertical, type, words, minutes, rules }) => {
      const id = `m${Date.now()}`;
      const slug = `custom-${id}`;
      const now = Date.now();
      const market: Market = {
        id,
        slug,
        title: type === "binary" ? title : "Word race: live",
        event,
        vertical,
        type,
        status: "open",
        createdAt: now,
        endTime: now + minutes * MIN,
        volume: 0,
        traders: 0,
        yesShares: 100,
        noShares: 100,
        b: Math.max(50, minutes * 2),
        words:
          type === "majority"
            ? words.map((w) => ({ word: w, pool: 0, bettors: 0, lastBetAt: 0 }))
            : undefined,
        rules,
        creator: "you",
        creatorFeeBps: 100,
        source: "custom event",
        sourceUrl: "",
      };
      set((s) => ({ markets: { ...s.markets, [id]: market } }));
      get().showToast("Market created — live now!");
      return id;
    },

    setPendingTrade: (t) => set({ pendingTrade: t }),
    showToast: (msg) => set({ toast: msg }),

    tick: () => {
      const rnd = seededRandom(Math.floor(Date.now() / 1000));
      set((s) => {
        const markets = { ...s.markets };
        const newActivity: ActivityItem[] = [];
        const newTranscript: Record<string, TranscriptSnippet[]> = { ...s.transcript };
        const newHistory: Record<string, PricePoint[]> = { ...s.history };

        for (const m of Object.values(markets)) {
          if (m.status === "open" && Date.now() >= m.endTime) {
            // Locked: propose a deterministic outcome and open the challenge window.
            const mm = structuredClone(m);
            mm.status = "resolving";
            proposeResolution(mm, newTranscript[mm.slug] ?? []);
            markets[m.id] = mm;
            newActivity.push({
              id: `r-${m.id}-${Date.now()}`,
              marketId: m.id,
              kind: "resolve",
              amount: mm.volume,
              user: "resolver",
              at: Date.now(),
            });
            continue;
          }
          if (m.status === "resolving") {
            const mm = structuredClone(m);
            // A resolving market with no proposal (seeded/legacy) gets one now.
            if (!mm.evidence) {
              proposeResolution(mm, newTranscript[mm.slug] ?? []);
              markets[m.id] = mm;
              continue;
            }
            // Finalize after the window; a dispute resets the proposal instead.
            if (Date.now() >= mm.evidence.challengeDeadline) {
              if (mm.evidence.challenged) {
                proposeResolution(mm, newTranscript[mm.slug] ?? []);
              } else {
                mm.status = "resolved";
                mm.winningOutcome = mm.evidence.winningOutcome;
                mm.resolvedAt = Date.now();
              }
              markets[m.id] = mm;
            }
            continue;
          }
          if (m.status !== "open") continue;

          // --- live market simulation ---
          const mm = structuredClone(m);

          if (mm.type === "binary") {
            // Random bot trades move the LMSR price
            const r = rnd();
            if (r < 0.35) {
              const side = rnd() < 0.5 + 0.15 * Math.sign(Math.sin(mm.id.length)) ? "yes" : "no";
              const amount = Math.round(5 + rnd() * 90);
              const shares = lmsrSharesForCost(mm, side, amount);
              if (side === "yes") mm.yesShares += shares;
              else mm.noShares += shares;
              mm.volume += amount;
              newActivity.push({
                id: `a-${Date.now()}-${Math.floor(rnd() * 1e6)}`,
                marketId: mm.id,
                kind: "buy",
                side,
                amount,
                user: randomUser(rnd),
                at: Date.now(),
              });
            }
            newHistory[m.id] = [
              ...(newHistory[m.id] ?? []),
              { t: Date.now(), v: lmsrProbYes(mm.yesShares, mm.noShares, mm.b) },
            ].slice(-120);
            markets[m.id] = mm;
          } else if (mm.type === "majority" && mm.words) {
            const r = rnd();
            if (r < 0.5 && mm.words.length > 0) {
              // Weighted toward words with existing momentum
              const idx = Math.floor(rnd() * mm.words.length);
              const w = mm.words[idx];
              const amount = Math.round(10 + rnd() * 150);
              w.pool += amount;
              w.bettors += 1;
              w.lastBetAt = Date.now();
              mm.volume += amount;
              newActivity.push({
                id: `a-${Date.now()}-${Math.floor(rnd() * 1e6)}`,
                marketId: mm.id,
                kind: "back",
                side: w.word,
                amount,
                user: randomUser(rnd),
                at: Date.now(),
              });
            }
            newHistory[m.id] = [
              ...(newHistory[m.id] ?? []),
              { t: Date.now(), v: leaderShare(mm) },
            ].slice(-120);
            markets[m.id] = mm;
          }

          // Transcript lines for live markets
          const lines = newTranscript[m.slug] ?? [];
          if (rnd() < 0.22) {
            const t0 = lines.length > 0 ? lines[lines.length - 1].t : Date.now() % 3_600_000;
            newTranscript[m.slug] = [
              ...lines.slice(-30),
              {
                t: t0 + 8_000 + Math.floor(rnd() * 20_000),
                speaker: "host",
                text: randomLine(rnd, mm),
              },
            ];
          }
        }

        return {
          markets,
          activity: [...newActivity, ...s.activity].slice(0, 60),
          transcript: newTranscript,
          history: newHistory,
        };
      });
    },
  };
}, {
  name: "mention-market-sim-v2",
  version: 1,
  partialize: (s) => ({
    books: s.books,
    activeWallet: s.activeWallet,
    activity: s.activity.slice(0, 200),
    customMarkets: Object.fromEntries(
      Object.entries(s.markets).filter(([id]) => !SEED_IDS.has(id))
    ),
  }),
  merge: (persisted, current) => {
    const p = (persisted ?? {}) as Partial<PersistedState>;
    const markets = { ...current.markets };
    for (const [id, m] of Object.entries(p.customMarkets ?? {})) {
      if (m && typeof m.id === "string") markets[id] = m;
    }
    const books = p.books ?? {};
    const activeWallet =
      p.activeWallet && books[p.activeWallet] ? p.activeWallet : null;
    const book = projectBook(books, activeWallet);
    return {
      ...current,
      markets,
      activity: p.activity ?? current.activity,
      books,
      activeWallet,
      positions: book.positions,
      trades: book.trades,
      user: book.user,
    };
  },
}));

/* ------------------------------------------------------------------ */
/* Simulation helpers                                                  */
/* ------------------------------------------------------------------ */

/** Challenge window used by the sim (kept short so the pipeline is visible). */
const SIM_CHALLENGE_WINDOW_MS = 2 * MIN;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Count standalone mentions of `phrase` in `hay` (word-boundary aware, so
 *  "AI" does not match "claim" or "available"). */
function mentions(hay: string, phrase: string): number {
  if (!phrase) return 0;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "g");
  return (hay.match(re) ?? []).length;
}

/**
 * Deterministic outcome proposal.
 * - majority: the word with the largest pool (ties broken alphabetically).
 * - binary: YES when a watched word is mentioned in the captured transcript,
 *   otherwise the market's final implied probability decides.
 */
export function proposedOutcome(m: Market, snippets: TranscriptSnippet[]): string {
  if (m.type === "majority") {
    if (!m.words || m.words.length === 0) return "";
    return [...m.words].sort((a, b) =>
      b.pool !== a.pool ? b.pool - a.pool : a.word.localeCompare(b.word)
    )[0].word;
  }
  const hay = snippets.map((s) => s.text.toLowerCase()).join(" ");
  const hits = (WATCH_WORDS[m.slug] ?? []).reduce(
    (n, w) => n + mentions(hay, w.toLowerCase()),
    0
  );
  if (hits > 0) return "yes";
  return lmsrProbYes(m.yesShares, m.noShares, m.b) >= 0.5 ? "yes" : "no";
}

/** Deterministic confidence for a proposal (58–99). */
function proposedConfidence(m: Market, outcome: string): number {
  if (m.type === "majority") {
    const pot = (m.words ?? []).reduce((s, w) => s + w.pool, 0);
    const win = (m.words ?? []).find((w) => w.word === outcome)?.pool ?? 0;
    return clamp(55 + Math.round((pot > 0 ? win / pot : 0) * 44), 55, 99);
  }
  const pYes = lmsrProbYes(m.yesShares, m.noShares, m.b);
  const p = outcome === "yes" ? pYes : 1 - pYes;
  return clamp(Math.round(58 + Math.abs(p - 0.5) * 74), 58, 99);
}

/** Stable FNV-1a hash of the evidence payload, formatted like a tx hash. */
function evidenceHashFor(outcome: string, snippets: TranscriptSnippet[]): string {
  const payload = `${outcome}|${snippets
    .map((s) => `${s.t}:${s.speaker}:${s.text}`)
    .join("|")}`;
  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${hex.slice(0, 4)}…${hex.slice(4)}`;
}

/**
 * Attach a deterministic resolution proposal to `m` (mutates in place):
 * sets the winning outcome, confidence, and evidence package with a deadline.
 * The proposal is backdated to the lock time so markets that ended long ago
 * finalize promptly once their challenge window has elapsed.
 */
function proposeResolution(m: Market, snippets: TranscriptSnippet[]): void {
  const outcome = proposedOutcome(m, snippets);
  const confidence = proposedConfidence(m, outcome);
  const proposedAt = Math.min(Date.now(), m.endTime);
  m.winningOutcome = outcome;
  m.confidence = confidence;
  m.evidence = {
    winningOutcome: outcome,
    confidence,
    proposedAt,
    proposedBy: "mention-resolver-01",
    evidenceHash: evidenceHashFor(outcome, snippets),
    bondUsd: 50,
    challengeWindowMs: SIM_CHALLENGE_WINDOW_MS,
    challengeDeadline: proposedAt + SIM_CHALLENGE_WINDOW_MS,
    challenged: false,
    snippets: snippets.slice(-3).map((l) => ({
      t: l.t,
      speaker: l.speaker,
      text: l.text,
    })),
  };
}

/** Shares received for spending `cost` USDC on `side` in an LMSR market. */
export function lmsrSharesForCost(m: Market, side: "yes" | "no", cost: number): number {
  // Solve for shares: C(q + shares) - C(q) = cost. LMSR is monotonic; binary
  // search is robust and cheap at UI precision.
  let lo = 0;
  let hi = 1;
  while (lmsrCostDelta(m, side, hi) < cost) hi *= 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (lmsrCostDelta(m, side, mid) < cost) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function lmsrCostDelta(m: Market, side: "yes" | "no", shares: number): number {
  return lmsrBuyCost(m.yesShares, m.noShares, m.b, side, shares);
}

/** USDC received for selling `shares` back into the LMSR pool. */
export function lmsrSellValue(m: Market, side: "yes" | "no", shares: number): number {
  return lmsrSellReturn(m.yesShares, m.noShares, m.b, side, shares);
}

function fmtShares(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 1 : 0 });
}

/** Share of the current pot held by the leading word (0..1). */
function leaderShare(m: Market): number {
  if (!m.words || m.words.length === 0) return 0;
  const pot = m.words.reduce((s, w) => s + w.pool, 0);
  if (pot <= 0) return 0;
  return Math.max(...m.words.map((w) => w.pool)) / pot;
}

/** Deterministic timestamped walk ending exactly at `target` — for sparkline seeds. */
export function seededWalkTimed(
  target: number,
  n: number,
  seed: number,
  endTime: number = Date.now(),
  stepMs = 5_000
): PricePoint[] {
  const values = seededWalk(target, n, seed);
  return values.map((v, i) => ({
    t: endTime - (n - 1 - i) * stepMs,
    v,
  }));
}

/** Deterministic random walk ending exactly at `target` — for sparkline seeds. */
function seededWalk(target: number, n: number, seed: number): number[] {
  const rnd = seededRandom(seed);
  const start = Math.min(0.95, Math.max(0.05, target + (rnd() - 0.5) * 0.5));
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const base = start + (target - start) * t;
    const noise = (rnd() - 0.5) * 0.14 * (1 - t);
    pts.push(Math.min(0.98, Math.max(0.02, base + noise)));
  }
  pts[n - 1] = target;
  return pts;
}

const FILLER = [
  "so the way this works is",
  "you can see the chart here",
  "we ran the numbers last night and",
  "honestly nobody expected that",
  "let me show you one more thing",
  "back to the main point",
  "that\u2019s exactly right, and",
  "if you look at the second half",
  "we\u2019ll come back to that",
  "the important thing here is",
];

const WORDS_BY_MARKET: Record<string, string[]> = {
  "sol-ai": ["AI", "the Solana network", "agents", "the validator set"],
  "fed-presser": ["inflation", "the labor market", "our mandate", "policy"],
  "streams-kai": ["the subathon", "chat", "the challenge", "donations"],
  "x-grok": ["Grok", "benchmarks", "open source", "agents"],
  "nbafinals-g7": ["the team", "defense", "MVP chatter", "the fourth quarter"],
  "earnings-nvda": ["data center", "AI demand", "guidance", "supply chain"],
  "debate-mayor": ["housing", "the budget", "public safety", "small business"],
  "spaces-crypto": ["the ETF", "regulation", "liquidity", "the halving"],
  "podcast-lex": ["consciousness", "the simulation", "love", "discipline"],
  "kick-ice": ["the ice bath", "the record", "donations", "the timer"],
};

function randomLine(rnd: () => number, m: Market): string {
  const filler = FILLER[Math.floor(rnd() * FILLER.length)];
  const pool = WORDS_BY_MARKET[m.slug] ?? ["the market", "the stream"];
  const subject = pool[Math.floor(rnd() * pool.length)];
  return `…${filler} ${subject}…`;
}

/** Start/stop the global simulation ticker (client-only). */
export function startSim(intervalMs = 1200) {
  if (simTimer) return;
  simTimer = setInterval(() => useSim.getState().tick(), intervalMs);
}

export function stopSim() {
  if (simTimer) {
    clearInterval(simTimer);
    simTimer = null;
  }
}
