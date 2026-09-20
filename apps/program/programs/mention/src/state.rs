use anchor_lang::prelude::*;

/// Currency a market is denominated in. USDC markets settle through an SPL
/// token vault; SOL markets settle through the `Vault` PDA's lamports.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum AssetKind {
    Usdc,
    Sol,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum MarketType {
    Binary,
    Majority,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum MarketStatus {
    Open,
    Locked,
    Resolving,
    Resolved,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Vertical {
    Streams,
    Sports,
    Earnings,
    Politics,
    Podcasts,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, Debug)]
pub struct WordPool {
    #[max_len(32)]
    pub word: String,
    pub pool: u64,
    pub bettors: u32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, Debug)]
pub struct WordBack {
    #[max_len(32)]
    pub word: String,
    pub amount: u64,
}

/// Global program configuration (one per deployment).
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub resolver: Pubkey,
    pub usdc_mint: Pubkey,
    pub fee_bps: u16,
    pub paused: bool,
    pub bump: u8,
}

/// Per-market escrow. Holds SOL directly; owns the USDC ATA when `asset` is USDC.
#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub market: Pubkey,
    pub asset: AssetKind,
    /// USDC mint for token markets, or the system program id for SOL markets.
    pub mint: Pubkey,
    pub bump: u8,
}

/// A prediction market. Binary markets price YES/NO with LMSR; majority markets
/// are pari-mutuel word races.
#[account]
#[derive(InitSpace)]
pub struct Market {
    pub id: u64,
    pub creator: Pubkey,
    #[max_len(64)]
    pub title: String,
    #[max_len(64)]
    pub event: String,
    pub vertical: Vertical,
    pub asset: AssetKind,
    pub market_type: MarketType,
    pub status: MarketStatus,
    /// LMSR liquidity parameter (binary markets), in base units.
    pub b: u64,
    pub yes_shares: u64,
    pub no_shares: u64,
    /// Cumulative cost basis of YES/NO shares — drives LMSR solvency accounting.
    pub yes_cost: u64,
    pub no_cost: u64,
    #[max_len(16)]
    pub words: Vec<WordPool>,
    /// Total pari-mutuel pot across all words, in base units.
    pub total_pool: u64,
    pub volume: u64,
    pub traders: u32,
    pub creator_fee_bps: u16,
    pub end_time: i64,
    /// Empty until resolved. "yes" | "no" for binary, a word for majority.
    #[max_len(32)]
    pub winning_outcome: String,
    pub confidence: u8,
    pub bond: u64,
    pub evidence_hash: [u8; 32],
    pub proposed_at: i64,
    pub challenge_deadline: i64,
    pub resolved_at: i64,
    /// Resolver pubkey behind the current proposal; the bond refunds here on
    /// finalize (via their ATA for USDC markets, lamports for SOL markets).
    pub proposer: Pubkey,
    pub bump: u8,
}

/// A wallet's holdings in a single market.
#[account]
#[derive(InitSpace)]
pub struct Position {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub yes_shares: u64,
    pub no_shares: u64,
    pub yes_cost: u64,
    pub no_cost: u64,
    #[max_len(16)]
    pub word_backs: Vec<WordBack>,
    pub claimed: bool,
    pub bump: u8,
}
