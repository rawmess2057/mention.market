use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::Config;

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub config: Account<'info, Config>,
}

/// Pause or resume the program. `config.paused` gates `create_market`,
/// `buy_binary`, `sell_binary` and `back_word`; before this existed it could
/// only ever be written to `false` by `initialize_config`, so the kill switch
/// could never be pulled.
pub fn handler(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    emit!(PausedChanged {
        paused,
        authority: ctx.accounts.authority.key(),
    });
    Ok(())
}

#[event]
pub struct PausedChanged {
    pub paused: bool,
    pub authority: Pubkey,
}
