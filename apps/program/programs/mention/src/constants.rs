/// Maximum number of words/pools allowed in a majority ("race") market.
pub const MAX_WORDS: usize = 16;
/// Maximum creator/resolution fee in basis points (5%).
pub const MAX_FEE_BPS: u16 = 500;
/// Maximum bytes for a market title or event name.
pub const MAX_TITLE_LEN: usize = 64;
/// Maximum bytes for a single word/pool label.
pub const MAX_WORD_LEN: usize = 32;
/// Maximum bytes for the winning outcome label ("yes"/"no"/a backed word).
pub const MAX_OUTCOME_LEN: usize = 32;
/// Minimum challenge window (seconds) for an optimistic resolution.
pub const MIN_CHALLENGE_WINDOW: i64 = 60;
/// Lamports-per-UI-unit scale for a SOL-denominated market.
pub const SOL_DECIMALS: u64 = 1_000_000_000;
/// Base units per UI unit for the devnet USDC mint.
pub const USDC_DECIMALS: u64 = 1_000_000;
/// Challenge window (seconds) for an optimistic resolution proposal.
pub const CHALLENGE_WINDOW_SECS: i64 = 120;
/// Resolution proposal/challenge bond, expressed as UI units of the market
/// asset. Converted to base units per market via [`bond_units`].
pub const BOND_UI: u64 = 50;

/// Bond in base units for a market's asset: nominally `BOND_UI` of the
/// denominating currency (50 USDC micro-units, or 50 SOL lamports).
pub fn bond_units(asset: crate::state::AssetKind) -> u64 {
    match asset {
        crate::state::AssetKind::Usdc => BOND_UI * USDC_DECIMALS,
        crate::state::AssetKind::Sol => BOND_UI * SOL_DECIMALS,
    }
}
