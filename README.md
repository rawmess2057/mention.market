# mention.market

**Trade on what actually gets said — in real time.**

A Solana-native prediction market where users trade on specific words/phrases
spoken during live events: streams, sports, earnings calls, debates, podcasts.

This repo currently contains the **web demo (MVP UI)** — a fully interactive
front end running on a simulated market engine. The on-chain program (Anchor)
and backend resolution pipeline land next.

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
- **Wallet**: `@solana/wallet-adapter` (Phantom/Solflare) on devnet — wired, trades are demo-mode

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm build      # production build
```

## Roadmap (next steps)

1. **Anchor program** (`apps/program`): Market/Position/Vault PDAs, binary + majority
   instructions, bond-based propose/challenge/finalize resolution, USDC settlement.
2. **Codama client** generated from the IDL, swapped into `sim.ts` behind the same
   store interface.
3. **Backend**: Deepgram transcription worker, Helius indexer, WebSocket price/chat feed,
   Postgres for users/points/evidence.
4. **Resolution engine**: AI confidence + evidence package (transcript snippets, audio
   hashes on Arweave), challenge bonds, multi-sig escalation.

See the product spec in the repo wiki / PR description for the full architecture.
