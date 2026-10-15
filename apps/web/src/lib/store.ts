/**
 * The app store: on-chain markets as last seen, and the connected wallet's
 * book (positions, trade history, balance, points).
 *
 * Markets come only from devnet (`components/chain-sync.tsx`). Trade actions
 * here are *mirrors*: the trade ticket sends the real transaction, then
 * records it so the UI moves at once; the next chain read reconciles.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { CHAIN_CREATE_B_UI, isChainId, reconcileChainMarkets } from "./chain";
import { shortAddr } from "./format";
import { mergePricePoints, mergeSeriesPoints, type PricePoint } from "./history";
import { lmsrSellReturn, lmsrSharesForCost as sharesForCost } from "./lmsr";
import { realizedOnSell as realizedPnlOnSell } from "./pnl";
import { claimPayout } from "./settle";
import { toastFromMessage } from "./toast";
import type { ActivityItem, Market, NotificationItem, Position, TradeRecord, User } from "./types";

const MIN = 60_000;

/* ------------------------------------------------------------------ */
/* Points                                                              */
/* ------------------------------------------------------------------ */

/** Leaderboard points: everyone earns the same amounts, so rank = activity. */
export const POINTS_PER_SOL = 2; // per SOL unit spent on a buy or back
export const POINTS_HOLD_TO_RESOLVE = 10; // per position still held when its market resolves
export const POINTS_CLAIM = 25; // one-time bonus when a resolved winner is claimed

/** Points earned by spending `amount` on an open market. */
export function pointsForTrade(amount: number): number {
  return Math.max(0, Math.floor(amount)) * POINTS_PER_SOL;
}

