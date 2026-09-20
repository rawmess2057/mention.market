use anchor_lang::prelude::*;

use crate::constants::MAX_FEE_BPS;
use crate::error::ErrorCode;
use crate::state::Config;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    /// CHECK: Devnet USDC mint, validated by the client. Stored for vault setup.
    pub usdc_mint: UncheckedAccount<'info>,
    /// CHECK: Trusted resolution key. Stored without validation; may equal authority.
    pub resolver: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeConfig>, fee_bps: u16) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, ErrorCode::InvalidFeeBps);

    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.resolver = ctx.accounts.resolver.key();
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.fee_bps = fee_bps;
    config.paused = false;
    config.bump = ctx.bumps.config;
    Ok(())
}
