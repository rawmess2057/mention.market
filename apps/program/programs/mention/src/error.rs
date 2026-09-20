use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Program is paused")]
    Paused,
    #[msg("Signer is not authorized for this action")]
    Unauthorized,
    #[msg("Fee basis points exceed the maximum")]
    InvalidFeeBps,
    #[msg("Invalid end time")]
    InvalidEndTime,
    #[msg("Invalid market parameters")]
    InvalidMarket,
    #[msg("Market is not open")]
    MarketNotOpen,
    #[msg("Market has not ended yet")]
    MarketNotEnded,
    #[msg("Too many words for this market")]
    TooManyWords,
    #[msg("Word label is too long")]
    WordTooLong,
    #[msg("Title or event name is too long")]
    TitleTooLong,
    #[msg("Outcome label is too long")]
    OutcomeTooLong,
    #[msg("Token account data is invalid")]
    InvalidTokenAccount,
    #[msg("Insufficient funds for this action")]
    InsufficientAmount,
    #[msg("Market is not a binary (LMSR) market")]
    NotBinary,
    #[msg("Market is not a majority (pari-mutuel) market")]
    NotMajority,
    #[msg("Word is not a valid outcome in this market")]
    UnknownWord,
    #[msg("Position must be zero to claim")]
    Claimed,
    #[msg("No winning shares held")]
    NoWinningShares,
    #[msg("Market has not resolved yet")]
    NotResolved,
    #[msg("Market must be locked before a proposal")]
    MarketNotLocked,
    #[msg("Market is already resolving")]
    AlreadyResolving,
    #[msg("No pending resolution proposal")]
    NoPendingProposal,
    #[msg("Challenge window is not open")]
    WindowNotOpen,
    #[msg("Outcome or evidence is invalid")]
    InvalidResolution,
    #[msg("Exit price moved beyond slippage tolerance")]
    SlippageTooHigh,
}
