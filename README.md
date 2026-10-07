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
  wallets trade simulated markets through a demo USDC vault, and trade real
  devnet SOL through the program for on-chain markets.

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm build      # production build

cd apps/program && cargo test   # on-chain program tests (19, LiteSVM)
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
