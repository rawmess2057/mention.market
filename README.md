# mention.market

**Trade on what actually gets said — in real time.**

A Solana-native prediction market where users trade on specific words/phrases
spoken during live events: streams, sports, earnings calls, debates, podcasts.

This repo contains the **web demo (MVP UI)** running on a simulated market
engine, plus a **deployed Anchor program** (`apps/program`) that the UI talks
to directly. Simulated markets keep the demo dense and always live; any market
whose id starts with `c` (e.g. `c101`) is backed by a real program account,
and trades on those send genuine devnet transactions from the connected wallet.

The backend resolution pipeline (transcription, indexer, feed) is not built
yet — until it lands, an offline `oracle.mjs` script posts resolutions.

## What's in the demo

| Screen | Route | Notes |
|---|---|---|
| Home / Discover | `/` | Live carousel, trending words, vertical filters |
| Market detail (binary) | `/market/[slug]` | LMSR YES/NO trading, live transcript, position P&L |
| Market detail (word race) | `/market/[slug]` | Pari-mutuel word board, back-word flow |
| Create market | `/create` | 4-step wizard (event → type → words → rules) |
| Portfolio | `/portfolio` | Positions, claimable winnings, points |
| Leaderboard | `/leaderboard` | Weekly points, win rates |

Simulated in real time: LMSR price ticks, bot trading flow, scrolling Deepgram-style
transcript with watched-word highlighting, pool growth, and the full resolution
pipeline (lock → evidence → challenge window → resolved → claim).

## Tech stack

- **Next.js 15** (App Router) + React 19 + TypeScript
- **Tailwind CSS** + Radix UI primitives (shadcn-style)
- **Zustand** simulation store (`src/lib/sim.ts`)
- **Pricing**: LMSR (`src/lib/lmsr.ts`) for binary, pari-mutuel (`src/lib/parimutuel.ts`) for word races
- **Wallet**: `@solana/wallet-adapter` (Phantom/Solflare) on devnet. Connected
  wallets trade both simulated and on-chain markets in real devnet SOL — the
  program escrows SOL in its vault and settles through the resolution pipeline.

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm build      # production build

cd apps/program && cargo test   # on-chain program tests (32, LiteSVM)
```

## Where things stand

The on-chain program is built, tested and wired into the web app:
`apps/web/src/lib/chain.ts` reads accounts and builds instructions straight
from the committed IDL, and `chain-sync.tsx` polls program accounts into the
Zustand store every 15s. Resolution is the optimistic UMA-lite flow from
`docs/RESEARCH.md` — propose with a bond, a 120s challenge window, finalize
and refund.

Program tests live in `apps/program/programs/mention/tests`. The web app's
LMSR, pari-mutuel, PnL and settlement math has its own vitest suite under
`apps/web/src/lib/__tests__` (`pnpm vitest run` in `apps/web`).

## Roadmap (next steps)

1. **Backend**: Deepgram transcription worker, Helius indexer, WebSocket price/chat feed,
   Postgres for users/points/evidence.
2. **Resolution engine**: AI confidence + evidence package (transcript snippets, audio
   hashes on Arweave), challenge bonds, multi-sig escalation.
3. **Production economics**: scale the proposal bond with open interest, and scale LMSR
   `b` with volume (`docs/RESEARCH.md` calls out both).

See `docs/RESEARCH.md` for the full comparison of Polymarket/Azuro/World/Kalshi
and the design rationale.

## Demo runbook (devnet)

The seeded on-chain markets live in `apps/program/scripts/seed-config.mjs`
(ids 1–16; 9–16 are a demo batch with staggered end times 6→45 min). Run the
whole flow a bit before presenting:

```bash
cd apps/program

# 1. One-time: initialize the config + resolver, then fund it.
node scripts/bootstrap.mjs

# 2. Create any missing markets (idempotent). The seeding wallet pays each
#    market's reserve ante + rent, so you can point it at a funded keypair.
SEED_KEYPAIR_PATH=$PWD/scripts/keys/resolver.json node scripts/seed.mjs

#    If an earlier demo batch already expired, seed the NEXT free block:
SEED_BLOCK=1 SEED_KEYPAIR_PATH=$PWD/scripts/keys/resolver.json node scripts/seed.mjs

# 3. Leave this running in a second terminal for the whole demo: it locks
#    markets when they end, proposes a resolution, waits out the 120s
#    challenge window, then finalizes — so audiences see live resolution.
#    Use the same SEED_BLOCK so the oracle resolves the batch you just seeded.
#    For a shifted batch, prefix this command with e.g. SEED_BLOCK=1.
node scripts/oracle.mjs --watch --all
```

Notes:

- The app auto-discovers on-chain markets with a single RPC every 15s — no id
  registry edits when you reseed. Use `SEED_BLOCK` (0 → ids 9–16, 1 → 25–32, …)
  for each fresh demo batch.
- The browser wallet (and the seeding wallet) need devnet SOL. `solana airdrop`
  is rate-limited, so top up from a wallet that has SOL:
  `solana transfer <addr> 5 --allow-unfunded-recipient`.
- Clear the demo browser's `localStorage` (`mention_chain_ids`) or use a fresh
  profile, otherwise leftover ids from earlier sessions clutter the list.
- Create a market in the UI to launch it on-chain (`b = 1 SOL`, reserve ante
  ≈ 0.69 SOL + rent from the creator wallet) or create a simulated/offline one.
