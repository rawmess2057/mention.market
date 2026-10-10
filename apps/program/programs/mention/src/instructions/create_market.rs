use anchor_lang::prelude::*;

use crate::constants::{MAX_FEE_BPS, MAX_TITLE_LEN, MAX_WORDS, MAX_WORD_LEN};
use crate::error::ErrorCode;
use crate::math::reserve_ante;
use crate::state::{
    Config, Market, MarketStatus, MarketType, ResolutionSpecCommitment, Vertical, Vault, WordPool,
};

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [b"market", id.to_le_bytes().as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,

    #[account(
        init,
        payer = creator,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = creator,
        space = 8 + ResolutionSpecCommitment::INIT_SPACE,
        seeds = [b"resolution-spec", market.key().as_ref()],
        bump
    )]
    pub resolution_spec: Account<'info, ResolutionSpecCommitment>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
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
    require!(ctx.accounts.config.paused == false, ErrorCode::Paused);
    require!(title.len() <= MAX_TITLE_LEN, ErrorCode::TitleTooLong);
    require!(event.len() <= MAX_TITLE_LEN, ErrorCode::TitleTooLong);
    require!(b > 0, ErrorCode::InvalidMarket);
    require!(creator_fee_bps <= MAX_FEE_BPS, ErrorCode::InvalidFeeBps);
    require!(words.len() <= MAX_WORDS, ErrorCode::TooManyWords);
    require!(
        end_time > Clock::get()?.unix_timestamp,
        ErrorCode::InvalidEndTime
    );
    if market_type == MarketType::Majority {
        require!(!words.is_empty(), ErrorCode::InvalidMarket);
    }

    // Seed the AMM with its reserve ante, b * ln 2 — the worst-case payout the
    // LMSR can owe. Without it the vault starts at rent only and the invariant
    // `vault_balance >= C(q_bal)` fails from the first trade.
    let ante = reserve_ante(b);
    if ante > 0 {
        crate::instructions::token_util::deposit_sol(
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.creator.to_account_info(),
            &ctx.accounts.vault.to_account_info(),
            ante,
        )?;
    }

    let mut pools: Vec<WordPool> = Vec::with_capacity(words.len());
    for word in words.iter() {
        require!(word.len() <= MAX_WORD_LEN, ErrorCode::WordTooLong);
        pools.push(WordPool {
            word: word.clone(),
            pool: 0,
            bettors: 0,
        });
    }

    let market_key = ctx.accounts.market.key();
    let creator_key = ctx.accounts.creator.key();

    let market = &mut ctx.accounts.market;
    market.id = id;
    market.creator = creator_key;
    market.title = title;
    market.event = event;
    market.vertical = vertical;
    market.market_type = market_type;
    market.status = MarketStatus::Open;
    market.b = b;
    market.yes_shares = 0;
    market.no_shares = 0;
    market.yes_cost = 0;
    market.no_cost = 0;
    market.words = pools;
    market.total_pool = 0;
    market.volume = 0;
    market.traders = 0;
    market.creator_fee_bps = creator_fee_bps;
    market.end_time = end_time;
    market.winning_outcome = String::new();
    market.confidence = 0;
    market.bond = 0;
    market.evidence_hash = [0u8; 32];
    market.proposed_at = 0;
    market.challenge_deadline = 0;
    market.resolved_at = 0;
    market.proposer = creator_key;
    market.bump = ctx.bumps.market;

    let vault = &mut ctx.accounts.vault;
    vault.market = market_key;
    vault.bump = ctx.bumps.vault;

    let resolution_spec = &mut ctx.accounts.resolution_spec;
    resolution_spec.market = market_key;
    resolution_spec.spec_sha256 = resolution_spec_sha256;
    resolution_spec.bump = ctx.bumps.resolution_spec;

    emit!(MarketCreated {
        market: market_key,
        creator: creator_key,
        id,
        resolution_spec_sha256,
    });
    Ok(())
}

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub creator: Pubkey,
    pub id: u64,
    pub resolution_spec_sha256: [u8; 32],
}
