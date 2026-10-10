//! Majority ("race") market betting: back a word with `amount` base units into
//! that word's pari-mutuel pool. The winning word's backers split the net pot
//! pro-rata at settlement.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::{Market, MarketStatus, MarketType, Position, Vault, WordBack};

#[derive(Accounts)]
pub struct BackWord<'info> {
    #[account(mut)]
    pub backer: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, crate::state::Config>>,

    #[account(
        mut,
        seeds = [b"market", market.id.to_le_bytes().as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        init_if_needed,
        payer = backer,
        space = 8 + Position::INIT_SPACE,
        seeds = [b"position", market.key().as_ref(), backer.key().as_ref()],
        bump
    )]
    pub position: Box<Account<'info, Position>>,

    pub system_program: Program<'info, System>,
}

/// Back `word` with `amount` base units.
pub fn handler(ctx: Context<BackWord>, word: String, amount: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, ErrorCode::Paused);
    let market_key = ctx.accounts.market.key();
    let market = &mut ctx.accounts.market;
    require!(market.status == MarketStatus::Open, ErrorCode::MarketNotOpen);
    require!(
        Clock::get()?.unix_timestamp < market.end_time,
        ErrorCode::MarketClosed
    );
    require!(
        market.market_type == MarketType::Majority,
        ErrorCode::NotMajority
    );
    require!(amount > 0, ErrorCode::InvalidMarket);

    let slot = market
        .words
        .iter()
        .position(|w| w.word == word)
        .ok_or(ErrorCode::UnknownWord)?;

    // Move funds in before mutating pools.
    crate::instructions::token_util::deposit_sol(
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.backer.to_account_info(),
        &ctx.accounts.vault.to_account_info(),
        amount,
    )?;

    let pool = &mut market.words[slot];
    pool.pool += amount;
    pool.bettors += 1;
    market.total_pool += amount;
    market.volume += amount;
    market.traders += 1;

    let position = &mut ctx.accounts.position;
    position.market = market_key;
    position.owner = ctx.accounts.backer.key();
    if let Some(back) = position
        .word_backs
        .iter_mut()
        .find(|b| b.word == word)
    {
        back.amount += amount;
    } else {
        position.word_backs.push(WordBack {
            word,
            amount,
        });
    }

    Ok(())
}