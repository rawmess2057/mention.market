# CLAUDE.md — mention.market

> **Trade on what actually gets said.** Solana prediction markets on words and
> phrases spoken during live events (streams, sports, earnings calls, politics,
> podcasts). Devnet MVP: a Next.js app that combines a simulated market engine
> with a deployed Anchor program, plus resolution packages.

Product and design background lives in `README.md` (demo runbook) and
`docs/RESEARCH.md` (competitors, resolution and AMM design). This file is the
working guide: where things are, how to run them, and what breaks.

---

## 1. Repo map

```
mention.market/                 pnpm monorepo (pnpm@9, node >= 20)
├── apps/web/                   @mention/web: Next.js 15 App Router UI (main surface)
├── apps/program/               Anchor program "mention" + devnet ops scripts
│                               NOT in the pnpm workspace (own package-lock / npm)
├── apps/resolution/            @mention/resolution: spec/evidence contracts, canonical JSON, sha256
├── apps/resolver/              @mention/resolver: spec store, resolution queue, transcript pipeline, Deepgram adapters
│   └── data/specs/*.json       committed resolution specs keyed by market address (fixtures; live specs are in Postgres)
├── apps/worker/                @mention/worker: resolution worker (Railway, Dockerfile) + operator CLI
├── packages/db/                @mention/db: Postgres client (Neon serverless), migrations, PGlite test DB
└── docs/RESEARCH.md            design rationale (UMA-lite resolution, LMSR, etc.)
```

Dependency direction: `web → resolver → resolution`, `worker → resolver`. `program/scripts` imports
`apps/resolver` through **relative paths**, because it sits outside the workspace.

---

## 2. Commands

```bash
# root
pnpm install
pnpm dev                         # web on http://localhost:3000 (writes to .next-dev/)
pnpm build                       # web production build (writes to .next/)
pnpm lint                        # next lint

# web
cd apps/web && pnpm test         # vitest run (src/lib/__tests__)
cd apps/web && pnpm vitest run src/lib/__tests__/lmsr.test.ts   # single file

# resolution / resolver (node:test)
cd apps/resolution && pnpm test
cd apps/resolver  && pnpm test

# program (Rust 1.89.0, Anchor 1.0.2, LiteSVM tests)
cd apps/program && anchor build                 # → target/deploy/mention.so + target/idl/mention.json
cd apps/program && cargo test                   # 37 LiteSVM tests (+13 unit) in programs/mention/tests/test_market.rs
cd apps/program && anchor program deploy target/deploy/mention.so   # (npm run deploy)

# devnet ops (from apps/program)
node scripts/cleanup.mjs                       # wipe all markets, refund to authority
node scripts/bootstrap.mjs                     # init config + resolver (one time)
SEED_KEYPAIR_PATH=$PWD/scripts/keys/resolver.json node scripts/seed.mjs
node scripts/oracle.mjs --watch --all          # lock → propose → wait 120s → finalize
node scripts/resolver.mjs status <id|c12|addr> # trusted resolver CLI (lock/evidence/propose/finalize)
node scripts/evidence-e2e.mjs                  # full evidence flow E2E on devnet
node scripts/smoke.mjs                         # quick program smoke test

# resolution worker (needs DATABASE_URL, DEEPGRAM_API_KEY, RESOLVER_KEYPAIR[_PATH], SOLANA_RPC_URL)
cd apps/worker && pnpm test                    # full lock→finalize flow on PGlite + a fake chain
ONCE=1 RESOLVER_KEYPAIR_PATH=../program/scripts/keys/resolver.json node src/main.mjs
pnpm --filter @mention/worker ops list         # queue; also: show <m>, approve <m> --rationale "…" [--outcome x|void], retry <m> [--audio-start ISO]
```

### Before you finish a change, run

| Touched | Run |
|---|---|
| `apps/web/**` | `cd apps/web && pnpm test && npx tsc --noEmit && pnpm lint` |
| `apps/program/**` | `cd apps/program && cargo test` (then `anchor build` and sync the IDL, see §6) |
| `apps/resolution/**`, `apps/resolver/**`, `apps/worker/**`, `packages/db/**` | `pnpm test` in that package (store and DB tests run on in-process Postgres via PGlite, no server needed) |

---

## 3. Environment

