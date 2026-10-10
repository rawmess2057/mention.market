use anchor_lang::prelude::*;

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
    pub fee_bps: u16,
    pub paused: bool,
    pub bump: u8,
}

/// Per-market escrow. Holds SOL directly as its lamport balance.
#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub market: Pubkey,
    pub bump: u8,
}

/// Immutable commitment to the resolution rules agreed at market creation.
/// An all-zero hash marks legacy/demo markets that are not eligible for backend resolution.
#[account]
#[derive(InitSpace)]
pub struct ResolutionSpecCommitment {
    pub market: Pubkey,
    pub spec_sha256: [u8; 32],
    pub bump: u8,
}

/// Raw evidence manifest bytes committed on-chain for a resolution proposal.
///
/// The account *address* commits to the payload: its PDA seeds include
/// `sha256(bytes)`, and `post_evidence` recomputes and stores that hash. Because
/// the resolver cannot alter the bytes without changing the address, an
/// approved `propose_resolution` is bound to the exact evidence it cites.
#[account]
#[derive(InitSpace)]
pub struct EvidenceManifest {
    pub market: Pubkey,
    /// Committed resolution spec this evidence was evaluated against.
    pub spec_sha256: [u8; 32],
    /// `sha256(bytes)`, computed by the program on `post_evidence`.
    pub sha256: [u8; 32],
    pub bump: u8,
    #[max_len(4096)]
    pub bytes: Vec<u8>,
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
    /// finalize (lamports to the proposer's system account).
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
