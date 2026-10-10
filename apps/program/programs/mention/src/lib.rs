// Each instruction module exposes a `handler`; glob re-exporting them is what
// the `#[program]` macro expects, so the resulting ambiguity is intentional.
#![allow(ambiguous_glob_reexports)]

pub mod constants;
pub mod error;
pub mod instructions;
pub mod math;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use math::*;
pub use state::*;

declare_id!("5xA4v2SasSoE8mPnWSpePV3U4piHgag51od6mrNDU8j8");

#[program]
pub mod mention {
    use super::*;

    /// One-time program setup: authority, trusted resolver, fee.
    pub fn initialize_config(ctx: Context<InitializeConfig>, fee_bps: u16) -> Result<()> {
        initialize_config::handler(ctx, fee_bps)
    }

    /// Create a binary (LMSR) or majority (pari-mutuel) market plus its vault.
    #[allow(clippy::too_many_arguments)]
    pub fn create_market(
        ctx: Context<CreateMarket>,
        id: u64,
        title: String,
        event: String,
        vertical: Vertical,
        market_type: MarketType,
        b: u64,
        words: Vec<String>,
        end_time: i64,
        creator_fee_bps: u16,
        resolution_spec_sha256: [u8; 32],
    ) -> Result<()> {
        create_market::handler(
            ctx,
            id,
            title,
            event,
            vertical,
            market_type,
            b,
            words,
            end_time,
            creator_fee_bps,
            resolution_spec_sha256,
        )
    }

    /// Permissionlessly lock a market after its end time.
    pub fn lock_market(ctx: Context<LockMarket>) -> Result<()> {
        lock_market::handler(ctx)
    }

    /// Flip the global kill switch. Only the config authority may call it.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        set_paused::handler(ctx, paused)
    }

    /// Buy `side` (0 = YES, 1 = NO) for `cost` base units, minting at least
    /// `min_shares` shares via LMSR.
    pub fn buy_binary(
        ctx: Context<BuyBinary>,
        side: u8,
        cost: u64,
        min_shares: u64,
    ) -> Result<()> {
        trade::buy(ctx, side, cost, min_shares)
    }

    /// Sell `shares` of `side` back to the AMM for at least `min_proceeds`.
    pub fn sell_binary(
        ctx: Context<SellBinary>,
        side: u8,
        shares: u64,
        min_proceeds: u64,
    ) -> Result<()> {
        trade::sell(ctx, side, shares, min_proceeds)
    }

    /// Back `word` with `amount` base units in a majority (pari-mutuel) market.
    pub fn back_word(ctx: Context<BackWord>, word: String, amount: u64) -> Result<()> {
        back_word::handler(ctx, word, amount)
    }

    /// Resolver posts the raw evidence manifest bytes for a market's resolution.
    /// `sha256` must equal `sha256(bytes)` (recomputed and verified by the
    /// program); the manifest PDA commits to it.
    pub fn post_evidence(
        ctx: Context<PostEvidence>,
        bytes: Vec<u8>,
        sha256: [u8; 32],
        spec_sha256: [u8; 32],
    ) -> Result<()> {
        post_evidence::handler(ctx, bytes, sha256, spec_sha256)
    }

    /// Resolver proposes the winning outcome, bound to a posted evidence
    /// manifest (`evidence_sha256` is that manifest's hash) and a bond.
    pub fn propose_resolution(
        ctx: Context<ProposeResolution>,
        outcome: String,
        confidence: u8,
        evidence_sha256: [u8; 32],
    ) -> Result<()> {
        resolve::propose(ctx, outcome, confidence, evidence_sha256)
    }

    /// Anyone may challenge a live proposal inside the challenge window.
    pub fn challenge_resolution(ctx: Context<ChallengeResolution>) -> Result<()> {
        resolve::challenge(ctx)
    }

    /// Finalize an undisputed proposal after the window elapses.
    pub fn finalize_resolution(ctx: Context<FinalizeResolution>) -> Result<()> {
        resolve::finalize(ctx)
    }

    /// Claim a position's payout in a resolved market.
    pub fn claim_payout(ctx: Context<Claim>) -> Result<()> {
        claim::handler(ctx)
    }
}