| Var | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SOLANA_RPC_URL` (or `NEXT_PUBLIC_RPC_URL`) | `apps/web/.env.local` | Devnet RPC. Falls back to the public endpoint, which is rate-limited and breaks trades. Copy from `.env.example`. |
| `DATABASE_URL` | Vercel, web API route, resolver, scripts | Postgres (Neon). When set, the spec store uses it; when unset, it uses files. **Required on Vercel.** Migrate: `pnpm --filter @mention/db migrate`. Backfill files: `node apps/resolver/scripts/import-specs.mjs`. |
| `RESOLVER_DATA_DIR` | web API route, resolver | File-backend spec dir (only without `DATABASE_URL`). Defaults to `apps/resolver/data`. |
| `DEEPGRAM_API_KEY` | worker, resolver adapters | Batch transcription. Worker host only (not Vercel). |
| `RESOLVER_KEYPAIR` / `RESOLVER_KEYPAIR_PATH` | worker | Resolver secret key: JSON byte array (hosted secret) or file path. Must equal `config.resolver`. **Never on Vercel.** |
| `POLL_MS`, `ONCE=1`, `OPS_REVIEWER` | worker / ops CLI | Pass interval; single pass; reviewer name the CLI records. |
| `SOLANA_RPC_URL`, `ANCHOR_PROVIDER_URL` | program scripts | Script RPC. |
| `SEED_BLOCK` | seed / oracle | Demo batch: 0 → ids 9–16, 1 → 25–32, … Use the **same** value for seed and oracle. |
| `SEED_KEYPAIR_PATH`, `SEED_ONLY`, `SEED_END_SECONDS` | seed.mjs | Payer keypair and seed filtering. |
| `CLOSE_IDS`, `CLOSE_KEYPAIR_PATH`, `CLOSE_RECIPIENT` | cleanup.mjs | Cleanup scope. |
| `MODE=watch`, `DRY=1`, `POLL_MS`, `IDS`, `CONFIDENCE`, `FEE_BPS` | oracle / bootstrap | Ops knobs. |

Keys: `apps/program/scripts/keys/resolver.json` is the trusted resolver and must
equal `config.resolver` on-chain. Deploy wallet: `~/.config/solana/id.json`
(the config authority). Never commit keys or print their contents.

---

## 4. On-chain program (`apps/program/programs/mention/src`)

**Program ID:** `5xA4v2SasSoE8mPnWSpePV3U4piHgag51od6mrNDU8j8` (devnet and localnet)

```
lib.rs              #[program] entrypoints (thin wrappers → instructions/*::handler)
state.rs            accounts + enums
constants.rs        limits, bond, challenge window
error.rs            ErrorCode
math/lmsr.rs        f64 LMSR: cost_units, price_yes, cost_delta, sell_return, shares_for_cost, reserve_ante
instructions/       one file per instruction (+ token_util.rs for lamport moves)
tests/test_market.rs  LiteSVM integration tests
```

### PDAs

| Account | Seeds |
|---|---|
| Config | `["config"]` |
| Market | `["market", id.to_le_bytes()]` (u64 LE) |
| Vault (holds SOL as lamports) | `["vault", market]` |
| ResolutionSpecCommitment | `["resolution-spec", market]` |
| EvidenceManifest | `["evidence", market, sha256(bytes)]` |
| Position | `["position", market, owner]` |
| Challenge (one open dispute per market) | `["challenge", market]` |

### Instructions

| Ix | Who | Notes |
|---|---|---|
| `initialize_config(fee_bps)` | authority | One time. Sets authority, resolver, fee. |
| `create_market(id, title, event, vertical, market_type, b, words, end_time, creator_fee_bps, spec_sha256)` | anyone | Creates market, vault and spec. Creator pays the LMSR reserve ante (`reserve_ante(b)`, ≈0.69 SOL at b = 1 SOL) plus rent. |
| `buy_binary(side 0=YES/1=NO, cost, min_shares)` / `sell_binary(side, shares, min_proceeds)` | trader | LMSR. Slippage-guarded. |
| `back_word(word, amount)` | trader | Pari-mutuel (Majority markets). |
| `lock_market` | anyone | After `end_time`. |
| `post_evidence(bytes, sha256, spec_sha256)` | resolver | Program recomputes the sha256. Account max 4096 bytes, but one tx carries ≤ 813 (see #19). |
| `propose_resolution(outcome, confidence, evidence_sha256)` | resolver | Posts a 1 SOL bond. Opens a 120s challenge window. Rejected if the spec hash is all-zero (legacy/demo). Always takes the `challenge` PDA. If a challenge is open it **settles it** and then needs `challengerAccount`, `priorProposerAccount` and `treasury` (use `settlementAccounts()` in `scripts/lib.mjs`). |
| `challenge_resolution` | anyone | Inside the window, with a 1 SOL bond. Opens the `Challenge` PDA and resets the market to Locked. Settled by the next proposal: **different outcome = upheld**, challenger gets both bonds. **Same outcome = rejected**, proposer is refunded and the challenger's bond goes to the treasury (`config.authority`), never to the resolver. |
| `finalize_resolution` | anyone | After the window. Refunds the bond to the proposer. |
| `claim_payout` | holder | One-shot (`position.claimed`). Binary: winning shares pay 1:1. Majority: pro-rata of `total_pool * (1 - creator_fee_bps/10000)`. **Void** (`winning_outcome == "void"`): binary YES and NO shares each pay ½ (always solvent, can't be gamed; a cost-basis refund could be insolvent). Majority backs are refunded in full with no rake. |
| `set_paused(bool)` | authority | Kill switch. |
| `close_market` | authority | Devnet cleanup. Reaps market, vault and spec, plus Position/Evidence/Challenge accounts passed as remaining accounts. Force-closes **resolved** markets too. |

**Void:** `"void"` is a reserved outcome. Any market can be proposed and finalized as void, through the normal bond and challenge flow. No market may use it as a word (`ReservedWord`, case-insensitive), and no resolution spec may list it. Evidence for a void ruling must use `evaluator.method: "manual"`. Ops: `VOID_IDS=11 node scripts/oracle.mjs …` or `node scripts/resolver.mjs resolve <m> --force void --approve …`.

**Lifecycle:** `Open → Locked → Resolving → Resolved` (trades after `end_time` fail with `MarketClosed`).

**Limits** (mirrored in `apps/web/src/lib/chain.ts`): title/event ≤ 64 bytes,
word ≤ 32 bytes, ≤ 16 words, fee ≤ 500 bps, duration ≥ 5 min (web check),
challenge window 120s, bond 1 SOL.

---

## 5. Web app (`apps/web/src`)

Stack: Next 15, React 19, TypeScript, Tailwind 3 + Radix (shadcn-style),
Zustand (persisted), framer-motion, lightweight-charts, wallet-adapter
(Phantom/Solflare), Anchor TS 0.32. Path alias `@/` → `src/`.

### Routes (`app/`)
| Route | File | What |
|---|---|---|
| `/` | `app/page.tsx` | Discover: search, vertical filters, sort (trending/volume/ending), Trading / Awaiting result / Resolved shelves |
| `/market/[slug]` | `app/market/[slug]/page.tsx` | Binary (LMSR ticket) or word race (word board) detail |
| `/create` | `app/create/page.tsx` | 4-step wizard (event → type → words → rules). On-chain or sim launch. |
| `/portfolio` | `app/portfolio/page.tsx` | Positions, P&L, claims, points (largest page, ~1.1k lines) |
| `/leaderboard` | `app/leaderboard/page.tsx` | Weekly points |
| `POST/GET /api/specs` | `app/api/specs/route.ts` | Saves and loads resolution specs into the resolver file store |

### Core libs (`lib/`)
| File | Role |
|---|---|
| `types.ts` | Domain types: `Market`, `Position`, `Evidence`, `WordPool`, `TradeRecord`, … |
| `sim.ts` | **Zustand store `useSim`** (persisted): markets, positions, per-wallet `books`, history, transcript, activity, toast/notifications. Actions: `buyBinary`, `sellBinary`, `backWord`, `claim`, `challenge`, `createMarket`, `syncChainMarkets`, `ingestChain*`, `tick`. Seed data: `SEED_MARKETS`, `WATCH_WORDS`, `LEADERBOARD`. `startSim(1200ms)` drives bot flow, price ticks and the resolution pipeline for sim markets. |
| `chain.ts` | **All on-chain I/O**: PDAs, IDL `program`, `fetchChainMarketsAll`, `mapMarketToStore`, `mapPositionToStore`, tx builders (`chainBuyBinary`, `chainSellBinary`, `chainBackWord`, `chainClaim`, `chainChallenge`, `chainCreateMarket`), `chainCreateProblems` (pre-flight validation), `chainErrorText`, price-series builders from tx history, `withRetry` RPC backoff. |
| `lmsr.ts` / `parimutuel.ts` | Pricing math, mirroring the Rust side. |
| `settle.ts` / `pnl.ts` | Claim quotes, P&L, vertical breakdown, P&L series. |
| `history.ts` | `PricePoint` series: normalize, resample, timeframes (`all/1m/5m/1h/1d`), merge. |
| `format.ts` | `cn`, `fmtSol`, `fmtPct`, `fmtTimeLeft`, `fmtAgo`, `shortAddr`, `fmtErr`, `seededRandom`. |
| `motion.ts` | Shared animation tokens (`DURATION`, `EASE`, `SPRING`, `PRESS`, `fadeIn`, `sheetIn`). Use these instead of ad-hoc values. |
| `create-categories.ts` | Create-wizard categories and templates. |
| `idl/mention.json`, `idl/mention-types.ts` | **Committed copy** of the program IDL. |

### Sim vs chain markets
- A market id matching `/^c\d+$/` (e.g. `c12`) is a **chain market** (`isChainId`); all others are simulated.
- `components/chain-sync.tsx` polls every **30s ± 5s jitter** (the README says 15s, which is out of date): `fetchChainMarketsAll` → `syncChainMarkets` (reconciles, so closed markets disappear), plus the wallet's positions and price series.
- `isStaleChainMarket` hides dead chain markets: open past end, or resolved more than 24h ago.
- Chain ids: localStorage key `mention_chain_ids` is sticky. New UI markets start above the max seen id (or at 100), and `freeChainId` probes devnet for an unused PDA.
- Trading on a chain market sends a real devnet tx and then mirrors it into the store. Sim markets only mutate the store.

### Components
- `components/ui/*`: primitives (button, badge/`StatusBadge`, card, dialog, sheet, tabs, segmented, input, progress, skeleton, stat, probability, outcome-row, quote-title, empty-state, toaster). Reuse these.
- `components/viz/*`: sparkline, split-bar, leader-bar, ticker-tape, waveform-strip, animated-number, confetti.
- Feature: `trade-ticket`, `word-board`, `price-chart`, `market-card`, `market-hero`, `position-card`, `claim-card`, `evidence-viewer`, `trust-panel`, `resolution-grammar`, `pulse-feed`, `recent-trades`, `activity-feed`, `the-whisper`, `shell` (TopBar/BottomNav).
- Wiring: `providers.tsx` (wallet + connection), `wallet-sync.tsx` (active wallet → store), `chain-sync.tsx`.
- Hooks: `useChain`, `useChainActivity`, `useSolBalance`, `useNow`, `useMediaQuery`.

### Design system (dark, editorial)
- **Semantic tokens only.** RGB channels live in `app/globals.css` (`--bg`, `--surface{,-2,-3}`, `--line{,-strong}`, `--fg{,-muted,-subtle}`, `--accent{,-strong}`, `--yes`, `--no`, `--warn`, `--live`) and are mirrored in `lib/theme.ts` (`PALETTE`, `rgba()` for charts/SVG). Tailwind exposes them as `bg-surface-2`, `text-fg-muted`, `bg-yes-soft`, `border-no-line`, … `theme-guard.test.ts` fails on raw hex or Tailwind's default palette names.
- **Fonts:** `font-sans` Inter (UI), `font-mono` JetBrains Mono (every number, `tnum` class for tabular digits), `font-display` Instrument Serif (market titles and page headlines only).
- **The signature:** market titles are quotes, so `QuoteTitle` (`components/ui/quote-title.tsx`) sets them in the display serif with the quoted phrase in `.quote-hit` (italic on a highlighter stroke). `splitQuote` in `lib/watch-words.ts` finds the phrase; it's the same regex that drives resolution watch-words.
- **Lean glow:** `.card-glow` paints a radial wash from the top-right in `--glow` (the outcome colour) at `--glow-a` (how hard the market leans), set inline per card/hero. Coin-flips stay neutral; a 90% market is unmistakably green.
- **Chrome:** `.glass` for floating bars (top bar, bottom nav, mobile trade bar). Backdrop is `.backdrop` in `layout.tsx` (two drifting aurora blobs, faded grid, film grain).
- **Motion:** tokens in `lib/motion.ts` (`DURATION`, `EASE`, `SPRING_TIGHT`, `fadeIn`, `sheetIn`); `.rise` + `--i` for staggered lists; `app/template.tsx` fades each route in (opacity only: a transform there breaks `position: fixed` children). `AnimatedNumber` for any value that changes live. `Segmented` for every sort/timeframe/mode toggle.
- Radii: `rounded-field` (inputs, chips), `rounded-tile`, `rounded-2xl` cards, `rounded-pill`. Shadows: `shadow-card`, `shadow-card-hover`, `shadow-dropdown`, `shadow-cta`.
- Mobile first: `BottomNav` on mobile (hidden on market pages, which own the bottom with the trade bar), `pb-28` main padding. Check both widths with headless Chrome: `google-chrome --headless=new --screenshot=out.png --window-size=390,1000 --virtual-time-budget=20000 http://localhost:3000/`.

---

## 6. Gotchas: read before editing

1. **IDL sync.** After changing instructions or accounts: `anchor build`, then copy `apps/program/target/idl/mention.json` → `apps/web/src/lib/idl/mention.json` and update `idl/mention-types.ts`. Redeploy to devnet, or the web app sends instructions the live program doesn't know.
2. **Constants are duplicated** across Rust (`constants.rs`), web (`chain.ts`: limits, `CHALLENGE_WINDOW_SECS`, `SOL_DECIMALS`, `PROGRAM_ID`) and scripts (`scripts/lib.mjs`: `PROGRAM_ID`, PDAs). Change all three together.
3. **LMSR math lives in three places** (`math/lmsr.rs`, `web/lib/lmsr.ts`, `scripts/lib.mjs`; `sim.ts` delegates to `lmsr.ts`). Keep them consistent. See #16.
4. `apps/program` is **excluded from the pnpm workspace** (`!apps/program`). Use its own `node_modules` and run scripts with plain `node`.
5. `next dev` writes to `.next-dev`, `next build` to `.next`, so they don't clobber each other. If dev acts weird, delete `.next-dev`.
6. Vitest does not read tsconfig paths. The `@/` alias is duplicated in `vitest.config.mts`.
7. The web bundle stubs Node built-ins (`fs/os/path/crypto` fallbacks in `next.config.ts`). Don't import Node-only modules into client components. Server-only code goes in `app/api/*` (`runtime = "nodejs"`).
8. The public devnet RPC 429s. Use `withRetry` for new RPC calls and set `NEXT_PUBLIC_SOLANA_RPC_URL`.
9. Resolution specs: only the **hash** is on-chain. The bytes must be in the spec store, or the market can't be resolved through the evidence pipeline. The store is Postgres when `DATABASE_URL` is set, else `apps/resolver/data/specs/`.
   - **Async** (always `await` it) and **insert-only**: the same spec again is a no-op; a different one throws `SpecConflictError`.
   - `/api/specs` POST stores a spec only if it hashes to the market's on-chain `ResolutionSpecCommitment` (`lib/server/spec-registry.ts`). That's why it needs no auth. It returns 404 + `retryable` while the commitment isn't visible, and 422 on a mismatch.
   - An all-zero spec hash means legacy/demo, and propose rejects it.
10. `resolution` JSON shapes are **versioned contracts**. Changing fields needs a new schema version and shared test vectors (`apps/resolution/README.md`).
11. `close_market` / `cleanup.mjs` force-close resolved markets. Never run them while users still have unclaimed winnings.
12. The Zustand store is **persisted** (localStorage). Shape changes may need a migration, or users get stale state.
13. Proposing needs the resolver wallet to hold **≥ 1.05 SOL** (1 SOL bond plus evidence rent and fees). `oracle.mjs` checks this. Evidence bytes are deterministic per market (timestamps pinned to `end_time`), so retries and re-proposes after a challenge reuse the same evidence PDA.
14. **Never do a CPI after moving lamports directly** (e.g. `withdraw_sol`) to an account the CPI doesn't include. The runtime fails it with `UnbalancedInstruction`. Do CPIs (`deposit_sol`) first, then direct moves. See `propose` in `resolve.rs`.
15. **Deploying a bigger binary**: devnet's loader rejects program extensions under **10,240 bytes**, and the CLI's auto-extend asks for exactly the shortfall, so the deploy fails with `invalid program argument`. Fix: `solana program extend 5xA4v2SasSoE8mPnWSpePV3U4piHgag51od6mrNDU8j8 10240 --url devnet`, then deploy again.
16. **LMSR buys are closed form.** `shares_for_cost` (`math/lmsr.rs`) is the exact inverse, built from small terms (`log1p`/`expm1`) so skewed markets stay precise. A buy costs about 30k CU. It's mirrored term for term in `web/src/lib/lmsr.ts::lmsrSharesForCost` and `scripts/lib.mjs::sharesForCost`, pinned by the same 60-digit test vectors. Change all three together. Never go back to a bisection: about 115 rounds of soft-float `exp`/`log` hit the 1.4M CU cap.
17. New `ErrorCode` variants go **last**: codes are positional, and the web maps them from the IDL.
18. Large transactions: compute limit is `COMPUTE_UNIT_LIMIT = 1_400_000`. Closing markets with many positions can exceed the tx size limit.
19. **Resolution worker** (`apps/worker`). Queue: the `resolutions` table, with guarded transitions (`resolver/src/store/resolution-queue.mjs`).
    - It **never proposes without an operator approval** (reviewer + rationale), even when the evaluator is certain.
    - Evidence is built once per round and stored, so retries post identical bytes and reuse the PDA. A challenge starts a new round, which needs a new approval.
    - Transcripts are stored compact (`compactDeepgramResponse`), times relative to the audio. They're shifted onto the market clock (`startedAtMs`) and **split at the window edges** (`splitAtMs`): the evaluator drops any segment not wholly inside the window, which could turn a spoken phrase into a false NO.
    - **Evidence must fit one transaction: ≤ 800 bytes** (`MAX_POSTABLE_EVIDENCE_LEN`; the measured ceiling is 813), not the program's 4096. Fixed manifest fields take ~600, so evidence quotes one excerpt, trimmed around the matched phrase, and rationales are capped at 120 chars. An approval that still doesn't fit goes back for review. Larger evidence needs a chunked `post_evidence` in the program.
    - Run **one** worker instance: passes are sequential within a process, but two processes could double-submit.

---

## 7. Recipes

**Add a program instruction**
1. `instructions/<name>.rs` with `#[derive(Accounts)]` + `pub fn handler`. Export it in `instructions.rs` and wrap it in `lib.rs`.
2. Add errors to `error.rs` and constants to `constants.rs`.
3. LiteSVM test in `tests/test_market.rs`, then `cargo test`.
4. `anchor build`, sync the IDL (§6.1), add a builder in `web/lib/chain.ts`, add a store action in `sim.ts` if needed, deploy.

**Add a page**: `app/<route>/page.tsx` (`"use client"` if it uses the store or wallet), compose from `components/ui`, add a nav entry in `components/shell.tsx`.

**Add a market field**: Rust `state.rs` (account size changes, so existing devnet accounts break and you must clean up and reseed) → IDL → `ChainMarketAccount` + `mapMarketToStore` in `chain.ts` → `types.ts` `Market` → sim seeds.

**Resolve a real market** (worker): the spec's `source.url` must be a public audio/video file Deepgram can fetch. Worker locks → transcribes → `candidate`/`needs_review` → `ops approve <m> --rationale "…"` → worker posts evidence + proposes → finalizes after the window. A recording that didn't start at the window start: `ops retry <m> --audio-start <ISO>` (re-evaluates the stored transcript, no new Deepgram call).

**Fresh devnet demo**: `cleanup` → (`bootstrap` once) → `seed` (with `SEED_BLOCK=n` if the batch expired) → keep `oracle --watch --all` running with the same `SEED_BLOCK`.

---

## 8. Status and roadmap

Done: Anchor program (LMSR + pari-mutuel, optimistic resolution with bond and
challenge, evidence manifests bound to spec hash), web app wired to devnet,
resolution contracts, resolver pipeline with Deepgram adapters, spec store and
resolution queue on Postgres, resolution worker (batch recordings, operator approval).

Next (see README and RESEARCH): `/ops` approval page, live capture,
Helius indexer + WebSocket feed (replace polling), Postgres for users, points
and evidence, Arweave audio hashes, a bond that scales with open interest, an
LMSR `b` that scales with volume, multisig escalation for disputes.

## 9. Conventions

- Commit style: short lowercase summaries (`market cards and detail page improvise`).
- Match surrounding code: comment density, naming, and the existing `lib/` helpers (`fmtSol`, `cn`, motion tokens) over new ones.
- Amounts: on-chain values are **lamports** (u64, `SOL_DECIMALS = 1e9`). The store and UI use **SOL floats**. Convert only in `chain.ts`.
