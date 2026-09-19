# Web3 Prediction Markets — Research for mention.market

> "Trade on what gets said." This doc maps the prediction-market landscape, the
> mechanism and oracle designs we can steal, and a phased roadmap for
> mention.market. Everything below is grounded in the current (2026) ecosystem.

---

## 1. The landscape

| Project | Chain / Model | Mechanism | Resolution | Notes |
| --- | --- | --- | --- | --- |
| **Polymarket** | Polygon, CTF + UMA | Order-book (CLOB), ERC-1155 YES/NO tokens redeemable to $1 | UMA optimistic oracle: propose (bond) → 2h challenge → DVM vote if twice disputed | The category leader; 0 trading fee, monetizes spread + USDC.e conversion |
| **Azuro** | Polygon/BNB, EVM | vAMM over a **singleton LP** (LiquidityTree) | Data Providers elected by AzuroDAO + stop-loss throttles | LPs get 15–20% APY historically; DPs take 10% of revenue, front-runnable by design |
| **World** | **Solana** | Order routing to Solana LPs; positions are **SPL tokens** | **Chainlink Data Streams + Automation** (auto-resolve + auto-payout) | Inside Phantom (~20M users); 150k+ markets since July; the proof Solana is the PM chain |
| **Monaco Protocol / BetDEX** | Solana | P2P exchange matching engine | Wallet settlement on-chain | Fee 3% on *net winnings* (1% Monaco + 2% BetDEX) |
| **ProphetX + Agg** | Solana (tokenized) | CFTC DCM/DCO contracts exposed via Agg tokenization layer | Off-chain regulated settlement | Bridge between regulated event contracts and on-chain apps |
| **Kalshi** | US-regulated (non-web3) | Order-book event contracts | Manual/regulated | 4M+ users, $1.16B+ open interest (June 2026) |
| **Manifold** | Web, play-money | AMM (CPMM for binary, DPM for free-response) | Creator/user resolve, dispute buttons | Best documentation of AMM design trade-offs; mana = play money |

### Takeaway for mention.market
- **Solana is legit** — World (Phantom/Chainlink), Monaco/BetDEX, ProphetX+Agg,
  plus Epoch (private sportsbook, Arcium) all landed in the last 12 months.
- The "what gets said" vertical (media, streams, podcasts, earnings calls,
  debates) is **unserved**. Polymarket's famous speech markets ("will X say Y")
  are rare and *manually resolved* because auto-detection is hard — that gap is
  the moat.

---

## 2. Resolution is the product (and the moat)

Polymarket's model (UMA una-ctf-adapter):

1. **Propose** — anyone posts a bond (~$500–750 USDC) asserting 0/0.5/1.
2. **Liveness** — ~2h challenge window. Undisputed ⇒ resolves.
3. **Dispute → reset → re-propose** — first dispute auto-resets the question.
4. **Second dispute → DVM vote** — UMA stakers vote (48–72h, commit/reveal).
5. **Payout** — winning token = $1, 50/50 question ⇒ both sides redeem $0.50.

What actually breaks in production (per UMA incident + tierzero analysis):

- **Ambiguous ancillary data** is the #1 dispute driver. "Immediately" is not a
  timestamp; rule wording is an engineering task, not copywriting.
- **Bond-to-stakes mismatch**: a $750 bond vs $2M open interest invites wrong
  proposals when rational apathy wins.
- **Sniping bots** race disputes in the public mempool latency game.

### What this means for mention.market word-markets
Our core markets ("will they say X", "first word said") are *exactly* the
specification-hard case — so we should differentiate by making resolution
**cheap and unambiguous**:

- Define a **resolution grammar** per market type:
  - exact-match vs stemming (`pause` ≠ `paused` — already enforced in `m3`)
  - standalone-token vs substring (`AI` vs `air`)
  - speaker attribution (host only vs any)
  - primary source + tape-delay guardrail (live feed vs official VOD)
  - count semantics ("10+ times", current `m10` rules)
- Treat the **transcript feed as a first-class oracle** (Deepgram-style) so most
  markets auto-resolve, and disputes become cheap to adjudicate from immutable
  snippets — the sim already carries `evidence.snippets`.
- **Scale the proposal bond with open interest** (the sim hardcodes $50).

---

## 3. Mechanisms — what to adopt

### 3.1 The Manifold AMM odyssey (most applicable lesson)
Manifold shipped DPM (dynamic parimutuel) → LMSR → CPMM and documented why:

