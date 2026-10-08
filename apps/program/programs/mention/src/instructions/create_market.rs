use anchor_lang::prelude::*;

use crate::constants::{MAX_FEE_BPS, MAX_TITLE_LEN, MAX_WORDS, MAX_WORD_LEN};
use crate::error::ErrorCode;
use crate::math::reserve_ante;
use crate::state::{
    AssetKind, Config, Market, MarketStatus, MarketType, Vertical, Vault, WordPool,
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
    asset: AssetKind,
    b: u64,
    words: Vec<String>,
    end_time: i64,
    creator_fee_bps: u16,
) -> Result<()> {
    require!(ctx.accounts.config.paused == false, ErrorCode::Paused);
    // The USDC vault path is not wired end to end yet (no ATA plumbing in the
    // clients). Rejecting here keeps every market on the SOL vault, which is
    // the only path with tests and a funded reserve ante.
    require!(asset == AssetKind::Sol, ErrorCode::AssetNotSupported);
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
    market.asset = asset;
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
    vault.asset = asset;
    vault.mint = match asset {
        AssetKind::Usdc => ctx.accounts.config.usdc_mint,
        AssetKind::Sol => anchor_lang::system_program::ID,
    };
    vault.bump = ctx.bumps.vault;

    emit!(MarketCreated {
        market: market_key,
        creator: creator_key,
        id,
    });
    Ok(())
}

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub creator: Pubkey,
    pub id: u64,
}
