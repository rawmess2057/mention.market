use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::{Market, MarketStatus};

#[derive(Accounts)]
pub struct LockMarket<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.id.to_le_bytes().as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
}

/// Permissionlessly lock a market once its `end_time` has passed. Trading is
/// disabled while locked; the resolver then proposes an outcome.
pub fn handler(ctx: Context<LockMarket>) -> Result<()> {
    let market = &mut ctx.accounts.market;
    require!(
        market.status == MarketStatus::Open,
        ErrorCode::MarketNotOpen
    );
    require!(
        Clock::get()?.unix_timestamp >= market.end_time,
        ErrorCode::MarketNotEnded
    );
    market.status = MarketStatus::Locked;
    Ok(())
}