- **DPM payout-fidelity problem**: quote-time odds are *not* guaranteed —
  payouts can shrink to half of the advertised multiple as money piles in.
  → **Our `quoteBack().payoutIfWin` has the identical flaw.** Plan:
  - honest UI now (show pot-share and "minimum final payout if the pot triples")
  - or move word-races to a *fixed-payout* multi-outcome CPMM (Manifold
    multiple-choice with JIT arbitrage) where each word's shares redeem to a
    fixed $1 — the VM for "first word said" markets.
- **Slippage is an implicit tax**: platforms that show effective price +
  price-impact before execution win trust. → Add a slippage/price-impact line to
  the trade panel.
- **Liquidity parameter should scale with volume**: `b` (LMSR subsidy) too small
  ⇒ tiny trades swing the price. → Scale `b` with expected volume and to allow
  creators/users to inject liquidity into a market's `b`.

### 3.2 Fixed payout + redeemable outcome tokens (the end state)
Polymarket (CTF) and World (SPL tokens) both converge on the same shape:
**$1 outcome tokens, redeemable after resolution**. That is the long-term
Anchor program for mention.market:

- 1 USDC in ⇒ 1 YES + 1 NO token minted (share identity).
- Resolve ⇒ YES redeems $1, NO redeems $0.
- Users can hold/transfer/sell position tokens like any SPL asset (World lesson).

### 3.3 Liquidity and LPs
- Azuro: a singleton LP + LiquidityTree removes per-market bootstrapping and
  gives passive yield — but needs sophisticated Data Providers to price. Too
  heavy for us now; the **ante** idea (market creator seeds `b`) is the cheap
  version (Manifold's "ante system").
- Monaco protocol is the nearest **shared-liquidity exchange infra on Solana**
  worth evaluating later instead of writing our own matching engine.

### 3.4 Fee models to benchmark
| Platform | Fee |
| --- | --- |
| Polymarket | 0 trading fee (monetizes spread + settlement swap) |
| BetDEX/Monaco | 3% on net winnings (1% protocol + 2% operator) |
| Azuro | DPs take 10% of market revenue |
| mention.market (current) | binary: 1% creator fee at settlement; majority: 1% pool rake |

→ Make fees visible in-quote and creator-configurable (the `creatorFeeBps`
field already exists).

### 3.5 Auto-payout & engagement
- World/Chainlink Automation credits winners automatically. → After our
  challenge window closes, auto-credit claimable → balance instead of manual
  claim (or keep claim as a UX moment + confetti, but expose auto-settle).
- Manifold play-money + Polymarket/World: points, streaks, live leaderboard
  wired to **computed PnL** (ours is static seed data), watch-word pings when a
  market resolves — the retention loops.

---

## 4. Prioritized roadmap

**Near term (ship now)**
1. ✅ Per-user trade ledger — trade history + P&L dashboard (done in this build).
2. Slippage / price-impact preview in TradePanel + "pot share" honesty in the
   word-race quote.
3. Resolution grammar spec + show it in the market "Rules / Resolution" tab so
   resolutions are provably deterministic.

**Mid term**
4. Auto-payout after challenge window + resolution ping via watch-words
   (notification bell is already in the TopBar).
5. Auto-resolve off a synthetic transcript feed (extract keyword hits from
   `transcript` to propose resolutions — the sim already emits snippets).
6. Live leaderboard driven by real PnL; streaks/badges.

**Long term**
7. Anchor program: outcome tokens (1 USDC = YES + NO), redemption to USDC,
   bond-adjusted optimistic resolution (featured by proposal/dispute in sim
   today). Evaluate Monaco protocol for shared liquidity.
8. Fixed-payout multi-outcome CPMM word races (JIT arbitrage, Manifold-style)
   as the "first word said" engine; keep parimutuel for creator-simple pools.
9. Vertical + distribution: wallet-native entry, presser/house/court "what gets
   said" extension, real-time resolution data over websocket (indexer).

---

## 5. Sources
- Polymarket resolution docs & UMA CTF adapter (github/mintlify) — propose/dispute/DVM flow
- UMA optimistic-oracle incident analysis (tierzero.dev)
- Azuro docs (LiquidityTree, vAMM, DPs, LP yield) + Azuro blog
- World on Solana (Phantom + Chainlink, SPL position tokens), Solana Compass/Horizon
- Monaco Protocol & BetDEX reviews; ProphetX + Agg tokenization layer
- Manifold "Above the Fold" (market mechanics, multiple-choice markets); Kevin
  Zielnicki on DPM payout fidelity
- arXiv 2609.15368 "Resolution Is Not Settlement, Part I" (UMA adjudication states)