/** Points earned for still holding (unclaimed) a stake when its market resolves. */
export function holdToResolvePoints(positions: Record<string, Position>, marketId: string): number {
  const pos = positions[marketId];
  return pos && !pos.claimed ? POINTS_HOLD_TO_RESOLVE : 0;
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

const NOTIF_DEDUPE_MS = 2 * MIN;

/** Prepend a notification, deduping the same event firing repeatedly. */
export function addNotification(
  list: NotificationItem[],
  n: Omit<NotificationItem, "id" | "at">
): NotificationItem[] {
  const now = Date.now();
  const dup = list.some(
    (x) => now - x.at < NOTIF_DEDUPE_MS && x.kind === n.kind && x.marketId === n.marketId && x.text === n.text
  );
  if (dup) return list;
  return [{ id: `n-${now}-${Math.floor(Math.random() * 1e6)}`, at: now, ...n }, ...list].slice(0, 40);
}

/* ------------------------------------------------------------------ */
/* Wallet books                                                        */
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

const GUEST: User = { handle: "Guest", points: 0, rank: 0, balance: 0, wallet: "" };

function freshBook(wallet: string): WalletBook {
  return { user: { handle: shortAddr(wallet), points: 0, rank: 0, balance: 0, wallet }, positions: {}, trades: [] };
}

function projectBook(books: Record<string, WalletBook>, wallet: string | null): WalletBook {
  return (wallet && books[wallet]) || { user: { ...GUEST }, positions: {}, trades: [] };
}

/** Same LMSR math the program runs, over a store `Market` (UI units). */
export function lmsrSharesForCost(m: Market, side: "yes" | "no", cost: number): number {
  return sharesForCost(m.yesShares, m.noShares, m.b, side, cost);
}

export function lmsrSellValue(m: Market, side: "yes" | "no", shares: number): number {
  return lmsrSellReturn(m.yesShares, m.noShares, m.b, side, shares);
}

const fmtShares = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(4));
const tradeId = () => `t-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

interface AppState {
  markets: Record<string, Market>;
  positions: Record<string, Position>;
  /** Decoded on-chain trade history per market. */
  chainActivity: Record<string, ActivityItem[]>;
  /** Per-market counter bumped when a just-sent chain trade should refetch. */
  chainActivityNonce: Record<string, number>;
  /** Price series per market (chart and sparkline data). */
  history: Record<string, PricePoint[]>;
  /** Per-option series for word races: marketId -> word -> points. */
  wordHistory: Record<string, Record<string, PricePoint[]>>;
  user: User;
  trades: TradeRecord[];
  books: Record<string, WalletBook>;
  activeWallet: string | null;
  pendingTrade: ConfirmTrade | null;
  notifications: NotificationItem[];
  /**
   * True once a whole-program market fetch has succeeded this session, so the
   * empty state can tell "devnet has no markets" from "we haven't looked yet".
   */
  chainSynced: boolean;
  /** True when the latest chain poll failed and nothing has synced yet. */
  chainSyncError: boolean;

  setWallet: (wallet: string | null) => void;
  setBalance: (wallet: string, balance: number) => void;
  buyBinary: (marketId: string, side: "yes" | "no", amount: number, txSig?: string) => void;
  sellBinary: (marketId: string, side: "yes" | "no", shares: number) => void;
  backWord: (marketId: string, word: string, amount: number, txSig?: string) => void;
  claim: (marketId: string) => void;
  challenge: (marketId: string) => void;
  /** Show a just-launched market before the next chain poll picks it up. */
  addLaunchedMarket: (m: {
    chainId: number;
    title: string;
    event: string;
    vertical: Market["vertical"];
    type: Market["type"];
    words: string[];
    minutes: number;
    rules: string;
  }) => string;
  /** Replace the store's view of the on-chain markets with the whole GPA result. */
  syncChainMarkets: (markets: Market[]) => void;
  setChainSyncError: (failed: boolean) => void;
  ingestChainPositions: (positions: Position[]) => void;
  ingestChainActivity: (marketId: string, items: ActivityItem[]) => void;
  ingestChainHistory: (marketId: string, points: PricePoint[]) => void;
  ingestWordHistory: (marketId: string, byWord: Record<string, PricePoint[]>) => void;
  bumpChainActivity: (marketId: string) => void;
  setPendingTrade: (t: ConfirmTrade | null) => void;
  /** One-line notice through the app toaster (`lib/toast.ts`). */
  showToast: (msg: string | null) => void;
  pushNotification: (n: Omit<NotificationItem, "id" | "at">) => void;
  markAllRead: () => void;
}

/** What survives a reload: the wallet books. Markets always come fresh from devnet. */
interface PersistedState {
  books: Record<string, WalletBook>;
  activeWallet: string | null;
}

export const STORE_KEY = "mention-market-v3";
/** The simulation-era key. Its wallet books are real trade history: migrate them. */
export const LEGACY_STORE_KEY = "mention-market-sim-v2";

/** Keep only on-chain entries of a simulation-era book. */
export function migrateLegacyBooks(raw: unknown): Record<string, WalletBook> {
  const books: Record<string, WalletBook> = {};
  if (!raw || typeof raw !== "object") return books;
  for (const [wallet, book] of Object.entries(raw as Record<string, Partial<WalletBook>>)) {
    if (!book || typeof book !== "object" || !book.user) continue;
    books[wallet] = {
      user: { ...book.user, wallet },
      positions: Object.fromEntries(Object.entries(book.positions ?? {}).filter(([id]) => isChainId(id))),
      trades: (book.trades ?? []).filter((t) => isChainId(t.marketId)),
    };
  }
  return books;
}

const storage = createJSONStorage<PersistedState>(() => {
  const ls = window.localStorage; // throws during SSR: persistence is skipped there
  return {
    getItem: (name) => {
      const current = ls.getItem(name);
      if (current) return current;
      const legacy = ls.getItem(LEGACY_STORE_KEY);
      if (!legacy) return null;
      try {
        const { state } = JSON.parse(legacy) as { state?: { books?: unknown; activeWallet?: string | null } };
        const books = migrateLegacyBooks(state?.books);
        const activeWallet = state?.activeWallet && books[state.activeWallet] ? state.activeWallet : null;
        return JSON.stringify({ state: { books, activeWallet }, version: 1 });
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      ls.setItem(name, value);
      ls.removeItem(LEGACY_STORE_KEY);
    },
    removeItem: (name) => ls.removeItem(name),
  };
});

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      markets: {},
      positions: {},
      chainActivity: {},
      chainActivityNonce: {},
      history: {},
      wordHistory: {},
      user: { ...GUEST },
      trades: [],
      books: {},
      activeWallet: null,
      chainSynced: false,
      chainSyncError: false,
      pendingTrade: null,
      notifications: [],

      setWallet: (wallet) =>
        set((s) => {
          const books = wallet && !s.books[wallet] ? { ...s.books, [wallet]: freshBook(wallet) } : s.books;
          const book = projectBook(books, wallet);
          return { books, activeWallet: wallet, positions: book.positions, trades: book.trades, user: book.user };
        }),

      setBalance: (wallet, balance) =>
        set((s) => {
          const book = s.books[wallet];
          if (!book) return {};
          const user = { ...book.user, balance };
          const books = { ...s.books, [wallet]: { ...book, user } };
          return { books, ...(s.activeWallet === wallet ? { user } : {}) };
        }),

      buyBinary: (marketId, side, amount, txSig) => {
        const wallet = get().activeWallet;
        const m = get().markets[marketId];
        if (!wallet || !m || m.status !== "open") return;
        const shares = lmsrSharesForCost(m, side, amount);
        if (shares <= 0) return;
        const trade: TradeRecord = {
          id: tradeId(),
          marketId,
          marketTitle: m.title,
          kind: "buy",
          side,
          amount,
          shares,
          price: amount / shares,
          avgEntry: amount / shares,
          pnl: 0,
          at: Date.now(),
          txSig,
        };
        set((s) => {
          const mm = structuredClone(s.markets[marketId]);
          if (side === "yes") mm.yesShares += shares;
          else mm.noShares += shares;
          mm.volume += amount;
          mm.traders += 1;
          const positions = { ...s.positions };
          const p: Position = positions[marketId] ? structuredClone(positions[marketId]) : { id: `p-${marketId}`, marketId };
          if (side === "yes") {
            const held = p.yesShares ?? 0;
            p.avgYesPrice = ((p.avgYesPrice ?? 0) * held + amount) / (held + shares);
            p.yesShares = held + shares;
          } else {
            const held = p.noShares ?? 0;
            p.avgNoPrice = ((p.avgNoPrice ?? 0) * held + amount) / (held + shares);
            p.noShares = held + shares;
          }
          positions[marketId] = p;
          const user = {
            ...s.user,
            balance: Math.max(0, s.user.balance - amount),
            points: s.user.points + pointsForTrade(amount),
          };
          const trades = [trade, ...s.trades].slice(0, 500);
          return {
            markets: { ...s.markets, [marketId]: mm },
            positions,
            user,
            trades,
            books: { ...s.books, [wallet]: { user, positions, trades } },
          };
        });
        get().showToast(`Bought ${side.toUpperCase()} · ${fmtShares(shares)} shares`);
      },

      sellBinary: (marketId, side, shares) => {
        const wallet = get().activeWallet;
        const s0 = get();
        const m = s0.markets[marketId];
        const p = s0.positions[marketId];
        if (!wallet || !m || !p || m.status !== "open") return;
        const held = side === "yes" ? (p.yesShares ?? 0) : (p.noShares ?? 0);
        const sell = Math.min(shares, held);
        if (sell <= 0) return;
        const proceeds = lmsrSellValue(m, side, sell);
        const avgEntry = side === "yes" ? (p.avgYesPrice ?? 0) : (p.avgNoPrice ?? 0);
        const entryPrice = avgEntry > 0 ? avgEntry : proceeds / sell;
        const trade: TradeRecord = {
          id: tradeId(),
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
          const mm = structuredClone(st.markets[marketId]);
          if (side === "yes") mm.yesShares = Math.max(0, mm.yesShares - sell);
          else mm.noShares = Math.max(0, mm.noShares - sell);
          const positions = { ...st.positions };
          const pp = structuredClone(positions[marketId]);
          if (side === "yes") pp.yesShares = (pp.yesShares ?? 0) - sell;
          else pp.noShares = (pp.noShares ?? 0) - sell;
          positions[marketId] = pp;
          const user = { ...st.user, balance: st.user.balance + proceeds };
          const trades = [trade, ...st.trades].slice(0, 500);
          return {
            markets: { ...st.markets, [marketId]: mm },
            positions,
            user,
            trades,
            books: { ...st.books, [wallet]: { user, positions, trades } },
          };
        });
        get().showToast(`Sold ${side.toUpperCase()} · +${fmtShares(proceeds)} SOL`);
      },

      backWord: (marketId, word, amount, txSig) => {
        const wallet = get().activeWallet;
        const m = get().markets[marketId];
        if (!wallet || !m || m.status !== "open" || !m.words) return;
        const pot = m.words.reduce((s, x) => s + x.pool, 0);
        const wPool = m.words.find((x) => x.word === word)?.pool ?? 0;
        const trade: TradeRecord = {
          id: tradeId(),
          marketId,
          marketTitle: m.title,
          kind: "back",
          side: word,
          amount,
          shares: 0,
          price: pot + amount > 0 ? wPool / (pot + amount) : 0,
          pnl: 0,
          at: Date.now(),
          txSig,
        };
        set((s) => {
          const mm = structuredClone(s.markets[marketId]);
          const w = mm.words!.find((x) => x.word === word);
          if (!w) return {};
          w.pool += amount;
          w.bettors += 1;
          w.lastBetAt = Date.now();
          mm.volume += amount;
          // Reflect the back immediately across every word's series.
          const t = Date.now();
          const total = mm.words!.reduce((acc, x) => acc + x.pool, 0);
          const byWord: Record<string, PricePoint[]> = { ...(s.wordHistory[marketId] ?? {}) };
          for (const x of mm.words!) {
            byWord[x.word] = [...(byWord[x.word] ?? []), { t, v: total > 0 ? x.pool / total : 0 }].slice(-240);
          }
          const positions = { ...s.positions };
          const p: Position = positions[marketId] ? structuredClone(positions[marketId]) : { id: `p-${marketId}`, marketId };
          p.wordBacks = { ...(p.wordBacks ?? {}), [word]: (p.wordBacks?.[word] ?? 0) + amount };
          positions[marketId] = p;
          const user = {
            ...s.user,
            balance: Math.max(0, s.user.balance - amount),
            points: s.user.points + pointsForTrade(amount),
          };
          const trades = [trade, ...s.trades].slice(0, 500);
          return {
            markets: { ...s.markets, [marketId]: mm },
            positions,
            user,
            trades,
            wordHistory: { ...s.wordHistory, [marketId]: byWord },
            books: { ...s.books, [wallet]: { user, positions, trades } },
          };
        });
        get().showToast(`Backed “${word}” · ${fmtShares(amount)} SOL`);
      },

      claim: (marketId) => {
        const wallet = get().activeWallet;
        const s0 = get();
        const m = s0.markets[marketId];
        const pos = s0.positions[marketId];
        if (!wallet || !m || !pos || pos.claimed) return;
        const q = claimPayout(m, pos);
        if (!q || q.payout <= 0) return;
        const trade: TradeRecord = {
          id: tradeId(),
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
          const user = { ...st.user, balance: st.user.balance + q.payout, points: st.user.points + POINTS_CLAIM };
          const trades = [trade, ...st.trades].slice(0, 500);
          return { positions, user, trades, books: { ...st.books, [wallet]: { user, positions, trades } } };
        });
        get().showToast(`Claimed ${fmtShares(q.payout)} SOL`);
      },

      challenge: (marketId) => {
        set((s) => {
          const mm = structuredClone(s.markets[marketId]);
          if (!mm?.evidence) return {};
          mm.evidence.challenged = true;
          return {
            markets: { ...s.markets, [marketId]: mm },
            notifications: addNotification(s.notifications, {
              kind: "challenge",
              marketId,
              marketSlug: mm.slug,
              marketTitle: mm.title,
              text: `Challenge submitted on “${mm.title}” — the resolver reviews it`,
            }),
          };
        });
        get().showToast("Challenge submitted — the resolver reviews it");
      },

      addLaunchedMarket: ({ chainId, title, event, vertical, type, words, minutes, rules }) => {
        const id = `c${chainId}`;
        const now = Date.now();
        const market: Market = {
          id,
          slug: id,
          title,
          event,
          vertical,
          type,
          status: "open",
          createdAt: now,
          endTime: now + minutes * MIN,
          volume: 0,
          traders: 0,
          yesShares: 0,
          noShares: 0,
          b: CHAIN_CREATE_B_UI,
          words: type === "majority" ? words.map((w) => ({ word: w, pool: 0, bettors: 0, lastBetAt: 0 })) : undefined,
          rules,
          creator: "chain",
          creatorFeeBps: 100,
          source: `chain #${chainId} (devnet)`,
          sourceUrl: `https://explorer.solana.com/address/5xA4v2SasSoE8mPnWSpePV3U4piHgag51od6mrNDU8j8?cluster=devnet`,
        };
        set((s) => ({ markets: { ...s.markets, [id]: market } }));
        return id;
      },

      syncChainMarkets: (incoming) =>
        set((s) => {
          const { markets, removed } = reconcileChainMarkets(s.markets, incoming);
          const synced = { chainSynced: true, chainSyncError: false };
          if (removed.length === 0) return { markets, ...synced };
          // Drop the chart state of vanished markets too.
          const history = { ...s.history };
          const wordHistory = { ...s.wordHistory };
          for (const id of removed) {
            delete history[id];
            delete wordHistory[id];
          }
          return { markets, ...synced, history, wordHistory };
        }),

      setChainSyncError: (failed) => set({ chainSyncError: failed }),

      ingestChainPositions: (incoming) => {
        const wallet = get().activeWallet;
        if (!wallet) return;
        set((s) => {
          const positions = { ...s.positions };
          for (const p of incoming) positions[p.marketId] = p;
          const books = { ...s.books };
          const book = books[wallet];
          if (book) books[wallet] = { ...book, positions: { ...book.positions, ...positions } };
          return { positions, books };
        });
      },

      ingestChainHistory: (marketId, points) =>
        set((s) =>
          points.length === 0
            ? s
            : { history: { ...s.history, [marketId]: mergePricePoints(s.history[marketId] ?? [], points) } }
        ),

      ingestWordHistory: (marketId, byWord) =>
        set((s) =>
          Object.keys(byWord).length === 0
            ? s
            : { wordHistory: { ...s.wordHistory, [marketId]: mergeSeriesPoints(s.wordHistory[marketId] ?? {}, byWord) } }
        ),

      ingestChainActivity: (marketId, items) =>
        set((s) => {
          const prev = s.chainActivity[marketId] ?? [];
          const incoming = new Set(items.map((i) => i.id));
          const merged = [...items, ...prev.filter((p) => !incoming.has(p.id))].sort((a, b) => b.at - a.at).slice(0, 40);
          return { chainActivity: { ...s.chainActivity, [marketId]: merged } };
        }),

      bumpChainActivity: (marketId) =>
        set((s) => ({
          chainActivityNonce: { ...s.chainActivityNonce, [marketId]: (s.chainActivityNonce[marketId] ?? 0) + 1 },
        })),

      setPendingTrade: (t) => set({ pendingTrade: t }),
      showToast: (msg) => {
        if (msg) toastFromMessage(msg);
      },
      pushNotification: (n) => set((s) => ({ notifications: addNotification(s.notifications, n) })),
      markAllRead: () =>
        set((s) => ({ notifications: s.notifications.map((n) => (n.read ? n : { ...n, read: true })) })),
    }),
    {
      name: STORE_KEY,
      version: 1,
      storage,
      partialize: (s) => ({ books: s.books, activeWallet: s.activeWallet }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PersistedState>;
        const books = p.books ?? {};
        const activeWallet = p.activeWallet && books[p.activeWallet] ? p.activeWallet : null;
        const book = projectBook(books, activeWallet);
        return { ...current, books, activeWallet, positions: book.positions, trades: book.trades, user: book.user };
      },
    }
  )
);
