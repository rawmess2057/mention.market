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

declare_id!("E6CW51RhjVAiMKJMjzfUNWDDyetqninZzRSLa4nRdZDV");

#[program]
pub mod mention {
    use super::*;

    /// One-time program setup: authority, trusted resolver, USDC mint, fee.
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
        asset: AssetKind,
        b: u64,
        words: Vec<String>,
        end_time: i64,
        creator_fee_bps: u16,
    ) -> Result<()> {
        create_market::handler(
            ctx,
            id,
            title,
            event,
            vertical,
            market_type,
            asset,
            b,
            words,
            end_time,
            creator_fee_bps,
        )
    }

    /// Permissionlessly lock a market after its end time.
    pub fn lock_market(ctx: Context<LockMarket>) -> Result<()> {
        lock_market::handler(ctx)
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

    /// Resolver proposes the winning outcome with a bond and an evidence hash.
    pub fn propose_resolution(
        ctx: Context<ProposeResolution>,
        outcome: String,
        confidence: u8,
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        resolve::propose(ctx, outcome, confidence, evidence_hash)
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
